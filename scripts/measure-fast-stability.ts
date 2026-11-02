import { readFile, writeFile } from 'node:fs/promises';
import { Quaternion } from 'three';
import { dclReferenceRig } from '../server/dcl-reference-rig';
import { capturedFootSupport } from '../src/video-grounding';
import { referenceFrames } from '../src/pose-sampling';
import { stabilizeHandKeys } from '../src/timeline-evaluator';
import { world } from '../src/rig';
import type { Capture } from '../src/video-motion';
import type { Motion } from '../src/motion';

for (const mode of ['fast', 'pro']) {
  const folder = `data/validation/infill-${mode}/`;
  const capture: Capture = JSON.parse(await readFile(folder + 'capture.json', 'utf8'));
  const motion: Motion = JSON.parse(await readFile(folder + 'motion.json', 'utf8'));
  const rig = dclReferenceRig(),
    support = capturedFootSupport(capture);
  const supported: number[] = [],
    penetration: number[] = [];
  for (let f = 0; f < motion.frames; f++) {
    rig.reset();
    rig.retarget(motion, f / 30, 'source');
    ['Left', 'Right'].forEach((side, s) => {
      const gap = Math.min(
        ...['Foot', 'ToeBase'].map(
          (part) => world(rig.bone(side + part)).y - rig.initial(side + part).wp.y,
        ),
      );
      penetration.push(Math.min(0, gap));
      if (support[s][f] >= 0.999) supported.push(Math.abs(gap));
    });
  }
  const keys = referenceFrames(capture.frames).map((f) => {
    rig.reset();
    rig.retarget(motion, f / 30, 'source');
    rig.applyHandReference(capture, f / 30, 1, 'source');
    return rig.capturePose();
  });
  stabilizeHandKeys(keys);
  const angles = keys.flatMap((pose) =>
    ['Left', 'Right'].map((side) =>
      pose.get('Avatar_' + side + 'Hand')!.q.angleTo(rig.initial(side + 'Hand').q),
    ),
  );
  const stats = {
    mode,
    frames: motion.frames,
    supportSamples: supported.length,
    maximumSupportGapMm: Math.max(...supported) * 1000,
    meanSupportGapMm: (supported.reduce((a, b) => a + b, 0) / supported.length) * 1000,
    penetrationMm: Math.min(...penetration) * 1000,
    maxWristFromBindDegrees: (Math.max(...angles) * 180) / Math.PI,
    finiteHands: keys.every((pose) =>
      [...pose.values()].every((b) => b.q.toArray().every(Number.isFinite)),
    ),
  };
  await writeFile(folder + 'stability-check.json', JSON.stringify(stats, null, 2));
  console.log(stats);
}
