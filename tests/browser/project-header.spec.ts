import { test, expect, openEditor } from './workspace-fixture';
import { addProceduralTestClip } from './procedural-fixture';

test('library and editor headers, automatic save and save-before-leaving use the real project API', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeVisible();
  for (const name of ['Export', 'Save', 'Rate animation', 'Back to projects'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Project name')).toHaveCount(0);
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await expect(page.locator('.project-name span')).toHaveText('Text to emote');
  const nameBounds = (await page.locator('.project-name').boundingBox())!;
  const header = (await page.locator('.header').boundingBox())!;
  expect(Math.abs(nameBounds.x + nameBounds.width / 2 - header.x - header.width / 2)).toBeLessThan(
    2,
  );
  await page.getByLabel('Project name').fill('Autosaved header test');
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes('/api/projects/'),
  );
  await page.clock.fastForward(5 * 60_000);
  expect((await saved).ok()).toBe(true);
  const list = await (await page.request.get('/api/projects')).json();
  const id = list.find((p: any) => p.name === 'Autosaved header test').id;
  await page.getByLabel('Project name').fill('Unsaved replacement');
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Unsaved replacement');
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeVisible();
  await expect(page.getByLabel('Project name')).toHaveCount(0);
  expect((await (await page.request.get('/api/projects/' + id)).json()).name).toBe(
    'Autosaved header test',
  );
  await page.screenshot({ path: 'data/validation/projects-header-new.png' });
});

test('remove layer deletes all of its strips, undo restores them, and deleting the last strip removes its layer', async ({
  page,
}) => {
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await addProceduralTestClip(page, 'wave');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('slider', { name: 'Animation position' }).fill('2');
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.nla-clip')).toHaveCount(2);
  await expect(page.locator('.nla-row.layer-body')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove layer Body', exact: true }).click();
  await expect(page.locator('.nla-row.layer-body')).toHaveCount(0);
  await expect(page.locator('.nla-clip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.nla-clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove clip', exact: true }).click();
  await expect(page.locator('.nla-row.layer-body')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove clip', exact: true }).click();
  await expect(page.locator('.nla-row.layer-body')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast[role=status]')).toContainText('Project saved.');
});

test('capture engine label and selector have separate space in the video workspace', async ({
  page,
}) => {
  await page.goto('/app');
  await openEditor(page, 'video');
  await expect(page.locator('.project-name span')).toHaveText('Video to emote');
  const label = (await page.locator('.capture-engine-field span').boundingBox())!;
  const select = (await page.getByLabel('Capture engine').boundingBox())!;
  expect(select.x - label.x - label.width).toBeGreaterThan(12);
  await page.screenshot({ path: 'data/validation/video-header-new.png' });
});
