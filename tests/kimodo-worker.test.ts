import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock('node:child_process', () => mocks);
import { KimodoWorker, type EngineConfig } from '../server/worker';
import { clearCapabilityCache, constraintCapability } from '../server/engine-capabilities';
import { videoReference } from './fixtures/video-reference';
import { standingPose } from './fixtures/image-pose';

let directory: string;
const config: EngineConfig = {
  executable: process.execPath,
  model: process.execPath,
  text: process.execPath,
  device: 'cpu',
};
beforeEach(async () => {
  clearCapabilityCache();
  directory = await mkdtemp(path.join(os.tmpdir(), 'studio-constraints-test-'));
  mocks.spawn.mockReset();
  mocks.execFile.mockReset();
  // Emulate execFile's custom promisified result (stdout/stderr object).
  mocks.execFile.mockImplementation((_p, _a, _o, done) =>
    done(null, {
      stdout: JSON.stringify({ constraints: 'soma30-v1', protocol: 'C1' }),
      stderr: '',
    }),
  );
});
afterEach(async () => {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('studio-constraints-test-')
  )
    throw Error('Unsafe test cleanup');
  await rm(resolved, { recursive: true, force: true });
});

function fakeEngine(afterRequest?: () => void) {
  const requests: string[][] = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    stdin: {
      write: (line: string, done: (error?: Error) => void) => {
        const fields = line.trim().split('\t');
        requests.push(fields);
        const frames = Number(fields[4]),
          directory = fields[3];
        const floats = (values: number[]) => {
          const buffer = Buffer.alloc(values.length * 4);
          values.forEach((v, i) => buffer.writeFloatLE(v, i * 4));
          return buffer;
        };
        void Promise.all([
          writeFile(
            path.join(directory, 'root_positions.f32'),
            floats(Array.from({ length: frames * 3 }, (_, i) => (i % 3 === 1 ? 1 : 0))),
          ),
          writeFile(
            path.join(directory, 'local_rotations_xyzw.f32'),
            floats(Array.from({ length: frames * 30 * 4 }, (_, i) => (i % 4 === 3 ? 1 : 0))),
          ),
        ])
          .then(() => {
            done();
            child.stdout.write(`OK\t${frames}\t30\n`);
            afterRequest?.();
          })
          .catch(done);
        return true;
      },
    },
  });
  mocks.spawn.mockReturnValue(child);
  return { requests, child };
}

