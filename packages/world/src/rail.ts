/**
 * 海边铁路：铁轨、枕木、电线杆和电线、道口、两头的隧道、跨溪铁桥，
 * 还有一列两节的小电车：从西边隧道出来，在海边站停一会儿，再钻进东边隧道，然后反过来再开一趟。
 */
import {
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Path,
  PlaneGeometry,
  Quaternion,
  Shape,
  Vector3,
} from 'three'
import type { CarBox } from './bodies'
import { mergeStatic, type Kit } from './kit'
import { PATHS, RAIL, RAIL_BRIDGE, RAIL_TUNNEL, RAIL_Y, RIVER, UNFINISHED_BRIDGE, distTo, place, seaward, type V2 } from './layout'
import type { Mats } from './props'
import { createProps } from './props'

export interface Rail {
  group: Group
  update: (dt: number, t: number) => void
  /** 道口和车头灯的灯泡位置 */
  bulbs: Vector3[]
  /** 现在看得见的车厢（碰撞用） */
  carBoxes: () => CarBox[]
  cars: Group[]
  /** 电线线段（x,y,z,x,y,z…） */
  wires: number[]
  /** 电线杆位置 */
  poles: [number, number][]
}

// 铁路弧长表
const LENS: number[] = [0]
for (let i = 1; i < RAIL.length; i++) LENS.push(LENS[i - 1]! + Math.hypot(RAIL[i]![0] - RAIL[i - 1]![0], RAIL[i]![1] - RAIL[i - 1]![1]))
const TOTAL = LENS[LENS.length - 1]!

/** 环线：弧长绕一圈回到起点 */
export function railAt(s: number) {
  s = ((s % TOTAL) + TOTAL) % TOTAL
  s = Math.min(s, TOTAL - 0.001)
  let lo = 0
  let hi = LENS.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (LENS[mid]! <= s) lo = mid
    else hi = mid
  }
  const a = RAIL[lo]!
  const b = RAIL[lo + 1]!
  const t = (s - LENS[lo]!) / (LENS[lo + 1]! - LENS[lo]! || 1)
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) }
}
/** 不在隧道里的路段 [起点弧长, 终点弧长]；跨过环线起点的那段会拼起来 */
const OPEN: [number, number][] = (() => {
  const out: [number, number][] = []
  let start = -1
  for (let i = 0; i < RAIL.length; i++) {
    const open = RAIL_TUNNEL[i] === 0
    if (open && start < 0) start = i
    if ((!open || i === RAIL.length - 1) && start >= 0) {
      out.push([LENS[start]!, LENS[open ? i : i - 1]!])
      start = -1
    }
  }
  // 首尾两段其实相连
  if (out.length > 1 && out[0]![0] === 0 && out[out.length - 1]![1] >= TOTAL - 1.5) {
    const last = out.pop()!
    out[0] = [last[0] - TOTAL, out[0]![1]]
  }
  return out
})()
/** 弧长 s 处离最近的开阔路段有多远（在开阔路段上是 0） */
function tunnelDepth(s: number) {
  s = ((s % TOTAL) + TOTAL) % TOTAL
  let best = Infinity
  for (const [a, b] of OPEN)
    for (const k of [-TOTAL, 0, TOTAL]) {
      const x = s + k
      if (x >= a && x <= b) return 0
      best = Math.min(best, Math.abs(x - a), Math.abs(x - b))
    }
  return best
}
function sNear(x: number, z: number) {
  let best = 0
  let bd = Infinity
  RAIL.forEach((p, i) => {
    const d = (p[0] - x) ** 2 + (p[1] - z) ** 2
    if (d < bd) {
      bd = d
      best = LENS[i]!
    }
  })
  return best
}

