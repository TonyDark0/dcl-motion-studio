import { chromium, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
const folder = 'public/docs/images';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const created = [];
page.on('response', async (r) => {
  if (r.request().method() === 'PUT' && /\/api\/projects\/[a-f0-9-]+$/.test(r.url()) && r.ok()) {
    const id = r.url().split('/').at(-1);
    if (!created.includes(id)) created.push(id);
  }
});
const shot = async (name) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: folder + '/' + name + '.png' });
  console.log('Captured ' + name);
};
async function create(name, workflow) {
  await page.goto('http://127.0.0.1:5173/app');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByLabel('Workflow').selectOption(workflow);
  if (workflow === 'text') await shot('create-project');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to projects', exact: true })).toBeVisible();
  const defaultAvatar = page.getByRole('button', { name: 'Use default avatar instead', exact: true });
  if (await defaultAvatar.isVisible()) {
    if (workflow === 'text') await shot('avatar-onboarding');
    await defaultAvatar.click();
  }
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await page.waitForTimeout(350);
}
try {
  await create('Look at the sky', 'text');
  const generated = JSON.parse(
    await readFile('data/landing-work/plain-v2/stargazing.json', 'utf8'),
  );
  await page.evaluate(async (data) => {
    const storeUrl =
      performance
        .getEntriesByType('resource')
        .filter((r) => r.name.includes('/src/store.ts'))
        .at(-1)?.name || '/src/store.ts';
    const { useStudio } = await import(storeUrl);
    const s = useStudio.getState();
    s.change({
      prompt: data.prompt,
      preset: 'motion',
      motion: data.motion,
      duration: 4,
      rootMotion: 'source',
      animationName: 'Look_At_The_Sky',
      handMode: 'none',
    });
    s.set({ time: 1.5, playing: false });
  }, generated);
  await expect(page.locator('.nla-clip')).toHaveCount(1);
  await expect(page.getByLabel('Describe the emote')).toHaveValue(generated.prompt);
  await shot('text-emote');
  await shot('timeline');
  await page.getByRole('checkbox', { name: 'Loop animation', exact: true }).check();
  await shot('loop-poses');
  await page.getByRole('checkbox', { name: 'Loop animation', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Right hand', exact: true }).click();
  await shot('avatar-controls');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await shot('export');
  await page.keyboard.press('Escape');
  await create('Review a dance', 'video');
  await page.getByLabel('Capture engine').selectOption('fast');
  await page
    .locator('input[type=file]')
    .setInputFiles('public/landing/emotes/female-reference.mp4');
  await expect(page.getByRole('dialog', { name: 'Prepare your video' })).toBeVisible();
  await page.getByLabel('Capture duration', { exact: true }).fill('2');
  await shot('video-prepare');
  await page.getByRole('button', { name: 'Analyze tracking', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review movement', exact: true })).toBeVisible({
    timeout: 180000,
  });
  await page.getByLabel('Tracking frame', { exact: true }).fill('10');
  await shot('video-review');
} finally {
  for (const id of created) await page.request.delete('/api/projects/' + id).catch(() => {});
  await browser.close();
}
