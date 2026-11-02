import { test, expect, openEditor } from './workspace-fixture';
import { readFileSync } from 'node:fs';
const examples = JSON.parse(readFileSync('tests/fixtures/text-retarget-keys.json', 'utf8'));

test('text retarget keeps neck/head and floor placement through preview and both GLB exports', async ({
  page,
}) => {
  await page.goto('/app');
  await openEditor(page);
  await page.waitForFunction(async () => {
    const path = '/src/Viewport.tsx';
    return !!(await import(path)).activeRig;
  });
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
    const projectName = await page.getByLabel('Project name', { exact: true }).inputValue();
  const result = await page.evaluate(
    async (sample) => {
      const paths = [
        '/src/store.ts',
        '/src/motion.ts',
        '/src/timeline.ts',
        '/src/rig.ts',
        '/node_modules/three/build/three.module.js',
        '/node_modules/three/examples/jsm/loaders/GLTFLoader.js',
      ];
      const [{ useStudio }, { newProject }, { newTimeline }, { AvatarRig }, T, { GLTFLoader }] =
        await Promise.all(paths.map((p) => import(p)));
      const activeRig = new AvatarRig(
        (await new GLTFLoader().loadAsync('/assets/Avatar.glb')).scene,
      );
      const motion = {
        version: 1,
        skeleton: 'soma30',
        source: 'kimodo.cpp',
        fps: 30,
        frames: 60,
        prompt: 'ground and head regression',
        seed: 1,
        roots: Array.from({ length: 60 }, (_, f) => [
          sample.root[0] + f * 0.003,
          sample.root[1] + (f >= 30 ? 0.4 : 0),
          sample.root[2],
        ]).flat(),
        rotations: Array.from({ length: 60 }, () => sample.rotations).flat(),
      };
      const p = {
        ...newProject(),
        preset: 'motion',
        motion,
        duration: 2,
        rootMotion: 'source',
        handMode: 'none',
      };
      p.timeline = newTimeline(p);
      const names = [
        'Hips',
        'Neck',
        'Head',
        'LeftFoot',
        'RightFoot',
        'LeftToeBase',
        'RightToeBase',
      ];
      const snapshot = (scene: any) =>
        names.map((name) => {
          const bone = scene.getObjectByName('Avatar_' + name);
          return {
            p: bone.getWorldPosition(new T.Vector3()).toArray(),
            q: bone.getWorldQuaternion(new T.Quaternion()).toArray(),
          };
        });
      const times = [0, 0.5, 1, 1.5];
      const expected = times.map((t) => {
        activeRig.evaluate(p, t);
        return snapshot(activeRig.model);
      });
      let positionError = 0,
        rotationError = 0;
      for (const emote of [true, false]) {
        const exported = await activeRig.export(p, emote);
        const gltf = await new GLTFLoader().parseAsync(exported, '');
        const mixer = new T.AnimationMixer(gltf.scene);
        mixer.clipAction(gltf.animations[0]).play();
        times.forEach((t, i) => {
          mixer.setTime(t);
          gltf.scene.updateMatrixWorld(true);
          snapshot(gltf.scene).forEach((pose: any, j: number) => {
            positionError = Math.max(
              positionError,
              new T.Vector3()
                .fromArray(pose.p)
                .distanceTo(new T.Vector3().fromArray(expected[i][j].p)),
            );
            rotationError = Math.max(
              rotationError,
              new T.Quaternion()
                .fromArray(pose.q)
                .normalize()
                .angleTo(new T.Quaternion().fromArray(expected[i][j].q).normalize()),
            );
          });
        });
      }
      activeRig.evaluate(p, 0);
      const clearance = Math.min(
        ...names
          .slice(3)
          .map(
            (n) =>
              activeRig.bone(n).getWorldPosition(new T.Vector3()).y - activeRig.initial(n).wp.y,
          ),
      );
      return {
        positionError,
        rotationError,
        clearance,
          jump: expected[2][0].p[1] - expected[0][0].p[1],
          project: p,
      };
    },
    examples.find((e: any) => e.name === 'sneaking')!.keys[0],
  );
  expect(result.positionError).toBeLessThan(0.00001);
  expect(result.rotationError).toBeLessThan(0.00001);
  expect(Math.abs(result.clearance)).toBeLessThan(0.001);
    expect(result.jump).toBeGreaterThan(0.39);
    const projects = await (await page.request.get('/api/projects')).json();
    const id = projects.find((item: any) => item.name === projectName).id;
    const saved = await page.request.put('/api/projects/' + id, { data: {...result.project, name: projectName} });
    expect(saved.ok()).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Open project: ' + projectName }).click();
    await expect(page.getByRole('button', {name:'Export',exact:true})).toBeEnabled();
  await page.screenshot({ path: 'data/validation/text-grounding-fixed.png' });
});
