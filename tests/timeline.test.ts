import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { newProject, projectSchema, timelineSchema } from '../src/motion';
import {
  newTimeline,
  newStrip,
  stripTime,
  stripEnd,
  blendPose,
  clonePose,
  type Pose,
} from '../src/timeline';
import { compileTimeline, samplePoses } from '../src/timeline-evaluator';
import { useStudio } from '../src/store';

const axis = new Vector3(0, 1, 0);
function pose(angle = 0, x = 0): Pose {
  return new Map(
    ['Avatar_Hips', 'Avatar_LeftArm', 'Avatar_LeftHand', 'Avatar_LeftHandIndex1'].map((name) => [
      name,
      {
        p: new Vector3(name === 'Avatar_Hips' ? x : 0.2, 1, 0),
        q: new Quaternion().setFromAxisAngle(axis, angle),
      },
    ]),
  );
}
function project() {
  const p = newProject();
  p.timeline = newTimeline(p);
  return p;
}
describe('Nonlinear animation composition', () => {
  it('reads version 1 projects and rejects broken source references and ranges', () => {
    const old = { ...newProject(), version: 1 } as any;
    delete old.timeline;
    expect(projectSchema.parse(old).version).toBe(2);
    const p = project(),
      tl = p.timeline!;
    expect(
      timelineSchema.safeParse({ ...tl, strips: [{ ...tl.strips[0], assetId: 'missing' }] })
        .success,
    ).toBe(false);
    expect(timelineSchema.safeParse({ ...tl, strips: [{ ...tl.strips[0], out: 5 }] }).success).toBe(
      false,
    );
    expect(timelineSchema.safeParse({ ...tl, rangeStart: 4, rangeEnd: 2 }).success).toBe(false);
  });
  it('maps trimmed, retimed repetitions without losing the final sample', () => {
    const s = { ...project().timeline!.strips[0], start: 3, in: 1, out: 3, speed: 2, repeat: 3 };
    expect(stripEnd(s)).toBe(6);
    expect(stripTime(s, 3.5)).toEqual({ time: 2, cycle: 0 });
    expect(stripTime(s, 4)).toEqual({ time: 1, cycle: 1 });
    expect(stripTime(s, 6)).toEqual({ time: 3, cycle: 2 });
  });
  it('normalizes a crossfade instead of dipping toward the rest pose', () => {
    const p = project(),
      tl = p.timeline!,
      first = tl.assets[0],
      second = { ...first, id: 'second' };
    tl.assets.push(second);
    tl.strips = [
      { ...tl.strips[0], out: 3, fadeOut: 1, curve: 'linear' },
      { ...newStrip(second, tl.tracks[0].id, 2), out: 2, fadeIn: 1, curve: 'linear' },
    ];
    const compiled = compileTimeline(p, pose(), (a) =>
      pose(a.id === first.id ? Math.PI / 2 : Math.PI, 2),
    );
    const result = samplePoses(compiled.poses, 2.5);
    expect(result.get('Avatar_Hips')!.p.x).toBeCloseTo(2);
    expect(
      result
        .get('Avatar_LeftArm')!
        .q.angleTo(new Quaternion().setFromAxisAngle(axis, Math.PI * 0.75)),
    ).toBeLessThan(1e-6);
  });
  it('uses relative quaternion deltas and isolates fingers from wrists', () => {
    const base = pose(0.3),
      ref = pose(0.4),
      value = pose(0.8);
    const result = blendPose(clonePose(base), value, 0.5, 'fingers', ref);
    expect(result.get('Avatar_LeftHand')!.q.angleTo(base.get('Avatar_LeftHand')!.q)).toBeLessThan(
      1e-6,
    );
    expect(
      result.get('Avatar_LeftHandIndex1')!.q.angleTo(new Quaternion().setFromAxisAngle(axis, 0.5)),
    ).toBeLessThan(1e-6);
    expect(
      result.get('Avatar_LeftHandIndex1')!.p.equals(base.get('Avatar_LeftHandIndex1')!.p),
    ).toBe(true);
  });
  it('accumulates root translation and rotation across repetitions', () => {
    const p = project();
    p.rootMotion = 'source';
    p.duration = 4;
    p.timeline!.strips[0] = { ...p.timeline!.strips[0], out: 2, repeat: 2 };
    const compiled = compileTimeline(p, pose(), (_, time) => pose((time * Math.PI) / 4, time));
    const atJoin = samplePoses(compiled.poses, 2).get('Avatar_Hips')!;
    const atEnd = samplePoses(compiled.poses, 4).get('Avatar_Hips')!;
    expect(atJoin.p.x).toBeCloseTo(2);
    expect(atEnd.p.x).toBeCloseTo(2);
    expect(atEnd.p.z).toBeCloseTo(-2);
    expect(atEnd.q.angleTo(new Quaternion().setFromAxisAngle(axis, Math.PI))).toBeLessThan(1e-6);
  });
  it('closes a selected loop range and keeps evaluation independent of seek order', () => {
    const p = project();
    p.timeline!.seamless = true;
    p.timeline!.rangeStart = 1;
    p.timeline!.rangeEnd = 3;
    const compiled = compileTimeline(p, pose(), (_, time) => pose(time / 4, time / 2));
    const first = samplePoses(compiled.poses, 1),
      last = samplePoses(compiled.poses, 3);
    expect(first.get('Avatar_Hips')!.p.distanceTo(last.get('Avatar_Hips')!.p)).toBeLessThan(1e-8);
    expect(first.get('Avatar_LeftArm')!.q.angleTo(last.get('Avatar_LeftArm')!.q)).toBeLessThan(
      1e-6,
    );
    const before = samplePoses(compiled.poses, 2.2);
    samplePoses(compiled.poses, 0.2);
    samplePoses(compiled.poses, 3.9);
    expect(
      samplePoses(compiled.poses, 2.2).get('Avatar_Hips')!.p.equals(before.get('Avatar_Hips')!.p),
    ).toBe(true);
  });
  it('honors solo layers and muted clips', () => {
    const p = project(),
      tl = p.timeline!,
      a = { ...tl.assets[0], id: 'overlay' };
    tl.assets.push(a);
    tl.tracks.push({ id: 'upper', name: 'Upper', muted: false, solo: true, locked: false });
    tl.strips.push({ ...newStrip(a, 'upper'), mask: 'upper' });
    const compiled = compileTimeline(p, pose(), (asset) => pose(asset.id === a.id ? 0.4 : 1.2, 2));
    expect(compiled.poses[0].get('Avatar_Hips')!.p.x).toBe(0);
    expect(
      compiled.poses[0]
        .get('Avatar_LeftArm')!
        .q.angleTo(new Quaternion().setFromAxisAngle(axis, 0.4)),
    ).toBeLessThan(1e-6);
  });
  it('adds accepted sources without erasing clips or timeline corrections', () => {
    useStudio.getState().load(newProject());
    useStudio.getState().control({ pelvis: -0.1 });
    useStudio.getState().key();
    useStudio.getState().change({
      preset: 'wave',
      duration: 4,
      motion: null,
      keyframes: [],
      controls: newProject().controls,
    });
    const p = useStudio.getState().project;
    expect(p.timeline!.strips).toHaveLength(2);
    expect(p.keyframes).toHaveLength(1);
    expect(p.controls.pelvis).toBe(-0.1);
    expect(p.duration).toBeCloseTo(4);
    expect(p.timeline!.strips.every(s => s.start === 0)).toBe(true);
    useStudio.getState().undo();
    expect(useStudio.getState().project.timeline!.strips).toHaveLength(1);
    useStudio.getState().redo();
    expect(useStudio.getState().project.timeline!.strips).toHaveLength(2);
  });
});

