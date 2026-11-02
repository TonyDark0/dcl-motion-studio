import { it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { migrateStudio, identities, sessionIdentity, identity } from '../server/studio-database';
import {
  registerVideoResults,
  videoProcessing,
  finishVideoProcessing,
} from '../server/video-results';

it('persists capture/generation times and privately streams the prepared reference with seek ranges', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dcl-video-result-'));
  const db = new DatabaseSync(':memory:');
  migrateStudio(db);
  const app = Fastify();
  app.addContentTypeParser('application/octet-stream', (_req, stream, done) => done(null, stream));
  app.addHook('onRequest', async (req, reply) => {
    identities.set(req, sessionIdentity(db, req, reply));
  });
  app.get('/who', async (req) => identity(req));
  registerVideoResults(app, db, directory);
  try {
    const a = await app.inject('/who'),
      b = await app.inject('/who');
    const cookie = String(a.headers['set-cookie']).split(';')[0],
      other = String(b.headers['set-cookie']).split(';')[0];
    const id = randomUUID(),
      now = new Date().toISOString();
    db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?)').run(
      id,
      'Video',
      'completed',
      null,
      now,
      a.json().id,
    );
    db.prepare('INSERT INTO generations VALUES(?,?,?,?,?,?,?,?,?)').run(
      id,
      a.json().id,
      'video',
      'sam3d-hybrid',
      '{}',
      '{}',
      now,
      'hash',
      now,
    );
    db.prepare('INSERT INTO video_processing(generation_id,capture_ms) VALUES(?,?)').run(id, 1400);
    finishVideoProcessing(db, id, 2400);
    expect(videoProcessing(db, id)?.processing).toEqual({
      captureMs: 1400,
      generationMs: 2400,
      totalMs: 3800,
    });
    await mkdir(path.join(directory, 'motions', id), { recursive: true });
    const encoded = spawnSync(
      process.env.FFMPEG_PATH || 'ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=size=64x96:rate=30',
        '-t',
        '0.2',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-movflags',
        'frag_keyframe+empty_moov',
        '-f',
        'mp4',
        'pipe:1',
      ],
      { windowsHide: true },
    );
    expect(encoded.status).toBe(0);
    const url = `/api/jobs/${id}/reference-video`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { cookie, 'content-type': 'application/octet-stream' },
          payload: encoded.stdout,
        })
      ).statusCode,
    ).toBe(200);
    expect(videoProcessing(db, id)?.referenceAvailable).toBe(true);
    const range = await app.inject({ url, headers: { cookie, range: 'bytes=5-15' } });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload).toEqual(encoded.stdout.subarray(5, 16));
    expect((await app.inject({ url, headers: { cookie: other } })).statusCode).toBe(404);
    expect(
      (await app.inject({ url, headers: { cookie, range: 'bytes=999999-' } })).statusCode,
    ).toBe(416);
    db.prepare('DELETE FROM jobs WHERE id=?').run(id);
    expect(videoProcessing(db, id)).toBeNull();
  } finally {
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
