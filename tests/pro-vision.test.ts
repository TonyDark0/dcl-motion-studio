import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => mocks);
vi.mock('node:fs', () => ({
  existsSync: () => true,
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: () => ({ size: 0 }),
}));
import { ProVisionWorker } from '../server/pro-vision';
function processStub() {
  const requests: { id: number }[] = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: vi.fn(),
  });
  child.stdin.on('data', (chunk) => requests.push(JSON.parse(String(chunk))));
  mocks.spawn.mockReturnValueOnce(child);
  return {
    child,
    requests,
    respond: (result: unknown) =>
      child.stdout.write(JSON.stringify({ id: requests.at(-1)!.id, ok: true, result }) + '\n'),
  };
}
beforeEach(() => mocks.spawn.mockReset());
afterEach(() => vi.useRealTimers());
describe('Pro worker recovery', () => {
  it('rejects invalid numeric JSON immediately instead of leaving a request hanging for five minutes', async () => {
    const process = processStub(),
      worker = new ProVisionWorker('fixture');
    const result = worker.request({ op: 'sam' });
    const rejected = expect(result).rejects.toThrow('invalid JSON');
    process.child.stdout.write(
      `{"id":${process.requests[0].id},"ok":true,"result":{"score":NaN}}\n`,
    );
    await rejected;
    expect(process.child.kill).toHaveBeenCalled();
    expect(worker.child).toBeNull();
  });
  it('does not let the exit of an old worker cancel a successful replacement', async () => {
    const old = processStub(),
      worker = new ProVisionWorker('fixture');
    const pending = worker.request({ op: 'sam' });
    const rejected = expect(pending).rejects.toThrow('stopped');
    worker.stop();
    await rejected;
    const fresh = processStub(),
      result = worker.request({ op: 'sam' });
    old.child.emit('exit', 1, null);
    fresh.respond({ score: 0.9 });
    await expect(result).resolves.toEqual({ score: 0.9 });
    expect(worker.child).toBe(fresh.child);
    worker.stop();
  });
  it('reports startup failures and preserves crash diagnostics', async () => {
    const process = processStub(),
      worker = new ProVisionWorker('fixture');
    const result = worker.request({ op: 'sam' });
    const rejected = expect(result).rejects.toThrow('CUDA out of memory');
    process.child.stderr.write('CUDA out of memory');
    process.child.emit('exit', 1, null);
    await rejected;
    const fresh = processStub(),
      failed = worker.request({ op: 'sam' });
    const spawnFailure = expect(failed).rejects.toThrow('could not start');
    fresh.child.emit('error', Error('ENOENT'));
    await spawnFailure;
  });
  it('kills a timed out process so it cannot block following frames', async () => {
    vi.useFakeTimers();
    const process = processStub(),
      worker = new ProVisionWorker('fixture');
    const result = worker.request({ op: 'sam' }, 10);
    const rejected = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(11);
    await rejected;
    expect(process.child.kill).toHaveBeenCalled();
    expect(worker.child).toBeNull();
  });
});
