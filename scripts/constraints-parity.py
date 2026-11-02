"""Generate fixtures with official Kimodo conditioning only (no model downloads).

Usage: python scripts/constraints-parity.py /path/to/official/kimodo
Requires the existing vision Python environment (torch, einops, scipy).
"""
import json
import math
import pathlib
import sys
import types

upstream = pathlib.Path(sys.argv[1]).resolve()
# Import utility modules without importing the official inference model/LLM.
package = types.ModuleType('kimodo')
package.__path__ = [str(upstream / 'kimodo')]
sys.modules['kimodo'] = package

from kimodo.constraints import load_constraints_lst
from kimodo.skeleton import SOMASkeleton30
from kimodo.motion_rep.conditioning import build_condition_dicts
from kimodo.motion_rep.reps.kimodo_motionrep import KimodoMotionRep

frames = 8
rot = [[math.sin(j * .7) * .3, math.cos(j * .2) * .2, math.sin(j * .4) * .25] for j in range(30)]
constraints = [
    {'type': 'fullbody', 'frame_indices': [0, 7], 'local_joints_rot': [rot, rot],
     'root_positions': [[0., 1., 0.], [.4, 1., -.2]], 'smooth_root_2d': [[0., 0.], [.3, -.1]]},
    {'type': 'end-effector', 'frame_indices': [3], 'local_joints_rot': [rot],
     'root_positions': [[.1, .95, -.2]], 'joint_names': ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'Hips']},
    {'type': 'root2d', 'frame_indices': [1, 2, 4, 5, 6],
     'smooth_root_2d': [[.02 * i, -.01 * i] for i in range(5)],
     'global_root_heading': [[math.cos(.1 * i), math.sin(.1 * i)] for i in range(5)]},
]
skeleton = SOMASkeleton30()
rep = KimodoMotionRep(skeleton, fps=30)
indices, data = build_condition_dicts(load_constraints_lst(constraints, skeleton))
observed, mask = rep.create_conditions(indices, data, frames, to_normalize=False, device='cpu')
target = pathlib.Path(__file__).resolve().parents[1] / 'tests/fixtures/kimodo-constraints.json'
target.write_text(json.dumps({'revision': '58e781898b3d7e328a676a75d3e338c45dce3ad9',
    'frames': frames, 'constraints': constraints,
    'observed': observed.flatten().tolist(), 'mask': mask.flatten().int().tolist()}), encoding='utf-8')
print(f'Official conditioning fixture: {target}')
