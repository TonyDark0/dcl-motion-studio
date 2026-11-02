import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { videoReference } from './fixtures/video-reference';
import { standingPose } from './fixtures/image-pose';
import { compileCapture } from '../src/video-motion';
import { repairVideoReferences } from '../server/video-reference-repair';
import { videoPoseConstraints } from '../server/video-pose-constraints';
import { postprocessVideoMotion, smoothGeneratedMotion } from '../server/video-postprocess';
import { capturedFootLift, capturedFootSupport } from '../src/video-grounding';
import { dclReferenceRig } from '../server/dcl-reference-rig';
import { world } from '../src/rig';
import type { Motion } from '../src/motion';

function generated(): Extract<Motion, { skeleton: 'soma30' }> {
  return {
    version: 1,
    skeleton: 'soma30',
    source: 'kimodo.cpp',
    fps: 30,
    frames: 60,
    seed: 2,
    prompt: 'fixture',
    rotations: Array.from({ length: 60 * 30 }, () => [0, 0, 0, 1]).flat(),
    roots: Array.from({ length: 60 }, (_, f) => [
      f / 150,
      1.2 + (f % 2 ? 0.015 : -0.015),
      0,
    ]).flat(),
    generation: {
      conditioning: 'soma30-v1',
      loop: false,
      rootMotion: 'source',
      video: {
        provider: 'mediapipe+rtmw3d',
        poseStride: 10,
        file: 'test',
        rootSpace: 'camera-y-up-v2',
      },
    },
  };
}
function clearances(m: ReturnType<typeof generated>) {
  const rig = dclReferenceRig();
  return Array.from({ length: m.frames }, (_, f) => {
    rig.reset();
    rig.retarget(m, f / 30, 'source');
    return Math.min(
      ...['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase'].map(
        (name) => world(rig.bone(name)).y - rig.initial(name).wp.y,
      ),
    );
  });
}
describe('video reference recovery and baked floor cleanup', () => {
  it('calibrates raw preview height and releases a raised foot instead of locking both legs', () => {
    const capture = videoReference(), rig = dclReferenceRig();
    capture.metadata.groundingVersion = 'foot-support-v1';
    capture.trajectory = Array.from({length:60}, () => [0, 0.3, 0]).flat();
    for (let f = 0; f < 60; f++)
      for (const joint of [27, 29, 31]) capture.positions[f * 99 + joint * 3 + 1] += 0.25;
    const support = capturedFootSupport(capture);
    expect(support[0].every(w => w === 0)).toBe(true);
    expect(support[1].every(w => w === 1)).toBe(true);
    for (const frame of [0, 20, 59, 20]) {
      rig.reset(); rig.retargetCapture(capture, frame / 30, 'source');
      const floor = Math.min(...['LeftFoot','LeftToeBase','RightFoot','RightToeBase'].map(name =>
        world(rig.bone(name)).y - rig.initial(name).wp.y));
      expect(Math.abs(floor)).toBeLessThan(1e-6);
    }
  });
  it('repairs brief initial/final and interior gaps without mutating raw evidence or bridging long occlusions', () => {
    const capture = videoReference();
    for (const f of [0, 1, 2, 29, 30, 58, 59]) capture.confidence[f * 33 + 27] = 0.05;
    const repaired = repairVideoReferences(capture);
    expect(repaired.confidence[27]).toBeGreaterThanOrEqual(0.35);
    expect(capture.confidence[27]).toBe(0.05);
    expect(() => videoPoseConstraints(capture, 60)).not.toThrow();
    for (let f = 0; f < 20; f++) capture.confidence[f * 33 + 27] = 0.05;
    expect(() => videoPoseConstraints(capture, 60)).toThrow(/left ankle/);
  });
  it('keeps reliable MediaPipe wrists/ankles when RTMW is weak, including frame zero', () => {
    const pose = standingPose();
    const raw = [0, 1.99].map((time) => ({
      time,
      body: pose.world.flatMap((p, j) => [...p, pose.confidence[j]]),
      detail: Array.from({ length: 133 }, () => [144, 192, 0, 0.08]).flat(),
    }));
    const capture = compileCapture(raw, 2, 'weak-rtmw.mp4', 0);
    for (const joint of [15, 16, 27, 28])
      expect(capture.confidence[joint]).toBeGreaterThanOrEqual(0.35);
    expect(() => videoPoseConstraints(capture, 60)).not.toThrow();
  });
  it('removes stationary float and vertical jitter on the DCL rig without enabling UI foot correction', () => {
    const capture = videoReference(),
      motion = generated();
    capture.trajectory = Array.from({ length: 60 }, (_, f) => [
      f / 150,
      f % 2 ? 0.008 : -0.008,
      0,
    ]).flat();
    expect(Math.min(...clearances(motion))).toBeGreaterThan(0.1);
    const report = postprocessVideoMotion(motion, capture);
    expect(report.airborneFrames).toBe(0);
    expect(Math.max(...clearances(motion).map(Math.abs))).toBeLessThan(0.002);
    expect(motion.roots.at(-3)).toBeCloseTo(59 / 150);
    expect(motion.rotations.every(Number.isFinite)).toBe(true);
  });
  it('preserves sustained take-off and landing while rejecting an isolated foot spike', () => {
    const capture = videoReference(),
      motion = generated();
    const jump = Array.from({ length: 60 }, (_, f) =>
      f >= 18 && f <= 42 ? Math.sin(((f - 18) / 24) * Math.PI) * 0.45 : 0,
    );
    capture.trajectory = jump.flatMap((y) => [0, y, 0]);
    expect(Math.max(...capturedFootLift(capture))).toBeGreaterThan(0.4);
    postprocessVideoMotion(motion, capture);
    const feet = clearances(motion);
    expect(feet[30]).toBeGreaterThan(0.35);
    expect(Math.abs(feet[0])).toBeLessThan(0.002);
    expect(Math.abs(feet[59])).toBeLessThan(0.002);
    capture.trajectory = Array(180).fill(0);
    capture.trajectory[30 * 3 + 1] = 0.5;
    expect(Math.max(...capturedFootLift(capture))).toBe(0);
  });
  it('grounds both captured support feet even when only one generated foot initially touches', () => {
    const capture = videoReference(),
      motion = generated(),
      rig = dclReferenceRig();
    capture.trajectory = Array(180).fill(0);
    for (let f = 0; f < motion.frames; f++)
      new Quaternion()
        .setFromAxisAngle(new Vector3(1, 0, 0), 0.5)
        .toArray(motion.rotations, f * 120 + 23 * 4);
    postprocessVideoMotion(motion, capture);
    for (let f = 0; f < motion.frames; f++) {
      rig.reset();
      rig.retarget(motion, f / 30, 'source');
      for (const side of ['Left', 'Right']) {
        const clearance = Math.min(
          ...['Foot', 'ToeBase'].map(
            (part) => world(rig.bone(side + part)).y - rig.initial(side + part).wp.y,
          ),
        );
        expect(Math.abs(clearance)).toBeLessThan(0.003);
      }
    }
  });
  it('smooths quaternion jitter across sign flips without shrinking travel or delaying endpoints', () => {
    const motion = generated();
    for (let f = 0; f < 60; f++) {
      const q = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        f * 0.012 + (f % 2 ? 0.05 : -0.05),
      );
      if (f % 3 === 0) q.set(-q.x, -q.y, -q.z, -q.w);
      q.toArray(motion.rotations, f * 120 + 11 * 4);
    }
    const first = motion.rotations.slice(44, 48),
      last = motion.rotations.slice(59 * 120 + 44, 59 * 120 + 48);
    const roughness = () =>
      Array.from({ length: 59 }, (_, f) =>
        new Quaternion()
          .fromArray(motion.rotations, f * 120 + 44)
          .angleTo(new Quaternion().fromArray(motion.rotations, (f + 1) * 120 + 44)),
      ).reduce((a, b) => a + b, 0);
    const before = roughness();
    smoothGeneratedMotion(motion);
    expect(roughness()).toBeLessThan(before * 0.5);
    expect(
      new Quaternion().fromArray(first).angleTo(new Quaternion().fromArray(motion.rotations, 44)),
    ).toBeLessThan(1e-6);
    expect(
      new Quaternion()
        .fromArray(last)
        .angleTo(new Quaternion().fromArray(motion.rotations, 59 * 120 + 44)),
    ).toBeLessThan(1e-6);
  });
  it('requires image evidence for flight and retains a sustained visible jump', () => {
    const capture = videoReference();
    const pose = standingPose();
    const jump = Array.from({ length: 60 }, (_, f) =>
      f >= 18 && f <= 42 ? Math.sin(((f - 18) / 24) * Math.PI) * 0.55 : 0,
    );
    capture.trajectory = jump.flatMap((y) => [0, y, 0]);
    capture.raw.times = Array.from({ length: 60 }, (_, f) => f / 30);
    capture.raw.normalized = jump.flatMap((height) =>
      pose.world.flatMap(([x, y, z]) => [0.5 + x * 0.4, 0.42 + (y - height) * 0.4, z, 1]),
    );
    expect(Math.max(...capturedFootLift(capture))).toBeGreaterThan(0.25);
    // A reconstructed depth/scale bounce without visible foot lift is not flight.
    capture.raw.normalized = jump.flatMap(() =>
      pose.world.flatMap(([x, y, z]) => [0.5 + x * 0.4, 0.42 + y * 0.4, z, 1]),
    );
    expect(Math.max(...capturedFootLift(capture))).toBe(0);
  });
});