describe('Kimodo loop orchestration (mock native transport)', () => {
  it('ignores legacy style selection and sends only the authored prompt', async () => {
    fakeEngine();
    const worker = new KimodoWorker();
    try {
      const motion = await worker.generate(
        config,
        {
          prompt: 'A person waves hello',
          emoteStyle: 'celebration',
          frames: 60,
          seed: 8,
          steps: 5,
        },
        directory,
      );
      expect(await readFile(path.join(directory, 'prompt.txt'), 'utf8')).toBe(
        'A person waves hello',
      );
      expect(motion.skeleton).toBe('soma30');
      if (motion.skeleton === 'soma30') expect(motion.prompt).toBe('A person waves hello');
    } finally {
      worker.stop();
    }
  });
  it('conditions directly from image poses in one pass while preserving loop metadata', async () => {
    const { requests } = fakeEngine();
    const worker = new KimodoWorker();
    try {
      const motion = await worker.generate(
        config,
        {
          prompt: 'Raise one arm and return',
          frames: 60,
          seed: 4,
          steps: 5,
          loop: true,
          referencePoses: {
            start: standingPose(),
            middle: standingPose(true),
            end: standingPose(),
            middleTime: 0.5,
          },
        },
        directory,
      );
      expect(requests.map((r) => r[0])).toEqual(['C1']);
      expect(motion.skeleton === 'soma30' && motion.generation?.loop).toBe(true);
      const constraints = JSON.parse(
        await readFile(path.join(directory, 'constraints.json'), 'utf8'),
      );
      expect(constraints[0].frame_indices).toEqual([0, 30, 59]);
    } finally {
      worker.stop();
    }
  });
  it('reports launch failures and allows immediate rechecking without modifying the binary', async () => {
    mocks.execFile.mockImplementationOnce((_p, _a, _o, done) =>
      done(Object.assign(new Error('Application control blocked launch'), { code: 'EACCES' })),
    );
    expect((await constraintCapability(config.executable)).status).toBe('unavailable');
    expect((await constraintCapability(config.executable)).status).toBe('unavailable');
    expect((await constraintCapability(config.executable, true)).status).toBe('ready');
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
  });
  it('distinguishes an older engine from a missing executable', async () => {
    mocks.execFile.mockImplementationOnce((_p, _a, _o, done) =>
      done(
        Object.assign(new Error('usage'), {
          code: 2,
          stderr: 'usage: kmd-generate MODEL TEXT ...',
        }),
      ),
    );
    expect((await constraintCapability(config.executable)).status).toBe('unsupported');
    expect((await constraintCapability(path.join(directory, 'missing.exe'))).status).toBe(
      'missing',
    );
  });
  it('rejects a loop without a reviewed start pose before running the engine', async () => {
    const { requests } = fakeEngine();
    const worker = new KimodoWorker();
    await expect(
      worker.generate(
        config,
        { prompt: 'wave', frames: 60, seed: 1, steps: 5, loop: true },
        directory,
      ),
    ).rejects.toThrow(/requires a reviewed start image pose/);
    expect(requests).toHaveLength(0);
  });
  it('does not save a cancelled pose-conditioned loop', async () => {
    const worker = new KimodoWorker();
    const { requests } = fakeEngine(() => worker.stop());
    await expect(
      worker.generate(
        config,
        {
          prompt: 'wave',
          frames: 60,
          seed: 2,
          steps: 5,
          loop: true,
          referencePoses: { start: standingPose(), end: standingPose(), middleTime: 0.5 },
        },
        directory,
      ),
    ).rejects.toThrow(/cancelled/);
    expect(requests).toHaveLength(1);
    await expect(access(path.join(directory, 'motion.json'))).rejects.toThrow();
  });
  it.each(['mediapipe+rtmw3d', 'sam3d-hybrid'] as const)(
    'sends sparse %s video poses through the native C1 protocol in one pass',
    async (provider) => {
      const worker = new KimodoWorker();
      const { requests } = fakeEngine();
      try {
        const motion = await worker.generate(
          config,
          {
            prompt: 'Follow the reviewed video',
            frames: 300,
            seed: 7,
            steps: 5,
            rootMotion: 'source',
            videoReference: videoReference(300, provider),
          },
          directory,
        );
        expect(requests).toHaveLength(1);
        expect(requests[0][0]).toBe('C1');
        const constraints = JSON.parse(
          await readFile(path.join(directory, 'constraints.json'), 'utf8'),
        );
        expect(constraints[0].frame_indices).toHaveLength(31);
        expect(constraints[0].frame_indices.at(-1)).toBe(299);
        expect(motion.skeleton === 'soma30' && motion.generation?.video?.provider).toBe(provider);
        expect(motion.skeleton === 'soma30' && motion.generation?.video?.cleanup?.version).toBe(
          'dcl-ground-smooth-v1',
        );
        const saved = JSON.parse(await readFile(path.join(directory, 'motion.json'), 'utf8'));
        expect(saved.generation.video.cleanup.version).toBe('dcl-ground-smooth-v1');
        const mask = await readFile(path.join(directory, 'mask.f32'));
        expect(mask.length).toBe(300 * 369 * 4);
        expect(mask.readFloatLE((10 * 369 + 5) * 4)).toBe(1);
        expect(mask.readFloatLE((11 * 369 + 5) * 4)).toBe(0);
      } finally {
        worker.stop();
      }
    },
  );
  it('preserves the legacy one-pass protocol without constraints', async () => {
    const worker = new KimodoWorker();
    const { requests } = fakeEngine();
    try {
      await worker.generate(config, { prompt: 'wave', frames: 60, seed: 3, steps: 5 }, directory);
      expect(requests).toHaveLength(1);
      expect(requests[0][0]).toBe('1');
    } finally {
      worker.stop();
    }
  });
});
