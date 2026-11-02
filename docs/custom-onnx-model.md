# Proposed DCL motion corrector

**Status: design proposal only.** Studio does not download, train or execute a custom DCL correction network. Active motion processing uses the models and deterministic operations described in [the technical overview](TECHNICAL_REFERENCE.md).

## Intended role

A future corrector could learn recurring errors after initial motion reconstruction/retargeting and before final editor IK. It would predict bounded residual adjustments rather than replace the avatar hierarchy, export pipeline or user controls.

Candidate inputs include local joint rotations, root velocity, hand/foot targets, estimated contacts, confidence masks and avatar proportions. Candidate outputs include joint/root corrections and contact confidence. All of these are proposed interfaces; they are not current public API guarantees.

## Required dataset

Each authorized example would pair original motion with a human-reviewed correction, along with the skeleton definition, coordinate convention, timing, model/pipeline versions and provenance. Raw generated output and edited output must remain distinguishable.

Training/validation/test splits should separate people and sessions rather than adjacent frames. Licenses and consent must cover training, permitted reuse and any intended dataset distribution. Neither GitHub availability nor Marketplace publication supplies those rights automatically. This local release does not enable automatic dataset collection.

## Evaluation before integration

Compare against the deterministic baseline on unseen clips: rotation/effector error, foot sliding during support, false contacts, preserved jumps/turns, temporal noise, latency and memory. A learned smoother must not erase valid motion to improve one aggregate metric.

An ONNX deployment would need numerical parity, validated operators, versioned normalization/bone ordering and behavior for invalid or low-confidence outputs. Users should be able to retain the baseline path. Browser/WebGPU execution is a possible future target, not a present guarantee of the local runtime.

See [model and data licensing](LICENSING.md) before defining collection or training work.
