import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { applyDclAvatarMaterials } from './dcl-rendering';
import { world, worldRotation, type AvatarRig } from './rig';
import type { AvatarAsset, CustomAvatar } from './custom-avatar-types';

const faceCategory = (name: string) =>
  /eyebrows/i.test(name)
    ? 'eyebrows'
    : /eyes/i.test(name)
      ? 'eyes'
      : /mouth/i.test(name)
        ? 'mouth'
        : null;
export function baseMeshCategory(name: string) {
  return (
    faceCategory(name) ||
    (/head/i.test(name)
      ? 'head'
      : /hands/i.test(name)
        ? 'hands'
        : /feet/i.test(name)
          ? 'feet'
          : /ubody/i.test(name)
            ? 'upper_body'
            : /lbody/i.test(name)
              ? 'lower_body'
              : null)
  );
}
export function disposeAvatar(root: T.Object3D) {
  const resources = new Set<{ dispose(): void }>();
  root.traverse((o) => {
    const mesh = o as T.Mesh;
    if (!mesh.isMesh) return;
    resources.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      resources.add(material);
      for (const [key, value] of Object.entries(material))
        if (value instanceof T.Texture && key !== 'gradientMap') resources.add(value);
    }
    if ((mesh as T.SkinnedMesh).isSkinnedMesh) resources.add((mesh as T.SkinnedMesh).skeleton);
  });
  root.removeFromParent();
  resources.forEach((r) => r.dispose());
}

// Separate hierarchies keep wearable bind matrices and additional bones intact.
// Only this preview receives world-space pose deltas; it never enters AvatarRig.export.
export class CustomAvatarView {
  readonly root = new T.Group();
  private bindings: { bone: T.Bone; name: string; restQ: T.Quaternion; restP: T.Vector3 }[] = [];
  constructor(parts: T.Object3D[]) {
    this.root.name = 'Wallet avatar preview';
    for (const part of parts) {
      this.root.add(part);
      part.updateMatrixWorld(true);
      part.traverse((o) => {
        if ((o as T.Bone).isBone)
          this.bindings.push({
            bone: o as T.Bone,
            name: typeof o.userData.dclBoneName === 'string' ? o.userData.dclBoneName : o.name,
            restQ: o.getWorldQuaternion(new T.Quaternion()),
            restP: world(o),
          });
      });
    }
  }
  update(rig: AvatarRig) {
    this.root.updateMatrixWorld(true);
    const rotations = new Map<string, T.Quaternion>();
    for (const [name, bone] of rig.bones)
      rotations.set(
        name,
        bone
          .getWorldQuaternion(new T.Quaternion())
          .multiply(rig.rest.get(name)!.wq.clone().invert()),
      );
    const rootDelta = world(rig.bone('Hips')).sub(rig.initial('Hips').wp);
    for (const binding of this.bindings) {
      const delta = rotations.get(binding.name);
      if (!delta) continue;
      if (binding.name === 'Avatar_Hips') {
        const p = binding.restP.clone().add(rootDelta);
        binding.bone.position.copy(binding.bone.parent ? binding.bone.parent.worldToLocal(p) : p);
      }
      worldRotation(binding.bone, delta.clone().multiply(binding.restQ));
    }
    this.root.updateMatrixWorld(true);
  }
  dispose() {
    disposeAvatar(this.root);
  }
}

function managerFor(asset: AvatarAsset) {
  const manager = new T.LoadingManager();
  const urls = new Set(Object.values(asset.files));
  manager.setURLModifier((url) => {
    if (/^(blob:|data:)/.test(url) || urls.has(url)) return url;
    const pathname = decodeURIComponent(new URL(url, 'https://avatar.invalid/').pathname).replace(
      /^\//,
      '',
    );
    const entry = Object.entries(asset.files).find(
      ([file]) => pathname === file || pathname.endsWith('/' + file),
    );
    if (!entry) throw Error('The wearable references an unavailable texture or buffer.');
    return entry[1];
  });
  return manager;
}
async function loadPart(asset: AvatarAsset) {
  const manager = managerFor(asset);
  const draco = new DRACOLoader(manager).setDecoderPath(
    'https://www.gstatic.com/draco/versioned/decoders/1.5.7/',
  );
  // Decoder requests use their own manager, while model resources stay within the manifest.
  draco.manager = new T.LoadingManager();
  const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  loader.setResourcePath(
    'https://avatar.invalid/' + asset.mainFile.substring(0, asset.mainFile.lastIndexOf('/') + 1),
  );
  try {
    const gltf = await loader.loadAsync(asset.files[asset.mainFile]);
    gltf.scene.traverse((o) => {
      if (!(o as T.Bone).isBone) return;
      // Loader names are unique, but some authored wearables have duplicate
      // armatures. Bind the skin's actual joints using their original glTF names.
      const index = gltf.parser.associations.get(o)?.nodes;
      const authoredName = index === undefined ? undefined : gltf.parser.json.nodes?.[index]?.name;
      if (typeof authoredName === 'string') o.userData.dclBoneName = authoredName;
    });
    return gltf.scene;
  } finally {
    draco.dispose();
  }
}

