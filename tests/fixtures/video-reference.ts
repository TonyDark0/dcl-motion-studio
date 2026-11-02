import { standingPose } from './image-pose';
import { captureSchema, type Capture } from '../../src/video-motion';

export function videoReference(frames = 60, source: Capture['source'] = 'mediapipe+rtmw3d'): Capture {
  const poses = Array.from({ length: frames }, (_, i) => standingPose(i >= 15 && i < 45));
  return captureSchema.parse({
    version: 2, skeleton: 'dcl-capture', source, fps: 30, frames,
    positions: poses.flatMap(p => p.world.flatMap(([x, y, z]) => [x, -y, -z])),
    confidence: poses.flatMap(p => p.confidence),
    details: Array(frames * 144).fill(0), detailConfidence: Array(frames * 48).fill(0),
    trajectory: poses.flatMap((_, i) => [i / 100, 0, i / 200]),
    raw: { times: [0, (frames - 1) / 30], body: [poses[0], poses.at(-1)!].flatMap(p => p.world.flatMap((v, j) => [...v, p.confidence[j]])), detail: Array(1064).fill(0) },
    metadata: { file: 'reference.mp4', sampleFps: 15, smoothing: .4, warnings: [], providerVersion: 'fixture', poseStride: 10 },
  });
}
