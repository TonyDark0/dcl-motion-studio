import { test, expect, openEditor } from './workspace-fixture';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
// @ts-expect-error No type declarations are provided by the validator.
import { validateBytes } from 'gltf-validator';

test('real native loop survives DCL retarget, foot IK and GLB export', async ({ page }) => {
  test.skip(
    !process.env.DCL_NATIVE_MOTION,
    'Opt-in integration test: supply a real generated motion.json',
  );
  const input = path.resolve(process.env.DCL_NATIVE_MOTION!);
  const directory = path.dirname(input);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  const motion = JSON.parse(await readFile(input, 'utf8'));
  await page.evaluate(async motion => {
    const storePath = '/src/store.ts';
    const { useStudio } = await import(storePath);
    useStudio.getState().change({motion, preset:'motion', duration:motion.frames/motion.fps});
    useStudio.getState().control({ground:true});
  }, motion);
  await expect(page.getByLabel('Timeline loop', {exact:true})).not.toHaveValue('0');
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  if (await pause.isVisible()) await pause.click();
  await page.getByRole('slider', { name: 'Animation position' }).fill('1');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Export emote', exact: true }).click();
  const bytes = await readFile((await (await download).path())!);
  expect((await validateBytes(new Uint8Array(bytes))).issues.numErrors).toBe(0);
  await writeFile(path.join(directory, 'loop-dcl.glb'), bytes);
  const seam = await page.evaluate(async (binary) => {
    const threePath = '/node_modules/three/build/three.module.js';
    const loaderPath = '/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
    const T = await import(threePath);
    const { GLTFLoader } = await import(loaderPath);
    const gltf = await new GLTFLoader().parseAsync(new Uint8Array(binary).buffer, '');
    const mixer = new T.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]);
    action.setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const nodes: any[] = [];
    // A mesh-free emote retains skin.joints, so loaders must restore real bones.
    gltf.scene.traverse((node: any) => {
      if (node.isBone) nodes.push(node);
    });
    const sample = (time: number) => {
      mixer.setTime(time);
      gltf.scene.updateMatrixWorld(true);
      return nodes.map((node) => ({
        position: node.getWorldPosition(new T.Vector3()),
        rotation: node.getWorldQuaternion(new T.Quaternion()).normalize(),
      }));
    };
    const first = sample(0),
      last = sample(gltf.animations[0].duration);
    return {
      duration: gltf.animations[0].duration,
      bones: nodes.length,
      endpointPositionError: Math.max(
        ...first.map((value, i) => value.position.distanceTo(last[i].position)),
      ),
      endpointAngleError: Math.max(
        ...first.map((value, i) => value.rotation.angleTo(last[i].rotation)),
      ),
    };
  }, Array.from(bytes));
  expect(seam.bones).toBe(62);
  expect(seam.endpointPositionError).toBeLessThan(0.0001);
  expect(seam.endpointAngleError).toBeLessThan(0.0001);
  expect(errors).toEqual([]);
  await writeFile(path.join(directory, 'export-validation.json'), JSON.stringify(seam, null, 2));
  await page.screenshot({ path: path.join(directory, 'preview.png'), fullPage: true });
});
