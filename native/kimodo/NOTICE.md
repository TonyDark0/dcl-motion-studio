# Kimodo constraints integration

Portions of `server/kimodo-constraints.ts` and its conditioning layout are derived from
[NVIDIA Kimodo](https://github.com/nv-tlabs/kimodo), commit
`58e781898b3d7e328a676a75d3e338c45dce3ad9`:

- `kimodo/constraints.py`
- `kimodo/motion_rep/reps/kimodo_motionrep.py` (`create_conditions`)
- `kimodo/motion_rep/feature_utils.py` (heading)
- `kimodo/skeleton/definitions.py` and `kinematics.py`

Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
Licensed under Apache License 2.0; see `LICENSE-NVIDIA.txt`.

The native patch and SOMA30 offsets use
[localai-org/kimodo.cpp](https://github.com/localai-org/kimodo.cpp), commit
`5679ff19ba0a522c0b0516e9a9d402fe1af2c027`, Apache-2.0.
Its license and notices are included as `LICENSE-KIMODO-CPP.txt` and `NOTICE-KIMODO-CPP.txt`.
GGML and the existing model weights retain their separate licenses.

Local modifications: expose existing conditioned DDIM sampling through the C++ API
and a versioned CLI protocol; prepare sparse constraints in TypeScript; validate
contradictory anchors; add an automatic two-pass loop workflow. Only SOMA30 is
supported by the Studio bridge. This is a local extension, not an upstream feature.

The parity fixture is generated with the unmodified official utility modules by
`scripts/constraints-parity.py`. The script does not load inference models.
