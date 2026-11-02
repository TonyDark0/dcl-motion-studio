/** Fit normalized tracking to the visible video, excluding letterbox margins. */
export function containedVideo(
  width: number,
  height: number,
  containerWidth: number,
  containerHeight: number,
) {
  const scale = Math.min(
    containerWidth / Math.max(1, width),
    containerHeight / Math.max(1, height),
  );
  const w = width * scale,
    h = height * scale;
  return { left: (containerWidth - w) / 2, top: (containerHeight - h) / 2, width: w, height: h };
}
