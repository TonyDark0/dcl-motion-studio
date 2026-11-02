import { test, expect, openEditor } from './workspace-fixture';
import { addProceduralTestClip } from './procedural-fixture';
import { newProject } from '../../src/motion';
import { randomUUID } from 'node:crypto';

async function state(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const path = '/src/store.ts'; const { useStudio } = await import(path);
    const { project, time, playing } = useStudio.getState();
    return { project, time, playing };
  });
}

test('simple fixed controls, compact layers and empty playback', async ({ page }) => {
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await addProceduralTestClip(page, 'wave');
  await addProceduralTestClip(page, 'squat');
  await page.getByRole('button', {name:'Pause',exact:true}).click();
  expect((await state(page)).project.timeline!.strips.every((s: {start: number}) => s.start === 0)).toBe(true);
  expect((await state(page)).project.duration).toBe(4);
  for (const name of ['Clip start','Source in','Source out','Channels','Clip layer','Range start','Range end','Make seamless','Export selected range','Transition curve'])
    await expect(page.getByLabel(name,{exact:true})).toHaveCount(0);
  await expect(page.locator('.nla-clip small')).toHaveCount(0);
  const icons = await page.locator('.layer-buttons').first().locator('button').evaluateAll(nodes => nodes.map(n => Math.round(n.getBoundingClientRect().y)));
  expect(new Set(icons).size).toBe(1);
  await page.getByLabel('Timeline loop',{exact:true}).fill('0.5');
  expect((await state(page)).project.timeline!.seamless).toBe(true);
  await page.getByLabel('Timeline loop',{exact:true}).fill('0');
  expect((await state(page)).project.timeline!.seamless).toBe(false);
  await page.getByLabel('Style',{exact:true}).selectOption('linear');
  expect((await state(page)).project.timeline!.strips.at(-1)!.curve).toBe('linear');
  const top = await page.locator('.timeline-bar').boundingBox();
  const bottom = await page.locator('.timeline-bottom-bar').boundingBox();
  const viewport = await page.locator('.viewport-wrap').boundingBox();
  expect(Math.abs(top!.y-viewport!.y-viewport!.height)).toBeLessThanOrEqual(2);
  for(let i=0;i<8;i++) await page.getByRole('button',{name:'Duplicate',exact:true}).click();
  await page.locator('.nla-scroll').evaluate(el => el.scrollTop=el.scrollHeight);
  expect((await page.locator('.timeline-bar').boundingBox())!.y).toBe(top!.y);
  expect((await page.locator('.timeline-bottom-bar').boundingBox())!.y).toBe(bottom!.y);
  await page.getByRole('button',{name:'Skin',exact:true}).hover();
  await page.screenshot({path:'test-results/emote-timeline-layout.png'});
  await page.getByRole('button',{name:'Play',exact:true}).click();
  for(let i=0;i<10;i++) await page.getByRole('button',{name:'Remove clip',exact:true}).click();
  await expect(page.locator('.nla-clip')).toHaveCount(0);
  expect((await state(page)).playing).toBe(false);
  expect((await state(page)).time).toBe(0);
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeDisabled();
  await page.locator('#editor-workspace').focus(); await page.keyboard.press('Space');
  expect((await state(page)).playing).toBe(false);
});

test('mouse editing can reach ten seconds and cannot cross the limit', async ({ page, request }) => {
  await page.goto('/app');
  await openEditor(page);
  await expect(page.locator('.loading-overlay')).toBeHidden();
  await addProceduralTestClip(page,'wave');
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const clip=page.locator('.nla-clip');
  let box=(await clip.boundingBox())!;
  // Trim the right edge to two seconds using only the editor handles.
  await page.mouse.move(box.x+box.width-3,box.y+box.height/2);
  await page.mouse.down(); await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:10}); await page.mouse.up();
  let data=await state(page); expect(data.project.duration).toBeCloseTo(2,1);
  box=(await clip.boundingBox())!;
  const bounds=(await page.locator('.nla-scroll').boundingBox())!;
  await page.mouse.move(box.x+35,box.y+box.height/2); await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width-3,box.y+box.height/2,{steps:12});
  await expect.poll(async()=>page.locator('.nla-scroll').evaluate(el => el.scrollLeft)).toBeGreaterThan(100);
  // Continue edge scrolling until the strip reaches the ten-second boundary.
  await page.waitForTimeout(2600); await page.mouse.up();
  data=await state(page);
  const s=data.project.timeline!.strips[0];
  expect(s.start).toBeGreaterThan(5);
  expect(s.start+(s.out-s.in)*s.repeat/s.speed).toBeLessThanOrEqual(10.00001);
  await page.getByLabel('Speed',{exact:true}).fill('0.1');
  await page.getByLabel('Repeat clip',{exact:true}).fill('32');
  expect((await state(page)).project.duration).toBeLessThanOrEqual(10);
  const id=randomUUID();
  const response=await request.put('/api/projects/'+id,{data:{...newProject(),duration:11}});
  expect(response.status()).toBe(400);
});
