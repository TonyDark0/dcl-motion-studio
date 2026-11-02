import { test, expect, openEditor } from './workspace-fixture';
import { addProceduralTestClip } from './procedural-fixture';

test('compact toolbar, full-span hand templates, stable loop and collapsed transport', async ({
  page,
}) => {
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await addProceduralTestClip(page, 'wave');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const bar = page.locator('.timeline-bar');
  for (const name of ['Add transition', 'Save pose', 'Clips'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.locator('.nla-tools')).toHaveCount(0);
  for (const name of ['Duplicate', 'Split', 'Remove clip']) {
    const button = bar.getByRole('button', { name, exact: true });
    await expect(button).toHaveAttribute('title', name);
    expect((await button.textContent())!.trim()).toBe('');
    expect((await button.boundingBox())!.height).toBe(28);
  }
  const positions = await bar
    .locator('.timeline-edit-actions,.playback,.timeline-actions')
    .evaluateAll((elements) => elements.map((el) => Math.round(el.getBoundingClientRect().y)));
  expect(new Set(positions).size).toBe(1);
  await bar.getByRole('button', { name: 'Add hands', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Fist', exact: true }).click();
  const data = await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { useStudio } = await import(path);
    return useStudio.getState().project;
  });
  const hands = data.timeline.strips.at(-1);
  expect(hands.start).toBe(0);
  expect(hands.in).toBe(0);
  expect(hands.out).toBe(data.duration);
  expect(hands.mask).toBe('fingers');
  expect(data.timeline.assets.at(-1).handPoseStart).toBe('fist');
  expect(data.timeline.tracks.at(-1).kind).toBe('hands');
  await bar.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.nla-clip')).toHaveCount(1);
  await bar.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.nla-clip')).toHaveCount(2);
  // Sample the actual running transport across a loop boundary; no horizontal drift.
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { useStudio } = await import(path);
    useStudio.getState().set({ time: 3.9 });
  });
  const loop = bar.getByRole('button', { name: 'Loop playback', exact: true });
  const initial = (await loop.boundingBox())!;
  await bar.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = '/src/store.ts';
        const { useStudio } = await import(path);
        return useStudio.getState().time;
      }),
    )
    .toBeLessThan(1);
  const after = (await loop.boundingBox())!;
  expect(after.x).toBe(initial.x);
  expect(after.y).toBe(initial.y);
  await bar.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.screenshot({ path: 'test-results/compact-timeline.png' });
  await bar.getByRole('button', { name: 'Minimize timeline', exact: true }).click();
  await expect(page.locator('.nla-scroll')).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Add hands', exact: true })).toHaveCount(0);
  await expect(bar.getByLabel('Timeline zoom')).toHaveCount(0);
  expect((await page.locator('.timeline.nla').boundingBox())!.height).toBe(40);
  await bar.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/collapsed-timeline.png' });
  await bar.getByRole('button', { name: 'Show timeline', exact: true }).click();
  await expect(page.locator('.nla-clip')).toHaveCount(2);
  await expect(bar.getByLabel('Timeline zoom')).toBeVisible();
});
