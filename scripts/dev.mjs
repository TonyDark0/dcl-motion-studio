import { spawn } from 'node:child_process';
const children = [
  spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'server/index.ts'], {
    stdio: 'inherit',
  }),
  spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--configLoader', 'runner'],
    {
      stdio: 'inherit',

    },
  ),
];
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  for (const c of children) c.kill();
  process.exitCode = code;
}
for (const c of children) c.on('exit', (code) => stop(code || 0));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