/** 跨海桥的路段 [起点弧长, 终点弧长] */
const BRIDGES: [number, number][] = (() => {
  const out: [number, number][] = []
  let start = -1
  for (let i = 0; i < RAIL.length; i++) {
    const b = RAIL_BRIDGE[i] === 1
    if (b && start < 0) start = i
    if ((!b || i === RAIL.length - 1) && start >= 0) {
      out.push([LENS[start]!, LENS[b ? i : i - 1]!])
      start = -1
    }
  }
  return out
})()
export function onBridge(s: number) {
  s = ((s % TOTAL) + TOTAL) % TOTAL
  return BRIDGES.some(([a, b]) => s >= a - 0.5 && s <= b + 0.5)
}

/** 沿铁路扫一个截面（lat 横向偏移，h 高度），生成条带 */
function sweep(s0: number, s1: number, step: number, profile: [number, number][], y: number) {
  const pos: number[] = []
  const idx: number[] = []
  const n = Math.ceil((s1 - s0) / step)
  const P = profile.length
  for (let i = 0; i <= n; i++) {
    const r = railAt(s0 + ((s1 - s0) * i) / n)
    const nx = -Math.sin(r.ang)
    const nz = Math.cos(r.ang)
    for (const [lat, h] of profile) pos.push(r.x + nx * lat, y + h, r.z + nz * lat)
    if (i > 0)
      for (let j = 0; j < P - 1; j++) {
        const a = (i - 1) * P + j
        const b = i * P + j
        idx.push(a, b, a + 1, a + 1, b, b + 1)
      }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export function createRail(
  kit: Kit,
  groundAt: (x: number, z: number) => number,
  mats: Mats,
  /** 站台、房子占用的地方，电线杆要让开 */
  builtUp: (x: number, z: number, margin: number) => boolean = () => false,
): Rail {
  const group = new Group()
  const P = createProps(kit, mats)
  const bulbs: Vector3[] = []
  const steel = kit.pattern(kit.toon('#9AA3AD'), 'metal', 1)
  const gravel = kit.pattern(kit.toon('#ABA293'), 'gravel', 1)
  const sleeperMat = kit.pattern(kit.toon('#7A6455'), 'wood', 2)
  const girderMat = kit.pattern(kit.toon('#4F7896'), 'panel', 1.4)
  const dark = kit.track(new MeshBasicMaterial({ color: '#1E2328' }))

  const BED = RAIL_Y - 0.15
  // 隧道里也铺几米，从洞口看进去有铁轨
  const spans = OPEN.map(([a, b]) => [a - 6, b + 6] as [number, number])

  // 道床、铁轨（桥上的道床也铺：桥面上是一层碎石）
  for (const [sA, sB] of spans) {
    const ballast = new Mesh(kit.track(sweep(sA, sB, 1, [[-2.1, -0.5], [-1.45, 0.12], [1.45, 0.12], [2.1, -0.5]], BED)), gravel)
    ballast.receiveShadow = true
    group.add(ballast)
    for (const side of [-0.72, 0.72]) {
      const r = new Mesh(
        kit.track(sweep(sA, sB, 1, [[side - 0.07, 0.24], [side - 0.07, 0.42], [side + 0.07, 0.42], [side + 0.07, 0.24]], BED)),
        steel,
      )
      r.castShadow = true
      group.add(r)
    }
  }
  // 枕木
  for (const [sA, sB] of spans) {
    const count = Math.floor((sB - sA) / 0.9)
    const im = new InstancedMesh(P.boxGeo(0.34, 0.12, 2.3), sleeperMat, count)
    const m = new Matrix4()
    const q = new Quaternion()
    const up = new Vector3(0, 1, 0)
    for (let i = 0; i < count; i++) {
      const r = railAt(sA + i * 0.9)
      q.setFromAxisAngle(up, -r.ang)
      m.compose(new Vector3(r.x, BED + 0.18, r.z), q, new Vector3(1, 1, 1))
      im.setMatrixAt(i, m)
    }
    im.receiveShadow = true
    im.computeBoundingSphere()
    group.add(im)
  }

  // ---------- 跨海桥：混凝土拱桥，桥墩立在海底，两边有矮护墙
  // 桥的零件很多，先放进一个组，最后按材质合并成几块网格
  const bridgeGroup = new Group()
  group.add(bridgeGroup)
  const concrete = kit.pattern(kit.toon('#E7E1D4'), 'plaster', 1)
  const concreteDark = kit.pattern(kit.toon('#CFC6B5'), 'stone', 0.8)
  const SPAN = 9
  const DECK_W = 4.6
  /** 一跨拱形桥面：沿 u 方向长 L，顶面在 y=0，桥墩处厚 H、跨中厚 0.9 */
  const archGeo = (L: number, H: number) => {
    const sh = new Shape()
    sh.moveTo(0, 0)
    sh.lineTo(L, 0)
    sh.lineTo(L, -H)
    const N = 16
    for (let i = N; i >= 0; i--) {
      const u = (i / N) * L
      sh.lineTo(u, -0.9 - (H - 0.9) * (1 - Math.sin((Math.PI * u) / L)))
    }
    sh.closePath()
    const g = new ExtrudeGeometry(sh, { depth: DECK_W, bevelEnabled: false })
    g.translate(-L / 2, 0, -DECK_W / 2)
    g.computeVertexNormals()
    return kit.track(g)
  }
  const archCache = new Map<string, BufferGeometry>()
  const arch = (L: number, H: number) => {
    const k = `${L.toFixed(2)}_${H.toFixed(2)}`
    if (!archCache.has(k)) archCache.set(k, archGeo(L, H))
    return archCache.get(k)!
  }
  /** 一个桥墩：底在 floor，顶在 top；墩帽稍宽 */
  const pier = (x: number, z: number, ang: number, top: number, w = 3.6) => {
    const floor = Math.min(groundAt(x, z), -0.6) - 0.4
    const h = top - floor
    const g = new Group()
    g.add(P.box(1.3, h, w, concreteDark, 0, floor, 0))
    g.add(P.box(1.6, 0.35, w + 0.4, concrete, 0, top - 0.35, 0))
    // 水线附近一圈深色的湿痕
    g.add(P.box(1.34, 0.5, w + 0.04, kit.toon('#8E8A7E'), 0, -0.25, 0, false))
    g.position.set(x, 0, z)
    g.rotation.y = -ang
    bridgeGroup.add(g)
    return g
  }
  for (const [sA, sB] of BRIDGES) {
    // 桥头往岸上多搭一点
    const a = sA - 3
    const b = sB + 3
    const n = Math.max(1, Math.round((b - a) / SPAN))
    const L = (b - a) / n
    for (let i = 0; i < n; i++) {
      const sm = a + (i + 0.5) * L
      const r = railAt(sm)
      const H = 2.2
      const g = new Group()
      const m = new Mesh(arch(L + 0.05, H), concrete)
      m.castShadow = m.receiveShadow = true
      g.add(m)
      // 两边的矮护墙
      for (const side of [-1, 1]) g.add(P.box(L + 0.05, 0.55, 0.25, concrete, 0, 0, side * (DECK_W / 2 - 0.125)))
      g.position.set(r.x, BED + 0.12, r.z)
      g.rotation.y = -r.ang
      bridgeGroup.add(g)
    }
    for (let i = 0; i <= n; i++) {
      const sp = a + i * L
      const r = railAt(sp)
      if (groundAt(r.x, r.z) > 1.2) continue // 在岸上的桥头不用桥墩
      pier(r.x, r.z, r.ang, BED + 0.12 - 2.2)
    }
  }

  // ---------- 修到一半的桥：通往东边工地岛，只有桥墩和两头的几跨
  {
    const pts = UNFINISHED_BRIDGE
    const lens = [0]
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]))
    const total = lens[lens.length - 1]!
    const at = (u: number) => {
      let i = 1
      while (i < pts.length - 1 && lens[i]! < u) i++
      const p0 = pts[i - 1]!
      const p1 = pts[i]!
      const k = (u - lens[i - 1]!) / (lens[i]! - lens[i - 1]! || 1)
      return { x: p0[0] + (p1[0] - p0[0]) * k, z: p0[1] + (p1[1] - p0[1]) * k, ang: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) }
    }
    const n = Math.round(total / SPAN)
    const L = total / n
    for (let i = 0; i <= n; i++) {
      const r = at(i * L)
      if (groundAt(r.x, r.z) > 1.2) continue
      // 越往中间越矮：还在往上修
      const k = Math.min(i, n - i) / (n / 2)
      pier(r.x, r.z, r.ang, BED + 0.12 - 2.2 - k * 2.5)
    }
    // 两头已经铺好的几跨
    for (const i of [0, 1, n - 1]) {
      const r = at((i + 0.5) * L)
      const m = new Mesh(arch(L + 0.05, 2.2), concrete)
      m.castShadow = m.receiveShadow = true
      m.position.set(r.x, BED + 0.12, r.z)
      m.rotation.y = -r.ang
      bridgeGroup.add(m)
    }
  }
  mergeStatic(bridgeGroup, kit.track)

  // 跨溪铁桥（铁路离溪流很近时才有）
  {
    let bs = 0
    let bd = Infinity
    for (let s = 0; s < TOTAL; s += 0.5) {
      const r = railAt(s)
      const d = distTo(r.x, r.z, RIVER, bd)
      if (d < bd) {
        bd = d
        bs = s
      }
    }
    const r = railAt(bs)
    const g = new Group()
    g.visible = bd < 3
    for (const side of [-1.35, 1.35]) g.add(P.box(12, 1.1, 0.25, girderMat, 0, -0.95, side))
    for (let u = -5.5; u <= 5.5; u += 1.1) for (const side of [-1.35, 1.35]) g.add(P.box(0.08, 1.1, 0.3, girderMat, u, -0.95, side, false))
    for (const u of [-6.3, 6.3]) g.add(P.box(1.4, 3.2, 3.6, mats.stone, u, -3.1, 0))
    g.position.set(r.x, BED + 0.1, r.z)
    g.rotation.y = -r.ang
    group.add(g)
  }

  // 隧道口
  /** dirOut = 1：洞口朝 +s 方向（开阔路段在 +s 一侧） */
  const portal = (sAt: number, dirOut: number) => {
    const r = railAt(sAt)
    const shape = new Shape()
    shape.moveTo(-4.6, 0)
    shape.lineTo(4.6, 0)
    shape.lineTo(4.9, 7.8)
    shape.lineTo(-4.9, 7.8)
    shape.closePath()
    const hole = new Path()
    hole.moveTo(-2.3, 0)
    hole.lineTo(2.3, 0)
    hole.lineTo(2.3, 3.4)
    hole.absarc(0, 3.4, 2.3, 0, Math.PI, false)
    hole.lineTo(-2.3, 0)
    shape.holes.push(hole)
    const geo = kit.track(new ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false }))
    const g = new Group()
    const facade = new Mesh(geo, mats.stone)
    facade.castShadow = facade.receiveShadow = true
    facade.position.z = -0.8
    // 门洞里面是黑的
    const inner = new Mesh(P.boxGeo(4.7, 5.8, 14), dark)
    inner.position.set(0, 2.9, -7.9)
    g.add(facade, inner)
    g.add(P.box(10.2, 0.5, 2, mats.stone, 0, 7.8, 0))
    g.position.set(r.x, BED - 0.4, r.z)
    // 门洞朝外，往山里延伸
    g.rotation.y = Math.atan2(dirOut * Math.cos(r.ang), dirOut * Math.sin(r.ang))
    group.add(g)
  }
  if (OPEN.length && !(OPEN.length === 1 && OPEN[0]![1] - OPEN[0]![0] >= TOTAL - 2))
    for (const [a, b] of OPEN) {
      portal(a + 0.5, 1)
      portal(b - 0.5, -1)
    }

  // 电线杆和电线：沿铁路北侧
  const wires: number[] = []
  const poles: [number, number][] = []
  const poleGroup = new Group()
  group.add(poleGroup)
  {
    const seg = wires
    // 一段电线：两根线，每根是一串杆顶
    const runs: Vector3[][][] = []
    for (const [sa, sb] of OPEN) {
      let tops: Vector3[][] = [[], []]
      let lastS = -Infinity
      const endRun = () => {
        if (tops[0]!.length > 1) runs.push(tops)
        tops = [[], []]
      }
      for (let s = sa + 8; s < sb - 6; s += 17) {
        // 这根杆子的位置被河、房子、站台占了，就沿铁路前后挪几米；实在放不下就让电线在这里断开，
        // 免得前后两根杆子隔得太远，电线拉成一条斜穿陆地的直线
        let found: { s: number; x: number; z: number; nx: number; nz: number; ang: number } | null = null
        for (const off of [0, 2.5, -2.5, 5, -5]) {
          const ss = s + off
          if (ss < sa + 2 || ss > sb - 2) continue
          const r = railAt(ss)
          // 电线杆立在铁路靠岛内的一侧（n 指向海）；桥上不立
          if (onBridge(ss)) continue
          let nx = -Math.sin(r.ang)
          let nz = Math.cos(r.ang)
          const [sx, sz] = seaward(r.x, r.z)
          if (sx * nx + sz * nz < 0) {
            nx = -nx
            nz = -nz
          }
          const x = r.x - nx * 3.3
          const z = r.z - nz * 3.3
          if (distTo(x, z, RIVER, 5) < 4.5 || builtUp(x, z, 1.2)) continue
          found = { s: ss, x, z, nx, nz, ang: r.ang }
          break
        }
        if (!found) {
          endRun()
          continue
        }
        if (found.s - lastS > 24) endRun()
        lastS = found.s
        const { x, z, nx, nz } = found
        const base = groundAt(x, z)
        const pole = new Group()
        pole.add(P.cyl(0.11, 0.15, 7.6, mats.darkWood, 0, 0, 0, 6))
        pole.add(P.box(0.14, 0.14, 2.0, mats.darkWood, 0, 6.9, 0, false))
        for (const o of [-0.85, 0.85]) pole.add(P.cyl(0.06, 0.06, 0.18, mats.white, 0, 7.04, o, 6))
        pole.position.set(x, base, z)
        pole.rotation.y = -found.ang
        poles.push([x, z])
        poleGroup.add(pole)
        for (const [k, o] of [
          [0, -0.85],
          [1, 0.85],
        ] as const)
          tops[k]!.push(new Vector3(x + nx * o, base + 7.25, z + nz * o))
      }
      endRun()
    }
    for (const run of runs)
      for (const line of run)
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1]!
          const b = line[i]!
          const N = 10
          for (let k = 0; k < N; k++) {
            const t0 = k / N
            const t1 = (k + 1) / N
            const p0 = a.clone().lerp(b, t0)
            const p1 = a.clone().lerp(b, t1)
            p0.y -= Math.sin(Math.PI * t0) * 0.7
            p1.y -= Math.sin(Math.PI * t1) * 0.7
            seg.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
          }
        }
    const g = kit.track(new BufferGeometry())
    g.setAttribute('position', new Float32BufferAttribute(seg, 3))
    group.add(new LineSegments(g, kit.track(new LineBasicMaterial({ color: '#4A4F57' }))))
    mergeStatic(poleGroup, kit.track)
  }

  // 道口：通往栈桥的小路穿过铁路的地方
  const crossing = (() => {
    const path = PATHS[5]!
    let best: V2 = path[0]!
    let bd = Infinity
    for (const p of path) {
      const d = distTo(p[0], p[1], RAIL, bd)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    const s = sNear(best[0], best[1])
    const r = railAt(s)
    const lights: Mesh[] = []
    const arms: Group[] = []
    const lampOn = kit.track(new MeshBasicMaterial({ color: '#FF4A3A' }))
    const lampOff = kit.toon('#5A2A28')
    const stripeY = kit.toon('#F2C641')
    for (const side of [-1, 1]) {
      const g = new Group()
      for (let i = 0; i < 6; i++) g.add(P.cyl(0.09, 0.09, 0.45, i % 2 ? mats.white : stripeY, 0, i * 0.45, 0, 8))
      const cross = new Group()
      for (const a of [0.6, -0.6]) {
        const b = P.box(1.3, 0.22, 0.05, stripeY, 0, -0.11, 0, false)
        b.rotation.z = a
        cross.add(b)
      }
      cross.position.y = 3.2
      g.add(cross)
      g.add(P.box(1.2, 0.08, 0.08, mats.metal, 0, 2.55, 0.1, false))
      for (const o of [-0.45, 0.45]) {
        const l = new Mesh(kit.track(new CylinderGeometry(0.17, 0.17, 0.1, 12)), lampOff)
        l.rotation.x = Math.PI / 2
        l.position.set(o, 2.55, 0.18)
        g.add(l)
        lights.push(l)
      }
      // 栏杆
      const arm = new Group()
      for (let i = 0; i < 5; i++) arm.add(P.box(0.8, 0.12, 0.08, i % 2 ? mats.white : stripeY, 0.4 + i * 0.8, -0.06, 0, false))
      arm.position.set(0.25, 1.0, 0.25)
      g.add(arm)
      arms.push(arm)
      const lat = side * 3.0
      const x = r.x - Math.sin(r.ang) * lat + Math.cos(r.ang) * side * 2.0
      const z = r.z + Math.cos(r.ang) * lat + Math.sin(r.ang) * side * 2.0
      g.position.set(x, groundAt(x, z), z)
      g.rotation.y = -r.ang + (side > 0 ? Math.PI : 0)
      group.add(g)
    }
    return { s, lights, arms, lampOn, lampOff }
  })()

  // ---------- 小电车
  const CAR = 8.6
  const GAP = 0.7
  const cream = kit.pattern(kit.toon('#F7F0DE'), 'panel', 1)
  const blue = kit.pattern(kit.toon('#4E9BCF'), 'panel', 1)
  const orange = kit.toon('#F09A4A')
  const roofM = kit.pattern(kit.toon('#9BA4AE'), 'metal', 1)
  const head = kit.track(new MeshBasicMaterial({ color: '#FFF6D8' }))
  const doorM = kit.pattern(kit.toon('#E9E0C8'), 'panel', 1)
  const darkM = kit.toon('#2F343B')
  const tail = kit.track(new MeshBasicMaterial({ color: '#E8483C' }))
  const sign = kit.track(new MeshBasicMaterial({ color: '#FFF3C2' }))
  const wheelGeo = kit.track(new CylinderGeometry(0.42, 0.42, 0.16, 14))
  wheelGeo.rotateX(Math.PI / 2)
  // 车顶：截面是扁的拱形，沿车身拉伸
  const roofShape = new Shape()
  roofShape.moveTo(-1.3, 0)
  roofShape.quadraticCurveTo(-1.28, 0.38, -0.7, 0.5)
  roofShape.quadraticCurveTo(0, 0.6, 0.7, 0.5)
  roofShape.quadraticCurveTo(1.28, 0.38, 1.3, 0)
  roofShape.closePath()
  const roofGeo = kit.track(new ExtrudeGeometry(roofShape, { depth: CAR, bevelEnabled: false, curveSegments: 6 }))
  roofGeo.rotateY(Math.PI / 2)
  roofGeo.translate(-CAR / 2, 0, 0)
  const winGeo = kit.track(new PlaneGeometry(1, 1))
  const makeCar = (front: boolean) => {
    const g = new Group()
    const W = 2.5
    // 车身：下半蓝、细橙线、上半奶白
    g.add(P.box(CAR, 1.2, W, blue, 0, 0.45, 0))
    g.add(P.box(CAR + 0.02, 0.12, W + 0.02, orange, 0, 1.65, 0, false))
    g.add(P.box(CAR, 1.15, W, cream, 0, 1.77, 0))
    const roof = new Mesh(roofGeo, roofM)
    roof.position.y = 2.92
    roof.castShadow = true
    g.add(roof)
    // 车顶空调
    g.add(P.box(1.6, 0.32, 1.2, roofM, front ? -1.8 : 0, 3.35, 0))
    // 车底：裙板和两个转向架（四个轮子）
    g.add(P.box(CAR - 0.6, 0.35, W - 0.3, darkM, 0, 0.12, 0))
    for (const u of [-2.9, 2.9]) {
      g.add(P.box(2.4, 0.3, W - 0.5, darkM, u, -0.12, 0, false))
      for (const du of [-0.8, 0.8])
        for (const side of [-1, 1]) {
          const wh = new Mesh(wheelGeo, darkM)
          wh.position.set(u + du, -0.25, side * (W / 2 - 0.35))
          g.add(wh)
        }
    }
    // 侧面：两扇门 + 一排窗（窗有深色窗框）
    for (const side of [1, -1]) {
      const z = side * (W / 2 + 0.01)
      const rot = side > 0 ? 0 : Math.PI
      for (const u of [-2.3, 2.3]) {
        const door = P.box(1.0, 2.2, 0.04, doorM, u, 0.5, z, false)
        g.add(door)
        const dw = new Mesh(winGeo, mats.win)
        dw.scale.set(0.6, 0.75, 1)
        dw.position.set(u, 2.2, z + side * 0.03)
        dw.rotation.y = rot
        g.add(dw)
      }
      for (const u of [-3.6, -1.15, -0.0, 1.15, 3.6]) {
        if (Math.abs(u) < 0.1) continue
        const w = u === -3.6 || u === 3.6 ? 0.7 : 1.15
        g.add(P.box(w + 0.14, 0.92, 0.03, darkM, u, 1.82, z, false))
        const pane = new Mesh(winGeo, mats.win)
        pane.scale.set(w, 0.78, 1)
        pane.position.set(u, 2.28, z + side * 0.025)
        pane.rotation.y = rot
        g.add(pane)
      }
      const mid = new Mesh(winGeo, mats.win)
      mid.scale.set(0.9, 0.78, 1)
      mid.position.set(0, 2.28, z + side * 0.025)
      mid.rotation.y = rot
      g.add(mid)
    }
    // 两头
    for (const end of [1, -1]) {
      const x = end * (CAR / 2 + 0.01)
      const rot = (end * Math.PI) / 2
      const cab = end === 1 ? front : !front
      if (cab) {
        // 驾驶室：两块前窗、目的地牌、头灯、尾灯、排障器
        for (const o of [-0.55, 0.55]) {
          const fw = new Mesh(winGeo, mats.win)
          fw.scale.set(0.95, 0.95, 1)
          fw.position.set(x, 2.25, o)
          fw.rotation.y = rot
          g.add(fw)
        }
        g.add(P.box(0.05, 1.1, 0.12, darkM, x, 1.72, 0, false))
        const sg = new Mesh(winGeo, sign)
        sg.scale.set(1.1, 0.28, 1)
        sg.position.set(x + end * 0.01, 2.95, 0)
        sg.rotation.y = rot
        g.add(sg)
        for (const o of [-0.8, 0.8]) {
          const hl = new Mesh(kit.track(new CylinderGeometry(0.15, 0.15, 0.08, 12)), end === 1 ? head : tail)
          hl.rotation.z = Math.PI / 2
          hl.position.set(x + end * 0.02, 1.05, o)
          g.add(hl)
        }
        g.add(P.box(0.25, 0.4, W - 0.4, darkM, x + end * 0.1, -0.2, 0, false))
      } else {
        // 车厢之间的贯通道（风挡）
        g.add(P.box(0.5, 2.3, 1.4, darkM, x + end * 0.2, 0.5, 0, false))
      }
    }
    return g
  }
  const cars = [makeCar(true), makeCar(false)]
  // 集电弓
  {
    const pg = new Group()
    for (const a of [0.5, -0.5]) {
      const b = P.box(0.06, 1.0, 0.06, mats.metal, 0, 0, 0, false)
      b.rotation.z = a
      b.position.set(a * 0.45, 3.5, 0)
      pg.add(b)
    }
    pg.add(P.box(0.12, 0.06, 1.6, mats.metal, 0, 4.3, 0, false))
    pg.position.x = 1.8
    cars[0]!.add(pg)
  }
  const train = new Group()
  for (const c of cars) train.add(c)
  group.add(train)

  const st = place('station')
  const sStation = sNear(st.x, st.z + 3.4)
  let s = sStation - 60
  let speed = 9
  let state: 'run' | 'stop' = 'run'
  let wait = 0
  let lapStop = -1
  const V = 10
  const ACC = 1.3
  const LEN = CAR * 2 + GAP

  function placeCars() {
    cars.forEach((c, i) => {
      const sc = s - (CAR / 2 + i * (CAR + GAP))
      const r = railAt(sc)
      c.position.set(r.x, BED + 0.72, r.z)
      c.rotation.y = -r.ang
      // 钻进隧道 5 米以后就看不见了
      c.visible = tunnelDepth(sc) < 5
    })
  }

  function update(dt: number, t: number) {
    if (state === 'stop') {
      wait -= dt
      if (wait <= 0) {
        state = 'run'
        speed = 0
      }
    } else {
      // 每圈在海边站停一次：车厢中间对准站台
      const stopAt = sStation + LEN / 2
      // 下一次经过站台是第 k 圈
      const k = Math.ceil((s - stopAt) / TOTAL - 1e-6)
      const rem = stopAt + k * TOTAL - s
      if (rem < 80 && lapStop !== k) {
        speed = Math.min(V, speed + ACC * dt, Math.sqrt(2 * ACC * rem) + 0.15)
        if (rem < 0.05) {
          s = stopAt + k * TOTAL
          state = 'stop'
          wait = 8
          lapStop = k
        }
      } else speed = Math.min(V, speed + ACC * dt)
      s += speed * dt
    }
    placeCars()

    // 道口：车头到车尾任意一节离道口近就响
    // 车头离道口 30 米以内、或者车身正压在道口上
    const ahead = (((crossing.s - s) % TOTAL) + TOTAL) % TOTAL
    const behindTail = (((s - LEN - crossing.s) % TOTAL) + TOTAL) % TOTAL
    const near = ahead < 30 || behindTail < 6 || ahead > TOTAL - LEN
    const on = Math.floor(t * 2.4) % 2 === 0
    crossing.lights.forEach((l, i) => (l.material = near && (i % 2 === 0) === on ? crossing.lampOn : crossing.lampOff))
    for (const a of crossing.arms) {
      const target = near ? 0 : 1.45
      a.rotation.z += (target - a.rotation.z) * Math.min(1, dt * 2.5)
    }
  }
  for (const a of crossing.arms) a.rotation.z = 1.45
  placeCars()

  return {
    group,
    update,
    bulbs,
    cars,
    /** 电线（线段端点 x,y,z,x,y,z…），种树时树冠要避开 */
    wires,
    poles,
    carBoxes: () =>
      cars
        .filter((c) => c.visible)
        .map((c) => ({ x: c.position.x, z: c.position.z, ang: -c.rotation.y, hl: CAR / 2 + 0.15, hw: 1.4 })),
  }
}
