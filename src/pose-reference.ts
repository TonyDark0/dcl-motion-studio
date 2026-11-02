import { z } from 'zod';

const coordinate = z.number().finite().min(-10).max(10);
const point = z.tuple([coordinate, coordinate, coordinate]);
export const imagePoseSchema = z.object({
  world: z.array(point).length(33),
  confidence: z.array(z.number().min(0).max(1)).length(33),
});
export type ImagePose = z.infer<typeof imagePoseSchema>;
export const referenceRequestSchema = z.object({
  start: imagePoseSchema,
  middle: imagePoseSchema.optional(),
  middle2: imagePoseSchema.optional(),
  end: imagePoseSchema.optional(),
  middleTime: z.number().min(0.1).max(0.9).default(0.5),
  middle2Time: z.number().min(0.1).max(0.9).optional(),
});
export type ReferenceRequest = z.infer<typeof referenceRequestSchema>;
const reviewedImageSchema = imagePoseSchema.extend({
  name: z.string().max(256),
  thumbnail: z
    .string()
    .max(1000000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
  landmarks: z.array(point).length(33),
  accepted: z.boolean(),
});
export type ReviewedImage = z.infer<typeof reviewedImageSchema>;
export const poseReferencesSchema = z.object({
  enabled: z.boolean().default(false),
  start: reviewedImageSchema.nullable().default(null),
  middle: reviewedImageSchema.nullable().default(null),
  middle2: reviewedImageSchema.nullable().default(null),
  end: reviewedImageSchema.nullable().default(null),
  middleTime: z.number().min(0.1).max(0.9).default(0.5),
  middle2Time: z.number().min(0.1).max(0.9).default(0.75),
});
export type PoseReferences = z.infer<typeof poseReferencesSchema>;
export const emptyPoseReferences = (): PoseReferences => poseReferencesSchema.parse({});
export function referenceRequest(refs: PoseReferences): ReferenceRequest | undefined {
  if (!refs.enabled) return undefined;
  if (
    !refs.start?.accepted ||
    (refs.middle && !refs.middle.accepted) ||
    (refs.middle2 && !refs.middle2.accepted)
  )
    throw Error('Review and accept the required image poses first.');
  if (refs.middle && refs.middle2 && Math.abs(refs.middleTime - refs.middle2Time) < 0.049)
    throw Error('Choose different times for the middle poses.');
  const numeric = (p: ReviewedImage): ImagePose => ({ world: p.world, confidence: p.confidence });
  return {
    start: numeric(refs.start),
    ...(refs.middle ? { middle: numeric(refs.middle) } : {}),
    ...(refs.middle2 ? { middle2: numeric(refs.middle2) } : {}),
    middleTime: refs.middleTime,
    middle2Time: refs.middle2Time,
  };
}
export const POSE_EDGES = [
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [15, 17],
  [15, 19],
  [16, 18],
  [16, 20],
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
  [7, 8],
];
