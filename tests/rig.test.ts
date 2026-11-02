import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { AvatarRig, solveTwoBone, world } from '../src/rig';
import { dclToonMaterial } from '../src/dcl-rendering';
import { newProject, controlsAt, motionSchema, projectSchema, type Motion } from '../src/motion';
import blender from './fixtures/blender-rest.json';
import trackedHands from './fixtures/tracked-hands-fast.json';
import { dclPoseToSoma } from '../src/dcl-pose-bridge';
import { forwardPose } from '../server/kimodo-constraints';
import { mapping, SOMA_NAMES, SOMA_PARENTS } from '../src/motion';
import { newTimeline, newStrip } from '../src/timeline';
import { somaHandLandmarks } from '../src/somahand';
function fixture() {
  const b = readFileSync(new URL('../public/assets/Avatar.glb', import.meta.url));
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  const jointSet = new Set(j.skins[0].joints);
  const nodes: T.Object3D[] = j.nodes.map((n: any, i: number) => {
    const o = jointSet.has(i) ? new T.Bone() : new T.Group();
    o.name = n.name;
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  j.nodes.forEach((n: any, i: number) =>
    n.children?.forEach((k: number) => nodes[i].add(nodes[k])),
  );
  const model = new T.Group();
  j.scenes[0].nodes.forEach((i: number) => model.add(nodes[i]));
  return new AvatarRig(model);
}
function captureMotion(): Extract<Motion, { skeleton: 'dcl-capture' }> {
  const frames = 60,
    positions: number[] = [],
    details: number[] = [];
  const base = Array.from({ length: 33 }, () => new T.Vector3());
  Object.entries({
    7: [-0.05, 0.72, 0],
    8: [0.05, 0.72, 0],
    11: [0.3, 0.5, 0],
    12: [-0.3, 0.5, 0],
    13: [0.55, 0.46, 0.03],
    14: [-0.55, 0.46, 0.03],
    15: [0.8, 0.45, 0],
    16: [-0.8, 0.45, 0],
    23: [0.1, 0, 0],
    24: [-0.1, 0, 0],
    25: [0.1, -0.45, 0.06],
    26: [-0.1, -0.45, 0.06],
    27: [0.1, -0.9, 0],
    28: [-0.1, -0.9, 0],
  }).forEach(([index, value]) => base[Number(index)].fromArray(value));
  const detailFrame = (left: boolean) =>
    Array.from({ length: 21 }, (_, i) => {
      const wrist = base[left ? 15 : 16],
        sign = left ? 1 : -1;
      if (!i) return wrist.clone();
      const finger = Math.floor((i - 1) / 4),
        segment = ((i - 1) % 4) + 1;
      return wrist.clone().add(new T.Vector3(sign * segment * 0.025, (finger - 2) * 0.012, 0.01));
    });
  for (let frame = 0; frame < frames; frame++) {
    positions.push(...base.flatMap((point) => point.toArray()));
    const hands = [...detailFrame(true), ...detailFrame(false)];
    const feet = [
      base[27].clone().add(new T.Vector3(0.02, 0, -0.12)),
      base[27].clone().add(new T.Vector3(-0.02, 0, -0.12)),
      base[27].clone().add(new T.Vector3(0, 0, 0.08)),
      base[28].clone().add(new T.Vector3(0.02, 0, -0.12)),
      base[28].clone().add(new T.Vector3(-0.02, 0, -0.12)),
      base[28].clone().add(new T.Vector3(0, 0, 0.08)),
    ];
    details.push(...[...hands, ...feet].flatMap((point) => point.toArray()));
  }
  return {
    version: 2,
    skeleton: 'dcl-capture',
    source: 'mediapipe+rtmw3d',
    fps: 30,
    frames,
    positions,
    details,
    confidence: Array(frames * 33).fill(1),
    detailConfidence: Array(frames * 48).fill(1),
    trajectory: Array.from({ length: frames }, (_, i) => [(i / (frames - 1)) * 0.5, 0, 0]).flat(),
    heading: Array(frames).fill(0),
    raw: { times: [0, 1], body: Array(264).fill(0), detail: Array(1064).fill(0) },
    metadata: {
      file: 'fixture.mp4',
      sampleFps: 10,
      smoothing: 0.4,
      warnings: [],
      providerVersion: 'test',
      retargetVersion: 'current-pose-chain-v1',
      repairedFrames: 0,
    },
  };
}
describe('DCL rig against supplied GLB hierarchy', () => {
  it('leaves the source pose intact with neutral IK and preserves finger locals during a wrist correction', () => {
    const rig = fixture(),
      p = newProject();
    p.preset = 'wave';
    p.duration = 2;
    p.handMode = 'procedural';
    p.handPoseStart = 'fist';
    p.handPoseEnd = 'fist';
    p.timeline = newTimeline(p);
    rig.evaluate(p, 0.4);
    const base = rig.capturePose(),
      wrist = rig.bone('LeftHand').getWorldQuaternion(new T.Quaternion());
    p.controls.handIK = true;
    rig.evaluate(p, 0.4);
    for (const [name, pose] of base)
      expect(
        rig.bones.get(name)!.quaternion.clone().normalize().angleTo(pose.q.clone().normalize()),
      ).toBeLessThan(1e-6);
    p.controls.leftHand = [-0.05, 0.02, 0.03];
    rig.evaluate(p, 0.4);
    expect(
      rig
        .bone('LeftHand')
        .getWorldQuaternion(new T.Quaternion())
        .normalize()
        .angleTo(wrist.normalize()),
    ).toBeLessThan(1e-6);
    for (const [name, pose] of base)
      if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(name))
        expect(
          rig.bones.get(name)!.quaternion.clone().normalize().angleTo(pose.q.clone().normalize()),
        ).toBeLessThan(1e-6);
  });
  it('round-trips reviewed DCL FK poses through SOMA without copying DCL bind axes or changing bone lengths', () => {
    const rig = fixture(),
      capture = captureMotion();
    rig.retargetCapture(capture, 0.5, 'source');
    const before = new Map(
      [...rig.bones].map(([name, bone]) => [
        name,
        bone.getWorldQuaternion(new T.Quaternion()).normalize(),
      ]),
    );
    const converted = dclPoseToSoma(rig),
      global = forwardPose(converted, [0, 1, 0]).global;
    // Reconstruct the actual local quaternion representation used by Kimodo outputs.
    const locals = global
      .map((q, i) => {
        const parent = SOMA_PARENTS[i];
        return parent < 0 ? q : global[parent].clone().invert().multiply(q);
      })
      .flatMap((q) => q.toArray());
    const motion: Extract<Motion, { skeleton: 'soma30' }> = {
      version: 1,
      skeleton: 'soma30',
      source: 'kimodo.cpp',
      fps: 30,
      frames: 60,
      prompt: 'roundtrip',
      seed: 1,
      roots: Array.from({ length: 60 }, () => [0, 1, 0]).flat(),
      rotations: Array.from({ length: 60 }, () => locals).flat(),
    };
    rig.reset();
    rig.retarget(motion, 0, 'source');
    for (const name of SOMA_NAMES.map((name) => mapping[name]).filter(Boolean)) {
      const bone = rig.bone(name);
      expect(
        bone.getWorldQuaternion(new T.Quaternion()).normalize().angleTo(before.get(bone.name)!),
      ).toBeLessThan(1e-6);
      // Hips is a translated root; height is calibrated for source/target leg
      // proportions. Every child keeps the target rig's authored bone lengths.
      if (name !== 'Hips') expect(bone.position.distanceTo(rig.initial(name).p)).toBeLessThan(1e-6);
    }
  });
  it('keeps real tracked fingers in anatomical hinge planes when the body turns or IK moves the wrists', () => {
    const rig = fixture(),
      capture = captureMotion();
    const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
    for (const tracked of trackedHands.frames) {
      for (let f = 0; f < capture.frames; f++) {
        capture.details.splice(f * 144, 126, ...tracked.details);
        capture.detailConfidence.splice(f * 48, 42, ...tracked.confidence);
      }
      rig.reset();
      rig.applyHandReference(capture, 0, 0);
      const local = rig.capturePose();
      for (const side of ['Left', 'Right'] as const) {
        const palm = rig
          .initial(side + 'HandPinky1')
          .wp.clone()
          .sub(rig.initial(side + 'HandIndex1').wp)
          .cross(
            rig
              .initial(side + 'HandMiddle1')
              .wp.clone()
              .sub(rig.initial(side + 'Hand').wp),
          )
          .normalize()
          .multiplyScalar(side === 'Left' ? 1 : -1);
        for (const finger of fingers)
          for (const segment of [2, 3]) {
            const name = side + 'Hand' + finger + segment,
              bone = rig.bone(name),
              rest = rig.initial(name);
            const hinge = rig
              .initial(side + 'Hand' + finger + (segment + 1))
              .wp.clone()
              .sub(rest.wp)
              .normalize()
              .cross(palm)
              .normalize()
              .applyQuaternion(rig.rest.get(bone.parent!.name)!.wq.clone().invert());
            const delta = bone.quaternion.clone().multiply(rest.q.clone().invert());
            const axis = new T.Vector3(delta.x, delta.y, delta.z);
            if (axis.length() > 1e-6)
              expect(Math.abs(axis.normalize().dot(hinge))).toBeCloseTo(1, 5);
            expect(delta.angleTo(new T.Quaternion())).toBeLessThanOrEqual(
              (segment === 2 ? 1.75 : 1.4) + 1e-6,
            );
            expect(bone.position.distanceTo(rest.p)).toBeLessThan(1e-7);
          }
      }
      // Turning the torso and moving the end effectors must not change the
      // local articulation. This is also the Hands-only layer contract.
      rig.reset();
      rig.bone('Hips').rotateY(2.1);
      rig.model.updateMatrixWorld(true);
      for (const side of ['Left', 'Right'] as const)
        solveTwoBone(
          rig.bone(side + 'Arm'),
          rig.bone(side + 'ForeArm'),
          rig.bone(side + 'Hand'),
          world(rig.bone(side + 'Hand')).add(new T.Vector3(-0.15, -0.2, 0.1)),
          world(rig.bone(side + 'ForeArm')).add(new T.Vector3(0, 0, 0.3)),
        );
      rig.applyHandReference(capture, 0, 0);
      for (const [name, pose] of local)
        if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(name))
          expect(
            rig.bones.get(name)!.quaternion.clone().normalize().angleTo(pose.q.clone().normalize()),
          ).toBeLessThan(1e-6);
    }
  });
  it('retargets official SOMAHand poses into the real DCL rig for both sides', () => {
    const rig = fixture(),
      motion = captureMotion();
    for (let frame = 0; frame < motion.frames; frame++) {
      for (const [side, offset] of [
        ['left', 0],
        ['right', 21],
      ] as const) {
        somaHandLandmarks(side, Array(32).fill(0)).forEach((point, j) =>
          point.toArray(motion.details, frame * 144 + (offset + j) * 3),
        );
      }
    }
    for (const side of ['Left', 'Right'] as const) {
      rig.reset();
      const wrist = world(rig.bone(side + 'Hand'));
      const before = world(rig.bone(side + 'HandMiddle4'));
      const lateral = world(rig.bone(side + 'HandPinky1'))
        .sub(world(rig.bone(side + 'HandIndex1')))
        .normalize();
      rig.applyHandReference(motion, 0, 0);
      const after = world(rig.bone(side + 'HandMiddle4'));
      expect(after.distanceTo(wrist)).toBeLessThan(before.distanceTo(wrist));
      expect(Math.abs(after.clone().sub(before).dot(lateral))).toBeLessThan(0.025);
      expect(after.y).toBeLessThan(before.y - 0.04);
    }
  });
  it('ignores a hand whose palm anchors cannot define a reliable wrist frame', () => {
    const rig = fixture(),
      motion = captureMotion();
    for (let frame = 0; frame < motion.frames; frame++) motion.detailConfidence[frame * 48 + 5] = 0;
    const wrist = rig.bone('LeftHand').getWorldQuaternion(new T.Quaternion());
    const finger = rig.bone('LeftHandIndex1').getWorldQuaternion(new T.Quaternion());
    rig.applyHandReference(motion, 0.5, 1);
    expect(rig.bone('LeftHand').getWorldQuaternion(new T.Quaternion()).angleTo(wrist)).toBeLessThan(
      1e-6,
    );
    expect(
      rig.bone('LeftHandIndex1').getWorldQuaternion(new T.Quaternion()).angleTo(finger),
    ).toBeLessThan(1e-4);
  });
  it('shows the rest pose when the timeline has no clips', () => {
    const r = fixture(),
      p = newProject();
    p.timeline = { ...newTimeline(p), assets: [], strips: [] };
    r.evaluate(p, 0);
    for (const name of ['Avatar_LeftArm', 'Avatar_RightArm'])
      expect(r.bones.get(name)!.quaternion.angleTo(r.rest.get(name)!.q)).toBeLessThan(0.001);
  });
  it('accumulates an actual retargeted capture root while preserving in-place mode', () => {
    const r = fixture(),
      p = newProject();
    p.preset = 'motion';
    p.motion = captureMotion();
    p.rootMotion = 'source';
    p.timeline = newTimeline(p);
    p.timeline.strips[0].repeat = 2;
    p.duration = 4;
    p.timeline.rangeEnd = 4;
    r.evaluate(p, 0);
    const first = world(r.bone('Hips'));
    r.evaluate(p, 2);
    const middle = world(r.bone('Hips'));
    r.evaluate(p, 4);
    const last = world(r.bone('Hips'));
    expect(middle.x - first.x).toBeGreaterThan(0.2);
    expect(last.x - first.x).toBeCloseTo((middle.x - first.x) * 2, 4);
    p.rootMotion = 'inPlace';
    r.evaluate(p, 4);
    expect(world(r.bone('Hips')).x).toBeCloseTo(first.x, 4);
  });
  it('composes a loop with final foot IK, deterministic seeks and unchanged bone lengths', () => {
    const r = fixture(),
      p = newProject();
    p.controls.ground = true;
    p.preset = 'wave';
    p.timeline = newTimeline(p);
    const a = {
      ...p.timeline.assets[0],
      id: 'squat-source',
      name: 'Squat',
      preset: 'squat' as const,
    };
    p.timeline.assets.push(a);
    p.timeline.strips[0].fadeOut = 0.4;
    p.timeline.strips.push({ ...newStrip(a, p.timeline.tracks[0].id, 3.6), fadeIn: 0.4 });
    p.duration = 7.6;
    p.timeline.rangeEnd = 7.6;
    p.timeline.seamless = true;
    p.keyframes = [
      { time: 0, controls: { ...p.controls, pelvis: -0.05 } },
      { time: 7.6, controls: { ...p.controls, pelvis: -0.1 } },
    ];
    const lengths = [...r.bones]
      .filter(([n]) => n !== 'Avatar_Hips')
      .map(([n, b]) => [n, b.position.length()] as const);
    r.evaluate(p, 0);
    const first = r.capturePose();
    for (const time of [3.8, 6, 1.2, 3.8]) {
      r.evaluate(p, time);
      expect(world(r.bone('LeftFoot')).y).toBeGreaterThanOrEqual(
        r.initial('LeftFoot').wp.y - 0.005,
      );
      for (const [n, length] of lengths)
        expect(r.bones.get(n)!.position.length()).toBeCloseTo(length, 6);
    }
    r.evaluate(p, 3.8);
    const original = r.capturePose();
    r.evaluate(p, 1);
    r.evaluate(p, 3.8);
    for (const [n, b] of original)
      expect(r.bones.get(n)!.quaternion.angleTo(b.q)).toBeLessThan(1e-6);
    r.evaluate(p, 7.6);
    for (const [n, b] of first) {
      expect(r.bones.get(n)!.position.distanceTo(b.p)).toBeLessThan(1e-5);
      expect(r.bones.get(n)!.quaternion.angleTo(b.q), n).toBeLessThan(1e-5);
    }
  });
  it('preserves all 62 joints and actual world scale', () => {
    const r = fixture();
    expect(r.bones.size).toBe(62);
    expect(world(r.bone('Hips')).y).toBeCloseTo(1, 4);
    expect(world(r.bone('Head')).y).toBeGreaterThan(1.7);
  });
  it('loads the customizable DCL avatar and accepts profile colors', () => {
    const avatar = fixture();
    const materials = [
      'AvatarSkin_MAT',
      'AvatarMouth_MAT',
      'Hair_MAT',
      'AvatarEyebrows_MAT',
      'AvatarEyes_MAT',
    ].map((name) => new T.MeshBasicMaterial({ name }));
    materials.forEach((material) => avatar.model.add(new T.Mesh(new T.BoxGeometry(), material)));
    const skin: [number, number, number] = [0.8, 0.6, 0.45];
    const hair: [number, number, number] = [0.2, 0.1, 0.04];
    avatar.setAppearance(skin, hair);
    expect(avatar.bones.size).toBe(62);
    expect(materials[0].color.equals(materials[1].color)).toBe(true);
    expect(materials[2].color.equals(materials[3].color)).toBe(true);
    expect(materials[4].color.equals(new T.Color('white'))).toBe(true);
  });
  it('uses the DCL toon material while preserving textures and alpha settings', () => {
    const map = new T.Texture();
    const source = new T.MeshStandardMaterial({
      color: '#80a0c0',
      map,
      transparent: true,
      opacity: 0.7,
      alphaTest: 0.2,
    });
    source.name = 'AvatarWearable_MAT';
    const toon = dclToonMaterial(source) as T.MeshToonMaterial;
    expect(toon.isMeshToonMaterial).toBe(true);
    expect(toon.map).toBe(map);
    expect(toon.gradientMap).toBeTruthy();
    expect(toon.name).toBe(source.name);
    expect(toon.opacity).toBe(0.7);
    expect(toon.alphaTest).toBe(0.2);
  });
  it('renders facial overlays as transparent, unlit masks', () => {
    for (const name of ['AvatarMouth_MAT', 'AvatarEyebrows_MAT', 'AvatarEyes_MAT']) {
      const source = new T.MeshStandardMaterial({ name, map: new T.Texture(), transparent: true });
      const face = dclToonMaterial(source) as T.MeshBasicMaterial;
      expect(face.isMeshBasicMaterial).toBe(true);
      expect(face.map).toBe(source.map);
      expect(face.transparent).toBe(true);
      expect(face.depthWrite).toBe(false);
      expect(face.polygonOffset).toBe(true);
    }
  });
  it('keeps fingers and captured wrist rotation as independent hand channels', () => {
    const rig = fixture(),
      motion = captureMotion();
    rig.reset();
    const wristBefore = rig.bone('LeftHand').getWorldQuaternion(new T.Quaternion());
    const fingerBefore = rig.bone('LeftHandIndex1').getWorldQuaternion(new T.Quaternion());
    rig.applyHandReference(motion, 0.5, 0);
    const wristFingersOnly = rig.bone('LeftHand').getWorldQuaternion(new T.Quaternion());
    const fingerAfter = rig.bone('LeftHandIndex1').getWorldQuaternion(new T.Quaternion());
    expect(wristFingersOnly.angleTo(wristBefore)).toBeLessThan(1e-6);
    expect(fingerAfter.angleTo(fingerBefore)).toBeGreaterThan(1e-4);
    rig.reset();
    rig.applyHandReference(motion, 0.5, 1);
    expect(
      rig.bone('LeftHand').getWorldQuaternion(new T.Quaternion()).angleTo(wristBefore),
    ).toBeGreaterThan(1e-4);
  });
  it('maps capture directions onto each target segment length and supports in-place root motion', () => {
    const rig = fixture(),
      motion = captureMotion(),
      project = newProject();
    project.preset = 'motion';
    project.motion = motion;
    project.duration = 2;
    project.controls.ground = false;
    project.controls.handIK = true;
    const lengths = ['Left', 'Right'].flatMap((side) => [
      world(rig.bone(side + 'Arm')).distanceTo(world(rig.bone(side + 'ForeArm'))),
      world(rig.bone(side + 'ForeArm')).distanceTo(world(rig.bone(side + 'Hand'))),
      world(rig.bone(side + 'UpLeg')).distanceTo(world(rig.bone(side + 'Leg'))),
      world(rig.bone(side + 'Leg')).distanceTo(world(rig.bone(side + 'Foot'))),
    ]);
    project.rootMotion = 'inPlace';
    rig.evaluate(project, 1.9);
    expect(world(rig.bone('Hips')).x).toBeCloseTo(0, 4);
    expect(world(rig.bone('LeftHand')).distanceTo(world(rig.bone('Spine2')))).toBeGreaterThan(0.35);
    const current = ['Left', 'Right'].flatMap((side) => [
      world(rig.bone(side + 'Arm')).distanceTo(world(rig.bone(side + 'ForeArm'))),
      world(rig.bone(side + 'ForeArm')).distanceTo(world(rig.bone(side + 'Hand'))),
      world(rig.bone(side + 'UpLeg')).distanceTo(world(rig.bone(side + 'Leg'))),
      world(rig.bone(side + 'Leg')).distanceTo(world(rig.bone(side + 'Foot'))),
    ]);
    current.forEach((length, i) => expect(length).toBeCloseTo(lengths[i], 5));
    project.rootMotion = 'source';
    rig.evaluate(project, 1.9);
    expect(world(rig.bone('Hips')).x).toBeGreaterThan(0.35);
  });
  it('applies the same source versus in-place policy to Kimodo root transforms', () => {
    const rig = fixture(),
      project = newProject(),
      frames = 60;
    const motion: Motion = {
      version: 1,
      skeleton: 'soma30',
      source: 'kimodo.cpp',
      fps: 30,
      frames,
      prompt: 'walk forward',
      seed: 1,
      roots: Array.from({ length: frames }, (_, i) => [(i / (frames - 1)) * 0.6, 0.989, 0]).flat(),
      rotations: Array.from({ length: frames * 30 }, () => [0, 0, 0, 1]).flat(),
    };
    project.preset = 'motion';
    project.motion = motion;
    project.duration = 2;
    project.controls.ground = false;
    project.rootMotion = 'inPlace';
    rig.evaluate(project, 1.9);
    expect(world(rig.bone('Hips')).x).toBeCloseTo(0, 4);
    project.rootMotion = 'source';
    rig.evaluate(project, 1.9);
    expect(world(rig.bone('Hips')).x).toBeGreaterThan(0.5);
  });
  it('matches Blender rest positions and rotations after Z-up conversion', () => {
    const r = fixture();
    const arm = new T.Matrix4().fromArray(blender.armature.flat()).transpose();
    const conversion = new T.Matrix4().makeRotationX(-Math.PI / 2);
    for (const bone of blender.bones) {
      const reference = conversion
        .clone()
        .multiply(arm)
        .multiply(new T.Matrix4().fromArray(bone.matrix.flat()).transpose());
      const p = new T.Vector3(),
        q = new T.Quaternion(),
        s = new T.Vector3();
      reference.decompose(p, q, s);
      expect(world(r.bone(bone.name)).distanceTo(p), bone.name).toBeLessThan(0.0001);
      expect(
        r.bone(bone.name).getWorldQuaternion(new T.Quaternion()).angleTo(q),
        bone.name,
      ).toBeLessThan(0.001);
    }
  });
  for (const preset of ['idle', 'squat', 'wave'] as const)
    it(`${preset}: feet stay anchored and limb lengths stay fixed throughout the clip`, () => {
      const r = fixture(),
        p = { ...newProject(), preset };
      p.controls.ground = true;
      const lengths = ['Left', 'Right'].map((s) => [
        world(r.bone(s + 'UpLeg')).distanceTo(world(r.bone(s + 'Leg'))),
        world(r.bone(s + 'Leg')).distanceTo(world(r.bone(s + 'Foot'))),
      ]);
      for (let i = 0; i <= 120; i++) {
        r.evaluate(p, i / 30);
        for (const [j, side] of ['Left', 'Right'].entries()) {
          expect(world(r.bone(side + 'Foot')).distanceTo(r.initial(side + 'Foot').wp)).toBeLessThan(
            0.001,
          );
          expect(world(r.bone(side + 'UpLeg')).distanceTo(world(r.bone(side + 'Leg')))).toBeCloseTo(
            lengths[j][0],
            5,
          );
          expect(world(r.bone(side + 'Leg')).distanceTo(world(r.bone(side + 'Foot')))).toBeCloseTo(
            lengths[j][1],
            5,
          );
        }
        for (const bone of r.bones.values()) {
          expect(bone.quaternion.length()).toBeCloseTo(1, 5);
          expect(bone.position.toArray().every(Number.isFinite)).toBe(true);
        }
      }
    });
  it('scrubbing is deterministic and does not accumulate IK corrections', () => {
    const r = fixture(),
      p = { ...newProject(), preset: 'squat' as const };
    p.controls.pelvis = -0.08;
    r.evaluate(p, 1.7);
    const expected = [...r.bones.values()].map((b) => b.quaternion.toArray());
    for (const t of [3, 0.1, 2.8, 0, 1.7]) r.evaluate(p, t);
    [...r.bones.values()].forEach((b, i) => expect(b.quaternion.toArray()).toEqual(expected[i]));
  });
  it('unreachable targets never stretch bones', () => {
    const a = new T.Bone(),
      b = new T.Bone(),
      c = new T.Bone();
    a.add(b);
    b.add(c);
    b.position.y = 1;
    c.position.y = 1;
    a.updateMatrixWorld(true);
    const result = solveTwoBone(a, b, c, new T.Vector3(4, 5, 0), new T.Vector3(0, 0, 1));
    expect(result.reachable).toBe(false);
    expect(world(a).distanceTo(world(b))).toBeCloseTo(1, 8);
    expect(world(b).distanceTo(world(c))).toBeCloseTo(1, 8);
    expect(result.error).toBeGreaterThan(4);
  });
  it('keyframes interpolate without mutating stored poses', () => {
    const p = newProject();
    p.keyframes = [
      { time: 0, controls: structuredClone(p.controls) },
      { time: 2, controls: { ...structuredClone(p.controls), pelvis: -0.2 } },
    ];
    expect(controlsAt(p, 1).pelvis).toBeCloseTo(-0.1);
    expect(p.controls.pelvis).toBe(0);
  });
  it('migrates older projects to the single avatar and in-place motion', () => {
    const old: any = newProject();
    delete old.avatar;
    delete old.rootMotion;
    const migrated = projectSchema.parse(old);
    expect(migrated.avatar).toBe('Avatar');
    expect(migrated.rootMotion).toBe('inPlace');
    expect(migrated.skinColor).toHaveLength(3);
  });
  it('rejects malformed motion before touching bones', () => {
    expect(
      motionSchema.safeParse({
        version: 1,
        skeleton: 'soma30',
        fps: 30,
        frames: 60,
        prompt: 'Test',
        seed: 42,
        roots: [],
        rotations: [],
        source: 'kimodo.cpp',
      }).success,
    ).toBe(false);
  });
  it('closes a generated loop after DCL retarget and foot IK, including repeated playback', () => {
    const p = newProject(),
      r = fixture();
    const rotations = Array.from({ length: 60 }, (_, f) =>
      Array.from({ length: 30 }, (_, j) =>
        new T.Quaternion()
          .setFromAxisAngle(new T.Vector3(0, 0, 1), j === 11 ? f / 180 : 0)
          .toArray(),
      ).flat(),
    ).flat();
    p.preset = 'motion';
    p.duration = 2;
    p.motion = {
      version: 1,
      skeleton: 'soma30',
      source: 'kimodo.cpp',
      fps: 30,
      frames: 60,
      prompt: 'test',
      seed: 7,
      rotations,
      roots: Array.from({ length: 60 }, (_, f) => [
        f * 0.002,
        1 + 0.015 * Math.sin(f / 12),
        0,
      ]).flat(),
      generation: { conditioning: 'soma30-v1', loop: true, rootMotion: 'inPlace' },
    };
    p.timeline = newTimeline(p);
    expect(p.timeline.seamless).toBe(true);
    r.evaluate(p, 0);
    const start = [...r.bones.values()].map((b) => ({
      p: world(b),
      q: b.getWorldQuaternion(new T.Quaternion()).normalize(),
    }));
    r.evaluate(p, 2);
    [...r.bones.values()].forEach((b, i) => {
      expect(world(b).distanceTo(start[i].p), b.name).toBeLessThan(1e-5);
      expect(
        b.getWorldQuaternion(new T.Quaternion()).normalize().angleTo(start[i].q),
        b.name,
      ).toBeLessThan(1e-5);
    });
    p.timeline = {
      ...p.timeline,
      seamless: false,
      strips: [{ ...p.timeline.strips[0], repeat: 2 }],
    };
    p.duration = 4;
    r.evaluate(p, 2);
    const join = world(r.bone('LeftHand'));
    r.evaluate(p, 4);
    expect(world(r.bone('LeftHand')).distanceTo(join)).toBeLessThan(1e-5);
  });
});

