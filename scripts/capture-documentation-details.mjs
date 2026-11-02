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
  if (await defaultAvatar.isVisible()) await defaultAvatar.click();
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
  await page.getByLabel('Timeline loop', { exact: true }).fill('0.3');
  await page.locator('.timeline.nla').screenshot({ path: folder + '/timeline-loop-detail.png' });
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page.locator('.timeline.nla').screenshot({ path: folder + '/timeline-split-detail.png' });
  await page.getByRole('checkbox', { name: 'Loop animation', exact: true }).check();
  await shot('loop-poses');
  await page.locator('.image-poses').screenshot({ path: folder + '/loop-slots-detail.png' });
  await page
    .getByLabel('Add image: Start / End', { exact: true })
    .setInputFiles('data/validation/mediapipe-pose.jpg');
  await expect(page.getByRole('dialog', { name: 'Review image pose', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page
    .getByRole('dialog', { name: 'Review image pose', exact: true })
    .screenshot({ path: folder + '/loop-review-detail.png' });
  await page.getByRole('button', { name: 'Accept pose', exact: true }).click();
  await page.locator('.image-poses').screenshot({ path: folder + '/loop-accepted-detail.png' });
} finally {
  for (const id of created) await page.request.delete('/api/projects/' + id).catch(() => {});
  await browser.close();
}
