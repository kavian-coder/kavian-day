import bpy, math, sys
from mathutils import Vector
src, out = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=src)
scn=bpy.context.scene; scn.render.fps=30
body=bpy.data.objects['Shiba_Body']
arm_d=bpy.data.armatures.new('ShibaRig'); arm=bpy.data.objects.new('ShibaRig',arm_d); scn.collection.objects.link(arm)
bpy.context.view_layer.objects.active=arm; arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
E=arm_d.edit_bones
def bone(name, h, t, parent=None, connect=False):
    b=E.new(name); b.head=Vector(h); b.tail=Vector(t); b.roll=0
    if parent: b.parent=E[parent]; b.use_connect=connect
    return b
bone('hips',(0,0.15,0.31),(0,0.0,0.32))
bone('chest',(0,0.0,0.32),(0,-0.15,0.33),'hips',True)
bone('neck',(0,-0.15,0.33),(0,-0.24,0.44),'chest',True)
bone('head',(0,-0.24,0.44),(0,-0.30,0.57),'neck',True)
bone('tail1',(0,0.20,0.35),(0,0.25,0.43),'hips')
bone('tail2',(0,0.25,0.43),(0,0.23,0.51),'tail1',True)
bone('tail3',(0,0.23,0.51),(0,0.16,0.50),'tail2',True)
for s,sx in (('L',1),('R',-1)):
    bone(f'fl_up.{s}',(sx*0.06,-0.14,0.29),(sx*0.06,-0.145,0.15),'chest')
    bone(f'fl_lo.{s}',(sx*0.06,-0.145,0.15),(sx*0.058,-0.15,0.035),f'fl_up.{s}',True)
    bone(f'fl_paw.{s}',(sx*0.058,-0.15,0.035),(sx*0.058,-0.19,0.02),f'fl_lo.{s}',True)
    bone(f'hl_up.{s}',(sx*0.064,0.13,0.29),(sx*0.064,0.175,0.15),'hips')
    bone(f'hl_lo.{s}',(sx*0.064,0.175,0.15),(sx*0.062,0.16,0.035),f'hl_up.{s}',True)
    bone(f'hl_paw.{s}',(sx*0.062,0.16,0.035),(sx*0.062,0.12,0.02),f'hl_lo.{s}',True)
bpy.ops.object.mode_set(mode='OBJECT')
# skin
for o in bpy.context.selected_objects: o.select_set(False)
body.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active=arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
print('vgroups', len(body.vertex_groups))
for n in ('Eye.L','Eye.R','Nose'):
    o=bpy.data.objects[n]; mw=o.matrix_world.copy()
    o.parent=arm; o.parent_type='BONE'; o.parent_bone='head'; o.matrix_world=mw

# ---------- animation helpers ----------
P=arm.pose.bones
for pb in P: pb.rotation_mode='XYZ'
def fwd_sign(bname):
    pb=P[bname]; pb.rotation_euler=(0,0,0); bpy.context.view_layer.update()
    y0=(arm.matrix_world@pb.tail).y
    pb.rotation_euler=(math.radians(20),0,0); bpy.context.view_layer.update()
    y1=(arm.matrix_world@pb.tail).y; pb.rotation_euler=(0,0,0)
    return 1 if y1<y0 else -1   # +rotX moves tail forward (-Y)?
def up_sign(bname):
    pb=P[bname]; pb.rotation_euler=(0,0,0); bpy.context.view_layer.update()
    z0=(arm.matrix_world@pb.tail).z
    pb.rotation_euler=(math.radians(20),0,0); bpy.context.view_layer.update()
    z1=(arm.matrix_world@pb.tail).z; pb.rotation_euler=(0,0,0)
    return 1 if z1>z0 else -1
SF={b.name:fwd_sign(b.name) for b in P}; SU={b.name:up_sign(b.name) for b in P}
print('signs',SF,SU)
def rx(b,deg,kind='f'): P[b].rotation_euler.x=math.radians(deg)*(SF[b] if kind=='f' else SU[b])
def key_all(f):
    for pb in P:
        pb.keyframe_insert('rotation_euler',frame=f)
    P['hips'].keyframe_insert('location',frame=f)
