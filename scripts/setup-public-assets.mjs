import './setup-env.mjs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = new URL('../public/models/pose_landmarker_full.task', import.meta.url);
const expected = '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
try {
  if (digest(await readFile(target)) === expected) {
    console.log('MediaPipe pose model already verified.');
    process.exit(0);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
console.log('Downloading MediaPipe Pose Landmarker Full. Review its model terms before use.');
const response = await fetch(
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
);
if (!response.ok) throw Error(`Download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (digest(bytes) !== expected) throw Error('Model SHA-256 mismatch; no file installed.');
await mkdir(new URL('../public/models/', import.meta.url), { recursive: true });
const temporary = `${fileURLToPath(target)}.download`;
await writeFile(temporary, bytes);
await rename(temporary, target);
console.log('MediaPipe pose model installed and verified.');
