import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { constrainWrist } from '../src/hand-articulation';
import { stabilizeHandKeys } from '../src/timeline-evaluator';
import { type Pose } from '../src/timeline';
import { referenceCalibration } from '../src/emote-references';

describe('captured wrist stability', () => {
  it('bounds reverse palms in the bind frame without removing ordinary wrist movement', () => {
    const rest = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1.2);
    const forward = new Vector3(0, 1, 0);
    const reverse = rest.clone().multiply(new Quaternion().setFromAxisAngle(forward, Math.PI));
    expect(rest.angleTo(constrainWrist(reverse, rest, forward))).toBeCloseTo(
      referenceCalibration.wristTwist,
    );
    const ordinary = rest
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4));
    expect(ordinary.angleTo(constrainWrist(ordinary, rest, forward))).toBeLessThan(1e-7);
    const backwards = rest
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI));
    expect(rest.angleTo(constrainWrist(backwards, rest, forward))).toBeCloseTo(
      referenceCalibration.wristSwing,
    );
  });
  it('removes an isolated reversed reference while leaving body and continuous hand turns intact', () => {
    const pose = (angle: number): Pose =>
      new Map(
        ['Avatar_LeftHand', 'Avatar_Hips'].map((name) => [
          name,
          { p: new Vector3(), q: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle) },
        ]),
      );
    const keys = [pose(0), pose(2.8), pose(0.1)];
    stabilizeHandKeys(keys);
    expect(keys[1].get('Avatar_LeftHand')!.q.angleTo(new Quaternion())).toBeCloseTo(0.05);
    expect(keys[1].get('Avatar_Hips')!.q.angleTo(new Quaternion())).toBeCloseTo(2.8);
    const continuous = [pose(0), pose(0.7), pose(1.4)];
    stabilizeHandKeys(continuous);
    expect(continuous[1].get('Avatar_LeftHand')!.q.angleTo(new Quaternion())).toBeCloseTo(0.7);
  });
});
