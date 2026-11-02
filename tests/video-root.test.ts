import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { estimateVideoRoot, unwrapAngles } from '../src/video-root';
import { compileCapture, refilterCapture, type Observation } from '../src/video-motion';
import { standingPose } from './fixtures/image-pose';
import { videoReference } from './fixtures/video-reference';
import { preserveVideoRoot, videoPoseConstraints } from '../server/video-pose-constraints';
import { forwardPose } from '../server/kimodo-constraints';
import type { Motion } from '../src/motion';

function observation(time: number, translation: number[], scale = 2.5): Observation {
  const pose = standingPose();
  return {
    time,
    aspectRatio: 0.5625,
    body: pose.world.flatMap((p, i) => [...p, pose.confidence[i]]),
    normalized: pose.world.flatMap(([x, y, z]) => [
      0.5 + (x + translation[0]) / (scale * 0.5625),
      0.5 + (y - translation[1]) / scale,
      z,
      1,
    ]),
    detail: Array(532).fill(0),
  };
}
describe('video camera-space movement', () => {
  it('uses dense tracked heading to retain multiple fast turns between sparse body poses', () => {
    const capture = videoReference();
    capture.metadata.trajectoryVersion = 'camera-root-v2';
    capture.heading = Array.from({ length: 60 }, (_, f) => (f / 59) * 6 * Math.PI);
    for (let f = 0; f < 60; f++) {
      const turn = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        0.8 + capture.heading[f],
      );
      for (let j = 0; j < 33; j++)
        new Vector3()
          .fromArray(capture.positions, f * 99 + j * 3)
          .applyQuaternion(turn)
          .toArray(capture.positions, f * 99 + j * 3);
    }
    const path = videoPoseConstraints(capture, 60)[1];
    if (path.type !== 'root2d') throw Error('path');
    const headings = unwrapAngles(path.global_root_heading!.map(([x, z]) => Math.atan2(z, x)));
    expect(headings.at(-1)! - headings[0]).toBeCloseTo(6 * Math.PI);
    for (let f = 1; f < 60; f++)
      expect(headings[f] - headings[f - 1]).toBeCloseTo((6 * Math.PI) / 59, 3);
  });
  it('recovers lateral travel and jumps without using arms or an articulated screen bounding box', () => {
    const a = observation(0, [0, 0, 0]),
      b = observation(1, [0.4, 0.35, 0]);
    for (const j of [13, 14, 15, 16]) b.normalized![j * 4 + 1] -= 0.5;
    const path = estimateVideoRoot([a, b]);
    expect(path[0]).toEqual([0, 0, 0]);
    expect(path[1][0]).toBeCloseTo(0.4);
    expect(path[1][1]).toBeCloseTo(0.35);
    expect(path[1][2]).toBeCloseTo(0);
    const away = estimateVideoRoot([a, observation(1, [0, 0, 0], 3)]);
    expect(away[1][2]).toBeLessThan(0); // Away from camera is -Z in the Y-up scene.
  });
  it('uses SAM camera translation plus its pelvis position and retains it through refiltering', () => {
    const raw = [observation(0, [0, 0, 0]), observation(1.99, [0, 0, 0])];
    raw.forEach(
      (r, i) =>
        (r.sam = {
          keypoints3d: Array(210).fill(0),
          keypoints2d: Array(140).fill(0.5),
          score: 0.9,
          cameraTranslation: [0.4 * i, -0.3 * i, 3 + 0.7 * i],
        }),
    );
    expect(estimateVideoRoot(raw)[1]).toEqual([0.4, 0.3, -0.7000000000000002]);
    const capture = compileCapture(raw, 2, 'pro-camera.mp4', 0);
    const filtered = refilterCapture(capture, 0.4);
    expect(filtered.raw.samCamera).toEqual(capture.raw.samCamera);
    expect(filtered.raw.samCamera!.slice(3)).toEqual([0.4, -0.3, 3.7]);
    expect(filtered.raw.aspectRatio).toBe(0.5625);
    expect(filtered.trajectory).toEqual(capture.trajectory);
    expect(filtered.metadata.trajectoryVersion).toBe('camera-root-v2');
  });
  it('unwraps continuous turns across +/-180 degrees instead of interpolating backwards', () => {
    const degrees = [160, 175, -170, -110, -30, 50, 130, -150];
    const continuous = unwrapAngles(degrees.map((v) => (v * Math.PI) / 180));
    expect(continuous.map((v) => Math.round((v * 180) / Math.PI))).toEqual([
      160, 175, 190, 250, 330, 410, 490, 570,
    ]);
  });
  it('bakes world path, a full turn, and airborne height without overwriting generated limb articulation', () => {
    const capture = videoReference();
    capture.metadata.trajectoryVersion = 'camera-root-v2';
    for (let f = 0; f < 60; f++) {
      const yaw = 1.2 + (f / 59) * 2 * Math.PI;
      const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      for (let j = 0; j < 33; j++)
        new Vector3()
          .fromArray(capture.positions, f * 99 + j * 3)
          .applyQuaternion(turn)
          .toArray(capture.positions, f * 99 + j * 3);
      capture.trajectory!.splice(
        f * 3,
        3,
        Math.sin((f / 59) * Math.PI) * 0.7,
        Math.sin((f / 59) * Math.PI) * 0.5,
        (f / 59) * -0.6,
      );
    }
    const constraints = videoPoseConstraints(capture, 60),
      body = constraints[0];
    if (body.type !== 'fullbody') throw Error('body');
    const motion: Extract<Motion, { skeleton: 'soma30' }> = {
      version: 1,
      skeleton: 'soma30',
      source: 'kimodo.cpp',
      fps: 30,
      frames: 60,
      seed: 1,
      prompt: 'turn and jump',
      roots: Array(180).fill(0),
      rotations: Array.from({ length: 7200 }, (_, i) => (i % 4 === 3 ? 1 : 0)),
    };
    preserveVideoRoot(motion, capture, constraints);
    expect(motion.roots[30 * 3]).toBeCloseTo(capture.trajectory![30 * 3]);
    expect(motion.roots[30 * 3 + 1] - motion.roots[1]).toBeGreaterThan(0.49);
    expect(motion.roots[59 * 3 + 2]).toBeCloseTo(-0.6);
    for (let i = 0; i < body.frame_indices.length; i++) {
      const f = body.frame_indices[i],
        expected = forwardPose(body.local_joints_rot[i], body.root_positions[i]).global[0];
      expect(new Quaternion().fromArray(motion.rotations, f * 120).angleTo(expected)).toBeLessThan(
        0.03,
      );
      expect(motion.rotations.slice(f * 120 + 4, f * 120 + 120)).toEqual(
        Array.from({ length: 116 }, (_, j) => (j % 4 === 3 ? 1 : 0)),
      );
    }
  });
});
