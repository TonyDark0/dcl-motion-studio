import type { SamFrame } from './video-motion';

// MHR70 -> MediaPipe33. Missing face/finger auxiliary points remain uncertain.
const joints = [
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
];
export function samObservation(sam: SamFrame) {
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const normalized = world.map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const hip = [0, 1, 2].map((k) => (sam.keypoints3d[9 * 3 + k] + sam.keypoints3d[10 * 3 + k]) / 2);
  for (const [mp, mhr] of joints) {
    world[mp] = {
      x: sam.keypoints3d[mhr * 3] - hip[0],
      y: sam.keypoints3d[mhr * 3 + 1] - hip[1],
      z: sam.keypoints3d[mhr * 3 + 2] - hip[2],
      visibility: sam.score,
    };
    const x = sam.keypoints2d[mhr * 2],
      y = sam.keypoints2d[mhr * 2 + 1];
    normalized[mp] = {
      x,
      y,
      z: world[mp].z,
      visibility: x >= 0 && x <= 1 && y >= 0 && y <= 1 ? sam.score : 0,
    };
  }
  return { world, normalized };
}
