import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { smoothPoseKeys } from '../src/timeline-evaluator';
import { type Pose, newTimeline, stripEnd } from '../src/timeline';
import { newProject, projectSchema } from '../src/motion';
import { comparisonAt } from '../src/video-comparison';
import { elapsedLabel } from '../src/video-result';
import { randomUUID } from 'node:crypto';

describe('video result adjustments and comparison', () => {
  it('softens angular noise without changing root travel, jumps, limb lengths, endpoints or the source', () => {
    const poses: Pose[] = [0, 0, 1.2, 0, 0].map(
      (angle, i) =>
        new Map(
          ['Avatar_Hips', 'Avatar_LeftHand'].map((name) => [
            name,
            {
              p: new Vector3(i, i === 2 ? 2 : 0, i),
              q: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle),
            },
          ]),
        ),
    );
    const hands = smoothPoseKeys(poses, 1, true),
      body = smoothPoseKeys(poses, 1, false);
    expect(hands[2].get('Avatar_LeftHand')!.q.angleTo(new Quaternion())).toBeLessThan(1.2);
    expect(hands[2].get('Avatar_Hips')!.q.angleTo(new Quaternion())).toBeCloseTo(1.2);
    expect(body[2].get('Avatar_Hips')!.q.angleTo(new Quaternion())).toBeLessThan(1.2);
    expect(body[2].get('Avatar_LeftHand')!.q.angleTo(new Quaternion())).toBeCloseTo(1.2);
    expect(body.map((p) => p.get('Avatar_Hips')!.p)).toEqual(
      poses.map((p) => p.get('Avatar_Hips')!.p),
    );
    expect(hands[0]).toEqual(poses[0]);
    expect(hands.at(-1)).toEqual(poses.at(-1));
    expect(poses[2].get('Avatar_LeftHand')!.q.angleTo(new Quaternion())).toBeCloseTo(1.2);
    expect(smoothPoseKeys(poses, 0, true)).toBe(poses);
  });
  it('maps a trimmed, moved, repeated, sped-up clip to its private reference and ignores muted layers', () => {
    const project = newProject();
    project.workflow = 'video';
    project.videoResult = {
      generationId: randomUUID(),
      referenceAvailable: true,
      processing: { captureMs: 1000, generationMs: 2000, totalMs: 3000 },
    };
    project.timeline = newTimeline(project);
    const strip = project.timeline.strips[0];
    Object.assign(strip, { start: 2, in: 0.5, out: 1.5, speed: 2, repeat: 2 });
    expect(comparisonAt(project, strip.id, 2.2)?.time).toBeCloseTo(0.9);
    expect(comparisonAt(project, strip.id, 2.6)?.time).toBeCloseTo(0.7);
    expect(comparisonAt(project, strip.id, 1)).toBeNull();
    expect(comparisonAt(project, strip.id, stripEnd(strip) + 0.1)).toBeNull();
    project.timeline.tracks[0].muted = true;
    expect(comparisonAt(project, strip.id, 2.2)).toBeNull();
  });
  it('retains per-source adjustments and processing times across project save/load; legacy projects use zero extra filtering', () => {
    const project = newProject();
    project.smoothing = 0.7;
    project.videoResult = {
      generationId: randomUUID(),
      referenceAvailable: true,
      processing: { captureMs: 60001, generationMs: 1300, totalMs: 61301 },
    };
    project.timeline = newTimeline(project);
    const parsed = projectSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(parsed.timeline!.assets[0].smoothing).toBe(0.7);
    expect(parsed.timeline!.assets[0].videoResult).toEqual(project.videoResult);
    expect(elapsedLabel(61301)).toBe('1:01');
    const { smoothing: _s, videoResult: _v, ...legacy } = newProject();
    expect(projectSchema.parse(legacy).smoothing).toBe(0);
  });
});
