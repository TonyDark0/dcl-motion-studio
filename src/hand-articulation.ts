import { MathUtils, Quaternion, Vector3 } from 'three';
import { referenceCalibration } from './emote-references.js';

/** Bound capture error in the wrist's bind frame, independently of world heading.
 * Forearm motion still carries the entire hand; fingers keep their local articulation.
 */
export function constrainWrist(local: Quaternion, rest: Quaternion, forward: Vector3) {
  const delta = rest.clone().invert().multiply(local).normalize();
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const axis = forward.clone().normalize();
  const projected = axis.clone().multiplyScalar(new Vector3(delta.x, delta.y, delta.z).dot(axis));
  const twist = new Quaternion(projected.x, projected.y, projected.z, delta.w);
  if (twist.lengthSq() < 1e-10) twist.identity();
  else twist.normalize();
  const swing = delta.clone().multiply(twist.clone().invert()).normalize();
  const swingAngle = swing.angleTo(new Quaternion());
  const maxSwing = referenceCalibration.wristSwing;
  if (swingAngle > maxSwing) swing.slerp(new Quaternion(), 1 - maxSwing / swingAngle);
  const twistAngle = 2 * Math.atan2(new Vector3(twist.x, twist.y, twist.z).dot(axis), twist.w);
  twist.setFromAxisAngle(
    axis,
    MathUtils.clamp(twistAngle, -referenceCalibration.wristTwist, referenceCalibration.wristTwist),
  );
  return rest.clone().multiply(swing).multiply(twist).normalize();
}

/** Articulation only. Wrist pose and model bone axes belong to the target rig. */
export function fingerArticulation(points: Vector3[], palm: Quaternion, side: 'Left' | 'Right') {
  const directions = points.slice(1).map((point, i) => point.clone().sub(points[i]));
  if (directions.some((d) => !d.toArray().every(Number.isFinite) || d.lengthSq() < 1e-10))
    return null;
  directions.forEach((d) => d.normalize());
  const first = directions[0].clone().applyQuaternion(palm.clone().invert());
  const palmar = first.z * (side === 'Left' ? 1 : -1);
  return {
    // A depth sign error must never bend an MCP backwards. Keep a small
    // extension allowance; PIP/DIP are hinges, without abduction or axial roll.
    flex: [
      MathUtils.clamp(Math.atan2(palmar, first.y), -0.08, 1.45),
      MathUtils.clamp(directions[0].angleTo(directions[1]), 0, 1.75),
      MathUtils.clamp(directions[1].angleTo(directions[2]), 0, 1.4),
    ],
    splay: MathUtils.clamp(Math.atan2(first.x, Math.hypot(first.y, first.z)), -0.3, 0.3),
    first: directions[0],
  };
}
