# Style controls and possible future templates

**Current behavior:** generation uses the user's trimmed prompt. The category values Dance, Celebration, Meme, Emotion and Rest remain in compatibility data, but they do not add conditioning to the current prompt path. There is no active category-template model.

**Keep style** is a different feature: it reuses a completed generation's random seed. It does not lock the pose, guarantee a matching movement or retrain a style embedding.

## Proposed extension — not implemented

A future template system could combine curated motion descriptors and optional sparse anchors. User image/video constraints would need explicit priority, and the template would have to preserve independent hand articulation and root-motion controls.

Before shipping, compare the template against plain prompts across multiple seeds and unseen actions. Measure recognizable intent, foot contact, motion diversity and whether a template forces repetitive starting poses. Reference motions would need rights covering the actual proposed use; a publicly viewable emote is not automatically licensed training material.

Implementation of current behavior: [emote-style.ts](../src/emote-style.ts). Calibration data is described in [the reference guide](emote-reference-library.md).
