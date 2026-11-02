import type { Capture } from './video-motion.js';

const quantile = (values: number[], q: number) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) * q)] : 0;
};
const median = (values: number[]) => quantile(values, 0.5);

/** Support evidence is taken from tracking, not from a drifting generated foot.
 * A raised foot or genuine flight must remain free. Short confidence gaps do not
 * repeatedly release/reacquire a planted foot.
 */
export function capturedFootSupport(capture: Capture, lift = capturedFootLift(capture)) {
  const heights = Array.from({ length: capture.frames }, (_, f) =>
    [
      [27, 29, 31],
      [28, 30, 32],
    ].map((joints) => {
      const points = joints.filter((j) => capture.confidence[f * 33 + j] >= 0.35);
      return points.length
        ? Math.min(...points.map((j) => capture.positions[f * 99 + j * 3 + 1]))
        : NaN;
    }),
  );
  return [0, 1].map((side) => {
    const grounded = heights.map(
      (feet, f) =>
        lift[f] < 0.015 &&
        Number.isFinite(feet[side]) &&
        Number.isFinite(feet[1 - side]) &&
        feet[side] - Math.min(...feet) < 0.065,
    );
    for (let f = 1; f < grounded.length - 1; f++)
      if (!grounded[f] && grounded[f - 1] && grounded[f + 1] && lift[f] < 0.015) grounded[f] = true;
    const weights = grounded.map(() => 0);
    for (let start = 0; start < grounded.length;) {
      if (!grounded[start]) {
        start++;
        continue;
      }
      let end = start + 1;
      while (end < grounded.length && grounded[end]) end++;
      if (end - start >= 4)
        for (let f = start; f < end; f++) {
          const u = Math.min(
            1,
            start === 0 ? 1 : (f - start + 1) / 3,
            end === grounded.length ? 1 : (end - f) / 3,
          );
          weights[f] = u * u * (3 - 2 * u);
        }
      start = end;
    }
    return weights;
  });
}

/** Offline symmetric filter: no causal lag between limbs and camera/root motion. */
export function smoothSamples(values: number[], strength = 1) {
  const clean = values.map((value, i) =>
    i > 0 && i < values.length - 1 ? median(values.slice(i - 1, i + 2)) : value,
  );
  return clean.map((value, i) => {
    if (i === 0 || i === clean.length - 1) return value;
    let sum = 0,
      weight = 0;
    for (let d = -2; d <= 2; d++) {
      const j = Math.max(0, Math.min(clean.length - 1, i + d)),
        w = [1, 4, 6, 4, 1][d + 2];
      sum += clean[j] * w;
      weight += w;
    }
    return value + (sum / weight - value) * strength;
  });
}

/** Estimate common foot lift above one robust floor, rather than treating every
 * pelvis displacement as a jump. Screen evidence corroborates 3D lift when present.
 */
export function capturedFootLift(capture: Capture) {
  const height: number[] = [],
    screen: number[] = [];
  for (let f = 0; f < capture.frames; f++) {
    const hip =
      (capture.positions[f * 99 + 23 * 3 + 1] + capture.positions[f * 99 + 24 * 3 + 1]) / 2;
    const feet = [27, 28, 29, 30, 31, 32]
      .filter((j) => capture.confidence[f * 33 + j] >= 0.35)
      .map(
        (j) => capture.positions[f * 99 + j * 3 + 1] - hip + (capture.trajectory?.[f * 3 + 1] ?? 0),
      );
    height.push(feet.length ? Math.min(...feet) : NaN);
    if (capture.raw.normalized) {
      const time = f / capture.fps,
        times = capture.raw.times;
      let a = 0;
      while (a < times.length - 2 && times[a + 1] < time) a++;
      const b = Math.min(a + 1, times.length - 1),
        u = Math.max(0, Math.min(1, (time - times[a]) / Math.max(1e-6, times[b] - times[a])));
      const ys = [27, 28, 29, 30, 31, 32]
        .filter(
          (j) =>
            Math.min(
              capture.raw.normalized![a * 132 + j * 4 + 3],
              capture.raw.normalized![b * 132 + j * 4 + 3],
            ) >= 0.35,
        )
        .map(
          (j) =>
            capture.raw.normalized![a * 132 + j * 4 + 1] * (1 - u) +
            capture.raw.normalized![b * 132 + j * 4 + 1] * u,
        );
      screen.push(ys.length ? Math.max(...ys) : NaN);
    }
  }
  const floor = quantile(height, 0.05);
  const screenFiltered = screen.length
    ? screen.map((value, i) =>
        median(screen.slice(Math.max(0, i - 1), i + 2).filter(Number.isFinite)),
      )
    : [];
  const imageHeights = capture.raw.normalized
    ? capture.raw.times
        .map((_, i) => {
          const n = capture.raw.normalized!,
            top = Math.min(...[0, 7, 8].map((j) => n[i * 132 + j * 4 + 1]));
          const bottom = Math.max(...[27, 28, 29, 30, 31, 32].map((j) => n[i * 132 + j * 4 + 1]));
          return bottom - top;
        })
        .filter((h) => h > 0.2)
    : [];
  const imageScale = imageHeights.length ? 1.7 / quantile(imageHeights, 0.75) : 2.5;
  const filtered = smoothSamples(height.map((h) => (Number.isFinite(h) ? h : floor)));
  const lift = filtered.map((h, f) => {
    const above = Math.max(0, h - floor);
    // Use the local support envelope, not the lowest image pixel of the entire
    // clip. Forward/back steps and camera perspective otherwise look like flight.
    const screenFloor = quantile(screenFiltered.slice(Math.max(0, f - 18), f + 19), 0.95);
    const bothVisible = [27, 28].every((j) => capture.confidence[f * 33 + j] >= 0.35);
    // Monocular toe/heel locations fluctuate as a shoe rolls over the floor.
    // Demand corroborated lift beyond that band and cap depth-derived height by
    // the image displacement, so scale noise cannot become a 20 cm jump.
    const imageLift = Math.max(0, (screenFloor - screenFiltered[f]) * imageScale - 0.05);
    const visible =
      bothVisible && (!screen.length || (Number.isFinite(screen[f]) && imageLift > 0.07));
    if (!visible || above < 0.045) return 0;
    const u = Math.max(0, Math.min(1, (above - 0.045) / 0.05));
    return Math.min(above, screen.length ? imageLift : above) * u * u * (3 - 2 * u);
  });
  // Brief toe/heel spikes are not sustained flight (six frames at 30 fps).
  for (let start = 0; start < lift.length;) {
    if (lift[start] <= 0) {
      start++;
      continue;
    }
    let end = start + 1;
    while (end < lift.length && lift[end] > 0) end++;
    if (end - start < 6) lift.fill(0, start, end);
    start = end;
  }
  return smoothSamples(lift);
}
