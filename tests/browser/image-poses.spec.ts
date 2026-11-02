import { test, expect, openEditor } from './workspace-fixture';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

test('loop shows compact image references and starts with an empty timeline', async ({
  page,
}) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: {
        ok: true,
        engine: { configured: true, constraints: true, busy: false },
        config: { executable: 'test', model: 'test', text: 'test', device: 'cpu' },
      },
    }),
  );
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await expect(page.locator('.nla-clip')).toHaveCount(0);
  const generate = page.getByRole('button', { name: 'Generate animation', exact: true });
  await expect(generate).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Loop animation', exact: true }).check();
  await expect(page.getByLabel('Add image: Start / End', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Add image: Middle 2', { exact: true })).toBeVisible();
  await expect(generate).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Loop animation', exact: true }).uncheck();
  await expect(generate).toBeEnabled();
});

test('real MediaPipe image extraction is reviewed before a numeric-only generation request', async ({
  page,
}) => {
  test.skip(
    !process.env.DCL_POSE_IMAGE,
    'Supply a local full-body photo for actual MediaPipe inference.',
  );
  test.setTimeout(120000);
  const input = path.resolve(process.env.DCL_POSE_IMAGE!);
  let submitted: any;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/jobs', (route) => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 202, json: { id: 'image-test' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await page.getByRole('checkbox', { name: 'Loop animation', exact: true }).check();
  await page.getByLabel('Add image: Start / End', { exact: true }).setInputFiles(input);
  const review = page.getByRole('dialog', { name: 'Review image pose', exact: true });
  await expect(review).toBeVisible({ timeout: 60000 });
  await expect(review.getByRole('img', { name: 'Front pose preview', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(path.dirname(input), 'image-pose-review.png') });
  await review.getByRole('button', { name: 'Accept pose', exact: true }).click();
  await page.getByRole('button', { name: 'Generate animation', exact: true }).click();
  await expect.poll(() => submitted?.referencePoses?.start?.world?.length).toBe(33);
  expect(submitted.referencePoses.start.thumbnail).toBeUndefined();
  expect(submitted.referencePoses.end).toBeUndefined();
  expect(submitted.loop).toBe(true);
  expect(errors).toEqual([]);
  await writeFile(
    path.join(path.dirname(input), 'image-pose-request.json'),
    JSON.stringify(submitted, null, 2),
  );
  await page.getByLabel('Add image: Middle', { exact: true }).setInputFiles(input);
  await expect(review).toBeVisible();
  const wrist = review.locator('.pose-review-image circle[data-index="15"]');
  const bounds = await wrist.boundingBox();
  if (!bounds) throw Error('Missing wrist overlay');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 12);
  await page.mouse.up();
  await expect(review.getByRole('slider', { name: 'Selected point depth' })).toBeVisible();
  await review.getByRole('button', { name: 'Accept pose', exact: true }).click();
  await page.getByRole('slider', { name: 'Middle Pose timing' }).fill('0.6');
  await page.getByRole('button', { name: 'Generate animation', exact: true }).click();
  await expect.poll(() => submitted?.loop).toBe(true);
  expect(submitted.referencePoses.end).toBeUndefined();
  expect(submitted.referencePoses.middle.world[15]).not.toEqual(
    submitted.referencePoses.start.world[15],
  );
  expect(submitted.referencePoses.middleTime).toBe(0.6);
  expect(errors).toEqual([]);
});
