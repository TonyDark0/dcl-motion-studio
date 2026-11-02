// Port of NVIDIA Kimodo constraints.py and KimodoMotionRep.create_conditions.
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
// SPDX-License-Identifier: Apache-2.0
// See native/kimodo/NOTICE.md for upstream revisions and local adaptations.
import { z } from 'zod';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { SOMA_PARENTS, type Motion } from '../src/motion.js';
import { SOMA_OFFSETS } from './soma-offsets.js';

const scalar = z.number().finite().min(-100).max(100);
const vec2 = z.tuple([scalar, scalar]);
const vec3 = z.tuple([scalar, scalar, scalar]);
const indices = z.array(z.number().int().min(0).max(299)).min(1).max(300);
const effector = z.enum(['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'Hips']);
export const constraintSchema = z.union([
  z
    .object({
      type: z.literal('root2d'),
      frame_indices: indices,
      smooth_root_2d: z.array(vec2).min(1).max(300),
      global_root_heading: z.array(vec2).min(1).max(300).optional(),
    })
    .strict(),
  z
    .object({
      type: z.enum([
        'fullbody',
        'end-effector',
        'left-hand',
        'right-hand',
        'left-foot',
        'right-foot',
      ]),
      frame_indices: indices,
      local_joints_rot: z.array(z.array(vec3).length(30)).min(1).max(300),
      root_positions: z.array(vec3).min(1).max(300),
      smooth_root_2d: z.array(vec2).min(1).max(300).optional(),
      joint_names: z.array(effector).min(1).max(5).optional(),
    })
    .strict(),
]);
export const constraintsSchema = z.array(constraintSchema).max(32);
export type Constraint = z.infer<typeof constraintSchema>;
export const MOTION_DIM = 369;
const chains = {
  LeftHand: [13, 15],
  RightHand: [19, 21],
  LeftFoot: [24, 25],
  RightFoot: [28, 29],
  Hips: [0],
};
const aliases = {
  'left-hand': 'LeftHand',
  'right-hand': 'RightHand',
  'left-foot': 'LeftFoot',
  'right-foot': 'RightFoot',
} as const;

export function forwardPose(rotations: number[][], root: number[]) {
  const global: Quaternion[] = [],
    positions: Vector3[] = [];
  rotations.forEach((r, j) => {
    const axis = new Vector3(...r),
      angle = axis.length();
    const local =
      angle > 1e-12
        ? new Quaternion().setFromAxisAngle(axis.divideScalar(angle), angle)
        : new Quaternion();
    const parent = SOMA_PARENTS[j];
    global[j] = parent < 0 ? local : global[parent].clone().multiply(local);
    positions[j] =
      parent < 0
        ? new Vector3(...root)
        : new Vector3(...SOMA_OFFSETS[j]).applyQuaternion(global[parent]).add(positions[parent]);
  });
  const diff = positions[26].clone().sub(positions[22]);
  return { global, positions, heading: Math.atan2(diff.z, -diff.x) };
}

/** Raw, unnormalized [frames,369] tensors. Normalization uses the loaded GGUF statistics. */
export function compileConstraints(input: unknown, frames: number) {
  const constraints = constraintsSchema.parse(input);
  if (!Number.isInteger(frames) || frames < 2 || frames > 300)
    throw Error('Invalid constraint duration');
  const observed = new Float32Array(frames * MOTION_DIM),
    mask = new Float32Array(observed.length);
  const put = (f: number, d: number, value: number) => {
    const i = f * MOTION_DIM + d;
    if (mask[i] && Math.abs(observed[i] - value) > 1e-4)
      throw Error(`Conflicting constraints at frame ${f}`);
    observed[i] = value;
    mask[i] = 1;
  };
  for (const c of constraints) {
    const count = c.frame_indices.length;
    for (const [key, value] of Object.entries(c)) {
      if (key !== 'joint_names' && Array.isArray(value) && value.length !== count)
        throw Error(`Constraint ${key} length must match frame_indices`);
    }
    c.frame_indices.forEach((f, i) => {
      if (f >= frames) throw Error('Constraint frame is outside the generated clip');
      if (c.type === 'root2d') {
        put(f, 0, c.smooth_root_2d[i][0]);
        put(f, 2, c.smooth_root_2d[i][1]);
        if (c.global_root_heading) {
          const [x, z] = c.global_root_heading[i];
          if (Math.abs(Math.hypot(x, z) - 1) > 1e-3)
            throw Error('Heading must be a unit [cos, sin] pair');
          put(f, 3, x);
          put(f, 4, z);
        }
        return;
      }
      const pose = forwardPose(c.local_joints_rot[i], c.root_positions[i]);
      const smooth = c.smooth_root_2d?.[i] ?? [c.root_positions[i][0], c.root_positions[i][2]];
      put(f, 0, smooth[0]);
      put(f, 1, c.root_positions[i][1]);
      put(f, 2, smooth[1]);
      put(f, 3, Math.cos(pose.heading));
      put(f, 4, Math.sin(pose.heading));
      const names =
        c.type === 'end-effector' ? c.joint_names : c.type === 'fullbody' ? [] : [aliases[c.type]];
      if (!names?.length && c.type !== 'fullbody') throw Error('end-effector requires joint_names');
      const positions =
        c.type === 'fullbody'
          ? Array.from({ length: 30 }, (_, j) => j)
          : [...new Set(names!.flatMap((n) => chains[n]))];
      positions.forEach((j) => {
        const p = pose.positions[j];
        put(f, 5 + j * 3, p.x - smooth[0]);
        put(f, 6 + j * 3, p.y);
        put(f, 7 + j * 3, p.z - smooth[1]);
      });
      for (const name of names!) {
        const j = chains[name][0],
          e = new Matrix4().makeRotationFromQuaternion(pose.global[j]).elements;
        [e[0], e[1], e[2], e[4], e[5], e[6]].forEach((v, d) => put(f, 95 + j * 6 + d, v));
      }
    });
  }
  if ((mask[0] && Math.abs(observed[0]) > 1e-4) || (mask[2] && Math.abs(observed[2]) > 1e-4))
    throw Error('The smooth root must start at XZ (0, 0)');
  return {
    observed,
    mask,
    firstHeading: mask[3] && mask[4] ? Math.atan2(observed[4], observed[3]) : 0,
  };
}

export function loopConstraints(
  m: Extract<Motion, { skeleton: 'soma30' }>,
  inPlace: boolean,
): Constraint[] {
  const rotations = Array.from({ length: 30 }, (_, j) => {
    const q = new Quaternion().fromArray(m.rotations, j * 4).normalize();
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    const sin = Math.hypot(q.x, q.y, q.z),
      angle = 2 * Math.atan2(sin, q.w);
    return (sin < 1e-9 ? [0, 0, 0] : [q.x, q.y, q.z].map((v) => (v * angle) / sin)) as [
      number,
      number,
      number,
    ];
  });
  const root: [number, number, number] = [0, m.roots[1], 0];
  const pose = {
    frame_indices: [0, m.frames - 1],
    local_joints_rot: [rotations, rotations],
    root_positions: [root, root],
  };
  return [
    { type: 'fullbody', ...pose },
    {
      type: 'end-effector',
      ...pose,
      joint_names: ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'],
    },
    {
      type: 'root2d',
      frame_indices: inPlace ? Array.from({ length: m.frames }, (_, i) => i) : [0, m.frames - 1],
      smooth_root_2d: Array.from({ length: inPlace ? m.frames : 2 }, () => [0, 0]),
    },
  ];
}
