import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export const VIDEO_UPLOAD_LIMIT = 256 * 1024 * 1024;
const options = z.object({
  start: z.coerce.number().finite().min(0).max(86400),
  duration: z.coerce.number().finite().min(0.1).max(10),
  mode: z.enum(['fast', 'pro']),
});

export function videoEncodeArgs(
  input: string,
  output: string,
  start: number,
  duration: number,
  mode: 'fast' | 'pro',
) {
  const side = mode === 'pro' ? 1440 : 960;
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-protocol_whitelist',
    'file,pipe',
    '-threads',
    '2',
    '-ss',
    String(start),
    '-i',
    input,
    '-t',
    String(duration),
    '-map',
    '0:v:0',
    '-an',
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-vf',
    `scale=w='min(iw,${side})':h='min(ih,${side})':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    mode === 'pro' ? '18' : '21',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '2',
    '-filter_threads',
    '1',
    '-g',
    '15',
    '-movflags',
    '+faststart',
    '-fs',
    String(24 * 1024 * 1024),
    '-y',
    output,
  ];
}

function command(executable: string, args: string[], signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    let failure: Error | undefined;
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-65536);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.once('error', (error) => {
      failure = error;
    });
    // On cancellation wait for process exit before removing its open files (Windows).
    child.once('close', (code) =>
      failure
        ? reject(failure)
        : code === 0
          ? resolve(stdout)
          : reject(Error(`Video preparation failed: ${stderr || code}`)),
    );
  });
}

export function registerVideoMedia(
  app: FastifyInstance,
  root: string,
  settings: { temporaryRoot?: string } = {},
) {
  let busy = false;
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  // Passing the stream through avoids Fastify accumulating the uploaded source in RAM.
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) =>
    done(null, payload),
  );
  app.post('/api/media/prepare', { bodyLimit: VIDEO_UPLOAD_LIMIT }, async (request, reply) => {
    const parsed = options.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Choose a valid video segment of up to 10 seconds.' });
    if (request.headers['content-type'] !== 'application/octet-stream')
      return reply.code(415).send({ error: 'Upload a video file.' });
    if (Number(request.headers['content-length']) > VIDEO_UPLOAD_LIMIT)
      return reply.code(413).send({ error: 'Video exceeds the 256 MB upload limit.' });
    if (busy)
      return reply.code(409).send({ error: 'Another video is being prepared. Try again shortly.' });
    busy = true;
    let ownsEncoder = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    const disconnected = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    reply.raw.once('close', disconnected);
    let directory: string | undefined;
    try {
      const temp = settings.temporaryRoot || path.join(root, 'data', 'temp', 'video');
      await mkdir(temp, { recursive: true });
      directory = await mkdtemp(path.join(temp, 'prepare-'));
      const input = path.join(directory, 'source'),
        output = path.join(directory, 'prepared.mp4');
      let bytes = 0;
      const limit = new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          callback(
            bytes > VIDEO_UPLOAD_LIMIT ? Error('Video exceeds the 256 MB upload limit.') : null,
            chunk,
          );
        },
      });
      await pipeline(request.body as NodeJS.ReadableStream, limit, createWriteStream(input), {
        signal: controller.signal,
      });
      const probe = JSON.parse(
        await command(
          ffprobe,
          [
            '-v',
            'error',
            '-protocol_whitelist',
            'file,pipe',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=width,height:format=duration',
            '-of',
            'json',
            input,
          ],
          controller.signal,
        ),
      );
      const video = probe.streams?.[0];
      if (!video || video.width * video.height > 34000000 || video.width < 2 || video.height < 2)
        throw Error('Unsupported video dimensions.');
      const { start, duration, mode } = parsed.data;
      if (Number.isFinite(Number(probe.format?.duration)) && start >= Number(probe.format.duration))
        throw Error('The selected segment is outside the video.');
      await command(
        ffmpeg,
        videoEncodeArgs(input, output, start, duration, mode),
        controller.signal,
      );
      const size = (await stat(output)).size;
      const prepared = JSON.parse(
        await command(
          ffprobe,
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', output],
          controller.signal,
        ),
      );
      const expected = Math.min(duration, Number(probe.format?.duration) - start || duration);
      if (
        !size ||
        !Number.isFinite(Number(prepared.format?.duration)) ||
        Number(prepared.format?.duration) < expected - 0.1
      )
        throw Error('The prepared segment is incomplete. Choose a shorter video segment.');
      reply
        .header('Content-Type', 'video/mp4')
        .header('Content-Length', size)
        .header('Cache-Control', 'no-store');
      // Encoding is finished; a slow download must not block the next conversion.
      await rm(input, { force: true });
      busy = false;
      ownsEncoder = false;
      // Keep the temporary file until the response is completely transmitted.
      reply.hijack();
      for (const [key, value] of Object.entries(reply.getHeaders()))
        if (value !== undefined) reply.raw.setHeader(key, value);
      reply.raw.writeHead(200);
      await pipeline(createReadStream(output), reply.raw, { signal: controller.signal });
    } catch (error) {
      if (directory) {
        await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        directory = undefined;
      }
      if (ownsEncoder) {
        busy = false;
        ownsEncoder = false;
      }
      if (!reply.sent && !reply.raw.destroyed)
        reply.code(422).send({
          error:
            error instanceof Error && /ENOENT/.test(error.message)
              ? 'Install FFmpeg and FFprobe, then restart the app.'
              : String(error),
        });
    } finally {
      clearTimeout(timer);
      reply.raw.removeListener('close', disconnected);
      try {
        if (directory)
          await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } finally {
        if (ownsEncoder) busy = false;
      }
    }
  });
}
