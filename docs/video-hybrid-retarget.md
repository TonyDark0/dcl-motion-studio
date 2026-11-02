# Video tracking to conditioned animation

Video to motion uses a reference clip to guide Kimodo rather than treating tracked landmarks as a finished animation. Tracking review, pose conditioning, motion generation, hand articulation and editor correction are separate stages.

## 1. Prepare and track

The local API trims and normalizes the selected segment with FFmpeg. **Fast** combines browser MediaPipe with local RTMW3D detail tracking. **Pro** adds local SAM 3D Body and MoGe camera calibration. Both produce observations for the same review workspace.

The browser shows the video and tracking before generation. The user can correct points and inspect uncertain frames. No Kimodo body-generation request is needed to inspect that tracking. See [video preparation](video-preparation-pro-sdpose.md) and [review controls](video-review-workspace.md).

## 2. Validate the accepted observations

On acceptance, Studio validates the capture schema, repairs eligible short gaps and builds the actual pose constraints. Essential joints must have usable confidence and plausible geometry. A missing joint beyond the repair window causes a tracking error that identifies the affected time/joints.

The browser preflight and local generation path use the shared constraints logic. This catches unsuitable references before inference starts. A later generation can still fail because of model, process, memory or filesystem problems; preflight does not replace runtime error handling.

## 3. Convert references to SOMA30

The capture is represented at 30 fps. The current sampling interval is **10 output frames**, with the final frame included. The interval is independent of the source video's decoder FPS. Saved captures can carry their own supported legacy cadence.

Each body reference is first transferred by FK to the canonical DCL hierarchy, using its lengths and bind pose. The DCL-to-SOMA bridge then reconstructs parent-local SOMA rotations. Interactive IK offsets are excluded from those body anchors. Root path, height and heading are represented consistently with the reference poses.

See [sampling](../src/pose-sampling.ts), [constraint validation](../src/video-pose-constraints.ts) and [the bridge](../src/dcl-pose-bridge.ts).

## 4. Generate and clean body motion

The native C1 path receives full-body and hand/foot effector constraints. Kimodo generates intermediate body frames between anchors. The video postprocessor smooths high-frequency motion and uses captured support, lift and reach information to clean the result on the DCL reference rig. This baked cleanup occurs before interactive editor controls.

Root estimates are derived from the camera observations. A fixed camera and visible full body make them more useful; a single video cannot establish exact metric world travel.

## 5. Add hands and edit

SOMA30 does not contain articulated finger joints. Reviewed hand observations therefore follow a separate SOMAHand-assisted fitting and DCL mapping path. Finger-local rotations and wrist influence are kept separate, then interpolated into the Hands source.

The accepted result is represented by Body and Hands layers. Movement/hand smoothing, timeline composition and final user IK operate on that result. Smoothing does not run a new Kimodo generation. See [hand fitting](somahand-source-motion.md) and [timeline evaluation](nla-editor.md).

Foot-contact controls in the editor are distinct from baked generation cleanup. Keeping the checkbox off does not mean no filtering or support analysis happened earlier. Occlusion, fast gestures, small hands and inconsistent depth remain limitations.
