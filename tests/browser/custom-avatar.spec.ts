import { test, expect, openEditor } from './workspace-fixture';
import { readFile } from 'node:fs/promises';
import { addProceduralTestClip } from './procedural-fixture';

const wallet = '0x' + '1'.repeat(40),
  hash = 'baf' + 'a'.repeat(40);
function renamedAvatar(binary: Buffer) {
  const length = binary.readUInt32LE(12);
  const json = JSON.parse(binary.subarray(20, 20 + length).toString());
  for (const node of json.nodes) if (node.mesh !== undefined) node.name = 'Custom_' + node.name;
  for (const mesh of json.meshes) mesh.name = 'Custom_' + mesh.name;
  let text = JSON.stringify(json);
  text += ' '.repeat((4 - (Buffer.byteLength(text) % 4)) % 4);
  const header = Buffer.alloc(20);
  binary.copy(header, 0, 0, 12);
  const payload = Buffer.from(text),
    tail = binary.subarray(20 + length);
  header.writeUInt32LE(20 + payload.length + tail.length, 8);
  header.writeUInt32LE(payload.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, payload, tail]);
}
test('wallet avatar is preview-only and both exports stay on the default rig', async ({ page }) => {
  const binary = renamedAvatar(await readFile('public/assets/Avatar.glb'));
  await page.route('**/api/avatar/' + wallet, (route) =>
    route.fulfill({
      json: {
        wallet,
        name: 'Wallet preview',
        bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseMale',
        skin: [0.8, 0.6, 0.4],
        hair: [0.1, 0.1, 0.1],
        eyes: [0.2, 0.3, 0.4],
        hidden: [],
        warnings: [],
        assets: [
          {
            id: 'preview-body',
            category: 'body_shape',
            mainFile: 'Avatar.glb',
            files: { 'Avatar.glb': '/api/avatar/content/' + hash },
            hides: [],
            replaces: [],
          },
        ],
      },
    }),
  );
  await page.route('**/api/avatar/content/' + hash, (route) =>
    route.fulfill({ body: binary, contentType: 'model/gltf-binary' }),
  );
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Custom avatar/ }).click();
  await page.getByRole('textbox', { name: 'Wallet address' }).fill('invalid');
  await page.getByRole('button', { name: 'Load avatar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('valid wallet address');
  await page.getByRole('textbox', { name: 'Wallet address' }).fill(wallet);
  await page.getByRole('button', { name: 'Load avatar', exact: true }).click();
  await expect(page.getByText('Custom avatar active', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Custom avatar', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Skin', exact: true })).toBeDisabled();
  await addProceduralTestClip(page, 'squat');
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  if (await pause.isVisible()) await pause.click();
  for (const emote of [false, true]) {
    const file = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page
      .getByRole('button', { name: emote ? 'Export emote' : 'Export GLB', exact: true })
      .click();
    const exported = await readFile((await (await file).path())!);
    const gltf = JSON.parse(exported.subarray(20, 20 + exported.readUInt32LE(12)).toString());
    expect(gltf.animations).toHaveLength(1);
    expect(gltf.skins[0].joints).toHaveLength(62);
    expect(gltf.nodes.some((n: any) => n.name?.startsWith('Custom_'))).toBe(false);
    if (emote) expect(gltf.nodes.some((n: any) => n.mesh !== undefined)).toBe(false);
    else
      expect(
        gltf.nodes.some((n: any) => n.name === 'M_uBody_SportJacket'),
        JSON.stringify(gltf.nodes.filter((n: any) => n.mesh !== undefined)),
      ).toBe(true);
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Custom avatar/ }).click();
  await page.getByRole('button', { name: 'Use default avatar', exact: true }).click();
  await expect(page.getByText('Default avatar active', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Skin', exact: true })).toBeEnabled();
});
