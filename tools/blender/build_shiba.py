import bpy, bmesh, math, sys
from mathutils import Vector, Matrix, Euler

OUT = sys.argv[-1] if sys.argv[-1].endswith('.blend') else '/tmp/claude-0/c2/b3d/shiba.blend'
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene

def M(loc, scale=(1,1,1), rot=(0,0,0)):
    return Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*scale,1))

def sphere(bm, loc, r, scale=(1,1,1), rot=(0,0,0), seg=24):
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg//2+2, radius=r, matrix=M(loc,scale,rot))

def capsule(bm, a, b, r1, r2, n=8):
    a, b = Vector(a), Vector(b)
    for i in range(n+1):
        t = i/n
        sphere(bm, a.lerp(b,t), r1+(r2-r1)*t, seg=16)

# ---------- body volumes (meters, Z up, dog faces -Y) ----------
bm = bmesh.new()
sphere(bm, (0, 0.00, 0.300), 1, (0.110, 0.185, 0.105))      # torso
sphere(bm, (0,-0.13, 0.310), 0.112, (1,1,1.05))             # chest
sphere(bm, (0, 0.14, 0.300), 0.098)                         # hips
sphere(bm, (0,-0.215,0.395), 1, (0.075,0.075,0.095), (math.radians(-35),0,0))  # neck
sphere(bm, (0,-0.270,0.500), 0.092, (1.05,1.0,0.95))        # head
sphere(bm, (0,-0.350,0.468), 1, (0.050,0.060,0.040), (math.radians(8),0,0))    # muzzle
for sx in (-1,1):
    sphere(bm, (sx*0.055,-0.255,0.465), 0.048)               # cheeks (shiba fluff)
    # ears: flattened cones tilted outward
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.046, radius2=0.006, depth=0.095,
        matrix=M((sx*0.052,-0.258,0.600),(1,0.42,1),(math.radians(-6),math.radians(sx*12),0)))
    # front legs
    capsule(bm, (sx*0.060,-0.140,0.270), (sx*0.058,-0.150,0.040), 0.046, 0.036)
    sphere(bm, (sx*0.058,-0.165,0.030), 1, (0.038,0.048,0.030))   # front paw
    # hind legs: thigh + hock + paw
    sphere(bm, (sx*0.064, 0.130,0.255), 1, (0.056,0.080,0.090))
    capsule(bm, (sx*0.064, 0.165,0.200), (sx*0.062, 0.185,0.110), 0.042, 0.036, 5)
    capsule(bm, (sx*0.062, 0.185,0.110), (sx*0.062, 0.160,0.040), 0.036, 0.034, 5)
    sphere(bm, (sx*0.062, 0.148,0.030), 1, (0.038,0.048,0.030))   # hind paw
# tail: curled over the back
tail_pts = [(0,0.200,0.355),(0,0.240,0.400),(0,0.252,0.450),(0,0.230,0.495),(0,0.190,0.510),(0,0.155,0.495),(0,0.150,0.465),(0,0.170,0.450)]
tail_r = [0.040,0.045,0.047,0.046,0.043,0.038,0.032,0.026]
for i in range(len(tail_pts)-1):
    a,b = Vector(tail_pts[i]),Vector(tail_pts[i+1])
    for k in range(4):
        t=k/4; sphere(bm, a.lerp(b,t), tail_r[i]+(tail_r[i+1]-tail_r[i])*t, seg=16)

raw = bpy.data.meshes.new('shiba_raw'); bm.to_mesh(raw); bm.free()
body = bpy.data.objects.new('Shiba_Body', raw); scn.collection.objects.link(body)

# ---------- remesh -> smooth -> decimate (evaluated, no ops) ----------
rm = body.modifiers.new('remesh','REMESH'); rm.mode='VOXEL'; rm.voxel_size=0.0055; rm.adaptivity=0
sm = body.modifiers.new('smooth','SMOOTH'); sm.factor=0.8; sm.iterations=12
dc = body.modifiers.new('decimate','DECIMATE'); dc.ratio=0.12
dg = bpy.context.evaluated_depsgraph_get()
me = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
body.modifiers.clear(); old = body.data; body.data = me; bpy.data.meshes.remove(old); me.name='Shiba_Body'
for p in me.polygons: p.use_smooth = True
print('tris', sum(len(p.vertices)-2 for p in me.polygons))

