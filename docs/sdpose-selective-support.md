# Proposed selective SDPose assistance

**Status: not integrated.** SDPose and an additional detector are not downloaded or run by the current setup. Fast uses MediaPipe/RTMW3D; Pro adds SAM 3D Body and MoGe. See [Pro capture](pro-capture-pipeline.md).

## Possible role

A second 2D estimator could be evaluated on difficult reference frames, rather than run on every sample. Candidate triggers include sustained low confidence, lost extremities or disagreement between observations. The result would supplement review and existing depth estimates; 2D points alone do not establish 3D motion or hand articulation.

The existing crop could be reused when reliable. A separate detector would need its own justification and license review. An integration would require explicit landmark mapping, left/right checks, temporal correspondence and confidence handling; silently filling missing depth with zero would not be a valid recovery strategy.

## Conditions for adoption

Compare the current pipeline with and without assistance on the same unseen clips. Inspect recovered references, preservation of good observations, downstream animation, memory and total processing time. Checkpoint size alone does not predict GPU memory or latency.

Any required Python/runtime versions should be isolated from the working Pro environment until compatibility is established. Provider license and training-data provenance review would be needed before distribution. No measured improvement from SDPose is claimed by this local release.
