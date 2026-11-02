/** Sampling is in the studio's 30 FPS timebase, independent of decoder/tracker FPS. */
export const REFERENCE_POSE_STRIDE = 10;
export function referenceFrames(frames: number, stride: 10 | 15 = REFERENCE_POSE_STRIDE): number[] {
  if (!Number.isInteger(frames) || frames < 2 || frames > 300)
    throw Error('Invalid reference duration.');
  const indices = Array.from({ length: Math.ceil(frames / stride) }, (_, i) => i * stride);
  if (indices.at(-1) !== frames - 1) indices.push(frames - 1);
  return indices;
}
