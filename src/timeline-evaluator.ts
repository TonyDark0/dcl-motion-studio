import { referenceFrames } from './pose-sampling.js';
import { Quaternion, Vector3, MathUtils } from 'three';
import type { AnimationSource, Project, Strip } from './motion.js';
import {
  activeTracks,
  blendPose,
  clonePose,
  FPS,
  includesBone,
  inverseRoot,
  multiplyRoot,
  rootTransform,
  stripTime,
  stripWeight,
  transformRoot,
  type Pose,
  type RootTransform,
} from './timeline.js';

export type CompiledTimeline = { poses: Pose[]; duration: number };
export type SourcePoseCache = WeakMap<AnimationSource, Map<Project['rootMotion'], Pose[]>>;
/** Offline local-space filtering is deterministic when scrubbing or exporting.
 * Reject a single reversed reference, then soften angular noise before interpolation.
 */
export function stabilizeHandKeys(keys: Pose[]) {
  const original = keys.map(clonePose);
  for (let i = 1; i < keys.length - 1; i++)
    for (const [name, bone] of keys[i]) {
      if (!includesBone('hands', name)) continue;
      const before = original[i - 1].get(name)!.q,
        current = original[i].get(name)!.q,
        after = original[i + 1].get(name)!.q;
      const midpoint = before.clone().slerp(after, 0.5);
      const isolated =
        before.angleTo(after) < Math.PI / 4 && current.angleTo(midpoint) > Math.PI / 2;
      bone.q
        .copy(current)
        .slerp(midpoint, isolated ? 1 : 0.25)
        .normalize();
    }
  return keys;
}
export function samplePoses(poses: Pose[], time: number) {
  const f = MathUtils.clamp(time * FPS, 0, poses.length - 1),
    a = Math.floor(f);
  return blendPose(clonePose(poses[a]), poses[Math.min(a + 1, poses.length - 1)], f - a);
}
/** Symmetric rotation filtering: no playback history, root drift or changing limb lengths.
 * Keep the first/last references exact; never modify the stored source poses.
 */
