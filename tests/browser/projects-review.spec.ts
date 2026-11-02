import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('projects opens first, generations create layers, and projects can be renamed and deleted', async ({
  page,
}) => {
  const projects = new Map<string, any>();
  let job: { id: string; prompt: string; status: string } | null = null;
  let removed = 0;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: {
        ok: true,
        engine: { configured: true, constraints: true },
        config: { executable: 'test', model: 'test', text: 'test', device: 'cpu' },
      },
    }),
  );
  await page.route(/\/api\/projects(?:\/[^/?]+)?$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[3];
    const method = route.request().method();
    if (method === 'PUT') projects.set(id, route.request().postDataJSON());
    if (method === 'DELETE') {
      projects.delete(id);
      return route.fulfill({ json: { deleted: true } });
    }
    if (method === 'PATCH') projects.get(id).name = route.request().postDataJSON().name;
    await route.fulfill({
      json: id
        ? projects.get(id)
        : [...projects].map(([id, project]) => ({
            id,
            ...project,
            updated: new Date().toISOString(),
          })),
    });
  });
  await page.route(/\/api\/jobs(?:\/[^/?]+(?:\/motion)?)?$/, async (route) => {
    const method = route.request().method(),
      path = new URL(route.request().url()).pathname;
    if (method === 'POST') {
      job = { id: randomUUID(), prompt: 'Preview test', status: 'completed' };
      return route.fulfill({ json: job });
    }
    if (method === 'DELETE') {
      expect(route.request().headers()['content-type']).toBeUndefined();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      removed++;
      job = null;
      return route.fulfill({ response });
    }
    if (path.endsWith('/motion'))
      return route.fulfill({
        json: {
          version: 1,
          skeleton: 'soma30',
          fps: 30,
          frames: 60,
          prompt: 'Preview test',
          seed: 7,
          source: 'kimodo.cpp',
          roots: Array.from({ length: 60 }, () => [0, 1, 0]).flat(),
          rotations: Array.from({ length: 60 * 30 }, () => [0, 0, 0, 1]).flat(),
        },
      });
    return route.fulfill({ json: job ? [job] : [] });
  });
  await page.goto('/app');
  await expect(page.getByRole('tabpanel', { name: 'Projects', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New project', exact: true });
  await create.getByLabel('Project name').fill('My emote');
  await create.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('.project-name span')).toHaveText('Text to emote');
  await expect(page.locator('.nla-clip')).toHaveCount(0);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  const duration = await page.getByLabel('Duration', { exact: true }).boundingBox();
  expect(duration!.height).toBeLessThanOrEqual(30);
  expect(duration!.width).toBeLessThanOrEqual(65);
  await page.getByRole('checkbox', { name: 'Loop animation', exact: true }).check();
  await expect(page.getByLabel('Add image: Start / End', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Add image: Middle 2', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Add image: End', { exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Loop animation', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Generate animation', exact: true }).click();
  await expect(page.locator('.nla-clip')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Send to timeline', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Source movement', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('checkbox', { name: 'Correct foot contacts' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Generate animation', exact: true }).click();
  await expect(page.locator('.nla-clip')).toHaveCount(2);
  await expect(page.locator('.layer-body')).toHaveCount(2);
  await expect(page.locator('.nla-contact-row')).toHaveCount(0);
  await expect(page.locator('.view-left > .viewport-control-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Two cameras', exact: true }).click();
  await expect(page.locator('.view-axis-gizmo:visible')).toHaveCount(2);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const secondaryBefore = await page.locator('.camera-pane-secondary .view-axis-gizmo').innerHTML();
  await page
    .locator('.camera-pane:first-child')
    .getByRole('button', { name: '+X view', exact: true })
    .click();
  expect(await page.locator('.camera-pane-secondary .view-axis-gizmo').innerHTML()).toBe(
    secondaryBefore,
  );
  await page.screenshot({ path: 'test-results/updated-editor.png' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast[role=status]')).toContainText('Project saved.');
  await expect.poll(() => [...projects.values()][0].timeline.strips.length).toBe(2);
  expect([...projects.values()][0].thumbnail).toMatch(/^data:image\/jpeg/);
  await page.getByRole('button', { name: 'Back to projects', exact: true }).click();
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await page.getByRole('button', { name: 'Rename: My emote', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename project', exact: true });
  await rename.getByLabel('Project name').fill('Cumbia');
  await rename.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open project: Cumbia', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.project-collection.list')).toBeVisible();
  await page.getByLabel('Filter projects').selectOption('video');
  await expect(page.getByRole('button', { name: 'Open project: Cumbia', exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel('Filter projects').selectOption('text');
  await expect(
    page.getByRole('button', { name: 'Open project: Cumbia', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.jobs')).toHaveCount(0);
  await expect(page.getByText('Import project or motion', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/projects-workspace.png', fullPage: true });
  await page.getByRole('button', { name: 'Delete project: Cumbia', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete project', exact: true })
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Open project: Cumbia', exact: true })).toHaveCount(
    0,
  );
  expect(projects.size).toBe(0);
  expect(errors).toEqual([]);
});
