import { test, expect, openEditor } from './workspace-fixture';

test('engine settings explain a failed launch and allow a fresh installation check', async ({
  page,
}) => {
  let ready = false;
  await page.route('**/api/engine/check-constraints', (route) =>
    route.fulfill({
      json: {
        executable: 'C:/Studio/kmd-generate.exe',
        status: ready ? 'ready' : 'unavailable',
        detail: 'Application control blocked launch',
      },
    }),
  );
  await page.goto('/app');
  await openEditor(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Configure', exact: true }).click();
  await page.getByRole('button', { name: 'Check installation', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Studio Constraints' }).getByRole('status'),
  ).toContainText(
    'Windows could not run Studio Constraints. Check application-control approval and required runtime files.',
  );
  await expect(
    page.getByRole('button', { name: 'Use Studio Constraints', exact: true }),
  ).toHaveCount(0);
  ready = true;
  await page.getByRole('button', { name: 'Check installation', exact: true }).click();
  await expect(page.getByText('Studio Constraints is ready.', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Use Studio Constraints', exact: true }),
  ).toBeEnabled();
});

test('loop generation requires a compatible engine and a reviewed image pose', async ({
  page,
}) => {
  let compatible = false;
  await page.route('**/api/health', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        engine: {
          configured: true,
          missing: [],
          running: false,
          busy: false,
          constraints: compatible,
        },
        config: {
          executable: 'test-engine',
          model: 'test-model',
          text: 'test-encoder',
          device: 'cpu',
        },
      },
    });
  });
  await page.goto('/app');
  await openEditor(page);
  const loop = page.getByRole('checkbox', { name: 'Loop animation', exact: true });
  await expect(loop).toBeDisabled();
  await expect(
    page.getByTitle('Requires the Studio constraints build of Kimodo.').first(),
  ).toBeVisible();
  compatible = true;
  await expect(loop).toBeEnabled();
  await loop.check();
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Generate animation', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Add image: Start / End')).toBeVisible();
});