describe('Body and hands layers', () => {
  it('defaults new projects to source motion without foot correction', () => {
    expect(newProject().rootMotion).toBe('source');
    expect(newProject().controls.ground).toBe(false);
  });
  it('forces hand replacement without changing the hips or arms, even for imported additive strips', () => {
    const p = project(),
      tl = p.timeline!;
    const handAsset = { ...tl.assets[0], id: 'hands-source' };
    tl.assets.push(handAsset);
    tl.tracks.push({
      id: 'hands',
      name: 'Hands',
      kind: 'hands',
      muted: false,
      solo: false,
      locked: false,
    });
    tl.strips.push({
      ...newStrip(handAsset, 'hands'),
      blend: 'additive',
      mask: 'body',
      influence: 0.5,
    });
    const compiled = compileTimeline(p, pose(), (a) =>
      pose(a.id === handAsset.id ? 1 : 0.2, a.id === handAsset.id ? 9 : 2),
    );
    const frame = compiled.poses[0];
    expect(frame.get('Avatar_Hips')!.p.x).toBeCloseTo(2);
    expect(
      frame.get('Avatar_LeftArm')!.q.angleTo(new Quaternion().setFromAxisAngle(axis, 0.2)),
    ).toBeLessThan(1e-6);
    expect(
      frame.get('Avatar_LeftHandIndex1')!.q.angleTo(new Quaternion().setFromAxisAngle(axis, 0.6)),
    ).toBeLessThan(1e-6);
  });
  it('keeps generated bodies and captured hands on independent layers', () => {
    const p = newProject();
    p.timeline = { ...newTimeline(p), assets: [], strips: [] };
    useStudio.getState().load(p);
    useStudio.getState().change({ preset: 'wave' });
    useStudio.getState().addHands({ handMode: 'procedural', handPoseEnd: 'fist' });
    useStudio.getState().change({ preset: 'squat', handMode: 'none' });
    const tl = useStudio.getState().project.timeline!;
    expect(tl.tracks.map((t) => t.kind)).toEqual(['body', 'hands', 'body']);
    expect(new Set(tl.strips.map((s) => s.trackId)).size).toBe(3);
    expect(tl.strips[1].mask).toBe('hands');
    expect(tl.assets[0].handMode).toBe('none');
    expect(projectSchema.safeParse(useStudio.getState().project).success).toBe(true);
  });
});

