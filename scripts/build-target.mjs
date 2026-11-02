import { spawnSync } from 'node:child_process';
const target = process.argv[2];
if (target && target !== 'local') throw Error('This distribution supports local builds only.');
for (const args of [
  ['scripts/build-translations.mjs'],
  ['node_modules/typescript/bin/tsc', '--noEmit'],
  ['node_modules/vite/bin/vite.js', 'build', '--configLoader', 'runner', '--outDir', 'dist'],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
