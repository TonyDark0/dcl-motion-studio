import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

it('setup scripts load project .env from any cwd and preserve existing environment', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'studio-setup-env-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    copyFileSync(
      fileURLToPath(new URL('../scripts/setup-env.mjs', import.meta.url)),
      path.join(root, 'scripts/setup-env.mjs'),
    );
    writeFileSync(
      path.join(root, '.env'),
      'FFMPEG_PATH=C:/custom tools/ffmpeg.exe\nFFPROBE_PATH=C:/custom tools/ffprobe.exe\n',
    );
    writeFileSync(
      path.join(root, 'scripts/check.mjs'),
      "import './setup-env.mjs'; import {spawnSync} from 'node:child_process'; process.stdout.write(spawnSync(process.execPath,['-e','console.log(JSON.stringify([process.env.FFMPEG_PATH,process.env.FFPROBE_PATH]))'],{encoding:'utf8'}).stdout);",
    );
    const env = { ...process.env };
    delete env.FFMPEG_PATH;
    delete env.FFPROBE_PATH;
    const run = () =>
      spawnSync(process.execPath, [path.join(root, 'scripts/check.mjs')], {
        cwd: tmpdir(),
        env,
        encoding: 'utf8',
      });
    const loaded = run();
    expect(loaded.status, loaded.stderr).toBe(0);
    expect(JSON.parse(loaded.stdout)).toEqual([
      'C:/custom tools/ffmpeg.exe',
      'C:/custom tools/ffprobe.exe',
    ]);
    env.FFMPEG_PATH = 'C:/shell/ffmpeg.exe';
    expect(JSON.parse(run().stdout)[0]).toBe('C:/shell/ffmpeg.exe');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
