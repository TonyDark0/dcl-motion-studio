import { Quaternion, Vector3, MathUtils } from 'three';
import type { Motion } from '../src/motion';
import type { Capture } from '../src/video-motion';
import { capturedFootLift, capturedFootSupport, smoothSamples } from '../src/video-grounding';
import { dclReferenceRig } from './dcl-reference-rig';
import { dclPoseToSoma } from '../src/dcl-pose-bridge';
import { solveTwoBone, world, worldRotation } from '../src/rig';
import { repairVideoReferences } from './video-reference-repair';

type BodyMotion = Extract<Motion, { skeleton: 'soma30' }>;
const sides = ['Left', 'Right'] as const;

export function smoothGeneratedMotion(motion: BodyMotion) {
  const raw = [...motion.rotations];
  for (let f = 0; f < motion.frames; f++)
    for (let j = 0; j < 30; j++) {
      const center = new Quaternion().fromArray(raw, f * 120 + j * 4).normalize();
      const sum = [0, 0, 0, 0];
      for (let d = -2; d <= 2; d++) {
        const sample = new Quaternion()
          .fromArray(raw, MathUtils.clamp(f + d, 0, motion.frames - 1) * 120 + j * 4)
          .normalize();
        const w = [1, 4, 6, 4, 1][d + 2] * (center.dot(sample) < 0 ? -1 : 1);
        sample.toArray().forEach((v, k) => (sum[k] += v * w));
      }
      // Preserve endpoint references and attenuate high-frequency angular noise.
      if (f > 0 && f < motion.frames - 1)
        center.slerp(new Quaternion().fromArray(sum).normalize(), 0.75);
      center.normalize().toArray(motion.rotations, f * 120 + j * 4);
    }
  for (let axis = 0; axis < 3; axis++)
    smoothSamples(
      Array.from({ length: motion.frames }, (_, f) => motion.roots[f * 3 + axis]),
    ).forEach((v, f) => (motion.roots[f * 3 + axis] = v));
}

