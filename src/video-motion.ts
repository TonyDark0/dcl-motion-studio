import { z } from 'zod';
import { cleanCaptureSamples, fuseSamFrame } from './capture-processing.js';
import { refineCaptureHands } from './somahand.js';
import { estimateVideoRoot, unwrapAngles } from './video-root.js';
import { CAPTURE_BODY, CAPTURE_DETAIL, packPoints, unpackPoints } from './capture-landmarks.js';

export const samFrameSchema = z.object({
  keypoints3d: z.array(z.number().finite()).length(210),
  keypoints2d: z.array(z.number().finite()).length(140),
  score: z.number().min(0).max(1),
  focalLength: z.number().positive().optional(),
  cameraTranslation: z.array(z.number().finite()).length(3).optional(),
});
export type SamFrame = z.infer<typeof samFrameSchema>;
export const cameraCalibrationSchema = z.object({
  fovX: z.number().min(10).max(160),
  fovY: z.number().min(10).max(160),
  focalX: z.number().positive(),
  focalY: z.number().positive(),
  source: z.literal('moge-2-vits'),
});
export type CameraCalibration = z.infer<typeof cameraCalibrationSchema>;
export const captureSchema = z
  .object({
    version: z.literal(2),
    generationId: z.string().uuid().optional(),
    skeleton: z.literal('dcl-capture'),
    source: z.enum(['mediapipe+rtmw3d', 'sam3d-hybrid']),
    fps: z.literal(30),
    frames: z.number().int().min(60).max(300),
    positions: z.array(z.number().finite()),
    details: z.array(z.number().finite()),
    confidence: z.array(z.number().finite()),
    detailConfidence: z.array(z.number().finite()),
    trajectory: z.array(z.number().finite()).optional(),
    heading: z.array(z.number().finite()).optional(),
    raw: z.object({
      layout: z.literal('body-hands-v1').optional(),
      corrected: z
        .array(
          z.object({
            body: z.array(z.number().int().min(0).max(32)).max(33),
            detail: z.array(z.number().int().min(0).max(132)).max(48),
          }),
        )
        .max(301)
        .optional(),
      times: z.array(z.number().finite()).max(301),
      body: z.array(z.number().finite()),
      detail: z.array(z.number().finite()),
      normalized: z.array(z.number().finite()).optional(),
      crops: z.array(z.number().finite()).optional(),
      sam3d: z.array(z.number().finite()).optional(),
      sam2d: z.array(z.number().finite()).optional(),
      samScore: z.array(z.number().finite()).optional(),
      samCamera: z.array(z.number().finite()).optional(),
      aspectRatio: z.number().positive().optional(),
    }),
    metadata: z.object({
      file: z.string().max(255),
      sampleFps: z.number(),
      smoothing: z.number(),
      warnings: z.array(z.string()).max(100),
      providerVersion: z.string(),
      poseStride: z.union([z.literal(10), z.literal(15)]).optional(),
      trajectoryVersion: z.literal('camera-root-v2').optional(),
      groundingVersion: z.literal('foot-support-v1').optional(),
      handSolver: z
        .object({
          model: z.literal('SOMAHand-PCA-v1'),
          fitted: z.number().int().nonnegative(),
          skipped: z.number().int().nonnegative(),
          meanError: z.number().finite().nonnegative(),
        })
        .optional(),
      retargetVersion: z.string().default('current-pose-chain-v1'),
      calibration: cameraCalibrationSchema.optional(),
      repairedFrames: z.number().int().nonnegative().default(0),
      captureMs: z.number().finite().min(0).max(86400000).optional(),
    }),
  })
  .superRefine((m, c) => {
    if (
      m.positions.length !== m.frames * 99 ||
      m.details.length !== m.frames * 144 ||
      m.confidence.length !== m.frames * 33 ||
      m.detailConfidence.length !== m.frames * 48 ||
      m.raw.body.length !== m.raw.times.length * (m.raw.layout ? CAPTURE_BODY.length * 4 : 132) ||
      m.raw.detail.length !==
        m.raw.times.length * (m.raw.layout ? CAPTURE_DETAIL.length * 4 : 532) ||
      (m.raw.normalized &&
        m.raw.normalized.length !==
          m.raw.times.length * (m.raw.layout ? CAPTURE_BODY.length * 4 : 132)) ||
      (m.raw.crops && m.raw.crops.length !== m.raw.times.length * 4) ||
      (m.raw.sam3d && m.raw.sam3d.length !== m.raw.times.length * 210) ||
      (m.raw.sam2d && m.raw.sam2d.length !== m.raw.times.length * 140) ||
      (m.raw.samScore && m.raw.samScore.length !== m.raw.times.length) ||
      (m.raw.samCamera && m.raw.samCamera.length !== m.raw.times.length * 3) ||
      (m.raw.corrected && m.raw.corrected.length !== m.raw.times.length) ||
      (m.trajectory && m.trajectory.length !== m.frames * 3) ||
      (m.heading && m.heading.length !== m.frames)
    )
      c.addIssue({ code: 'custom', message: 'Invalid capture dimensions' });
    if (m.raw.times.some((t, i) => t < 0 || (i > 0 && t <= m.raw.times[i - 1])))
      c.addIssue({ code: 'custom', message: 'Invalid capture timestamps' });
  });
