/**
 * 海里和海滩上的生物。
 * - 鱼群：沿着礁盘绕岛游，不同颜色的几群；夜里少一些、游得深一些
 * - 海龟：春夏多，慢慢游
 * - 海豚：白天在外海跃出水面；暴风雨天不出来
 * - 鲸：冬春洄游季节在远海换气喷水
 * - 水母：夏秋在海湾里漂，夜里会发光
 * - 珊瑚和海草：固定在礁盘上，海草随水流摆
 * - 海星、贝壳：在沙滩和浅水里（螃蟹在 ecology.ts，和岛上的动物一起处理碰撞和躲避）
 * - 鱼、海龟、水母、珊瑚都绕开栈桥的桩子；有人站在栈桥上时，下面的鱼会散开
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { bySeason, clamp01, type EcoState } from './eco'
import { paint, type Kit } from './kit'
import { PIER, coastPoint, outerPoint, shore } from './layout'
import { fbm, rng } from './noise'
import { LAYER_NO_REFLECT } from './water'

export interface SeaLife {
  group: Group
  /** player：角色位置，靠近时鱼会散开 */
  update: (dt: number, t: number, eco: EcoState, player?: { x: number; z: number }) => void
}

/** 绕岛的一点：离海岸 off 米（正数在海里） */
function around(theta: number, off: number, out = new Vector3()) {
  // 离岸 30 米以内沿着主岛海岸线（也会游进海湾）；更远的走外海一圈
  const [x, z] = off > 30 ? outerPoint(theta, off - 30) : coastPoint(theta / (Math.PI * 2), off)
  return out.set(x, 0, z)
}

/** 绕开栈桥和灯塔：在桩子范围里就推到栈桥两边 */
function avoidPier(p: { x: number; z: number }, margin: number) {
  const hx = PIER.half + margin
  if (p.z > PIER.z0 - 1 && p.z < PIER.z1 + 0.5 && Math.abs(p.x - PIER.x) < hx) p.x = PIER.x + (p.x >= PIER.x ? hx : -hx)
  return p
}

function fishGeo() {
  const body = new IcosahedronGeometry(1, 1)
  body.scale(0.09, 0.13, 0.32)
  paint(body, '#FFFFFF')
  // 背部深一点
  const col = body.getAttribute('color')
  const pos = body.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const k = pos.getY(i) > 0.03 ? 0.72 : 1
    col.setXYZ(i, k, k, k)
  }
  const tail = new BufferGeometry()
  tail.setAttribute('position', new Float32BufferAttribute([0, 0, -0.26, 0, 0.14, -0.46, 0, -0.14, -0.46], 3))
  tail.setAttribute('normal', new Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3))
  tail.setAttribute('uv', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2))
  paint(tail, '#C8C8C8')
  const b = body.index ? body.toNonIndexed() : body.clone()
  body.dispose()
  const g = mergeGeometries([b, tail])!
  b.dispose()
  tail.dispose()
  return g
}

