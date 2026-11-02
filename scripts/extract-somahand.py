"""Extract the official SOMAHand pose prior and bind skeleton (NumPy only).

Inputs: data/models/somahand/{SOMAHand.npz,SOMA_template_rig.usda}
Source: nvidia/SOMA-X at 104578ed58857f6faa7592fb83d0a2dad43c36fa.
No pickle, USD runtime, mesh inference or identity PCA is needed at runtime.
"""
import ast
import hashlib
import json
import re
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'data/models/somahand'
SHA = '233e9225c1da05c6a3dd98107b9f027f2366e3b972bbe67e0d164e5d28619fff'
assert hashlib.sha256((ASSETS / 'SOMAHand.npz').read_bytes()).hexdigest() == SHA
data = np.load(ASSETS / 'SOMAHand.npz', allow_pickle=False)
usd = (ASSETS / 'SOMA_template_rig.usda').read_text()
names = ast.literal_eval(re.search(r'uniform token\[\] joints = (\[.*?\])', usd).group(1))
bind = np.array(ast.literal_eval(re.search(r'uniform matrix4d\[\] bindTransforms = (\[.*?\])', usd).group(1)))
bind = bind.transpose(0, 2, 1)  # USD row-vector -> column-vector matrices
bind[:, :3, 3] *= .01  # centimetres -> metres
lookup = {name.split('/')[-1]: i for i, name in enumerate(names)}
result = {'version': 1, 'sourceSha256': SHA, 'license': 'Apache-2.0'}
for side in ('left', 'right'):
    prefix = side + '_pose_'
    joint_names = data[prefix + 'reference_joint_names'].tolist()
    parents = data[side + '_joint_parent_ids'].tolist()
    worlds = np.array([bind[lookup[name]] for name in joint_names])
    wrist_local = np.linalg.inv(worlds[0]) @ worlds
    orient = data[prefix + 'reference_orient']
    assert np.max(np.abs(wrist_local[:, :3, :3] - orient)) < 1e-4
    assert np.max(np.abs(data[prefix + 'reference_orient_parent'] - orient[parents])) < 1e-4
    offsets = np.array([(np.linalg.inv(worlds[parents[j]]) @ worlds[j])[:3, 3]
                        if j else np.zeros(3) for j in range(25)])
    result[side] = {
        'names': joint_names, 'parents': parents, 'offsets': offsets.tolist(),
        'orient': orient.tolist(),
        'mean': data[prefix + 'mean'].reshape(-1).tolist(),
        'components': data[prefix + 'components'].tolist(),
        'eigenvalues': data[prefix + 'eigenvalues'].tolist(),
    }
destination = ROOT / 'src/assets/somahand-prior.json'
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(result, separators=(',', ':')) + '\n')
print(f'Extracted verified SOMAHand prior: {destination.stat().st_size} bytes')
