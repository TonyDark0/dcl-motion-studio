import './setup-env.mjs';
import { spawnSync } from 'node:child_process';

function ready() {
  const installed = [
    process.env.FFMPEG_PATH || 'ffmpeg',
    process.env.FFPROBE_PATH || 'ffprobe',
  ].every(
    (binary) =>
      spawnSync(binary, ['-version'], { windowsHide: true, stdio: 'ignore' }).status === 0,
  );
  return (
    installed &&
    spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-encoders'], {
      windowsHide: true,
      encoding: 'utf8',
    }).stdout?.includes('libx264')
  );
}
if (!ready() && process.platform === 'win32') {
  const install = spawnSync(
    'winget',
    [
      'install',
      '--id',
      'Gyan.FFmpeg.Shared',
      '--exact',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ],
    { windowsHide: true, stdio: 'inherit' },
  );
  if (install.status !== 0) process.exitCode = 1;
  console.log('Restart your terminal and the app so they receive the updated PATH.');
} else if (!ready()) {
  console.error(
    'Install FFmpeg including libx264 and FFprobe (Ubuntu/Debian: apt-get update && apt-get install -y ffmpeg), or set FFMPEG_PATH and FFPROBE_PATH.',
  );
  process.exitCode = 1;
} else console.log('FFmpeg and FFprobe are ready for local and server-side video preparation.');
