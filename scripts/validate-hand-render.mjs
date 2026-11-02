import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const mode = process.argv.includes('--pro') ? 'pro' : 'fast';
const motion = JSON.parse(await readFile(`data/validation/infill-${mode}/capture.json`,'utf8'));
const body = JSON.parse(await readFile(`data/validation/infill-${mode}/motion.json`,'utf8'));
const browser = await chromium.launch({channel:'msedge',headless:true});
const page = await browser.newPage({viewport:{width:1400,height:840}});
try {
  await page.goto('http://127.0.0.1:5173');
  await page.evaluate(async ({motion,mode,body})=>{
    const T=await import('/node_modules/.vite/deps/three.js');
    const {GLTFLoader}=await import('/node_modules/.vite/deps/three_addons_loaders_GLTFLoader__js.js');
    const {AvatarRig,world}=await import('/src/rig.ts');
    document.body.innerHTML='';
    document.body.style.cssText='margin:0;background:#252529;color:white;display:grid;grid-template-columns:repeat(4,1fr);font:14px sans-serif';
    for (const side of ['Left','Right']) for(const time of [0,1,1.98,4]) {
      const cell=document.createElement('div'); cell.style.cssText='width:350px;height:420px;text-align:center';
      const label=document.createElement('div');label.textContent=`${mode} · ${side} · ${time}s`;cell.append(label);document.body.append(cell);
      const scene=new T.Scene();scene.background=new T.Color('#252529');
      const model=(await new GLTFLoader().loadAsync('/assets/Avatar.glb')).scene;
      scene.add(model);const rig=new AvatarRig(model);rig.retarget(body,time,'source');rig.applyHandReference(motion,time,1);
      const light=new T.DirectionalLight(0xffffff,3);light.position.set(0,3,4);scene.add(light,new T.AmbientLight(0xffffff,1.5));
      const center=world(rig.bone(side+'HandMiddle2'));
      const camera=new T.PerspectiveCamera(36,350/390,.001,10);
      camera.position.copy(center).add(new T.Vector3(side==='Left'?.06:-.06,-.12,.32));camera.lookAt(center);
      const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(350,390);renderer.setPixelRatio(1);cell.append(renderer.domElement);
      renderer.render(scene,camera);
    }
  },{motion,mode,body});
  await page.screenshot({path:`data/validation/hands-${mode}.png`});
  console.log(`Rendered data/validation/hands-${mode}.png`);
} finally {await browser.close();}
