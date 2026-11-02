# Reviewing video tracking and editing the result

The review workspace lets the user inspect and correct the observations that will condition animation generation. Tracking review and final animation preview answer different questions: whether the reference is usable, and whether the generated motion is useful.

## Choose a segment and capture

Create/open a video project, select a clip, choose Fast or Pro, and set a 2–10 second segment. Analyze tracking to prepare and process that segment locally. Preparation and model initialization can have indeterminate progress; capture progress follows processed samples.

The review dialog presents the reference video and an independent skeleton view. Overlay coordinates follow the visible video rectangle, including its zoom/pan transform; letterbox margins are not tracking coordinates. Hiding overlay points does not hide the separate skeleton.

## Review controls

- Play, pause, change speed, step between captured frames or jump to either endpoint.
- Zoom and pan the reference, then fit it back to the full frame.
- Focus on body or hand points, inspect confidence and drag visible points to correct them.
- Undo/reset corrections. Optional nearby-frame propagation fades over time and respects points already corrected by the user.

A 2D drag confirms a screen location, not a physically measured hidden depth. Difficult or occluded frames can require another reference clip. The application keeps reviewed observations available when a subsequent generation fails.

## Accept and generate

Acceptance runs the same pose-constraint validation used by the generation path before starting native inference. Short repairable gaps can be filled; missing essential joints or invalid geometry block submission. A valid preflight does not guarantee that the model/process will complete successfully.

Body and Hands sources enter the project as separate layers. The prepared silent reference is stored locally for comparison. The viewport's reference pane follows clip trims, offset, speed and repetition using the same timeline transport.

## Result controls and timing

Movement and hand smoothness adjust the corresponding sources without a new generation. Quaternion filtering is evaluated before composition; IK and enabled contact controls follow composition. The saved project retains the settings and supports undo/redo.

Capture time covers preparation, calibration and tracking. Generation time measures local constrained processing; their sum excludes time spent manually reviewing. These values describe the individual operation, not a general hardware benchmark.

## Project and failure handling

Save stores editable project data; GLB export stores baked animation. Leaving a dirty project offers save/discard/cancel. Failed saves keep current edits available. Request recovery retries eligible transient frame/calibration failures with a bounded policy; it does not blindly repeat native generation requests.

Local diagnostic logs omit pixel arrays and prompts from request-level tracing. Model-level diagnostics can be inspected when processing fails. See [vision requests](../src/vision-request.ts), [request logging](../server/video-request-log.ts), [reference playback](../src/ReferenceVideoView.tsx) and [the capture pipeline](video-hybrid-retarget.md).
