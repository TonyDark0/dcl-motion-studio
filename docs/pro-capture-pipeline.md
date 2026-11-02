# Local Pro capture pipeline

Pro estimates body and hand movement from a single reference video using several complementary observations. All inference described here runs on the user's computer. Pro requires the separately installed Python runtime and a compatible NVIDIA GPU; Fast remains the CPU alternative.

## Model responsibilities

| Component           | Role                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| MediaPipe Pose Full | Browser body observation and visible-person landmarks.                                             |
| RTMW3D ONNX         | Local detail observations for body, hands and feet.                                                |
| MoGe-2 ViT-S        | Camera calibration from a reference frame; its intrinsics define the clip's working field of view. |
| SAM 3D Body DINOv3  | Full body/hand estimates using the selected person's box and calibrated camera.                    |

The Python adapter requests full SAM inference and extracts the joints and camera quantities used for tracking. The model can still compute mesh-related information internally; exporting fewer values is not a claim that the network performs less inference.

## Capture and fusion

The browser prepares a frame and obtains detail observations from the local services. Pro can attempt a full-frame SAM observation when the auxiliary tracker cannot provide enough useful points. This is a one-person workflow, not persistent multiperson identity tracking.

Observations are aligned in scale and pelvis position. Fusion considers available confidence and agreement rather than averaging unrelated local bone rotations. SAM confidence is partly a geometric heuristic, not a calibrated probability of pose correctness. Manual review can override unreliable joints before final fitting.

## Temporal reconstruction

The accepted observations pass through short-gap repair, temporal/depth filtering and robust segment-length reconstruction. Hand fitting uses a palm-local reference and an articulation prior. Raw evidence and reviewed corrections are retained in the project representation so processing can be repeated without pretending that every inferred point was directly observed.

The next stages are shared with Fast: build SOMA constraints, generate body motion, clean the result, compose Body/Hands and apply editor controls. See [the complete generation flow](video-hybrid-retarget.md).

## Process and memory lifecycle

The local Node service coordinates a resident Python process. Pro inference is serialized to limit simultaneous GPU allocation. MoGe calibration and SAM processing use managed loading/unloading rather than assuming both models fit together. SAM can remain resident across frames.

Install with `npm run setup:pro` on Windows. `PRO_VISION_PYTHON` can select an explicit interpreter. Weights and runtime files stay under `data/`. Model access and licenses remain separate from the application's Apache license; see [licensing](LICENSING.md).

## Limitations and code

There is no universal 4 GB VRAM guarantee. Occluded hands, camera motion, blur and unusual poses can remain ambiguous. Pro adds observations; it does not guarantee better results for every clip.

Implementation: [local vision service](../server/vision.ts), [Python adapter](../server/python/pro_vision.py), [capture reconstruction](../src/video-motion.ts) and [video panel](../src/VideoPanel.tsx).
