import { test, expect, openEditor } from './workspace-fixture';
import { randomUUID } from 'node:crypto';
test('fresh generation seeds and keep style work with automatic timeline insertion', async ({
  page,
}) => {
  const submitted: number[] = [];
  const styles: Array<string | undefined> = [];
  let job: { id: string; prompt: string; status: string } | null = null;
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { engine: { configured: true, constraints: true }, config: {} } }),
  );
  await page.route(/\/api\/jobs(?:\/[^/?]+(?:\/motion)?)?$/, async (route) => {
    const method = route.request().method();
    if (method === 'POST') {
      const request = route.request().postDataJSON();
      submitted.push(request.seed);
      styles.push(request.emoteStyle);
      job = { id: randomUUID(), prompt: 'wave', status: 'completed' };
      return route.fulfill({ json: job });
    }
    if (method === 'DELETE') {
      job = null;
      return route.fulfill({ json: { deleted: true } });
    }
    if (route.request().url().endsWith('/motion'))
      return route.fulfill({
        json: {
          version: 1,
          skeleton: 'soma30',
          fps: 30,
          frames: 60,
          prompt: 'wave',
          seed: submitted.at(-1),
          source: 'kimodo.cpp',
          roots: Array.from({ length: 60 }, () => [0, 1, 0]).flat(),
          rotations: Array.from({ length: 1800 }, () => [0, 0, 0, 1]).flat(),
        },
      });
    return route.fulfill({ json: job ? [job] : [] });
  });
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  const lock = page.getByRole('checkbox', { name: 'Keep style' });
  await expect(lock).toBeDisabled();
  await expect(page.getByRole('group', { name: 'Emote style' })).toHaveCount(0);
  // An old saved category must not silently condition a new generation.
  await page.evaluate(async () => {
    const url =
      performance
        .getEntriesByType('resource')
        .filter((r) => r.name.includes('/src/store.ts'))
        .at(-1)?.name || '/src/store.ts';
    const { useStudio } = await import(url);
    useStudio.getState().change({ emoteStyle: 'dance' });
  });
  const generate = async () => {
    await page.getByRole('button', { name: 'Generate animation', exact: true }).click();
    await expect(page.locator('.nla-clip')).toHaveCount(submitted.length);
  };
  await generate();
  expect(styles[0]).toBeUndefined();
  await generate();
  expect(styles[1]).toBeUndefined();
  expect(submitted[0]).not.toBe(submitted[1]);
  await lock.check();
  await page.getByLabel('Describe the emote').fill('A person waves more gently');
  await generate();
  expect(submitted[2]).toBe(submitted[1]);
  await lock.uncheck();
  await generate();
  expect(submitted[3]).not.toBe(submitted[2]);
  await expect(page.locator('.nla-clip')).toHaveCount(4);
});
