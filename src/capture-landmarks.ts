// Three head anchors orient the body; facial expression landmarks are unused.
export const REVIEW_BODY = [
  11,
  12,
  13,
  14,
  15,
  16,
  ...Array.from({ length: 10 }, (_, i) => i + 23),
];
export const CAPTURE_BODY = [0, 7, 8, ...REVIEW_BODY];
export const CAPTURE_DETAIL = [
  ...Array.from({ length: 18 }, (_, i) => i + 5),
  ...Array.from({ length: 42 }, (_, i) => i + 91),
];
export const packPoints = (points: number[], indices: readonly number[]) =>
  indices.flatMap((j) => points.slice(j * 4, j * 4 + 4));
export function unpackPoints(points: number[], indices: readonly number[], joints: number) {
  const result = Array(joints * 4).fill(0);
  indices.forEach((joint, i) => {
    for (let k = 0; k < 4; k++) result[joint * 4 + k] = points[i * 4 + k];
  });
  return result;
}
