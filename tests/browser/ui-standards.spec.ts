import { test, expect, openEditor } from './workspace-fixture';
import { addProceduralTestClip } from './procedural-fixture';

test('UI2 dialogs restore focus and keyboard controls do not toggle playback', async ({ page }) => {
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  const skip = page.getByRole('link', { name: 'Skip to editor' });
  await skip.focus();
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor-workspace')).toBeFocused();
  const projects = page.getByRole('button', { name: 'Settings', exact: true });
  await projects.focus();
  await page.keyboard.press('Space');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.timecode')).toContainText('0.00');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(projects).toBeFocused();
  for (const width of [390, 768, 991, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
});

test('project workspace preserves animation while panels free viewport space', async ({ page }) => {
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  const viewport = page.locator('.viewport-wrap');
  const normalWidth = (await viewport.boundingBox())!.width;
  const normalHeight = (await viewport.boundingBox())!.height;
  await addProceduralTestClip(page, 'squat');
  await expect(page.getByRole('tab', { name: 'Video to emote' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click();
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await openEditor(page);
  await expect(page.locator('.nla-clip')).toContainText('Squat');
  await page.getByRole('button', { name: 'Hide avatar controls' }).click();
  await expect
    .poll(async () => (await viewport.boundingBox())!.width)
    .toBeGreaterThan(normalWidth + 150);
  await page.getByRole('button', { name: 'Minimize timeline' }).click();
  await expect
    .poll(async () => (await viewport.boundingBox())!.height)
    .toBeGreaterThan(normalHeight + 200);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show timeline', exact: true }).click();
  await expect(page.locator('.timeline-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Show avatar controls' }).click();
  await expect(page.getByRole('slider', { name: 'Body height' })).toBeVisible();
  await openEditor(page);
  await expect(page.getByRole('button', { name: 'Generate animation' })).toBeVisible();
  await expect(page.locator('.nla-clip')).toContainText('Squat');
  await page.reload();
  await expect(page.getByRole('tabpanel', { name: 'Projects', exact: true })).toBeVisible();
});

test('settings control language, theme and Kimodo configuration', async ({ page }) => {
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await expect(page.locator('.view-left .viewport-control-row')).toHaveCount(4);
  const boxes = await page
    .locator('.view-left .avatar-chip, .view-left .viewport-control-row')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
      })),
    );
  expect(boxes.every((box) => box.width === 112 && box.height === 32)).toBe(true);
  await expect(page.locator('.avatar-chip')).toHaveCount(0);
  await expect(page.getByText('Explore the rig')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'Settings' });
  await trigger.click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await expect(settings.getByText('Kimodo', { exact: true })).toBeVisible();
  await settings.getByLabel('Theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme', 'light');
  await page.waitForTimeout(350);
  await page.screenshot({ path: '../../work/studio-settings-light-verified.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: '../../work/studio-light-verified.png', fullPage: true });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'Configure' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Configure kimodo.cpp engine' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).getByLabel('Language').selectOption('es');
  await page.keyboard.press('Escape');
  await expect(page.locator('.project-name span')).toHaveText('Texto a emote');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-studio-theme', 'light');
  await expect(page.locator('.library-header-title')).toHaveText('Proyectos');
  await expect(page.getByLabel('Nombre del proyecto')).toHaveCount(0);
});
