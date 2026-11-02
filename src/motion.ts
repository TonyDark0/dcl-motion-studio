import { z } from 'zod';
import { captureSchema } from './video-motion.js';
import { poseReferencesSchema, emptyPoseReferences } from './pose-reference.js';
import { emoteStyleSchema } from './emote-style.js';
import { processingTimeSchema, videoResultSchema } from './video-result.js';
export const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const kimodoSchema = z
  .object({
    version: z.literal(1),
    skeleton: z.literal('soma30'),
    fps: z.literal(30),
    frames: z.number().int().min(30).max(300),
    prompt: z.string().max(2000),
    seed: z.number().int().nonnegative(),
    roots: z.array(z.number().finite()),
    rotations: z.array(z.number().finite()),
    source: z.literal('kimodo.cpp'),
    generationId: z.string().uuid().optional(),
    generation: z
      .object({
        conditioning: z.literal('soma30-v1'),
        video: z
          .object({
            provider: z.enum(['mediapipe+rtmw3d', 'sam3d-hybrid']),
            poseStride: z.union([z.literal(10), z.literal(15)]),
            poseSpace: z.literal('dcl-fk-to-soma-v1').optional(),
            cleanup: z
              .object({
                version: z.literal('dcl-ground-smooth-v1'),
                airborneFrames: z.number().int().nonnegative(),
                contactFrames: z.tuple([
                  z.number().int().nonnegative(),
                  z.number().int().nonnegative(),
                ]),
              })
              .optional(),
            file: z.string().max(255),
            rootSpace: z.literal('camera-y-up-v2').optional(),
            processing: processingTimeSchema.optional(),
            referenceAvailable: z.boolean().optional(),
          })
          .optional(),
        loop: z.boolean(),
        rootMotion: z.enum(['inPlace', 'source']),
      })
      .optional(),
  })
  .superRefine((m, c) => {
    if (m.roots.length !== m.frames * 3 || m.rotations.length !== m.frames * 30 * 4)
      c.addIssue({ code: 'custom', message: 'Invalid motion dimensions' });
    for (let i = 0; i < m.rotations.length; i += 4) {
      const n = Math.hypot(...m.rotations.slice(i, i + 4));
      if (n < 0.9 || n > 1.1) {
        c.addIssue({ code: 'custom', message: 'Invalid quaternion' });
        break;
      }
    }
  });
export const motionSchema = z.union([kimodoSchema, captureSchema]);
export type Motion = z.infer<typeof motionSchema>;
export const handPoseSchema = z.enum(['relaxed', 'open', 'fist', 'point', 'clap']);
export type HandPose = z.infer<typeof handPoseSchema>;
export const controlSchema = z.object({
  leftFootRotation: vector.default([0, 0, 0]),
  rightFootRotation: vector.default([0, 0, 0]),
  leftHandRotation: vector.default([0, 0, 0]),
  rightHandRotation: vector.default([0, 0, 0]),
  leftFoot: vector,
  rightFoot: vector,
  leftHand: vector,
  rightHand: vector,
  pelvis: z.number().min(-0.4).max(0.15),
  knee: z.number().min(-0.5).max(0.8),
  elbow: z.number().min(-0.8).max(0.8),
  handIK: z.boolean(),
  ground: z.boolean(),
});
export type Controls = z.infer<typeof controlSchema>;
export const defaults: Controls = {
  leftFootRotation: [0, 0, 0],
  rightFootRotation: [0, 0, 0],
  leftHandRotation: [0, 0, 0],
  rightHandRotation: [0, 0, 0],
  leftFoot: [0, 0, 0],
  rightFoot: [0, 0, 0],
  leftHand: [0, 0, 0],
  rightHand: [0, 0, 0],
  pelvis: 0,
  knee: 0.35,
  elbow: -0.3,
  handIK: false,
  ground: false,
};
export const animationSourceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(100),
    preset: z.enum(['idle', 'squat', 'wave', 'motion']),
    duration: z
      .number()
      .finite()
      .min(1 / 30)
      .max(120),
    motion: motionSchema.nullable(),
    handMode: z.enum(['none', 'procedural', 'reference']),
    handPoseStart: handPoseSchema,
    handPoseEnd: handPoseSchema,
    handReference: captureSchema.nullable(),
    handWristInfluence: z.number().min(0).max(1),
    smoothing: z.number().min(0).max(1).default(0),
    videoResult: videoResultSchema.nullable().default(null),
  })
  .refine((s) => s.preset !== 'motion' || !!s.motion, 'Animation source is missing');