# ---------- vertex colors ----------
ORANGE=(0.86,0.55,0.25); CREAM=(0.97,0.90,0.78); INNER=(0.95,0.78,0.70)
def lin(c): return tuple((x/12.92 if x<=0.04045 else ((x+0.055)/1.055)**2.4) for x in c)+(1.0,)
col = me.color_attributes.new('Col','FLOAT_COLOR','POINT')
me.calc_loop_triangles() if hasattr(me,'calc_loop_triangles') else None
def inside_ell(p,c,r):
    d = Vector(((p.x-c[0])/r[0],(p.y-c[1])/r[1],(p.z-c[2])/r[2])); return d.length
import math as _m
lab=[0]*len(me.vertices)   # 0 orange, 1 cream, 2 inner ear
for v in me.vertices:
    p=v.co; n=v.normal; L=0
    if inside_ell(p,(0,-0.352,0.460),(0.062,0.080,0.052))<1.12: L=1          # muzzle
    for sx in (-1,1):
        if inside_ell(p,(sx*0.058,-0.290,0.452),(0.045,0.055,0.038))<1.0: L=1  # cheeks
        if (p-Vector((sx*0.034,-0.333,0.562))).length<0.014: L=1               # eyebrow dots
    if inside_ell(p,(0,-0.215,0.330),(0.072,0.095,0.120))<1.0 and p.y<-0.17: L=1  # throat + chest
    if p.z<0.225 and -0.17<p.y<0.20 and abs(p.x)<0.085: L=1                  # belly
    if p.z<0.115: L=1                                                        # socks
    for sx,yy in ((1,-0.145),(-1,-0.145)):
        if p.z<0.26 and abs(p.y-yy)<0.05 and p.y<yy+0.0 and sx*p.x>0 and abs(p.x)<0.11 and n.y<-0.5: L=1  # front of front legs
    if p.y>0.12 and p.z>0.40 and inside_ell(p,(0,0.195,0.462),(0.04,0.045,0.035))<1.3: L=1  # inner tail curl
    for sx in (-1,1):
        q=p-Vector((sx*0.052,-0.258,0.600))
        if q.z>-0.03 and n.y<-0.6 and abs(q.x)<0.022*(1-(q.z+0.03)/0.09)+0.004: L=2  # inner ear
    lab[v.index]=L
nb=[[] for _ in me.vertices]
for e in me.edges: a_,b_=e.vertices; nb[a_].append(b_); nb[b_].append(a_)
for _ in range(2):
    new=lab[:]
    for i,ns in enumerate(nb):
        if not ns: continue
        cnt={}
        for j in ns+[i]: cnt[lab[j]]=cnt.get(lab[j],0)+1
        best=max(cnt,key=cnt.get)
        if cnt[best]>len(ns)*0.6: new[i]=best
    lab=new
for i,Lb in enumerate(lab): col.data[i].color=lin((ORANGE,CREAM,INNER)[Lb])

def mat(name, rgb, use_vc=False):
    m=bpy.data.materials.new(name); m.use_nodes=True
    bsdf=m.node_tree.nodes['Principled BSDF']; bsdf.inputs['Roughness'].default_value=0.9
    if use_vc:
        a=m.node_tree.nodes.new('ShaderNodeVertexColor'); a.layer_name='Col'
        m.node_tree.links.new(a.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value=lin(rgb)
    return m
body.data.materials.append(mat('M_Shiba_Fur',None,True))

# ---------- eyes, nose ----------
def small(name, loc, r, scale, rgb, rot=(0,0,0)):
    b=bmesh.new(); bmesh.ops.create_uvsphere(b,u_segments=16,v_segments=10,radius=r,matrix=M(loc,scale,rot))
    m=bpy.data.meshes.new(name); b.to_mesh(b and m); b.free()
    for p in m.polygons: p.use_smooth=True
    o=bpy.data.objects.new(name,m); scn.collection.objects.link(o); o.data.materials.append(mat('M_'+name,rgb)); return o
eyes=[]
for sx,s in ((1,'L'),(-1,'R')):
    eyes.append(small('Eye.'+s,(sx*0.040,-0.343,0.530),0.0125,(0.85,0.6,1.1),(0.2,1,0.1)[0:1] and (0.25,0.12,0.08) and (0.16,0.10,0.07)))
nose=small('Nose',(0,-0.408,0.488),0.016,(1.1,0.85,0.75),(0.16,0.10,0.09))
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('saved',OUT)
