import { describe, expect, it, vi } from 'vitest';
import { resolveCustomAvatar, resolveAvatarHiding, wearablePointer } from '../server/custom-avatar';
import { CustomAvatarView, baseMeshCategory } from '../src/custom-avatar';
import { dclReferenceRig } from '../server/dcl-reference-rig';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { Quaternion, Vector3 } from 'three';
import { world, worldRotation } from '../src/rig';

const wallet = '0x' + '1'.repeat(40),
  base = 'urn:decentraland:off-chain:base-avatars:';
const hash = 'baf' + 'a'.repeat(40);
function entity(id: string, category: string, hides: string[] = []) {
  return {
    type: 'wearable',
    pointers: [id.toLowerCase()],
    content: [{ file: 'main.glb', hash }],
    metadata: {
      id,
      data: {
        category,
        hides,
        replaces: [],
        representations: [
          { bodyShapes: [base + 'BaseFemale'], mainFile: 'main.glb', contents: ['main.glb'] },
        ],
      },
    },
  };
}
function fixture(assets: ReturnType<typeof entity>[], forceRender: string[] = []) {
  return vi.fn<typeof fetch>(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes('/profiles/')
            ? {
                avatars: [
                  {
                    name: 'Preview user',
                    ethAddress: wallet,
                    avatar: {
                      bodyShape: base + 'BaseFemale',
                      wearables: assets.map((a) => a.metadata.id),
                      skin: { color: { r: 0.2, g: 0.3, b: 0.4 } },
                      forceRender,
                    },
                  },
                ],
              }
            : [
                entity(base + 'BaseFemale', 'body_shape'),
                entity(base + 'f_sweater', 'upper_body'),
                entity(base + 'f_jeans', 'lower_body'),
                ...assets,
              ],
        ),
        { status: 200 },
      ),
  );
}
describe('wallet avatars remain a separate preview', () => {
  it('resolves NFT instances to item pointers without altering base or linked URNs', async () => {
    const item =
      'urn:decentraland:matic:collections-v2:0x73d3962a90a9942ef0b403bbbddd97cbb84aedb9:0';
    const token = item + ':22';
    expect(wearablePointer(token)).toBe(item);
    expect(
      wearablePointer(item + ':315936875005671560093754083051011296956685286201647333762932932610'),
    ).toBe(item);
    expect(
      wearablePointer('urn:decentraland:ethereum:collections-v1:halloween_2019:witch_hat:7'),
    ).toBe('urn:decentraland:ethereum:collections-v1:halloween_2019:witch_hat');
    expect(wearablePointer(base + 'BaseFemale')).toBe((base + 'BaseFemale').toLowerCase());
    const linked = 'urn:decentraland:off-chain:collections-thirdparty:example:collection:0';
    expect(wearablePointer(linked)).toBe(linked);
    let queried: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).includes('/profiles/'))
        return new Response(
          JSON.stringify({
            avatars: [{ avatar: { bodyShape: base + 'BaseFemale', wearables: [token] } }],
          }),
        );
      queried = JSON.parse(init!.body as string).pointers;
      return new Response(
        JSON.stringify([
          entity(base + 'BaseFemale', 'body_shape'),
          entity(item, 'upper_body', ['lower_body']),
        ]),
      );
    };
    const avatar = await resolveCustomAvatar(wallet, fetcher);
    expect(queried).toContain(item);
    expect(queried).not.toContain(token);
    expect(avatar.assets.some((a) => a.id === item)).toBe(true);
    expect(avatar.hidden).toContain('lower_body');
    expect(avatar.warnings).toEqual([]);
  });
  it('matches native category priority and clears hidden accessories hiding lists', () => {
    const asset = (category: string, hides: string[]) => ({
      id: category,
      category,
      mainFile: '',
      files: {},
      hides,
      replaces: [],
    });
    const hidden = resolveAvatarHiding(
      [asset('top_head', ['mask']), asset('mask', ['top_head', 'hair']), asset('hair', [])],
      [],
    );
    expect([...hidden]).toEqual(['mask']);
    expect(
      resolveAvatarHiding(
        [asset('top_head', ['mask']), asset('mask', ['top_head', 'hair'])],
        ['mask'],
      ).has('hair'),
    ).toBe(true);
  });
  it('empty representation overrides retain global hides and legacy torso hides hands', async () => {
    const top = entity(base + 'top', 'upper_body', ['lower_body']);
    Object.assign(top.metadata.data.representations[0], { overrideHides: [] });
    const old = await resolveCustomAvatar(wallet, fixture([top]));
    expect(old.hidden).toEqual(expect.arrayContaining(['hands', 'lower_body']));
    Object.assign(top.metadata.data, { removesDefaultHiding: ['hands'] });
    const modern = await resolveCustomAvatar(wallet, fixture([top]));
    expect(modern.hidden).not.toContain('hands');
  });
  it('validates wallet syntax before making a network request', async () => {
    const fetcher = fixture([]);
    await expect(resolveCustomAvatar('../../something', fetcher)).rejects.toThrow('valid wallet');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses equipped representations, profile colors and category hiding', async () => {
    const top = entity(base + 'custom_top', 'upper_body', ['lower_body']);
    const profile = await resolveCustomAvatar(wallet, fixture([top]));
    expect(profile.skin).toEqual([0.2, 0.3, 0.4]);
    expect(profile.assets.filter((a) => a.category === 'upper_body').map((a) => a.id)).toEqual([
      top.metadata.id,
    ]);
    expect(profile.assets.some((a) => a.category === 'lower_body')).toBe(false);
    expect(profile.assets[0].files['main.glb']).toBe('/api/avatar/content/' + hash);
    const forced = await resolveCustomAvatar(wallet, fixture([top], ['lower_body']));
    expect(forced.assets.some((a) => a.category === 'lower_body')).toBe(true);
  });
  it('reports unavailable wearables and missing profiles clearly', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes('/profiles/')
              ? {
                  avatars: [
                    { avatar: { bodyShape: base + 'BaseFemale', wearables: [base + 'missing'] } },
                  ],
                }
              : [entity(base + 'BaseFemale', 'body_shape')],
          ),
        ),
    );
    expect((await resolveCustomAvatar(wallet, fetcher)).warnings).toHaveLength(1);
    await expect(
      resolveCustomAvatar(wallet, async () => new Response('{}', { status: 404 })),
    ).rejects.toThrow('No public');
  });
  it('classifies the eight base meshes without hiding unrelated accessories', () => {
    expect(baseMeshCategory('ShapeA_uBody_BaseMesh')).toBe('upper_body');
    expect(baseMeshCategory('ShapeB_Mask_Eyebrows')).toBe('eyebrows');
    expect(baseMeshCategory('ShapeB_Hands_BaseMesh')).toBe('hands');
    expect(baseMeshCategory('Custom_watch')).toBeNull();
  });
  it('transfers world-space turns and root movement without editing the export rig', () => {
    const rig = dclReferenceRig();
    const view = new CustomAvatarView([clone(rig.model)]);
    const previewHips = view.root.getObjectByName('Avatar_Hips')!;
    const previewHand = view.root.getObjectByName('Avatar_LeftHand')!;
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.1);
    rig.bone('Hips').position.x += 0.4;
    worldRotation(rig.bone('Hips'), turn.clone().multiply(rig.initial('Hips').wq));
    worldRotation(
      rig.bone('LeftHand'),
      new Quaternion()
        .setFromAxisAngle(new Vector3(1, 0, 0), 0.3)
        .multiply(rig.bone('LeftHand').getWorldQuaternion(new Quaternion())),
    );
    const hand = rig.bone('LeftHand').quaternion.clone();
    view.update(rig);
    expect(
      previewHips
        .getWorldQuaternion(new Quaternion())
        .normalize()
        .angleTo(rig.bone('Hips').getWorldQuaternion(new Quaternion()).normalize()),
    ).toBeLessThan(1e-6);
    expect(world(previewHips).distanceTo(world(rig.bone('Hips')))).toBeLessThan(1e-6);
    expect(
      previewHand
        .getWorldQuaternion(new Quaternion())
        .normalize()
        .angleTo(rig.bone('LeftHand').getWorldQuaternion(new Quaternion()).normalize()),
    ).toBeLessThan(1e-6);
    expect(rig.bone('LeftHand').quaternion.angleTo(hand)).toBeLessThan(1e-6);
    expect(view.root.parent).toBeNull();
  });
  it('animates actual skin joints when duplicate armatures force loader name suffixes', () => {
    const rig = dclReferenceRig();
    const part = clone(rig.model);
    part.traverse((o) => {
      if (!(o as any).isBone) return;
      o.userData.dclBoneName = o.name;
      o.name += '_1';
    });
    const view = new CustomAvatarView([part]);
    const hips = part.getObjectByName('Avatar_Hips_1')!;
    const hand = part.getObjectByName('Avatar_LeftHand_1')!;
    rig.bone('Hips').position.x += 0.4;
    worldRotation(
      rig.bone('Hips'),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.9).multiply(rig.initial('Hips').wq),
    );
    worldRotation(
      rig.bone('LeftHand'),
      new Quaternion()
        .setFromAxisAngle(new Vector3(1, 0, 0), 0.5)
        .multiply(rig.bone('LeftHand').getWorldQuaternion(new Quaternion())),
    );
    view.update(rig);
    expect(world(hips).distanceTo(world(rig.bone('Hips')))).toBeLessThan(1e-6);
    expect(
      hand
        .getWorldQuaternion(new Quaternion())
        .normalize()
        .angleTo(rig.bone('LeftHand').getWorldQuaternion(new Quaternion()).normalize()),
    ).toBeLessThan(1e-6);
  });
});
