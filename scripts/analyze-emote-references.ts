import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AnimationMixer, LoopOnce, Matrix4, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { dclReferenceRig } from '../server/dcl-reference-rig';

const names = [
  'chic',
  'spotlight',
  'pose_spin',
  'pose_jump',
  'run',
  'walk',
  'jump',
  'idle',
  'fashionista',
];
const source = process.argv[2];
const directory = 'data/reference-emotes';
await mkdir(directory, { recursive: true });
const canonical = dclReferenceRig();
const summary = [];
const fixtures = [];
for (const name of names) {
  const file = path.join(directory, name + '.glb');
  if (source) await copyFile(path.join(source, name + '.glb'), file);
  const bytes = await readFile(file);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const binOffset = 20 + bytes.readUInt32LE(12) + 8;
  const binary = bytes.subarray(binOffset);
  const accessor = (index: number) => {
    const a = json.accessors[index],
      view = json.bufferViews[a.bufferView];
    if (a.componentType !== 5126 || a.sparse)
      throw Error('Expected dense float reference accessor');
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type as string];
    if (!size) throw Error('Unsupported reference accessor');
    return Array.from({ length: a.count * size }, (_, i) =>
      binary.readFloatLE(
        (view.byteOffset || 0) +
          (a.byteOffset || 0) +
          Math.floor(i / size) * (view.byteStride || size * 4) +
          (i % size) * 4,
      ),
    );
  };
  // Analyze animation and joints without requiring a browser image decoder.
  const stripped = structuredClone(json);
  stripped.nodes.forEach((n: any) => {
    delete n.mesh;
    delete n.skin;
  });
  delete stripped.meshes;
  delete stripped.materials;
  delete stripped.images;
  delete stripped.textures;
  let encoded = Buffer.from(JSON.stringify(stripped));
  encoded = Buffer.concat([encoded, Buffer.alloc((4 - (encoded.length % 4)) % 4, 32)]);
  const header = Buffer.alloc(20),
    binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + encoded.length + 8 + binary.length, 8);
  header.writeUInt32LE(encoded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(binary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const data = Buffer.concat([header, encoded, binHeader, binary]);
  const loaded = await new GLTFLoader().parseAsync(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    '',
  );
  const skin = json.skins[0],
    inverseBind = accessor(skin.inverseBindMatrices);
  const binds = new Map<string, Matrix4>(
    skin.joints.map((node: number, i: number) => [
      json.nodes[node].name,
      new Matrix4().fromArray(inverseBind, i * 16).invert(),
    ]),
  );
  const bindPosition = (n: string) =>
    new Vector3().setFromMatrixPosition(binds.get('Avatar_' + n)!);
  const legLength =
    bindPosition('LeftUpLeg').distanceTo(bindPosition('LeftLeg')) +
    bindPosition('LeftLeg').distanceTo(bindPosition('LeftFoot'));
  const targetLeg =
    canonical.initial('LeftUpLeg').wp.distanceTo(canonical.initial('LeftLeg').wp) +
    canonical.initial('LeftLeg').wp.distanceTo(canonical.initial('LeftFoot').wp);
  const scale = targetLeg / legLength;
  for (const clip of loaded.animations) {
    const mixer = new AnimationMixer(loaded.scene),
      action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const count = Math.round(clip.duration * 30) + 1;
    const positions: Record<string, number[]>[] = [],
      wristAngles: number[] = [],
      wristSwing: number[] = [],
      wristTwist: number[] = [],
      rotations: Record<string, number[]>[] = [];
    for (let f = 0; f < count; f++) {
      mixer.setTime(Math.min(f / 30, clip.duration));
      loaded.scene.updateMatrixWorld(true);
      const points: Record<string, number[]> = {},
        pose: Record<string, number[]> = {};
      for (const [boneName, bone] of canonical.bones) {
        const sourceBone = loaded.scene.getObjectByName(boneName),
          bind = binds.get(boneName);
        if (!sourceBone || !bind) continue;
        points[boneName.slice(7)] = sourceBone
          .getWorldPosition(new Vector3())
          .multiplyScalar(scale)
          .toArray();
        const bindQ = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(bind));
        const worldDelta = sourceBone
          .getWorldQuaternion(new Quaternion())
          .multiply(bindQ.clone().invert());
        pose[boneName] = worldDelta.toArray();
        if (boneName.endsWith('Hand')) {
          const parentName = sourceBone.parent!.name,
            parentBind = binds.get(parentName);
          if (parentBind) {
            const parentQ = new Quaternion().setFromRotationMatrix(
              new Matrix4().extractRotation(parentBind),
            );
            const localBind = parentQ.invert().multiply(bindQ);
            wristAngles.push((localBind.angleTo(sourceBone.quaternion) * 180) / Math.PI);
            const middleBind = binds.get(boneName + 'Middle1')!;
            const axis = new Vector3()
              .setFromMatrixPosition(middleBind)
              .sub(new Vector3().setFromMatrixPosition(bind))
              .applyQuaternion(bindQ.clone().invert())
              .normalize();
            const delta = localBind.clone().invert().multiply(sourceBone.quaternion).normalize();
            if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
            const projection = axis
              .clone()
              .multiplyScalar(new Vector3(delta.x, delta.y, delta.z).dot(axis));
            const twist = new Quaternion(projection.x, projection.y, projection.z, delta.w);
            if (twist.lengthSq() < 1e-10) twist.identity();
            else twist.normalize();
            wristTwist.push((twist.angleTo(new Quaternion()) * 180) / Math.PI);
            wristSwing.push(
              (delta.clone().multiply(twist.invert()).angleTo(new Quaternion()) * 180) / Math.PI,
            );
          }
        }
      }
      positions.push(points);
      rotations.push(pose);
    }
    const range = (values: number[]) => Math.max(...values) - Math.min(...values);
    const hips = positions.map((p) => p.Hips),
      times = [...new Set(clip.tracks.flatMap((t) => Array.from(t.times)))].sort((a, b) => a - b);
    const intervals = times
      .slice(1)
      .map((t, i) => t - times[i])
      .filter((d) => d > 1e-5)
      .sort((a, b) => a - b);
    const degrees = (a: number[], b: number[]) =>
      (new Quaternion().fromArray(a).angleTo(new Quaternion().fromArray(b)) * 180) / Math.PI;
    const seam = Object.keys(rotations[0]).map((n) =>
      degrees(rotations[0][n], rotations.at(-1)![n]),
    );
    const quantile = (a: number[], q: number) =>
      [...a].sort((a, b) => a - b)[Math.floor((a.length - 1) * q)];
    const ankleGap = positions.map((p) => Math.abs(p.LeftFoot[1] - p.RightFoot[1]));
    summary.push({
      id: name,
      animation: clip.name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      durationSeconds: clip.duration,
      sampledFrames: count,
      keyIntervalFps: 1 / quantile(intervals, 0.5),
      sourceJoints: skin.joints.length,
      matchedJoints: Object.keys(rotations[0]).length,
      extraJoints: skin.joints
        .map((i: number) => json.nodes[i].name)
        .filter((n: string) => !canonical.bones.has(n)),
      targetScale: scale,
      rootRangeM: [0, 1, 2].map((k) => range(hips.map((p) => p[k]))),
      endpointRootDistanceM: new Vector3()
        .fromArray(hips[0])
        .distanceTo(new Vector3().fromArray(hips.at(-1)!)),
      seamMeanDegrees: seam.reduce((a, b) => a + b, 0) / seam.length,
      seamMaxDegrees: Math.max(...seam),
      wristP95Degrees: quantile(wristAngles, 0.95),
      wristMaxDegrees: Math.max(...wristAngles),
      wristSwingP99Degrees: quantile(wristSwing, 0.99),
      wristTwistP99Degrees: quantile(wristTwist, 0.99),
      ankleGapP50M: quantile(ankleGap, 0.5),
      ankleGapP95M: quantile(ankleGap, 0.95),
    });
    fixtures.push({
      id: name,
      duration: clip.duration,
      positionOffset: canonical
        .initial('Hips')
        .wp.clone()
        .sub(bindPosition('Hips').multiplyScalar(scale))
        .toArray(),
      sampleFrames: [
        0,
        Math.round((count - 1) * 0.25),
        Math.round((count - 1) * 0.5),
        Math.round((count - 1) * 0.75),
        count - 1,
      ].map((frame) => ({ frame, positions: positions[frame], worldDeltas: rotations[frame] })),
    });
    mixer.stopAllAction();
    mixer.uncacheRoot(loaded.scene);
  }
}
await mkdir('src/assets', { recursive: true });
await writeFile(
  'src/assets/emote-reference-profiles.json',
  JSON.stringify({ version: 1, fps: 30, references: summary }, null, 2),
);
await writeFile('data/reference-emotes/pose-samples.json', JSON.stringify(fixtures));
await writeFile('tests/fixtures/emote-reference-poses.json', JSON.stringify(fixtures));
console.log(JSON.stringify(summary, null, 2));
