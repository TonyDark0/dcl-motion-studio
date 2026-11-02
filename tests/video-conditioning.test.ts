import { standingPose } from './fixtures/image-pose';
import { describe, expect, it, vi } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { videoReference } from './fixtures/video-reference';
import { referenceFrames } from '../src/pose-sampling';
import { videoPoseConstraints } from '../server/video-pose-constraints';
import { compileConstraints } from '../server/kimodo-constraints';
import { newProject } from '../src/motion';
import { useStudio } from '../src/store';
import { compileTimeline, samplePoses } from '../src/timeline-evaluator';
import { newTimeline, type Pose } from '../src/timeline';

describe('video poses condition Kimodo and separate hand layers', () => {
  it.each(['mediapipe+rtmw3d', 'sam3d-hybrid'] as const)(
    'uses reviewed %s poses at 10-frame intervals, including both endpoints',
    (source) => {
      const capture = videoReference(300, source);
      const constraints = videoPoseConstraints(capture, 300);
      const body = constraints[0];
      expect(body.frame_indices).toEqual([...Array.from({ length: 30 }, (_, i) => i * 10), 299]);
      if (body.type !== 'fullbody') throw Error('Expected full body');
      expect(body.local_joints_rot[0]).not.toEqual(body.local_joints_rot[2]);
      expect(body.root_positions.at(-1)![0]).toBeCloseTo(2.99);
      const compiled = compileConstraints(constraints, 300);
      expect(compiled.mask).toHaveLength(300 * 369);
      expect([...compiled.observed].every(Number.isFinite)).toBe(true);
      expect(compiled.mask[10 * 369 + 5]).toBe(1);
      expect(compiled.mask[11 * 369 + 5]).toBe(0);
    },
  );
  it('keeps in-place XZ fixed without flattening pelvis height or changing anchor poses', () => {
    const capture = videoReference();
    const fixed = videoPoseConstraints(capture, 60, true)[0];
    const moving = videoPoseConstraints(capture, 60)[0];
    if (fixed.type !== 'fullbody' || moving.type !== 'fullbody') throw Error('Expected body');
    expect(fixed.local_joints_rot).toEqual(moving.local_joints_rot);
    expect(fixed.root_positions.every(([x, y, z]) => x === 0 && y > 0.5 && z === 0)).toBe(true);
  });
  it('preserves vertical video travel in source and in-place instead of grounding every key pose', () => {
    const capture = videoReference();
    const screen = standingPose().world.flatMap(([x, y, z]) => [
      0.5 + x * 0.4,
      0.42 + y * 0.4,
      z,
      1,
    ]);
    const lifted = screen.map((n, i) => (i % 4 === 1 ? n - 0.1 : n));
    capture.raw.normalized = [...screen, ...lifted];
    for (const inPlace of [false, true]) {
      const body = videoPoseConstraints(capture, 60, inPlace)[0];
      if (body.type !== 'fullbody') throw Error('Expected body');
      expect(body.root_positions.at(-1)![1] - body.root_positions[0][1]).toBeGreaterThan(0.2);
    }
  });
  it('rejects mismatched duration and unreliable key poses instead of silently using a default pose', () => {
    const capture = videoReference();
    expect(() => videoPoseConstraints(capture, 90)).toThrow(/durations must match/);
    for (let f = 1; f < 25; f++) capture.confidence[f * 33 + 13] = 0.05;
    expect(() => videoPoseConstraints(capture, 60)).toThrow(/0.33 s/);
    expect(referenceFrames(61)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(() => referenceFrames(301)).toThrow();
  });
  it('retargets only hand key poses and interpolates their rotations without affecting the Body layer', () => {
    const empty = newProject();
    empty.timeline = { ...newTimeline(empty), assets: [], strips: [] };
    useStudio.getState().load(empty);
    useStudio.getState().change({ preset: 'squat', duration: 2 });
    useStudio.getState().addHands({ handMode: 'reference', handReference: videoReference() });
    const p = useStudio.getState().project;
    const tl = p.timeline!;
    expect(tl.tracks.map((t) => t.kind)).toEqual(['body', 'hands']);
    expect(tl.strips.map((s) => s.start)).toEqual([0, 0]);
    const pose = (angle: number, x: number): Pose =>
      new Map(
        ['Avatar_Hips', 'Avatar_LeftHandIndex1'].map((n) => [
          n,
          {
            p: new Vector3(x, 1, 0),
            q: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle),
          },
        ]),
      );
    const handTimes: number[] = [];
    const source = vi.fn((asset, time: number) => {
      if (asset.handMode === 'reference') {
        handTimes.push(time);
        return pose(time, 999);
      }
      return pose(0, 0);
    });
    const compiled = compileTimeline(p, pose(0, 0), source);
    expect(handTimes).toEqual([0, 10 / 30, 20 / 30, 1, 40 / 30, 50 / 30, 59 / 30]);
    const sampled = samplePoses(compiled.poses, 0.25);
    expect(sampled.get('Avatar_Hips')!.p.x).toBe(0);
    expect(sampled.get('Avatar_Hips')!.q.angleTo(new Quaternion())).toBeCloseTo(0);
    expect(sampled.get('Avatar_LeftHandIndex1')!.q.angleTo(new Quaternion())).toBeCloseTo(0.25);
  });
});
