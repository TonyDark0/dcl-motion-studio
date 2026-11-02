import { Quaternion } from 'three';
import type { AvatarRig } from './rig.js';
import { mapping, SOMA_NAMES, SOMA_PARENTS } from './motion.js';

/** Inverse of AvatarRig.retarget: remove DCL bind axes before forming SOMA locals.
 * The rig must already hold the reviewed FK pose. No IK handles or finger bones
 * are copied into the 30-joint body model; fingers remain on the Hands layer.
 */
export function dclPoseToSoma(rig: AvatarRig): [number, number, number][] {
  const global: Quaternion[] = [];
  return SOMA_NAMES.map((name, joint) => {
    const parent = SOMA_PARENTS[joint];
    const parentRotation = parent < 0 ? new Quaternion() : global[parent];
    const target = mapping[name];
    global[joint] = target
      ? rig
          .bone(target)
          .getWorldQuaternion(new Quaternion())
          .normalize()
          .multiply(rig.initial(target).wq.clone().normalize().invert())
          .normalize()
      : parentRotation.clone();
    const local = parentRotation.clone().invert().multiply(global[joint]).normalize();
    if (local.w < 0) local.set(-local.x, -local.y, -local.z, -local.w);
    const sin = Math.hypot(local.x, local.y, local.z),
      angle = 2 * Math.atan2(sin, local.w);
    return sin < 1e-9
      ? [0, 0, 0]
      : [(local.x * angle) / sin, (local.y * angle) / sin, (local.z * angle) / sin];
  });
}
