import Fastify from 'fastify';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { registerVideoMedia } from '../server/video-media';

const root = path.resolve('data/validation');
const directory = await mkdtemp(path.join(root, 'media-check-'));
const app = Fastify({ forceCloseConnections: true });
registerVideoMedia(app, directory);
function run(executable: string, args: string[]) {
  const result = spawnSync(executable, args, { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout;
}
try {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = app.listeningOrigin + '/api/media/prepare';
  const source = path.join(directory, 'source.mp4');
  run(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1080x1920:rate=25',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440',
    '-t',
    '3',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '18',
    '-c:a',
    'aac',
    '-threads',
    '2',
    source,
  ]);
  const sourceBytes = await readFile(source);
  const results = [];
  for (const mode of ['fast', 'pro']) {
    const response = await fetch(`${url}?start=1&duration=2&mode=${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: sourceBytes,
    });
    assert.equal(
      response.status,
      200,
      await (response.status === 200 ? Promise.resolve('') : response.text()),
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    const output = path.join(directory, mode + '.mp4');
    await writeFile(output, bytes);
    const probe = JSON.parse(
      run(process.env.FFPROBE_PATH || 'ffprobe', [
        '-v',
        'error',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        output,
      ]),
    );
    assert.equal(probe.streams.length, 1);
    assert.equal(probe.streams[0].codec_name, 'h264');
    assert.equal(probe.streams[0].r_frame_rate, '30/1');
    assert.equal(probe.streams[0].height, mode === 'pro' ? 1440 : 960);
    assert.ok(Math.abs(Number(probe.format.duration) - 2) < 0.05);
    results.push({
      mode,
      sourceBytes: sourceBytes.length,
      preparedBytes: bytes.length,
      width: probe.streams[0].width,
      height: probe.streams[0].height,
      frames: probe.streams[0].nb_frames,
    });
  }
  assert.equal(
    (
      await fetch(`${url}?start=0&duration=11&mode=fast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: sourceBytes,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${url}?start=0&duration=2&mode=pro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: 'invalid video',
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/media/prepare?start=0&duration=2&mode=fast',
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(256 * 1024 * 1024 + 1),
        },
        payload: Buffer.from('test'),
      })
    ).statusCode,
    413,
  );
  // Cancel during upload/encoding and verify that Windows file handles are closed.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 100);
  await assert.rejects(
    fetch(`${url}?start=0&duration=3&mode=pro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: sourceBytes,
      signal: controller.signal,
    }),
  );
  clearTimeout(abortTimer);
  // Response delivery precedes asynchronous disk cleanup by a few milliseconds.
  for (let i = 0; i < 120 && (await readdir(path.join(directory, 'data/temp/video'))).length; i++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(await readdir(path.join(directory, 'data/temp/video')), []);
  await writeFile(path.join(root, 'video-media-check.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
