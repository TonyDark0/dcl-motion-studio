import { Quaternion, Vector3, MathUtils } from 'three';
import type { AnimationSource, Project, Strip, TimelineData } from './motion.js';

export const FPS = 30;
export const MAX_TIMELINE_SECONDS = 10;
export const snap = (time: number) => Math.round(time * FPS) / FPS;
export const stripDuration = (s: Strip) => ((s.out - s.in) * s.repeat) / s.speed;
export const stripEnd = (s: Strip) => s.start + stripDuration(s);
export const timelineDuration = (tl: TimelineData) =>
  tl.strips.length ? Math.max(1 / FPS, ...tl.strips.map(stripEnd)) : tl.rangeEnd;
export const sourceFields = [
  'preset',
  'motion',
  'handMode',
  'handPoseStart',
  'handPoseEnd',
  'handReference',
  'handWristInfluence',
  'smoothing',
  'videoResult',
] as const;
export function sourceFromProject(p: Project): AnimationSource {
  return {
    id: crypto.randomUUID(),
    name:
      p.motion?.skeleton === 'dcl-capture'
        ? p.motion.metadata.file
        : p.motion?.prompt?.slice(0, 60) ||
          { idle: 'Breathing', squat: 'Squat', wave: 'Wave', motion: 'Motion' }[p.preset],
    duration: p.motion ? p.motion.frames / p.motion.fps : p.duration,
    preset: p.preset,
    motion: p.motion,
    handMode: p.handMode,
    handPoseStart: p.handPoseStart,
    handPoseEnd: p.handPoseEnd,
    handReference: p.handReference,
    handWristInfluence: p.handWristInfluence,
    smoothing: p.smoothing,
    videoResult: p.videoResult,
  };
}
export function newStrip(asset: AnimationSource, trackId: string, start = 0): Strip {
  return {
    id: crypto.randomUUID(),
    assetId: asset.id,
    trackId,
    start,
    in: 0,
    out: Math.min(asset.duration, Math.max(1 / FPS, MAX_TIMELINE_SECONDS - start)),
    speed: 1,
    repeat: 1,
    influence: 1,
    fadeIn: 0,
    fadeOut: 0,
    curve: 'smooth',
    blend: 'replace',
    mask: 'body',
    reference: 0,
    muted: false,
    alignRoot: true,
  };
}
export function newTimeline(p: Project): TimelineData {
  const asset = sourceFromProject(p),
    trackId = crypto.randomUUID();
  return {
    assets: [asset],
    tracks: [{ id: trackId, name: 'Body', kind: 'body', muted: false, solo: false, locked: false }],
    strips: [newStrip(asset, trackId)],
    loopPlayback: true,
    seamless: p.motion?.skeleton === 'soma30' && !!p.motion.generation?.loop,
    seamDuration: p.motion?.skeleton === 'soma30' && p.motion.generation?.loop ? 8 / FPS : 0.4,
    rangeStart: 0,
    rangeEnd: Math.min(asset.duration, MAX_TIMELINE_SECONDS),
    exportRange: false,
  };
}
// Keep legacy sources intact while bringing their editable clips into the emote workspace.
export function emoteTimeline(tl: TimelineData): TimelineData {
  const strips = tl.strips
    .filter((s) => s.start < MAX_TIMELINE_SECONDS)
    .map((s) => {
      const hands = tl.tracks.find((t) => t.id === s.trackId)?.kind === 'hands';
      const asset = tl.assets.find((a) => a.id === s.assetId);
      const template =
        hands && asset?.handMode === 'procedural' && asset.preset === 'idle' && !asset.motion;
      const out = Math.min(s.out, s.in + ((MAX_TIMELINE_SECONDS - s.start) * s.speed) / s.repeat);
      return {
        ...s,
        out,
        mask: template ? ('fingers' as const) : hands ? ('hands' as const) : ('body' as const),
        blend: hands ? ('replace' as const) : s.blend,
        muted: false,
        alignRoot: true,
      };
    })
    .filter((s) => s.out - s.in >= 1 / FPS - 1e-6);
  const duration = strips.length
    ? Math.max(...strips.map(stripEnd))
    : Math.min(MAX_TIMELINE_SECONDS, tl.rangeEnd);
  return {
    ...tl,
    strips,
    tracks: tl.tracks.filter((t) => strips.some((s) => s.trackId === t.id)),
    assets: tl.assets.filter((a) => strips.some((s) => s.assetId === a.id)),
    rangeStart: 0,
    rangeEnd: duration,
    exportRange: false,
  };
}
export function stripTime(s: Strip, time: number) {
  const span = s.out - s.in;
  const elapsed = MathUtils.clamp((time - s.start) * s.speed, 0, span * s.repeat);
  const cycle = Math.min(s.repeat - 1, Math.floor(elapsed / span));
  return { time: s.in + elapsed - cycle * span, cycle };
}
export function stripWeight(s: Strip, time: number) {
  if (s.muted || time < s.start || time > stripEnd(s) + 1e-7) return 0;
  const ease = (x: number) => (s.curve === 'smooth' ? x * x * (3 - 2 * x) : x);
  const enter = s.fadeIn ? ease(MathUtils.clamp((time - s.start) / s.fadeIn, 0, 1)) : 1;
  const leave = s.fadeOut ? ease(MathUtils.clamp((stripEnd(s) - time) / s.fadeOut, 0, 1)) : 1;
  return s.influence * Math.min(enter, leave);
}
export function includesBone(mask: Strip['mask'], fullName: string) {
  const name = fullName.replace(/^Avatar_/, '');
  const fingers = /Hand(Thumb|Index|Middle|Ring|Pinky)/.test(name);
  switch (mask) {
    case 'body':
      return true;
    case 'fingers':
      return fingers;
    case 'hands':
      return /^(Left|Right)Hand/.test(name);
    case 'wrists':
      return /^(Left|Right)Hand$/.test(name);
    case 'root':
      return name === 'Hips';
    case 'upper':
      return !/Hips|UpLeg|^LeftLeg|^RightLeg|Foot|Toe/.test(name);
    case 'lower':
      return /UpLeg|^LeftLeg|^RightLeg|Foot|Toe/.test(name);
    case 'leftArm':
      return /^Left(Shoulder|Arm|ForeArm|Hand)/.test(name);
    case 'rightArm':
      return /^Right(Shoulder|Arm|ForeArm|Hand)/.test(name);
  }
}
export type BonePose = { p: Vector3; q: Quaternion };
export type Pose = Map<string, BonePose>;
export const clonePose = (pose: Pose): Pose =>
  new Map([...pose].map(([n, x]) => [n, { p: x.p.clone(), q: x.q.clone() }]));