export const stripSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  trackId: z.string().min(1),
  start: z.number().finite().min(0).max(120),
  in: z.number().finite().min(0),
  out: z.number().finite().positive(),
  speed: z.number().finite().min(0.1).max(4),
  repeat: z.number().int().min(1).max(32),
  influence: z.number().min(0).max(1),
  fadeIn: z.number().min(0).max(120),
  fadeOut: z.number().min(0).max(120),
  curve: z.enum(['linear', 'smooth']),
  blend: z.enum(['replace', 'additive']),
  mask: z.enum([
    'body',
    'upper',
    'lower',
    'leftArm',
    'rightArm',
    'hands',
    'fingers',
    'wrists',
    'root',
  ]),
  reference: z.number().finite().min(0),
  muted: z.boolean(),
  alignRoot: z.boolean(),
});
export const timelineSchema = z
  .object({
    assets: z.array(animationSourceSchema).max(32),
    tracks: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().max(80),
          kind: z.enum(['body', 'hands']).optional(),
          muted: z.boolean(),
          solo: z.boolean(),
          locked: z.boolean(),
        }),
      )
      .max(64),
    strips: z.array(stripSchema).max(64),
    loopPlayback: z.boolean(),
    seamless: z.boolean(),
    seamDuration: z.number().min(0.1).max(2),
    rangeStart: z.number().min(0).max(120),
    rangeEnd: z.number().positive().max(120),
    exportRange: z.boolean(),
  })
  .superRefine((tl, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    for (const items of [tl.assets, tl.tracks, tl.strips])
      if (new Set(items.map((x) => x.id)).size !== items.length) fail('Duplicate timeline ID');
    if (tl.rangeEnd <= tl.rangeStart) fail('Invalid timeline range');
    for (const s of tl.strips) {
      const a = tl.assets.find((a) => a.id === s.assetId);
      if (!a || !tl.tracks.some((t) => t.id === s.trackId)) fail('Missing clip source or layer');
      if (
        s.out - s.in < 1 / 30 - 1e-6 ||
        (a && (s.out > a.duration + 1e-6 || s.reference > a.duration))
      )
        fail('Invalid clip source range');
      if (s.start + ((s.out - s.in) * s.repeat) / s.speed > 120 + 1e-6)
        fail('Timeline exceeds 120 seconds');
    }
  });
export type AnimationSource = z.infer<typeof animationSourceSchema>;
export type Strip = z.infer<typeof stripSchema>;
export type TimelineData = z.infer<typeof timelineSchema>;

export const projectSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]).transform(() => 2 as const),
    timeline: timelineSchema.nullable().default(null),
    poseReferences: poseReferencesSchema.default(emptyPoseReferences),
    workflow: z.enum(['text', 'video']).default('text'),
    thumbnail: z
      .string()
      .max(300000)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
      .nullable()
      .default(null),
    name: z.string().min(1).max(100),
    animationName: z.string().max(100).default('DCL_Motion'),
    avatar: z
      .union([z.literal('Avatar'), z.literal('A'), z.literal('B')])
      .transform(() => 'Avatar' as const)
      .default('Avatar'),
    skinColor: vector.default([0.80078125, 0.609375, 0.46484375]),
    hairColor: vector.default([0.234375, 0.12890625, 0.04296875]),
    rootMotion: z.enum(['source', 'inPlace']).default('inPlace'),
    handMode: z.enum(['none', 'procedural', 'reference']).default('none'),
    handPoseStart: handPoseSchema.default('relaxed'),
    handPoseEnd: handPoseSchema.default('fist'),
    handReference: captureSchema.nullable().default(null),
    handWristInfluence: z.number().min(0).max(1).default(0),
    smoothing: z.number().min(0).max(1).default(0),
    videoResult: videoResultSchema.nullable().default(null),
    preset: z.enum(['idle', 'squat', 'wave', 'motion']),
    duration: z
      .number()
      .min(1 / 30)
      .max(120),
    controls: controlSchema,
    motion: motionSchema.nullable(),
    prompt: z.string().max(2000),
    emoteStyle: emoteStyleSchema.nullable().default(null),
    seed: z.number().int().nonnegative(),
    keyframes: z
      .array(z.object({ time: z.number().min(0).max(120), controls: controlSchema }))
      .max(3601),
  })
  .superRefine((p, c) => {
    if (p.preset === 'motion' && !p.motion)
      c.addIssue({ code: 'custom', message: 'Project motion is missing' });
    if (
      p.timeline &&
      (p.timeline.rangeEnd > p.duration + 1e-6 ||
        p.timeline.strips.some(
          (s) => s.start + ((s.out - s.in) * s.repeat) / s.speed > p.duration + 1e-6,
        ))
    )
      c.addIssue({ code: 'custom', message: 'Timeline clips or range exceed project duration' });
  });
