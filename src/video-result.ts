import { z } from 'zod';

export const processingTimeSchema = z.object({
  captureMs: z.number().finite().min(0).max(86400000),
  generationMs: z.number().finite().min(0).max(86400000),
  totalMs: z.number().finite().min(0).max(172800000),
});
export const videoResultSchema = z.object({
  generationId: z.string().uuid(),
  referenceAvailable: z.boolean(),
  processing: processingTimeSchema,
});
export type VideoResult = z.infer<typeof videoResultSchema>;
export function elapsedLabel(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
