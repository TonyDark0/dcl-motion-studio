import { referenceRequestSchema, type ReferenceRequest } from '../src/pose-reference';
import { fitImagePose } from '../src/image-pose-solver';
import { compileConstraints, type Constraint } from './kimodo-constraints';

export function imagePoseConstraints(
  input: ReferenceRequest,
  frames: number,
  loop: boolean,
  inPlace: boolean,
): Constraint[] {
  const refs = referenceRequestSchema.parse(input);
  if (!loop && !refs.end) throw Error('An end pose is required.');
  const poses = [fitImagePose(refs.start)];
  const indices = [0];
  const anchors = [
    ...(refs.middle ? [{ image: refs.middle, time: refs.middleTime }] : []),
    ...(refs.middle2 ? [{ image: refs.middle2, time: refs.middle2Time ?? 0.75 }] : []),
  ].sort((a, b) => a.time - b.time);
  for (const anchor of anchors) {
    const frame = Math.round((frames - 1) * anchor.time);
    if (indices.includes(frame)) throw Error('Choose different times for the middle poses.');
    poses.push(fitImagePose(anchor.image));
    indices.push(frame);
  }
  poses.push(loop ? poses[0] : fitImagePose(refs.end!));
  indices.push(frames - 1);
  const pose = {
    frame_indices: indices,
    local_joints_rot: poses.map((p) => p.rotations),
    root_positions: poses.map((p) => p.root),
  };
  const constraints: Constraint[] = [
    { type: 'fullbody', ...pose },
    {
      type: 'end-effector',
      ...pose,
      joint_names: ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'],
    },
  ];
  if (inPlace)
    constraints.push({
      type: 'root2d',
      frame_indices: Array.from({ length: frames }, (_, i) => i),
      smooth_root_2d: Array.from({ length: frames }, () => [0, 0]),
    });
  compileConstraints(constraints, frames);
  return constraints;
}