it('retargets calibrated video roots to DCL without cancelling initial crouch, travel, yaw or jump height', () => {
  const r = fixture();
  const turn = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 1.4);
  const m: Extract<Motion, { skeleton: 'soma30' }> = {
    version: 1,
    skeleton: 'soma30',
    source: 'kimodo.cpp',
    frames: 60,
    fps: 30,
    seed: 1,
    prompt: 'jump',
    roots: Array.from({ length: 60 }, (_, f) => [
      f / 100,
      0.75 + (f >= 30 ? 0.5 : 0),
      -f / 200,
    ]).flat(),
    rotations: Array.from({ length: 60 }, () =>
      Array.from({ length: 30 }, (_, j) => (j ? [0, 0, 0, 1] : turn.toArray())).flat(),
    ).flat(),
    generation: {
      conditioning: 'soma30-v1',
      loop: false,
      rootMotion: 'source',
      video: {
        provider: 'sam3d-hybrid',
        poseStride: 15,
        file: 'jump.mp4',
        rootSpace: 'camera-y-up-v2',
      },
    },
  };
  const scale = r.initial('Hips').wp.y / 0.989;
  r.reset();
  r.retarget(m, 0, 'source');
  const start = world(r.bone('Hips')),
    foot = world(r.bone('LeftFoot'));
  expect(start.y).toBeCloseTo(0.75 * scale);
  const rotation = r.bone('Hips').getWorldQuaternion(new T.Quaternion());
  expect(rotation.angleTo(turn.clone().multiply(r.initial('Hips').wq))).toBeLessThan(1e-6);
  r.reset();
  r.retarget(m, 1, 'source');
  const end = world(r.bone('Hips'));
  expect(end.x - start.x).toBeCloseTo(0.3 * scale);
  expect(end.y - start.y).toBeCloseTo(0.5 * scale);
  expect(end.z - start.z).toBeCloseTo(-0.15 * scale);
  expect(world(r.bone('LeftFoot')).y - foot.y).toBeCloseTo(0.5 * scale);
  r.reset();
  r.retarget(m, 1, 'inPlace');
  expect(world(r.bone('Hips')).x).toBeCloseTo(start.x);
  expect(world(r.bone('Hips')).z).toBeCloseTo(start.z);
  expect(world(r.bone('Hips')).y).toBeCloseTo(end.y);
});

