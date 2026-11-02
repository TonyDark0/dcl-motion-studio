import { readFileSync, readdirSync } from 'node:fs';
import { Quaternion } from 'three';
import { dclReferenceRig } from '../server/dcl-reference-rig';
import { world } from '../src/rig';
const rig = dclReferenceRig();
for (const name of ['Hips', 'Spine2', 'Neck', 'Head', 'LeftFoot', 'LeftToeBase'])
  console.log(
    name,
    'position',
    rig.initial(name).wp.toArray(),
    'world rotation',
    rig.initial(name).wq.toArray(),
  );
for (const file of readdirSync('data/landing-work/plain-v2')) {
  const m = JSON.parse(readFileSync('data/landing-work/plain-v2/' + file, 'utf8')).motion;
  const min: number[] = [],
    neck: number[][] = [[], [], []];
  for (let f = 0; f < m.frames; f++) {
    rig.reset();
    rig.retarget(m, f / m.fps, 'source');
    min.push(
      Math.min(
        ...['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map(
          (n) => world(rig.bone(n)).y - rig.initial(n).wp.y,
        ),
      ),
    );
    for (let j = 4; j <= 6; j++)
      neck[j - 4].push(
        (new Quaternion().fromArray(m.rotations, f * 120 + j * 4).angleTo(new Quaternion()) * 180) /
          Math.PI,
      );
  }
  console.log(
    file,
    JSON.stringify({
      root0: m.roots.slice(0, 3),
      rootY: [
        Math.min(...m.roots.filter((_: number, i: number) => i % 3 === 1)),
        Math.max(...m.roots.filter((_: number, i: number) => i % 3 === 1)),
      ],
      footClearance: [
        Math.min(...min),
        [...min].sort((a, b) => a - b)[Math.floor(min.length * 0.5)],
        Math.max(...min),
      ],
      neckLocalMax: neck.map((a) => Math.max(...a)),
    }),
  );
}
