import type { ImagePose } from '../../src/pose-reference';
/** Synthetic MediaPipe camera-space landmarks for geometric regression tests. */
export function standingPose(raised = false): ImagePose {
  const world: ImagePose['world'] = Array.from({ length: 33 }, () => [0, -0.65, 0]);
  const points: Record<number, [number, number, number]> = {
    7: [.07, -.65, 0], 8: [-.07, -.65, 0],
    11: [.2, -.45, 0], 12: [-.2, -.45, 0],
    13: [.48, -.45, 0], 14: [-.48, -.45, 0],
    15: [.73, -.45, 0], 16: [-.73, -.45, 0],
    17: [.8, -.45, 0], 18: [-.8, -.45, 0],
    19: [.82, -.45, 0], 20: [-.82, -.45, 0],
    23: [.1, 0, 0], 24: [-.1, 0, 0],
    25: [.1, .43, 0], 26: [-.1, .43, 0],
    27: [.1, .85, 0], 28: [-.1, .85, 0],
    29: [.1, .86, .02], 30: [-.1, .86, .02],
    31: [.1, .9, -.15], 32: [-.1, .9, -.15],
  };
  for (const [key, value] of Object.entries(points)) world[Number(key)] = value;
  if (raised) {
    world[13] = [.2, -.73, 0]; world[15] = [.2, -.98, 0]; world[19] = [.2, -1.07, 0];
  }
  return { world, confidence: Array(33).fill(1) };
}