it('crossfades sequential body layers without pulling toward rest', () => {
  const p = project(), tl = p.timeline!, first = tl.assets[0];
  const second = { ...first, id: 'second-layer-source' };
  tl.assets.push(second);
  tl.tracks.push({id:'second-layer',name:'Body',kind:'body',muted:false,solo:false,locked:false});
  tl.strips[0].out = 3;
  tl.strips.push({...newStrip(second,'second-layer',2),out:2,fadeIn:1,curve:'linear'});
  const result=samplePoses(compileTimeline(p,pose(),a=>pose(a.id===first.id?Math.PI/2:Math.PI,2)).poses,2.5);
  expect(result.get('Avatar_LeftArm')!.q.angleTo(new Quaternion().setFromAxisAngle(axis,Math.PI*.75))).toBeLessThan(1e-6);
});

it('stops and resets an empty timeline, including keyboard play attempts', () => {
  const p = newProject(); p.timeline = newTimeline(p);
  useStudio.getState().load(p);
  useStudio.getState().set({time:2,playing:true});
  useStudio.getState().change({timeline:{...useStudio.getState().project.timeline!,strips:[]}});
  expect(useStudio.getState().playing).toBe(false);
  expect(useStudio.getState().time).toBe(0);
  useStudio.getState().set({playing:true});
  expect(useStudio.getState().playing).toBe(false);
});
it('limits editing to ten seconds and always uses the complete timeline', () => {
  const p = newProject(); p.timeline = newTimeline(p);
  useStudio.getState().load(p);
  const tl = useStudio.getState().project.timeline!;
  useStudio.getState().change({timeline:{...tl,strips:tl.strips.map(s=>({...s,start:7}))}});
  expect(useStudio.getState().project.duration).toBe(4);
  useStudio.getState().change({timeline:{...tl,rangeStart:1,rangeEnd:2,exportRange:true,strips:tl.strips.map(s=>({...s,start:6,mask:'upper' as const}))}});
  const result=useStudio.getState().project;
  expect(result.duration).toBe(10);
  expect(result.timeline!.rangeStart).toBe(0);
  expect(result.timeline!.rangeEnd).toBe(10);
  expect(result.timeline!.exportRange).toBe(false);
  expect(result.timeline!.strips[0].mask).toBe('body');
});
