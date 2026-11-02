import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

export class ProVisionWorker {
  child: ChildProcessWithoutNullStreams | null = null;
  private next = 1;
  private pending = new Map<number, Pending>();
  private diagnostics = '';
  constructor(private root: string) {}

  private python() {
    return (
      process.env.PRO_VISION_PYTHON ||
      path.join(
        this.root,
        'data/runtime/vision/.venv',
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      )
    );
  }

  status() {
    const runtime = path.join(this.root, 'data/runtime/vision');
    const sam = path.join(this.root, 'data/models/vision/sam-3d-body-dinov3');
    const moge = path.join(this.root, 'data/models/vision/moge-2-vits-normal/model.pt');
    return {
      runtime: existsSync(this.python()),
      samAvailable:
        existsSync(path.join(sam, 'model.ckpt')) &&
        existsSync(path.join(sam, 'model_config.yaml')) &&
        existsSync(path.join(sam, 'assets/mhr_model.pt')) &&
        existsSync(path.join(runtime, 'vendor/sam-3d-body')),
      mogeAvailable:
        existsSync(moge) &&
        existsSync(path.join(runtime, 'vendor/MoGe')) &&
        existsSync(path.join(runtime, 'vendor/utils3d-moge')),
      running: !!this.child,
    };
  }

  private start() {
    if (this.child) return;
    const python = this.python();
    if (!existsSync(python))
      throw Error('Pro vision runtime is not installed. Run npm run setup:pro.');
    const child = spawn(
      python,
      [path.join(this.root, 'server/python/pro_vision.py'), '--root', this.root],
      {
        cwd: this.root,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1', HF_HUB_DISABLE_TELEMETRY: '1' },
      },
    );
    this.child = child;
    this.diagnostics = '';
    const fail = (message: string) => {
      if (this.child !== child) return;
      this.child = null;
      const error = Error(
        `${message}${this.diagnostics ? `: ${this.diagnostics.slice(-1600).trim()}` : ''}`,
      );
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      child.kill();
    };
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (this.child !== child) return;
      let response: { id: number; ok: boolean; result?: unknown; error?: string };
      try {
        response = JSON.parse(line);
      } catch {
        fail('Pro vision returned invalid JSON; the worker was restarted');
        return;
      }
      const pending = this.pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      response.ok
        ? pending.resolve(response.result)
        : pending.reject(Error(response.error || 'Pro vision failed'));
    });
    child.stderr.on('data', (chunk) => {
      if (this.child !== child) return;
      this.diagnostics = (this.diagnostics + String(chunk)).slice(-4000);
      // Preserve failure evidence even when the dev terminal is no longer open.
      try {
        const directory = path.join(this.root, 'data/logs');
        mkdirSync(directory, { recursive: true });
        const file = path.join(directory, 'pro-vision.log');
        if (existsSync(file) && statSync(file).size > 2_000_000)
          writeFileSync(file, this.diagnostics);
        else appendFileSync(file, String(chunk));
      } catch {
        /* Diagnostics must not take down inference. */
      }
    });
    child.once('error', (error) => fail(`Pro vision could not start: ${error.message}`));
    child.stdin.on('error', (error) => fail(`Pro vision input failed: ${error.message}`));
    child.once('exit', (code, signal) =>
      fail(`Pro vision stopped (${signal ?? code ?? 'unknown'})`),
    );
  }

  request<T>(body: Record<string, unknown>, timeout = 300_000): Promise<T> {
    this.start();
    const id = this.next++,
      child = this.child!;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('Pro vision timed out; retrying requires a fresh worker'));
        if (this.child === child) this.stop();
      }, timeout);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      child.stdin.write(`${JSON.stringify({ ...body, id })}\n`, (error) => {
        if (error && this.pending.has(id)) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  stop() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(Error('Pro vision stopped'));
    }
    this.pending.clear();
    child.kill();
  }
}
