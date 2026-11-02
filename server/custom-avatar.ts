import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import {
  contentHashPattern,
  walletPattern,
  type AvatarAsset,
  type AvatarColor,
  type CustomAvatar,
} from '../src/custom-avatar-types.js';

const peer = 'https://peer.decentraland.org';
const base = 'urn:decentraland:off-chain:base-avatars:';
// Profiles can contain NFT instance URNs; Catalyst entity pointers identify the
// collection item. Keep off-chain and linked-wearable identifiers untouched.
export function wearablePointer(id: string) {
  const match = /^(urn:decentraland:[^:]+:collections-v[12]:[^:]+:[^:]+):[0-9]+$/i.exec(id);
  return (match?.[1] || id).toLowerCase();
}
// Same priority and conflict resolution as unity-shared-dependencies/WearableUtils.
const categoryPriority = [
  'skin',
  'upper_body',
  'hands_wear',
  'lower_body',
  'feet',
  'helmet',
  'hat',
  'top_head',
  'mask',
  'eyewear',
  'earring',
  'tiara',
  'hair',
  'eyebrows',
  'eyes',
  'mouth',
  'facial_hair',
  'body_shape',
];
export function resolveAvatarHiding(assets: AvatarAsset[], forceRender: string[]) {
  const lists = new Map(
    assets.map((a) => [
      a.category,
      new Set([...a.hides, ...a.replaces].filter((c) => c !== a.category)),
    ]),
  );
  for (const category of categoryPriority) {
    const list = lists.get(category);
    if (!list?.size) continue;
    for (const hidden of list) {
      const back = lists.get(hidden);
      if (!back?.size) continue;
      if (!forceRender.includes(hidden)) back.clear();
      else back.delete(category);
    }
  }
  const hidden = new Set<string>();
  for (const list of lists.values())
    for (const category of list) if (!forceRender.includes(category)) hidden.add(category);
  return hidden;
}
type Entity = {
  type: string;
  pointers: string[];
  content: { file: string; hash: string }[];
  metadata: any;
};
type Fetcher = typeof fetch;
async function json(url: string, fetcher: Fetcher, init?: RequestInit) {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(20000) });
  if (!response.ok)
    throw Error(
      response.status === 404
        ? 'No public Decentraland profile was found for this wallet.'
        : 'Decentraland is unavailable. Please try again.',
    );
  return response.json();
}
const color = (v: any, fallback: AvatarColor): AvatarColor =>
  v && ['r', 'g', 'b'].every((k) => Number.isFinite(v[k]))
    ? ([v.r, v.g, v.b].map((n) => Math.max(0, Math.min(1, n))) as AvatarColor)
    : fallback;

