import { describe, expect, it } from 'vitest';
import { compileConstraints, loopConstraints, MOTION_DIM } from '../server/kimodo-constraints';
import reference from './fixtures/kimodo-constraints.json';
import { kimodoSchema } from '../src/motion';

describe('Native SOMA30 conditioning', () => {
  it('matches official PyTorch full-body, effectors, heading and path tensors', () => {
    const { observed, mask } = compileConstraints(reference.constraints, reference.frames);
    expect(Array.from(mask)).toEqual(reference.mask);
    const maxError = Math.max(...observed.map((v, i) => Math.abs(v - reference.observed[i])));
    // Upstream axis_angle_to_matrix divides by (angle + 1e-6), while Three
    // uses a unit quaternion. Accumulated FK differences remain below 1e-5.
    expect(maxError).toBeLessThan(1e-5);
  });

  it('rejects conflicting anchors, invalid dimensions and frames outside the clip', () => {
    const root = { type: 'root2d', frame_indices: [4], smooth_root_2d: [[0, 0]] };
    expect(() => compileConstraints([root, { ...root, smooth_root_2d: [[1, 0]] }], 8)).toThrow(
      /Conflicting/,
    );
    expect(() => compileConstraints([{ ...root, frame_indices: [9] }], 8)).toThrow(/outside/);
    expect(() => compileConstraints([{ ...root, frame_indices: [1, 2] }], 8)).toThrow(/length/);
    expect(() => compileConstraints([{ ...root, global_root_heading: [[2, 0]] }], 8)).toThrow(
      /unit/,
    );
    expect(() =>
      compileConstraints([{ ...root, frame_indices: [0], smooth_root_2d: [[1, 0]] }], 8),
    ).toThrow(/start/);
    expect(() => compileConstraints([{ ...root, smooth_root_2d: [[NaN, 0]] }], 8)).toThrow();
  });

  it('uses the same initial pose at both ends; in-place constrains XZ without freezing pelvis height', () => {
    const motion = kimodoSchema.parse({
      version: 1,
      skeleton: 'soma30',
      fps: 30,
      frames: 60,
      prompt: 'wave',
      seed: 41,
      source: 'kimodo.cpp',
      roots: Array.from({ length: 180 }, (_, i) => (i % 3 === 1 ? 1 : 0)),
      rotations: Array.from({ length: 60 * 30 * 4 }, (_, i) => (i % 4 === 3 ? 1 : 0)),
    });
    const { observed, mask } = compileConstraints(loopConstraints(motion, true), 60);
    expect(observed.slice(0, MOTION_DIM)).toEqual(observed.slice(59 * MOTION_DIM));
    expect(mask.slice(0, MOTION_DIM)).toEqual(mask.slice(59 * MOTION_DIM));
    expect(mask[30 * MOTION_DIM]).toBe(1);
    expect(mask[30 * MOTION_DIM + 2]).toBe(1);
    expect(mask[30 * MOTION_DIM + 1]).toBe(0);
    const moving = compileConstraints(loopConstraints(motion, false), 60);
    expect(moving.mask[30 * MOTION_DIM]).toBe(0);
  });

  it('exposes single-limb aliases with the same masks as explicit effectors', () => {
    const pose = reference.constraints[1];
    for (const [type, joint] of [
      ['left-hand', 'LeftHand'],
      ['right-hand', 'RightHand'],
      ['left-foot', 'LeftFoot'],
      ['right-foot', 'RightFoot'],
    ]) {
      const alias = compileConstraints([{ ...pose, type, joint_names: undefined }], 8);
      const explicit = compileConstraints(
        [{ ...pose, type: 'end-effector', joint_names: [joint] }],
        8,
      );
      expect(alias).toEqual(explicit);
    }
  });
});
