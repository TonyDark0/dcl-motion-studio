// Opt-in smoke check against the configured local native Kimodo engine.
// Uses synthetic reviewed landmarks; it does not measure video-tracker accuracy.
import { videoReference } from '../tests/fixtures/video-reference.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { Quaternion, Vector3 } from 'three';
const request = { prompt: 'A person raises an arm and returns to the initial pose.', duration: 2,
  seed: 74193, steps: 15, rootMotion: 'source', videoReference: videoReference() };
if (process.argv.includes('--world-motion')) {
  request.videoReference.metadata.trajectoryVersion = 'camera-root-v2';
  for (let f = 0; f < 60; f++) {
    const phase = f / 59 * Math.PI * 2;
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.2 + phase);
    for (let j = 0; j < 33; j++) new Vector3().fromArray(request.videoReference.positions, f * 99 + j * 3)
      .applyQuaternion(rotation).toArray(request.videoReference.positions, f * 99 + j * 3);
    request.videoReference.trajectory!.splice(f * 3, 3, .3 * Math.sin(phase), .35 * Math.sin(phase / 2), .3 * (Math.cos(phase) - 1));
  }
  request.prompt = 'A person turns around while jumping, following a curved path.';
}
const base = 'http://127.0.0.1:8787/api/jobs';
const result = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
const job = await result.json() as { id: string };
if (!result.ok) throw Error(JSON.stringify(job));
console.log('Native video-conditioned validation started:', job.id);
for (;;) {
  const status = await (await fetch(base + '/' + job.id)).json() as { status: string };
  if (status.status === 'completed') {
    const motion = await (await fetch(base + '/' + job.id + '/motion')).json() as any;
    const directory = 'data/validation/video-hybrid-' + job.id;
    await mkdir(directory, { recursive: true });
    await writeFile(directory + '/motion.json', JSON.stringify(motion));
    await writeFile(directory + '/capture.json', JSON.stringify(request.videoReference));
    console.log(JSON.stringify({ directory, frames: motion.frames, generation: motion.generation,
      finite: motion.rotations.every(Number.isFinite) }));
    if (process.argv.includes('--world-motion')) {
      const pathError = Math.max(...motion.roots.filter((_:number, i:number) => i % 3 !== 1)
        .map((v:number, i:number) => Math.abs(v - request.videoReference.trajectory![Math.floor(i / 2) * 3 + (i % 2 ? 2 : 0)])));
      const lift = motion.roots[30 * 3 + 1] - motion.roots[1];
      if (pathError > 1e-5 || lift < .34 || motion.generation?.video?.rootSpace !== 'camera-y-up-v2')
        throw Error(`Source motion validation failed: path=${pathError}, lift=${lift}`);
      console.log(JSON.stringify({ pathError, lift, rootSpace: motion.generation.video.rootSpace }));
    }
    await fetch(base + '/' + job.id, { method: 'DELETE' });
    break;
  }
  if (status.status !== 'running') throw Error(JSON.stringify(status));
  await new Promise(resolve => setTimeout(resolve, 3000));
}
