import {readFile} from 'node:fs/promises';
import {Quaternion} from 'three';
import {forwardPose} from '../server/kimodo-constraints';
for(const mode of ['fast','pro']) {
 const root=`data/validation/infill-${mode}/`;
 const motion=JSON.parse(await readFile(root+'motion.json','utf8'));
 const constraints=JSON.parse(await readFile(root+'constraints.json','utf8'));
 const body=constraints.find((c:any)=>c.type==='fullbody');
 const errors:number[]=[];
 for(let i=0;i<body.frame_indices.length;i++) {
  const f=body.frame_indices[i];
  const rot=Array.from({length:30},(_,j)=>{
   const q=new Quaternion().fromArray(motion.rotations,f*120+j*4).normalize();
   if(q.w<0)q.set(-q.x,-q.y,-q.z,-q.w);
   const sin=Math.hypot(q.x,q.y,q.z),a=2*Math.atan2(sin,q.w);
   return sin<1e-8?[0,0,0]:[q.x*a/sin,q.y*a/sin,q.z*a/sin];
  });
  const desired=forwardPose(body.local_joints_rot[i],body.root_positions[i]);
  const actual=forwardPose(rot,motion.roots.slice(f*3,f*3+3));
  for(const j of [13,19,24,28])errors.push(desired.positions[j].distanceTo(actual.positions[j]));
 }
 console.log(mode,{meanEffectorCm:100*errors.reduce((a,b)=>a+b,0)/errors.length,maxEffectorCm:100*Math.max(...errors)});
}
