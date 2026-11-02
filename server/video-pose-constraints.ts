import type { Capture } from '../src/video-motion';
import { videoPoseConstraints as sharedConstraints } from '../src/video-pose-constraints';
import { dclReferenceRig } from './dcl-reference-rig';

export { preserveVideoRoot, VideoTrackingError } from '../src/video-pose-constraints';

/** Keep worker FK tied to its canonical GLB; all validation logic is shared. */
export function videoPoseConstraints(input: Capture, frames: number, inPlace = false) {
  return sharedConstraints(input, frames, inPlace, dclReferenceRig);
}
