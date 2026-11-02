import { test as base, expect, type Page } from '@playwright/test';
const created = new WeakMap<Page, string[]>();
export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);
    for (const id of created.get(page) || [])
      await page.request.delete('/api/projects/' + id).catch(() => {});
  },
});
export { expect };
export async function openEditor(
  page: Page,
  workflow: 'text' | 'video' = 'text',
  showTour = false,
) {
  if (!showTour) await page.evaluate(() => localStorage.setItem('dcl-studio-tour-v1', 'done'));
  if (await page.getByRole('button', { name: 'Back to projects', exact: true }).isVisible()) return;
  const previous = created.get(page)?.at(-1);
  if (previous) {
    const response = await page.request.get('/api/projects/' + previous);
    if (response.ok()) {
      const project = await response.json();
      if (project.workflow === workflow) {
        await page
          .getByRole('button', { name: 'Open project: ' + project.name, exact: true })
          .click();
        await expect(
          page.getByRole('button', { name: 'Back to projects', exact: true }),
        ).toBeVisible();
        const defaultAvatar = page.getByRole('button', {
          name: 'Use default avatar instead',
          exact: true,
        });
        if (await defaultAvatar.isVisible()) await defaultAvatar.click();
        return;
      }
    }
  }
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  const name = 'Browser workspace ' + crypto.randomUUID();
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByLabel('Workflow').selectOption(workflow);
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && /\/api\/projects\/[a-f0-9-]+$/.test(r.url()),
  );
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  created.set(page, [...(created.get(page) || []), response.url().split('/').at(-1)!]);
  await expect(page.getByRole('button', { name: 'Back to projects', exact: true })).toBeVisible();
  const defaultAvatar = page.getByRole('button', {
    name: 'Use default avatar instead',
    exact: true,
  });
  if (await defaultAvatar.isVisible()) await defaultAvatar.click();
}
