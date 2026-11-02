# Retargeting: from source motion to the DCL avatar

Retargeting transfers motion between skeletons with different joint layouts, proportions and reference orientations. Studio converts generated SOMA30 body motion or reviewed tracking into the canonical DCL skeleton, then evaluates the timeline and applies editor controls. It does not add or resize the avatar's bones.

## Processing stages

```text
SOMA30 motion or reviewed tracking
  → source orientations and reference pose
  → FK mapping onto DCL bone lengths
  → root movement and height policy
  → clip timing, masks and layer composition
  → final editor IK/contact controls
  → 30 fps baked GLB
```

FK means evaluating rotations through a bone hierarchy. IK means solving joint rotations from a desired hand or foot target. The transfer stage and editor IK have different responsibilities.

## Reference pose and proportions

The loaded avatar supplies each bone's reference transform and segment length. SOMA rotations are accumulated through the source hierarchy, mapped by joint role and applied relative to the target reference. A source local quaternion cannot simply be assigned to a target bone with a different parent or bind axis.

For position-based tracking, segment directions are reconstructed with the target's own lengths:

```text
targetChild = targetParent + normalizedSourceDirection × targetSegmentLength
```

Each arm and leg segment uses its own length. Palm orientation uses wrist and palm anchors; finger articulation is evaluated separately. Elbow and knee directions provide pole information for later IK.

## Root movement and support height

**Source** retains the source trajectory. **In place** removes horizontal root travel for use with an external character controller. Root transforms are handled in world space and converted back to the avatar's parent space, so a rotated or scaled armature does not confuse vertical height with local X/Z movement. Rotations remain part of the evaluated pose; an in-place setting is not a command to freeze all body orientation.

SOMA root height is transferred using the avatar's scale. Text motion also transfers support clearance and a clip-level floor estimate, allowing crouches and jumps to retain their height changes. Video uses its calibrated/estimated trajectory and support observations. Neither route establishes a physically measured floor from an arbitrary camera clip.

## IK and export

Retargeting establishes the base pose before interactive IK. The editor then applies hand/foot offsets, pole direction and enabled contact corrections to the composed animation. Export samples that same result rather than storing a live solver in the GLB.

Generated video has a separate baked cleanup stage before editor playback. That stage can adjust support and reach; it is distinct from the user's final IK controls. See [video generation](video-hybrid-retarget.md). There is not one universal IK operation covering every processing stage.

## Implementation map and limits

- [AvatarRig](../src/rig.ts): reference transforms, SOMA/tracking transfer and IK.
- [DCL-to-SOMA bridge](../src/dcl-pose-bridge.ts): body references for conditioned generation.
- [Timeline evaluator](../src/timeline.ts): timing, masks, composition and root transforms.
- [Text grounding](../src/text-motion-grounding.ts) and [video grounding](../src/video-grounding.ts): support estimates.

Mapping targets the canonical DCL hierarchy. Loading an arbitrary rig is not a supported retargeting plugin. Unobserved depth, occluded limbs, noisy source motion and foot sliding can still require correction. Support-marker calculations are not mesh collision detection.
