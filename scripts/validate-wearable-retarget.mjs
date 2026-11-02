import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const wallet = '0x6258753765c87901a25dae2505b48e820e723904';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto('http://127.0.0.1:5173/app');
  await page.getByRole('tab', { name: 'Text to emote' }).click();
  await page.locator('.loading-overlay').waitFor({ state: 'hidden' });
  const result = await page.evaluate(async (wallet) => {
    const profile = await (await fetch('/api/avatar/' + wallet)).json();
    const pathFor = (name) =>
      performance
        .getEntriesByType('resource')
        .filter((r) => r.name.includes(name))
        .at(-1)?.name || name;
    const { activeRig: rig } = await import(pathFor('/src/Viewport.tsx'));
    const { loadCustomAvatar } = await import(pathFor('/src/custom-avatar.ts'));
    const preview = await loadCustomAvatar(profile);
    const index = profile.assets.findIndex((a) =>
      a.id.includes('73d3962a90a9942ef0b403bbbddd97cbb84aedb9'),
    );
    const part = preview.root.children[index];
    let mesh;
    part.traverse((o) => {
      if (o.isSkinnedMesh) mesh = o;
    });
    const joints = mesh.skeleton.bones;
    const hips = joints.find((b) => b.userData.dclBoneName === 'Avatar_Hips');
    const arm = joints.find((b) => b.userData.dclBoneName === 'Avatar_LeftArm');
    preview.update(rig);
    const beforeHip = hips.getWorldPosition(rig.bone('Hips').position.clone());
    const beforeArm = arm.getWorldQuaternion(rig.bone('LeftArm').quaternion.clone());
    const sample = () => {
      const count = mesh.geometry.attributes.position.count;
      return Array.from({ length: 128 }, (_, i) =>
        mesh
          .getVertexPosition(Math.floor((i * (count - 1)) / 127), rig.bone('Hips').position.clone())
          .applyMatrix4(mesh.matrixWorld),
      );
    };
    const beforeVertices = sample();
    const sourceHips = rig.bone('Hips'),
      sourceArm = rig.bone('LeftArm');
    const originalP = sourceHips.position.clone(),
      originalQ = sourceArm.quaternion.clone();
    const target = sourceHips.getWorldPosition(originalP.clone());
    target.x += 0.3;
    sourceHips.position.copy(sourceHips.parent.worldToLocal(target));
    sourceArm.quaternion.multiply(
      originalQ.clone().setFromAxisAngle(sourceHips.position.clone().set(0, 0, 1), 0.6),
    );
    rig.model.updateMatrixWorld(true);
    preview.update(rig);
    const afterVertices = sample();
    const output = {
      wallet,
      mesh: mesh.name,
      joints: joints.length,
      loaderHipName: hips.name,
      authoredHipName: hips.userData.dclBoneName,
      hipMovement: hips.getWorldPosition(beforeHip.clone()).distanceTo(beforeHip),
      armRotation: arm
        .getWorldQuaternion(beforeArm.clone())
        .normalize()
        .angleTo(beforeArm.normalize()),
      changedVertices: afterVertices.filter((p, i) => p.distanceTo(beforeVertices[i]) > 0.01)
        .length,
    };
    sourceHips.position.copy(originalP);
    sourceArm.quaternion.copy(originalQ);
    rig.model.updateMatrixWorld(true);
    preview.dispose();
    return output;
  }, wallet);
  assert.equal(result.joints, 62);
  assert.ok(Math.abs(result.hipMovement - 0.3) < 1e-5, JSON.stringify(result));
  assert.ok(Math.abs(result.armRotation - 0.6) < 1e-5, JSON.stringify(result));
  assert.ok(result.changedVertices > 100, JSON.stringify(result));
  writeFileSync('data/validation/tracksuit-retarget-check.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
