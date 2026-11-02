import { test, expect, openEditor } from './workspace-fixture';

test('camera layout, avatar colors and independent resets work in the viewport', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  const second = page.locator('.camera-pane-secondary canvas');
  await expect(second).toBeHidden();
  await page.getByRole('button', { name: 'Two cameras' }).click();
  await expect(second).toBeVisible();
  const firstBounds = await page.locator('.camera-pane canvas').first().boundingBox();
  const secondBounds = await second.boundingBox();
  expect(firstBounds!.x + firstBounds!.width).toBeLessThanOrEqual(secondBounds!.x + 2);
  await page.getByRole('button', { name: 'One camera' }).click();
  await expect(second).toBeHidden();

  const skin = page.getByRole('button', { name: 'Skin', exact: true });
  const before = await skin.evaluate((element) => getComputedStyle(element).backgroundColor);
  await skin.click();
  await page.getByRole('slider', { name: 'Skin hue' }).fill('180');
  expect(await skin.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    before,
  );

  await page.getByRole('slider', { name: 'Knee bend' }).fill('0.25');
  await page.getByRole('slider', { name: 'Body height' }).fill('-0.1');
  await page.getByRole('button', { name: 'Reset Body height' }).click();
  await expect(page.getByRole('slider', { name: 'Body height' })).toHaveValue('0');
  await expect(page.getByRole('slider', { name: 'Knee bend' })).toHaveValue('0.25');
  expect(errors).toEqual([]);
});

test('viewport dock changes camera angle and shares motion mode across workspaces', async ({
  page,
}) => {
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await expect(page.locator('.view-left .viewport-control-row')).toHaveCount(4);
  await expect
    .poll(
      async () =>
        (await page.locator('.view-left .viewport-control-row').first().boundingBox())!.width,
    )
    .toBe(112);
  await expect(page.locator('.left-panel').getByText('MOTION SPACE')).toHaveCount(0);
  const canvas = page.locator('.camera-pane canvas').first();
  await page.getByRole('button', { name: '+Z view' }).click();

  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const front = await canvas.screenshot();
  await page.getByRole('button', { name: '+Z view' }).click();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const back = await canvas.screenshot();
  expect(front.equals(back)).toBe(false);
  await page.getByRole('button', { name: '-X view' }).click();

  await page.getByRole('button', { name: '-X view' }).click();

  await page.getByRole('button', { name: 'Source movement' }).click();
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click();
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await openEditor(page);
  await expect(page.getByRole('button', { name: 'Source movement' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'In place (game ready)' }).click();
  await openEditor(page);
  await expect(page.getByRole('button', { name: 'In place (game ready)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
