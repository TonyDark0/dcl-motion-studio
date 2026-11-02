import { captureSchema, type Capture } from './video-motion.js';
import { fitImagePose } from './image-pose-solver.js';
import { referenceFrames } from './pose-sampling.js';
import { compileConstraints, forwardPose, type Constraint } from '../server/kimodo-constraints.js';
import { unwrapAngles } from './video-root.js';
import { Quaternion, Vector3 } from 'three';
import { SOMA_OFFSETS } from '../server/soma-offsets.js';
import type { Motion } from './motion.js';
import { canonicalReferenceRig } from './dcl-reference-rig.js';
import type { AvatarRig } from './rig.js';
import { dclPoseToSoma } from './dcl-pose-bridge.js';
import { repairVideoReferences } from './video-reference-repair.js';
import { capturedFootLift } from './video-grounding.js';

export class VideoTrackingError extends Error {
  constructor(
    message: string,
    readonly frame: number,
    readonly joints: number[],
  ) {
    super(message);
    this.name = 'VideoTrackingError';
  }
}

/** Reviewed capture -> canonical DCL FK -> SOMA body/effector constraints. */
export function videoPoseConstraints(
  input: Capture,
  frames: number,
  inPlace = false,
  referenceRig: () => AvatarRig = canonicalReferenceRig,
): Constraint[] {
  const capture = repairVideoReferences(captureSchema.parse(input));
  if (capture.frames !== frames) throw Error('Video and generation durations must match.');
  const indices = referenceFrames(frames);
  const rig = referenceRig();
  const poses = indices.map((frame) => {
    try {
      // Validate confidence before the FK pass; never silently anchor a missing limb.
      fitImagePose({
        // Capture has already converted camera coordinates to Y-up. The shared fitter
        // accepts MediaPipe camera coordinates; invert exactly once at this boundary.
        world: Array.from({ length: 33 }, (_, joint): [number, number, number] => {
          const i = frame * 99 + joint * 3;
          return [capture.positions[i], -capture.positions[i + 1], -capture.positions[i + 2]];
        }),
        confidence: capture.confidence.slice(frame * 33, (frame + 1) * 33),
      });
      rig.reset();
      // Only FK: retain DCL bind lengths and capture directions. Foot locking and
      // user IK offsets must not contaminate the references sent to generation.
      rig.retargetCapture(capture, frame / capture.fps, 'source');
      const rotations = dclPoseToSoma(rig);
      const soma = forwardPose(rotations, [0, 0, 0]);
      const height = -Math.min(...[24, 25, 28, 29].map((joint) => soma.positions[joint].y));
      if (!Number.isFinite(height) || height < 0.1 || height > 1.6)
        throw Error('Invalid fitted body');
      return { rotations, root: [0, height, 0] as [number, number, number] };
    } catch (error) {
      const names: Record<number, string> = {
        11: 'left shoulder',
        12: 'right shoulder',
        13: 'left elbow',
        14: 'right elbow',
        15: 'left wrist',
        16: 'right wrist',
        23: 'left hip',
        24: 'right hip',
        25: 'left knee',
        26: 'right knee',
        27: 'left ankle',
        28: 'right ankle',
      };
      const uncertain = Object.keys(names)
        .map(Number)
        .filter((j) => capture.confidence[frame * 33 + j] < 0.35);
      throw new VideoTrackingError(
        `Review body tracking at ${(frame / 30).toFixed(2)} s: ${uncertain.length ? `tracking is missing for ${uncertain.map((j) => names[j]).join(', ')} beyond the short repair window` : error instanceof Error ? error.message : 'invalid body geometry'}.`,
        frame,
        uncertain,
      );
    }
  });
  const origin = capture.trajectory?.slice(0, 3) ?? [0, 0, 0];
  const path = Array.from({ length: frames }, (_, frame): [number, number] =>
    inPlace
      ? [0, 0]
      : [
          (capture.trajectory?.[frame * 3] ?? 0) - origin[0],
          (capture.trajectory?.[frame * 3 + 2] ?? 0) - origin[2],
        ],
  );
  // A photo has no travel evidence, but a fixed-camera video does. Retain the
  // screen-space pelvis lift (including jumps), with fitted feet as a lower bound.
  // This remains a monocular estimate; camera movement cannot be disambiguated.
  const normalized = capture.raw.normalized;
  const hipY = (sample: number) => {
    if (!normalized) return null;
    const offset = sample * 132;
    if (normalized[offset + 23 * 4 + 3] < 0.35 || normalized[offset + 24 * 4 + 3] < 0.35)
      return null;
    return (normalized[offset + 23 * 4 + 1] + normalized[offset + 24 * 4 + 1]) / 2;
  };
  const firstHip = hipY(0);
  const visibleY = normalized
    ? Array.from({ length: 33 }, (_, j) => j)
        .filter((j) => normalized[j * 4 + 3] >= 0.35)
        .map((j) => normalized[j * 4 + 1])
    : [];
  const screenHeight = Math.max(...visibleY) - Math.min(...visibleY);
  const footLift = capture.metadata.groundingVersion ? capturedFootLift(capture) : null;
  const rootHeight = (frame: number, groundHeight: number) => {
    if (footLift) return groundHeight + footLift[frame];
    if (capture.metadata.trajectoryVersion === 'camera-root-v2' && capture.trajectory)
      return poses[0].root[1] + capture.trajectory[frame * 3 + 1] - origin[1];
    if (firstHip === null || !Number.isFinite(screenHeight) || screenHeight < 0.1)
      return groundHeight;
    const times = capture.raw.times,
      time = frame / 30;
    let a = 0;
    while (a < times.length - 2 && times[a + 1] < time) a++;
    const b = Math.min(a + 1, times.length - 1),
      ya = hipY(a),
      yb = hipY(b);
    if (ya === null || yb === null) return groundHeight;
    const u = Math.max(0, Math.min(1, (time - times[a]) / Math.max(1e-6, times[b] - times[a])));
    const lift = ((firstHip - (ya + (yb - ya) * u)) * 1.7) / screenHeight;
    return Math.max(groundHeight, poses[0].root[1] + lift);
  };
  const headings = unwrapAngles(
    poses.map((pose) => forwardPose(pose.rotations, pose.root).heading),
  );
  const tracked =
    capture.metadata.trajectoryVersion === 'camera-root-v2' ? capture.heading : undefined;
  if (tracked) {
    // Dense pelvis tracking disambiguates fast turns of more than 180 degrees between
    // sparse pose anchors. Keep the anchor convention exact for the native masks.
    for (let i = 1; i < headings.length; i++) {
      const expected = headings[0] + tracked[indices[i]] - tracked[0];
      headings[i] += Math.round((expected - headings[i]) / (2 * Math.PI)) * 2 * Math.PI;
    }
  }
  // Unwrap before interpolation: a turn across +/-180 degrees must not reverse direction.
  const denseHeading = Array.from({ length: frames }, (_, frame): [number, number] => {
    let i = 0;
    while (i < indices.length - 2 && indices[i + 1] < frame) i++;
    const u = (frame - indices[i]) / (indices[i + 1] - indices[i]);
    const heading = tracked
      ? headings[0] +
        tracked[frame] -
        tracked[0] +
        (headings[i] - headings[0] - tracked[indices[i]] + tracked[0]) * (1 - u) +
        (headings[i + 1] - headings[0] - tracked[indices[i + 1]] + tracked[0]) * u
      : headings[i] + (headings[i + 1] - headings[i]) * u;
    return [Math.cos(heading), Math.sin(heading)];
  });
  const constraints: Constraint[] = [
    {
      type: 'fullbody',
      frame_indices: indices,
      local_joints_rot: poses.map((pose) => pose.rotations),
      root_positions: poses.map((pose, i) => [
        path[indices[i]][0],
        rootHeight(indices[i], pose.root[1]),
        path[indices[i]][1],
      ]),
    },
    {
      type: 'root2d',
      frame_indices: path.map((_, i) => i),
      smooth_root_2d: path,
      global_root_heading: denseHeading,
    },
  ];
  const body = constraints[0];
  if (body.type === 'fullbody')
    constraints.push({
      ...body,
      type: 'end-effector',
      joint_names: ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'],
    });
  // Validate overlaps, origin and finite values before enqueueing a native generation.
  compileConstraints(constraints, frames);
  return constraints;
}