export function createSeaLife(kit: Kit, groundAt: (x: number, z: number) => number): SeaLife {
  const group = new Group()
  const R = rng(4242)
  const m4 = new Matrix4()
  const q = new Quaternion()
  const v = new Vector3()
  const sc = new Vector3()
  const up = new Vector3(0, 1, 0)
  const noReflect = <T extends { layers: { set: (n: number) => void } }>(o: T) => {
    o.layers.set(LAYER_NO_REFLECT)
    return o
  }

  // ======================================================================
  // 鱼群
  // ======================================================================
  const fishMat = kit.toon(0xffffff, { vertexColors: true })
  const fGeo = kit.track(fishGeo())
  const SCHOOLS = [
    { color: '#F28A3A', n: 16, off: 14, speed: 0.012, th: 0.4 },
    { color: '#4F86E0', n: 20, off: 18, speed: -0.009, th: 1.9 },
    { color: '#F2D24C', n: 14, off: 11, speed: 0.015, th: 3.2 },
    { color: '#D9E3EA', n: 24, off: 22, speed: 0.008, th: 4.4 },
    { color: '#E25A7A', n: 12, off: 13, speed: -0.013, th: 5.4 },
    { color: '#58C2B0', n: 16, off: 16, speed: 0.011, th: 2.6 },
  ]
  const schools = SCHOOLS.map((s) => {
    const im = noReflect(new InstancedMesh(fGeo, fishMat, s.n))
    const base = new Color(s.color)
    const c = new Color()
    for (let i = 0; i < s.n; i++) im.setColorAt(i, c.copy(base).multiplyScalar(0.85 + R() * 0.3))
    im.frustumCulled = false
    group.add(im)
    const offs = Array.from({ length: s.n }, () => new Vector3((R() - 0.5) * 4, (R() - 0.5) * 0.8, (R() - 0.5) * 4))
    return { ...s, im, offs, ph: R() * 10 }
  })

  // ======================================================================
  // 海龟
  // ======================================================================
  const shellMat = kit.pattern(kit.toon('#6B8F4E'), 'stone', 3, 0.6)
  const skinMat = kit.toon('#9DB07A')
  const turtles = Array.from({ length: 2 }, (_, i) => {
    const g = new Group()
    const shell = new Mesh(kit.track(new SphereGeometry(0.7, 14, 10)), shellMat)
    shell.scale.set(1, 0.38, 1.25)
    const head = new Mesh(kit.track(new SphereGeometry(0.2, 10, 8)), skinMat)
    head.position.set(0, 0.05, 0.95)
    const flips: Mesh[] = []
    for (const [x, z] of [
      [0.7, 0.45],
      [-0.7, 0.45],
      [0.55, -0.6],
      [-0.55, -0.6],
    ] as const) {
      const f = new Mesh(kit.track(new SphereGeometry(0.35, 8, 6)), skinMat)
      f.scale.set(1, 0.15, 0.45)
      f.position.set(x, 0, z)
      flips.push(f)
      g.add(f)
    }
    g.add(shell, head)
    noReflect(g)
    g.traverse((o) => o.layers.set(LAYER_NO_REFLECT))
    group.add(g)
    return { g, flips, th: i * 3 + 1, off: 19 + i * 4 }
  })

  // ======================================================================
  // 海豚
  // ======================================================================
  const dolphinMat = kit.toon(0xffffff, { vertexColors: true })
  const dGeo = (() => {
    const body = new SphereGeometry(1, 16, 10)
    body.scale(0.32, 0.34, 1.25)
    const pos = body.getAttribute('position')
    const col: number[] = []
    for (let i = 0; i < pos.count; i++) {
      const belly = pos.getY(i) < -0.08
      col.push(...(belly ? [0.88, 0.9, 0.92] : [0.42, 0.52, 0.62]))
    }
    body.setAttribute('color', new Float32BufferAttribute(col, 3))
    const fin = new ConeGeometry(0.16, 0.45, 4)
    fin.translate(0, 0.42, -0.1)
    fin.rotateX(-0.4)
    paint(fin, '#5E7184')
    const fluke = new SphereGeometry(0.5, 8, 4)
    fluke.scale(1, 0.08, 0.35)
    fluke.translate(0, 0, -1.25)
    paint(fluke, '#5E7184')
    const beak = new ConeGeometry(0.1, 0.4, 8)
    beak.rotateX(Math.PI / 2)
    beak.translate(0, -0.06, 1.35)
    paint(beak, '#6A7D90')
    const parts = [body, fin, fluke, beak].map((p) => (p.index ? p.toNonIndexed() : p))
    const g = mergeGeometries(parts)!
    g.computeVertexNormals()
    return kit.track(g)
  })()
  const dolphins = Array.from({ length: 4 }, (_, i) => {
    const m = new Mesh(dGeo, dolphinMat)
    m.castShadow = false
    group.add(m)
    return { m, ph: i * 0.55, th: 2.0 + i * 0.05, lane: 46 + (i % 2) * 3 }
  })

  // ======================================================================
  // 鲸：远海换气
  // ======================================================================
  const whaleMat = kit.toon('#3E5468')
  const whale = new Mesh(kit.track(new SphereGeometry(1, 20, 12)), whaleMat)
  whale.scale.set(3.2, 1.6, 11)
  group.add(whale)
  const puffCanvas = document.createElement('canvas')
  puffCanvas.width = puffCanvas.height = 64
  {
    const g = puffCanvas.getContext('2d')!
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30)
    grd.addColorStop(0, 'rgba(255,255,255,0.95)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 64, 64)
  }
  const puffTex = kit.track(new CanvasTexture(puffCanvas))
  puffTex.colorSpace = SRGBColorSpace
  const spray = Array.from({ length: 14 }, () => {
    const s = new Sprite(kit.track(new SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false })))
    group.add(s)
    return { s, vx: (R() - 0.5) * 2, vy: 7 + R() * 4, vz: (R() - 0.5) * 2 }
  })
  const whaleTheta = -2.3

  // ======================================================================
  // 水母
  // ======================================================================
  const jellyMat = kit.track(new MeshBasicMaterial({ color: '#F4B6D8', transparent: true, opacity: 0.55, depthWrite: false }))
  const jellyGlow = kit.track(new MeshBasicMaterial({ color: '#9FE8FF', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }))
  const jellies = Array.from({ length: 9 }, () => {
    const g = new Group()
    const dome = new Mesh(kit.track(new SphereGeometry(0.35, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), jellyMat)
    const glow = new Mesh(kit.track(new SphereGeometry(0.6, 10, 8)), jellyGlow)
    g.add(dome, glow)
    for (let k = 0; k < 5; k++) {
      const tent = new Mesh(kit.track(new CylinderGeometry(0.015, 0.01, 0.9, 3)), jellyMat)
      const a = (k / 5) * Math.PI * 2
      tent.position.set(Math.cos(a) * 0.18, -0.45, Math.sin(a) * 0.18)
      g.add(tent)
    }
    const x = PIER.x + (R() - 0.5) * 30
    const z = PIER.z0 + 6 + R() * 26
    g.position.set(x, -0.8, z)
    g.traverse((o) => o.layers.set(LAYER_NO_REFLECT))
    group.add(g)
    return { g, x, z, ph: R() * 6 }
  })

  // ======================================================================
  // 珊瑚和海草（静态）
  // ======================================================================
  {
    const coralA = new IcosahedronGeometry(0.6, 1)
    coralA.scale(1, 0.6, 1)
    const branches: BufferGeometry[] = []
    for (let i = 0; i < 5; i++) {
      const c = new ConeGeometry(0.12, 1.1, 5)
      c.translate(0, 0.55, 0)
      c.rotateZ((R() - 0.5) * 0.9)
      c.rotateY(R() * 6)
      branches.push(c.index ? c.toNonIndexed() : c.clone())
      c.dispose()
    }
    const coralB = mergeGeometries(branches)!
    branches.forEach((b) => b.dispose())
    const weed = new PlaneGeometry(0.25, 2.2, 1, 6)
    weed.translate(0, 1.1, 0)
    const coralMat = kit.pattern(kit.toon(0xffffff), 'gravel', 4, 0.5)
    const weedMat = kit.sway(kit.toon('#4E8A55', { side: DoubleSide }), 0.08, 0)
    const spots: { x: number; z: number; y: number }[] = []
    for (let i = 0; i < 4000 && spots.length < 420; i++) {
      const th = R() * Math.PI * 2
      const off = 8 + R() * 22
      const p = around(th, off)
      const y = groundAt(p.x, p.z)
      if (y > -0.9 || y < -4.5) continue
      if (Math.abs(p.x - PIER.x) < PIER.half + 1.5 && p.z > PIER.z0 - 2 && p.z < PIER.z1 + 4) continue
      if (fbm(p.x * 0.09 - 3, p.z * 0.09 + 8) * 0.5 + 0.5 < 0.52) continue
      spots.push({ x: p.x, z: p.z, y })
    }
    const PAL = ['#F07C8C', '#F4A05A', '#B48AE0', '#F2D46A', '#E85A5A', '#7FD0C8'].map((c) => new Color(c))
    const mkInst = (geo: BufferGeometry, mat: Material, list: typeof spots, scale: [number, number], colored: boolean) => {
      const im = noReflect(new InstancedMesh(kit.track(geo), mat, list.length))
      list.forEach((s, i) => {
        q.setFromAxisAngle(up, R() * 6)
        m4.compose(v.set(s.x, s.y - 0.1, s.z), q, sc.setScalar(scale[0] + R() * (scale[1] - scale[0])))
        im.setMatrixAt(i, m4)
        if (colored) im.setColorAt(i, PAL[Math.floor(R() * PAL.length)]!)
      })
      im.computeBoundingSphere()
      group.add(im)
    }
    const a = spots.filter((_, i) => i % 3 === 0)
    const b = spots.filter((_, i) => i % 3 === 1)
    const c = spots.filter((_, i) => i % 3 === 2)
    mkInst(coralA, coralMat, a, [0.7, 1.6], true)
    mkInst(coralB, coralMat, b, [0.6, 1.3], true)
    mkInst(weed, weedMat, c.flatMap((s) => [s, { ...s, x: s.x + 0.4, z: s.z + 0.3 }, { ...s, x: s.x - 0.3, z: s.z + 0.5 }]), [0.6, 1.2], false)
  }

  // ======================================================================
  // 海星、贝壳（静态）
  // ======================================================================
  {
    const star = new Shape()
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2
      const r = i % 2 ? 0.09 : 0.24
      if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r)
      else star.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    star.closePath()
    const starGeo = new ExtrudeGeometry(star, { depth: 0.05, bevelEnabled: false })
    starGeo.rotateX(-Math.PI / 2)
    const shellGeo = new ConeGeometry(0.13, 0.22, 7)
    shellGeo.rotateZ(Math.PI / 2)
    shellGeo.scale(1, 0.6, 1)
    const mat = kit.toon(0xffffff)
    const PAL = ['#F07A4A', '#E8584A', '#F5C46A', '#FBE6D6', '#F2B8B0'].map((c) => new Color(c))
    for (const [geo, n] of [
      [starGeo, 70],
      [shellGeo, 120],
    ] as const) {
      const im = new InstancedMesh(kit.track(geo), mat, n)
      for (let i = 0; i < n; i++) {
        let x = 0
        let z = 0
        for (let k = 0; k < 30; k++) {
          const p = around(R() * Math.PI * 2, -(R() * 7) + 2)
          x = p.x
          z = p.z
          if (Math.abs(shore(x, z)) < 5) break
        }
        q.setFromAxisAngle(up, R() * 6)
        m4.compose(v.set(x, groundAt(x, z) + 0.02, z), q, sc.setScalar(0.8 + R() * 0.6))
        im.setMatrixAt(i, m4)
        im.setColorAt(i, PAL[Math.floor(R() * PAL.length)]!)
      }
      im.computeBoundingSphere()
      group.add(im)
    }
  }
  // ======================================================================
  // 每帧
  // ======================================================================
  const tmp = new Vector3()
  const tmp2 = new Vector3()
  function update(dt: number, t: number, eco: EcoState, player?: { x: number; z: number }) {
    // 鱼：一直都在，夜里少一半、游得深一点
    const fishAct = 0.5 + 0.5 * (1 - eco.night)
    for (const s of schools) {
      const show = Math.round(s.n * fishAct * bySeason(eco.season, { spring: 0.9, summer: 1, autumn: 0.9, winter: 0.65 }))
      s.im.count = show
      const th = s.th + t * s.speed
      const center = around(th, s.off, tmp)
      const ahead = around(th + Math.sign(s.speed) * 0.01, s.off, tmp2)
      const heading = Math.atan2(ahead.x - center.x, ahead.z - center.z)
      for (let i = 0; i < show; i++) {
        const o = s.offs[i]!
        const wob = Math.sin(t * 1.3 + i * 1.7 + s.ph)
        const fp = { x: center.x + o.x * Math.cos(t * 0.2 + i) + wob * 0.4, z: center.z + o.z + Math.cos(t * 0.9 + i) * 0.4 }
        // 有人靠近（站在栈桥或水边）就散开
        if (player) {
          const dx = fp.x - player.x
          const dz = fp.z - player.z
          const d = Math.hypot(dx, dz)
          if (d < 4.5) {
            fp.x += (dx / (d || 1)) * (4.5 - d) * 1.2
            fp.z += (dz / (d || 1)) * (4.5 - d) * 1.2
          }
        }
        avoidPier(fp, 0.5)
        const x = fp.x
        const z = fp.z
        const floor = groundAt(x, z)
        const y = Math.min(-0.45, Math.max(floor + 0.35, -1.1 + o.y - eco.night * 0.6))
        q.setFromAxisAngle(up, heading + Math.sin(t * 9 + i) * 0.18)
        m4.compose(v.set(x, y, z), q, sc.setScalar(1))
        s.im.setMatrixAt(i, m4)
      }
      s.im.instanceMatrix.needsUpdate = true
    }

    // 海龟
    const turtleAct = bySeason(eco.season, { spring: 1, summer: 1, autumn: 0.6, winter: 0.2 }) * (eco.storm ? 0.3 : 1)
    turtles.forEach((tu, i) => {
      tu.g.visible = i < Math.round(turtles.length * turtleAct + 0.3)
      if (!tu.g.visible) return
      const th = tu.th + t * 0.004
      const p = around(th, tu.off, tmp)
      const a = around(th + 0.01, tu.off, tmp2)
      avoidPier(p, 1.4)
      const floor = groundAt(p.x, p.z)
      tu.g.position.set(p.x, Math.min(-0.7, Math.max(floor + 0.5, -1.4 + Math.sin(t * 0.3 + i) * 0.3)), p.z)
      tu.g.rotation.y = Math.atan2(a.x - p.x, a.z - p.z)
      tu.flips.forEach((f, k) => (f.rotation.z = Math.sin(t * 2 + k * 1.6) * 0.5))
    })

    // 海豚：白天、不刮暴风才跳
    const dAct = clamp01(eco.day + eco.twilight * 0.6) * (eco.storm ? 0 : eco.wet ? 0.4 : 1) * (eco.fog ? 0.5 : 1)
    dolphins.forEach((d, i) => {
      const period = 7
      const local = (t + d.ph) % period
      const th = d.th + t * 0.01
      const p = around(th, d.lane, tmp)
      const a = around(th + 0.01, d.lane, tmp2)
      const heading = Math.atan2(a.x - p.x, a.z - p.z)
      const JUMP = 1.5
      const active = i < Math.round(dolphins.length * dAct)
      if (!active || local > JUMP) {
        d.m.visible = false
        return
      }
      const k = local / JUMP
      d.m.visible = true
      const fx = Math.sin(heading)
      const fz = Math.cos(heading)
      d.m.position.set(p.x + fx * (k - 0.5) * 6, -0.6 + Math.sin(k * Math.PI) * 2.6, p.z + fz * (k - 0.5) * 6)
      d.m.rotation.set(0, heading, 0)
      d.m.rotateX(-Math.cos(k * Math.PI) * 0.9)
    })

    // 鲸：冬春多，大约 30 秒换一次气
    const wAct = bySeason(eco.season, { spring: 1, summer: 0.4, autumn: 0.4, winter: 1 }) * (eco.storm ? 0 : 1) * clamp01(eco.day + eco.twilight)
    const wp = around(whaleTheta + t * 0.0015, 120, tmp)
    const cyc = t % 30
    const surf = wAct > 0.3 && cyc < 8 ? Math.sin((cyc / 8) * Math.PI) : 0
    whale.visible = surf > 0.02
    whale.position.set(wp.x, -1.5 + surf * 1.6, wp.z)
    whale.rotation.y = whaleTheta + t * 0.0015 + Math.PI / 2
    spray.forEach((s, i) => {
      const k = (cyc - 2.5 - i * 0.04) / 2.2
      const on = surf > 0.3 && k > 0 && k < 1
      s.s.visible = on
      if (!on) return
      s.s.position.set(wp.x + s.vx * k * 1.5, surf * 1.6 + s.vy * k - 6 * k * k + 1, wp.z + s.vz * k * 1.5)
      s.s.scale.setScalar(1.2 + k * 3)
      ;(s.s.material as SpriteMaterial).opacity = (1 - k) * 0.85
    })

    // 水母：夏秋，夜里发光
    const jAct = bySeason(eco.season, { spring: 0.3, summer: 1, autumn: 0.8, winter: 0.1 })
    jellyGlow.opacity = eco.night * 0.35
    jellies.forEach((j, i) => {
      j.g.visible = i < Math.round(jellies.length * jAct)
      if (!j.g.visible) return
      const pulse = 1 + Math.sin(t * 2 + j.ph) * 0.12
      j.g.scale.set(pulse, 2 - pulse, pulse)
      const jp = avoidPier({ x: j.x + Math.sin(t * 0.1 + j.ph) * 2, z: j.z + Math.cos(t * 0.08 + j.ph) * 2 }, 0.8)
      j.g.position.set(jp.x, -0.7 + Math.sin(t * 0.7 + j.ph) * 0.25, jp.z)
    })

  }

  return { group, update }
}
