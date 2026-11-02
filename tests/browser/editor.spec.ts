import { test, expect, openEditor } from './workspace-fixture';
import { readFile } from 'node:fs/promises';
// @ts-expect-error Validator package has no declaration file.
import { validateBytes } from 'gltf-validator';
import { addProceduralTestClip } from './procedural-fixture';
test('editor loads, edits, persists and exports a valid animated GLB', async ({ page }) => {
  const request = page.request;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Generate animation', exact: true })).toBeEnabled();
  await expect(page.getByRole('tab', { name: 'Video to emote' })).toHaveCount(0);
  await addProceduralTestClip(page, 'squat');
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  if (await pause.isVisible()) await pause.click();
  await page.getByRole('slider', { name: 'Body height' }).fill('-0.1');
  const title = 'Prueba MVP ' + Date.now();
  await page.getByLabel('Project name').fill(title);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast[role=status]')).toContainText('Project saved.');
  const projects = await (await request.get('/api/projects')).json();
  expect(projects.some((p: any) => p.name === title)).toBe(true);
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();
  const downloaded = await file;
  const binary = await readFile((await downloaded.path())!);
  const result = await validateBytes(new Uint8Array(binary));
  expect(result.issues.numErrors, JSON.stringify(result.issues.messages)).toBe(0);
  await downloaded.saveAs('../../work/test-avatar-motion.glb');
  const length = binary.readUInt32LE(12);
  const gltf = JSON.parse(binary.subarray(20, 20 + length).toString());
  expect(gltf.animations).toHaveLength(1);
  expect(gltf.skins[0].joints).toHaveLength(62);
  expect(gltf.animations[0].channels.length).toBeGreaterThan(60);
  const savedProject = await (
    await request.get('/api/projects/' + projects.find((p: any) => p.name === title).id)
  ).json();
  expect(savedProject.avatar).toBe('Avatar');
  expect(savedProject.rootMotion).toBe('source');
  const parity = await page.evaluate(
    async ({ bytes, project }) => {
      const threePath = '/node_modules/three/build/three.module.js',
        loaderPath = '/node_modules/three/examples/jsm/loaders/GLTFLoader.js',
        rigPath = '/src/rig.ts';
      const [T, { GLTFLoader }, { AvatarRig }] = await Promise.all([
        import(threePath),
        import(loaderPath),
        import(rigPath),
      ]);
      const imported = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '');
      const original = await new GLTFLoader().loadAsync('/assets/Avatar.glb');
      const activeRig = new AvatarRig(original.scene);
      const mixer = new T.AnimationMixer(imported.scene);
      mixer.clipAction(imported.animations[0]).play();
      const nodes = new Map();
      imported.scene.traverse((o: any) => {
        if (o.isBone) nodes.set(o.name, o);
      });
      let positionError = 0,
        angleError = 0;
      for (const time of [0.7, 1.3, 2.4]) {
        activeRig.evaluate(project, time);
        mixer.setTime(time);
        imported.scene.updateMatrixWorld(true);
        for (const [name, bone] of activeRig.bones) {
          const other: any = nodes.get(name);
          positionError = Math.max(
            positionError,
            bone
              .getWorldPosition(new T.Vector3())
              .distanceTo(other.getWorldPosition(new T.Vector3())),
          );
          angleError = Math.max(
            angleError,
            bone
              .getWorldQuaternion(new T.Quaternion())
              .angleTo(other.getWorldQuaternion(new T.Quaternion())),
          );
        }
      }
      return { positionError, angleError };
    },
    { bytes: Array.from(binary), project: savedProject },
  );
  expect(parity.positionError).toBeLessThan(0.001);
  expect(parity.angleError).toBeLessThan(0.009);
  const emoteFile = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Export emote', exact: true }).click();
  const emote = await readFile((await (await emoteFile).path())!);
  const emoteReport = await validateBytes(new Uint8Array(emote));
  expect(emoteReport.issues.numErrors, JSON.stringify(emoteReport.issues.messages)).toBe(0);
  const emoteJson = JSON.parse(emote.subarray(20, 20 + emote.readUInt32LE(12)).toString());
  expect(emoteJson.meshes?.length || 0).toBe(0);
  expect(emoteJson.animations).toHaveLength(1);
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click();
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await page.getByRole('button', { name: 'Open project: ' + title, exact: true }).click();
  await expect(page.getByLabel('Project name')).toHaveValue(title);
  await expect(page.getByText('Local projects', { exact: true })).not.toBeVisible();
  await page.screenshot({ path: '../../work/editor-verified.png', fullPage: true });
  await request.delete('/api/projects/' + projects.find((p: any) => p.name === title).id);
  expect(errors).toEqual([]);
});
test('missing Kimodo gives explicit error; invalid project data is rejected', async ({
  request,
}) => {
  const health = await (await request.get('/api/health')).json();
  await request.put('/api/engine', {
    data: {
      executable: 'Z:\\missing\\kmd-generate.exe',
      model: 'Z:\\missing\\motion.gguf',
      text: 'Z:\\missing\\text.gguf',
      device: 'cpu',
    },
  });
  try {
    const r = await request.post('/api/jobs', {
      data: { prompt: 'A person walks', duration: 3, seed: 42, steps: 30 },
    });
    expect(r.status()).toBe(503);
    expect((await r.json()).error).toContain('Kimodo');
  } finally {
    await request.put('/api/engine', { data: health.config });
  }
  const invalid = await request.put('/api/projects/' + crypto.randomUUID(), {
    data: { version: 9 },
  });
  expect(invalid.status()).toBe(400);
});
test('avatar customization, language and responsive editor stay functional', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await page.getByRole('button', { name: 'Skin', exact: true }).click();
  await page.getByRole('slider', { name: 'Skin hue' }).fill('30');
  await page.getByRole('button', { name: 'Hair', exact: true }).click();
  await page.getByRole('slider', { name: 'Hair hue' }).fill('20');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Language').selectOption('es');
  await page.keyboard.press('Escape');
  await expect(page.getByText('CONTROLES DEL AVATAR', { exact: true })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Generar animación', exact: true })).toBeAttached();
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport + 1);
  await page.screenshot({ path: '../../work/editor-mobile.png', fullPage: true });
});