/** Preserve the captured world path after generative infill; do not flatten airborne motion. */
export function preserveVideoRoot(
  motion: Extract<Motion, { skeleton: 'soma30' }>,
  capture: Capture,
  constraints: Constraint[],
) {
  const body = constraints.find((c) => c.type === 'fullbody');
  const path = constraints.find((c) => c.type === 'root2d');
  if (
    !body ||
    body.type !== 'fullbody' ||
    !path ||
    path.type !== 'root2d' ||
    !path.global_root_heading
  )
    throw Error('Video world-space constraints are missing.');
  const hipAxis = new Vector3(...SOMA_OFFSETS[26]).sub(new Vector3(...SOMA_OFFSETS[22]));
  for (let f = 0; f < motion.frames; f++) {
    motion.roots[f * 3] = path.smooth_root_2d[f][0];
    motion.roots[f * 3 + 2] = path.smooth_root_2d[f][1];
    let i = 0;
    while (i < body.frame_indices.length - 2 && body.frame_indices[i + 1] < f) i++;
    const u = (f - body.frame_indices[i]) / (body.frame_indices[i + 1] - body.frame_indices[i]);
    motion.roots[f * 3 + 1] =
      !capture.metadata.groundingVersion &&
      capture.metadata.trajectoryVersion === 'camera-root-v2' &&
      capture.trajectory
        ? body.root_positions[0][1] + capture.trajectory[f * 3 + 1] - capture.trajectory[1]
        : body.root_positions[i][1] +
          (body.root_positions[i + 1][1] - body.root_positions[i][1]) * u;
    const root = new Quaternion().fromArray(motion.rotations, f * 120).normalize();
    const lateral = hipAxis.clone().applyQuaternion(root);
    const current = Math.atan2(lateral.z, -lateral.x);
    const [cos, sin] = path.global_root_heading[f];
    root.premultiply(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(sin, cos) - current),
    );
    root.normalize().toArray(motion.rotations, f * 120);
  }
}
