import { describe, expect, it } from 'vitest';
import { compileCapture, refilterCapture, type Observation } from '../src/video-motion';
import { decodeSimCC } from '../server/vision';

function observation(time: number): Observation {
  const body = Array.from({ length: 33 }, (_, joint) => [
    (joint % 2 ? 1 : -1) * 0.12,
    -0.03 * joint,
    Math.sin(time) * 0.01,
    0.95,
  ]).flat();
  // Make the body joints needed for calibration non-degenerate.
  body.splice(11 * 4, 4, 0.25, -0.55, 0, 0.95);
  body.splice(12 * 4, 4, -0.25, -0.55, 0, 0.95);
  body.splice(23 * 4, 4, 0.12, 0, 0, 0.95);
  body.splice(24 * 4, 4, -0.12, 0, 0, 0.95);
  body.splice(25 * 4, 4, 0.12, 0.45, 0.03, 0.95);
  body.splice(26 * 4, 4, -0.12, 0.45, 0.03, 0.95);
  body.splice(27 * 4, 4, 0.12, 0.9, 0, 0.95);
  body.splice(28 * 4, 4, -0.12, 0.9, 0, 0.95);
  const detail = Array.from({ length: 133 }, (_, joint) => [
    120 + (joint % 7) * 3,
    170 + Math.floor(joint / 7),
    joint % 5,
    0.8,
  ]).flat();
  const normalized = Array.from({ length: 33 }, (_, joint) => [
    0.5 + time * 0.02 + (joint % 2 ? 0.08 : -0.08),
    0.2 + joint * 0.018,
    0,
    0.95,
  ]).flat();
  return { time, body, detail, normalized };
}

function withSam(value: Observation, first = false): Observation {
  const keypoints3d = Array(70 * 3).fill(0);
  const mapping = new Map([
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
  for (const [mp, sam] of mapping)
    for (let axis = 0; axis < 3; axis++) keypoints3d[sam * 3 + axis] = value.body[mp * 4 + axis];
  return {
    ...value,
    sam: {
      keypoints3d,
      keypoints2d: Array.from({ length: 70 }, (_, i) => [
        0.35 + (i % 7) * 0.04,
        0.15 + Math.floor(i / 7) * 0.07,
      ]).flat(),
      score: 0.86,
    },
    ...(first
      ? {
          calibration: {
            fovX: 58,
            fovY: 36,
            focalX: 0.9,
            focalY: 1.5,
            source: 'moge-2-vits' as const,
          },
        }
      : {}),
  };
}

describe('video motion contracts', () => {
  it('keeps raw observations while producing a deterministic 30 fps clip', () => {
    const raw = Array.from({ length: 21 }, (_, i) => observation(i / 10));
    const motion = compileCapture(raw, 2, 'fixture.mp4', 0.4);
    expect(motion.frames).toBe(60);
    expect(motion.positions).toHaveLength(60 * 33 * 3);
    expect(motion.details).toHaveLength(60 * 48 * 3);
    expect(motion.raw.times).toHaveLength(21);
    expect(motion.trajectory).toHaveLength(60 * 3);
    expect(motion.heading).toHaveLength(60);
    expect(motion.trajectory!.at(-3)).toBeGreaterThan(0.05);
    const filtered = refilterCapture(motion, 0.8);
    expect(filtered.raw).toEqual(motion.raw);
    expect(filtered.metadata.smoothing).toBe(0.8);
  });
  it('decodes RTMW3D SimCC axes in their declared order', () => {
    const axis = (width: number, peak: number) => {
      const data = new Float32Array(133 * width);
      for (let joint = 0; joint < 133; joint++) data[joint * width + peak] = 0.75;
      return { data, dims: [1, 133, width] };
    };
    const decoded = decodeSimCC([axis(576, 20), axis(768, 40), axis(576, 384)]);
    expect(decoded.slice(0, 4)).toEqual([10, 20, 0, 0.75]);
    expect(decoded).toHaveLength(133 * 4);
    expect(decodeSimCC([axis(576, 20), axis(768, 40), axis(576, 384)], [5, 91, 132])).toEqual([
      10, 20, 0, 0.75, 10, 20, 0, 0.75, 10, 20, 0, 0.75,
    ]);
  });
  it('preserves SAM/MoGe evidence through hybrid fusion and refiltering', () => {
    const raw = Array.from({ length: 31 }, (_, i) => withSam(observation(i / 15), i === 0));
    const motion = compileCapture(raw, 2, 'pro.mp4', 0.45);
    expect(motion.source).toBe('sam3d-hybrid');
    expect(motion.raw.sam3d).toHaveLength(31 * 210);
    expect(motion.raw.sam2d).toHaveLength(31 * 140);
    expect(motion.metadata.calibration?.source).toBe('moge-2-vits');
    const filtered = refilterCapture(motion, 0.7);
    expect(filtered.source).toBe('sam3d-hybrid');
    expect(filtered.raw.sam3d).toEqual(motion.raw.sam3d);
    expect(motion.raw.layout).toBe('body-hands-v1');
    expect(motion.raw.detail.length).toBeLessThan((raw.length * 532) / 2);
    expect(motion.raw.body.length).toBeLessThan(raw.length * 132);
  });
  it('repairs an isolated limb tracking failure before retargeting', () => {
    const raw = Array.from({ length: 21 }, (_, i) => observation(i / 10));
    raw[10].body[25 * 4] += 5;
    raw[10].body[25 * 4 + 1] -= 4;
    const motion = compileCapture(raw, 2, 'broken-frame.mp4', 0.4);
    expect(motion.metadata.repairedFrames).toBeGreaterThan(0);
    expect(motion.metadata.warnings.some((w) => w.includes('tracking frames were repaired'))).toBe(
      true,
    );
  });
  it('keeps manual joint corrections through Pro fusion and subsequent refiltering', () => {
    const raw = Array.from({ length: 31 }, (_, i) => withSam(observation(i / 15), i === 0));
    raw[8].body[13 * 4] += 0.02;
    raw[8].corrected = { body: [13], detail: [95] };
    const motion = compileCapture(raw, 2, 'corrected.mp4', 0.4);
    const filtered = refilterCapture(motion, 0.6);
    expect(motion.raw.samScore![8]).toBe(0.86);
    expect(filtered.raw.corrected![8]).toEqual({ body: [13], detail: [95] });
    expect(motion.raw.layout).toBe('body-hands-v1');
  });
});
