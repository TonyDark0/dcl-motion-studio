import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateFromVideo } from '../src/video-generation';
import { videoReference } from './fixtures/video-reference';

afterEach(() => vi.unstubAllGlobals());
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
describe('video generation requests', () => {
  it('rejects missing tracking before any network request or paid submission', async () => {
    const capture = videoReference();
    for (let f = 0; f < 20; f++) capture.confidence[f * 33 + 27] = 0;
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      generateFromVideo(capture, 'source', new AbortController().signal),
    ).rejects.toThrow(/0.00 s.*left ankle/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends reviewed data and waits for a compatible constrained Kimodo result', async () => {
    const capture = videoReference();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 'owned-job' }))
      .mockResolvedValueOnce(response({ status: 'completed' }))
      .mockResolvedValueOnce(
        response({
          version: 1,
          skeleton: 'soma30',
          source: 'kimodo.cpp',
          fps: 30,
          frames: 60,
          prompt: 'generated',
          seed: 1,
          roots: Array(180).fill(0),
          rotations: Array.from({ length: 7200 }, (_, i) => (i % 4 === 3 ? 1 : 0)),
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const result = await generateFromVideo(capture, 'source', new AbortController().signal);
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.videoReference).toEqual(JSON.parse(JSON.stringify(capture)));
    expect(request.rootMotion).toBe('source');
    expect(request.duration).toBe(2);
    expect(result.skeleton).toBe('soma30');
    expect(result.prompt).toBe('reference');
  });
  it('surfaces native failure so tracking can be retried without a partial animation', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ id: 'owned-job' }))
        .mockResolvedValueOnce(response({ status: 'failed', error: 'Native inference failed' })),
    );
    await expect(
      generateFromVideo(videoReference(), 'source', new AbortController().signal),
    ).rejects.toThrow('Native inference failed');
  });
  it('cancels only its own native job even when aborted during submission', async () => {
    const abort = new AbortController();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () => {
        abort.abort();
        return response({ id: 'owned-job' });
      })
      .mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    await expect(generateFromVideo(videoReference(), 'source', abort.signal)).rejects.toThrow();
    expect(fetcher.mock.calls[1]).toEqual(['/api/jobs/owned-job/cancel', { method: 'POST' }]);
  });
  it('explains an empty response instead of throwing an opaque JSON syntax error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })));
    await expect(
      generateFromVideo(videoReference(), 'source', new AbortController().signal),
    ).rejects.toThrow('empty response (HTTP 502)');
  });
});
