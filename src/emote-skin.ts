import { BufferAttribute, Matrix4, type Object3D, type SkinnedMesh } from 'three';
import type { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// GLTFExporter 0.180 only emits skins for SkinnedMesh objects. An armature-only
// export still needs skin.joints to identify bones (as Blender's exporter does).
// These writer members exist in the pinned version but are absent from its types.
type SkinWriter = {
  json: {
    skins?: { name: string; joints: number[]; skeleton: number; inverseBindMatrices: number }[];
  };
  nodeMap: Map<Object3D, number>;
  processAccessor: (attribute: BufferAttribute) => number | null;
};

/** Capture before pruning meshes; emit their skin metadata without geometry. */
export function preserveEmoteSkin(
  exporter: GLTFExporter,
  model: Object3D,
  names: Iterable<string>,
) {
  const required = new Set(names);
  let source: SkinnedMesh | undefined;
  model.traverse((node) => {
    const mesh = node as SkinnedMesh;
    if (
      !source &&
      mesh.isSkinnedMesh &&
      mesh.skeleton.bones.length === required.size &&
      mesh.skeleton.bones.every((bone) => required.has(bone.name))
    )
      source = mesh;
  });
  if (!source) throw Error('The avatar is missing its complete deformation skin.');
  const { skeleton, bindMatrix } = source;
  const bones = [...skeleton.bones];
  if (new Set(bones.map((bone) => bone.name)).size !== required.size)
    throw Error('The deformation skin contains duplicate joints.');
  const root = bones.find((bone) => !bones.includes(bone.parent as typeof bone));
  if (!root) throw Error('The deformation skeleton has no root.');
  const inverseBindMatrices = new Float32Array(bones.length * 16);
  bones.forEach((_, i) => {
    // Exactly the same transform convention as GLTFExporter.processSkin.
    new Matrix4()
      .copy(skeleton.boneInverses[i])
      .multiply(bindMatrix)
      .toArray(inverseBindMatrices, i * 16);
  });
  const name = root.parent?.name || 'Armature';
  exporter.register((rawWriter) => ({
    afterParse: () => {
      const writer = rawWriter as unknown as SkinWriter;
      const joints = bones.map((bone) => {
        const node = writer.nodeMap.get(bone);
        if (node === undefined) throw Error(`Missing exported joint: ${bone.name}`);
        return node;
      });
      const accessor = writer.processAccessor(new BufferAttribute(inverseBindMatrices, 16));
      if (accessor === null) throw Error('Could not export inverse bind matrices.');
      writer.json.skins = [
        { name, joints, skeleton: writer.nodeMap.get(root)!, inverseBindMatrices: accessor },
      ];
      // Intentionally no node.skin reference: there is no mesh. This mirrors
      // Blender armature-only GLBs and keeps the bone declarations discoverable.
    },
  }));
}
