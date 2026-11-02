import { test, expect } from '@playwright/test';
import { chapters } from '../../src/documentation-content';
test('documentation is reachable, searchable, deep-linked and has real readable screenshots', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'Documentation', exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your first project');
  await page.getByRole('searchbox').fill('SOMAHand');
  await expect(
    page
      .getByRole('navigation', { name: 'Documentation chapters' })
      .getByRole('link', { name: 'Models and workflow' }),
  ).toBeVisible();
  await page.getByRole('searchbox').fill('zzzzmissing');
  await expect(page.getByRole('status')).toContainText('No topics found');
  await page.getByRole('searchbox').fill('');
  await page
    .getByRole('navigation', { name: 'Documentation chapters' })
    .getByRole('link', { name: 'Text to emote', exact: true })
    .click();
  await page.getByRole('button', { name: 'Enlarge screenshot: Write a clear prompt' }).click();
  await expect(page.locator('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toBeHidden();
  await page.goto('/docs#technology/flow');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Models and workflow');
  await expect(page.getByRole('heading', { name: 'From reference to emote' })).toBeInViewport();
  for (const image of new Set(
    chapters.flatMap((c) => c.sections.map((s) => s.image).filter(Boolean)),
  )) {
    const r = await page.request.get('/docs/images/' + image);
    expect(r.ok()).toBe(true);
    expect(r.headers()['content-type']).toContain('image/png');
    const png = await r.body();
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBeGreaterThan(150);
    expect(png.readUInt32BE(20)).toBeGreaterThan(100);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs#video');
  await page.getByRole('button', { name: 'Browse documentation' }).click();
  await expect(page.getByRole('searchbox')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Documentation chapters' })
    .getByRole('link', { name: 'Export and share feedback' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Export and share feedback');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
