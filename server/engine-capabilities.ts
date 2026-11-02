import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export type ConstraintCapability = {
  status: 'ready' | 'unsupported' | 'unavailable' | 'missing';
  detail?: string;
};
const cache = new Map<string, { expires: number; result: Promise<ConstraintCapability> }>();
export function clearCapabilityCache() {
  cache.clear();
}

export async function constraintCapability(
  executable: string,
  force = false,
): Promise<ConstraintCapability> {
  let key: string;
  try {
    const info = await stat(executable);
    if (!info.isFile()) return { status: 'missing' };
    key = `${executable}:${info.mtimeMs}:${info.size}`;
  } catch {
    return { status: 'missing' };
  }
  const existing = cache.get(key);
  if (!force && existing && existing.expires > Date.now()) return existing.result;
  const result = (async (): Promise<ConstraintCapability> => {
    try {
      const { stdout } = await execute(executable, ['--capabilities'], {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 8192,
      });
      try {
        const capabilities = JSON.parse(stdout);
        return {
          status:
            capabilities.constraints === 'soma30-v1' && capabilities.protocol === 'C1'
              ? 'ready'
              : 'unsupported',
        };
      } catch {
        return { status: 'unsupported' };
      }
    } catch (error) {
      const e = error as { code?: string | number; message?: string; stderr?: string };
      // Older kmd-generate prints usage and exits 2 for unknown arguments.
      if (e.code === 2 && /usage:/i.test(e.stderr ?? '')) return { status: 'unsupported' };
      return {
        status: 'unavailable',
        detail: (e.message ?? 'Unable to execute the engine').slice(0, 600),
      };
    }
  })();
  // A failed Windows launch can become valid after approval without a file change.
  // Expiring failures also prevents an old negative probe from disabling loops forever.
  if (cache.size > 32) cache.clear();
  cache.set(key, { expires: Date.now() + 30000, result });
  return result;
}

export async function supportsConstraints(executable: string) {
  return (await constraintCapability(executable)).status === 'ready';
}
