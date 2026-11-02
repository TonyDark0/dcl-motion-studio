import type { SamFrame } from './video-motion.js';

export type CaptureSample = {
  body: number[][];
  confidence: number[];
  details: number[][];
  detailConfidence: number[];
};

type V = [number, number, number];
const v = (p: number[]): V => [p[0] || 0, p[1] || 0, p[2] || 0];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, n: number): V => [a[0] * n, a[1] * n, a[2] * n];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: V) => Math.hypot(...a);
const unit = (a: V): V => {
  const n = length(a);
  return n > 1e-8 ? mul(a, 1 / n) : [0, 1, 0];
};
const mix = (a: V, b: V, t: number): V => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const smoothstep = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const median = (values: number[]) => {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const m = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[m] : (clean[m - 1] + clean[m]) / 2;
};

// SAM 3D Body MHR70 keypoints mapped to MediaPipe Pose and our compact hand/foot detail layout.
const SAM_BODY = new Map<number, number>([
  [0, 0],
  [2, 1],
  [5, 2],
  [7, 3],
  [8, 4],
  [11, 5],
  [12, 6],
  [13, 7],
  [14, 8],
  [15, 62],
  [16, 41],
  [23, 9],
  [24, 10],
  [25, 11],
  [26, 12],
  [27, 13],
  [28, 14],
  [29, 17],
  [30, 20],
  [31, 15],
  [32, 18],
]);
const SAM_LEFT_HAND = [
  62, 45, 44, 43, 42, 49, 48, 47, 46, 53, 52, 51, 50, 57, 56, 55, 54, 61, 60, 59, 58,
];
const SAM_RIGHT_HAND = [
  41, 24, 23, 22, 21, 28, 27, 26, 25, 32, 31, 30, 29, 36, 35, 34, 33, 40, 39, 38, 37,
];
const SAM_DETAILS = [...SAM_LEFT_HAND, ...SAM_RIGHT_HAND, 15, 16, 17, 18, 19, 20];
const SCALE_PAIRS = [
  [5, 6],
  [5, 7],
  [6, 8],
  [9, 11],
  [10, 12],
  [11, 13],
  [12, 14],
];

export function fuseSamFrame(sample: CaptureSample, sam: SamFrame): CaptureSample {
  if (sam.keypoints3d.length < 210) return sample;
  const keypoint = (i: number): V => [
    sam.keypoints3d[i * 3],
    -sam.keypoints3d[i * 3 + 1],
    -sam.keypoints3d[i * 3 + 2],
  ];
  const samHip = mul(add(keypoint(9), keypoint(10)), 0.5);
  const fastHip = mul(add(v(sample.body[23]), v(sample.body[24])), 0.5);
  const ratios = SCALE_PAIRS.map(([a, b]) => {
    const mpA = [...SAM_BODY].find(([, s]) => s === a)?.[0];
    const mpB = [...SAM_BODY].find(([, s]) => s === b)?.[0];
    if (mpA == null || mpB == null) return NaN;
    const source = length(sub(keypoint(a), keypoint(b)));
    return source > 1e-5 ? length(sub(v(sample.body[mpA]), v(sample.body[mpB]))) / source : NaN;
  });
  const scale = clamp(median(ratios), 0.25, 4);
  const aligned = (index: number): V => add(fastHip, mul(sub(keypoint(index), samHip), scale));
  const bodyHeight = Math.max(0.5, length(sub(v(sample.body[0]), fastHip)) * 2);
  const globalScore = clamp(sam.score ?? 0.8, 0, 1);
  for (const [mp, si] of SAM_BODY) {
    const fast = v(sample.body[mp]),
      pro = aligned(si),
      delta = length(sub(fast, pro)) / bodyHeight;
    const agreement = 1 - smoothstep((delta - 0.04) / 0.2);
    const fastScore = clamp(sample.confidence[mp] || 0, 0, 1);
    // SAM is primary in Pro mode, but disagreement and strong MediaPipe confidence limit it.
    const weight = clamp(
      globalScore * (0.48 + 0.28 * (1 - fastScore) + 0.2 * agreement),
      0.18,
      0.88,
    );
    sample.body[mp] = mix(fast, pro, weight);
    sample.confidence[mp] = clamp(
      Math.max(fastScore * (1 - weight * 0.35), globalScore * weight),
      0,
      1,
    );
  }
  for (let i = 0; i < SAM_DETAILS.length; i++) {
    const fast = v(sample.details[i]),
      pro = aligned(SAM_DETAILS[i]);
    const fastScore = clamp(sample.detailConfidence[i] || 0, 0, 1);
    const weight = clamp(globalScore * (0.58 + 0.25 * (1 - fastScore)), 0.25, 0.9);
    sample.details[i] = mix(fast, pro, weight);
    sample.detailConfidence[i] = clamp(
      Math.max(fastScore * (1 - weight * 0.3), globalScore * weight),
      0,
      1,
    );
  }
  return sample;
}

