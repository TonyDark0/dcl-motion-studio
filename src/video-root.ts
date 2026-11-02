import type { Observation } from './video-motion.js';

const median = (values: number[]) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};
export function unwrapAngles(angles: number[]) {
  const out = [...angles];
  for (let i = 1; i < out.length; i++) {
    while (out[i] - out[i - 1] > Math.PI) out[i] -= 2 * Math.PI;
    while (out[i] - out[i - 1] < -Math.PI) out[i] += 2 * Math.PI;
  }
  return out;
}

/** Fixed-camera, Y-up trajectory. Never derive depth from an articulated bounding box. */
export function estimateVideoRoot(raw: Observation[]): number[][] {
  const calibrated = raw.every((r) => r.sam?.cameraTranslation && r.sam.score >= 0.5);
  let camera: number[][];
  if (calibrated) {
    // SAM keypoints are camera-oriented but not camera-translated (see its projection code).
    camera = raw.map((r) =>
      r.sam!.cameraTranslation!.map(
        (v, axis) =>
          (v + (r.sam!.keypoints3d[9 * 3 + axis] + r.sam!.keypoints3d[10 * 3 + axis]) / 2) *
          (axis === 0 ? 1 : -1),
      ),
    );
  } else {
    const pairs = [
      [11, 23],
      [12, 24],
      [23, 25],
      [24, 26],
      [25, 27],
      [26, 28],
    ];
    const scales = raw.map((r) => {
      if (!r.normalized) return NaN;
      const aspect = r.aspectRatio ?? 1;
      return median(
        pairs.map(([a, b]) => {
          if (
            Math.min(
              r.normalized![a * 4 + 3],
              r.normalized![b * 4 + 3],
              r.body[a * 4 + 3],
              r.body[b * 4 + 3],
            ) < 0.35
          )
            return NaN;
          const screen = Math.hypot(
            (r.normalized![a * 4] - r.normalized![b * 4]) * aspect,
            r.normalized![a * 4 + 1] - r.normalized![b * 4 + 1],
          );
          const projected = Math.hypot(
            r.body[a * 4] - r.body[b * 4],
            r.body[a * 4 + 1] - r.body[b * 4 + 1],
          );
          return screen > 0.025 && projected > 0.08 ? projected / screen : NaN;
        }),
      );
    });
    const fallback = median(scales);
    camera = raw.map((r, i) => {
      if (!r.normalized || !Number.isFinite(fallback)) return [0, 0, 0];
      const scale = Number.isFinite(scales[i]) ? scales[i] : fallback;
      const hipX = (r.normalized[23 * 4] + r.normalized[24 * 4]) / 2;
      const hipY = (r.normalized[23 * 4 + 1] + r.normalized[24 * 4 + 1]) / 2;
      const focalY = r.calibration?.focalY ?? 1.07225346; // 50 degree fallback vertical FOV
      return [(hipX - 0.5) * scale * (r.aspectRatio ?? 1), (0.5 - hipY) * scale, -scale * focalY];
    });
  }
  // Reject isolated camera-estimation spikes without cancelling sustained travel or take-off.
  const filtered = camera.map((p, i) =>
    p.map((v, axis) =>
      i > 0 && i < camera.length - 1 ? median([camera[i - 1][axis], v, camera[i + 1][axis]]) : v,
    ),
  );
  return filtered.map((p) => p.map((v, axis) => v - filtered[0][axis]));
}
