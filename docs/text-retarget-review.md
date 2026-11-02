# How text-generated motion reaches the avatar

Text generation produces SOMA30 skeletal motion through Kimodo. Studio transfers the result to DCL for preview, clip editing, IK adjustment and GLB export. This page explains that transfer; it is not a benchmark or a history of corrections.

## From prompt to motion

The local API validates the request and passes the prompt, frame count, seed and sampling settings to the configured native process. The output contains root positions and parent-local body rotations. Studio validates the motion structure before adding it to a project.

An optional image-pose request supplies explicit anchors. A prompt-only loop can require a reference generation followed by a conditioned pass; an accepted image reference can supply the endpoint pose directly. See [image references](image-pose-references.md) and [native constraints](../native/kimodo/README.md).

## Skeleton conversion

The source hierarchy has two neck joints, while DCL has one neck followed by the head. Studio uses the accumulated source neck orientation for the target neck and retains the head's relative orientation. The target bind axes and lengths remain authoritative.

Root height represents body height, not just displacement from the first frame. A clip beginning in a crouch therefore keeps its lower starting pose. The transfer also considers foot/toe clearance across differing leg proportions. It estimates support without forcing every frame to the floor, so a jump can remain airborne.

## Editing the result

The retargeted source enters the timeline. Clip timing, masks, blends and user IK controls are evaluated afterward. **Keep style** reuses a completed generation's seed; it is not a trained style model or an individual-keyframe editor. Reusing a seed does not guarantee an identical gesture for a changed prompt.

GLB export bakes the evaluated pose at 30 fps. Later changes to a project do not change a previously exported GLB; export again to include those edits.

## Code and limitations

See [worker](../server/worker.ts), [rig](../src/rig.ts), [text grounding](../src/text-motion-grounding.ts) and [timeline](../src/timeline.ts). Generated motion may still contain foot drift, imperfect contact or an inaccurate interpretation of the prompt. Retargeting preserves skeleton structure; it cannot supply motion detail the model did not generate.
