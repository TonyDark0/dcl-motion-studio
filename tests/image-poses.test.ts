import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { fitImagePose } from '../src/image-pose-solver';
import { imagePoseConstraints } from '../server/image-pose-constraints';
import { compileConstraints } from '../server/kimodo-constraints';
import { SOMA_PARENTS, newProject, projectSchema } from '../src/motion';
import { SOMA_OFFSETS } from '../server/soma-offsets';
import { emptyPoseReferences, referenceRequest } from '../src/pose-reference';
import { standingPose } from './fixtures/image-pose';

describe('image pose conditioning', () => {
  it('accepts one reviewed photo and uses it for both endpoints without an end photo', () => {
    const pose = standingPose();
    const request = referenceRequest({ ...emptyPoseReferences(), enabled: true, start: {
      ...pose, landmarks: pose.world, name: 'pose.jpg', thumbnail: 'data:image/jpeg;base64,AA==', accepted: true,
    }});
    expect(request!.end).toBeUndefined();
    const { observed } = compileConstraints(imagePoseConstraints(request!, 30, true, true), 30);
    expect(Array.from(observed.slice(0, 369))).toEqual(Array.from(observed.slice(29 * 369)));
  });
  it('preserves SOMA lengths regardless of the photographed person proportions', () => {
    const input = standingPose();
    input.world = input.world.map(([x, y, z]) => [x * 1.7, y * 1.3, z]);
    const pose = fitImagePose(input);
    SOMA_PARENTS.forEach((parent, j) => {
      if (parent < 0) return;
      const distance = new Vector3(...pose.positions[j]).distanceTo(
        new Vector3(...pose.positions[parent]),
      );
      expect(distance).toBeCloseTo(new Vector3(...SOMA_OFFSETS[j]).length(), 7);
    });
    expect(Math.min(...[24, 25, 28, 29].map((j) => pose.positions[j][1]))).toBeCloseTo(0, 7);
  });
  it('maps a raised left arm to the left side and keeps the other arm horizontal', () => {
    const p = fitImagePose(standingPose(true)).positions;
    expect(p[13][1] - p[11][1]).toBeGreaterThan(0.5);
    expect(Math.abs(p[19][1] - p[17][1])).toBeLessThan(0.01);
    expect(p[13][0]).toBeGreaterThan(p[19][0]);
  });
  it('does not transfer face or finger landmarks from photo references', () => {
    const original = standingPose();
    const changed = structuredClone(original);
    for (const index of [7, 8, 17, 18, 19, 20, 21, 22]) {
      changed.world[index] = [3, -3, 2];
      changed.confidence[index] = 0;
    }
    expect(fitImagePose(changed).rotations).toEqual(fitImagePose(original).rotations);
  });
  it('uses identical loop endpoints and an independent middle anchor', () => {
    const c = imagePoseConstraints(
      { start: standingPose(), middle: standingPose(true), end: standingPose(), middleTime: 0.5 },
      60,
      true,
      true,
    );
    const { observed, mask } = compileConstraints(c, 60);
    expect(Array.from(observed.slice(0, 369))).toEqual(Array.from(observed.slice(59 * 369)));
    expect(Array.from(observed.slice(30 * 369, 31 * 369))).not.toEqual(
      Array.from(observed.slice(0, 369)),
    );
    expect(mask[10 * 369]).toBe(1);
    expect(mask[10 * 369 + 1]).toBe(0);
  });
  it('uses a timed second middle pose while sharing the same Start and End', () => {
    const c = imagePoseConstraints(
      { start: standingPose(), middle2: standingPose(true), middle2Time: 0.8, middleTime: 0.5 },
      60,
      true,
      true,
    );
    const { observed } = compileConstraints(c, 60);
    expect(Array.from(observed.slice(0, 369))).toEqual(Array.from(observed.slice(59 * 369)));
    expect(Array.from(observed.slice(47 * 369, 48 * 369))).not.toEqual(
      Array.from(observed.slice(0, 369)),
    );
  });
  it('requires an independent end for nonloops and leaves travel unconstrained between anchors', () => {
    expect(() =>
      imagePoseConstraints({ start: standingPose(), middleTime: 0.5 }, 60, false, true),
    ).toThrow(/end pose/);
    const c = imagePoseConstraints(
      { start: standingPose(), end: standingPose(true), middleTime: 0.5 },
      60,
      false,
      false,
    );
    const { observed, mask } = compileConstraints(c, 60);
    expect(mask[10 * 369]).toBe(0);
    expect(Array.from(observed.slice(0, 369))).not.toEqual(Array.from(observed.slice(59 * 369)));
  });
  it('rejects uncertain or degenerate body joints instead of silently using bad constraints', () => {
    const p = standingPose();
    p.confidence[25] = 0.1;
    expect(() => fitImagePose(p)).toThrow(/hidden or uncertain/);
    p.confidence[25] = 1;
    p.world[25] = p.world[23];
    expect(() => fitImagePose(p)).toThrow(/incomplete/);
  });
  it('migrates old projects and requires accepted poses', () => {
    const { poseReferences: _, ...old } = newProject();
    expect(projectSchema.parse(old).poseReferences.enabled).toBe(false);
    expect(referenceRequest(emptyPoseReferences())).toBeUndefined();
    expect(() => referenceRequest({ ...emptyPoseReferences(), enabled: true })).toThrow(
      /accept/,
    );
  });
});
