import { describe, expect, it } from 'vitest';
import { videoEncodeArgs } from '../server/video-media';
import { samObservation } from '../src/sam-observation';
import Fastify from 'fastify';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerVideoMedia } from '../server/video-media';

describe('tracking video preparation', () => {
  it.each(['fast', 'pro'])(
    'prepares %s video using writable scratch even when the application root cannot contain data/temp',
    async (mode) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'dcl-video-regression-'));
      const root = path.join(directory, 'read-only-application-root');
      await writeFile(root, 'A file cannot contain a data/temp directory.');
      const app = Fastify();
      registerVideoMedia(app, root, { temporaryRoot: path.join(directory, 'scratch') });
      try {
        const source = execFileSync('ffmpeg', [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=64x64:rate=30',
          '-t',
          '2',
          '-an',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          'frag_keyframe+empty_moov',
          '-f',
          'mp4',
          'pipe:1',
        ]);
        const response = await app.inject({
          method: 'POST',
          url: `/api/media/prepare?start=0&duration=2&mode=${mode}`,
          headers: { 'content-type': 'application/octet-stream' },
          payload: source,
        });
        expect(response.statusCode, response.body.slice(0, 500)).toBe(200);
        expect(response.rawPayload.length).toBeGreaterThan(1000);
      } finally {
        await app.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
    20000,
  );
  it('trims before decoding, preserves web compatibility and higher Pro detail without upscaling', () => {
    const args = videoEncodeArgs('source', 'output', 3.5, 4, 'pro');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-t') + 1]).toBe('4');
    expect(args[args.indexOf('-vf') + 1]).toContain('min(iw,1440)');
    expect(args).toContain('libx264');
    expect(args).toContain('yuv420p');
    expect(args).toContain('+faststart');
    expect(args).toContain('-an');
    expect(args).toContain('file,pipe');
    expect(videoEncodeArgs('source', 'output', 0, 2, 'fast').join(' ')).toContain('min(iw,960)');
  });
  it('retains handedness, camera axes and hip-relative coordinates when Pro recovers a lost auxiliary tracker', () => {
    const keypoints3d = Array.from({ length: 70 }, (_, i) => [i * 0.02, i * 0.01, -0.1]).flat();
    const keypoints2d = Array.from({ length: 70 }, (_, i) => [0.2 + i * 0.005, 0.6]).flat();
    const { world, normalized } = samObservation({ keypoints3d, keypoints2d, score: 0.8 });
    expect((world[23].x + world[24].x) / 2).toBeCloseTo(0);
    expect(world[15].x).toBeCloseTo(keypoints3d[62 * 3] - 0.19);
    expect(world[16].x).toBeCloseTo(keypoints3d[41 * 3] - 0.19);
    expect(normalized[15].x).toBe(keypoints2d[62 * 2]);
    expect(world[1].visibility).toBe(0);
    expect(normalized[11].visibility).toBe(0.8);
  });
});
