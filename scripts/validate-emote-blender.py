"""Run with Blender --background --factory-startup --python ... -- REPORT GLB [GLB...]."""
import bpy
import json
import sys
from pathlib import Path

args = sys.argv[sys.argv.index('--') + 1:]
report_path = Path(args[0]).resolve()
reports = []
pose_samples = {}
for filename in args[1:]:
    source = Path(filename).resolve()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    # Blender otherwise creates a mesh object solely as a custom bone display shape.
    bpy.ops.import_scene.gltf(filepath=str(source), disable_bone_shape=True)
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    report = {
        'file': str(source),
        'armatures': len(armatures),
        'meshes': len([o for o in bpy.context.scene.objects if o.type == 'MESH']),
        'empties': len([o for o in bpy.context.scene.objects if o.type == 'EMPTY']),
        'armatureParents': [obj.parent.name if obj.parent else None for obj in armatures],
        'bones': [b.name for arm in armatures for b in arm.data.bones],
        'actions': [a.name for a in bpy.data.actions],
    }
    snapshots = []
    ordered_bones = sorted((b for arm in armatures for b in arm.pose.bones), key=lambda b: b.name)
    for frame in (0, 15, 30, 60):
        bpy.context.scene.frame_set(frame)
        snapshots.append([list(value for row in (b.id_data.matrix_world @ b.matrix) for value in row) for b in ordered_bones])
    pose_samples[source.name] = snapshots
    report['maxAnimatedBoneMatrixChange'] = max(
        (abs(a - b) for sample in snapshots[1:] for first, current in zip(snapshots[0], sample) for a, b in zip(first, current)), default=0)
    reports.append(report)
    # Reference: ask Blender's own exporter to produce an armature-only GLB.
    if armatures and report['meshes']:
        bpy.ops.object.select_all(action='DESELECT')
        for arm in armatures:
            arm.select_set(True)
        bpy.context.view_layer.objects.active = armatures[0]
        bpy.ops.export_scene.gltf(filepath=str(report_path.parent / 'blender-armature-only.glb'),
                                  export_format='GLB', use_selection=True, export_skins=True,
                                  export_animations=True, export_def_bones=True)
report_path.write_text(json.dumps(reports, indent=2), encoding='utf-8')
print(json.dumps([{**r, 'bones': len(r['bones'])} for r in reports], indent=2))
if 'emote-fixed.glb' in pose_samples:
    fixed = next(r for r in reports if Path(r['file']).name == 'emote-fixed.glb')
    assert fixed['armatures'] == 1 and fixed['meshes'] == 0
    assert fixed['empties'] == 0 and fixed['armatureParents'] == [None]
    assert len(fixed['bones']) == 62
    assert fixed['maxAnimatedBoneMatrixChange'] > 0.001
    if 'avatar-full.glb' in pose_samples:
        full = next(r for r in reports if Path(r['file']).name == 'avatar-full.glb')
        assert set(fixed['bones']) == set(full['bones'])
        delta = max(abs(a-b) for s1, s2 in zip(pose_samples['avatar-full.glb'], pose_samples['emote-fixed.glb'])
                    for b1, b2 in zip(s1, s2) for a, b in zip(b1, b2))
        print(f'Full avatar vs emote world bone matrices: maximum difference {delta}')
        assert delta < 0.0001
    if 'emote-with-scene.glb' in pose_samples:
        delta = max(abs(a-b) for s1, s2 in zip(pose_samples['emote-with-scene.glb'], pose_samples['emote-fixed.glb'])
                    for b1, b2 in zip(s1, s2) for a, b in zip(b1, b2))
        print(f'Before vs after removing Scene: maximum world bone matrix difference {delta}')
        assert delta < 0.0001
