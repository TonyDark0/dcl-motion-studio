import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import skeleton from '../src/dcl-reference-skeleton.json';
import { videoPoseConstraints, VideoTrackingError } from '../src/video-pose-constraints';
import { videoPoseConstraints as workerConstraints } from '../server/video-pose-constraints';
import { videoReference } from './fixtures/video-reference';

describe('video preflight matches generation', () => {
  it('uses exactly the worker canonical hierarchy without needing its GLB at runtime', () => {
    const bytes = readFileSync(new URL('../public/assets/Avatar.glb', import.meta.url));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    expect(skeleton).toEqual({
      nodes: gltf.nodes.map((node: Record<string, unknown>) =>
        Object.fromEntries(
          ['name', 'translation', 'rotation', 'scale', 'children']
            .filter((key) => node[key] !== undefined)
            .map((key) => [key, node[key]]),
        ),
      ),
      skins: gltf.skins.map((skin: { joints: number[] }) => ({ joints: skin.joints })),
      scenes: gltf.scenes.map((scene: { nodes: number[] }) => ({ nodes: scene.nodes })),
      scene: gltf.scene ?? 0,
    });
  });
  it.each(['mediapipe+rtmw3d', 'sam3d-hybrid'] as const)(
    'produces identical complete %s constraints in the checker and worker',
    (source) => {
      const capture = videoReference(90, source);
      for (let f = 8; f <= 11; f++) capture.confidence[f * 33 + 27] = 0;
      for (const inPlace of [false, true])
        expect(videoPoseConstraints(capture, capture.frames, inPlace)).toEqual(
          workerConstraints(capture, capture.frames, inPlace),
        );
    },
  );
  it.each([
    { joints: [27], from: 0, to: 20, frame: 0 },
    { joints: [13, 15], from: 25, to: 55, frame: 30 },
  ])(
    'reports unrepaired essential joints and the failing time: $joints',
    ({ joints, from, to, frame }) => {
      const capture = videoReference(90);
      for (let f = from; f < to; f++)
        for (const joint of joints) capture.confidence[f * 33 + joint] = 0;
      for (const validate of [videoPoseConstraints, workerConstraints]) {
        try {
          validate(capture, capture.frames);
          throw Error('Expected rejection');
        } catch (error) {
          expect(error).toBeInstanceOf(VideoTrackingError);
          expect(error).toMatchObject({ frame, joints });
        }
      }
    },
  );
  it('checks geometry too, even when confidence values are high', () => {
    const capture = videoReference();
    capture.positions.fill(0);
    expect(() => videoPoseConstraints(capture, capture.frames)).toThrow(VideoTrackingError);
    expect(() => workerConstraints(capture, capture.frames)).toThrow(VideoTrackingError);
  });
});