it('a full-timeline hand template bends fingers without replacing body or wrist animation', async () => {
  const { useStudio } = await import('../src/store');
  const p = newProject();
  p.preset = 'wave';
  p.duration = 4;
  p.timeline = newTimeline(p);
  p.timeline.strips[0].start = 2;
  p.timeline.strips[0].in = 1;
  p.timeline.strips[0].out = 3;
  p.duration = 4;
  useStudio.getState().load(p);
  const r = fixture();
  r.evaluate(useStudio.getState().project, 3);
  const before = new Map(
    [...r.bones].map(([name, bone]) => [name, { q: bone.quaternion.clone(), p: world(bone) }]),
  );
  useStudio.getState().addHandTemplate('fist');
  const updated = useStudio.getState().project;
  const handStrip = updated.timeline!.strips.at(-1)!;
  expect(handStrip.start).toBe(0);
  expect(handStrip.in).toBe(0);
  expect(handStrip.out).toBe(4);
  expect(handStrip.speed).toBe(1);
  expect(handStrip.mask).toBe('fingers');
  expect(updated.timeline!.assets.at(-1)!.handPoseStart).toBe('fist');
  expect(updated.timeline!.assets.at(-1)!.handPoseEnd).toBe('fist');
  r.evaluate(updated, 3);
  for (const [name, bone] of r.bones)
    if (!/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(name)) {
      expect(bone.quaternion.angleTo(before.get(name)!.q), name).toBeLessThan(1e-6);
      expect(world(bone).distanceTo(before.get(name)!.p), name).toBeLessThan(1e-6);
    }
  const finger = r.bone('LeftHandIndex1');
  expect(finger.quaternion.angleTo(before.get(finger.name)!.q)).toBeGreaterThan(0.4);
  useStudio.getState().undo();
  expect(useStudio.getState().project.timeline!.strips).toHaveLength(1);
  useStudio.getState().redo();
  expect(useStudio.getState().project.timeline!.strips).toHaveLength(2);
});
