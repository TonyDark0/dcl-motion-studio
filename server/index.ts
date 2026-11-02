import Fastify from 'fastify';
import statics from '@fastify/static';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { projectSchema, motionSchema } from '../src/motion';
import { MAX_TIMELINE_SECONDS, stripEnd } from '../src/timeline';
import {
  KimodoWorker,
  emptyConfig,
  engineStatus,
  supportsConstraints,
  type EngineConfig,
} from './worker';
import { constraintsSchema, compileConstraints } from './kimodo-constraints';
import { referenceRequestSchema } from '../src/pose-reference';
import { videoPoseConstraints } from './video-pose-constraints';
import { captureSchema } from '../src/video-motion';
import { imagePoseConstraints } from './image-pose-constraints';
import { constraintCapability, clearCapabilityCache } from './engine-capabilities';
import { registerVision } from './vision';
import { registerVideoMedia } from './video-media';
import { registerVideoRequestLog } from './video-request-log';
import { registerVideoResults, videoProcessing, finishVideoProcessing } from './video-results';
import { registerCustomAvatar } from './custom-avatar';
import {
  migrateStudio,
  identities,
  identity,
  sessionIdentity,
  owned,
} from './studio-database';
import { registerCommunity } from './community';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(root, 'data');
mkdirSync(data, { recursive: true });
const db = new DatabaseSync(path.join(data, 'studio.sqlite'));
migrateStudio(db);
db.prepare(
  "UPDATE jobs SET status='failed',error='El servicio se reinició durante la generación' WHERE status='running'",
).run();
const configPath = path.join(data, 'engine.json');
const bundled: EngineConfig = {
  executable: path.join(data, 'bin', 'kimodo', 'kmd-generate.exe'),
  model: path.join(data, 'models', 'kimodo', 'kimodo-soma-rp-v1.1-f32.gguf'),
  text: path.join(data, 'models', 'kimodo', 'Llama-3-Kimodo-Q4_K_M.gguf'),
  device: 'cpu',
};
let config: EngineConfig = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, 'utf8'))
  : {
      ...emptyConfig,
      executable: process.env.KIMODO_EXECUTABLE || '',
      model: process.env.KIMODO_MODEL || '',
      text: process.env.KIMODO_TEXT || '',
    };
