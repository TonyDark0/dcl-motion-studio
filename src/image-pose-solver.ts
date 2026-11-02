import { Matrix4, Quaternion, Vector3 } from 'three';
import { SOMA_PARENTS } from './motion.js';
import { SOMA_OFFSETS } from '../server/soma-offsets.js';
import { imagePoseSchema, type ImagePose } from './pose-reference.js';

type Vec3 = [number, number, number];
const critical = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
function direction(v: Vector3) {
  if (v.length() < 0.015)
    throw Error('The detected pose is incomplete. Use a clear full-body image.');
  return v.normalize();
}
function basis(x: Vector3, up: Vector3) {
  direction(x);
  const y = direction(up.addScaledVector(x, -up.dot(x)));
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, x.clone().cross(y)));
}
/** Fit directions, never source bone lengths, to the SOMA rest skeleton. Depth is estimated. */
export function fitImagePose(input: ImagePose) {
  const pose = imagePoseSchema.parse(input);
  if (critical.some((i) => pose.confidence[i] < 0.35))
    throw Error('Some body joints are hidden or uncertain. Use a clearer full-body image.');
  // MediaPipe camera coordinates -> SOMA Y-up; keep anatomical left/right.
  const p = pose.world.map(([x, y, z]) => new Vector3(x, -y, -z));
  const hips = p[23].clone().add(p[24]).multiplyScalar(0.5);
  const shoulders = p[11].clone().add(p[12]).multiplyScalar(0.5);
  const up = shoulders.clone().sub(hips);
  const root = basis(p[23].clone().sub(p[24]), up.clone());
  const chest = basis(p[11].clone().sub(p[12]), up.clone());
  const global: Quaternion[] = [],
    local: Quaternion[] = [],
    positions: Vector3[] = [];
  // Photo references guide the body only; face and finger points do not drive this rig.
  const segments: Record<number, [number, number, number]> = {
    11: [12, 11, 13],
    12: [13, 13, 15],
    17: [18, 12, 14],
    18: [19, 14, 16],
    22: [23, 23, 25],
    23: [24, 25, 27],
    24: [25, 29, 31],
    26: [27, 24, 26],
    27: [28, 26, 28],
    28: [29, 30, 32],
  };
  for (let j = 0; j < 30; j++) {
    const parent = SOMA_PARENTS[j];
    const parentQ = parent < 0 ? new Quaternion() : global[parent];
    let q = parentQ.clone();
    if (j === 0) q = root;
    else if (j <= 3) q = root.clone().slerp(chest, j / 3);
    else if (segments[j]) {
      const [child, a, b] = segments[j];
      // Fine hand/foot landmarks are less reliable than the body: inherit orientation if absent.
      if (pose.confidence[a] >= 0.35 && pose.confidence[b] >= 0.35) {
        const target = direction(p[b].clone().sub(p[a]));
        const rest = new Vector3(...SOMA_OFFSETS[child]).normalize().applyQuaternion(parentQ);
        q.premultiply(new Quaternion().setFromUnitVectors(rest, target));
      }
    }
    global[j] = q.normalize();
    local[j] = parentQ.clone().invert().multiply(q).normalize();
    positions[j] =
      parent < 0
        ? new Vector3()
        : new Vector3(...SOMA_OFFSETS[j]).applyQuaternion(parentQ).add(positions[parent]);
  }
  // Images do not recover global travel or jump height. Place the lowest foot on the floor.
  const height = -Math.min(...[24, 25, 28, 29].map((j) => positions[j].y));
  if (height < 0.1 || height > 1.6)
    throw Error('Use an upright or crouching pose with feet visible.');
  const rotations = local.map((q): Vec3 => {
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    const s = Math.hypot(q.x, q.y, q.z),
      a = 2 * Math.atan2(s, q.w);
    return s < 1e-9 ? [0, 0, 0] : [(q.x * a) / s, (q.y * a) / s, (q.z * a) / s];
  });
  return {
    rotations,
    root: [0, height, 0] as Vec3,
    positions: positions.map((p) => p.add(new Vector3(0, height, 0)).toArray() as Vec3),
  };
}
