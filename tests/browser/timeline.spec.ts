import { test, expect, openEditor } from './workspace-fixture';
import { readFile } from 'node:fs/promises';
// @ts-expect-error The validator has no TypeScript declarations.
import { validateBytes } from 'gltf-validator';
import { addProceduralTestClip } from './procedural-fixture';

test('layered clips, transitions and loop range survive saving and GLB baking', async ({
  page,
}) => {
  const request = page.request;
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await addProceduralTestClip(page, 'squat');
  await addProceduralTestClip(page, 'wave');
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  if (await pause.isVisible()) await pause.click();
  await expect(page.locator('.nla-clip')).toHaveCount(2);
  await page.evaluate(async () => {
    const storePath = '/src/store.ts';
    const { useStudio } = await import(storePath);
    const state = useStudio.getState(),
      tl = state.project.timeline!;
    state.change({
      timeline: {
        ...tl,
        strips: tl.strips.map((x: any, i: number) => (i === 1 ? { ...x, start: 3.6 } : x)),
      },
    });
  });
  await page.getByLabel('Blend in', { exact: true }).fill('0.4');
  await expect(page.getByLabel('Blend in', { exact: true })).toHaveValue('0.4');
  await page.getByLabel('Speed', { exact: true }).fill('2');
  await page.getByLabel('Repeat clip', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await page.getByLabel('Repeat clip', { exact: true }).fill('1');
  await page.getByLabel('Blend mode', { exact: true }).selectOption('additive');
  await page.getByLabel('Clip influence', { exact: true }).fill('0.35');
  await page.getByLabel('Timeline loop', { exact: true }).fill('0.4');
  await page.getByRole('slider', { name: 'Animation position' }).fill('3.8');
  await expect(page.locator('.nla-clip')).toHaveCount(3);
  const title = `NLA verification ${Date.now()}`;
  await page.getByLabel('Project name').fill(title);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast[role=status]')).toContainText('Project saved.');
  const list = await (await request.get('/api/projects')).json();
  const saved = await (
    await request.get('/api/projects/' + list.find((p: any) => p.name === title).id)
  ).json();
  expect(saved.version).toBe(2);
  expect(saved.timeline.strips).toHaveLength(3);
  expect(saved.timeline.tracks).toHaveLength(3);
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();
  const bytes = await readFile((await (await file).path())!);
  const report = await validateBytes(new Uint8Array(bytes));
  expect(report.issues.numErrors, JSON.stringify(report.issues.messages)).toBe(0);
  const parity = await page.evaluate(
    async ({ project, binary }) => {
      const tp = '/node_modules/three/build/three.module.js',
        lp = '/node_modules/three/examples/jsm/loaders/GLTFLoader.js',
        rp = '/src/rig.ts';
      const [T, { GLTFLoader }, { AvatarRig }] = await Promise.all([
        import(tp),
        import(lp),
        import(rp),
      ]);
      const exported = await new GLTFLoader().parseAsync(new Uint8Array(binary).buffer, '');
      const original = await new GLTFLoader().loadAsync('/assets/Avatar.glb');
      const rig = new AvatarRig(original.scene),
        mixer = new T.AnimationMixer(exported.scene);
      const action = mixer.clipAction(exported.animations[0]);
      action.setLoop(T.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      const nodes = new Map();
      exported.scene.traverse((n: any) => {
        if (n.isBone) nodes.set(n.name, n);
      });
      let position = 0,
        angle = 0;
      for (const time of [0, 0.5, 3.3, 5.5, 7.6]) {
        rig.evaluate(project, project.timeline.rangeStart + time);
        mixer.setTime(time);
        exported.scene.updateMatrixWorld(true);
        for (const [name, bone] of rig.bones) {
          const other: any = nodes.get(name);
          position = Math.max(
            position,
            bone
              .getWorldPosition(new T.Vector3())
              .distanceTo(other.getWorldPosition(new T.Vector3())),
          );
          angle = Math.max(
            angle,
            bone
              .getWorldQuaternion(new T.Quaternion())
              .angleTo(other.getWorldQuaternion(new T.Quaternion())),
          );
        }
      }
      return { position, angle, duration: exported.animations[0].duration };
    },
    { project: saved, binary: Array.from(bytes) },
  );
  expect(parity.duration).toBeCloseTo(saved.duration);
  expect(parity.position).toBeLessThan(0.001);
  expect(parity.angle).toBeLessThan(0.01);
  const emoteFile = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Export emote', exact: true }).click();
  const emote = await readFile((await (await emoteFile).path())!);
  const gltf = JSON.parse(emote.subarray(20, 20 + emote.readUInt32LE(12)).toString());
  expect(gltf.animations).toHaveLength(1);
  expect(gltf.meshes?.length || 0).toBe(0);
  expect((await validateBytes(new Uint8Array(emote))).issues.numErrors).toBe(0);
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click();
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await page.getByRole('button', { name: 'Open project: ' + title, exact: true }).click();
  await expect(page.locator('.nla-clip')).toHaveCount(3);
  await expect(page.getByLabel('Timeline loop')).toHaveValue('0.4');
  await page.screenshot({ path: '../../work/timeline-editor.png', fullPage: true });
  await request.delete('/api/projects/' + list.find((p: any) => p.name === title).id);
  expect(errors).toEqual([]);
});
