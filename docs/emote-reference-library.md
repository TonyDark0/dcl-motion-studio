# Reference measurements and rig calibration

Studio includes compact measurements and test fixtures derived from a local set of reference emotes. These support skeleton compatibility checks, articulation calibration and regression testing. They are not a downloadable emote pack or an active motion-training dataset.

## What the reference data describes

The profile data records clip identity, timing, skeleton correspondence, root range, endpoint differences and wrist articulation measurements. Matching uses bone names and bind transforms rather than assuming joint arrays share an index order. Additional prop joints do not become DCL deform-bone requirements.

Different references illustrate grounded poses, alternating support, turns and airborne movement. Those cases help distinguish vertical animation from noise; a generic floor clamp would erase intentional jumps or crouches. The measurements are specific to the recorded clips, not universal limits of human motion.

## Runtime use

Articulation helpers can use conservative ranges informed by those measurements. Tests use sampled poses to examine DCL proportions, world-space rotations, neutral IK and the DCL/SOMA conditioning bridge. This validates transfer math, not vision accuracy or the model's ability to reproduce a particular performance.

The current prompt path does **not** add Dance/Celebration/Meme/Emotion/Rest style cues. [generationPrompt](../src/emote-style.ts) keeps the user's trimmed prompt. Old style labels remain readable as compatibility data; they are not active template controls. **Keep style** is seed reuse.

## Files and reproduction

- [Profile data](../src/assets/emote-reference-profiles.json)
- [Reference helpers](../src/emote-references.ts)
- [Analyzer](../scripts/analyze-emote-references.ts)
- [Regression tests](../tests/emote-references.test.ts)

Original GLBs are local analysis inputs under `data/reference-emotes/` and are not included in Git. Re-running measurements requires those inputs and appropriate permissions. Derived profiles do not grant rights to copy the original animations or train a model on them. See [licensing](LICENSING.md).