if (!engineStatus(config).configured && engineStatus(bundled).configured) config = bundled;
const worker = new KimodoWorker();
const studioConstraintsExecutable = path.join(
  data,
  'bin',
  'kimodo-constraints',
  'kmd-generate.exe',
);
let active: string | null = null;
const app = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });
registerVideoRequestLog(app, root);
const vision = registerVision(app, root);
registerVideoMedia(app, root);
registerCustomAvatar(app);
app.addHook('onRequest', async (req, reply) => {
  const origin = req.headers.origin;
  if (
    origin &&
    origin !== process.env.APP_ORIGIN &&
    !/^http:\/\/(127\.0\.0\.1|localhost):(5173|8787)$/.test(origin)
  )
    return reply.code(403).send({ error: 'Origen no permitido' });
  if (
    /^\/api\/(session|captcha|projects|legacy-projects|jobs|generations|dataset)(?:[/?]|$)/.test(
      req.url,
    )
  ) {
    reply.header('Cache-Control', 'no-store');
    identities.set(req, sessionIdentity(db, req, reply));
  }
});
registerCommunity(app, db);
registerVideoResults(app, db, data);
app.setErrorHandler((error, req, reply) => {
  if (error instanceof z.ZodError)
    return reply.code(400).send({ error: error.issues.map((x) => x.message).join('; ') });
  app.log.error(error);
  return reply
    .code(500)
    .send({ error: error instanceof Error ? error.message : 'Error del servicio' });
});
app.get('/api/health', async () => ({
  ok: true,
  engine: {
    ...engineStatus(config),
    running: !!worker.child,
    busy: !!active,
    constraints: await supportsConstraints(config.executable),
  },
  config,
}));
app.put('/api/engine', async (req, reply) => {
  if (active)
    return reply.code(409).send({ error: 'Cancela la generación antes de cambiar el motor.' });
  const clean = z
    .string()
    .max(1000)
    .refine((s) => !/[\t\r\n]/.test(s), 'Ruta inválida');
  config = z
    .object({ executable: clean, model: clean, text: clean, device: z.enum(['cpu', 'vulkan']) })
    .parse(req.body);
  worker.stop();
  clearCapabilityCache();
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return engineStatus(config);
});
app.post('/api/engine/check-constraints', async (_req, reply) => {
  if (active) return reply.code(409).send({ error: 'Wait for the current generation to finish.' });
  return {
    executable: studioConstraintsExecutable,
    ...(await constraintCapability(studioConstraintsExecutable, true)),
  };
});
app.post('/api/engine/use-constraints', async (_req, reply) => {
  if (active) return reply.code(409).send({ error: 'Wait for the current generation to finish.' });
  const capability = await constraintCapability(studioConstraintsExecutable, true);
  if (capability.status !== 'ready')
    return reply.code(422).send({
      error:
        'Studio Constraints cannot run yet. Check its installation and Windows application-control approval.',
      ...capability,
    });
  if (active) return reply.code(409).send({ error: 'Wait for the current generation to finish.' });
  // The bundled Studio build is CPU-only. Keep the selected weight paths.
  const candidate: EngineConfig = {
    ...config,
    executable: studioConstraintsExecutable,
    device: 'cpu',
  };
  if (!engineStatus(candidate).configured)
    return reply.code(422).send({ error: 'Configure the SOMA and text model paths first.' });
  writeFileSync(configPath, JSON.stringify(candidate, null, 2));
  worker.stop();
  config = candidate;
  clearCapabilityCache();
  return { config, ...engineStatus(config) };
});
app.get('/api/projects', async (req) =>
  (
    db
      .prepare('SELECT id,name,updated,body FROM projects WHERE user_id=? ORDER BY updated DESC')
      .all(identity(req).id) as {
      id: string;
      name: string;
      updated: string;
      body: string;
    }[]
  ).map(({ body, ...item }) => {
    const p = JSON.parse(body);
    return {
      ...item,
      workflow: p.workflow || (p.motion?.skeleton === 'dcl-capture' ? 'video' : 'text'),
      thumbnail: p.thumbnail || null,
    };
  }),
);
app.delete('/api/projects/:id', async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const result = db
    .prepare('DELETE FROM projects WHERE id=? AND user_id=?')
    .run(id, identity(req).id);
  if (!result.changes) return reply.code(404).send({ error: 'Project not found' });
  return { deleted: true };
});
app.patch('/api/projects/:id', async (req, reply) => {
  const id = z
    .string()
    .uuid()
    .parse((req.params as { id: string }).id);
  const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
  const row = db
    .prepare('SELECT body FROM projects WHERE id=? AND user_id=?')
    .get(id, identity(req).id) as { body: string } | undefined;
  if (!row) return reply.code(404).send({ error: 'Project not found.' });
  const project = { ...JSON.parse(row.body), name };
  db.prepare('UPDATE projects SET name=?,updated=?,body=? WHERE id=?').run(
    name,
    new Date().toISOString(),
    JSON.stringify(project),
    id,
  );
  return { id, name };
});
app.put('/api/projects/:id', { bodyLimit: 128 * 1024 * 1024 }, async (req, reply) => {
  const id = z
    .string()
    .uuid()
    .parse((req.params as { id: string }).id);
  const p = projectSchema.parse(req.body);
  const existing = db.prepare('SELECT user_id FROM projects WHERE id=?').get(id) as
    { user_id: string } | undefined;
  if (existing && existing.user_id !== identity(req).id)
    return reply.code(404).send({ error: 'Project not found.' });
  if (
    p.duration > MAX_TIMELINE_SECONDS + 1e-6 ||
    p.timeline?.strips.some((s) => stripEnd(s) > MAX_TIMELINE_SECONDS + 1e-6)
  )
    return reply.code(400).send({ error: 'The timeline limit is 10 seconds.' });
  const updated = new Date().toISOString();
  db.prepare(
    'INSERT INTO projects(id,name,updated,body,user_id) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated=excluded.updated,body=excluded.body',
  ).run(id, p.name, updated, JSON.stringify(p), identity(req).id);
  return { id, updated };
});
app.get('/api/projects/:id', async (req, reply) => {
  const row = db
    .prepare('SELECT body FROM projects WHERE id=? AND user_id=?')
    .get((req.params as { id: string }).id, identity(req).id) as { body: string } | undefined;
  if (!row) return reply.code(404).send({ error: 'Proyecto no encontrado' });
  const project = JSON.parse(row.body);
  return {
    ...project,
    workflow: project.workflow || (project.motion?.skeleton === 'dcl-capture' ? 'video' : 'text'),
  };
});
app.get('/api/jobs', async (req) =>
  db
    .prepare(
      'SELECT id,prompt,status,error,created FROM jobs WHERE user_id=? ORDER BY created DESC LIMIT 30',
    )
    .all(identity(req).id),
);
app.delete('/api/jobs/:id', async (req, reply) => {
  const id = z
    .string()
    .uuid()
    .parse((req.params as { id: string }).id);
  if (!owned(db, 'jobs', id, identity(req).id))
    return reply.code(404).send({ error: 'Generation not found.' });
  const row = db.prepare('SELECT status FROM jobs WHERE id=?').get(id) as
    { status: string } | undefined;
  if (row?.status === 'running')
    return reply.code(409).send({ error: 'Wait for generation to finish.' });
  const directory = path.resolve(data, 'motions', id);
  if (path.dirname(directory) !== path.resolve(data, 'motions'))
    throw Error('Invalid motion directory');
  await rm(directory, { recursive: true, force: true });
  db.prepare('DELETE FROM jobs WHERE id=?').run(id);
  return { deleted: true };
});
app.post('/api/jobs', async (req, reply) => {
  const generationStarted = performance.now();
  const input = z
    .object({
      prompt: z.string().trim().min(3).max(2000),
      duration: z.number().min(1).max(10),
      seed: z.number().int().min(0).max(2147483647),
      steps: z.number().int().min(5).max(100).default(30),
      constraints: constraintsSchema.optional(),
      referencePoses: referenceRequestSchema.optional(),
      videoReference: captureSchema.optional(),
      loop: z.boolean().default(false),
      rootMotion: z.enum(['inPlace', 'source']).optional(),
    })
    .transform((value) => ({
      ...value,
      rootMotion:
        value.rootMotion ?? (value.videoReference ? ('source' as const) : ('inPlace' as const)),
    }))
    .parse(req.body);
  if (active) return reply.code(409).send({ error: 'Ya hay una generación en curso.' });
  if (!input.videoReference && input.duration > 4)
    return reply.code(400).send({ error: 'Text generation supports up to 4 seconds.' });
  if (input.videoReference && (input.loop || input.referencePoses || input.constraints?.length))
    return reply
      .code(400)
      .send({ error: 'Choose video references or image/explicit constraints.' });
  if (input.loop && !input.referencePoses)
    return reply.code(400).send({ error: 'Loop animation requires a reviewed start image pose.' });
  if ((input.loop || input.referencePoses) && input.constraints?.length)
    return reply.code(400).send({ error: 'Choose automatic loop or explicit constraints.' });
  try {
    if (input.videoReference)
      videoPoseConstraints(
        input.videoReference,
        Math.round(input.duration * 30),
        input.rootMotion !== 'source',
      );
    if (input.referencePoses)
      imagePoseConstraints(
        input.referencePoses,
        Math.round(input.duration * 30),
        input.loop,
        input.rootMotion !== 'source',
      );
    if (input.constraints?.length)
      compileConstraints(input.constraints, Math.round(input.duration * 30));
  } catch (error) {
    return reply
      .code(400)
      .send({ error: error instanceof Error ? error.message : 'Invalid constraints' });
  }
  if (
    (input.loop || input.constraints?.length || input.referencePoses || input.videoReference) &&
    !(await supportsConstraints(config.executable))
  )
    return reply
      .code(422)
      .send({ error: 'Configure the Studio constraints build of Kimodo to use this feature.' });
  // The capability probe yields: another request may have started in the meantime.
  if (active) return reply.code(409).send({ error: 'Ya hay una generación en curso.' });
  if (!engineStatus(config).configured)
    return reply.code(503).send({
      error:
        'Kimodo no está configurado. Abre Configurar motor para indicar el ejecutable y los modelos.',
    });
  // Tracking and Kimodo run sequentially: release SAM/MoGe/RTMW before loading generation.
  if (input.videoReference) {
    try {
      await vision.release();
    } catch (error) {
      return reply.code(409).send({ error: String(error) });
    }
    if (active) return reply.code(409).send({ error: 'A generation is already running.' });
  }
  const id = randomUUID();
  active = id;
  db.prepare('INSERT INTO jobs(id,prompt,status,error,created,user_id) VALUES(?,?,?,?,?,?)').run(
    id,
    input.prompt,
    'running',
    null,
    new Date().toISOString(),
    identity(req).id,
  );
  db.prepare(
    'INSERT INTO generations(id,user_id,workflow,provider,request_json,model_json,created_at) VALUES(?,?,?,?,?,?,?)',
  ).run(
    id,
    identity(req).id,
    input.videoReference ? 'video' : 'text',
    input.videoReference?.source || 'kimodo.cpp',
    JSON.stringify({
      prompt: input.prompt,
      seed: input.seed,
      duration: input.duration,
      fps: 30,
      steps: input.steps,
      style: null,
      loop: input.loop,
      rootMotion: input.rootMotion,
      references: input.videoReference
        ? {
            poseStride: input.videoReference.metadata.poseStride,
            providerVersion: input.videoReference.metadata.providerVersion,
            retargetVersion: input.videoReference.metadata.retargetVersion,
          }
        : input.referencePoses || null,
    }),
    JSON.stringify({
      engine: 'kimodo.cpp-studio',
      motion: path.basename(config.model),
      text: path.basename(config.text),
      device: config.device,
      retarget: 'decentraland-62-v1',
    }),
    new Date().toISOString(),
  );
  if (input.videoReference)
    db.prepare('INSERT INTO video_processing(generation_id,capture_ms) VALUES(?,?)').run(
      id,
      input.videoReference.metadata.captureMs || 0,
    );
  void worker
    .generate(
      config,
      { ...input, frames: Math.round(input.duration * 30) },
      path.join(data, 'motions', id),
    )
    .then(async () => {
      finishVideoProcessing(db, id, performance.now() - generationStarted);
      const file = path.join(data, 'motions', id, 'motion.json');
      let artifact = await readFile(file);
      const result = motionSchema.parse(JSON.parse(artifact.toString()));
      const timings = videoProcessing(db, id);
      if (result.skeleton === 'soma30' && result.generation?.video && timings) {
        Object.assign(result.generation.video, timings);
        writeFileSync(file, JSON.stringify(result));
        artifact = Buffer.from(JSON.stringify(result));
      }
      db.prepare('UPDATE generations SET completed_at=? WHERE id=?').run(
        new Date().toISOString(),
        id,
      );
      db.prepare("UPDATE jobs SET status='completed' WHERE id=? AND status='running'").run(id);
    })
    .catch((e) => {
      finishVideoProcessing(db, id, performance.now() - generationStarted);
      db.prepare("UPDATE jobs SET status='failed',error=? WHERE id=? AND status='running'").run(
        e.message,
        id,
      );
    })
    .finally(() => {
      if (active === id) active = null;
    });
  return reply.code(202).send({ id });
});
app.post('/api/jobs/:id/cancel', async (req, reply) => {
  const id = (req.params as { id: string }).id;
  if (!owned(db, 'jobs', id, identity(req).id))
    return reply.code(404).send({ error: 'Generation not found.' });
  if (active !== id) return reply.code(409).send({ error: 'La generación ya no está activa' });
  db.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(id);
  worker.stop();
  return { ok: true };
});
app.get('/api/jobs/:id', async (req, reply) => {
  const id = z
    .string()
    .uuid()
    .parse((req.params as { id: string }).id);
  const job = db
    .prepare('SELECT id,status,error FROM jobs WHERE id=? AND user_id=?')
    .get(id, identity(req).id);
  return job || reply.code(404).send({ error: 'Generation not found.' });
});
app.get('/api/jobs/:id/motion', async (req, reply) => {
  const id = z
    .string()
    .uuid()
    .parse((req.params as { id: string }).id);
  const job = db
    .prepare('SELECT status FROM jobs WHERE id=? AND user_id=?')
    .get(id, identity(req).id) as { status: string } | undefined;
  if (job?.status !== 'completed')
    return reply.code(404).send({ error: 'Movimiento no disponible' });
  const motion = JSON.parse(await readFile(path.join(data, 'motions', id, 'motion.json'), 'utf8'));
  if (motion.generation?.video) Object.assign(motion.generation.video, videoProcessing(db, id));
  return {
    ...motion,
    generationId: id,
  };
});
if (existsSync(path.join(root, 'dist'))) {
  await app.register(statics, { root: path.join(root, 'dist') });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && /^\/(app|docs)\/?$/.test(req.url.split('?')[0]))
      return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Not found' });
  });
}
app.addHook('onClose', async () => {
  worker.stop();
  db.close();
});
process.on('SIGINT', () => {
  void app.close();
});
process.on('SIGTERM', () => {
  void app.close();
});
await app.listen({ host: '127.0.0.1', port: 8787 });