/** Baked cleanup in the actual export rig, independent of the UI foot-lock checkbox. */
export function postprocessVideoMotion(motion: BodyMotion, input: Capture) {
  smoothGeneratedMotion(motion);
  const capture = repairVideoReferences(input),
    rig = dclReferenceRig();
  const scale = rig.initial('Hips').wp.y / 0.989;
  const lift = capturedFootLift(capture).map((v) => v * scale);
  const samples = Array.from({ length: motion.frames }, (_, f) => {
    rig.reset();
    rig.retarget(motion, f / 30, 'source');
    const feet = sides.map((side) => {
      const foot = world(rig.bone(side + 'Foot')),
        toe = world(rig.bone(side + 'ToeBase'));
      return {
        foot,
        toe,
        clearance: Math.min(
          foot.y - rig.initial(side + 'Foot').wp.y,
          toe.y - rig.initial(side + 'ToeBase').wp.y,
        ),
      };
    });
    const delta = lift[f] - Math.min(...feet.map((foot) => foot.clearance));
    motion.roots[f * 3 + 1] += delta / scale;
    return feet.map((foot) => ({
      position: foot.foot.add(new Vector3(0, delta, 0)),
      clearance: foot.clearance + delta,
    }));
  });
  const targets = sides.map((_, side) => samples.map((sample) => sample[side].position.clone()));
  const weights = capturedFootSupport(capture);
  // Vertical support is independent of horizontal locking: a foot that slides
  // in the prediction still needs to reach the floor shown in the capture.
  for (let side = 0; side < 2; side++)
    for (let f = 0; f < motion.frames; f++) targets[side][f].y -= samples[f][side].clearance;
  for (let side = 0; side < 2; side++) {
    const stable = samples.map((sample, f) => {
      const a = samples[Math.max(0, f - 1)][side].position,
        b = samples[Math.min(motion.frames - 1, f + 1)][side].position;
      const speed = Math.hypot(b.x - a.x, b.z - a.z) * 15;
      return weights[side][f] > 0 && speed < 0.35;
    });
    for (let start = 0; start < motion.frames;) {
      if (!stable[start]) {
        start++;
        continue;
      }
      let end = start + 1;
      while (end < motion.frames && stable[end]) end++;
      if (end - start >= 4) {
        const segment = targets[side].slice(start, end),
          anchor = new Vector3();
        for (const axis of ['x', 'z'] as const)
          anchor[axis] = segment.map((p) => p[axis]).sort((a, b) => a - b)[
            Math.floor(segment.length / 2)
          ];
        for (let f = start; f < end; f++) {
          const blend = Math.min(
            1,
            start === 0 ? 1 : (f - start + 1) / 3,
            end === motion.frames ? 1 : (end - f) / 3,
          );
          const lock = blend * blend * (3 - 2 * blend);
          targets[side][f].x = MathUtils.lerp(targets[side][f].x, anchor.x, lock);
          targets[side][f].z = MathUtils.lerp(targets[side][f].z, anchor.z, lock);
        }
      }
      start = end;
    }
  }
  for (let f = 0; f < motion.frames; f++) {
    rig.reset();
    rig.retarget(motion, f / 30, 'source');
    // Give both supporting legs enough reach before IK. Lowering the pelvis
    // after solving alone can ground one sole while leaving the other floating.
    let drop = 0;
    sides.forEach((side, s) => {
      if (weights[s][f] <= 0) return;
      const hip = world(rig.bone(side + 'UpLeg')),
        knee = world(rig.bone(side + 'Leg')),
        foot = world(rig.bone(side + 'Foot')),
        target = foot.clone().lerp(targets[s][f], weights[s][f]);
      const length = hip.distanceTo(knee) + knee.distanceTo(foot) - 0.0001;
      const horizontal = (hip.x - target.x) ** 2 + (hip.z - target.z) ** 2;
      drop = Math.min(
        drop,
        target.y + Math.sqrt(Math.max(0, length * length - horizontal)) - hip.y,
      );
    });
    if (drop < 0) {
      motion.roots[f * 3 + 1] += drop / scale;
      rig.reset();
      rig.retarget(motion, f / 30, 'source');
    }
    let corrected = false;
    sides.forEach((side, s) => {
      if (weights[s][f] <= 0) return;
      const foot = rig.bone(side + 'Foot'),
        orientation = foot.getWorldQuaternion(new Quaternion());
      const target = world(foot).lerp(targets[s][f], weights[s][f]);
      solveTwoBone(
        rig.bone(side + 'UpLeg'),
        rig.bone(side + 'Leg'),
        foot,
        target,
        world(rig.bone(side + 'Leg')),
      );
      worldRotation(foot, orientation);
      corrected = true;
    });
    if (corrected) {
      const rotations = dclPoseToSoma(rig);
      for (const joint of [22, 23, 24, 25, 26, 27, 28, 29]) {
        const axis = new Vector3(...rotations[joint]),
          angle = axis.length();
        const q =
          angle > 1e-9
            ? new Quaternion().setFromAxisAngle(axis.divideScalar(angle), angle)
            : new Quaternion();
        q.toArray(motion.rotations, f * 120 + joint * 4);
      }
    }
    // Reach clamping may leave the supporting sole above/below its plane.
    // Reconcile pelvis height after IK; never stretch leg bones or flatten flight.
    const residual = Math.min(
      ...sides.flatMap((side) => [
        world(rig.bone(side + 'Foot')).y - rig.initial(side + 'Foot').wp.y,
        world(rig.bone(side + 'ToeBase')).y - rig.initial(side + 'ToeBase').wp.y,
      ]),
    );
    motion.roots[f * 3 + 1] += (lift[f] - residual) / scale;
  }
  return {
    version: 'dcl-ground-smooth-v1' as const,
    airborneFrames: lift.filter((v) => v > 0.02).length,
    contactFrames: weights.map((w) => w.filter((v) => v > 0).length) as [number, number],
  };
}
