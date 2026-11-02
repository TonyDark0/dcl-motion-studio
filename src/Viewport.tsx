import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AvatarRig } from './rig';
import { applyDclAvatarMaterials } from './dcl-rendering';
import { useStudio } from './store';
import { controlsAt, type Controls } from './motion';
import { useT } from './i18n';
import { createViewGizmo } from './view-gizmo';
import { loadCustomAvatar, type CustomAvatarView } from './custom-avatar';
import { ReferenceVideoView } from './ReferenceVideoView';
export let activeRig: AvatarRig | null = null;
export let captureViewport: (() => string) | null = null;
const keys = {
  LeftFoot: 'leftFoot',
  RightFoot: 'rightFoot',
  LeftHand: 'leftHand',
  RightHand: 'rightHand',
} as const;
export function Viewport({
  cameraMode,
  onReady,
  onDiagnostics,
}: {
  cameraMode: 'single' | 'dual';
  onReady: (r: AvatarRig) => void;
  onDiagnostics: (d: AvatarRig['diagnostics']) => void;
}) {
  const primaryHost = useRef<HTMLDivElement>(null);
  const secondaryHost = useRef<HTMLDivElement>(null);
  const cameraModeRef = useRef(cameraMode);
  const workflow = useStudio((s) => s.project.workflow);
  const [secondView, setSecondView] = useState<'camera' | 'video'>('camera');
  const secondViewRef = useRef(secondView);
  secondViewRef.current = workflow === 'video' ? secondView : 'camera';
  cameraModeRef.current = cameraMode;
  const t = useT();
  useEffect(() => {
    const primary = primaryHost.current!;
    const secondary = secondaryHost.current!;
    let alive = true,
      frame = 0;
    const scene = new T.Scene();
    scene.background = new T.Color('#25252a');
    const camera = new T.PerspectiveCamera(30, 1, 0.01, 50);
    camera.position.set(3.1, 2.2, 4.5);
    const sideCamera = new T.PerspectiveCamera(30, 1, 0.01, 50);
    sideCamera.position.set(-4.5, 2.15, 1.4);
    const renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.NoToneMapping;
    primary.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', t('Decentraland avatar 3D viewport'));
    const sideRenderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    sideRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    sideRenderer.outputColorSpace = T.SRGBColorSpace;
    sideRenderer.shadowMap.enabled = true;
    sideRenderer.shadowMap.type = T.PCFSoftShadowMap;
    sideRenderer.toneMapping = T.NoToneMapping;
    sideRenderer.domElement.setAttribute('aria-label', t('Second camera 3D viewport'));
    secondary.appendChild(sideRenderer.domElement);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0.98, 0);
    orbit.enableDamping = true;
    orbit.minDistance = 1.5;
    orbit.maxDistance = 9;
    orbit.maxPolarAngle = Math.PI;
    const sideOrbit = new OrbitControls(sideCamera, sideRenderer.domElement);
    sideOrbit.target.set(0, 0.98, 0);
    sideOrbit.enableDamping = true;
    sideOrbit.minDistance = 1.5;
    sideOrbit.maxDistance = 9;
    sideOrbit.maxPolarAngle = Math.PI;
    const disposeGizmo = createViewGizmo(camera, orbit, primary);
    const disposeSideGizmo = createViewGizmo(sideCamera, sideOrbit, secondary);
    const clearCameraPreset = () => window.dispatchEvent(new Event('camera-view-free'));
    orbit.addEventListener('start', clearCameraPreset);
    scene.add(new T.HemisphereLight('#9da8be', '#383329', 1));
    const key = new T.DirectionalLight('#ffdb67', 2);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -3;
    key.shadow.normalBias = 0.015;
    scene.add(key);
    const renderTarget = new T.WebGLRenderTarget(1, 1, { samples: 4 });
    const composer = new EffectComposer(renderer, renderTarget);
    composer.addPass(new RenderPass(scene, camera));
    const outline = new OutlinePass(new T.Vector2(1, 1), scene, camera);
    outline.edgeStrength = 0.65;
    outline.edgeGlow = 0;
    outline.edgeThickness = 0.55;
    outline.pulsePeriod = 0;
    outline.visibleEdgeColor.set('#8f8b93');
    outline.hiddenEdgeColor.set('#8f8b93');
    composer.addPass(outline);
    // EffectComposer renders through a linear intermediate target. OutputPass
    // performs the final linear-to-sRGB conversion without darkening DCL's
    // authored flat colors or the matte viewport background.
    composer.addPass(new OutputPass());
    const sideTarget = new T.WebGLRenderTarget(1, 1, { samples: 4 });
    const sideComposer = new EffectComposer(sideRenderer, sideTarget);
    sideComposer.addPass(new RenderPass(scene, sideCamera));
    const sideOutline = new OutlinePass(new T.Vector2(1, 1), scene, sideCamera);
    sideOutline.edgeStrength = outline.edgeStrength;
    sideOutline.edgeGlow = outline.edgeGlow;
    sideOutline.edgeThickness = outline.edgeThickness;
    sideOutline.visibleEdgeColor.copy(outline.visibleEdgeColor);
    sideOutline.hiddenEdgeColor.copy(outline.hiddenEdgeColor);
    sideComposer.addPass(sideOutline);
    sideComposer.addPass(new OutputPass());
    const grid = new T.GridHelper(20, 80, '#55555d', '#3d3d45');
    grid.position.y = 0;
    scene.add(grid);
    const markers = new Map<string, T.Mesh>();
    for (const name of Object.keys(keys)) {
      const m = new T.Mesh(
        new T.SphereGeometry(0.022, 16, 12),
        new T.MeshBasicMaterial({
          color: name.includes('Left') ? '#ff577f' : '#65dacb',
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        }),
      );
      m.renderOrder = 10;
      m.name = name;
      markers.set(name, m);
      scene.add(m);
    }
    const target = new T.Object3D();
    scene.add(target);
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.65);
    transform.setSpace('world');
    scene.add(transform.getHelper());
    let dragging = false,
      basePosition = new T.Vector3(),
      baseOffset: number[] = [0, 0, 0],
      controlKey: keyof Pick<Controls, 'leftFoot' | 'rightFoot' | 'leftHand' | 'rightHand'> =
        'leftFoot';
    transform.addEventListener('dragging-changed', (event) => {
      dragging = !!event.value;
      orbit.enabled = !dragging;
      if (dragging) {
        const s = useStudio.getState();
        s.set({ playing: false });
        basePosition.copy(target.position);
        controlKey = keys[s.selected];
        baseOffset = [...controlsAt(s.project, s.time)[controlKey]];
        if (controlKey.includes('Hand')) s.control({ handIK: true });
      }
    });
    transform.addEventListener('objectChange', () => {
      if (!dragging) return;
      const delta = target.position.clone().sub(basePosition);
      const a = baseOffset.map((n, i) =>
        T.MathUtils.clamp(n + delta.getComponent(i), -0.65, 0.65),
      ) as [number, number, number];
      useStudio.getState().control({ [controlKey]: a });
    });
    const ray = new T.Raycaster(),
      mouse = new T.Vector2();
    const pick = (event: PointerEvent, viewCamera: T.Camera, canvas: HTMLCanvasElement) => {
      if (transform.axis) return;
      const rect = canvas.getBoundingClientRect();
      mouse.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(mouse, viewCamera);
      const hit = ray.intersectObjects([...markers.values()].filter((m) => m.visible))[0];
      if (hit) useStudio.getState().set({ selected: hit.object.name as keyof typeof keys });
    };
    const pickPrimary = (event: PointerEvent) => pick(event, camera, renderer.domElement);
    const pickSecondary = (event: PointerEvent) => pick(event, sideCamera, sideRenderer.domElement);
    renderer.domElement.addEventListener('pointerdown', pickPrimary);
    sideRenderer.domElement.addEventListener('pointerdown', pickSecondary);
    let rig: AvatarRig | null = null,
      helper: T.SkeletonHelper | null = null;
    let customView: CustomAvatarView | null = null,
      avatarRequest = 0;
    const defaultMeshLayers = new Map<T.Object3D, number>();
    const syncAvatar = async (profile = useStudio.getState().customAvatar) => {
      const request = ++avatarRequest;
      if (!profile) {
        customView?.dispose();
        customView = null;
        defaultMeshLayers.forEach((mask, node) => {
          node.layers.mask = mask;
        });
        if (rig) {
          outline.selectedObjects = [rig.model];
          sideOutline.selectedObjects = [rig.model];
        }
        return;
      }
      useStudio.getState().set({ avatarLoading: true, avatarError: '' });
      try {
        const view = await loadCustomAvatar(profile);
        if (!alive || request !== avatarRequest) {
          view.dispose();
          return;
        }
        customView?.dispose();
        customView = view;
        scene.add(view.root);
        defaultMeshLayers.forEach((_mask, node) => {
          node.layers.mask = 0;
        });
        outline.selectedObjects = [view.root];
        sideOutline.selectedObjects = [view.root];
        useStudio.getState().set({ avatarLoading: false });
      } catch (error) {
        if (alive && request === avatarRequest)
          useStudio.getState().set({ avatarLoading: false, avatarError: (error as Error).message });
      }
    };
    const unsubscribeAvatar = useStudio.subscribe((state, previous) => {
      if (rig && state.customAvatar !== previous.customAvatar) void syncAvatar(state.customAvatar);
    });
    new GLTFLoader().load(
      '/assets/Avatar.glb',
      (gltf) => {
        if (!alive) return;
        applyDclAvatarMaterials(gltf.scene);
        scene.add(gltf.scene);
        gltf.scene.traverse((o) => {
          if ((o as T.Mesh).isMesh) {
            const mesh = o as T.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });
        rig = new AvatarRig(gltf.scene);
        gltf.scene.traverse((o) => {
          if ((o as T.Mesh).isMesh) defaultMeshLayers.set(o, o.layers.mask);
        });
        outline.selectedObjects = [gltf.scene];
        sideOutline.selectedObjects = [gltf.scene];
        const appearance = useStudio.getState().project;
        rig.setAppearance(appearance.skinColor, appearance.hairColor);
        activeRig = rig;
        helper = new T.SkeletonHelper(gltf.scene);
        helper.visible = false;
        scene.add(helper);
        rig.evaluate(useStudio.getState().project, 0);
        onReady(rig);
        void syncAvatar();
      },
      undefined,
      (e) => useStudio.getState().set({ message: t('Could not load avatar:') + ' ' + String(e) }),
    );
    const resize = new ResizeObserver(() => {
      const first = primary.getBoundingClientRect();
      const second = secondary.getBoundingClientRect();
      camera.aspect = first.width / Math.max(first.height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(Math.max(first.width, 1), Math.max(first.height, 1));
      composer.setSize(Math.max(first.width, 1), Math.max(first.height, 1));
      sideCamera.aspect = Math.max(second.width, 1) / Math.max(second.height, 1);
      sideCamera.updateProjectionMatrix();
      sideRenderer.setSize(Math.max(second.width, 1), Math.max(second.height, 1));
      sideComposer.setSize(Math.max(second.width, 1), Math.max(second.height, 1));
    });
    resize.observe(primary);
    resize.observe(secondary);
    let last = performance.now(),
      lastReport = 0;
    function tick(now: number) {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = useStudio.getState();
      const displayed = s.preview || s.project;
      if (s.preview && s.previewPlaying)
        s.set({ previewTime: (s.previewTime + dt) % s.preview.duration });
      if (s.playing && !s.project.timeline?.strips.length) s.set({ playing: false, time: 0 });
      if (s.playing && s.project.timeline?.strips.length) {
        const tl = s.project.timeline,
          begin = tl?.rangeStart || 0,
          end = tl?.rangeEnd || s.project.duration;
        const time = s.time < begin || s.time >= end ? begin : s.time;
        const next = time + dt;
        if (next >= end && tl && !tl.loopPlayback) s.set({ time: end, playing: false });
        else s.setTime(next >= end ? begin + ((next - begin) % (end - begin)) : next);
      }
      if (rig) {
        rig.setAppearance(displayed.skinColor, displayed.hairColor);
        rig.evaluate(
          displayed,
          s.preview ? useStudio.getState().previewTime : useStudio.getState().time,
        );
        customView?.update(rig);
        for (const [name, m] of markers) {
          m.position.copy(rig.markers[name]);
          m.visible = s.handles && !s.preview;
        }
        if (helper) helper.visible = s.skeleton;
        if (s.handles && !s.playing && !s.preview) {
          if (!dragging) target.position.copy(rig.markers[s.selected]);
          transform.attach(target);
        } else transform.detach();
        if (now - lastReport > 250) {
          onDiagnostics({ ...rig.diagnostics });
          lastReport = now;
        }
      }
      orbit.update();
      composer.render();
      if (cameraModeRef.current === 'dual' && secondViewRef.current === 'camera') {
        sideOrbit.update();
        sideComposer.render();
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    captureViewport = () => {
      composer.render();
      const thumbnail = document.createElement('canvas');
      thumbnail.width = 320;
      thumbnail.height = 200;
      const ctx = thumbnail.getContext('2d')!;
      ctx.fillStyle = '#25252a';
      ctx.fillRect(0, 0, 320, 200);
      const scale = Math.min(320 / renderer.domElement.width, 200 / renderer.domElement.height);
      const width = renderer.domElement.width * scale,
        height = renderer.domElement.height * scale;
      ctx.drawImage(renderer.domElement, (320 - width) / 2, (200 - height) / 2, width, height);
      return thumbnail.toDataURL('image/jpeg', 0.7);
    };
    const reset = () => {
      camera.position.set(3.1, 2.2, 4.5);
      orbit.target.set(0, 0.98, 0);
      sideCamera.position.set(-4.5, 2.15, 1.4);
      sideOrbit.target.set(0, 0.98, 0);
      orbit.update();
      sideOrbit.update();
      clearCameraPreset();
    };
    const applyCameraView = (event: Event) => {
      const view = (event as CustomEvent<string>).detail;
      const positions: Record<string, [number, number]> = {
        front: [0, 4.7],
        left: [-4.7, 0],
        right: [4.7, 0],
        back: [0, -4.7],
      };
      const secondary: Record<string, string> = {
        front: 'left',
        left: 'back',
        right: 'front',
        back: 'right',
      };
      if (!positions[view]) return;
      camera.position.set(positions[view][0], 1.8, positions[view][1]);
      sideCamera.position.set(positions[secondary[view]][0], 1.8, positions[secondary[view]][1]);
      orbit.target.set(0, 0.98, 0);
      sideOrbit.target.set(0, 0.98, 0);
      orbit.update();
      sideOrbit.update();
    };
    window.addEventListener('reset-camera', reset);
    window.addEventListener('set-camera-view', applyCameraView);
    return () => {
      alive = false;
      avatarRequest++;
      unsubscribeAvatar();
      customView?.dispose();
      activeRig = null;
      captureViewport = null;
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener('reset-camera', reset);
      window.removeEventListener('set-camera-view', applyCameraView);
      orbit.removeEventListener('start', clearCameraPreset);
      renderer.domElement.removeEventListener('pointerdown', pickPrimary);
      sideRenderer.domElement.removeEventListener('pointerdown', pickSecondary);
      transform.dispose();
      disposeGizmo();
      disposeSideGizmo();
      orbit.dispose();
      sideOrbit.dispose();
      scene.traverse((o) => {
        if ((o as T.Mesh).geometry) (o as T.Mesh).geometry.dispose();
        const material = (o as T.Mesh).material;
        if (material) (Array.isArray(material) ? material : [material]).forEach((m) => m.dispose());
      });
      renderer.dispose();
      sideRenderer.dispose();
      composer.dispose();
      sideComposer.dispose();
      renderTarget.dispose();
      sideTarget.dispose();
      renderer.domElement.remove();
      sideRenderer.domElement.remove();
    };
  }, []);
  return (
    <div className={'viewport ' + (cameraMode === 'dual' ? 'dual' : '')}>
      <div className="camera-pane" ref={primaryHost} />
      <div className="camera-pane camera-pane-secondary" ref={secondaryHost}>
        {cameraMode === 'dual' && workflow === 'video' && secondView === 'video' && (
          <ReferenceVideoView />
        )}
        {workflow === 'video' && (
          <div className="second-view-menu" aria-label={t('Second view')}>
            <button aria-pressed={secondView === 'camera'} onClick={() => setSecondView('camera')}>
              {t('Camera')}
            </button>
            <button aria-pressed={secondView === 'video'} onClick={() => setSecondView('video')}>
              {t('Reference video')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
