import bpy, sys
src,out=sys.argv[-2],sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=src)
arm=bpy.data.objects['ShibaRig']
for tr in arm.animation_data.nla_tracks: tr.mute=False
arm.animation_data.action=None
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animation_mode='NLA_TRACKS', export_yup=True, export_apply=False)
