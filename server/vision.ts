import * as ort from 'onnxruntime-node';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { ProVisionWorker } from './pro-vision';
import { CAPTURE_DETAIL } from '../src/capture-landmarks';

// Matches RTMLib's RTMPose3d contract: BGR, ImageNet normalization, NCHW,
// SimCC split ratio 2. See THIRD_PARTY.md for the upstream reference.
export function decodeSimCC(
  outputs: { data: ArrayLike<number>; dims: readonly number[] }[],
  joints: readonly number[] = Array.from({ length: 133 }, (_, j) => j),
) {
  if (outputs.length !== 3 || outputs.some((o) => o.dims[1] !== 133))
    throw Error('Salida RTMW3D incompatible');
  const result: number[] = [];
  for (const joint of joints) {
    const axis = outputs.map((o) => {
      const width = o.dims[2];
      let at = 0,
        score = -Infinity;
      for (let i = 0; i < width; i++)
        if (o.data[joint * width + i] > score) {
          score = o.data[joint * width + i];
          at = i;
        }
      return { at: at / 2, score };
    });
    result.push(
      axis[0].at,
      axis[1].at,
      (axis[2].at / 192 - 1) * 2.1744869,
      Math.min(axis[0].score, axis[1].score),
    );
  }
  return result;
}

export function registerVision(app: FastifyInstance, root: string) {
  const model = path.join(root, 'data/models/vision/rtmw3d.onnx');
  const pro = new ProVisionWorker(root);
  let session: Promise<ort.InferenceSession> | null = null;
  let busy = false,
    proBusy = false;
  app.get('/api/video/status', async () => ({
    available:
      existsSync(model) && existsSync(path.join(root, 'public/models/pose_landmarker_full.task')),
    body: 'MediaPipe Pose Full',
    details: 'RTMW3D',
    device: 'cpu',
    busy,
    pro: { ...pro.status(), busy: proBusy },
  }));
  const jpegSchema = z.string().min(100).max(8_000_000);
  const calibrationSchema = z.object({
    fovX: z.number().min(10).max(160),
    fovY: z.number().min(10).max(160),
    focalX: z.number().positive(),
    focalY: z.number().positive(),
    source: z.literal('moge-2-vits'),
  });
  app.post('/api/video/calibrate', async (req, reply) => {
    if (!pro.status().mogeAvailable)
      return reply
        .code(503)
        .send({ error: 'MoGe-2 ViT-S is not installed. Run npm run setup:pro.' });
    if (proBusy) return reply.code(409).send({ error: 'Pro vision is processing another frame.' });
    const { jpeg } = z.object({ jpeg: jpegSchema }).parse(req.body);
    proBusy = true;
    try {
      return await pro.request({ op: 'calibrate', jpeg });
    } catch (error) {
      return reply.code(502).send({
        error: `Camera calibration failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      proBusy = false;
    }
  });
  app.post('/api/video/pro-frame', async (req, reply) => {
    if (!pro.status().samAvailable)
      return reply.code(503).send({
        error:
          'SAM 3D Body is not installed. Run npm run setup:pro after accepting its model license.',
      });
    if (proBusy) return reply.code(409).send({ error: 'Pro vision is processing another frame.' });
    const input = z
      .object({
        jpeg: jpegSchema,
        bbox: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]),
        calibration: calibrationSchema.optional(),
      })
      .parse(req.body);
    proBusy = true;
    try {
      // Retry this frame once with fresh model state, preserving all preceding
      // observations in the browser. Never substitute Fast output for Pro.
      try {
        return await pro.request({ op: 'sam', ...input });
      } catch (error) {
        req.log.warn({ err: error }, 'Restarting Pro worker for current frame');
        pro.stop();
        return await pro.request({ op: 'sam', ...input });
      }
    } catch (error) {
      return reply.code(502).send({
        error: `Pro frame failed after retry: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      proBusy = false;
    }
  });
  app.post('/api/video/frame', async (req, reply) => {
    if (!existsSync(model))
      return reply.code(503).send({ error: 'Falta data/models/vision/rtmw3d.onnx' });
    if (busy) return reply.code(409).send({ error: 'RTMW3D está procesando otro cuadro.' });
    const { rgb, bodyHands } = z
      .object({ rgb: z.string().length(442368), bodyHands: z.boolean().default(false) })
      .parse(req.body);
    const bytes = Buffer.from(rgb, 'base64');
    if (bytes.length !== 288 * 384 * 3) return reply.code(400).send({ error: 'Cuadro inválido' });
    busy = true;
    try {
      session ??= ort.InferenceSession.create(model, {
        executionProviders: ['cpu'],
        intraOpNumThreads: 4,
        interOpNumThreads: 1,
        graphOptimizationLevel: 'all',
      }).catch((e) => {
        session = null;
        throw e;
      });
      const runtime = await session;
      const input = new Float32Array(bytes.length),
        pixels = 288 * 384;
      const mean = [123.675, 116.28, 103.53],
        std = [58.395, 57.12, 57.375];
      for (let c = 0; c < 3; c++)
        for (let i = 0; i < pixels; i++)
          input[c * pixels + i] = (bytes[i * 3 + (2 - c)] - mean[c]) / std[c];
      const start = performance.now();
      const inputTensor = new ort.Tensor('float32', input, [1, 3, 384, 288]);
      try {
        const values = await runtime.run({ [runtime.inputNames[0]]: inputTensor });
        try {
          // Numeric object keys reorder in JS; outputNames is the model's actual axis order.
          const points = decodeSimCC(
            runtime.outputNames.map((name) => values[name] as ort.Tensor & { data: Float32Array }),
            bodyHands ? CAPTURE_DETAIL : undefined,
          );
          return {
            points,
            ...(bodyHands ? { layout: 'body-hands-v1' } : {}),
            milliseconds: performance.now() - start,
            provider: 'rtmw3d',
          };
        } finally {
          Object.values(values).forEach((value) => value.dispose());
        }
      } finally {
        inputTensor.dispose();
      }
    } finally {
      busy = false;
    }
  });
  const release = async () => {
    if (busy || proBusy) throw Error('Wait for tracking to finish before generating.');
    busy = proBusy = true;
    try {
      const child = pro.child;
      if (child) {
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        pro.stop();
        await exited;
      }
      const previous = session;
      session = null;
      if (previous) await (await previous).release();
    } finally {
      busy = proBusy = false;
    }
  };
  app.addHook('onClose', async () => {
    pro.stop();
    if (session) await (await session).release();
  });
  return { release };
}
