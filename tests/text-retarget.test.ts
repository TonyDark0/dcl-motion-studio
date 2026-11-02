import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { dclReferenceRig } from '../server/dcl-reference-rig';
import { world } from '../src/rig';
import { newProject, type Motion } from '../src/motion';
import { newTimeline } from '../src/timeline';
import examples from './fixtures/text-retarget-keys.json';

function motion(frames = 60): Extract<Motion, { skeleton: 'soma30' }> {
  return {
    version: 1,
    skeleton: 'soma30',
    source: 'kimodo.cpp',
    fps: 30,
    frames,
    prompt: 'retarget regression',
    seed: 1,
    roots: Array.from({ length: frames }, () => [0, 0.989, 0]).flat(),
    rotations: Array.from({ length: frames * 30 }, () => [0, 0, 0, 1]).flat(),
  };
}
function fromKeys(example: (typeof examples)[number]) {
  const m = motion(example.frames);
  for (let f = 0; f < m.frames; f++) {
    const a = [...example.keys].reverse().find((k) => k.frame <= f)!;
    const b = example.keys.find((k) => k.frame > f) || a;
    const u = a === b ? 0 : (f - a.frame) / (b.frame - a.frame);
    m.roots.splice(f * 3, 3, ...a.root.map((n, i) => n + (b.root[i] - n) * u));
    for (let j = 0; j < 30; j++)
      m.rotations.splice(
        f * 120 + j * 4,
        4,
        ...new Quaternion()
          .fromArray(a.rotations, j * 4)
          .normalize()
          .slerp(new Quaternion().fromArray(b.rotations, j * 4).normalize(), u)
          .toArray(),
      );
  }
  return m;
}
const clearance = (rig: ReturnType<typeof dclReferenceRig>) =>
  Math.min(
    ...['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map(
      (n) => world(rig.bone(n)).y - rig.initial(n).wp.y,
    ),
  );

describe('text motion neck chain and floor placement', () => {
  it('folds both neck rotations into DCL neck while retaining the complete head world rotation', () => {
    const rig = dclReferenceRig(),
      m = motion();
    const root = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.2);
    const neck1 = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.4);
    const neck2 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.25);
    const head = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -0.5);
    for (let f = 0; f < m.frames; f++)
      for (const [j, q] of [
        [0, root],
        [4, neck1],
        [5, neck2],
        [6, head],
      ] as const)
        m.rotations.splice(f * 120 + j * 4, 4, ...q.toArray());
    for (const mode of ['source', 'inPlace'] as const) {
      const p = newProject();
      p.motion = m;
      p.preset = 'motion';
      p.duration = 2;
      p.rootMotion = mode;
      p.timeline = newTimeline(p);
      rig.evaluate(p, 0.8);
      const neckWorld = root.clone().multiply(neck1).multiply(neck2);
      expect(
        rig
          .bone('Neck')
          .getWorldQuaternion(new Quaternion())
          .normalize()
          .angleTo(neckWorld.clone().multiply(rig.initial('Neck').wq).normalize()),
      ).toBeLessThan(1e-6);
      expect(
        rig
          .bone('Head')
          .getWorldQuaternion(new Quaternion())
          .normalize()
          .angleTo(neckWorld.multiply(head).multiply(rig.initial('Head').wq).normalize()),
      ).toBeLessThan(1e-6);
      expect(rig.bone('Head').position.distanceTo(rig.initial('Head').p)).toBeLessThan(1e-6);
    }
  });
  it.each(examples)(
    'keeps the supporting foot near the floor in the real $name capture without foot IK',
    (example) => {
      const rig = dclReferenceRig(),
        p = newProject();
      p.motion = fromKeys(example);
      p.preset = 'motion';
      p.duration = example.frames / 30;
      p.controls.ground = false;
      for (const mode of ['source', 'inPlace'] as const) {
        p.rootMotion = mode;
        p.timeline = newTimeline(p);
        const heights = [];
        for (let f = 0; f < example.frames; f++) {
          rig.evaluate(p, f / 30);
          heights.push(clearance(rig));
        }
        heights.sort((a, b) => a - b);
        expect(Math.abs(heights[Math.floor(heights.length / 2)])).toBeLessThan(0.015);
        expect(Math.max(...heights)).toBeLessThan(0.03);
        expect(Math.min(...heights)).toBeGreaterThan(-0.015);
      }
    },
  );
  it('preserves jump height, travel and turns, including clips that start airborne', () => {
    for (const initialHeight of [0, 0.4]) {
      const m = motion(),
        rig = dclReferenceRig();
      for (let f = 0; f < m.frames; f++) {
        m.roots.splice(f * 3, 3, f / 100, 0.989 + initialHeight + (f >= 30 ? 0.5 : 0), -f / 200);
        m.rotations.splice(
          f * 120,
          4,
          ...new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), f / 20).toArray(),
        );
      }
      for (const mode of ['source', 'inPlace'] as const) {
        rig.reset();
        rig.retarget(m, 0, mode);
        const start = world(rig.bone('Hips'));
        expect(clearance(rig)).toBeCloseTo(initialHeight / 0.989, 5);
        rig.reset();
        rig.retarget(m, 1, mode);
        const end = world(rig.bone('Hips'));
        expect(end.y - start.y).toBeCloseTo(0.5 / 0.989, 5);
        expect(end.x - start.x).toBeCloseTo(mode === 'source' ? 0.3 / 0.989 : 0, 5);
        expect(
          rig
            .bone('Hips')
            .getWorldQuaternion(new Quaternion())
            .normalize()
            .angleTo(
              new Quaternion()
                .setFromAxisAngle(new Vector3(0, 1, 0), 1.5)
                .multiply(rig.initial('Hips').wq),
            ),
        ).toBeLessThan(1e-6);
      }
    }
  });
});
