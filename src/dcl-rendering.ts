import * as T from 'three';

// DCL's Avatar_Toon uses white base, 0.949 first shade and 0.8 second shade,
// with narrow feathered transitions around the diffuse thresholds. A 256-step
// ramp preserves those authored values without the posterization of a hard LUT.
const ramp = new Uint8Array(256);
const smoothstep = (a: number, b: number, value: number) => {
  const x = T.MathUtils.clamp((value - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
for (let i = 0; i < ramp.length; i++) {
  const light = i / 255;
  const first = smoothstep(0.581, 0.665, light);
  const second = smoothstep(0.66, 0.68, light);
  const shade = T.MathUtils.lerp(T.MathUtils.lerp(0.8, 0.949, first), 1, second);
  ramp[i] = Math.round(shade * 255);
}
const toonRamp = new T.DataTexture(
  ramp,
  256,
  1,
  T.RedFormat,
);
toonRamp.magFilter = T.LinearFilter;
toonRamp.minFilter = T.LinearFilter;
toonRamp.generateMipmaps = false;
toonRamp.needsUpdate = true;

export function dclToonMaterial(source: T.Material) {
  if (!(source as T.MeshStandardMaterial).isMeshStandardMaterial) return source;
  const input = source as T.MeshStandardMaterial;
  // DCL renders the three facial-feature masks separately from the opaque
  // avatar. They are transparent, unlit textures: mouth follows skin tint,
  // eyebrows follow hair tint, and eyes retain their authored colors.
  if (/^Avatar(Eyebrows|Eyes|Mouth)_MAT$/.test(input.name)) {
    const face = new T.MeshBasicMaterial({
      name: input.name,
      color: input.color.clone(),
      map: input.map,
      transparent: true,
      opacity: input.opacity,
      alphaTest: 0.01,
      depthTest: true,
      depthWrite: false,
      side: T.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    face.userData = { ...input.userData, dclAvatarFace: true };
    return face;
  }
  const material = new T.MeshToonMaterial({
    name: input.name,
    color: input.color.clone(),
    map: input.map,
    gradientMap: toonRamp,
    lightMap: input.lightMap,
    lightMapIntensity: input.lightMapIntensity,
    aoMap: input.aoMap,
    aoMapIntensity: input.aoMapIntensity,
    emissive: input.emissive.clone(),
    emissiveMap: input.emissiveMap,
    emissiveIntensity: input.emissiveIntensity * 5,
    bumpMap: input.bumpMap,
    bumpScale: input.bumpScale,
    normalMap: input.normalMap,
    normalMapType: input.normalMapType,
    normalScale: input.normalScale.clone(),
    displacementMap: input.displacementMap,
    displacementScale: input.displacementScale,
    displacementBias: input.displacementBias,
    alphaMap: input.alphaMap,
    alphaTest: input.alphaTest,
    transparent: input.transparent,
    opacity: input.opacity,
    side: input.side,
    depthTest: input.depthTest,
    depthWrite: input.depthWrite,
    vertexColors: input.vertexColors,
    fog: input.fog,
  });
  material.userData = { ...input.userData, dclAvatarToon: true };
  // Unity Toon Shader's Avatar_Toon material keeps a strong unlit/base-color
  // contribution (_Unlit_Intensity = 4). MeshToonMaterial only returns direct
  // and indirect light, which makes the same avatar much too dark in Three.js.
  // Preserve the authored albedo while retaining enough light response for the
  // official warm key light, contact shadows and the soft two-band ramp.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
      `vec3 dclToonLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
       float dclBaseLuma = max( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.001 );
       float dclLitLuma = dot( dclToonLight, vec3( 0.2126, 0.7152, 0.0722 ) );
       float dclShade = clamp( dclLitLuma / dclBaseLuma, 0.82, 1.15 );
       vec3 dclUnlitBase = diffuseColor.rgb * 1.15 * mix( 1.0, dclShade, 0.65 );
       vec3 outgoingLight = mix( dclUnlitBase, dclToonLight, 0.06 ) + totalEmissiveRadiance;`,
    );
  };
  material.customProgramCacheKey = () => 'dcl-avatar-toon-unlit-v1';
  material.blending = input.blending;
  material.blendSrc = input.blendSrc;
  material.blendDst = input.blendDst;
  material.blendEquation = input.blendEquation;
  material.premultipliedAlpha = input.premultipliedAlpha;
  material.alphaToCoverage = input.alphaToCoverage;
  return material;
}

export function applyDclAvatarMaterials(root: T.Object3D) {
  const converted = new Map<T.Material, T.Material>();
  root.traverse((object) => {
    const mesh = object as T.Mesh;
    if (!mesh.isMesh) return;
    const convert = (material: T.Material) => {
      let result = converted.get(material);
      if (!result) {
        result = dclToonMaterial(material);
        converted.set(material, result);
      }
      return result;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(convert)
      : convert(mesh.material);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some(material => material.userData.dclAvatarFace)) mesh.renderOrder = 1;
  });
}