const BODY_BONES: [number, number][] = [
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [27, 31],
  [28, 30],
  [28, 32],
];
const DETAIL_BONES: [number, number][] = [];
for (const offset of [0, 21])
  for (let finger = 0; finger < 5; finger++) {
    const root = offset + 1 + finger * 4;
    DETAIL_BONES.push([offset, root], [root, root + 1], [root + 1, root + 2], [root + 2, root + 3]);
  }

function angle(a: V, b: V, c: V) {
  const ba = unit(sub(a, b)),
    bc = unit(sub(c, b));
  return Math.acos(clamp(dot(ba, bc), -1, 1));
}

function robustBadFrames(samples: CaptureSample[], times: number[]) {
  const perFrame = samples.map((sample) => {
    const deviations = BODY_BONES.map(([a, b]) =>
      length(sub(v(sample.body[a]), v(sample.body[b]))),
    );
    return deviations;
  });
  const expected = BODY_BONES.map((_, bone) => median(perFrame.map((frame) => frame[bone])));
  const scores = perFrame.map((frame) =>
    Math.max(
      ...frame.map((n, bone) => Math.abs(n - expected[bone]) / Math.max(expected[bone], 1e-4)),
    ),
  );
  const center = median(scores),
    mad = median(scores.map((n) => Math.abs(n - center)));
  const threshold = Math.max(0.1, center + 6 * mad);
  const bad = scores.map((n) => n > threshold || !Number.isFinite(n));

  // Reject isolated whole-pose jumps. This catches detector identity/depth swaps that
  // preserve bone lengths and therefore pass the structural test above.
  const velocity = samples.map((sample, i) => {
    if (!i) return 0;
    const dt = Math.max(1 / 120, times[i] - times[i - 1]);
    return median(
      [11, 12, 15, 16, 23, 24, 27, 28].map(
        (j) => length(sub(v(sample.body[j]), v(samples[i - 1].body[j]))) / dt,
      ),
    );
  });
  const velocityCenter = median(velocity.slice(1));
  const velocityMad = median(velocity.slice(1).map((n) => Math.abs(n - velocityCenter)));
  const velocityLimit = Math.max(1.5, velocityCenter + 8 * velocityMad);
  for (let i = 1; i < samples.length; i++) if (velocity[i] > velocityLimit) bad[i] = true;

  // A one-frame collapse to a neutral/T-like pose is a common monocular failure.
  // Compare articulation to both neighbours so legitimate sustained straightening remains.
  const articulation = samples.map(
    (s) =>
      angle(v(s.body[11]), v(s.body[13]), v(s.body[15])) +
      angle(v(s.body[12]), v(s.body[14]), v(s.body[16])) +
      angle(v(s.body[23]), v(s.body[25]), v(s.body[27])) +
      angle(v(s.body[24]), v(s.body[26]), v(s.body[28])),
  );
  for (let i = 1; i < samples.length - 1; i++) {
    const neighbour = (articulation[i - 1] + articulation[i + 1]) / 2;
    if (
      Math.abs(articulation[i - 1] - articulation[i + 1]) < 0.45 &&
      Math.abs(articulation[i] - neighbour) > 1.35
    )
      bad[i] = true;
  }
  return bad;
}

function interpolateBadRuns(samples: CaptureSample[], bad: boolean[]) {
  let repaired = 0;
  for (let start = 0; start < bad.length;) {
    if (!bad[start]) {
      start++;
      continue;
    }
    let end = start + 1;
    while (end < bad.length && bad[end]) end++;
    const left = start - 1,
      right = end < samples.length ? end : -1;
    for (let i = start; i < end; i++) {
      const t = left >= 0 && right >= 0 ? (i - left) / (right - left) : 0;
      for (const field of ['body', 'details'] as const)
        for (let j = 0; j < samples[i][field].length; j++) {
          if (left >= 0 && right >= 0)
            samples[i][field][j] = mix(v(samples[left][field][j]), v(samples[right][field][j]), t);
          else if (left >= 0) samples[i][field][j] = [...samples[left][field][j]];
          else if (right >= 0) samples[i][field][j] = [...samples[right][field][j]];
        }
      repaired++;
    }
    start = end;
  }
  return repaired;
}

function fillLowConfidence(
  samples: CaptureSample[],
  times: number[],
  field: 'body' | 'details',
  confidence: 'confidence' | 'detailConfidence',
  threshold: number,
) {
  const count = samples[0]?.[field].length || 0;
  // Search original evidence, never a previously filled sample; otherwise
  // short repairs can propagate through an arbitrarily long tracking loss.
  const original = samples.map((s) => ({
    points: s[field].map((p) => [...p]),
    confidence: [...s[confidence]],
  }));
  for (let joint = 0; joint < count; joint++)
    for (let i = 0; i < samples.length; i++) {
      if (original[i].confidence[joint] >= threshold) continue;
      let a = i - 1,
        b = i + 1;
      while (a >= 0 && original[a].confidence[joint] < threshold) a--;
      while (b < samples.length && original[b].confidence[joint] < threshold) b++;
      if (a >= 0 && b < samples.length && times[b] - times[a] <= 0.45) {
        const t = (times[i] - times[a]) / Math.max(1e-6, times[b] - times[a]);
        samples[i][field][joint] = mix(
          v(original[a].points[joint]),
          v(original[b].points[joint]),
          t,
        );
        samples[i][confidence][joint] = Math.min(
          original[a].confidence[joint],
          original[b].confidence[joint],
        );
      } else if (a >= 0 && times[i] - times[a] <= 0.2) {
        samples[i][field][joint] = [...original[a].points[joint]];
        samples[i][confidence][joint] = original[a].confidence[joint];
      } else if (a < 0 && b < samples.length && times[b] - times[i] <= 0.2) {
        samples[i][field][joint] = [...original[b].points[joint]];
        samples[i][confidence][joint] = original[b].confidence[joint];
      }
    }
}