export function blendPose(
  base: Pose,
  value: Pose,
  weight: number,
  mask: Strip['mask'] = 'body',
  reference?: Pose,
) {
  for (const [name, b] of base) {
    if (!includesBone(mask, name)) continue;
    const a = value.get(name)!;
    if (reference) {
      const ref = reference.get(name)!;
      const delta = ref.q.clone().invert().multiply(a.q).normalize();
      b.q.multiply(new Quaternion().slerp(delta, weight)).normalize();
      if (name === 'Avatar_Hips') b.p.addScaledVector(a.p.clone().sub(ref.p), weight);
    } else {
      b.q.slerp(a.q, weight).normalize();
      // Translation of child joints encodes limb length, never blend or scale it.
      if (name === 'Avatar_Hips') b.p.lerp(a.p, weight);
    }
  }
  return base;
}
export function activeTracks(tl: TimelineData) {
  const solo = tl.tracks.some((t) => t.solo);
  return tl.tracks.filter((t) => (solo ? t.solo : !t.muted));
}

// Planar transforms let repeated locomotion accumulate both translation and turn.
export type RootTransform = { position: Vector3; yaw: number };
const yAxis = new Vector3(0, 1, 0);
export function rootTransform(pose: Pose): RootTransform {
  const hips = pose.get('Avatar_Hips')!;
  const forward = new Vector3(0, 0, 1).applyQuaternion(hips.q);
  return { position: new Vector3(hips.p.x, 0, hips.p.z), yaw: Math.atan2(forward.x, forward.z) };
}
export function multiplyRoot(a: RootTransform, b: RootTransform): RootTransform {
  return {
    position: b.position.clone().applyAxisAngle(yAxis, a.yaw).add(a.position),
    yaw: a.yaw + b.yaw,
  };
}
export function inverseRoot(a: RootTransform): RootTransform {
  return { position: a.position.clone().negate().applyAxisAngle(yAxis, -a.yaw), yaw: -a.yaw };
}
export function transformRoot(pose: Pose, transform: RootTransform) {
  const hips = pose.get('Avatar_Hips')!;
  hips.p.applyAxisAngle(yAxis, transform.yaw).add(transform.position);
  hips.q.premultiply(new Quaternion().setFromAxisAngle(yAxis, transform.yaw));
  return pose;
}

export function sourceEnergy(asset: AnimationSource, count = 48): number[] {
  const m = asset.motion;
  if (!m)
    return Array.from({ length: count }, (_, i) =>
      Math.abs(Math.sin((i / count) * Math.PI * (asset.preset === 'wave' ? 4 : 2))),
    );
  const values = Array.from({ length: count }, (_, i) => {
    const f = Math.min(m.frames - 1, Math.floor((i / count) * m.frames));
    if (f === 0) return 0;
    if (m.skeleton === 'soma30') {
      let sum = 0;
      for (let j = 0; j < 30; j++)
        sum += new Quaternion()
          .fromArray(m.rotations, f * 120 + j * 4)
          .angleTo(new Quaternion().fromArray(m.rotations, (f - 1) * 120 + j * 4));
      return sum;
    }
    let sum = 0;
    for (let j = 0; j < 99; j++)
      sum += Math.abs(m.positions[f * 99 + j] - m.positions[(f - 1) * 99 + j]);
    return sum;
  });
  const max = Math.max(0.0001, ...values);
  return values.map((x) => x / max);
}
