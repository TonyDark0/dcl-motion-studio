import { test, expect } from '@playwright/test';
test('preferences persist between landing, docs and studio', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme', 'dark');
  await expect(page.locator('.site-preferences option')).toHaveCount(7);
  await expect(page.locator('.lp-studio-card canvas')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'data/validation/preferences-hero.png' });
  await page.locator('#how-it-works').scrollIntoViewIfNeeded();
  await expect(page.locator('.lp-guide-grid article')).toHaveCount(3);
  await expect(page.locator('.lp-workflow-preview').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Video to emote', exact: true }).click();
  await expect(page.locator('.lp-guide-grid h3')).toHaveText([
    'Choose your moment',
    'Make the movement yours',
    'Share your new move',
  ]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'data/validation/preferences-guide.png' });
  await page.locator('.lp-creator-cta').scrollIntoViewIfNeeded();
  await page
    .locator('.lp-avatar-cast img')
    .evaluateAll((imgs) => Promise.all(imgs.map((img) => (img as HTMLImageElement).decode())));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'data/validation/preferences-footer.png' });
  await page.locator('.site-preferences button').click();
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme', 'light');
  await page.locator('.site-preferences select').selectOption('es');
  await expect(page.locator('.lp-header nav')).toContainText('Documentación');
  await page.goto('/docs');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme', 'light');
  await expect(page.locator('.docs-article')).toContainText('emote');
  await page.screenshot({ path: 'data/validation/preferences-docs-es-light.png' });
  for (const locale of ['ja', 'de', 'ru', 'ar', 'zh']) {
    await page.locator('.site-preferences select').selectOption(locale);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.locator('.docs-article h1')).not.toHaveText('Welcome to DCL Motion Studio');
  }
  await page.locator('.site-preferences select').selectOption('ar');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'data/validation/preferences-docs-ar-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto('/');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'data/validation/preferences-landing-ar-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto('/app#projects');
  await expect(page.locator('.studio')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme', 'light');
  await page.screenshot({ path: 'data/validation/preferences-studio-ar.png' });
  expect(errors).toEqual([]);
});
