import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import fixtures from './fixtures/emote-reference-poses.json';
import { dclReferenceRig } from '../server/dcl-reference-rig';
import { world, worldRotation, solveTwoBone } from '../src/rig';
import {
  emoteReferences,
  referenceCalibration,
  referenceProfile,
  styleReferences,
} from '../src/emote-references';
import { generationPrompt } from '../src/emote-style';
import { constrainWrist } from '../src/hand-articulation';
import { dclPoseToSoma } from '../src/dcl-pose-bridge';
import type { Motion } from '../src/motion';

describe('user supplied DCL reference library', () => {
  it('keeps the measured library for calibration without conditioning prompts on archived styles', () => {
    expect(emoteReferences).toHaveLength(9);
    for (const [style, profile] of Object.entries(styleReferences)) {
      for (const id of profile.sources) expect(referenceProfile(id).matchedJoints).toBe(62);
      expect(
        generationPrompt('Keep the requested gesture.', style as keyof typeof styleReferences),
      ).toBe('Keep the requested gesture.');
    }
    expect(generationPrompt('My video action')).toBe('My video action');
    expect(referenceProfile('idle').rootRangeM[1]).toBeLessThan(0.01);
    expect(referenceProfile('jump').rootRangeM[1]).toBeGreaterThan(0.8);
    expect(referenceProfile('run').durationSeconds).toBeLessThan(
      referenceProfile('walk').durationSeconds,
    );
  });
  it('preserves the measured Spotlight wrist twist while rejecting a reversed wrist', () => {
    const rest = new Quaternion(),
      axis = new Vector3(0, 1, 0);
    const observed = new Quaternion().setFromAxisAngle(
      axis,
      (referenceProfile('spotlight').wristTwistP99Degrees * Math.PI) / 180,
    );
    expect(constrainWrist(observed, rest, axis).angleTo(observed)).toBeLessThan(1e-7);
    expect(
      rest.angleTo(constrainWrist(new Quaternion().setFromAxisAngle(axis, Math.PI), rest, axis)),
    ).toBeCloseTo(referenceCalibration.wristTwist);
  });
  it.each(fixtures)(
    'retargets $id by bind axes and retains its effector positions through neutral IK',
    (reference) => {
      const rig = dclReferenceRig(),
        offset = new Vector3().fromArray(reference.positionOffset);
      for (const sample of reference.sampleFrames) {
        rig.reset();
        const hips = rig.bone('Hips'),
          root = new Vector3().fromArray(sample.positions.Hips).add(offset);
        hips.position.copy(hips.parent!.worldToLocal(root));
        for (const [name, bone] of rig.bones) {
          const delta = (sample.worldDeltas as Record<string, number[]>)[name];
          worldRotation(bone, new Quaternion().fromArray(delta).multiply(rig.initial(name).wq));
        }
        for (const side of ['Left', 'Right']) {
          for (const part of ['UpLeg', 'Leg', 'Foot', 'ToeBase', 'Arm', 'ForeArm', 'Hand']) {
            const name = side + part,
              expected = new Vector3()
                .fromArray((sample.positions as Record<string, number[]>)[name])
                .add(offset);
            expect(
              world(rig.bone(name)).distanceTo(expected),
              reference.id + ' ' + sample.frame + ' ' + name,
            ).toBeLessThan(0.015);
          }
          const foot = rig.bone(side + 'Foot'),
            target = world(foot),
            q = foot.getWorldQuaternion(new Quaternion());
          solveTwoBone(
            rig.bone(side + 'UpLeg'),
            rig.bone(side + 'Leg'),
            foot,
            target,
            world(rig.bone(side + 'Leg')),
          );
          worldRotation(foot, q);
          expect(world(foot).distanceTo(target)).toBeLessThan(0.0001);
        }
        // The same DCL -> SOMA -> DCL bridge used by video conditioning.
        const effectors = ['LeftFoot', 'RightFoot', 'LeftHand', 'RightHand'];
        const originalHip = world(rig.bone('Hips'));
        const relative = effectors.map((name) => world(rig.bone(name)).sub(originalHip));
        const rotations = dclPoseToSoma(rig).flatMap((values) => {
          const axis = new Vector3(...values),
            angle = axis.length();
          return (
            angle > 1e-9
              ? new Quaternion().setFromAxisAngle(axis.divideScalar(angle), angle)
              : new Quaternion()
          ).toArray();
        });
        const motion: Extract<Motion, { skeleton: 'soma30' }> = {
          version: 1,
          source: 'kimodo.cpp',
          skeleton: 'soma30',
          frames: 60,
          fps: 30,
          seed: 1,
          prompt: 'reference round trip',
          roots: Array.from({ length: 60 }, () => [0, 0.989, 0]).flat(),
          rotations: Array.from({ length: 60 }, () => rotations).flat(),
        };
        rig.reset();
        rig.retarget(motion, 0, 'source');
        effectors.forEach((name, i) =>
          expect(
            world(rig.bone(name))
              .sub(world(rig.bone('Hips')))
              .distanceTo(relative[i]),
          ).toBeLessThan(1e-5),
        );
      }
    },
  );
});
