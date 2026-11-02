// Canonical Avatar.glb hierarchy only: no textures, meshes, network or filesystem.
import referenceSkeleton from './dcl-reference-skeleton.json' with { type: 'json' };
import { Bone, Group, type Object3D } from 'three';
import { AvatarRig } from './rig.js';

type Node = {
  name: string;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  children?: number[];
};
type Skeleton = {
  nodes: Node[];
  skins: { joints: number[] }[];
  scenes: { nodes: number[] }[];
  scene?: number;
};

/** Identical canonical FK rig for browser validation and cloud admission. */
export function canonicalReferenceRig() {
  const skeleton: Skeleton = referenceSkeleton;
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