export type Project = z.infer<typeof projectSchema>;
export const newProject = (): Project => ({
  version: 2,
  timeline: null,
  poseReferences: emptyPoseReferences(),
  name: 'My first animation',
  workflow: 'text',
  thumbnail: null,
  animationName: 'DCL_Motion',
  avatar: 'Avatar',
  skinColor: [0.80078125, 0.609375, 0.46484375],
  hairColor: [0.234375, 0.12890625, 0.04296875],
  rootMotion: 'source',
  handMode: 'none',
  handPoseStart: 'relaxed',
  handPoseEnd: 'fist',
  handReference: null,
  handWristInfluence: 0,
  smoothing: 0,
  videoResult: null,
  preset: 'idle',
  duration: 4,
  controls: structuredClone(defaults),
  motion: null,
  prompt: 'A person waves hello with their right hand, standing in place.',
  emoteStyle: null,
  seed: 42,
  keyframes: [],
});
export const SOMA_NAMES = [
  'Hips',
  'Spine1',
  'Spine2',
  'Chest',
  'Neck1',
  'Neck2',
  'Head',
  'Jaw',
  'LeftEye',
  'RightEye',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'LeftHandThumbEnd',
  'LeftHandMiddleEnd',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'RightHandThumbEnd',
  'RightHandMiddleEnd',
  'LeftLeg',
  'LeftShin',
  'LeftFoot',
  'LeftToeBase',
  'RightLeg',
  'RightShin',
  'RightFoot',
  'RightToeBase',
];
export const SOMA_PARENTS = [
  -1, 0, 1, 2, 3, 4, 5, 6, 6, 6, 3, 10, 11, 12, 13, 13, 3, 16, 17, 18, 19, 19, 0, 22, 23, 24, 0, 26,
  27, 28,
];
export const mapping: Record<string, string> = {
  Hips: 'Hips',
  Spine1: 'Spine',
  Spine2: 'Spine1',
  Chest: 'Spine2',
  // SOMA has two neck joints. DCL's single neck carries their accumulated
  // rotation, leaving only the source Head rotation on the DCL head joint.
  Neck2: 'Neck',
  Head: 'Head',
  LeftShoulder: 'LeftShoulder',
  LeftArm: 'LeftArm',
  LeftForeArm: 'LeftForeArm',
  LeftHand: 'LeftHand',
  RightShoulder: 'RightShoulder',
  RightArm: 'RightArm',
  RightForeArm: 'RightForeArm',
  RightHand: 'RightHand',
  LeftLeg: 'LeftUpLeg',
  LeftShin: 'LeftLeg',
  LeftFoot: 'LeftFoot',
  LeftToeBase: 'LeftToeBase',
  RightLeg: 'RightUpLeg',
  RightShin: 'RightLeg',
  RightFoot: 'RightFoot',
  RightToeBase: 'RightToeBase',
};
export function controlsAt(p: Project, t: number): Controls {
  if (!p.keyframes.length) return structuredClone(p.controls);
  const keys = [...p.keyframes].sort((a, b) => a.time - b.time);
  const a = [...keys].reverse().find((k) => k.time <= t) || keys[0];
  const b = keys.find((k) => k.time > t) || a;
  const u = b.time === a.time ? 0 : Math.max(0, Math.min(1, (t - a.time) / (b.time - a.time)));
  const c = structuredClone(a.controls);
  for (const key of [
    'leftFoot',
    'rightFoot',
    'leftHand',
    'rightHand',
    'leftFootRotation',
    'rightFootRotation',
    'leftHandRotation',
    'rightHandRotation',
  ] as const)
    c[key] = a.controls[key].map((n, i) => n + (b.controls[key][i] - n) * u) as [
      number,
      number,
      number,
    ];
  for (const key of ['pelvis', 'knee', 'elbow'] as const)
    c[key] = a.controls[key] + (b.controls[key] - a.controls[key]) * u;
  const tl = p.timeline;
  if (tl?.seamless) {
    const span = Math.min(tl.seamDuration, (tl.rangeEnd - tl.rangeStart) / 2);
    if (t > tl.rangeEnd - span && t <= tl.rangeEnd) {
      const first = controlsAt({ ...p, timeline: null }, tl.rangeStart);
      const x = (t - (tl.rangeEnd - span)) / span,
        w = x * x * (3 - 2 * x);
      for (const key of [
        'leftFoot',
        'rightFoot',
        'leftHand',
        'rightHand',
        'leftFootRotation',
        'rightFootRotation',
        'leftHandRotation',
        'rightHandRotation',
      ] as const)
        c[key] = c[key].map((n, i) => n + (first[key][i] - n) * w) as [number, number, number];
      for (const key of ['pelvis', 'knee', 'elbow'] as const) c[key] += (first[key] - c[key]) * w;
      if (w >= 0.5) {
        c.ground = first.ground;
        c.handIK = first.handIK;
      }
    }
  }
  return c;
}
