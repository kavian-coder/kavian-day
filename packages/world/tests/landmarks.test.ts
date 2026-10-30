import assert from 'node:assert/strict'
import { Box3, Mesh, Vector3 } from 'three'
import { createKit } from '../src/kit'
import { createLandmarks } from '../src/landmarks'
const kit = createKit(false)
const m = kit.toon('#ffffff')
const world = createLandmarks(kit, () => 2, { win:m,bulb:m,white:m,wood:m,darkWood:m,stone:m,metal:m })
world.group.updateMatrixWorld(true)
let meshCount=0
world.group.traverse(o=>{
  if(!(o as Mesh).isMesh)return
  meshCount++
  const box = new Box3().setFromObject(o)
  assert.ok([...box.min.toArray(),...box.max.toArray()].every(Number.isFinite), `Invalid bounds: ${o.name}`)
})
assert.ok(meshCount < 260, `Landmark mesh budget exceeded: ${meshCount}`)
// The entrance has no old circular whole-house collider.
for(let z=-9;z<=-5;z+=.25) assert.ok(!world.obstacles.some(o=>Math.hypot(o.x-84,o.z-z)<o.r+.4), `Entrance blocked at ${z}`)
assert.equal(world.updateHome(84,-9),true)
assert.equal(world.updateHome(84,3),false)
assert.ok(world.decks.some(d=>d.at(-9,43)!==null),'Pier must connect to shore')
const dynamic:Mesh[]=[]
world.group.traverse(o=>{if(o.userData.dynamic)dynamic.push(o as Mesh)})
assert.equal(dynamic.length,2,'Beach and campsite flames survive static batching')
world.update(3,1)
for(const flame of dynamic)assert.ok(flame.parent && flame.scale.y!==1)
assert.ok(new Box3().setFromObject(world.group).getSize(new Vector3()).length()>100)
kit.disposeAll()
console.log(`Landmarks: ${meshCount} meshes; finite geometry, entrance, deck and animation checks passed`)
