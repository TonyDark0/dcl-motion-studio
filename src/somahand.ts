import { Matrix4, Quaternion, Vector3 } from 'three';
import prior from './assets/somahand-prior.json' with { type: 'json' };
import type { Capture } from './video-motion.js';
import { referenceFrames, REFERENCE_POSE_STRIDE } from './pose-sampling.js';

type Side = 'left' | 'right';
const landmarkJoints = [0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24];
const segments = [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19];
const models = Object.fromEntries(
  (['left', 'right'] as const).map((side) => {
    const data = prior[side];
    return [
      side,
      {
        ...data,
        offsets: data.offsets.map((p) => new Vector3().fromArray(p)),
        reference: data.orient.map((r) =>
          new Quaternion()
            .setFromRotationMatrix(
              new Matrix4().set(
                ...([...r[0], 0, ...r[1], 0, ...r[2], 0, 0, 0, 0, 1] as Parameters<Matrix4['set']>),
              ),
            )
            .normalize(),
        ),
      },
    ];
  }),
) as Record<
  Side,
  Omit<typeof prior.left, 'offsets'> & { offsets: Vector3[]; reference: Quaternion[] }
>;

/** Official bind-relative expmap PCA. Wrist is deliberately outside the 72-D prior. */
export function somaHandLandmarks(side: Side, coefficients: number[]): Vector3[] {
  const m = models[side],
    global: Quaternion[] = [],
    points: Vector3[] = [];
  for (let j = 0; j < 25; j++) {
    if (!j) {
      global.push(new Quaternion());
      points.push(new Vector3());
      continue;
    }
    const a = new Vector3().fromArray(m.mean, (j - 1) * 3);
    for (let k = 0; k < coefficients.length; k++) {
      const weight = coefficients[k] * Math.sqrt(m.eigenvalues[k]);
      a.x += weight * m.components[k][(j - 1) * 3];
      a.y += weight * m.components[k][(j - 1) * 3 + 1];
      a.z += weight * m.components[k][(j - 1) * 3 + 2];
    }
    const angle = a.length(),
      delta =
        angle > 1e-10
          ? new Quaternion().setFromAxisAngle(a.divideScalar(angle), angle)
          : new Quaternion();
    const parent = m.parents[j];
    const local = m.reference[parent].clone().invert().multiply(delta).multiply(m.reference[j]);
    points.push(m.offsets[j].clone().applyQuaternion(global[parent]).add(points[parent]));
    global.push(global[parent].clone().multiply(local));
  }
  return landmarkJoints.map((j) => points[j]);
}

function palm(points: Vector3[]): Quaternion | null {
  const x = points[5].clone().sub(points[17]);
  const y = points[9].clone().sub(points[0]);
  if (x.length() < 1e-5 || y.length() < 1e-5) return null;
  x.normalize();
  y.addScaledVector(x, -y.dot(x));
  if (y.length() < 1e-5) return null;
  y.normalize();
  const z = x.clone().cross(y).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}
function directions(points: Vector3[], basis: Quaternion) {
  const inverse = basis.clone().invert();
  return segments.flatMap((j) =>
    points[j + 1].clone().sub(points[j]).normalize().applyQuaternion(inverse).toArray(),
  );
}
function solve(a: number[][], b: number[]) {
  const n = b.length,
    m = a.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(m[j][i]) > Math.abs(m[pivot][i])) pivot = j;
    [m[i], m[pivot]] = [m[pivot], m[i]];
    if (Math.abs(m[i][i]) < 1e-10) return null;
    const d = m[i][i];
    for (let k = i; k <= n; k++) m[i][k] /= d;
    for (let j = 0; j < n; j++)
      if (j !== i) {
        const f = m[j][i];
        for (let k = i; k <= n; k++) m[j][k] -= f * m[i][k];
      }
  }
  return m.map((row) => row[n]);
}

