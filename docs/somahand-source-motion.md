# Hand articulation and captured root movement

Studio separates body generation from finger articulation. Kimodo's SOMA30 output contains body and end-effector motion but does not synthesize articulated finger joints. Reviewed video provides the hand observations used by the Hands source.

## SOMAHand prior

[somahand-prior.json](../src/assets/somahand-prior.json) contains a compact articulation PCA and wrist-local reference skeleton derived from SOMA-X. This fitting stage uses the bundled skeletal prior, not the full SOMAHand mesh/identity runtime. It needs no separate neural-model download or GPU by itself; upstream tracking can have its own requirements.

For each sampled hand reference, Studio constructs a palm frame and fits articulation using confidence-weighted finger directions, statistical regularization and temporal continuity. Observed wrist/palm anchors and target segment lengths remain separate from the articulation parameters.

The fitted directions are transferred to DCL finger chains in palm-local coordinates. Quaternions are interpolated between references. Finger articulation and wrist influence are independent controls, so moving a hand target does not replace all finger-local rotations.

Current reference selection uses [pose-sampling.ts](../src/pose-sampling.ts): every **10 frames** on the 30 fps timebase, plus the last frame. Supported older captures can retain their saved cadence. Sparse references may miss fast finger gestures.

## Confidence and limits

A collapsed palm or incompatible low-confidence fit retains the reviewed evidence rather than fabricating a certain gesture. Fit metadata records results/uncertainty. This statistical prior is not an exhaustive joint-limit, mesh-collision or hand-object interaction solver.

## Root movement

Pro can use SAM camera translation with the working MoGe calibration. Fast estimates translation from body position and apparent scale. Coordinates are converted to Y-up, heading is unwrapped across angle boundaries and the initial horizontal location becomes the working scene origin.

Body anchors and dense root/heading constraints share that coordinate convention. Source movement retains the estimated path; in-place playback removes horizontal travel. Vertical motion and support estimates are evaluated separately. A single camera cannot reliably separate actor travel from camera travel or establish floor height when the clip begins in flight.

## Provenance

The prior derives from [NVIDIA SOMA-X](https://github.com/NVlabs/SOMA-X), revision `104578ed58857f6faa7592fb83d0a2dad43c36fa` of the referenced Hugging Face assets. The original NPZ SHA-256 is `233e9225c1da05c6a3dd98107b9f027f2366e3b972bbe67e0d164e5d28619fff`.

[extract-somahand.py](../scripts/extract-somahand.py) verifies and extracts the local source assets. The license is retained at [SOMA-X.txt](../public/licenses/SOMA-X.txt). See [licensing](LICENSING.md) for scope; possession of the prior does not license unrelated reference videos or emotes for training.