def reset():
    for pb in P: pb.rotation_euler=(0,0,0); pb.location=(0,0,0)
def tailwag(t, amp, freq=1):
    for i,b in enumerate(('tail1','tail2','tail3')):
        P[b].rotation_euler.z=math.radians(amp*math.sin(2*math.pi*(freq*t)-i*0.6))
def new_action(name):
    a=bpy.data.actions.new(name); a.use_fake_user=True
    arm.animation_data_create(); arm.animation_data.action=a
    return a
def legs(t, A, bend, phases):
    for leg,ph in phases.items():
        s=math.sin(2*math.pi*(t+ph)); c=math.cos(2*math.pi*(t+ph))
        up=f'{leg}_up.L' if leg[-1]=='L' else None
    pass
TWO=2*math.pi
def cycle(name, frames, A, bend, ph, bob, wag, wagf, spine=0, headbob=0):
    new_action(name)
    for f in range(frames+1):
        t=f/frames; reset()
        for leg,p in ph.items():
            side=leg[-1]; kind=leg[:2]
            s=math.sin(TWO*(t+p)); c=math.cos(TWO*(t+p))
            rx(f'{kind}_up.{side}', A*s)
            lift=max(0,c)       # swing phase: leg moving forward -> lift paw
            if kind=='fl': rx(f'fl_lo.{side}', -bend*lift); rx(f'fl_paw.{side}', bend*0.6*lift)
            else:          rx(f'hl_lo.{side}', bend*lift);  rx(f'hl_paw.{side}', -bend*0.5*lift)
        P['hips'].location=(0, bob*abs(math.sin(TWO*t*2)) ,0) if False else (0,0,0)
        P['hips'].location.y = bob*math.sin(TWO*t*2)   # bone-local Y is along bone; small bob via rotation instead
        P['hips'].location=(0,0,0)
        P['chest'].rotation_euler.x=math.radians(spine*math.sin(TWO*t))
        P['head'].rotation_euler.x=math.radians(headbob*math.sin(TWO*t*2))
        tailwag(t, wag, wagf)
        key_all(f+1)
cycle('walk', 32, 22, 35, {'fl.L':0,'hl.R':0.05,'fl.R':0.5,'hl.L':0.55}, 0.0, 14, 2, spine=2, headbob=2)
cycle('run', 18, 38, 55, {'fl.L':0,'fl.R':0.08,'hl.L':0.5,'hl.R':0.58}, 0.0, 8, 1, spine=6, headbob=4)
# idle
new_action('idle')
for f in range(61):
    t=f/60; reset()
    P['chest'].rotation_euler.x=math.radians(1.5*math.sin(TWO*t*2))
    P['head'].rotation_euler.z=math.radians(6*math.sin(TWO*t))
    P['head'].rotation_euler.y=math.radians(4*math.sin(TWO*t+1))
    tailwag(t,18,2); key_all(f+1)
# sit: rotate hips (rear drops), compensate chest, fold hind legs
new_action('sit')
for f in range(61):
    t=f/60; reset()
    rx('hips',28,'u')           # front rises
    P['hips'].location = P['hips'].bone.matrix_local.to_3x3().inverted() @ Vector((0,0.0,-0.15))
    rx('chest',-6,'u'); rx('neck',10,'u'); rx('head',-8,'u')
    rx('fl_up.L',-24); rx('fl_up.R',-24)
    for s in 'LR':
        rx(f'hl_up.{s}',75); rx(f'hl_lo.{s}',-125); rx(f'hl_paw.{s}',50)
    P['head'].rotation_euler.z=math.radians(5*math.sin(TWO*t))
    tailwag(t,20,2); key_all(f+1)
# NLA: push each action to its own track so the glTF exporter sees all of them
ad=arm.animation_data; ad.action=None
for a in bpy.data.actions:
    tr=ad.nla_tracks.new(); tr.name=a.name; st=tr.strips.new(a.name,1,a); tr.mute=True
reset()
bpy.ops.wm.save_as_mainfile(filepath=out)
print('saved',out)
