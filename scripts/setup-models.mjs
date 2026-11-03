import './setup-env.mjs';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (
  spawnSync(process.execPath, [path.join(root, 'scripts/setup-video.mjs')], {
    stdio: 'inherit',
    windowsHide: true,
  }).status !== 0
)
  throw Error('Video tracking requires FFmpeg and FFprobe. Run npm run setup:video.');
const files = [
  {
    target: 'data/models/kimodo/kimodo-soma-rp-v1.1-f32.gguf',
    url: 'https://huggingface.co/LocalAI-io/Kimodo-SOMA-RP-v1.1-GGML/resolve/65f8b8ab34ee7524161cc87b20ae4cb4f5d3a12d/models/kimodo-soma-rp-v1.1-f32.gguf',
    size: 1133166784,
    sha256: '3bf1229f4c1eff1d28f5196a854113da2df9a11a5e21c60694630903bf948ee4',
  },
  {
    target: 'data/models/kimodo/Llama-3-Kimodo-Q4_K_M.gguf',
    url: 'https://huggingface.co/LocalAI-io/Llama-3-Kimodo-GGML/resolve/3e8d958803beaddb6011ac534f2be972e2710c7d/Llama-3-Kimodo-Q4_K_M.gguf',
    size: 5058327904,
    sha256: 'c06f2cb6a7615e949bcbb5b582ad35a191338b68b5a51abe17d259ebe574c005',
  },
  {
    target: 'data/models/kimodo/tokenizer.gguf',
    url: 'https://huggingface.co/LocalAI-io/Llama-3-Kimodo-GGML/resolve/3e8d958803beaddb6011ac534f2be972e2710c7d/tokenizer.gguf',
    size: 7295054,
    sha256: '81614aca62a98846c02b72cc2e5378e5bdce8b4d507b88f96eb1faa90dae607e',
  },
  {
    target: 'data/models/vision/rtmw3d.onnx',
    url: 'https://huggingface.co/Soykaf/RTMW3D-x/resolve/a4f0d54c52ee44ee4e1dda1936d714490c6234d2/onnx/rtmw3d-x_8xb64_cocktail14-384x288-b0a0eab7_20240626.onnx',
    size: 369330857,
    sha256: '4a289c0e99d47eb595e99679d9d4a2d1def1b4241f9adcbafba44b9ff585ebcd',
  },
];

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function install(item) {
  const target = path.join(root, item.target);
  if (
    existsSync(target) &&
    statSync(target).size === item.size &&
    (await digest(target)) === item.sha256
  ) {
    console.log(`OK ${item.target}`);
    return;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  await unlink(partial).catch(() => {});
  console.log(`Descargando ${item.target} (${(item.size / 1024 ** 3).toFixed(2)} GiB)`);
  const response = await fetch(item.url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`${response.status} ${response.statusText}`);
  const hash = createHash('sha256');
  let received = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(partial));
  const actual = hash.digest('hex');
  if (received !== item.size || actual !== item.sha256) {
    await unlink(partial).catch(() => {});
    throw new Error(`Verificación fallida para ${item.target}`);
  }
  await unlink(target).catch(() => {});
  await rename(partial, target);
  console.log(`OK ${item.target}`);
}

for (const item of files) await install(item);
console.log('Modelos instalados y verificados.');
