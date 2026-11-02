import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { ReviewedImage } from './pose-reference';

export async function captureImagePose(file: File): Promise<ReviewedImage> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15 * 1024 * 1024)
    throw Error('Choose a JPG, PNG or WebP image under 15 MB.');
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const files = await FilesetResolver.forVisionTasks('/mediapipe');
  const detector = await PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: '/models/pose_landmarker_full.task', delegate: 'CPU' },
    runningMode: 'IMAGE',
    numPoses: 2,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
  });
  try {
    // Allow the progress message to paint before this single-image synchronous inference.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const result = detector.detect(canvas);
    if (result.landmarks.length !== 1 || !result.worldLandmarks[0])
      throw Error('Use an image with one person and the whole body visible.');
    const thumbnail = document.createElement('canvas');
    const ratio = Math.min(1, 640 / Math.max(canvas.width, canvas.height));
    thumbnail.width = Math.round(canvas.width * ratio);
    thumbnail.height = Math.round(canvas.height * ratio);
    thumbnail.getContext('2d')!.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
    return {
      name: file.name.slice(0, 256),
      thumbnail: thumbnail.toDataURL('image/jpeg', 0.8),
      accepted: false,
      landmarks: result.landmarks[0].map((p) => [p.x, p.y, p.z]),
      world: result.worldLandmarks[0].map((p) => [p.x, p.y, p.z]),
      confidence: result.landmarks[0].map((p, i) =>
        Math.min(p.visibility ?? 0, result.worldLandmarks[0][i].visibility ?? 0),
      ),
    };
  } finally {
    detector.close();
  }
}

/** Reprojection for manual XY corrections; retain inferred depth until explicitly edited. */
export function moveImagePoint(
  pose: ReviewedImage,
  index: number,
  x: number,
  y: number,
): ReviewedImage {
  const result = structuredClone(pose);
  const scaleFor = (axis: number) => {
    const ids = [11, 12, 23, 24, 25, 26, 27, 28];
    const mean = (points: number[][]) => ids.reduce((s, i) => s + points[i][axis], 0) / ids.length;
    const a = mean(pose.landmarks),
      b = mean(pose.world);
    let top = 0,
      bottom = 0;
    for (const i of ids) {
      const d = pose.landmarks[i][axis] - a;
      top += d * (pose.world[i][axis] - b);
      bottom += d * d;
    }
    return Math.max(0.2, Math.min(5, bottom > 1e-6 ? top / bottom : 1));
  };
  result.world[index][0] += (x - pose.landmarks[index][0]) * scaleFor(0);
  result.world[index][1] += (y - pose.landmarks[index][1]) * scaleFor(1);
  result.landmarks[index][0] = x;
  result.landmarks[index][1] = y;
  result.confidence[index] = 1;
  result.accepted = false;
  return result;
}
