import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

/** Connection evidence, with no video pixels, tracking arrays or prompts. */
export function registerVideoRequestLog(app: FastifyInstance, root: string) {
  const file = path.join(root, 'data/logs/video-requests.jsonl');
  function record(value: Record<string, unknown>) {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      if (existsSync(file) && statSync(file).size > 2_000_000) writeFileSync(file, '');
      appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), ...value }) + '\n');
    } catch {
      /* Logging must not interrupt capture. */
    }
  }
  const relevant = (url: string) =>
    /^\/api\/(video\/(frame|pro-frame|calibrate)|media\/prepare)(?:[?]|$)/.test(url);
  app.addHook('onRequest', async (req, reply) => {
    if (!relevant(req.url)) return;
    const capture = String(req.headers['x-capture-request'] || '').slice(0, 64);
    const base = { request: req.id, capture, route: req.url.split('?')[0] };
    record({ ...base, event: 'started' });
    reply.raw.once('close', () => {
      if (!reply.raw.writableFinished) record({ ...base, event: 'connection-closed' });
    });
  });
  app.addHook('onResponse', async (req, reply) => {
    if (relevant(req.url))
      record({
        request: req.id,
        route: req.url.split('?')[0],
        event: 'completed',
        status: reply.statusCode,
      });
  });
  app.addHook('onError', async (req, _reply, error) => {
    if (relevant(req.url))
      record({
        request: req.id,
        route: req.url.split('?')[0],
        event: 'error',
        error: error.message.slice(0, 500),
      });
  });
}
