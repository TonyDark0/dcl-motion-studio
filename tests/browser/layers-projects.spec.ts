import { test, expect, openEditor } from './workspace-fixture';
import { randomUUID } from 'node:crypto';
import { newProject } from '../../src/motion';
import { addProceduralTestClip } from './procedural-fixture';

test('saved project deletion persists through the real local API', async ({ request }) => {
  const id = randomUUID();
  expect(
    (
      await request.put('/api/projects/' + id, {
        data: { ...newProject(), name: 'Deletion regression fixture' },
      })
    ).ok(),
  ).toBe(true);
  try {
    expect((await request.get('/api/projects/' + id)).ok()).toBe(true);
    expect((await request.delete('/api/projects/' + id)).ok()).toBe(true);
    expect((await request.get('/api/projects/' + id)).status()).toBe(404);
    expect(
      (await (await request.get('/api/projects')).json()).some((p: { id: string }) => p.id === id),
    ).toBe(false);
  } finally {
    await request.delete('/api/projects/' + id);
  }
});

test('hands get their own replacement layer with blends and both ordering controls', async ({
  page,
}) => {
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await addProceduralTestClip(page, 'wave');
  await page.evaluate(async () => {
    const module = '/src/store.ts';
    const { useStudio } = await import(module);
    useStudio.getState().addHands({ handMode: 'procedural', handPoseEnd: 'fist' });
  });
  await expect(page.locator('.layer-hands')).toHaveCount(1);
  await expect(page.locator('.layer-body')).toHaveCount(1);
  await expect(page.getByLabel('Blend mode', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Blend mode', { exact: true })).toHaveValue('replace');
  await page.getByLabel('Clip influence', { exact: true }).fill('0.6');
  await page.getByLabel('Blend in', { exact: true }).fill('0.2');
  await page.locator('.layer-hands').getByTitle('Move layer down', { exact: true }).click();
  await expect(page.locator('.nla-row.layer-body + .nla-row.layer-hands')).toHaveCount(1);
  await page.locator('.layer-hands').getByTitle('Move layer up', { exact: true }).click();
  await expect(page.locator('.nla-row.layer-hands + .nla-row.layer-body')).toHaveCount(1);
  await page.locator('.layer-body .nla-clip').click();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.locator('.layer-body')).toHaveCount(2);
  await expect(page.locator('.layer-hands')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/hands-layers.png' });
});
