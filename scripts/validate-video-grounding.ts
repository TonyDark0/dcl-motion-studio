import {readFile,writeFile} from 'node:fs/promises';
import {postprocessVideoMotion} from '../server/video-postprocess';
import {refilterCapture,captureSchema} from '../src/video-motion';
import {dclReferenceRig} from '../server/dcl-reference-rig';
import {world} from '../src/rig';
import {videoPoseConstraints} from '../server/video-pose-constraints';
import type {Motion} from '../src/motion';
for(const mode of ['fast','pro']) {
 const folder=`data/validation/infill-${mode}/`;
 const capture=refilterCapture(captureSchema.parse(JSON.parse(await readFile(folder+'capture.json','utf8'))),.4);
 const motion:Extract<Motion,{skeleton:'soma30'}>=JSON.parse(await readFile(folder+'motion.json','utf8'));
 const rig=dclReferenceRig();
 const floor=()=>Array.from({length:motion.frames},(_,f)=>{
  rig.reset();rig.retarget(motion,f/30,'source');
  return Math.min(...['LeftFoot','LeftToeBase','RightFoot','RightToeBase'].map(n=>world(rig.bone(n)).y-rig.initial(n).wp.y));
 });
 const before=floor(),constraints=videoPoseConstraints(capture,capture.frames);
 const report=postprocessVideoMotion(motion,capture),after=floor();
 await writeFile(folder+'grounded-motion.json',JSON.stringify(motion));
 await writeFile(folder+'grounded-capture.json',JSON.stringify(capture));
 await writeFile(folder+'floor-check.json',JSON.stringify({report,before,after}));
 console.log(mode,{firstConfidence:Math.min(...[11,12,13,14,15,16,23,24,25,26,27,28].map(j=>capture.confidence[j])),
  refs:constraints[0].frame_indices.length,report,beforeMin:Math.min(...before),beforeMax:Math.max(...before),afterMin:Math.min(...after),afterMax:Math.max(...after)});
}
