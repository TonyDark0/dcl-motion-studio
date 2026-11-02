import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('real Pro capture reaches review with body and hands over the complete segment', async ({
  page,
}) => {
  test.skip(process.env.DCL_REAL_PRO !== '1' || !process.env.DCL_VIDEO_FIXTURE, 'Opt-in GPU capture with a local reference video.');
  test.setTimeout(process.env.DCL_REAL_PRO_GENERATE === '1' ? 600000 : 240000);
  const name = `Pro capture check ${Date.now()}`;
  const failures: string[] = [],
    statuses: number[] = [];
  const layouts: string[] = [];
  let jobId: string | undefined;
  page.on('requestfailed', (request) =>
    failures.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  page.on('response', (response) => {
    if (response.url().includes('/api/video/pro-frame')) statuses.push(response.status());
    if (response.url().endsWith('/api/video/frame'))
      void response.json().then((data) => layouts.push(data.layout));
    if (
      response.url().endsWith('/api/jobs') &&
      response.request().method() === 'POST' &&
      response.status() === 202
    )
      void response.json().then((data) => {
        jobId = data.id;
      });
  });
  await page.goto('/app');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.getByLabel('Project name').fill(name);
  await dialog.getByLabel('Workflow').selectOption('video');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  try {
    await page.getByLabel('Capture engine').selectOption('pro');
    await page
      .locator('.video-panel input[type=file]')
      .setInputFiles(
        process.env.DCL_VIDEO_FIXTURE!,
      );
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(1);
    await page.getByLabel('Video start').fill('2');
    await page.getByLabel('Capture duration').fill('2');
    await page.getByRole('button', { name: 'Analyze tracking' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept and generate' })).toBeVisible({
      timeout: 180000,
    });
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(statuses.length).toBeGreaterThanOrEqual(47);
    expect(statuses.every((status) => status === 200)).toBe(true);
    // A cold model start can drop a connection. The app must recover to a complete
    // review, with no alert and successful responses for every captured frame.
    const captureFailures = failures.filter((f) => f.includes('/api/video/'));
    expect(
      captureFailures.filter((f) => !/pro-frame: net::ERR_CONNECTION_TIMED_OUT$/.test(f)),
    ).toEqual([]);
    expect(captureFailures.length).toBeLessThanOrEqual(2);
    expect(layouts.every((layout) => layout === 'body-hands-v1')).toBe(true);
    await page.screenshot({ path: 'data/validation/pro-capture-real-review.png' });
    if (process.env.DCL_REAL_PRO_GENERATE === '1') {
      await page.getByRole('button', { name: 'Accept and generate' }).click();
      await expect(page.getByRole('dialog', { name: 'Review movement' })).toBeHidden({
        timeout: 360000,
      });
      await expect(page.getByLabel('Movement smoothness', { exact: true })).toBeVisible();
      await page.getByLabel('Hand smoothness', { exact: true }).fill('0.5');
      await page.getByLabel('Movement smoothness', { exact: true }).fill('0.3');
      const motion = await (await page.request.get('/api/jobs/' + jobId + '/motion')).json();
      const result = motion.generation.video;
      expect(result.processing.captureMs).toBeGreaterThan(1000);
      expect(result.processing.generationMs).toBeGreaterThan(1000);
      expect(result.processing.totalMs).toBeCloseTo(
        result.processing.captureMs + result.processing.generationMs,
      );
      expect(result.referenceAvailable).toBe(true);
      const reference = await page.request.get('/api/jobs/' + jobId + '/reference-video', {
        headers: { range: 'bytes=0-15' },
      });
      expect(reference.status()).toBe(206);
      await page.getByRole('button', { name: 'Two cameras', exact: true }).click();
      await page.getByRole('button', { name: 'Reference video', exact: true }).click();
      await page.evaluate(async () => {
        const path = '/src/store.ts';
        const { useStudio } = await import(path);
        useStudio.getState().set({ playing: false, time: 0.8 });
      });
      await expect
        .poll(() =>
          page
            .getByLabel('Timeline reference video')
            .evaluate((v: HTMLVideoElement) => v.currentTime),
        )
        .toBeCloseTo(0.8, 1);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.screenshot({ path: 'data/validation/pro-video-result-real.png' });
      await writeFile(
        'data/validation/pro-video-result-check.json',
        JSON.stringify(
          {
            checkedAt: new Date().toISOString(),
            frames: statuses.length,
            processing: result.processing,
            recoveredCaptureConnections: captureFailures.length,
            privateReferenceRange: reference.status(),
            smoothing: { body: 0.3, hands: 0.5 },
          },
          null,
          2,
        ),
      );
    }
  } finally {
    const projects = await (await page.request.get('/api/projects')).json();
    const created = projects.find((p: { name: string }) => p.name === name);
    if (created) await page.request.delete('/api/projects/' + created.id);
    if (jobId) await page.request.delete('/api/jobs/' + jobId);
  }
});

