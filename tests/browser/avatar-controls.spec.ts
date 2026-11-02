import { test, expect, openEditor } from './workspace-fixture';

test('simple avatar adjustments expose independent angles and keep per-control resets', async ({
  page,
}) => {
  await page.goto('/app');
  await openEditor(page);
  const panel = page.locator('.avatar-adjustments');
  await expect(panel.getByText('Pose status')).toHaveCount(0);
  await expect(panel.getByText('Download editable project')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Left hand', exact: true }).click();
  await panel.getByRole('slider', { name: 'Down / up', exact: true }).fill('0.1');
  await panel.locator('summary').click();
  await panel.getByRole('slider', { name: 'Tilt', exact: true }).fill('20');
  await panel.getByRole('button', { name: 'Right hand', exact: true }).click();
  await expect(panel.getByRole('slider', { name: 'Tilt', exact: true })).toHaveValue('0');
  await panel.getByRole('button', { name: 'Left hand', exact: true }).click();
  await expect(panel.getByRole('slider', { name: 'Down / up', exact: true })).toHaveValue('0.1');
  await panel.getByRole('button', { name: 'Reset Tilt', exact: true }).click();
  await expect(panel.getByRole('slider', { name: 'Tilt', exact: true })).toHaveValue('0');
  await expect(panel.getByRole('slider', { name: 'Down / up', exact: true })).toHaveValue('0.1');
  await panel.getByRole('button', { name: 'Hide avatar controls' }).click();
  await expect(panel.getByRole('slider', { name: 'Body height' })).toBeHidden();
  await panel.getByRole('button', { name: 'Show avatar controls' }).click();
  await expect(panel.getByRole('slider', { name: 'Body height' })).toBeVisible();
  await page.screenshot({ path: 'data/validation/avatar-controls.png' });
});

