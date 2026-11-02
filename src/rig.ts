import * as T from 'three';
import { constrainWrist, fingerArticulation } from './hand-articulation.js';
import { capturedFootLift } from './video-grounding.js';
import {
  SOMA_REST_HEIGHT,
  SOMA_SUPPORTS,
  somaSupportPoints,
  textMotionFloor,
} from './text-motion-grounding.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { preserveEmoteSkin } from './emote-skin.js';
import { animationName, EMOTE_MAX_BYTES, validateEmoteBounds } from './export-settings.js';
import {
  compileTimeline,
  samplePoses,
  type CompiledTimeline,
  type SourcePoseCache,
} from './timeline-evaluator.js';
import { type Pose } from './timeline.js';
import {
  controlsAt,
  mapping,
  SOMA_NAMES,
  SOMA_PARENTS,
  type HandPose,
  type Motion,
  type Project,
} from './motion.js';
const v = () => new T.Vector3();
const q = () => new T.Quaternion();
export const world = (o: T.Object3D) => o.getWorldPosition(v());
export function worldRotation(o: T.Object3D, value: T.Quaternion) {
  o.quaternion.copy(o.parent ? o.parent.getWorldQuaternion(q()).invert().multiply(value) : value);
  o.updateWorldMatrix(false, true);
}
export function aim(o: T.Object3D, child: T.Object3D, point: T.Vector3) {
  const from = world(child).sub(world(o)).normalize(),
    to = point.clone().sub(world(o)).normalize();
  if (to.lengthSq() < 1e-12) return;
  worldRotation(o, q().setFromUnitVectors(from, to).multiply(o.getWorldQuaternion(q())));
}
function aimDirection(o: T.Object3D, child: T.Object3D, direction: T.Vector3) {
  if (direction.lengthSq() < 1e-10) return;
  const length = world(o).distanceTo(world(child));
  aim(o, child, world(o).add(direction.normalize().multiplyScalar(length)));
}
function midpoint(a: T.Vector3, b: T.Vector3) {
  return a.clone().add(b).multiplyScalar(0.5);
}
function bodyFrame(across: T.Vector3, up: T.Vector3) {
  const x = across.normalize(),
    y = up.projectOnPlane(x).normalize();
  if (x.lengthSq() < 0.5 || y.lengthSq() < 0.5) return null;
  return q()
    .setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, x.clone().cross(y)))
    .normalize();
}
function yawOf(rotation: T.Quaternion) {
  const forward = new T.Vector3(0, 0, 1).applyQuaternion(rotation);
  return Math.atan2(forward.x, forward.z);
}
function wrapAngle(value: number) {
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}
export function solveTwoBone(
  root: T.Object3D,
  mid: T.Object3D,
  end: T.Object3D,
  target: T.Vector3,
  pole: T.Vector3,
) {
  root.updateWorldMatrix(true, true);
  const a = world(root),
    b = world(mid),
    c = world(end),
    l1 = a.distanceTo(b),
    l2 = b.distanceTo(c);
  const direction = target.clone().sub(a);
  const raw = direction.length();
  if (raw < 1e-8) direction.copy(c).sub(a);
  direction.normalize();
  const d = T.MathUtils.clamp(raw, Math.abs(l1 - l2) + 1e-5, l1 + l2 - 1e-5);
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d),
    height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const perpendicular = pole
    .clone()
    .sub(a)
    .addScaledVector(direction, -pole.clone().sub(a).dot(direction));
  if (perpendicular.lengthSq() < 1e-8) {
    perpendicular.copy(b).sub(a).addScaledVector(direction, -b.clone().sub(a).dot(direction));
    if (perpendicular.lengthSq() < 1e-8)
      perpendicular.crossVectors(
        direction,
        Math.abs(direction.y) < 0.9 ? new T.Vector3(0, 1, 0) : new T.Vector3(0, 0, 1),
      );
  }
  const joint = a
    .clone()
    .addScaledVector(direction, along)
    .addScaledVector(perpendicular.normalize(), height);
  const reachable = a.clone().addScaledVector(direction, d);
  aim(root, mid, joint);
  aim(mid, end, reachable);
  return {
    error: world(end).distanceTo(target),
    reachable: raw <= l1 + l2 && raw >= Math.abs(l1 - l2),
  };
}
type Rest = { p: T.Vector3; q: T.Quaternion; s: T.Vector3; wq: T.Quaternion; wp: T.Vector3 };
type Contact = {
  left: number;
  right: number;
  leftAnchor: T.Vector3;
  rightAnchor: T.Vector3;
  leftRotation: T.Quaternion;
  rightRotation: T.Quaternion;
};
export class AvatarRig {
  bones = new Map<string, T.Bone>();
  rest = new Map<string, Rest>();
  contacts: Contact[] = [];
  source: Motion | null = null;
  sourceMode: Project['rootMotion'] | null = null;
  sourcePoles: Record<string, T.Vector3> = {};
  markers: Record<string, T.Vector3> = {};
  diagnostics = { left: true, right: true, reachError: 0, source: 'Procedural', airborne: false };
  appearance = '';
  compiled: CompiledTimeline | null = null;
  timelineKey: Project['timeline'] = null;
  timelineRoot: Project['rootMotion'] | null = null;
  timelineSpan = 0;
  timelineContacts: Contact[] = [];
  sourcePoseCache: SourcePoseCache = new WeakMap();
  captureLiftCache = new WeakMap<Extract<Motion, { skeleton: 'dcl-capture' }>, number[]>();
  textFloorCache = new WeakMap<Extract<Motion, { skeleton: 'soma30' }>, number>();
  constructor(public model: T.Group) {
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if ((o as T.Bone).isBone) {
        const b = o as T.Bone;
        this.bones.set(b.name, b);
        this.rest.set(b.name, {
          p: b.position.clone(),
          q: b.quaternion.clone(),
          s: b.scale.clone(),
          wq: b.getWorldQuaternion(q()),
          wp: world(b),
        });
      }
    });
    if (this.bones.size !== 62 || !this.bones.has('Avatar_Hips'))
      throw Error('The avatar does not match the 62-bone DCL profile.');
  }
  bone(name: string) {
    const b = this.bones.get(name.startsWith('Avatar_') ? name : 'Avatar_' + name);
    if (!b) throw Error('Missing bone: ' + name);
    return b;
  }
  setAppearance(skin: [number, number, number], hair: [number, number, number]) {
    const key = [...skin, ...hair].map((n) => n.toFixed(4)).join(':');
    if (this.appearance === key) return;
    this.appearance = key;
    this.model.traverse((object) => {
      const mesh = object as T.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as T.MeshStandardMaterial;
        if (!standard.color) continue;
        if (material.name === 'AvatarSkin_MAT' || material.name === 'AvatarMouth_MAT')
          standard.color.setRGB(...skin, T.SRGBColorSpace);
        if (material.name === 'Hair_MAT' || material.name === 'AvatarEyebrows_MAT')
          standard.color.setRGB(...hair, T.SRGBColorSpace);
        standard.needsUpdate = true;
      }
    });
  }
  initial(name: string) {
    return this.rest.get(this.bone(name).name)!;
  }
  reset() {
    for (const [name, b] of this.bones) {
      const r = this.rest.get(name)!;
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
      b.scale.copy(r.s);
    }
    this.model.updateMatrixWorld(true);
  }
  translatePelvis(delta: T.Vector3) {
    const b = this.bone('Hips');
    const target = world(b).add(delta);
    b.position.copy(b.parent!.worldToLocal(target));
    this.model.updateMatrixWorld(true);
  }
  retarget(m: Motion, time: number, rootMotion: Project['rootMotion']) {
    if (m.skeleton === 'dcl-capture') return this.retargetCapture(m, time, rootMotion);
    const f = Math.min(m.frames - 1, Math.max(0, time * m.fps)),
      a = Math.floor(f),
      b = Math.min(m.frames - 1, a + 1),
      u = f - a;
    const globals: T.Quaternion[] = [];
    for (let j = 0; j < 30; j++) {
      const local = q()
        .fromArray(m.rotations, a * 120 + j * 4)
        .normalize()
        .slerp(
          q()
            .fromArray(m.rotations, b * 120 + j * 4)
            .normalize(),
          u,
        );
      globals.push(SOMA_PARENTS[j] < 0 ? local : globals[SOMA_PARENTS[j]].clone().multiply(local));
    }
    // Apply source deltas on top of the target's current reference pose. This is
    // equivalent to a "retarget from current pose" workflow and avoids copying
    // source bind-axis assumptions into the DCL skeleton.
    for (let j = 0; j < 30; j++) {
      const target = mapping[SOMA_NAMES[j]];
      if (target)
        worldRotation(this.bone(target), globals[j].clone().multiply(this.initial(target).wq));
    }
    const root = v()
      .fromArray(m.roots, a * 3)
      .lerp(v().fromArray(m.roots, b * 3), u);
    const scale = this.initial('Hips').wp.y / SOMA_REST_HEIGHT;
    const origin = v().fromArray(m.roots, 0);
    const textMotion = !m.generation?.video;
    const sourceRootY = root.y;
    // Root Y is an absolute height, not a displacement from the first pose.
    // Recentring a crouched first frame at standing height lifts the entire clip.
    if (textMotion || m.generation?.video?.rootSpace === 'camera-y-up-v2')
      origin.y = SOMA_REST_HEIGHT;
    root.sub(origin).multiplyScalar(scale);
    if (rootMotion === 'inPlace') root.x = root.z = 0;
    root.add(this.initial('Hips').wp);
    const hips = this.bone('Hips');
    hips.position.copy(hips.parent!.worldToLocal(root));
    this.model.updateMatrixWorld(true);
    if (textMotion) {
      // Transfer foot clearance as well as root height. Different leg proportions
      // otherwise leave crouches floating even with the absolute root corrected.
      // Follow the source clearance instead of pinning feet: jumps remain airborne.
      let floor = this.textFloorCache.get(m);
      if (floor === undefined) {
        floor = textMotionFloor(m);
        this.textFloorCache.set(m, floor);
      }
      const points = somaSupportPoints(globals, new T.Vector3(0, sourceRootY, 0));
      const sourceClearance = (Math.min(...points.map((point) => point.y)) - floor) * scale;
      const targetClearance = Math.min(
        ...SOMA_SUPPORTS.map(([, name]) => world(this.bone(name)).y - this.initial(name).wp.y),
      );
      this.translatePelvis(new T.Vector3(0, sourceClearance - targetClearance, 0));
    }
    for (const side of ['Left', 'Right']) {
      this.sourcePoles[side + 'Arm'] = world(this.bone(side + 'ForeArm'));
      this.sourcePoles[side + 'Leg'] = world(this.bone(side + 'Leg'));
    }
    this.model.updateMatrixWorld(true);
  }
  retargetCapture(
    m: Extract<Motion, { skeleton: 'dcl-capture' }>,
    time: number,
    rootMotion: Project['rootMotion'],
  ) {
    const f = Math.min(m.frames - 1, Math.max(0, time * m.fps)),
      a = Math.floor(f),
      b = Math.min(m.frames - 1, a + 1),
      u = f - a;
    const source = (joint: number) =>
      v()
        .fromArray(m.positions, a * 99 + joint * 3)
        .lerp(v().fromArray(m.positions, b * 99 + joint * 3), u);
    const detail = (joint: number) =>
      v()
        .fromArray(m.details, a * 144 + joint * 3)
        .lerp(v().fromArray(m.details, b * 144 + joint * 3), u);
    const posePoint = source;
    const poseDetail = detail;
    const hips = midpoint(posePoint(23), posePoint(24));
    const shoulder = midpoint(posePoint(11), posePoint(12));
    const trajectory = m.trajectory
      ? v()
          .fromArray(m.trajectory, a * 3)
          .lerp(v().fromArray(m.trajectory, b * 3), u)
      : v();
    const targetHeight = this.initial('Head').wp.y - this.initial('LeftFoot').wp.y;
    trajectory.multiplyScalar(targetHeight / 1.7);
    if (rootMotion === 'inPlace') trajectory.x = trajectory.z = 0;
    const hipTarget = this.initial('Hips').wp.clone().add(trajectory);
    const hipBone = this.bone('Hips');
    hipBone.position.copy(hipBone.parent!.worldToLocal(hipTarget));
    const rootFrame = bodyFrame(posePoint(23).sub(posePoint(24)), shoulder.clone().sub(hips));
    if (rootFrame) worldRotation(hipBone, rootFrame.clone().multiply(this.initial('Hips').wq));
    this.model.updateMatrixWorld(true);

    // FK pass only: every source segment supplies direction while the target
    // segment keeps its own length. IK is intentionally deferred until evaluate().
    const chestFrame = bodyFrame(posePoint(11).sub(posePoint(12)), shoulder.clone().sub(hips));
    if (rootFrame && chestFrame)
      ['Spine', 'Spine1', 'Spine2'].forEach((name, i) =>
        worldRotation(
          this.bone(name),
          rootFrame
            .clone()
            .slerp(chestFrame, (i + 1) / 3)
            .multiply(this.initial(name).wq),
        ),
      );
    const headTarget = midpoint(posePoint(7), posePoint(8));
    aimDirection(this.bone('Neck'), this.bone('Head'), headTarget.sub(shoulder));
    for (const [side, joints] of [
      ['Left', [11, 13, 15, 23, 25, 27]],
      ['Right', [12, 14, 16, 24, 26, 28]],
    ] as const) {
      const [, elbow, wrist, , knee, ankle] = joints;
      const shoulderPoint = posePoint(joints[0]);
      const elbowPoint = posePoint(elbow);
      const wristPoint = posePoint(wrist);
      aimDirection(
        this.bone(side + 'Shoulder'),
        this.bone(side + 'Arm'),
        shoulderPoint.clone().sub(shoulder),
      );
      const armRoot = this.bone(side + 'Arm');
      aimDirection(armRoot, this.bone(side + 'ForeArm'), elbowPoint.clone().sub(shoulderPoint));
      aimDirection(
        this.bone(side + 'ForeArm'),
        this.bone(side + 'Hand'),
        wristPoint.clone().sub(elbowPoint),
      );
      const legRoot = this.bone(side + 'UpLeg');
      const hipPoint = posePoint(joints[3]);
      const kneePoint = posePoint(knee);
      const anklePoint = posePoint(ankle);
      aimDirection(legRoot, this.bone(side + 'Leg'), kneePoint.clone().sub(hipPoint));
      aimDirection(
        this.bone(side + 'Leg'),
        this.bone(side + 'Foot'),
        anklePoint.clone().sub(kneePoint),
      );

      this.sourcePoles[side + 'Arm'] = world(this.bone(side + 'ForeArm'));
      this.sourcePoles[side + 'Leg'] = world(this.bone(side + 'Leg'));

      const footOffset = side === 'Left' ? 42 : 45;
      const footReliable = [footOffset, footOffset + 1].every(
        (j) => Math.min(m.detailConfidence[a * 48 + j], m.detailConfidence[b * 48 + j]) >= 0.12,
      );
      const toeDirection = footReliable
        ? midpoint(poseDetail(footOffset), poseDetail(footOffset + 1)).sub(posePoint(ankle))
        : posePoint(side === 'Left' ? 31 : 32).sub(posePoint(side === 'Left' ? 29 : 30));
      if (toeDirection.lengthSq() > 1e-8) {
        const foot = this.bone(side + 'Foot'),
          toe = this.bone(side + 'ToeBase');
        aim(
          foot,
          toe,
          world(foot).add(
            toeDirection.normalize().multiplyScalar(world(foot).distanceTo(world(toe))),
          ),
        );
      }
      this.markers[side + 'Hand'] = world(this.bone(side + 'Hand'));
      this.markers[side + 'Foot'] = world(this.bone(side + 'Foot'));
      this.markers[side + 'Knee'] = this.sourcePoles[side + 'Leg'];
    }
    this.applyHandReference(m, time, 1, rootMotion);
    if (m.metadata.groundingVersion) {
      let lifts = this.captureLiftCache.get(m);
      if (!lifts) {
        lifts = capturedFootLift(m);
        this.captureLiftCache.set(m, lifts);
      }
      const clearance = Math.min(
        ...['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase'].map(
          (name) => world(this.bone(name)).y - this.initial(name).wp.y,
        ),
      );
      const lift = (T.MathUtils.lerp(lifts[a], lifts[b], u) * targetHeight) / 1.7;
      this.translatePelvis(new T.Vector3(0, lift - clearance, 0));
      for (const side of ['Left', 'Right']) {
        this.markers[side + 'Hand'] = world(this.bone(side + 'Hand'));
        this.markers[side + 'Foot'] = world(this.bone(side + 'Foot'));
        this.sourcePoles[side + 'Leg'] = world(this.bone(side + 'Leg'));
        this.markers[side + 'Knee'] = this.sourcePoles[side + 'Leg'];
      }
    }
    this.model.updateMatrixWorld(true);
  }
  applyHandReference(
    m: Extract<Motion, { skeleton: 'dcl-capture' }>,
    time: number,
    wristInfluence = 0,
    rootMotion: Project['rootMotion'] = 'source',
  ) {
    const f = Math.min(m.frames - 1, Math.max(0, time * m.fps));
    const a = Math.floor(f),
      b = Math.min(m.frames - 1, a + 1),
      u = f - a;
    const point = (joint: number) =>
      v()
        .fromArray(m.details, a * 144 + joint * 3)
        .lerp(v().fromArray(m.details, b * 144 + joint * 3), u);
    const confidence = (joint: number) =>
      Math.min(m.detailConfidence[a * 48 + joint] || 0, m.detailConfidence[b * 48 + joint] || 0);
    const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
    for (const side of ['Left', 'Right'] as const) {
      const offset = side === 'Left' ? 0 : 21;
      if ([0, 5, 9, 17].some((joint) => confidence(offset + joint) < 0.12)) continue;
      const hand = this.bone(side + 'Hand');
      const middle = this.bone(`${side}HandMiddle1`);
      const bodyWrist = hand.getWorldQuaternion(q());
      const palmForward = point(offset + 9).sub(point(offset));
      const palmAcross = point(offset + 17).sub(point(offset + 5));
      if (palmForward.lengthSq() < 1e-6 || palmAcross.projectOnPlane(palmForward).lengthSq() < 1e-6)
        continue;
      if (palmForward.lengthSq() > 1e-8) aimDirection(hand, middle, palmForward);
      const axis = world(middle).sub(world(hand)).normalize();
      const targetLateral = world(this.bone(`${side}HandPinky1`))
        .sub(world(this.bone(`${side}HandIndex1`)))
        .projectOnPlane(axis)
        .normalize();
      const sourceLateral = point(offset + 17)
        .sub(point(offset + 5))
        .projectOnPlane(axis)
        .normalize();
      if (targetLateral.lengthSq() > 0.5 && sourceLateral.lengthSq() > 0.5) {
        const angle = Math.atan2(
          axis.dot(targetLateral.clone().cross(sourceLateral)),
          T.MathUtils.clamp(targetLateral.dot(sourceLateral), -1, 1),
        );
        worldRotation(
          hand,
          q().setFromAxisAngle(axis, angle).multiply(hand.getWorldQuaternion(q())),
        );
      }
      hand.quaternion.copy(
        constrainWrist(hand.quaternion, this.initial(side + 'Hand').q, middle.position),
      );
      hand.updateWorldMatrix(false, true);
      const capturedWrist = hand.getWorldQuaternion(q());
      worldRotation(
        hand,
        bodyWrist.clone().slerp(capturedWrist, T.MathUtils.clamp(wristInfluence, 0, 1)),
      );

      // Fingers are transferred in palm-local space. This keeps their captured
      // articulation intact while the wrist remains an independent channel.
      const basis = (forward: T.Vector3, lateral: T.Vector3) => {
        const y = forward.normalize();
        let x = lateral.projectOnPlane(y).normalize();
        if (x.lengthSq() < 1e-8) x = new T.Vector3(side === 'Left' ? 1 : -1, 0, 0);
        const z = x.clone().cross(y).normalize();
        x = y.clone().cross(z).normalize();
        return q().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
      };
      const sourceBasis = basis(
        point(offset + 9).sub(point(offset)),
        point(offset + 17).sub(point(offset + 5)),
      );
      const restForward = this.initial(side + 'HandMiddle1')
        .wp.clone()
        .sub(this.initial(side + 'Hand').wp);
      const restAcross = this.initial(side + 'HandPinky1')
        .wp.clone()
        .sub(this.initial(side + 'HandIndex1').wp);
      const restBasis = basis(restForward, restAcross);
      const palmar = new T.Vector3(0, 0, side === 'Left' ? 1 : -1).applyQuaternion(restBasis);
      for (let finger = 0; finger < 5; finger++) {
        const first = offset + 1 + finger * 4;
        if ([0, 1, 2, 3].some((i) => confidence(first + i) < 0.12)) continue;
        const articulation = fingerArticulation(
          [0, 1, 2, 3].map((i) => point(first + i)),
          sourceBasis,
          side,
        );
        if (!articulation) continue;
        for (let segment = 1; segment <= 3; segment++) {
          const name = side + 'Hand' + fingerNames[finger] + segment;
          const bone = this.bone(name),
            rest = this.initial(name);
          const childRest = this.initial(side + 'Hand' + fingerNames[finger] + (segment + 1));
          const forward = childRest.wp.clone().sub(rest.wp).normalize();
          const parentRest = this.rest.get(bone.parent!.name)!;
          const parentInverse = parentRest.wq.clone().invert();
          // Each hinge is calibrated in the bind pose and expressed in the
          // parent's local frame. Parent flexion and IK carry it automatically.
          const hinge = forward.clone().cross(palmar).normalize().applyQuaternion(parentInverse);
          const flexion = q().setFromAxisAngle(
            hinge,
            Math.min(articulation.flex[segment - 1], finger === 0 ? 1.15 : Math.PI),
          );
          bone.quaternion.copy(flexion).multiply(rest.q);
          if (segment === 1 && finger > 0) {
            const splayAxis = forward
              .clone()
              .cross(new T.Vector3(1, 0, 0).applyQuaternion(restBasis))
              .normalize()
              .applyQuaternion(parentInverse);
            bone.quaternion.premultiply(q().setFromAxisAngle(splayAxis, articulation.splay));
          } else if (segment === 1) {
            // The thumb CMC has opposition; keep its rest roll and bound its
            // swing. Never apply a source model's quaternion as a DCL rotation.
            const target = articulation.first
              .clone()
              .applyQuaternion(sourceBasis.clone().invert())
              .applyQuaternion(restBasis);
            const swing = q().setFromUnitVectors(forward, target);
            const angle = 2 * Math.acos(T.MathUtils.clamp(Math.abs(swing.w), 0, 1));
            if (angle > 1.05) swing.slerp(q(), 1 - 1.05 / angle);
            const localSwing = parentInverse.clone().multiply(swing).multiply(parentRest.wq);
            bone.quaternion.copy(localSwing).multiply(rest.q);
          }
        }
        this.bone(side + 'Hand' + fingerNames[finger] + '4').quaternion.copy(
          this.initial(side + 'Hand' + fingerNames[finger] + '4').q,
        );
      }
    }
    this.model.updateMatrixWorld(true);
  }
  motionEnergy(m: Extract<Motion, { skeleton: 'soma30' }>, time: number) {
    const center = Math.min(m.frames - 1, Math.max(0, Math.round(time * m.fps)));
    const before = Math.max(0, center - 2),
      after = Math.min(m.frames - 1, center + 2);
    let energy = 0;
    for (const joint of [11, 12, 13, 17, 18, 19]) {
      const qa = q()
        .fromArray(m.rotations, before * 120 + joint * 4)
        .normalize();
      const qb = q()
        .fromArray(m.rotations, after * 120 + joint * 4)
        .normalize();
      energy += qa.angleTo(qb);
    }
    const normalized = T.MathUtils.clamp(energy / 1.4, 0, 1);
    return normalized * normalized * (3 - 2 * normalized);
  }
  applyProceduralHands(start: HandPose, end: HandPose, weight: number) {
    const values: Record<HandPose, number[]> = {
      relaxed: [0.12, 0.12, 0.16, 0.18, 0.2],
      open: [0, 0, 0, 0, 0],
      fist: [0.68, 1, 1, 1, 1],
      point: [0.55, 0, 1, 1, 1],
      clap: [0.08, 0.05, 0.06, 0.08, 0.1],
    };
    const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
    for (const side of ['Left', 'Right'] as const) {
      const lateral = world(this.bone(`${side}HandPinky1`))
        .sub(world(this.bone(`${side}HandIndex1`)))
        .normalize();
      const sign = side === 'Left' ? 1 : -1;
      for (let finger = 0; finger < 5; finger++) {
        const curl = T.MathUtils.lerp(values[start][finger], values[end][finger], weight);
        for (let segment = 1; segment <= 3; segment++) {
          const bone = this.bone(`${side}Hand${fingerNames[finger]}${segment}`);
          const amount = curl * (finger === 0 ? 0.55 : segment === 1 ? 0.85 : 1.05);
          worldRotation(
            bone,
            q()
              .setFromAxisAngle(lateral, sign * amount)
              .multiply(bone.getWorldQuaternion(q())),
          );
        }
      }
    }
    this.model.updateMatrixWorld(true);
  }
  prepare(m: Motion | null, rootMotion: Project['rootMotion']) {
    if (this.source === m && this.sourceMode === rootMotion) return;
    this.source = m;
    this.sourceMode = rootMotion;
    this.contacts = [];
    if (!m) return;
    const frames: Record<
      'left' | 'right',
      { foot: T.Vector3; toe: T.Vector3; rotation: T.Quaternion }
    >[] = [];
    for (let i = 0; i < m.frames; i++) {
      this.reset();
      this.retarget(m, i / m.fps, rootMotion);
      frames.push({
        left: {
          foot: world(this.bone('LeftFoot')),
          toe: world(this.bone('LeftToeBase')),
          rotation: this.bone('LeftFoot').getWorldQuaternion(q()),
        },
        right: {
          foot: world(this.bone('RightFoot')),
          toe: world(this.bone('RightToeBase')),
          rotation: this.bone('RightFoot').getWorldQuaternion(q()),
        },
      });
    }
    this.buildContacts(frames, m.fps);
    this.reset();
  }
  buildContacts(
    frames: Record<'left' | 'right', { foot: T.Vector3; toe: T.Vector3; rotation: T.Quaternion }>[],
    fps = 30,
  ) {
    this.contacts = [];
    if (!frames.length) return;
    const weights: Record<'left' | 'right', number[]> = { left: [], right: [] };
    for (const side of ['left', 'right'] as const) {
      const sorted = frames
        .map((f) => Math.min(f[side].foot.y, f[side].toe.y))
        .sort((a, b) => a - b);
      const sampledFloor = sorted[Math.floor(sorted.length * 0.12)] ?? 0;
      const restFloor = Math.min(
        this.initial(side === 'left' ? 'LeftFoot' : 'RightFoot').wp.y,
        this.initial(side === 'left' ? 'LeftToeBase' : 'RightToeBase').wp.y,
      );
      const floor = Math.min(restFloor + 0.025, sampledFloor);
      let planted = false;
      for (let i = 0; i < frames.length; i++) {
        const current = frames[i][side],
          previous = frames[Math.max(0, i - 1)][side];
        const height = Math.min(current.foot.y, current.toe.y) - floor;
        const horizontal =
          Math.hypot(current.foot.x - previous.foot.x, current.foot.z - previous.foot.z) * fps;
        const vertical = Math.abs(current.foot.y - previous.foot.y) * fps;
        const heightScore =
          1 - T.MathUtils.smoothstep(height, planted ? 0.035 : 0.012, planted ? 0.1 : 0.065);
        const speedScore =
          1 -
          T.MathUtils.smoothstep(
            horizontal + vertical * 0.55,
            planted ? 0.22 : 0.12,
            planted ? 0.8 : 0.48,
          );
        const score = T.MathUtils.clamp(heightScore * speedScore, 0, 1);
        planted = planted ? score > 0.18 : score > 0.52;
        weights[side].push(planted ? score : 0);
      }
      // Close short detection gaps, remove implausibly short contacts and feather both edges.
      for (let i = 1; i < frames.length - 1; i++)
        if (!weights[side][i] && weights[side][i - 1] && weights[side][i + 1])
          weights[side][i] = Math.min(weights[side][i - 1], weights[side][i + 1]);
      let begin = 0;
      while (begin < frames.length) {
        while (begin < frames.length && !weights[side][begin]) begin++;
        let end = begin;
        while (end < frames.length && weights[side][end]) end++;
        if (end - begin > 0 && end - begin < 3)
          for (let i = begin; i < end; i++) weights[side][i] = 0;
        begin = end;
      }
      const binary = weights[side].map(Boolean);
      for (let i = 0; i < frames.length; i++)
        if (binary[i]) {
          let from = i,
            to = i;
          while (from > 0 && binary[from - 1]) from--;
          while (to < frames.length - 1 && binary[to + 1]) to++;
          const fade = Math.min(1, (i - from + 1) / 3, (to - i + 1) / 3);
          weights[side][i] = Math.max(weights[side][i], fade);
        }
    }
    let la = v(),
      ra = v(),
      lq = q(),
      rq = q(),
      left = false,
      right = false;
    for (let i = 0; i < frames.length; i++) {
      const nl = weights.left[i] > 0,
        nr = weights.right[i] > 0;
      if (nl && !left) {
        la = frames[i].left.foot.clone().setY(this.initial('LeftFoot').wp.y);
        lq = frames[i].left.rotation.clone();
      }
      if (nr && !right) {
        ra = frames[i].right.foot.clone().setY(this.initial('RightFoot').wp.y);
        rq = frames[i].right.rotation.clone();
      }
      left = nl;
      right = nr;
      this.contacts.push({
        left: weights.left[i],
        right: weights.right[i],
        leftAnchor: la.clone(),
        rightAnchor: ra.clone(),
        leftRotation: lq.clone(),
        rightRotation: rq.clone(),
      });
    }
    this.reset();
  }
  capturePose(): Pose {
    return new Map(
      [...this.bones].map(([n, b]) => [n, { p: b.position.clone(), q: b.quaternion.clone() }]),
    );
  }
  applyPose(pose: Pose) {
    for (const [name, value] of pose) {
      const bone = this.bones.get(name)!;
      bone.position.copy(value.p);
      bone.quaternion.copy(value.q);
    }
    this.model.updateMatrixWorld(true);
    for (const side of ['Left', 'Right']) {
      this.sourcePoles[side + 'Arm'] = world(this.bone(side + 'ForeArm'));
      this.sourcePoles[side + 'Leg'] = world(this.bone(side + 'Leg'));
    }
  }
  prepareTimeline(p: Project) {
    if (
      this.timelineKey === p.timeline &&
      this.timelineRoot === p.rootMotion &&
      this.timelineSpan === p.duration
    ) {
      this.contacts = this.timelineContacts;
      return;
    }
    this.reset();
    // Timeline root motion uses world Y as up. The imported armature may be
    // rotated/scaled (the DCL avatar uses centimetres and a rotated parent).
    // Only the hips are lifted into world space; all other bones stay local.
    const parent = this.bone('Hips').parent!;
    const parentMatrix = parent.matrixWorld.clone();
    const inverseParent = parentMatrix.clone().invert();
    const parentRotation = parent.getWorldQuaternion(q());
    const inverseRotation = parentRotation.clone().invert();
    const worldRoot = (pose: Pose) => {
      const hips = pose.get('Avatar_Hips')!;
      hips.p.applyMatrix4(parentMatrix);
      hips.q.premultiply(parentRotation).normalize();
      return pose;
    };
    this.compiled = compileTimeline(
      p,
      worldRoot(this.capturePose()),
      (asset, time) => {
        const source = { ...p, ...asset, timeline: null };
        this.reset();
        this.evaluateBase(source, time);
        this.evaluateHands(source, time);
        if (asset.preset !== 'motion') {
          // These authored presets keep their feet planted while the pelvis moves.
          for (const side of ['Left', 'Right']) {
            solveTwoBone(
              this.bone(side + 'UpLeg'),
              this.bone(side + 'Leg'),
              this.bone(side + 'Foot'),
              this.initial(side + 'Foot').wp,
              this.initial(side + 'Leg')
                .wp.clone()
                .add(new T.Vector3(0, 0, 0.35)),
            );
            worldRotation(this.bone(side + 'Foot'), this.initial(side + 'Foot').wq);
          }
        }
        return worldRoot(this.capturePose());
      },
      this.sourcePoseCache,
    );
    for (const pose of this.compiled.poses) {
      const hips = pose.get('Avatar_Hips')!;
      hips.p.applyMatrix4(inverseParent);
      hips.q.premultiply(inverseRotation).normalize();
    }
    const frames = this.compiled.poses.map((pose) => {
      this.applyPose(pose);
      const side = (name: string) => ({
        foot: world(this.bone(name + 'Foot')),
        toe: world(this.bone(name + 'ToeBase')),
        rotation: this.bone(name + 'Foot').getWorldQuaternion(q()),
      });
      return { left: side('Left'), right: side('Right') };
    });
    this.buildContacts(frames);
    if (p.timeline?.seamless) {
      const start = Math.round(p.timeline.rangeStart * 30),
        end = Math.min(this.contacts.length - 1, Math.round(p.timeline.rangeEnd * 30));
      for (const side of ['left', 'right'] as const) {
        if (this.contacts[start]?.[side] > 0 && this.contacts[end]?.[side] > 0) {
          const anchor = side === 'left' ? 'leftAnchor' : 'rightAnchor';
          const rotation = side === 'left' ? 'leftRotation' : 'rightRotation';
          let first = end;
          while (first > start && this.contacts[first - 1][side] > 0) first--;
          for (let i = first; i <= end; i++) {
            this.contacts[i][anchor].copy(this.contacts[start][anchor]);
            this.contacts[i][rotation].copy(this.contacts[start][rotation]);
          }
          this.contacts[end][side] = this.contacts[start][side];
        }
        const first = this.contacts[start];
        if (!first) continue;
        const anchor = side === 'left' ? 'leftAnchor' : 'rightAnchor';
        const rotation = side === 'left' ? 'leftRotation' : 'rightRotation';
        const span = Math.max(
          1,
          Math.min(Math.round(p.timeline.seamDuration * 30), Math.floor((end - start) / 2)),
        );
        for (let i = Math.max(start + 1, end - span); i <= end; i++) {
          const weight = T.MathUtils.smoothstep((i - end + span) / span, 0, 1);
          const contact = this.contacts[i];
          if (first[side] > 0) {
            if (!contact[side]) {
              contact[anchor].copy(frames[i][side].foot);
              contact[rotation].copy(frames[i][side].rotation);
            }
            contact[anchor].lerp(first[anchor], weight);
            contact[rotation].slerp(first[rotation], weight);
          }
          contact[side] = T.MathUtils.lerp(contact[side], first[side], weight);
        }
      }
    }
    this.timelineKey = p.timeline;
    this.timelineRoot = p.rootMotion;
    this.timelineSpan = p.duration;
    this.timelineContacts = this.contacts;
    this.source = null;
    this.sourceMode = null;
  }
  evaluateBase(p: Project, t: number) {
    const phase = (t / p.duration) * Math.PI * 2;
    if (p.preset === 'motion' && p.motion) this.retarget(p.motion, t, p.rootMotion);
    else {
      this.translatePelvis(
        new T.Vector3(
          0,
          p.preset === 'squat' ? -0.23 * (0.5 - 0.5 * Math.cos(phase)) : Math.sin(phase) * 0.008,
          0,
        ),
      );
      for (const side of ['Left', 'Right']) {
        const sign = side === 'Left' ? 1 : -1;
        const hand = new T.Vector3(sign * 0.31, 1.02, 0.04);
        if (p.preset === 'wave' && side === 'Right')
          hand.set(-0.44 + Math.sin(phase * 2) * 0.1, 1.66, 0.14);
        solveTwoBone(
          this.bone(side + 'Arm'),
          this.bone(side + 'ForeArm'),
          this.bone(side + 'Hand'),
          hand,
          new T.Vector3(sign * 0.6, 1.05, -0.3),
        );
        worldRotation(
          this.bone(side + 'Hand'),
          this.bone(side + 'ForeArm')
            .getWorldQuaternion(q())
            .multiply(
              this.initial(side + 'ForeArm')
                .wq.clone()
                .invert(),
            )
            .multiply(this.initial(side + 'Hand').wq),
        );
      }
    }
  }
  evaluateHands(p: Project, t: number) {
    if (p.handMode === 'procedural') {
      const energy = p.motion?.skeleton === 'soma30' ? this.motionEnergy(p.motion, t) : 0;
      this.applyProceduralHands(p.handPoseStart, p.handPoseEnd, energy);
      return;
    }
    if (p.preset === 'motion' && p.motion?.skeleton === 'soma30') {
      if (p.handMode === 'reference' && p.handReference)
        this.applyHandReference(
          p.handReference,
          Math.min(t, p.handReference.frames / p.handReference.fps),
          p.handWristInfluence,
          p.rootMotion,
        );
    }
  }
  evaluate(p: Project, t: number, edit = false) {
    if (p.timeline) this.prepareTimeline(p);
    else this.prepare(p.motion, p.rootMotion);
    this.reset();
    const c = edit ? p.controls : controlsAt(p, t);
    if (p.timeline && this.compiled) this.applyPose(samplePoses(this.compiled.poses, t));
    else this.evaluateBase(p, t);
    // Timeline compilation visits every source frame. Its last elbow/knee must
    // never become the pole for the currently displayed frame (or another layer).
    for (const side of ['Left', 'Right']) {
      this.sourcePoles[side + 'Arm'] = world(this.bone(side + 'ForeArm'));
      this.sourcePoles[side + 'Leg'] = world(this.bone(side + 'Leg'));
    }
    this.translatePelvis(new T.Vector3(0, c.pelvis, 0));
    const sample =
      this.contacts[
        Math.min(this.contacts.length - 1, Math.floor(t * (p.timeline ? 30 : p.motion?.fps || 30)))
      ];
    let maxError = 0;
    const targets: Record<string, T.Vector3> = {};
    const support: Record<string, boolean> = {};
    for (const side of ['Left', 'Right'] as const) {
      const key = side === 'Left' ? 'left' : 'right';
      const rest = this.initial(side + 'Foot');
      let target = world(this.bone(side + 'Foot'));
      const weight = c.ground ? (sample ? sample[key] : 1) : 0;
      const active = weight > 0.001;
      support[key] = active;
      if (active)
        target.lerp(
          sample ? sample[key === 'left' ? 'leftAnchor' : 'rightAnchor'] : rest.wp,
          weight,
        );
      target.add(new T.Vector3(...c[side === 'Left' ? 'leftFoot' : 'rightFoot']));
      if (c.ground) target.y = Math.max(rest.wp.y, target.y);
      targets[side] = target;
    }
    // Lower the pelvis only when vertical reach is impossible; never scale limbs.
    if (c.ground) {
      let drop = 0;
      for (const side of ['Left', 'Right']) {
        const hip = world(this.bone(side + 'UpLeg')),
          knee = world(this.bone(side + 'Leg')),
          foot = world(this.bone(side + 'Foot'));
        const len = hip.distanceTo(knee) + knee.distanceTo(foot) - 0.0005,
          tar = targets[side];
        const horizontal = (hip.x - tar.x) ** 2 + (hip.z - tar.z) ** 2;
        const y = Math.sqrt(Math.max(0, len * len - horizontal));
        drop = Math.min(drop, tar.y + y - hip.y);
      }
      if (drop < 0) this.translatePelvis(new T.Vector3(0, Math.max(-0.4, drop), 0));
    }
    for (const side of ['Left', 'Right'] as const) {
      const foot = this.bone(side + 'Foot'),
        sign = side === 'Left' ? 1 : -1;
      const orientation = foot.getWorldQuaternion(q());
      const contactWeight = c.ground && sample ? sample[side === 'Left' ? 'left' : 'right'] : 0;
      const contactOrientation = sample?.[side === 'Left' ? 'leftRotation' : 'rightRotation'];
      const pole =
        this.sourcePoles[side + 'Leg']?.clone() ||
        world(this.bone(side + 'UpLeg')).add(new T.Vector3(sign * 0.05, -0.35, c.knee));
      pole.z += c.knee - 0.35;
      const correction =
        c.ground ||
        Math.abs(c.knee - 0.35) > 1e-8 ||
        c[side === 'Left' ? 'leftFoot' : 'rightFoot'].some((n) => n !== 0);
      if (correction) {
        const result = solveTwoBone(
          this.bone(side + 'UpLeg'),
          this.bone(side + 'Leg'),
          foot,
          targets[side],
          pole,
        );
        maxError = Math.max(maxError, result.error);
        worldRotation(
          foot,
          contactOrientation ? orientation.slerp(contactOrientation, contactWeight) : orientation,
        );
      }
      this.markers[side + 'Foot'] = world(foot);
      this.markers[side + 'Knee'] = pole;
      const hand = this.bone(side + 'Hand');
      const handTarget = world(hand).add(
        new T.Vector3(...c[side === 'Left' ? 'leftHand' : 'rightHand']),
      );
      const handOrientation = hand.getWorldQuaternion(q());
      const handOffset = c[side === 'Left' ? 'leftHand' : 'rightHand'];
      if (
        c.handIK &&
        (handOffset.some((value) => Math.abs(value) > 1e-8) || Math.abs(c.elbow + 0.3) > 1e-8)
      ) {
        const result = solveTwoBone(
          this.bone(side + 'Arm'),
          this.bone(side + 'ForeArm'),
          hand,
          handTarget,
          (
            this.sourcePoles[side + 'Arm']?.clone() ||
            world(this.bone(side + 'Arm')).add(new T.Vector3(sign * 0.4, -0.2, c.elbow))
          ).add(new T.Vector3(0, 0, c.elbow + 0.3)),
        );
        maxError = Math.max(maxError, result.error);
        worldRotation(hand, handOrientation);
      }
      this.markers[side + 'Hand'] = world(hand);
    }
    if (!p.timeline) this.evaluateHands(p, t);
    // User orientation offsets follow the avatar heading, independent of bone bind axes.
    const heading = q().setFromAxisAngle(
      new T.Vector3(0, 1, 0),
      yawOf(this.bone('Hips').getWorldQuaternion(q())),
    );
    for (const side of ['Left', 'Right'] as const)
      for (const part of ['Foot', 'Hand'] as const) {
        const key = `${side === 'Left' ? 'left' : 'right'}${part}Rotation` as const;
        const angles = c[key] ?? [0, 0, 0];
        if (angles.every((n) => n === 0)) continue;
        const delta = q().setFromEuler(new T.Euler(...angles, 'YXZ'));
        delta.premultiply(heading).multiply(heading.clone().invert());
        const bone = this.bone(side + part);
        worldRotation(bone, delta.multiply(bone.getWorldQuaternion(q())));
      }
    this.model.updateMatrixWorld(true);
    this.diagnostics = {
      left: support.left,
      right: support.right,
      reachError: maxError,
      source: p.timeline
        ? 'Timeline'
        : p.preset === 'motion'
          ? p.motion?.source || 'Motion'
          : 'Procedural',
      airborne:
        (p.preset === 'motion' || !!p.timeline) && c.ground && !support.left && !support.right,
    };
  }
  async export(p: Project, emote = false) {
    const start = p.timeline?.exportRange ? p.timeline.rangeStart : 0;
    const end = p.timeline?.exportRange ? p.timeline.rangeEnd : p.duration;
    const duration = end - start;
    if (emote && duration > 10 + 1e-6)
      throw Error('DCL emotes must be at most 10 seconds. Select a shorter export range.');
    const count = Math.ceil(duration * 30) + 1,
      times = new Float32Array(count);
    const values = new Map<string, { p: number[]; q: number[]; s: number[] }>();
    for (const name of this.bones.keys()) values.set(name, { p: [], q: [], s: [] });
    for (let i = 0; i < count; i++) {
      const t = Math.min(duration, i / 30);
      times[i] = t;
      this.evaluate(p, start + t);
      if (emote) {
        this.model.traverse((node) => {
          if ((node as T.SkinnedMesh).isSkinnedMesh) (node as T.SkinnedMesh).skeleton.update();
        });
        const bounds = new T.Box3().setFromObject(this.model, true);
        if (bounds.isEmpty())
          for (const bone of this.bones.values()) bounds.expandByPoint(world(bone));
        validateEmoteBounds(world(this.bone('Hips')), bounds, t);
      }
      for (const [name, b] of this.bones) {
        const out = values.get(name)!;
        out.p.push(...b.position.toArray());
        out.q.push(...b.quaternion.toArray());
        out.s.push(...b.scale.toArray());
      }
    }
    const tracks: T.KeyframeTrack[] = [];
    for (const [name, data] of values) {
      tracks.push(
        new T.VectorKeyframeTrack(name + '.position', times, data.p),
        new T.QuaternionKeyframeTrack(name + '.quaternion', times, data.q),
        new T.VectorKeyframeTrack(name + '.scale', times, data.s),
      );
    }
    const clip = new T.AnimationClip(animationName(p.animationName), duration, tracks);
    this.reset();
    const exported = clone(this.model);
    const exporter = new GLTFExporter();
    if (emote) {
      preserveEmoteSkin(exporter, exported, this.bones.keys());
      // Keep deform bones and only the ancestors needed to preserve their transforms.
      const keep = new Set<T.Object3D>([exported]);
      exported.traverse((node) => {
        if ((node as T.Bone).isBone && this.bones.has(node.name)) {
          let ancestor: T.Object3D | null = node;
          while (ancestor) {
            keep.add(ancestor);
            ancestor = ancestor.parent;
          }
        }
      });
      const remove: T.Object3D[] = [];
      exported.traverse((node) => {
        if (!keep.has(node)) remove.push(node);
      });
      remove.forEach((node) => node.removeFromParent());
    }
    // GLTFLoader represents glTF scenes as Groups. Exporting that Group directly
    // creates an extra "Scene" node/Blender empty above Armature. Use an actual
    // Scene container so Armature remains the glTF scene root, as in DCL assets.
    const exportScene = new T.Scene();
    exportScene.name = exported.name || 'Scene';
    exported.updateMatrix();
    const wrapperHasTransform = !exported.matrix.equals(new T.Matrix4());
    for (const child of [...exported.children]) {
      // The wrapper is static; animation tracks target the bones beneath Armature.
      if (wrapperHasTransform) child.applyMatrix4(exported.matrix);
      exportScene.add(child);
    }
    const out = await exporter.parseAsync(exportScene, {
      binary: true,
      onlyVisible: true,
      animations: [clip],
      trs: true,
    });
    if (emote && (out as ArrayBuffer).byteLength > EMOTE_MAX_BYTES)
      throw Error('The emote exceeds the 1 MB export limit. Shorten the export range.');
    return out as ArrayBuffer;
  }
}
