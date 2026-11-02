# Guiding text generation with image poses

Image poses supply explicit body anchors for a generated animation. They guide the motion model; they do not paste a still image onto the avatar or reconstruct a full performance from photographs.

## Editor workflow

In the text workspace, enable **Loop animation** to open the image-pose controls, then provide a clear image of one visible person. This control requires the configured Studio Constraints engine. The current UI offers a shared **Start / End** loop reference and up to **two middle references**. Review the landmark overlay and fitted skeleton, correct points where needed, then accept each image. Replacing an image requires review again.

The loop endpoints use the same accepted pose. Middle references are positioned by normalized clip time between 10% and 90%; the two times must remain distinct. Disabling image guidance retains the project references while ordinary prompting is used.

The request schema can represent a distinct end pose for a nonloop, but the current image panel is built around the shared loop endpoints. A schema field is not evidence of a separate exposed UI workflow. See [ImagePosePanel](../src/ImagePosePanel.tsx) and [request serialization](../src/pose-reference.ts).

## Local processing

MediaPipe Pose Landmarker runs in IMAGE mode in the browser. The generation request contains reviewed world landmarks and confidence values; the local project can retain a thumbnail for editing. The same installed pose model is used without introducing a hosted image API.

The fitter converts camera axes into the working Y-up convention, estimates hip/chest orientation and reconstructs SOMA30 rotations with fixed skeleton lengths. Reference photos share a local horizontal origin; they do not establish a global travel path.

The local service creates full-body and hand/foot effector anchors. In-place requests can also constrain horizontal root position. The patched native constraints engine is required. Accepted image anchors allow a conditioned pass without first generating a prompt-only reference clip.

## Acceptance and limits

The fitter checks required joints, confidence and geometry. Orange/low-confidence markers warrant inspection; essential missing observations can block fitting. Manual corrections are recorded as user-confirmed points.

Depth, limb twist and occluded joints remain estimates. The body landmarks do not provide detailed finger animation. Upright/grounded poses are more suitable than inverted, airborne or floor-contact acrobatics. Contradictory prompts and references can produce an unsatisfactory transition even when the request is structurally valid.

Loop finishing happens after generation in the editor pipeline. Exact endpoint matching or physically correct intermediate motion is not guaranteed by conditioning alone.

Implementation: [image capture](../src/image-pose-capture.ts), [pose fitter](../src/image-pose-solver.ts), [reference schema](../src/pose-reference.ts) and [constraint construction](../server/image-pose-constraints.ts).