export function smoothPoseKeys(poses: Pose[], strength: number, hands: boolean) {
  if (!(strength > 0)) return poses;
  const result = poses.map(clonePose),
    radius = Math.max(1, Math.ceil(strength * 4));
  for (let i = 1; i < poses.length - 1; i++) {
    const span = Math.min(radius, i, poses.length - 1 - i);
    for (const [name, bone] of result[i]) {
      if (includesBone('hands', name) !== hands) continue;
      let weight = 1;
      const average = poses[i].get(name)!.q.clone();
      for (let step = 1; step <= span; step++) {
        const w = Math.exp((-step * step) / (2 * radius * radius));
        for (const j of [i - step, i + step]) {
          average.slerp(poses[j].get(name)!.q, w / (weight + w));
          weight += w;
        }
      }
      bone.q.slerp(average, strength).normalize();
    }
  }
  return result;
}
export function compileTimeline(
  p: Project,
  rest: Pose,
  source: (asset: AnimationSource, time: number) => Pose,
  cache?: SourcePoseCache,
): CompiledTimeline {
  const tl = p.timeline!;
  const assets = new Map(tl.assets.map((a) => [a.id, a]));
  // Source samples are shared by every linked instance, including repetitions.
  const samples = new Map<string, Pose[]>();
  for (const id of new Set(tl.strips.map((s) => s.assetId))) {
    const a = assets.get(id)!;
    let modes = cache?.get(a);
    if (!modes) {
      modes = new Map();
      cache?.set(a, modes);
    }
    let poses = modes.get(p.rootMotion);
    if (!poses) {
      if (a.handMode === 'reference' && a.handReference?.metadata.poseStride) {
        // Retarget sparse hand references first, then interpolate LOCAL bone rotations.
        // These assets live on Hands layers; the layer mask leaves the Body result intact.
        const frames = referenceFrames(a.handReference.frames, a.handReference.metadata.poseStride);
        const keys = stabilizeHandKeys(frames.map((frame) => source(a, frame / FPS)));
        let left = 0;
        poses = Array.from({ length: Math.ceil(a.duration * FPS) + 1 }, (_, i) => {
          const frame = Math.min(i, frames.at(-1)!);
          while (left < frames.length - 2 && frames[left + 1] < frame) left++;
          const u = (frame - frames[left]) / (frames[left + 1] - frames[left]);
          return blendPose(clonePose(keys[left]), keys[left + 1], u);
        });
      } else {
        poses = Array.from({ length: Math.ceil(a.duration * FPS) + 1 }, (_, i) =>
          source(a, Math.min(i / FPS, a.duration)),
        );
      }
      poses = smoothPoseKeys(poses, a.smoothing || 0, a.handMode === 'reference');
      if (a.motion?.skeleton === 'soma30' && a.motion.generation?.loop)
        closePoseCycle(poses, 0, poses.length - 1, 8 / FPS);
      modes.set(p.rootMotion, poses);
    }
    samples.set(id, poses);
  }
  const at = (s: Strip, time: number) => samplePoses(samples.get(s.assetId)!, time);
  const tracks = activeTracks(tl);
  const alignment = new Map<string, RootTransform>();
  const identity = (): RootTransform => ({ position: new Vector3(), yaw: 0 });
  function stripPose(s: Strip, time: number) {
    const local = stripTime(s, time),
      pose = at(s, local.time);
    {
      const begin = rootTransform(at(s, s.in)),
        end = rootTransform(at(s, s.out));
      const delta = multiplyRoot(end, inverseRoot(begin));
      let repeat = identity();
      for (let i = 0; i < local.cycle; i++) repeat = multiplyRoot(repeat, delta);
      transformRoot(pose, multiplyRoot(alignment.get(s.id) || identity(), repeat));
    }
    return pose;
  }
  for (const track of tracks) {
    let previous: Strip | undefined;
    for (const s of tl.strips
      .filter((s) => s.trackId === track.id && !s.muted)
      .sort((a, b) => a.start - b.start)) {
      if (track.kind === 'hands' || s.blend !== 'replace' || !includesBone(s.mask, 'Avatar_Hips'))
        continue;
      if (previous && s.alignRoot)
        alignment.set(
          s.id,
          multiplyRoot(
            rootTransform(stripPose(previous, s.start)),
            inverseRoot(rootTransform(at(s, s.in))),
          ),
        );
      previous = s;
    }
  }
  const poses: Pose[] = [];
  for (let i = 0; i <= Math.ceil(p.duration * FPS); i++) {
    const time = Math.min(i / FPS, p.duration),
      result = clonePose(rest);
    for (const track of tracks) {
      const strips = tl.strips
        .filter((s) => s.trackId === track.id)
        .map((s) => ({ s, w: stripWeight(s, time) }))
        .filter((x) => x.w > 0);
      const values = strips.map((x) => ({ ...x, pose: stripPose(x.s, time) }));
      // Normalize overlaps within a layer: a crossfade must not pull toward rest.
      for (const [name, bone] of result) {
        const replace = values.filter((x) =>
          track.kind === 'hands'
            ? includesBone('hands', name) && includesBone(x.s.mask, name)
            : x.s.blend === 'replace' && includesBone(x.s.mask, name),
        );
        let weight = 0;
        const mixed = { p: bone.p.clone(), q: bone.q.clone() };
        for (const x of replace) {
          const value = x.pose.get(name)!;
          weight += x.w;
          mixed.q.slerp(value.q, x.w / weight);
          mixed.p.lerp(value.p, x.w / weight);
        }
        if (weight) {
          bone.q.slerp(mixed.q, Math.min(1, weight)).normalize();
          if (name === 'Avatar_Hips') bone.p.lerp(mixed.p, Math.min(1, weight));
        }
      }
      for (const x of values.filter((x) => track.kind !== 'hands' && x.s.blend === 'additive'))
        blendPose(result, x.pose, x.w, x.s.mask, at(x.s, x.s.reference));
    }
    if (p.rootMotion === 'inPlace') {
      const hips = result.get('Avatar_Hips'),
        initial = rest.get('Avatar_Hips');
      if (hips && initial) {
        hips.p.x = initial.p.x;
        hips.p.z = initial.p.z;
      }
    }
    poses.push(result);
  }
  if (tl.seamless)
    closePoseCycle(
      poses,
      Math.round(tl.rangeStart * FPS),
      Math.min(poses.length - 1, Math.round(tl.rangeEnd * FPS)),
      tl.seamDuration,
    );
  return { poses, duration: p.duration };
}

export function closePoseCycle(poses: Pose[], start: number, end: number, seamDuration: number) {
  if (end > start) {
    const first = clonePose(poses[start]),
      next = poses[start + 1];
    const window = Math.min(seamDuration, (end - start) / FPS / 2);
    for (let i = Math.max(start + 1, end - Math.round(window * FPS)); i <= end; i++) {
      const remaining = (end - i) / FPS,
        u = 1 - remaining / window;
      const target = clonePose(first);
      for (const [name, b] of target) {
        const a = first.get(name)!,
          n = next.get(name)!;
        if (name === 'Avatar_Hips') b.p.addScaledVector(n.p.clone().sub(a.p), -remaining * FPS);
        // Match both the boundary pose and its incoming angular velocity.
        const delta = a.q.clone().invert().multiply(n.q).normalize();
        if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
        const angle = 2 * Math.acos(MathUtils.clamp(delta.w, -1, 1));
        const axis = new Vector3(delta.x, delta.y, delta.z);
        if (axis.lengthSq() > 1e-12)
          b.q.multiply(
            new Quaternion().setFromAxisAngle(axis.normalize(), -angle * remaining * FPS),
          );
      }
      blendPose(poses[i], target, MathUtils.smoothstep(u, 0, 1));
    }
  }
}
