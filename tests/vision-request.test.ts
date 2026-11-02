import { afterEach, describe, expect, it, vi } from 'vitest';
import { visionRequest } from '../src/vision-request';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
describe('capture transport recovery', () => {
  it('waits for the lost Pro request to finish before resending that same frame', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response({ pro: { busy: true } }))
      .mockResolvedValueOnce(response({ pro: { busy: false } }))
      .mockResolvedValueOnce(response({ score: 0.95 }));
    vi.stubGlobal('fetch', fetcher);
    const result = visionRequest('pro-frame', { jpeg: 'same-frame' }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1001);
    await expect(result).resolves.toEqual({ score: 0.95 });
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
      '/api/video/pro-frame',
      '/api/video/status',
      '/api/video/status',
      '/api/video/pro-frame',
    ]);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[3][1].body);
    expect(fetcher.mock.calls[0][1].headers['X-Capture-Request']).toBe(
      fetcher.mock.calls[3][1].headers['X-Capture-Request'],
    );
  });
  it('keeps model errors instead of retrying resource-heavy inference unnecessarily', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ error: 'Camera calibration failed: CUDA out of memory' }, 502));
    vi.stubGlobal('fetch', fetcher);
    await expect(visionRequest('calibrate', {}, new AbortController().signal)).rejects.toThrow(
      'CUDA out of memory',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('recovers a connection lost while reading the response body', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ text: () => Promise.reject(new TypeError('network error')) })
      .mockResolvedValueOnce(response({ busy: false }))
      .mockResolvedValueOnce(response({ points: [1, 2, 3] }));
    vi.stubGlobal('fetch', fetcher);
    const result = visionRequest('frame', { rgb: 'same-frame' }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(501);
    await expect(result).resolves.toEqual({ points: [1, 2, 3] });
    expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[0][1].body);
  });
  it('reports an offline service without continuously resending frames', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetcher);
    const result = visionRequest('pro-frame', {}, new AbortController().signal);
    const failed = expect(result).rejects.toThrow('service is unreachable');
    await vi.advanceTimersByTimeAsync(3001);
    await failed;
    expect(fetcher.mock.calls.filter((c) => c[0] === '/api/video/pro-frame')).toHaveLength(1);
  });
  it('cancels a reconnect without resubmitting another frame', async () => {
    vi.useFakeTimers();
    const abort = new AbortController(),
      fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetcher);
    const result = visionRequest('pro-frame', {}, abort.signal);
    const cancelled = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1);
    abort.abort();
    await cancelled;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
