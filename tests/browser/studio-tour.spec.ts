import { test, expect, openEditor } from './workspace-fixture';

for (const workflow of ['text', 'video'] as const) {
  test(`${workflow}: tour highlights the editor, goes back, completes, and can be replayed`, async ({
    page,
  }) => {
    await page.goto('/app');
    await openEditor(page, workflow, true);
    const tour = page.getByRole('dialog');
    await expect(tour.getByRole('heading', { name: 'Meet your avatar' })).toBeVisible();
    await expect(tour.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
    expect(await page.locator('.studio').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
    await expect(page.locator('.studio-tour-shade > rect').last()).toHaveAttribute(
      'stroke',
      '#ff7199',
    );
    await page.screenshot({ path: `data/validation/studio-tour-${workflow}.png` });
    await tour.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(tour.getByRole('heading')).toHaveText(
      workflow === 'text' ? 'Start with an idea' : 'Bring your movement',
    );
    if (workflow === 'video') await expect(tour).toContainText('review the tracking');
    await tour.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(tour.getByRole('heading')).toHaveText('Meet your avatar');
    await page.setViewportSize({ width: 900, height: 740 });
    for (let i = 0; i < 7; i++) {
      await tour.getByRole('button', { name: 'Next', exact: true }).click();
      const box = await tour.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(900);
      expect(box!.y + box!.height).toBeLessThanOrEqual(740);
    }
    await expect(tour.getByRole('heading')).toHaveText('Save, customize and export');
    await tour.getByRole('button', { name: 'Start creating' }).click();
    await expect(page.locator('.studio-tour-overlay')).toHaveCount(0);
    expect(await page.locator('.studio').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('dcl-studio-tour-v1'))).toBe('done');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Take a studio tour' }).click();
    await expect(tour.getByRole('heading')).toHaveText('Meet your avatar');
    await page.keyboard.press('Shift+Tab');
    await expect(tour.getByRole('button', { name: 'Next', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(tour.getByRole('button', { name: 'Skip tutorial' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.studio-tour-overlay')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.studio-tour-overlay')).toHaveCount(0);
  });
}

test('wallet preview finishes loading before the tutorial opens', async ({ page }) => {
  const address = '0x' + '1'.repeat(40);
  await page.route('/api/avatar/' + address, (route) =>
    route.fulfill({
      json: {
        wallet: address,
        name: 'Test avatar',
        bodyShape: 'male',
        skin: [0.8, 0.6, 0.4],
        hair: [0.2, 0.1, 0],
        eyes: [0.2, 0.1, 0],
        hidden: [],
        warnings: [],
        assets: [
          {
            id: 'test-body',
            category: 'body_shape',
            mainFile: 'Avatar.glb',
            files: { 'Avatar.glb': '/assets/Avatar.glb' },
            hides: [],
            replaces: [],
          },
        ],
      },
    }),
  );
  await page.goto('/app');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New project', exact: true });
  await create.getByLabel('Project name').fill('Wallet tour ' + crypto.randomUUID());
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && /\/api\/projects\/[a-f0-9-]+$/.test(r.url()),
  );
  await create.getByRole('button', { name: 'Create project', exact: true }).click();
  const id = (await saved).url().split('/').at(-1);
  try {
    await page.getByLabel('Wallet address', { exact: true }).fill(address);
    await page.getByRole('button', { name: 'Preview my avatar', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Meet your avatar' })).toBeVisible();
    await expect(page.locator('.loading-overlay')).toHaveCount(0);
    await page.getByRole('button', { name: 'Skip tutorial' }).click();
  } finally {
    if (id) await page.request.delete('/api/projects/' + id);
  }
});