export type Capture = z.infer<typeof captureSchema>;
export type Observation = {
  corrected?: { body: number[]; detail: number[] };
  time: number;
  body: number[];
  detail: number[];
  normalized?: number[];
  crop?: [number, number, number, number];
  sam?: SamFrame;
  calibration?: CameraCalibration;
  aspectRatio?: number;
};
export const DETAIL_INDICES = [
  ...Array.from({ length: 42 }, (_, i) => 91 + i),
  17,
  18,
  19,
  20,
  21,
  22,
];

export function compileCapture(
  raw: Observation[],
  duration: number,
  file: string,
  smoothing = 0.4,
): Capture {
  if (raw.length < 2) throw Error('Not enough frames contain a visible person.');
  const warnings: string[] = [];
  let poor = 0;
  const initialSamples = raw.map((r) => {
    const body = Array.from({ length: 33 }, (_, j) => {
      const p = r.body.slice(j * 4, j * 4 + 3);
      return [p[0], -p[1], -p[2]];
    });
    const confidence = Array.from({ length: 33 }, (_, j) => r.body[j * 4 + 3]);
    const point = (j: number) => r.detail.slice(j * 4, j * 4 + 3);
    const shoulder = Math.hypot(...body[11].map((x, i) => x - body[12][i]));
    const rtmShoulder = Math.hypot(point(5)[0] - point(6)[0], point(5)[1] - point(6)[1]);
    const scale = Math.max(0.001, Math.min(0.02, shoulder / Math.max(15, rtmShoulder)));
    const delta = (j: number, anchor: number) =>
      point(j).map((n, k) => (n - point(anchor)[k]) * (k === 0 ? scale : k === 1 ? -scale : -1));
    // RTMW refines distal joints only when it has usable evidence. A weak RTMW
    // ankle must not erase an otherwise reliable MediaPipe leg at frame zero.
    for (const [mp, proximal, rt, rp] of [
      [15, 13, 9, 7],
      [16, 14, 10, 8],
      [27, 25, 15, 13],
      [28, 26, 16, 14],
    ]) {
      if (r.corrected?.body.includes(mp)) continue;
      const score = Math.min(confidence[proximal], r.detail[rt * 4 + 3], r.detail[rp * 4 + 3]);
      const segment = delta(rt, rp);
      const length = Math.hypot(...segment);
      const baseline = Math.hypot(...body[mp].map((n, k) => n - body[proximal][k]));
      if (
        score >= 0.35 &&
        length > 0.08 &&
        length < 0.8 &&
        (confidence[mp] < 0.35 || (length > baseline * 0.5 && length < baseline * 1.7))
      ) {
        const weight = confidence[mp] >= 0.35 ? 0.65 : 1;
        body[mp] = segment.map(
          (n, k) => body[mp][k] * (1 - weight) + (body[proximal][k] + n) * weight,
        );
        confidence[mp] = Math.max(confidence[mp], score);
      }
    }
    const details = DETAIL_INDICES.map((j, i) => {
      const anchor = i < 21 ? 91 : i < 42 ? 112 : i < 45 ? 15 : 16;
      const mp = i < 21 ? 15 : i < 42 ? 16 : i < 45 ? 27 : 28;
      return delta(j, anchor).map((n, k) => body[mp][k] + n);
    });
    const detailConfidence = DETAIL_INDICES.map((j) => Math.max(0, r.detail[j * 4 + 3]));
    if (detailConfidence.filter((v) => v < 0.2).length > 12) poor++;
    const normalized =
      r.normalized && r.normalized.length === 132
        ? Array.from({ length: 33 }, (_, j) => r.normalized!.slice(j * 4, j * 4 + 4))
        : null;
    const sample = { body, confidence, details, detailConfidence };
    if (r.sam) {
      const manualBody = r.corrected?.body.map((j) => ({ j, point: [...sample.body[j]] })) || [];
      const manualDetail = (r.corrected?.detail || [])
        .map((j) => DETAIL_INDICES.indexOf(j))
        .filter((j) => j >= 0)
        .map((j) => ({ j, point: [...sample.details[j]] }));
      fuseSamFrame(sample, r.sam);
      for (const { j, point } of manualBody) {
        sample.body[j] = point;
        sample.confidence[j] = 1;
      }
      for (const { j, point } of manualDetail) {
        sample.details[j] = point;
        sample.detailConfidence[j] = 1;
      }
    }
    return { ...sample, normalized };
  });
  const cleaned = cleanCaptureSamples(
    initialSamples,
    raw.map((r) => r.time),
    smoothing,
  );
  const samples = cleaned.samples.map((sample, i) => ({
    ...sample,
    normalized: initialSamples[i].normalized,
  }));
  if (cleaned.repaired)
    warnings.push(
      `${cleaned.repaired}/${raw.length} tracking frames were repaired before retargeting.`,
    );
  const sampleTrajectory = estimateVideoRoot(raw);
  const sampleHeading = unwrapAngles(
    samples.map((sample) => {
      const lateral = sample.body[23].map((n, k) => n - sample.body[24][k]);
      return Math.atan2(-lateral[2], lateral[0]);
    }),
  );
  const baseHeading = sampleHeading[0];
  for (let i = 0; i < sampleHeading.length; i++) {
    sampleHeading[i] -= baseHeading;
  }
  const body = samples.map((s) => s.body),
    details = samples.map((s) => s.details);
  const frames = Math.max(60, Math.min(300, Math.round(duration * 30)));
  const pro = raw.some((r) => !!r.sam),
    calibration = raw.find((r) => r.calibration)?.calibration;
  const out: Capture = {
    version: 2,
    skeleton: 'dcl-capture',
    source: pro ? 'sam3d-hybrid' : 'mediapipe+rtmw3d',
    fps: 30,
    frames,
    positions: [],
    details: [],
    confidence: [],
    detailConfidence: [],
    trajectory: [],
    heading: [],
    raw: {
      layout: 'body-hands-v1',
      ...(raw.some((r) => r.corrected)
        ? { corrected: raw.map((r) => r.corrected || { body: [], detail: [] }) }
        : {}),
      times: raw.map((r) => r.time),
      body: raw.flatMap((r) => packPoints(r.body, CAPTURE_BODY)),
      detail: raw.flatMap((r) => packPoints(r.detail, CAPTURE_DETAIL)),
      ...(raw[0].aspectRatio ? { aspectRatio: raw[0].aspectRatio } : {}),
      ...(raw.every((r) => r.sam?.cameraTranslation)
        ? { samCamera: raw.flatMap((r) => r.sam!.cameraTranslation!) }
        : {}),
      ...(raw.every((r) => r.normalized?.length === 132)
        ? { normalized: raw.flatMap((r) => packPoints(r.normalized!, CAPTURE_BODY)) }
        : {}),
      ...(raw.every((r) => r.crop?.length === 4) ? { crops: raw.flatMap((r) => r.crop!) } : {}),
      ...(pro && raw.every((r) => r.sam)
        ? {
            sam3d: raw.flatMap((r) => r.sam!.keypoints3d),
            sam2d: raw.flatMap((r) => r.sam!.keypoints2d),
            samScore: raw.map((r) => r.sam!.score),
          }
        : {}),
    },
    metadata: {
      file,
      sampleFps: Math.round((raw.length - 1) / Math.max(0.01, raw.at(-1)!.time - raw[0].time)),
      smoothing,
      warnings,
      providerVersion: pro
        ? 'sam3d-body-dinov3+pose-full+rtmw3d'
        : 'pose-full-f16-v1+rtmw3d-x-20240626',
      trajectoryVersion: 'camera-root-v2',
      groundingVersion: 'foot-support-v1',
      retargetVersion: 'current-pose-chain-v1',
      repairedFrames: cleaned.repaired,
      ...(calibration ? { calibration } : {}),
    },
  };
  let i = 0;
  for (let f = 0; f < frames; f++) {
    const t = f / 30;
    while (i < raw.length - 2 && raw[i + 1].time < t) i++;
    const b = Math.min(raw.length - 1, i + 1),
      u = Math.max(0, Math.min(1, (t - raw[i].time) / Math.max(1e-6, raw[b].time - raw[i].time)));
    for (const [field, target] of [
      [body, out.positions],
      [details, out.details],
    ] as const)
      field[i].forEach((p, j) => p.forEach((n, k) => target.push(n + (field[b][j][k] - n) * u)));
    out.confidence.push(
      ...samples[i].confidence.map((n, j) =>
        u <= 1e-6
          ? n
          : u >= 1 - 1e-6
            ? samples[b].confidence[j]
            : Math.min(n, samples[b].confidence[j]),
      ),
    );
    out.detailConfidence.push(
      ...samples[i].detailConfidence.map((n, j) => Math.min(n, samples[b].detailConfidence[j])),
    );
    for (let k = 0; k < 3; k++)
      out.trajectory!.push(
        sampleTrajectory[i][k] + (sampleTrajectory[b][k] - sampleTrajectory[i][k]) * u,
      );
    out.heading!.push(sampleHeading[i] + (sampleHeading[b] - sampleHeading[i]) * u);
  }
  if (poor) warnings.push(`${poor}/${raw.length} frames have low-confidence hand/foot detail.`);
  if (raw.some((r, i) => i > 0 && r.time - raw[i - 1].time > 0.35))
    warnings.push('Tracking gaps detected: review the transitions.');
  return captureSchema.parse(refineCaptureHands(out));
}