/** Fit articulation, not wrist or identity. Retain measured MCP anchors and bone lengths. */
export function fitSomaHand(
  side: Side,
  input: Vector3[],
  confidence: number[],
  previous?: number[],
) {
  const basis = palm(input);
  if (
    !basis ||
    [0, 5, 9, 17].some((j) => confidence[j] < 0.25) ||
    segments.filter((j) => Math.min(confidence[j], confidence[j + 1]) >= 0.25).length < 8
  )
    return null;
  const target = directions(input, basis);
  const weights = segments.flatMap((j) =>
    Array(3).fill(Math.max(0, Math.min(confidence[j], confidence[j + 1])) ** 2),
  );
  const n = 32,
    priorWeight = 0.004,
    temporalWeight = previous ? 0.001 : 0;
  const prediction = (z: number[]) => {
    const points = somaHandLandmarks(side, z);
    return directions(points, palm(points)!);
  };
  const cost = (z: number[], p: number[]) =>
    p.reduce((s, v, i) => s + weights[i] * (v - target[i]) ** 2, 0) +
    z.reduce(
      (s, v, i) => s + priorWeight * v * v + temporalWeight * (v - (previous?.[i] ?? 0)) ** 2,
      0,
    );
  let z = previous ? [...previous] : Array(n).fill(0),
    p = prediction(z),
    damping = 0.02;
  for (let iteration = 0; iteration < 9; iteration++) {
    const jacobian = Array.from({ length: n }, (_, k) => {
      const perturbed = [...z];
      perturbed[k] += 0.002;
      return prediction(perturbed).map((v, i) => (v - p[i]) / 0.002);
    });
    const h = jacobian.map((ja, a) =>
      jacobian.map(
        (jb, b) =>
          ja.reduce((s, v, i) => s + weights[i] * v * jb[i], 0) +
          (a === b ? priorWeight + temporalWeight + damping : 0),
      ),
    );
    const g = jacobian.map(
      (ja, k) =>
        ja.reduce((s, v, i) => s + weights[i] * v * (target[i] - p[i]), 0) -
        priorWeight * z[k] -
        temporalWeight * (z[k] - (previous?.[k] ?? 0)),
    );
    const step = solve(h, g);
    if (!step) break;
    const next = z.map((v, k) => Math.max(-3, Math.min(3, v + step[k]))),
      nextP = prediction(next);
    if (cost(next, nextP) < cost(z, p)) {
      z = next;
      p = nextP;
      damping *= 0.5;
    } else damping *= 4;
  }
  const error = Math.sqrt(
    p.reduce((s, v, i) => s + weights[i] * (v - target[i]) ** 2, 0) /
      Math.max(1e-6, weights.reduce((a, b) => a + b, 0) / 3),
  );
  // Do not replace clearly incompatible or unobservable tracking with an invented gesture.
  if (!Number.isFinite(error) || error > 0.65) return null;
  const output = input.map((p) => p.clone());
  segments.forEach((j, k) => {
    const direction = new Vector3()
      .fromArray(p, k * 3)
      .normalize()
      .applyQuaternion(basis);
    output[j + 1].copy(output[j]).addScaledVector(direction, input[j + 1].distanceTo(input[j]));
  });
  return { points: output, coefficients: z, error };
}

export function refineCaptureHands(capture: Capture) {
  const indices = referenceFrames(capture.frames);
  let fitted = 0,
    skipped = 0,
    totalError = 0;
  for (const [side, offset] of [
    ['left', 0],
    ['right', 21],
  ] as const) {
    let previous: number[] | undefined;
    for (const frame of indices) {
      const points = Array.from({ length: 21 }, (_, j) =>
        new Vector3().fromArray(capture.details, frame * 144 + (offset + j) * 3),
      );
      const fit = fitSomaHand(
        side,
        points,
        capture.detailConfidence.slice(frame * 48 + offset, frame * 48 + offset + 21),
        previous,
      );
      if (!fit) {
        skipped++;
        previous = undefined;
        continue;
      }
      previous = fit.coefficients;
      fitted++;
      totalError += fit.error;
      fit.points.forEach((p, j) => p.toArray(capture.details, frame * 144 + (offset + j) * 3));
    }
  }
  // Runtime hand tracks sample these anchors, then interpolate target-rig quaternions.
  capture.metadata.poseStride = REFERENCE_POSE_STRIDE;
  capture.metadata.handSolver = {
    model: 'SOMAHand-PCA-v1',
    fitted,
    skipped,
    meanError: fitted ? totalError / fitted : 0,
  };
  if (skipped)
    capture.metadata.warnings.push(
      `${skipped} hand reference poses could not be fitted to SOMAHand; reviewed tracking was retained.`,
    );
  return capture;
}
