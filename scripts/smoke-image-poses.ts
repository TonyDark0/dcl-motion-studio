import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Quaternion, Vector3 } from 'three';
import { KimodoWorker } from '../server/worker';
import { referenceRequestSchema } from '../src/pose-reference';
import { fitImagePose } from '../src/image-pose-solver';
import { forwardPose } from '../server/kimodo-constraints';

const input = JSON.parse(
  await readFile(process.argv[2] || 'data/validation/image-pose-request.json', 'utf8'),
);
const refs = referenceRequestSchema.parse(input.referencePoses);
refs.middle = structuredClone(refs.start);
for (const [shoulder, elbow, wrist, fingers, side] of [
  [11, 13, 15, [17, 19, 21], 1],
  [12, 14, 16, [18, 20, 22], -1],
] as const) {
  const s = refs.middle.world[shoulder],
    w = refs.middle.world[wrist];
  refs.middle.world[elbow] = [s[0] + 0.06 * side, s[1] + 0.27, s[2]];
  const target: [number, number, number] = [s[0] + 0.07 * side, s[1] + 0.52, s[2]];
  for (const i of fingers)
    refs.middle.world[i] = refs.middle.world[i].map((v, d) => v + target[d] - w[d]) as [
      number,
      number,
      number,
    ];
  refs.middle.world[wrist] = target;
}
const directory = path.resolve('data/validation', `image-constraints-${Date.now()}`);
await mkdir(directory, { recursive: true });
const worker = new KimodoWorker();
const started = performance.now();
try {
  const motion = await worker.generate(
    JSON.parse(await readFile('data/engine.json', 'utf8')),
    {
      prompt:
        'A person in a wide stance gently lowers both arms, then raises them out to the sides again.',
      frames: 90,
      steps: 30,
      seed: 81427,
      loop: true,
      rootMotion: 'inPlace',
      referencePoses: refs,
    },
    directory,
  );
  if (motion.skeleton !== 'soma30') throw Error('Unexpected output');
  const errors = [0, 45, 89].map((frame, index) => {
    const target = fitImagePose(index === 1 ? refs.middle! : refs.start);
    const rotations = Array.from({ length: 30 }, (_, j) => {
      const q = new Quaternion().fromArray(motion.rotations, (frame * 30 + j) * 4).normalize();
      if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      const s = Math.hypot(q.x, q.y, q.z),
        a = 2 * Math.atan2(s, q.w);
      return s < 1e-9 ? [0, 0, 0] : [(q.x * a) / s, (q.y * a) / s, (q.z * a) / s];
    });
    const actual = forwardPose(rotations, motion.roots.slice(frame * 3, frame * 3 + 3));
    const distances = actual.positions.map((p, j) =>
      p.distanceTo(new Vector3(...target.positions[j])),
    );
    return {
      frame,
      rmsMeters: Math.sqrt(distances.reduce((s, v) => s + v * v, 0) / 30),
      maxMeters: Math.max(...distances),
    };
  });
  const report = {
    directory,
    seconds: (performance.now() - started) / 1000,
    errors,
    note: 'One photo with edited intermediate arm landmarks. Raw native output before DCL retarget and loop finishing; not a general quality benchmark.',
  };
  await writeFile(path.join(directory, 'validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (errors.some((e) => e.rmsMeters > 0.15)) throw Error('Image anchor RMS error exceeds 15 cm');
} finally {
  worker.stop();
}
