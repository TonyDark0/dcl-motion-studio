import { expect, test, openEditor } from './workspace-fixture';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
// @ts-expect-error No validator types available.
import { validateBytes } from 'gltf-validator';
import { addProceduralTestClip } from './procedural-fixture';

test('Export offers a named emote without mesh and a full avatar GLB', async ({ page }) => {
  const request = page.request;
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await openEditor(page);
  // The authored wave supplies changing animation without manual keyframes.
  await addProceduralTestClip(page, 'wave');
  for (const mode of ['Export emote', 'Export GLB']) {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Export options' });
    await menu.getByLabel('Animation name', { exact: true }).fill('baile de cumbia');
    const file = page.waitForEvent('download');
    await menu.getByRole('button', { name: mode, exact: true }).click();
    const bytes = await readFile((await (await file).path())!);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    expect((await validateBytes(new Uint8Array(bytes))).issues.numErrors).toBe(0);
    expect(gltf.animations).toHaveLength(1);
    expect(gltf.animations[0].name).toBe('Baile_De_Cumbia');
    expect(gltf.scenes[gltf.scene ?? 0].nodes).toHaveLength(1);
    const rootIndex = gltf.scenes[gltf.scene ?? 0].nodes[0];
    expect(gltf.nodes[rootIndex].name).toBe('Armature');
    expect(gltf.nodes.some((node: any) => node.name === 'Scene')).toBe(false);
    expect(gltf.skins.length).toBeGreaterThan(0);
    expect(gltf.skins[0].joints).toHaveLength(62);
    expect(gltf.accessors[gltf.skins[0].inverseBindMatrices]).toMatchObject({
      type: 'MAT4',
      count: 62,
    });
    const bones = gltf.nodes.filter((node: any) => node.name?.startsWith('Avatar_'));
    expect(bones).toHaveLength(62);
    for (const bone of bones) {
      const index = gltf.nodes.indexOf(bone);
      expect(
        gltf.animations[0].channels
          .filter((c: any) => c.target.node === index)
          .map((c: any) => c.target.path)
          .sort(),
      ).toEqual(['rotation', 'scale', 'translation']);
    }
    if (mode === 'Export emote') {
      // Exactly one armature node plus deform bones, no empty container nodes.
      expect(gltf.nodes).toHaveLength(63);
      expect(gltf.skins).toHaveLength(1);
      const importedBones = await page.evaluate(async (binary) => {
        const loaderPath = '/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
        const { GLTFLoader } = await import(loaderPath);
        const loaded = await new GLTFLoader().parseAsync(new Uint8Array(binary).buffer, '');
        const names: string[] = [];
        loaded.scene.traverse((node: any) => {
          if (node.isBone) names.push(node.name);
        });
        return names;
      }, Array.from(bytes));
      expect(importedBones.sort()).toEqual(bones.map((bone: any) => bone.name).sort());
      expect(gltf.meshes || []).toHaveLength(0);
      expect(gltf.materials || []).toHaveLength(0);
      expect(gltf.textures || []).toHaveLength(0);
      expect(bytes.length).toBeLessThanOrEqual(1_000_000);
    } else {
      expect(gltf.meshes.length).toBeGreaterThan(0);
      expect(gltf.skins[0].joints).toHaveLength(62);
    }
    await mkdir('data/validation/emote-rig', { recursive: true });
    await writeFile(
      `data/validation/emote-rig/${mode === 'Export emote' ? 'emote-fixed' : 'avatar-full'}.glb`,
      bytes,
    );
  }
  const title = `Export naming ${Date.now()}`;
  await page.getByLabel('Project name').fill(title);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast[role=status]')).toContainText('Project saved.');
  const projects = await (await request.get('/api/projects')).json();
  const saved = await (
    await request.get('/api/projects/' + projects.find((p: any) => p.name === title).id)
  ).json();
  expect(saved.animationName).toBe('Baile_De_Cumbia');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Export options' })).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '../../work/export-menu.png', fullPage: true });
  await request.delete('/api/projects/' + projects.find((p: any) => p.name === title).id);
});
