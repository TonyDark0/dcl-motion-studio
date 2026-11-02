import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const wallet = process.argv[2] || '0x639043db09465c6c38e71ffb43511369364f99a7';
const output = 'data/validation/custom-avatar-' + wallet.slice(2, 10);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:5173/app');
  await page.getByRole('tab', { name: 'Text to emote' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Custom avatar/ }).click();
  await page.getByRole('textbox', { name: 'Wallet address' }).fill(wallet);
  await page.getByRole('button', { name: 'Load avatar', exact: true }).click();
  await page.getByText('Custom avatar active', { exact: false }).waitFor({ timeout: 90000 });
  const state = await page.evaluate(async () => {
    const s = (await import('/src/store.ts')).useStudio.getState();
    const viewportPath = performance
      .getEntriesByType('resource')
      .filter((e) => e.name.includes('/src/Viewport.tsx'))
      .at(-1).name;
    const { activeRig } = await import(viewportPath);
    const custom = activeRig?.model.parent?.getObjectByName('Wallet avatar preview');
    return {
      error: s.avatarError,
      name: s.customAvatar?.name,
      assets: s.customAvatar?.assets.map((a) => ({ category: a.category, id: a.id })),
      customMeshes: custom?.children.length,
      defaultMeshesVisible: (() => {
        let n = 0;
        activeRig?.model.traverse((o) => {
          if (o.isMesh && o.layers.mask) n++;
        });
        return n;
      })(),
    };
  });
  if (state.error || !state.customMeshes) throw Error(JSON.stringify(state));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Custom avatar', exact: true })
    .waitFor({ state: 'hidden' });
  await page.screenshot({ path: output + '.png' });
  writeFileSync(output + '-check.json', JSON.stringify({ ...state, errors }, null, 2));
  console.log(JSON.stringify({ ...state, errors }));
} finally {
  await browser.close();
}
