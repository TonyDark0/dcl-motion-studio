# Clips, layers and baked export

The timeline composes reusable animation sources into an evaluated avatar pose. Preview and export use the same evaluator. Composition runs locally and does not require Blender or another inference model.

## Sources and clips

A source contains generated/captured motion and its associated settings. A clip is an instance of that source with a timeline start, source trim, speed and repeat count. Several clips can reference one source; editing source-level hand capture or smoothing affects those linked instances. Duplicating a source creates an independent entry.

Move or trim clips on the 30 fps timebase. The selected clip exposes its timing and source range. Splitting separates supported single-cycle clips at the playhead. Adding another animation can create an overlap with the preceding clip.

## Layers and masks

Layers evaluate in order. A mask selects the full body or channels such as upper body, legs, arms, fingers, wrists or root. Mute excludes a layer; solo restricts evaluation; lock protects editing.

**Replace** blends absolute poses. **Additive / Combine** applies rotation deltas relative to the source's chosen reference time. Influence and fade controls determine how clips contribute through overlaps. Bone lengths and bind transforms are not interpolated as arbitrary proportions.

Body and Hands from video are separate sources/layers. Finger articulation can therefore be adjusted without replacing the generated body, and wrist influence remains independent.

## Loops and root movement

- **Loop playback** repeats the transport preview.
- **Repeat clip** repeats a source instance.
- **Make seamless** adjusts the selected range's seam.

These operations are independent. Seam correction is bounded blending, not a new motion-generation pass. Large endpoint changes, jumps and fast turns still need visual review.

Source mode evaluates trajectory and root alignment across clips/repetitions. In-place mode removes horizontal travel in world space while preserving vertical pose movement. Final user IK/contact controls follow composition. These operations do not make foot contact or collision physically exact.

## Save versus export

A saved project retains sources, clips, layers and editable controls. GLB export samples the evaluated animation at 30 fps and writes one baked animation. The exported file does not require Studio's IK solver or timeline evaluator for playback.

The export-range option rebases the selected section to time zero. Animation naming is stored separately from the project filename and clip labels. Emote export retains the skeleton/skin metadata needed by importers while excluding preview meshes; a default-avatar export includes the canonical avatar.

## Working limits

The current editing helpers use a **10-second working timeline** in [timeline.ts](../src/timeline.ts). The persisted [schema](../src/motion.ts) remains broader: up to 32 sources, 64 clips, 64 layers and structural ranges up to 120 seconds. That broader validation envelope is not a promise that the current UI supports creating/editing a 120-second composition.

Emote export has its own checks, including duration, geometry bounds and a 1,000,000-byte cap in [export-settings.ts](../src/export-settings.ts). Passing those checks does not establish acceptance by Decentraland's publication tools. Review the final file in the intended platform.

Implementation: [timeline evaluator](../src/timeline.ts), [timeline UI](../src/TimelineEditor.tsx), [rig](../src/rig.ts) and [export settings](../src/export-settings.ts).
