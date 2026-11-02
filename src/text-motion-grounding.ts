import { Quaternion, Vector3 } from 'three';
import { SOMA_OFFSETS } from '../server/soma-offsets.js';
import { SOMA_PARENTS, type Motion } from './motion.js';

export const SOMA_REST_HEIGHT = 0.989;
export const SOMA_SUPPORTS = [
  [24, 'LeftFoot'],
  [25, 'LeftToeBase'],
  [28, 'RightFoot'],
  [29, 'RightToeBase'],
] as const;
const restY = [SOMA_REST_HEIGHT];
for (let j = 1; j < 30; j++) restY[j] = restY[SOMA_PARENTS[j]] + SOMA_OFFSETS[j][1];

export function somaSupportPoints(globals: Quaternion[], root: Vector3) {
  const positions: Vector3[] = [root];
  for (const j of [22, 23, 24, 25, 26, 27, 28, 29]) {
    const parent = SOMA_PARENTS[j];
    positions[j] = new Vector3(...SOMA_OFFSETS[j])
      .applyQuaternion(globals[parent])
      .add(positions[parent]);
  }
  return SOMA_SUPPORTS.map(([j]) => positions[j].clone().setY(positions[j].y - restY[j]));
}

/** One small floor offset for the entire source clip, estimated only from stable
 * near-floor support samples. Never recentre an airborne clip or flatten jumps.
 */
export function textMotionFloor(m: Extract<Motion, { skeleton: 'soma30' }>) {
  const frames = Array.from({ length: m.frames }, (_, frame) => {
    const globals: Quaternion[] = [];
    for (let j = 0; j < 30; j++) {
      const local = new Quaternion().fromArray(m.rotations, frame * 120 + j * 4).normalize();
      globals[j] = SOMA_PARENTS[j] < 0 ? local : globals[SOMA_PARENTS[j]].clone().multiply(local);
    }
    return somaSupportPoints(globals, new Vector3().fromArray(m.roots, frame * 3));
  });
  const supported: number[] = [];
  for (let f = 1; f < frames.length - 1; f++) {
    const points = frames[f];
    const index = points.reduce((best, p, i) => (p.y < points[best].y ? i : best), 0);
    const height = points[index].y;
    const speed =
      Math.max(
        points[index].distanceTo(frames[f - 1][index]),
        points[index].distanceTo(frames[f + 1][index]),
      ) * m.fps;
    if (height >= -0.03 && height <= 0.06 && speed < 0.18) supported.push(height);
  }
  if (supported.length < 3) return 0;
  supported.sort((a, b) => a - b);
  return supported[Math.floor((supported.length - 1) * 0.2)];
}