async function eyeTexture(texture: T.Texture, asset: AvatarAsset, profile: CustomAvatar) {
  const image = texture.image as HTMLImageElement;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const maskFile = Object.keys(asset.files).find(
    (file) => /mask/i.test(file) && /\.png$/i.test(file) && file !== asset.mainFile,
  );
  let mask: Uint8ClampedArray | null = null;
  if (maskFile) {
    const maskTexture = await new T.TextureLoader(managerFor(asset)).loadAsync(
      asset.files[maskFile],
    );
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(maskTexture.image, 0, 0, canvas.width, canvas.height);
    mask = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    maskTexture.dispose();
  }
  for (let i = 0; i < pixels.data.length; i += 4) {
    const rgb = [...pixels.data.slice(i, i + 3)];
    // Native masks tint their black regions. Legacy base eyes have grey irises;
    // preserve white sclera and authored colored details when no mask exists.
    const weight = mask
      ? 1 - mask[i] / 255
      : Math.max(...rgb) - Math.min(...rgb) < 10 && Math.max(...rgb) < 230
        ? 1
        : 0;
    for (let k = 0; k < 3; k++) pixels.data[i + k] *= 1 - weight + weight * profile.eyes[k];
  }
  ctx.putImageData(pixels, 0, 0);
  const tinted = new T.CanvasTexture(canvas);
  tinted.flipY = false;
  tinted.colorSpace = T.SRGBColorSpace;
  texture.dispose();
  return tinted;
}

export async function loadCustomAvatar(profile: CustomAvatar): Promise<CustomAvatarView> {
  const parts: T.Group[] = [];
  try {
    const body = profile.assets.find((a) => a.category === 'body_shape');
    if (!body) throw Error('The profile has no supported body shape.');
    const base = await loadPart(body);
    parts.push(base);
    const hidden = new Set(profile.hidden);
    const replaced = new Set(
      profile.assets
        .filter(
          (a) =>
            a.category !== 'body_shape' &&
            !(['eyes', 'eyebrows', 'mouth'].includes(a.category) && /\.png$/i.test(a.mainFile)),
        )
        .map((a) => a.category),
    );
    base.traverse((o) => {
      if (!(o as T.Mesh).isMesh) return;
      const category = baseMeshCategory(o.name);
      if (category && (hidden.has(category) || replaced.has(category))) o.visible = false;
    });
    for (const asset of profile.assets.filter((a) => a !== body)) {
      if (/\.(glb|gltf)$/i.test(asset.mainFile)) parts.push(await loadPart(asset));
      else if (
        ['eyes', 'eyebrows', 'mouth'].includes(asset.category) &&
        /\.png$/i.test(asset.mainFile)
      ) {
        let texture = await new T.TextureLoader(managerFor(asset)).loadAsync(
          asset.files[asset.mainFile],
        );
        if (asset.category === 'eyes') texture = await eyeTexture(texture, asset, profile);
        texture.flipY = false;
        texture.colorSpace = T.SRGBColorSpace;
        base.traverse((o) => {
          const mesh = o as T.Mesh;
          if (!mesh.isMesh || faceCategory(mesh.name) !== asset.category) return;
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            (material as T.MeshStandardMaterial).map = texture;
            material.needsUpdate = true;
          }
        });
      } else throw Error('This wearable format cannot be previewed yet.');
    }
    for (const part of parts) {
      applyDclAvatarMaterials(part);
      part.traverse((o) => {
        const mesh = o as T.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const colored = material as T.MeshToonMaterial;
          const tint = /^(AvatarSkin|AvatarMouth)_MAT$/i.test(material.name)
            ? profile.skin
            : /hair|^AvatarEyebrows_MAT$/i.test(material.name)
              ? profile.hair
              : null;
          if (tint && colored.color) colored.color.setRGB(...tint, T.SRGBColorSpace);
        }
      });
    }
    return new CustomAvatarView(parts);
  } catch (error) {
    for (const part of parts) disposeAvatar(part);
    throw error;
  }
}
