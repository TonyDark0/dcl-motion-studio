import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KimodoWorker, type EngineConfig } from '../server/worker';
import { constraintCapability } from '../server/engine-capabilities';
import { Quaternion } from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config: EngineConfig = JSON.parse(
  await readFile(path.join(root, 'data/engine.json'), 'utf8'),
);
config.executable = path.join(root, 'data/bin/kimodo-constraints/kmd-generate.exe');
config.device = 'cpu';
const capability = await constraintCapability(config.executable, true);
if (capability.status !== 'ready') throw Error(JSON.stringify(capability));
const directory = path.join(root, 'data/validation', `constraints-${Date.now()}`);
await mkdir(directory, { recursive: true });
const worker = new KimodoWorker();
const steps = Number(process.argv[2] ?? 30);
if (!Number.isInteger(steps) || steps < 5 || steps > 100) throw Error('Steps must be 5..100');
const started = performance.now();
console.log(`Generating a two-second native loop, two passes, ${steps} steps per pass…`);
try {
  const motion = await worker.generate(
    config,
    {
      prompt: 'A person waves hello with their right hand, standing in place.',
      frames: 60,
      steps,
      seed: 71347,
      loop: true,
      rootMotion: 'inPlace',
    },
    directory,
  );
  if (motion.skeleton !== 'soma30') throw Error('Unexpected skeleton');
  const last = motion.frames - 1;
  const angularErrors = Array.from({ length: 30 }, (_, j) =>
    new Quaternion()
      .fromArray(motion.rotations, j * 4)
      .normalize()
      .angleTo(new Quaternion().fromArray(motion.rotations, (last * 30 + j) * 4).normalize()),
  );
  const report = {
    directory,
    elapsedSeconds: (performance.now() - started) / 1000,
    frames: motion.frames,
    steps,
    conditioning: motion.generation,
    rawRootEndpointDistance: Math.hypot(
      ...motion.roots.slice(0, 3).map((v, i) => v - motion.roots[last * 3 + i]),
    ),
    rawMaxJointEndpointAngleDegrees: (Math.max(...angularErrors) * 180) / Math.PI,
    note: 'Raw native outputs, before retarget, NLA seam blending and foot IK. One prompt/seed is not a general quality benchmark.',
  };
  await writeFile(path.join(directory, 'validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  worker.stop();
}