function oneEuro(
  samples: CaptureSample[],
  times: number[],
  field: 'body' | 'details',
  amount: number,
) {
  if (!samples.length || amount <= 0) return;
  const count = samples[0][field].length,
    minCutoff = 0.8 + (1 - amount) * 3.5,
    beta = 0.05 + (1 - amount) * 0.18;
  const alpha = (cutoff: number, dt: number) =>
    1 / (1 + 1 / (2 * Math.PI * cutoff * Math.max(dt, 1 / 120)));
  for (let joint = 0; joint < count; joint++)
    for (let axis = 0; axis < 3; axis++) {
      let x = samples[0][field][joint][axis],
        dx = 0;
      for (let i = 1; i < samples.length; i++) {
        const dt = times[i] - times[i - 1],
          raw = samples[i][field][joint][axis];
        const derivative = (raw - x) / Math.max(dt, 1 / 120),
          ad = alpha(1, dt);
        dx += ad * (derivative - dx);
        const ax = alpha(minCutoff + beta * Math.abs(dx), dt);
        x += ax * (raw - x);
        samples[i][field][joint][axis] = x;
      }
    }
}

function depthDeadZone(samples: CaptureSample[], times: number[], field: 'body' | 'details') {
  if (samples.length < 3) return;
  const count = samples[0][field].length;
  for (let joint = 0; joint < count; joint++) {
    const raw = samples.map((s) => s[field][joint][2]);
    const baseline = [...raw];
    for (let i = 1; i < raw.length; i++) {
      const a = 1 - Math.exp(-(times[i] - times[i - 1]) / 0.22);
      baseline[i] = baseline[i - 1] + a * (raw[i] - baseline[i - 1]);
    }
    for (let i = raw.length - 2; i >= 0; i--) {
      const a = 1 - Math.exp(-(times[i + 1] - times[i]) / 0.22);
      baseline[i] = baseline[i + 1] + a * (baseline[i] - baseline[i + 1]);
    }
    const residuals = raw.map((n, i) => Math.abs(n - baseline[i]));
    const noise = Math.max(0.0025, median(residuals) * 2.5);
    for (let i = 0; i < raw.length; i++) {
      const scale = smoothstep((residuals[i] - noise) / Math.max(noise, 1e-5));
      samples[i][field][joint][2] = baseline[i] + (raw[i] - baseline[i]) * scale;
    }
  }
}

function rigidify(
  samples: CaptureSample[],
  field: 'body' | 'details',
  bones: [number, number][],
  confidence: 'confidence' | 'detailConfidence',
) {
  const lengths = bones.map(([a, b]) =>
    median(
      samples
        .filter((s) => Math.min(s[confidence][a], s[confidence][b]) > 0.35)
        .map((s) => length(sub(v(s[field][b]), v(s[field][a])))),
    ),
  );
  for (const sample of samples)
    bones.forEach(([a, b], index) => {
      const direction = sub(v(sample[field][b]), v(sample[field][a])),
        target = lengths[index];
      if (target > 1e-5 && length(direction) > 1e-6)
        sample[field][b] = add(v(sample[field][a]), mul(unit(direction), target));
    });
}

export function cleanCaptureSamples(input: CaptureSample[], times: number[], smoothing: number) {
  const samples = input.map((s) => ({
    body: s.body.map((p) => [...p]),
    confidence: [...s.confidence],
    details: s.details.map((p) => [...p]),
    detailConfidence: [...s.detailConfidence],
  }));
  const bad = robustBadFrames(samples, times),
    repaired = interpolateBadRuns(samples, bad);
  fillLowConfidence(samples, times, 'body', 'confidence', 0.35);
  fillLowConfidence(samples, times, 'details', 'detailConfidence', 0.2);
  oneEuro(samples, times, 'body', smoothing);
  oneEuro(samples, times, 'details', smoothing * 0.85);
  depthDeadZone(samples, times, 'body');
  depthDeadZone(samples, times, 'details');
  rigidify(samples, 'body', BODY_BONES, 'confidence');
  rigidify(samples, 'details', DETAIL_BONES, 'detailConfidence');
  // SOMAHand fits articulation after resampling; never flatten fingers into the palm plane.
  return { samples, repaired };
}
