import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { captureSchema, refilterCapture } from '../src/video-motion';
import { videoPoseConstraints } from '../server/video-pose-constraints';
import { KimodoWorker } from '../server/worker';
const root = process.cwd(), worker = new KimodoWorker();
try {
  for (const mode of ['fast','pro']) {
    const capture = refilterCapture(captureSchema.parse(JSON.parse(await readFile(`data/validation/video-${mode}.json`,'utf8'))),0.4);
    const constraints = videoPoseConstraints(capture,capture.frames,false);
    const directory = path.join(root, 'data/validation',`infill-${mode}`);
    await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,'capture.json'),JSON.stringify(capture));
    console.log(mode, 'references',constraints[0].frame_indices);
    if(!process.argv.includes('--generate')) continue;
    const config = JSON.parse(await readFile('data/engine.json','utf8'));
    const motion = await worker.generate(config,{
      prompt:'A person performs a continuous movement following the reference body poses and their timing.',
      frames:capture.frames,seed:42,steps:30,rootMotion:'source',videoReference:capture,
    },directory);
    console.log(mode,'generated',motion.frames,'frames');
  }
} finally {worker.stop();}
