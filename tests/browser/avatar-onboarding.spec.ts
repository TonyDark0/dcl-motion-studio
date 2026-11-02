import { test, expect } from './workspace-fixture';

test('first project offers a wallet avatar or the default, then remembers the choice', async ({
  page,
}) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  const name = `Avatar onboarding ${crypto.randomUUID()}`;
  await dialog.getByLabel('Project name').fill(name);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && /\/api\/projects\/[a-f0-9-]+$/.test(response.url()),
  );
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  const id = (await saved).url().split('/').at(-1);
  try {
    await expect(page.getByRole('heading', { name: 'Preview your avatar' })).toBeVisible();
    await expect(page.getByText('You can change your avatar later in Settings.')).toBeVisible();
    await page.getByRole('button', { name: 'Use default avatar instead' }).click();
    await expect(page.getByRole('heading', { name: 'Preview your avatar' })).toHaveCount(0);
    const tour = page.getByRole('dialog', { name: 'Meet your avatar' });
    await expect(tour).toBeVisible();
    await tour.getByRole('button', { name: 'Skip tutorial' }).click();
    expect(await page.evaluate(() => localStorage.getItem('dcl-avatar-onboarded-v1'))).toBe('done');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Preview your avatar' })).toHaveCount(0);
  } finally {
    if (id) await page.request.delete('/api/projects/' + id);
  }
});
