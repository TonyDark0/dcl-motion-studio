import type { Capture } from './video-motion.js';

/** Repair only short observation gaps. Raw evidence and the caller stay intact. */
export function repairVideoReferences(input: Capture) {
  const capture = { ...input, positions: [...input.positions], confidence: [...input.confidence] };
  const joints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  for (const joint of joints) {
    const good = (f: number) =>
      input.confidence[f * 33 + joint] >= 0.35 &&
      input.positions.slice(f * 99 + joint * 3, f * 99 + joint * 3 + 3).every(Number.isFinite);
    for (let f = 0; f < input.frames; f++) {
      if (good(f)) continue;
      let a = f - 1,
        b = f + 1;
      while (a >= 0 && !good(a)) a--;
      while (b < input.frames && !good(b)) b++;
      if (a >= 0 && b < input.frames && b - a <= 12) {
        const u = (f - a) / (b - a);
        for (let k = 0; k < 3; k++)
          capture.positions[f * 99 + joint * 3 + k] =
            input.positions[a * 99 + joint * 3 + k] * (1 - u) +
            input.positions[b * 99 + joint * 3 + k] * u;
        capture.confidence[f * 33 + joint] = Math.min(
          input.confidence[a * 33 + joint],
          input.confidence[b * 33 + joint],
        );
      } else {
        const near = a < 0 && b - f <= 6 ? b : b >= input.frames && f - a <= 6 ? a : -1;
        if (near < 0 || near >= input.frames) continue;
        for (let k = 0; k < 3; k++)
          capture.positions[f * 99 + joint * 3 + k] = input.positions[near * 99 + joint * 3 + k];
        capture.confidence[f * 33 + joint] = input.confidence[near * 33 + joint];
      }
    }
  }
  return capture;
}
