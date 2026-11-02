import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { dclReferenceRig } from '../server/dcl-reference-rig';
import { videoReference } from './fixtures/video-reference';
import { somaHandLandmarks } from '../src/somahand';
import { newProject, type Motion, projectSchema } from '../src/motion';
import { world } from '../src/rig';
import { newTimeline } from '../src/timeline';

describe('stationary translation with original rotation', () => {
  it.each(['mediapipe+rtmw3d', 'sam3d-hybrid'] as const)(
    'preserves raw %s turns, wrists and vertical movement',
    (provider) => {
      const capture = videoReference(60, provider),
        rig = dclReferenceRig();
      capture.heading = Array.from({ length: 60 }, (_, f) => (f / 59) * Math.PI * 2);
      for (let f = 0; f < 60; f++) {
        const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), capture.heading[f]);
        for (let j = 0; j < 33; j++)
          new Vector3()
            .fromArray(capture.positions, f * 99 + j * 3)
            .applyQuaternion(q)
            .toArray(capture.positions, f * 99 + j * 3);
        for (const [side, offset] of [
          ['left', 0],
          ['right', 21],
        ] as const)
          somaHandLandmarks(side, Array(32).fill(0)).forEach((p, j) => {
            p.applyQuaternion(q).toArray(capture.details, f * 144 + (offset + j) * 3);
            capture.detailConfidence[f * 48 + offset + j] = 1;
          });
        capture.trajectory![f * 3 + 1] = f / 200;
      }
      for (const f of [0, 12, 29, 45, 59]) {
        rig.reset();
        rig.retargetCapture(capture, f / 30, 'source');
        const hips = world(rig.bone('Hips'));
        const rotations = [...rig.bones.values()].map((b) =>
          b.getWorldQuaternion(new Quaternion()).normalize(),
        );
        rig.reset();
        rig.retargetCapture(capture, f / 30, 'inPlace');
        [...rig.bones.values()].forEach((b, i) =>
          expect(
            b.getWorldQuaternion(new Quaternion()).normalize().angleTo(rotations[i]),
          ).toBeLessThan(1e-5),
        );
        expect(world(rig.bone('Hips')).y).toBeCloseTo(hips.y);
        expect(world(rig.bone('Hips')).x).toBeCloseTo(rig.initial('Hips').wp.x);
        expect(world(rig.bone('Hips')).z).toBeCloseTo(rig.initial('Hips').wp.z);
      }
      // Exercise the imported avatar's rotated/scaled armature through the
      // actual timeline, not just the direct retargeter.
      const project = newProject();
      project.preset = 'motion';
      project.motion = capture;
      project.duration = 2;
      project.controls.ground = false;
      project.controls.handIK = false;
      project.timeline = newTimeline(project);
      for (const f of [12, 29, 45]) {
        project.rootMotion = 'source';
        rig.evaluate(project, f / 30);
        const height = world(rig.bone('Hips')).y;
        const rotations = [...rig.bones.values()].map((b) =>
          b.getWorldQuaternion(new Quaternion()).normalize(),
        );
        project.rootMotion = 'inPlace';
        rig.evaluate(project, f / 30);
        expect(world(rig.bone('Hips')).y).toBeCloseTo(height, 5);
        expect(world(rig.bone('Hips')).x).toBeCloseTo(rig.initial('Hips').wp.x, 5);
        expect(world(rig.bone('Hips')).z).toBeCloseTo(rig.initial('Hips').wp.z, 5);
        [...rig.bones.values()].forEach((b, i) =>
          expect(
            b.getWorldQuaternion(new Quaternion()).normalize().angleTo(rotations[i]),
          ).toBeLessThan(1e-5),
        );
      }
    },
  );
  it('preserves generated global turns and supports independent orientation adjustments', () => {
    const rig = dclReferenceRig();
    const motion: Extract<Motion, { skeleton: 'soma30' }> = {
      version: 1,
      skeleton: 'soma30',
      source: 'kimodo.cpp',
      frames: 60,
      fps: 30,
      prompt: 'turn',
      seed: 1,
      roots: Array.from({ length: 60 }, (_, f) => [f / 60, 0.989 + f / 300, f / 100]).flat(),
      rotations: Array.from({ length: 60 }, (_, f) =>
        Array.from({ length: 30 }, (_, j) =>
          j
            ? [0, 0, 0, 1]
            : new Quaternion()
                .setFromAxisAngle(new Vector3(0, 1, 0), (f / 59) * Math.PI * 2)
                .toArray(),
        ).flat(),
      ).flat(),
    };
    for (const f of [12, 29, 45]) {
      rig.reset();
      rig.retarget(motion, f / 30, 'source');
      const source = rig.bone('Hips').getWorldQuaternion(new Quaternion());
      rig.reset();
      rig.retarget(motion, f / 30, 'inPlace');
      expect(rig.bone('Hips').getWorldQuaternion(new Quaternion()).angleTo(source)).toBeLessThan(
        1e-5,
      );
    }
    const p = newProject();
    p.preset = 'motion';
    p.motion = motion;
    p.controls.ground = false;
    p.controls.handIK = false;
    p.timeline = newTimeline(p);
    for (const time of [0.4, 0.95, 1.5]) {
      p.rootMotion = 'source';
      rig.evaluate(p, time);
      const sourceHeight = world(rig.bone('Hips')).y;
      const rotations = [...rig.bones.values()].map((b) =>
        b.getWorldQuaternion(new Quaternion()).normalize(),
      );
      p.rootMotion = 'inPlace';
      rig.evaluate(p, time);
      expect(world(rig.bone('Hips')).y).toBeCloseTo(sourceHeight, 5);
      expect(world(rig.bone('Hips')).x).toBeCloseTo(rig.initial('Hips').wp.x, 5);
      expect(world(rig.bone('Hips')).z).toBeCloseTo(rig.initial('Hips').wp.z, 5);
      [...rig.bones.values()].forEach((b, i) =>
        expect(
          b.getWorldQuaternion(new Quaternion()).normalize().angleTo(rotations[i]),
        ).toBeLessThan(1e-5),
      );
    }
    p.timeline = null;
    rig.evaluate(p, 1);
    const before = rig.capturePose(),
      hand = world(rig.bone('LeftHand'));
    p.controls.leftHandRotation = [0.3, 0.2, -0.1];
    rig.evaluate(p, 1);
    expect(
      rig.bone('LeftHand').quaternion.angleTo(before.get('Avatar_LeftHand')!.q),
    ).toBeGreaterThan(0.1);
    expect(world(rig.bone('LeftHand')).distanceTo(hand)).toBeLessThan(1e-5);
    expect(
      rig.bone('RightHand').quaternion.angleTo(before.get('Avatar_RightHand')!.q),
    ).toBeLessThan(1e-5);
    const old: any = structuredClone(p);
    delete old.controls.leftHandRotation;
    expect(projectSchema.parse(old).controls.leftHandRotation).toEqual([0, 0, 0]);
  });
});
