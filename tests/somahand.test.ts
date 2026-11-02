import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { fitSomaHand, refineCaptureHands, somaHandLandmarks } from '../src/somahand';
import { videoReference } from './fixtures/video-reference';

describe('official SOMAHand articulation prior', () => {
  it.each(['left', 'right'] as const)(
    'fits %s articulation while preserving wrist, palm and observed bone lengths',
    (side) => {
      const z = Array(32).fill(0);
      z[0] = 1.5;
      z[1] = -0.7;
      z[3] = 0.4;
      const turn = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 2.8);
      const points = somaHandLandmarks(side, z).map((p) =>
        p
          .multiplyScalar(1.3)
          .applyQuaternion(turn)
          .add(new Vector3(0.3, 1.2, -0.6)),
      );
      const fit = fitSomaHand(side, points, Array(21).fill(1));
      expect(fit).not.toBeNull();
      expect(fit!.error).toBeLessThan(0.08);
      for (const j of [0, 1, 5, 9, 13, 17])
        expect(fit!.points[j].distanceTo(points[j])).toBeLessThan(1e-9);
      for (const j of [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19])
        expect(fit!.points[j + 1].distanceTo(fit!.points[j])).toBeCloseTo(
          points[j + 1].distanceTo(points[j]),
          9,
        );
      expect(fit!.points.every((p) => p.toArray().every(Number.isFinite))).toBe(true);
    },
  );
  it('does not invent a confident gesture when the palm or most fingers are unobserved', () => {
    const points = somaHandLandmarks('left', Array(32).fill(0));
    expect(fitSomaHand('left', points, Array(21).fill(0.1))).toBeNull();
    expect(
      fitSomaHand(
        'right',
        Array.from({ length: 21 }, () => new Vector3()),
        Array(21).fill(1),
      ),
    ).toBeNull();
  });
  it.each(['mediapipe+rtmw3d', 'sam3d-hybrid'] as const)(
    'refines only hand key poses for %s, retaining body, feet and confidence',
    (provider) => {
      const capture = videoReference(60, provider);
      const hands = [
        ...somaHandLandmarks('left', Array(32).fill(0.1)),
        ...somaHandLandmarks('right', Array(32).fill(-0.1)),
      ];
      for (let f = 0; f < 60; f++)
        hands.forEach((p, j) => {
          p.toArray(capture.details, f * 144 + j * 3);
          capture.detailConfidence[f * 48 + j] = 0.9;
        });
      const original = structuredClone(capture);
      refineCaptureHands(capture);
      expect(capture.metadata.handSolver!.fitted).toBe(14);
      expect(capture.metadata.handSolver!.skipped).toBe(0);
      expect(capture.metadata.poseStride).toBe(10);
      expect(capture.positions).toEqual(original.positions);
      expect(capture.trajectory).toEqual(original.trajectory);
      expect(capture.detailConfidence).toEqual(original.detailConfidence);
      for (let f = 0; f < 60; f++)
        expect(capture.details.slice(f * 144 + 126, (f + 1) * 144)).toEqual(
          original.details.slice(f * 144 + 126, (f + 1) * 144),
        );
    },
  );
});
