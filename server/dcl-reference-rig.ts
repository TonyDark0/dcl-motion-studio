import { readFileSync } from 'node:fs';
import { Bone, Group, type Object3D } from 'three';
import { AvatarRig } from '../src/rig';

type Node = {
  name: string;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  children?: number[];
};
let skeleton: {
  nodes: Node[];
  skins: { joints: number[] }[];
  scenes: { nodes: number[] }[];
  scene?: number;
};

/** Load only the canonical avatar hierarchy, without textures, meshes or a renderer. */
export function dclReferenceRig() {
  if (!skeleton) {
    const bytes = readFileSync(new URL('../public/assets/Avatar.glb', import.meta.url));
    skeleton = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  }
  const joints = new Set(skeleton.skins.flatMap((skin) => skin.joints));
  const nodes: Object3D[] = skeleton.nodes.map((node, index) => {
    const object = joints.has(index) ? new Bone() : new Group();
    object.name = node.name;
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation).normalize();
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  skeleton.nodes.forEach((node, index) =>
    node.children?.forEach((child) => nodes[index].add(nodes[child])),
  );
  const model = new Group();
  skeleton.scenes[skeleton.scene ?? 0].nodes.forEach((index) => model.add(nodes[index]));
  return new AvatarRig(model);
}
