/** Concept landmarks. Static geometry is batched per site, never across the whole island. */
import { Group, Mesh, MeshBasicMaterial, SphereGeometry, TorusGeometry, ConeGeometry, CylinderGeometry, Vector3, type Material } from 'three'
import { mergeStatic, type Kit } from './kit'
import { createProps, type Mats } from './props'
import { place } from './layout'
import type { Buildings } from './buildings'

export function createLandmarks(kit: Kit, ground: (x: number, z: number) => number, mats: Mats) {
  const group = new Group()
  group.name = 'concept-landmarks'
  const obstacles: Buildings['obstacles'] = []
  const decks: Buildings['decks'] = []
  const bulbs: Vector3[] = []
  const P = createProps(kit, mats)
  const wood = mats.wood, dark = mats.darkWood, white = mats.white, stone = mats.stone
  const teal = kit.pattern(kit.toon('#398F9B'), 'roof', 1.6)
  const coral = kit.toon('#DE8167'), blue = kit.toon('#77BCCA'), sand = kit.toon('#DCC39A')
  const ink = kit.toon('#344750'), green = kit.sway(kit.toon('#43875A'), .045)
  const brass = kit.toon('#D5B46D'), linen = kit.toon('#F1E8D4'), pink = kit.toon('#D693A4')
  const glow = kit.track(new MeshBasicMaterial({ color: '#F5D99A' }))
  const screen = kit.track(new MeshBasicMaterial({ color: '#BDDEE0' }))
  const sphere = kit.track(new SphereGeometry(1, 8, 6))
  const anims: ((t: number) => void)[] = []
  const sites: Record<string, Group> = {}
  const boxes: { x: number; z: number; w: number; d: number; y: number }[] = []
  function site(id: string, x: number, z: number, y = ground(x, z)) {
    const g = new Group(); g.name = id; g.position.set(x, y, z); group.add(g); sites[id] = g; return g
  }
  function ball(g: Group, x: number, y: number, z: number, r: number, m: Material, sy = 1) {
    const a = new Mesh(sphere, m); a.position.set(x,y,z); a.scale.set(r,r*sy,r); a.castShadow = true; g.add(a); return a
  }
  function bar(g: Group, a: number[], b: number[], radius = .045, mat: Material = dark) {
    const av = new Vector3(...a as [number,number,number]), bv = new Vector3(...b as [number,number,number]);
    const v = bv.clone().sub(av)
    const m = new Mesh(kit.track(new CylinderGeometry(radius,radius,v.length(),6)),mat)
    m.position.copy(av.add(bv).multiplyScalar(.5)); m.quaternion.setFromUnitVectors(new Vector3(0,1,0), v.normalize()); g.add(m)
  }
  function block(g: Group, x: number,z: number,w: number,d: number) {
    // Explicit local footprint samples, independent of merged rendering meshes.
    for(let u=-w/2;u<=w/2+.01;u+=.55) for(let v=-d/2;v<=d/2+.01;v+=.55)
      obstacles.push({x:g.position.x+x+u,z:g.position.z+z+v,r:.3})
  }
  function deck(g: Group,w: number,d: number,x=0,z=0,y=.18) {
    g.add(P.box(w,.22,d,wood,x,y-.22,z))
    decks.push({at:(px,pz)=>Math.abs(px-g.position.x-x)<=w/2 && Math.abs(pz-g.position.z-z)<=d/2 ? g.position.y+y : null})
    boxes.push({x:g.position.x+x,z:g.position.z+z,w,d,y:g.position.y+y})
  }
  function planter(g: Group,x: number,y: number,z: number) {
    g.add(P.box(.65,.48,.65,coral,x,y,z), P.box(.55,.04,.55,dark,x,y+.48,z))
    for(let j=0;j<5;j++){ const a=j*2.4; const leaf=ball(g,x+Math.cos(a)*.22,y+.75,z+Math.sin(a)*.22,.2,green,2); leaf.rotation.z=Math.sin(a)*.5 }
    for(let j=0;j<3;j++) ball(g,x+Math.cos(j*2)*.24,y+1.05,z+Math.sin(j*2)*.24,.09,pink)
  }
  function lights(g: Group,a: number[],b: number[],n=10) {
    for(let i=0;i<n;i++) {
      const t=i/(n-1), next=Math.min(1,(i+1)/(n-1));
      const pt=(u:number)=>[a[0]!+(b[0]!-a[0]!)*u,a[1]!+(b[1]!-a[1]!)*u-Math.sin(u*Math.PI)*.45,a[2]!+(b[2]!-a[2]!)*u]
      const p=pt(t); if(i<n-1) bar(g,p,pt(next),.018)
      ball(g,p[0]!,p[1]!-.12,p[2]!, .075,glow)
    }
  }
  function bench(g: Group,x:number,z:number,rot=0){const b=P.bench(2);b.position.set(x,.2,z);b.rotation.y=rot;g.add(b);block(g,x,z,2,.65)}
  function table(g:Group,x:number,z:number){g.add(P.cyl(.65,.65,.08,wood,x,.8,z,16),P.cyl(.06,.1,.8,dark,x,0,z));block(g,x,z,1.2,1.2)}
  function telescope(g:Group,x:number,y:number,z:number){
    for(let i=0;i<3;i++){const a=i*Math.PI*2/3;bar(g,[x+Math.cos(a)*.5,y,z+Math.sin(a)*.5],[x,y+1.1,z],.035,brass)}
    bar(g,[x-.55,y+1.35,z],[x+.5,y+1.65,z],.15,white);bar(g,[x+.5,y+1.65,z],[x+.58,y+1.68,z],.17,ink)
  }
  function fire(g:Group,x:number,z:number){
    for(let i=0;i<8;i++){const a=i*Math.PI/4;ball(g,x+Math.cos(a)*.8,.18,z+Math.sin(a)*.8,.22,stone)}
    for(let i=0;i<3;i++){const a=i*Math.PI/3;bar(g,[x-Math.cos(a)*.65,.25,z-Math.sin(a)*.65],[x+Math.cos(a)*.65,.25,z+Math.sin(a)*.65],.14,dark)}
    const flame=new Mesh(kit.track(new ConeGeometry(.4,1.15,7)),glow);flame.position.set(x,.85,z);g.add(flame);flame.userData.dynamic=true
    anims.push(t=>{flame.scale.y=.85+Math.sin(t*7)*.12;flame.rotation.y=t*.4})
    block(g,x,z,1.6,1.6)
  }
  function stall(g:Group,x:number,z:number,color:Material){
    g.add(P.box(2.7,1,1.6,wood,x,.2,z));
    for(const dx of [-1.35,1.35]) for(const dz of [-.85,.85]) g.add(P.box(.1,2.8,.1,white,x+dx,0,z+dz))
    for(let i=0;i<8;i++) {const aw=P.box(.4,.1,2.1,i%2?linen:color,x-1.4+i*.4,2.7,z);aw.rotation.x=.12;g.add(aw)}
    for(let i=0;i<7;i++) ball(g,x-1+i*.32,1.27,z,.13,i%2?green:coral)
    block(g,x,z,3,1.8)
  }
  function roofShell(g:Group,w:number,d:number,h:number){
    g.add(P.box(w,h,.22,white,0,0,-d/2),P.box(.22,h,d,white,-w/2,0,0),P.box(.22,h,d,white,w/2,0,0))
    g.add(P.gable(w,d,1.5,teal,wood,h))
    for(const x of [-w/2,w/2]) g.add(P.box(.18,h,.18,dark,x,0,d/2))
  }

  // A real open ground floor; the upper storey and roof cut away near the entrance.
  const hp=place('home'), home=site('home',hp.x,hp.z-4)
  const homeY=home.position.y
  deck(home,12,10,0,0,.22); deck(home,12,3,0,6.5,.22)
  home.add(P.box(12,3.4,.22,white,0,.22,-5),P.box(.22,3.4,10,white,-6,.22,0),P.box(.22,3.4,10,white,6,.22,0))
  block(home,0,-5,12,.25);block(home,-6,0,.25,10);block(home,6,0,.25,10)
  // Double opening with visible sliding leaves, no invisible collision across the doorway.
  for(const x of [-5,-2.2,2.2,5]) home.add(P.box(.14,3.4,.14,dark,x,.22,5))
  for(const x of [-4.6,4.6]) {home.add(P.box(2.4,2.5,.08,blue,x,.6,5));block(home,x,5,2.4,.2)}
  // living room, kitchen, record corner, pet furniture and equipment.
  home.add(P.box(3.4,.5,1.15,linen,.8,.45,1.7),P.box(3.4,.7,.22,linen,.8,.65,1.2))
  for(const x of [-.8,2.4]) home.add(P.box(.22,.8,1.2,linen,x,.45,1.7))
  for(const x of [-.2,1,1.9]) home.add(P.box(.6,.45,.18,blue,x,.95,1.42))
  home.add(P.box(2,.12,.9,wood,.8,.6,3.5),P.box(1.6,.5,.65,dark,.8,.22,3.5))
  block(home,.8,1.6,3.6,1.3);block(home,.8,3.5,2,.9)
  home.add(P.box(5,.85,.65,wood,1,.22,-4.4),P.box(5,.07,.75,linen,1,1.07,-4.4),P.box(2.8,.95,1.05,wood,.8,.22,-2))
  block(home,1,-4.4,5,.8);block(home,.8,-2,2.8,1.05)
  home.add(P.box(.9,2.1,.9,blue,4.6,.22,-4.3),P.box(.75,.07,.45,ink,1,1.15,-4.4))
  for(const x of [-1.1,0,1.1]) home.add(P.cyl(.23,.25,.65,dark,x,.22,-.8))
  home.add(P.box(.9,.85,.7,wood,-4.9,.22,1.2),P.cyl(.27,.27,.04,ink,-4.9,1.1,1.2,20))
  block(home,-4.9,1.2,1,.8)
  home.add(P.box(1.25,.3,.85,linen,4.6,.22,3.7),P.cyl(.12,.12,1.7,sand,4.8,.22,1.6),P.box(.8,.1,.7,wood,4.8,1.9,1.6))
  for(let i=0;i<4;i++){home.add(P.box(.24,.9,.12,i%2?brass:blue,-5.8,.9,-2+i*.45))}
  const board=ball(home,-5.7,1.55,3.1,.4,teal,3.2);board.scale.z=.12
  // upper storey is a separate batch so cutaway does not create per-mesh updates.
  const upper=new Group();home.add(upper)
  upper.add(P.box(12,.2,10,wood,0,3.6,0),P.box(12,3.2,.22,white,0,3.8,-5),P.box(.22,3.2,10,white,-6,3.8,0),P.box(.22,3.2,10,white,6,3.8,0))
  for(const x of [-5.9,-2,1.5,5.9]) upper.add(P.box(.16,3.2,.16,dark,x,3.8,5))
  for(const x of [-4,0,4]) upper.add(P.window(x,5.3,-5.13,Math.PI,2.5,1.7))
  // desk with dual screens, camera cabinet, bedroom and gym.
  upper.add(P.box(3,.12,1,wood,-3.6,4.6,-3.8))
  for(const x of [-4.3,-3]) upper.add(P.box(1.1,.7,.09,ink,x,4.8,-4),P.box(.98,.56,.02,screen,x,4.87,-3.94),P.box(.08,.22,.08,ink,x,4.6,-4))
  for(let i=0;i<5;i++) upper.add(P.box(.35,.23,.22,ink,-5.6,4+i*.43,-1.4),P.box(.7,.08,.6,wood,-5.6,3.9+i*.43,-1.4))
  upper.add(P.box(3,.5,3.4,wood,3.5,3.8,-1.4),P.box(3,.22,3.35,linen,3.5,4.3,-1.4),P.box(3,.13,2.1,blue,3.5,4.52,-.7))
  for(const x of [2.8,4.2]) upper.add(P.box(1.1,.22,.65,linen,x,4.52,-2.5))
  upper.add(P.box(1.5,.04,2.3,teal,0,3.82,0))
  for(const x of [-.7,.7]) upper.add(P.box(.09,2.5,.09,ink,x,3.8,-3))
  upper.add(P.box(1.6,.09,.09,ink,0,6.25,-3));ball(upper,.4,4,-1.3,.2,ink)
  // staircase stays within the shell, with a clear circulation strip.
  for(let i=0;i<16;i++) home.add(P.box(1.25,(i+1)*.2125,.28,wood,-4.8,.22,3.9-i*.28))
  block(home,-4.8,2,1.3,4.5)
  const roof=new Group();home.add(roof)
  roof.add(P.box(12,.2,10,wood,0,7,0))
  for(const x of [-6,6]) {roof.add(P.box(.12,1,.12,white,x,7.2,5),P.box(.12,1,.12,white,x,7.2,-5));bar(roof,[x,8.1,-5],[x,8.1,5],.055,white)}
  for(const z of [-5,5])bar(roof,[-6,8.1,z],[6,8.1,z],.055,white)
  const canopy=P.gable(6,4,1.2,teal,white,7.2);canopy.position.set(-3,0,-2.5);roof.add(canopy)
  telescope(roof,4,7.2,3);planter(roof,5,7.2,-4);planter(roof,-5,7.2,4)
  for(const x of [-1.5,1.5]) roof.add(P.box(.12,1.6,.12,wood,x,7.2,1.8))
  for(let i=0;i<12;i++) {const x=-1.5+i*3/11; roof.add(P.box(.28,.06,.8,linen,x,8.15-.45*Math.sin(i/11*Math.PI),1.8))}
  lights(roof,[-5,8.5,4],[5,8.5,4],14)
  for(const x of [-5.2,5.2]) planter(home,x,.22,6.5)
  home.add(P.box(.45,.5,.4,coral,7,.9,6),P.box(.1,.9,.1,dark,7,0,6))
  for(let i=0;i<3;i++){home.add(P.box(1.5,.4,.8,wood,7,.1,-3+i*1.4));for(let j=0;j<4;j++)ball(home,6.5+j*.33,.7,-3+i*1.4,.18,green)}
  bar(home,[6.5,.2,1],[6.5,2.6,1],.05,brass);bar(home,[6.5,2.6,1],[7,2.6,1],.05,brass)
  // Individually merge parts that can be hidden, then the ground-floor structure.
  home.remove(upper,roof);mergeStatic(home,kit.track);mergeStatic(upper,kit.track);mergeStatic(roof,kit.track);home.add(upper,roof)
  let indoor=false
  function updateHome(x:number,z:number){
    const next=Math.abs(x-hp.x)<5.8 && z>home.position.z-4.8 && z<home.position.z+7.5
    if(next!==indoor){indoor=next;upper.visible=!next;roof.visible=!next}
    return next
  }

  // Harbour studio: open boathouse, screens and gallery face the bay.
  const wp=place('work'), studio=site('studio',wp.x,wp.z-4)
  deck(studio,10,11,0,1,.15);roofShell(studio,9,7,4.2)
  block(studio,0,-3.5,9,.25);block(studio,-4.5,0,.25,7);block(studio,4.5,0,.25,7)
  studio.add(P.box(4,.15,1.1,wood,0,1,-2),P.box(.16,1,1,ink,-1.8,0,-2),P.box(.16,1,1,ink,1.8,0,-2))
  for(const x of [-1,1])studio.add(P.box(1.5,.9,.1,ink,x,1.25,-2.2),P.box(1.35,.75,.02,screen,x,1.32,-2.13))
  for(let i=0;i<6;i++)studio.add(P.box(.9,.65,.06,i%2?blue:coral,-3+i*1.2,2.6,-3.35))
  studio.add(P.box(.45,.3,.3,ink,2.8,1.1,-2));bar(studio,[2.8,1.25,-2],[2.8,1.25,-1.7],.12,ink)
  bench(studio,-2.7,4.8);planter(studio,4,.15,5.2);planter(studio,-4,.15,5.2)
  lights(studio,[-4,3.6,3.6],[4,3.6,3.6]);block(studio,0,-2,4,1.1)
  mergeStatic(studio,kit.track)

  // Amusement pier: a branching boardwalk with independent animated batches.
  const pier=site('amusement',-9,58,1.5)
  deck(pier,5,20,0,-7,.1);deck(pier,29,18,0,11,.1)
  for(const x of [-14,14])for(let z=3;z<=19;z+=4){pier.add(P.cyl(.18,.22,5,dark,x,-4.9,z));pier.add(P.box(.12,1.1,.12,white,x,.1,z))}
  for(const x of [-14,14])bar(pier,[x,1.1,3],[x,1.1,20],.045,white)
  for(let x=-14;x<=14;x+=4)pier.add(P.cyl(.2,.24,5,dark,x,-4.9,20))
  bar(pier,[-14,1.1,20],[14,1.1,20],.045,white)
  for(const x of [-11,11]){pier.add(P.box(.16,4.2,.16,dark,x,.1,3),P.box(.16,4.2,.16,dark,x,.1,19));lights(pier,[x,4.3,3],[x,4.3,19],16)}
  stall(pier,9,7,teal);stall(pier,9,13,coral);bench(pier,0,18);planter(pier,12,.1,18);planter(pier,-12,.1,18)
  const wheel=new Group();wheel.position.set(-7,8.4,12)
  for(const z of [10.8,13.2]) {bar(pier,[-10,.1,z],[-7,8.4,z],.18,white);bar(pier,[-4,.1,z],[-7,8.4,z],.18,white)}
  const hoopGeo=kit.track(new TorusGeometry(6.3,.09,6,64))
  for(const z of [-.65,.65]){const ring=new Mesh(hoopGeo,white);ring.position.z=z;wheel.add(ring)}
  for(let i=0;i<12;i++){const a=i*Math.PI/6;for(const z of [-.65,.65])bar(wheel,[0,0,z],[Math.cos(a)*6.3,Math.sin(a)*6.3,z],.045,brass);ball(wheel,Math.cos(a)*6.3,Math.sin(a)*6.3,.7,.13,glow)}
  mergeStatic(wheel,kit.track)
  const cabins:Group[]=[]
  for(let i=0;i<12;i++){const c=new Group();c.add(P.box(1.2,.65,1.4,[blue,coral,linen,pink][i%4]!,0,-.9,0),P.box(1.35,.12,1.5,linen,0,.5,0));for(const x of [-.55,.55])for(const z of [-.6,.6])c.add(P.box(.045,1.1,.045,white,x,-.5,z));mergeStatic(c,kit.track);cabins.push(c);wheel.add(c)}
  block(pier,-7,12,8,4)
  anims.push(t=>{const r=t*.045;wheel.rotation.z=r;cabins.forEach((c,i)=>{const a=i*Math.PI/6;c.position.set(Math.cos(a)*6.3,Math.sin(a)*6.3,0);c.rotation.z=-r})})
  const carousel=new Group();carousel.position.set(1,.1,8)
  carousel.add(P.cyl(3.1,3.2,.3,wood,0,0,0,32),P.cyl(.18,.18,4,brass,0,.3,0))
  const cone=new Mesh(kit.track(new ConeGeometry(3.6,1.6,16)),teal);cone.position.y=4.5;carousel.add(cone)
  for(let i=0;i<8;i++){const a=i*Math.PI/4,x=Math.cos(a)*2.2,z=Math.sin(a)*2.2;carousel.add(P.cyl(.045,.045,3.4,brass,x,.3,z));const horse=new Group();ball(horse,0,1.3,0,.4,linen,.6);ball(horse,.4,1.65,0,.2,linen,1.6);for(const dx of [-.25,.25])for(const dz of [-.15,.15])bar(horse,[dx,.8,dz],[dx,1.3,dz],.05,linen);horse.position.set(x,0,z);horse.rotation.y=-a;carousel.add(horse);ball(carousel,x,3.7,z,.1,glow)}
  mergeStatic(carousel,kit.track);anims.push(t=>{carousel.rotation.y=t*.15});block(pier,1,8,6.4,6.4)
  // Arcade canopy with distinct luminous cabinets.
  for(let i=0;i<3;i++){const x=1+i*1.2;pier.add(P.box(.9,1.7,.8,i%2?coral:teal,x,.1,14),P.box(.68,.65,.04,screen,x,.9,14.43),P.box(.7,.1,.4,ink,x,.75,14.5));block(pier,x,14,1,.9)}
  mergeStatic(pier,kit.track);pier.add(wheel,carousel)

  // Beach park on piles: all paths remain above water at the narrow sandbar.
  const beach=site('beach',-40,46,1.35);deck(beach,25,15,0,4,.1)
  beach.add(P.box(7,4,.18,linen,0,1.1,10),P.box(7.4,.15,.3,dark,0,5.1,10))
  for(const x of [-3.4,3.4])beach.add(P.box(.13,5,.13,dark,x,.1,10))
  block(beach,0,10,7,.3)
  for(let row=0;row<3;row++)for(const x of [-2.5,0,2.5]){const seat=P.box(1,.1,1.6,linen,x,.45,3+row*1.9);seat.rotation.x=-.15;beach.add(seat,P.box(1,.5,.2,wood,x,.1,3+row*1.9-.65));block(beach,x,3+row*1.9,1,1.6)}
  stall(beach,-8,8,teal);fire(beach,8,7)
  for(const z of [1,3,5]){beach.add(P.box(2.3,.1,.15,wood,9,.8,z),P.box(.12,1.5,.12,wood,8,.1,z),P.box(.12,1.5,.12,wood,10,.1,z));const kayak=ball(beach,9,1,z,.4,z===3?coral:blue);kayak.scale.set(1.7,.25,.35)}
  lights(beach,[-11,4,0],[11,4,0],18)
  for(const x of [-11,11])beach.add(P.box(.12,4,.12,dark,x,.1,0))
  mergeStatic(beach,kit.track)

  const dive=site('dive',36,103);deck(dive,11,10,0,0,.2);roofShell(dive,8,6,3.4)
  block(dive,0,-3,8,.3);block(dive,-4,0,.3,6);block(dive,4,0,.3,6)
  for(let i=0;i<6;i++){dive.add(P.cyl(.18,.18,1.1,i%2?brass:white,-3+i*.48,.2,2.5),P.box(.13,.14,.12,ink,-3+i*.48,1.3,2.5));}
  dive.add(P.box(2,1.1,.7,wood,1.9,.2,1.3));block(dive,1.9,1.3,2,.8)
  for(let i=0;i<3;i++){dive.add(P.box(.5,1.1,.1,ink,-2+i*1.2,1.2,-2.8),P.box(.15,.65,.1,ink,-2.17+i*1.2,.6,-2.8),P.box(.15,.65,.1,ink,-1.83+i*1.2,.6,-2.8))}
  dive.add(P.box(.12,4.8,.12,white,5,0,3),P.box(1.2,.75,.04,coral,5.6,3.9,3));bar(dive,[5.05,4.6,3.04],[6.15,3.95,3.04],.075,white)
  for(let i=0;i<3;i++)dive.add(P.box(1.8,.25,.1,i%2?blue:linen,-5,1.6+i*.4,3))
  dive.add(P.box(.12,3,.12,dark,-5,0,3));planter(dive,4,.2,4);mergeStatic(dive,kit.track)

  const lp=place('lighthouse'), lookout=site('lookout',lp.x,lp.z)
  for(const x of [-4.4,4.4]) {bench(lookout,x,4,Math.PI/2);planter(lookout,x,0,-3)}
  lookout.add(P.box(2.6,.1,.65,wood,0,.75,4.8),P.box(2.6,.1,.65,wood,0,1.45,4.8))
  for(const x of [-1.2,1.2])lookout.add(P.box(.1,1.9,.1,dark,x,0,4.8))
  for(let i=0;i<8;i++){lookout.add(P.cyl(.1,.12,.3,i%2?blue:green,-1+i*.29,.85,4.8),P.cyl(.04,.04,.12,brass,-1+i*.29,1.15,4.8))}
  block(lookout,0,4.8,2.6,.7);mergeStatic(lookout,kit.track)

  const camp=site('camp',157,-55)
  for(const [x,z,c] of [[-3,0,coral],[3,1,teal]] as const){const tent=P.gable(3.4,4,2,c,linen,0,.05,.08);tent.position.set(x,0,z);camp.add(tent);block(camp,x,z,3.5,4)}
  fire(camp,0,5.5);telescope(camp,3,0,-4);lights(camp,[-5,3,4],[5,3,4]);for(const x of [-5,5])camp.add(P.box(.12,3,.12,wood,x,0,4));mergeStatic(camp,kit.track)

  const construction=site('construction',174,20)
  construction.add(P.box(4,.4,4,stone,0,0,0))
  for(const x of [-.6,.6])for(const z of [-.6,.6])construction.add(P.box(.15,12,.15,brass,x,.4,z))
  for(let y=1;y<12;y+=1.2)for(const z of [-.6,.6])bar(construction,[-.6,y,z],[.6,y+1.2,z],.06,brass)
  bar(construction,[-5,12,0],[10,12,0],.14,brass);bar(construction,[-5,12,0],[0,14,0],.06,ink);bar(construction,[0,14,0],[10,12,0],.06,ink)
  bar(construction,[8,12,0],[8,3,0],.025,ink);construction.add(P.box(1.8,.6,1.5,stone,-4,11.3,0),P.box(1.4,1.4,1.4,blue,1,10,0))
  for(let i=0;i<5;i++)construction.add(P.box(3,.22,.35,wood,-5,.2+i*.22,4))
  for(const x of [-5,0,5]){construction.add(P.box(3,.4,.15,coral,x,1,7));block(construction,x,7,3,.3)}
  block(construction,0,0,4,4);mergeStatic(construction,kit.track)
  return {group,obstacles,decks,bulbs,sites,boxes,homeY,updateHome,
    update(t:number,night:number){glow.color.setRGB(1,.74+night*.12,.36+night*.18);for(const fn of anims)fn(t)},
  }
}