export async function resolveCustomAvatar(
  wallet: string,
  fetcher: Fetcher = fetch,
): Promise<CustomAvatar> {
  if (!walletPattern.test(wallet))
    throw Error('Enter a valid wallet address (0x followed by 40 characters).');
  wallet = wallet.toLowerCase();
  const profile = await json(`${peer}/lambdas/profiles/${wallet}`, fetcher);
  const person =
    profile.avatars?.find((a: any) => (a.ethAddress || a.userId || '').toLowerCase() === wallet) ||
    profile.avatars?.[0];
  if (!person?.avatar) throw Error('No public Decentraland profile was found for this wallet.');
  const avatar = person.avatar;
  const female = String(avatar.bodyShape).toLowerCase() === `${base}BaseFemale`.toLowerCase();
  const bodyShape = `${base}${female ? 'BaseFemale' : 'BaseMale'}`;
  const defaults = (
    female
      ? ['f_sweater', 'f_jeans', 'bun_shoes', 'f_eyes_00', 'f_eyebrows_00', 'f_mouth_00']
      : [
          'green_hoodie',
          'elegant_blue_trousers',
          'sport_black_shoes',
          'eyes_00',
          'eyebrows_00',
          'mouth_00',
        ]
  ).map((id) => base + id);
  const equipped: string[] = Array.isArray(avatar.wearables)
    ? avatar.wearables
        .filter(
          (id: unknown): id is string =>
            typeof id === 'string' && id.startsWith('urn:decentraland:') && id.length < 300,
        )
        .slice(0, 64)
    : [];
  const pointers = [...new Set([bodyShape, ...defaults, ...equipped].map(wearablePointer))];
  const entities: Entity[] = await json(`${peer}/content/entities/active`, fetcher, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pointers }),
  });
  if (!Array.isArray(entities)) throw Error('Decentraland returned invalid wearable data.');
  const byId = new Map<string, AvatarAsset>();
  for (const entity of entities) {
    const data = entity.metadata?.data;
    const rep = data?.representations?.find((r: any) =>
      r.bodyShapes?.some((s: string) => s.toLowerCase() === bodyShape.toLowerCase()),
    );
    if (entity.type !== 'wearable' || !rep) continue;
    const files = Object.fromEntries(
      (entity.content || [])
        .filter((f) => contentHashPattern.test(f.hash))
        .map((f) => [f.file, `/api/avatar/content/${f.hash}`]),
    );
    if (!files[rep.mainFile]) continue;
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
    const asset: AvatarAsset = {
      id: entity.metadata.id,
      category: data.category,
      mainFile: rep.mainFile,
      files,
      hides: strings(rep.overrideHides?.length ? rep.overrideHides : data.hides),
      replaces: strings(rep.overrideReplaces?.length ? rep.overrideReplaces : data.replaces),
    };
    if (asset.category === 'skin')
      asset.hides.push(
        'eyes',
        'mouth',
        'eyebrows',
        'hair',
        'upper_body',
        'lower_body',
        'feet',
        'hands',
        'hands_wear',
        'head',
        'facial_hair',
      );
    if (
      (asset.category === 'upper_body' || asset.hides.includes('upper_body')) &&
      !strings(data.removesDefaultHiding).includes('hands')
    )
      asset.hides.push('hands');
    for (const id of [...entity.pointers, entity.metadata.id])
      if (id) byId.set(wearablePointer(id), asset);
  }
  const body = byId.get(bodyShape.toLowerCase());
  if (!body) throw Error('Could not load the Decentraland body shape. Please try again.');
  const selected = new Map<string, AvatarAsset>();
  for (const id of [...defaults, ...equipped]) {
    const asset = byId.get(wearablePointer(id));
    if (asset && asset.category !== 'body_shape') selected.set(asset.category, asset);
  }
  const hidden = resolveAvatarHiding(
    [...selected.values()],
    Array.isArray(avatar.forceRender) ? avatar.forceRender : [],
  );
  if (hidden.has('head'))
    for (const category of ['eyes', 'eyebrows', 'mouth'])
      if (!avatar.forceRender?.includes(category)) hidden.add(category);
  return {
    wallet,
    name: String(person.name || 'Custom avatar').slice(0, 100),
    bodyShape,
    skin: color(avatar.skin?.color, [0.8, 0.6, 0.45]),
    hair: color(avatar.hair?.color, [0.2, 0.1, 0.05]),
    eyes: color(avatar.eyes?.color, [0.2, 0.2, 0.2]),
    assets: [body, ...[...selected.values()].filter((a) => !hidden.has(a.category))],
    hidden: [...hidden],
    warnings: equipped
      .filter((id) => !byId.has(wearablePointer(id)))
      .map(() => 'Some equipped wearables are unavailable for this body shape.')
      .slice(0, 1),
  };
}

export function registerCustomAvatar(app: FastifyInstance, directContent = false) {
  app.get('/api/avatar/:wallet', async (req, reply) => {
    const wallet = (req.params as { wallet: string }).wallet;
    if (!walletPattern.test(wallet))
      return reply
        .code(400)
        .send({ error: 'Enter a valid wallet address (0x followed by 40 characters).' });
    try {
      return await resolveCustomAvatar(wallet);
    } catch (error) {
      return reply.code(502).send({ error: (error as Error).message });
    }
  });
  app.get('/api/avatar/content/:hash', async (req, reply) => {
    const hash = (req.params as { hash: string }).hash;
    if (!contentHashPattern.test(hash))
      return reply.code(400).send({ error: 'Invalid content hash.' });
    // Public Catalyst content can exceed a serverless function's response limit.
    if (directContent) return reply.redirect(`${peer}/content/contents/${hash}`);
    const response = await fetch(`${peer}/content/contents/${hash}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok || !response.body)
      return reply.code(502).send({ error: 'Could not download a Decentraland wearable.' });
    if (Number(response.headers.get('content-length')) > 50 * 1024 * 1024)
      return reply.code(413).send({ error: 'This wearable is too large to preview.' });
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.type(response.headers.get('content-type') || 'application/octet-stream');
    return reply.send(Readable.fromWeb(response.body as any));
  });
}
