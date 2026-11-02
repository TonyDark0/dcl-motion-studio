import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
// @ts-expect-error No declarations provided by the validator.
import { validateBytes } from 'gltf-validator';
import { standingPose } from '../fixtures/image-pose';
const videoJob = '51b85cb9-5386-4736-8a39-6cb30dac0850';

test('reviewed video generates Body and Hands; native failure keeps tracking available to retry', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.addInitScript(() => localStorage.setItem('dcl-studio-tour-v1', 'done'));
  const body = standingPose().world;
  const errors: string[] = [];
  const preparedStatuses: number[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/media/prepare?')) preparedStatuses.push(response.status());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*mediapipe_tasks-vision.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
    const world = ${JSON.stringify(body)}.map(([x,y,z]) => ({x,y,z,visibility:1}));
    export const FilesetResolver = { forVisionTasks: async () => ({}) };
    export const PoseLandmarker = { createFromOptions: async () => ({ close(){}, detectForVideo(){
      const sample = world.map((p,j) => ({...p,visibility:window.__badTracking && j===27 ? 0 : 1}));
      return { worldLandmarks:[sample], landmarks:[sample.map(p => ({x:.5+p.x*.4,y:.42+p.y*.4,z:p.z,visibility:p.visibility}))] };
    } }) };
  `,
    }),
  );
  await page.route('**/api/video/status', (route) =>
    route.fulfill({
      json: {
        available: true,
        busy: false,
        pro: { samAvailable: true, mogeAvailable: true, runtime: true, busy: false },
      },
    }),
  );
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { engine: { configured: true, constraints: true } } }),
  );
  const points = Array.from({ length: 133 }, () => [144, 180, 0, 1]);
  for (const [mp, rt] of [
    [11, 5],
    [12, 6],
    [13, 7],
    [14, 8],
    [15, 9],
    [16, 10],
    [25, 13],
    [26, 14],
    [27, 15],
    [28, 16],
  ])
    points[rt] = [144 + body[mp][0] * 150, 180 + body[mp][1] * 150, body[mp][2], 1];
  for (const [offset, wrist, sign] of [
    [91, 15, 1],
    [112, 16, -1],
  ]) {
    for (let j = 0; j < 21; j++) {
      const segment = j ? ((j - 1) % 4) + 1 : 0;
      const finger = j ? Math.floor((j - 1) / 4) - 2 : 0;
      points[offset + j] = [
        144 + (body[wrist][0] + sign * segment * 0.025) * 150,
        180 + (body[wrist][1] + finger * 0.012) * 150,
        0,
        1,
      ];
    }
  }
  await page.route('**/api/video/frame', (route) =>
    route.fulfill({ json: { points: points.flat() } }),
  );
  let submitted: any = null,
    submissions = 0,
    proCalls = 0;
  await page.route(/\/api\/jobs$/, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    submitted = route.request().postDataJSON();
    submissions++;
    return route.fulfill({ status: 202, json: { id: videoJob } });
  });
  await page.route('**/api/jobs/' + videoJob, (route) =>
    route.fulfill({
      json:
        submissions === 1
          ? { status: 'failed', error: 'Test inference failed' }
          : { status: 'completed' },
    }),
  );
  await page.route('**/api/jobs/' + videoJob + '/motion', (route) =>
    route.fulfill({
      json: {
        version: 1,
        source: 'kimodo.cpp',
        skeleton: 'soma30',
        frames: Math.round(submitted.duration * 30),
        fps: 30,
        prompt: 'video',
        seed: 1,
        generation: {
          conditioning: 'soma30-v1',
          loop: false,
          rootMotion: 'source',
          video: {
            provider: 'mediapipe+rtmw3d',
            poseStride: 10,
            file: 'dance.mp4',
            processing: { captureMs: 1200, generationMs: 2300, totalMs: 3500 },
            referenceAvailable: false,
          },
        },
        roots: Array.from({ length: Math.round(submitted.duration * 90) }, (_, i) =>
          i % 3 === 1 ? 1 : 0,
        ),
        rotations: Array.from({ length: Math.round(submitted.duration * 3600) }, (_, i) =>
          i % 4 === 3 ? 1 : 0,
        ),
      },
    }),
  );
  await page.route('**/api/video/calibrate', (route) =>
    route.fulfill({
      json: { fovX: 58, fovY: 36, focalX: 0.9, focalY: 1.5, source: 'moge-2-vits' },
    }),
  );
  await page.route('**/api/video/pro-frame', (route) => {
    proCalls++;
    // A lost capture connection must reconnect and reach review with the same frame.
    if (proCalls === 1) return route.abort('connectionreset');
    return route.fulfill({
      json: { keypoints3d: Array(210).fill(0), keypoints2d: Array(140).fill(0.5), score: 0.1 },
    });
  });
  await page.goto('/app');
  await expect(page.getByRole('tab', { name: 'Video to emote' })).toHaveCount(0);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New project', exact: true });
  await create.getByLabel('Project name').fill('Video review test');
  await create.getByLabel('Workflow').selectOption('video');
  await create.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('button', { name: 'Use default avatar instead', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Text to emote' })).toHaveCount(0);
  await expect(page.locator('.project-name span')).toHaveText('Video to emote');
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { useStudio } = await import(path);
    const p = useStudio.getState().project;
    useStudio
      .getState()
      .change({ rootMotion: 'inPlace', controls: { ...p.controls, ground: true } });
  });
  await expect(page.locator('.loading-overlay')).toBeHidden();
  // A tiny local video gives the real decoder/seek/review UI frames. Only inference is mocked.
  // Canvas capture can produce an empty WebM under headless GPU contention.
  // A real, deterministic H.264 fixture exercises the same upload/decode pipeline.
  const encoded = spawnSync(
    process.env.FFMPEG_PATH || 'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x240:rate=30',
      '-t',
      '2.2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '1',
      '-movflags',
      'frag_keyframe+empty_moov',
      '-f',
      'mp4',
      'pipe:1',
    ],
    { windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
  );
  expect(encoded.status, encoded.stderr?.toString()).toBe(0);
  let referenceBytes: Buffer = encoded.stdout;
  await page.route('**/api/jobs/' + videoJob + '/reference-video', (route) => {
    if (route.request().method() === 'POST') {
      referenceBytes = route.request().postDataBuffer()!;
      return route.fulfill({ json: { ok: true } });
    }
    const match = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    const start = match ? Number(match[1]) : 0,
      end = match?.[2] ? Number(match[2]) : referenceBytes.length - 1;
    return route.fulfill({
      status: match ? 206 : 200,
      contentType: 'video/mp4',
      headers: {
        'Accept-Ranges': 'bytes',
        ...(match ? { 'Content-Range': `bytes ${start}-${end}/${referenceBytes.length}` } : {}),
      },
      body: referenceBytes.subarray(start, end + 1),
    });
  });
  await page
    .locator('.video-panel input[type=file]')
    .setInputFiles({ name: 'dance.mp4', mimeType: 'video/mp4', buffer: encoded.stdout });
  await expect(page.getByRole('dialog', { name: 'Prepare your video' })).toBeVisible();
  await expect(page.getByLabel('Workflow', { exact: true })).toHaveCount(0);
  await page.getByLabel('Capture duration').fill('2');
  await expect
    .poll(
      async () =>
        page.locator('video').evaluate((video: HTMLVideoElement) => ({
          ready: video.readyState >= 1,
          error: video.error?.message ?? null,
        })),
      { timeout: 10000 },
    )
    .toEqual({ ready: true, error: null });
  await page.getByLabel('Video start').fill('0.1');
  await page.getByRole('button', { name: 'Analyze tracking' }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept and generate' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('dialog', { name: 'Review movement' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play video', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  await expect(page.getByLabel('Tracking frame')).toHaveValue('1');
  await page.getByRole('button', { name: 'Go to start', exact: true }).click();
  await expect(page.getByLabel('Editable captured movement')).toBeVisible();
  await page.getByLabel('Show points').uncheck();
  await expect(page.getByLabel('Editable tracking overlay')).toBeHidden();
  await expect(page.getByLabel('Editable captured movement')).toBeVisible();
  await page.getByLabel('Show points').check();
  // Editing in the independent capture view must use the contained video frame,
  // not the canvas margins. Its corresponding video point should turn blue.
  const captureCanvas = page.getByLabel('Editable captured movement');
  const bounds = (await captureCanvas.boundingBox())!;
  const fitScale = Math.min(bounds.width / 160, bounds.height / 240);
  const fitWidth = 160 * fitScale,
    fitHeight = 240 * fitScale;
  const x = bounds.x + (bounds.width - fitWidth) / 2 + (0.5 + body[11][0] * 0.4) * fitWidth;
  const y = bounds.y + (bounds.height - fitHeight) / 2 + (0.42 + body[11][1] * 0.4) * fitHeight;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y + 10, { steps: 3 });
  await page.mouse.up();
  await page.getByText('Apply to nearby frames', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Backward', exact: false })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Undo correction', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reset point', exact: true }).click();
  await page.getByRole('button', { name: 'Undo correction', exact: true }).click();
  const stage = (await page.locator('.tracking-video.capture-stage').boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.wheel(0, -Math.log(2) / 0.002);
  await expect(page.locator('.review-mouse-hint')).toContainText('200%');
  const zoomBounds = (await page.getByLabel('Editable tracking overlay').boundingBox())!;
  expect(zoomBounds.width).toBeCloseTo((stage.width - 2) * 2, 0);
  const panX = stage.x + stage.width / 2,
    panY = stage.y + stage.height - 40;
  await page.mouse.move(panX, panY);
  await page.mouse.down();
  await page.mouse.move(panX + 30, panY + 20);
  await page.mouse.up();
  await expect
    .poll(async () => (await page.getByLabel('Editable tracking overlay').boundingBox())!.x)
    .toBeCloseTo(zoomBounds.x + 30, 0);
  const movedBounds = (await page.getByLabel('Editable tracking overlay').boundingBox())!;
  const zoomFit = Math.min(movedBounds.width / 160, movedBounds.height / 240);
  const zx =
    movedBounds.x +
    (movedBounds.width - 160 * zoomFit) / 2 +
    (0.5 + body[11][0] * 0.4 + 10 / fitWidth) * 160 * zoomFit;
  const zy =
    movedBounds.y +
    (movedBounds.height - 240 * zoomFit) / 2 +
    (0.42 + body[11][1] * 0.4 + 10 / fitHeight) * 240 * zoomFit;
  await page.mouse.move(zx, zy);
  await page.mouse.down();
  await page.mouse.move(zx + 5, zy + 5, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Reset point', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'data/validation/review-video-zoom.png' });
  await page.locator('.tracking-video.capture-stage').dblclick({ position: { x: 20, y: 20 } });
  await expect(page.locator('.review-mouse-hint')).toContainText('100%');
  await page.screenshot({ path: 'data/validation/video-review-modal.png' });
  await page.getByRole('button', { name: 'Accept and generate' }).click();
  await expect(page.getByRole('alert')).toContainText('Test inference failed');
  await expect(page.getByRole('button', { name: 'Accept and generate' })).toBeEnabled();
  expect(submitted.videoReference.metadata.poseStride).toBe(10);
  expect(submitted.rootMotion).toBe('source');
  expect(submitted.videoReference.metadata.handSolver.model).toBe('SOMAHand-PCA-v1');
  expect(submitted.duration).toBe(2);
  expect(submitted.videoReference.raw.times.at(-1)).toBeCloseTo(59 / 30);
  await page.getByRole('button', { name: 'Accept and generate' }).click();
  await expect(page.getByRole('dialog', { name: 'Review movement' })).toBeHidden({
    timeout: 30000,
  });
  const layers = await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { useStudio } = await import(path);
    const p = useStudio.getState().project;
    return {
      workflow: p.workflow,
      rootMotion: p.rootMotion,
      ground: p.controls.ground,
      tracks: p.timeline.tracks,
      strips: p.timeline.strips,
      assets: p.timeline.assets,
    };
  });
  expect(layers.workflow).toBe('video');
  expect(layers.rootMotion).toBe('source');
  expect(layers.ground).toBe(false);
  expect(layers.tracks.map((t: any) => t.kind)).toEqual(['body', 'hands']);
  expect(layers.strips.map((s: any) => s.start)).toEqual([0, 0]);
  expect(layers.assets[1].handReference.metadata.poseStride).toBe(10);
  await expect(page.getByRole('dialog', { name: 'Review movement' })).toBeHidden();
  await expect(page.getByLabel('Movement smoothness', { exact: true })).toBeVisible();
  await page.getByLabel('Hand smoothness', { exact: true }).fill('0.65');
  await page.getByLabel('Movement smoothness', { exact: true }).fill('0.4');
  expect(
    await page.evaluate(async () => {
      const path = '/src/store.ts';
      const { useStudio } = await import(path);
      return useStudio
        .getState()
        .project.timeline!.assets.map((a: { smoothing: number }) => a.smoothing);
    }),
  ).toEqual([0.4, 0.65]);
  await page.getByRole('button', { name: 'Two cameras', exact: true }).click();
  await page.getByRole('button', { name: 'Reference video', exact: true }).click();
  await expect(page.getByLabel('Timeline reference video')).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { useStudio } = await import(path);
    useStudio.getState().set({ playing: false, time: 0.6 });
  });
  await expect
    .poll(() =>
      page.getByLabel('Timeline reference video').evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(0.6, 1);
  await page.screenshot({ path: 'data/validation/video-result-comparison.png' });
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(page.getByLabel('Timeline reference video')).toHaveCount(0);
  await page.getByRole('button', { name: 'One camera', exact: true }).click();
  await page.getByLabel('Capture engine').selectOption('pro');
  await page
    .locator('.video-panel input[type=file]')
    .setInputFiles({ name: 'dance-pro.mp4', mimeType: 'video/mp4', buffer: encoded.stdout });
  await expect(page.getByRole('dialog', { name: 'Prepare your video' })).toBeVisible();
  await page.getByLabel('Capture duration').fill('2');
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
  await page.getByLabel('Capture duration').fill('2');
  await page.getByRole('button', { name: 'Analyze tracking' }).click();
  await expect(page.getByRole('button', { name: 'Accept and generate' })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Accept and generate' }).click();
  await expect(page.getByRole('dialog', { name: 'Review movement' })).toBeHidden({
    timeout: 30000,
  });
  expect(submitted.duration).toBe(2);
  expect(proCalls).toBeGreaterThan(1);
  expect(preparedStatuses).toEqual([200, 200]);
  expect(submissions).toBe(3);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Export emote', exact: true }).click();
  const bytesOut = await readFile((await (await downloaded).path())!);
  const validation = await validateBytes(new Uint8Array(bytesOut));
  expect(validation.issues.numErrors).toBe(0);
  const gltf = JSON.parse(bytesOut.subarray(20, 20 + bytesOut.readUInt32LE(12)).toString());
  expect(gltf.skins[0].joints).toHaveLength(62);
  expect(gltf.animations).toHaveLength(1);
  expect(
    gltf.animations[0].channels.some((c: any) =>
      gltf.nodes[c.target.node].name.includes('HandIndex'),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  // One missing ankle used to look acceptable and fail only on the paid worker.
  await page.evaluate(() => {
    (window as any).__badTracking = true;
  });
  points[15][3] = 0;
  await page.getByLabel('Capture engine').selectOption('fast');
  await page.locator('.video-panel input[type=file]').setInputFiles({
    name: 'missing-ankle.mp4',
    mimeType: 'video/mp4',
    buffer: encoded.stdout,
  });
  await page.getByLabel('Capture duration').fill('2');
  await expect(page.getByRole('button', { name: 'Analyze tracking' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analyze tracking' }).click();
  await expect(page.getByRole('button', { name: 'Show tracking issue' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('alert')).toContainText(/0.00 s.*left ankle/);
  await expect(page.getByRole('button', { name: 'Accept and generate' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  await page.getByRole('button', { name: 'Show tracking issue' }).click();
  await expect(page.getByLabel('Tracking frame')).toHaveValue('0');
  expect(submissions).toBe(3);
  await page.screenshot({ path: 'data/validation/video-preflight-blocked.png' });
  // Reanalysis with valid tracking enables generation, without sending it automatically.
  await page.getByRole('button', { name: 'Edit clip', exact: true }).click();
  await page.evaluate(() => {
    (window as any).__badTracking = false;
  });
  points[15][3] = 1;
  await page.getByRole('button', { name: 'Analyze tracking' }).click();
  await expect(page.getByRole('button', { name: 'Accept and generate' })).toBeEnabled({
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: 'Show tracking issue' })).toHaveCount(0);
  expect(submissions).toBe(3);
  expect(errors).toEqual([]);
});
