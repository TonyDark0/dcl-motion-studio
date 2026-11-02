import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const names = ['chic','spotlight','pose_spin','pose_jump','run','walk','jump','idle','fashionista'];
const browser = await chromium.launch({channel:'msedge',headless:true});
const page = await browser.newPage({viewport:{width:1050,height:2160}});
try {
  await page.route('**/__emote_reference/*.glb', async route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!names.some(n => n+'.glb' === name)) throw Error('Unexpected reference file');
    await route.fulfill({contentType:'model/gltf-binary',body:await readFile('data/reference-emotes/'+name)});
  });
  await page.goto('http://127.0.0.1:5173');
  await page.evaluate(async names => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const {GLTFLoader} = await import('/node_modules/.vite/deps/three_addons_loaders_GLTFLoader__js.js');
    document.body.innerHTML='';document.body.style.cssText='margin:0;background:#252529;color:white;font:13px sans-serif;display:grid;grid-template-columns:repeat(3,350px)';
    const renderer = new T.WebGLRenderer({antialias:true});renderer.setSize(350,216);
    for (const name of names) {
      const gltf = await new GLTFLoader().loadAsync('/__emote_reference/'+name+'.glb');
      const scene = new T.Scene();scene.background=new T.Color('#252529');scene.add(gltf.scene);
      scene.add(new T.HemisphereLight(0xffffff,0x888888,2));
      const light = new T.DirectionalLight(0xffffff,2);light.position.set(2,4,3);scene.add(light);
      scene.add(new T.GridHelper(4,20,0x666666,0x444444));
      const mixer = new T.AnimationMixer(gltf.scene), clip = gltf.animations[0];
      const action = mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();
      const camera = new T.PerspectiveCamera(38,350/216,.01,30);camera.position.set(2.4,1.8,4.7);camera.lookAt(0,1.1,0);
      for (const u of [.15,.5,.8]) {
        mixer.setTime(clip.duration*u);renderer.render(scene,camera);
        const cell=document.createElement('div');cell.style.cssText='height:240px;text-align:center';
        const label=document.createElement('div');label.textContent=name+' · '+(clip.duration*u).toFixed(2)+'s';cell.append(label);
        const canvas=document.createElement('canvas');canvas.width=350;canvas.height=216;canvas.getContext('2d').drawImage(renderer.domElement,0,0);cell.append(canvas);document.body.append(cell);
      }
    }
    renderer.dispose();
  },names);
  await page.screenshot({path:'data/reference-emotes/contact-sheet.png',fullPage:true});
} finally {await browser.close();}
