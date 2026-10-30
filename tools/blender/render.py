import bpy, math, sys
from mathutils import Vector
blend, out = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=blend)
scn=bpy.context.scene
scn.render.engine='CYCLES'; scn.cycles.samples=24; scn.cycles.device='CPU'
try: scn.cycles.use_denoising=True
except: pass
scn.render.resolution_x=480; scn.render.resolution_y=480; scn.render.film_transparent=False
w=bpy.data.worlds.new('W'); scn.world=w; w.use_nodes=True
w.node_tree.nodes['Background'].inputs[0].default_value=(0.9,0.93,0.95,1); w.node_tree.nodes['Background'].inputs[1].default_value=0.9
sun=bpy.data.lights.new('sun','SUN'); sun.energy=3.0; so=bpy.data.objects.new('sun',sun); scn.collection.objects.link(so)
so.rotation_euler=(math.radians(50),0,math.radians(-35))
cam=bpy.data.cameras.new('cam'); cam.type='ORTHO'; cam.ortho_scale=0.78
co=bpy.data.objects.new('cam',cam); scn.collection.objects.link(co); scn.camera=co
target=Vector((0,-0.05,0.30))
views={'front':(0,-2,0.32),'side':(2,0,0.32),'q34':(1.3,-1.5,0.75),'back':(0,2,0.4)}
import os
for name,pos in views.items():
    co.location=Vector(pos)+Vector((0,0,0))
    d=target-co.location; co.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
    scn.render.filepath=f'{out}_{name}.png'; bpy.ops.render.render(write_still=True)