export function refilterCapture(m: Capture, smoothing: number) {
  const bodyStride = m.raw.layout ? CAPTURE_BODY.length * 4 : 132;
  const detailStride = m.raw.layout ? CAPTURE_DETAIL.length * 4 : 532;
  const body = (points: number[], i: number) =>
    m.raw.layout
      ? unpackPoints(points.slice(i * bodyStride, (i + 1) * bodyStride), CAPTURE_BODY, 33)
      : points.slice(i * bodyStride, (i + 1) * bodyStride);
  const filtered = compileCapture(
    m.raw.times.map((time, i) => ({
      time,
      ...(m.raw.corrected ? { corrected: m.raw.corrected[i] } : {}),
      body: body(m.raw.body, i),
      ...(m.raw.aspectRatio ? { aspectRatio: m.raw.aspectRatio } : {}),
      detail: m.raw.layout
        ? unpackPoints(
            m.raw.detail.slice(i * detailStride, (i + 1) * detailStride),
            CAPTURE_DETAIL,
            133,
          )
        : m.raw.detail.slice(i * detailStride, (i + 1) * detailStride),
      ...(m.raw.normalized ? { normalized: body(m.raw.normalized, i) } : {}),
      ...(m.raw.crops
        ? { crop: m.raw.crops.slice(i * 4, (i + 1) * 4) as [number, number, number, number] }
        : {}),
      ...(m.raw.sam3d && m.raw.sam2d && m.raw.samScore
        ? {
            sam: {
              keypoints3d: m.raw.sam3d.slice(i * 210, (i + 1) * 210),
              keypoints2d: m.raw.sam2d.slice(i * 140, (i + 1) * 140),
              score: m.raw.samScore[i],
              ...(m.raw.samCamera
                ? { cameraTranslation: m.raw.samCamera.slice(i * 3, (i + 1) * 3) }
                : {}),
            },
          }
        : {}),
      ...(m.metadata.calibration ? { calibration: m.metadata.calibration } : {}),
    })),
    m.frames / 30,
    m.metadata.file,
    smoothing,
  );
  filtered.generationId = m.generationId;
  filtered.metadata.captureMs = m.metadata.captureMs;
  return filtered;
}
