import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { identity, owned } from './studio-database';

export function videoProcessing(db: DatabaseSync, id: string) {
  const row = db.prepare('SELECT * FROM video_processing WHERE generation_id=?').get(id) as
    | { capture_ms: number; generation_ms: number; total_ms: number; reference_ready: number }
    | undefined;
  return row
    ? {
        processing: {
          captureMs: row.capture_ms,
          generationMs: row.generation_ms,
          totalMs: row.total_ms,
        },
        referenceAvailable: !!row.reference_ready,
      }
    : null;
}
export function finishVideoProcessing(db: DatabaseSync, id: string, elapsedMs: number) {
  db.prepare(
    'UPDATE video_processing SET generation_ms=?,total_ms=capture_ms+? WHERE generation_id=?',
  ).run(elapsedMs, elapsedMs, id);
}

/** Store only the prepared, silent, <=10 second web clip, privately under the owned generation. */
export function registerVideoResults(app: FastifyInstance, db: DatabaseSync, data: string) {
  const limitBytes = 24 * 1024 * 1024;
  app.post('/api/jobs/:id/reference-video', { bodyLimit: limitBytes }, async (req, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    if (!owned(db, 'generations', id, identity(req).id) || !videoProcessing(db, id))
      return reply.code(404).send({ error: 'Video generation not found.' });
    if (db.prepare('SELECT status FROM jobs WHERE id=?').get(id)?.status !== 'completed')
      return reply.code(409).send({ error: 'Wait for generation to finish.' });
    if (req.headers['content-type'] !== 'application/octet-stream')
      return reply.code(415).send({ error: 'Upload the prepared video.' });
    const directory = path.join(data, 'motions', id),
      temporary = path.join(directory, `reference-${randomUUID()}.tmp`),
      target = path.join(directory, 'reference.mp4');
    let bytes = 0;
    try {
      const limit = new Transform({
        transform(chunk, _encoding, done) {
          bytes += chunk.length;
          done(bytes > limitBytes ? Error('Reference video exceeds 24 MB.') : null, chunk);
        },
      });
      await pipeline(req.body as NodeJS.ReadableStream, limit, createWriteStream(temporary));
      const file = await open(temporary, 'r');
      try {
        const header = Buffer.alloc(12);
        await file.read(header, 0, 12, 0);
        if (bytes < 12 || header.toString('ascii', 4, 8) !== 'ftyp')
          return reply.code(400).send({ error: 'Invalid prepared video.' });
      } finally {
        await file.close();
      }
      const { stdout } = await promisify(execFile)(
        process.env.FFPROBE_PATH || 'ffprobe',
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-show_entries',
          'stream=codec_type,codec_name,width,height:format=duration',
          '-of',
          'json',
          temporary,
        ],
        { windowsHide: true, timeout: 10000, maxBuffer: 65536 },
      );
      const probe = JSON.parse(stdout),
        video = probe.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
      if (
        !video ||
        video.codec_name !== 'h264' ||
        Math.max(video.width, video.height) > 1440 ||
        probe.streams.length !== 1 ||
        !(Number(probe.format.duration) > 0 && Number(probe.format.duration) <= 10.1)
      )
        return reply.code(400).send({ error: 'Use the prepared web video segment.' });
      await rename(temporary, target);
      db.prepare('UPDATE video_processing SET reference_ready=1 WHERE generation_id=?').run(id);
      return { ok: true };
    } finally {
      await rm(temporary, { force: true });
    }
  });
  app.get('/api/jobs/:id/reference-video', async (req, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    if (
      !owned(db, 'generations', id, identity(req).id) ||
      !videoProcessing(db, id)?.referenceAvailable
    )
      return reply.code(404).send({ error: 'Reference video not found.' });
    const file = path.join(data, 'motions', id, 'reference.mp4'),
      size = (await stat(file)).size;
    let start = 0,
      end = size - 1;
    if (req.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (!match || Number(match[1]) >= size || (match[2] && Number(match[2]) < Number(match[1])))
        return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), end) : end;
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    return reply
      .header('Content-Type', 'video/mp4')
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', end - start + 1)
      .send(createReadStream(file, { start, end }));
  });
}
