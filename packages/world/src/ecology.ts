/**
 * 岛上的动物。每一种都有自己的作息（跟着时段、季节、天气出现或躲起来），
 * 也会对角色和狗做出反应：
 *
 * | 动物 | 什么时候多 | 角色 / 狗靠近时 |
 * |---|---|---|
 * | 蝴蝶 | 春夏白天的花丛 | 绕开人和狗飞 |
 * | 蜻蜓 | 夏秋白天的溪边 | 一下子飞到别处 |
 * | 小鸟 | 清晨最热闹，在树梢之间飞 | 有人走到树下就飞走 |
 * | 雁阵 | 春秋迁徙季从岛上飞过 | — |
 * | 鹿 | 黎明黄昏出来吃草，冬天换灰毛 | 先抬头警觉，再靠近就跑开 |
 * | 兔子 | 晨昏和白天，冬天变白 | 先立起来张望，再靠近就蹦开 |
 * | 螃蟹 | 傍晚和夜里在沙滩上横着走 | 横着冲向海里钻进沙子，过一会儿在别处冒出来 |
 * | 青蛙 | 春夏溪边，下雨和夜里最多 | 跳进溪里 |
 * | 飞蛾 | 夏秋的夜里围着路灯 | — |
 *
 * 会走动的动物都登记在 bodies 里，和角色、狗一起做碰撞分离，不会互相穿过去。
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import type { Bodies, Body } from './bodies'
import { bySeason, clamp01, habit, type EcoState } from './eco'
import type { Kit } from './kit'
import { RIVER, coastPoint, forestDensity, isClear, riverNear, seaward, shore } from './layout'
import { rng } from './noise'

export interface EcoCtx {
  player: Body
  dog: Body
  /** 角色是否在走 */
  playerMoving: boolean
  /** 列车车厢的中心（开过来时动物也会躲） */
  train: { x: number; z: number }[]
}

export interface Ecology {
  group: Group
  update: (dt: number, t: number, eco: EcoState, ctx: EcoCtx) => void
}

/** 离海岸 off 米（负数在岸上）的绕岛点 */
function around(theta: number, off: number) {
  const [x, z] = coastPoint(theta / (Math.PI * 2), off)
  return { x, z }
}

export function createEcology(
  kit: Kit,
  groundAt: (x: number, z: number) => number,
  treeTops: Vector3[],
  bulbs: Vector3[],
  bodies: Bodies,
  /** 树干、石头、房子这些静态障碍 */
  solid: (x: number, z: number, r: number) => boolean,
): Ecology {
  const group = new Group()
  const R = rng(777)
  const updates: ((dt: number, t: number, e: EcoState, c: EcoCtx) => void)[] = []

  // 草地上的点：不在林子里、不在路和房子上
  const meadow: [number, number][] = []
  for (let i = 0; i < 4000 && meadow.length < 140; i++) {
    const x = -60 + R() * 120
    const z = -48 + R() * 72
    if (shore(x, z) < 12 || groundAt(x, z) < 1) continue
    if (forestDensity(x, z) > 0.45 || !isClear(x, z, 0) || solid(x, z, 1.5)) continue
    meadow.push([x, z])
  }
  const edge: [number, number][] = []
  for (let i = 0; i < 4000 && edge.length < 60; i++) {
    const x = -60 + R() * 120
    const z = -50 + R() * 70
    const fd = forestDensity(x, z)
    if (fd < 0.3 || fd > 0.7 || shore(x, z) < 12 || !isClear(x, z, 0) || solid(x, z, 1.5)) continue
    edge.push([x, z])
  }
  const pick = <T,>(arr: T[]) => arr[Math.floor(R() * arr.length)]!
  const showN = (n: number, act: number) => Math.round(n * clamp01(act))

  /** 最近的威胁（角色或狗），带各自的“吓人程度” */
  const threat = (x: number, z: number, c: EcoCtx, dogScale = 1) => {
    const pd = Math.hypot(c.player.x - x, c.player.z - z) / (c.playerMoving ? 1.25 : 1)
    const dd = Math.hypot(c.dog.x - x, c.dog.z - z) / dogScale
    let who: { x: number; z: number } = pd <= dd ? c.player : c.dog
    let dist = Math.min(pd, dd)
    for (const car of c.train) {
      // 车厢有 9 米长，按离车厢边缘的距离算
      const cd = Math.max(0, Math.hypot(car.x - x, car.z - z) - 4.5) * 0.8
      if (cd < dist) {
        dist = cd
        who = car
      }
    }
    const dx = x - who.x
    const dz = z - who.z
    const l = Math.hypot(dx, dz) || 1
    return { dist, ax: dx / l, az: dz / l, who }
  }

  /** 地面动物往某个方向走一步；挡住了就往两边偏一偏再试 */
  const walk = (b: Body, dirX: number, dirZ: number, dist: number, ok: (x: number, z: number) => boolean) => {
    const base = Math.atan2(dirX, dirZ)
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
      const a = base + off
      const x = b.x + Math.sin(a) * dist
      const z = b.z + Math.cos(a) * dist
      if (ok(x, z)) {
        b.x = x
        b.z = z
        return a
      }
    }
    return null
  }
  const landOk = (r: number) => (x: number, z: number) => {
    if (shore(x, z) < 10 || z < -75) return false
    const rv = riverNear(x, z, 3.5)
    if (rv && rv.d < 3) return false
    return !solid(x, z, r)
  }

  // ======================================================================
  // 蝴蝶：绕着花丛飞，人和狗靠近就绕开
  // ======================================================================
  {
    const wingGeo = kit.track(new PlaneGeometry(0.32, 0.26))
    wingGeo.translate(0.16, 0, 0)
    wingGeo.rotateX(-Math.PI / 2)
    const COLORS = ['#FFFFFF', '#F7D84C', '#F29A3A', '#7FB2F0', '#F2B6D0']
    const list = Array.from({ length: 28 }, () => {
      const g = new Group()
      const mat = kit.toon(pick(COLORS), { side: DoubleSide })
      const l = new Mesh(wingGeo, mat)
      const r = new Mesh(wingGeo, mat)
      r.scale.x = -1
      g.add(l, r)
      group.add(g)
      const home = pick(meadow)
      return { g, l, r, home, ox: 0, oz: 0, ph: R() * 50, sp: 0.4 + R() * 0.4 }
    })
    updates.push((dt, t, e, c) => {
      const act = habit.diurnal(e) * bySeason(e.season, { spring: 1, summer: 1, autumn: 0.35, winter: 0 }) * (e.wind > 1.5 ? 0.3 : 1)
      const n = showN(list.length, act)
      list.forEach((b, i) => {
        b.g.visible = i < n
        if (!b.g.visible) return
        const tt = t * b.sp + b.ph
        let x = b.home[0] + Math.sin(tt * 0.9) * 3 + Math.sin(tt * 2.3) * 0.6 + b.ox
        let z = b.home[1] + Math.cos(tt * 0.7) * 3 + Math.cos(tt * 1.9) * 0.6 + b.oz
        const th = threat(x, z, c, 0.8)
        if (th.dist < 2.2) {
          b.ox += th.ax * (2.2 - th.dist) * dt * 6
          b.oz += th.az * (2.2 - th.dist) * dt * 6
          x += th.ax * (2.2 - th.dist)
          z += th.az * (2.2 - th.dist)
        } else {
          b.ox *= 1 - dt * 0.2
          b.oz *= 1 - dt * 0.2
        }
        b.g.position.set(x, groundAt(x, z) + 0.9 + Math.sin(tt * 3.1) * 0.35, z)
        b.g.rotation.y = Math.atan2(Math.cos(tt * 0.9), -Math.sin(tt * 0.7))
        const f = Math.sin(t * 18 + b.ph) * 1.1
        b.l.rotation.z = f
        b.r.rotation.z = -f
      })
    })
  }

  // ======================================================================
  // 蜻蜓：溪边悬停、突然换个位置；有人过来就立刻飞开
  // ======================================================================
  {
    const bodyGeo = kit.track(new CylinderGeometry(0.025, 0.02, 0.55, 5))
    bodyGeo.rotateX(Math.PI / 2)
    const wingGeo = kit.track(new PlaneGeometry(0.42, 0.08))
    wingGeo.rotateX(-Math.PI / 2)
    const wingMat = kit.track(new MeshBasicMaterial({ color: '#E8F6FF', transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false }))
    const list = Array.from({ length: 12 }, (_, i) => {
      const g = new Group()
      g.add(new Mesh(bodyGeo, kit.toon(i % 2 ? '#3E7FD8' : '#D8503E')))
      const wings: Mesh[] = []
      for (const z of [0.08, -0.04]) {
        const w = new Mesh(wingGeo, wingMat)
        w.position.set(0, 0.03, z)
        g.add(w)
        wings.push(w)
      }
      group.add(g)
      const p = RIVER[Math.floor(RIVER.length * (0.4 + R() * 0.5))]!
      return { g, wings, base: new Vector3(p[0], 0, p[1]), from: new Vector3(), to: new Vector3(), k: 1, wait: R() * 2 }
    })
    updates.push((dt, t, e, c) => {
      const act = habit.diurnal(e) * bySeason(e.season, { spring: 0.3, summer: 1, autumn: 0.8, winter: 0 })
      const n = showN(list.length, act)
      list.forEach((d, i) => {
        d.g.visible = i < n
        if (!d.g.visible) return
        d.wait -= dt
        const near = threat(d.g.position.x, d.g.position.z, c).dist < 2
        if (d.wait <= 0 || (near && d.k >= 1)) {
          d.from.copy(d.g.position)
          let x = 0
          let z = 0
          for (let k = 0; k < 6; k++) {
            x = d.base.x + (R() - 0.5) * 9
            z = d.base.z + (R() - 0.5) * 9
            if (threat(x, z, c).dist > 3) break
          }
          d.to.set(x, Math.max(groundAt(x, z), 0.5) + 0.8 + R() * 1.2, z)
          if (d.from.lengthSq() === 0) d.from.copy(d.to)
          d.k = 0
          d.wait = 1 + R() * 2.5
          d.g.rotation.y = Math.atan2(d.to.x - d.from.x, d.to.z - d.from.z)
        }
        d.k = Math.min(1, d.k + dt * (near ? 5 : 3))
        const s = d.k * d.k * (3 - 2 * d.k)
        d.g.position.lerpVectors(d.from, d.to, s)
        d.g.position.y += Math.sin(t * 6 + i) * 0.03
        d.wings.forEach((w, k) => (w.rotation.z = Math.sin(t * 40 + k) * 0.3))
      })
    })
  }

  // ======================================================================
  // 小鸟：在树梢之间飞；有人走到树下就飞走
  // ======================================================================
  const birdBody = kit.track(new SphereGeometry(0.16, 8, 6))
  birdBody.scale(0.8, 0.8, 1.3)
  const birdWing = kit.track(new PlaneGeometry(0.34, 0.16))
  birdWing.translate(0.17, 0, 0)
  birdWing.rotateX(-Math.PI / 2)
  const makeBird = (color: string) => {
    const g = new Group()
    const mat = kit.toon(color, { side: DoubleSide })
    const l = new Mesh(birdWing, mat)
    const r = new Mesh(birdWing, mat)
    r.scale.x = -1
    g.add(new Mesh(birdBody, mat), l, r)
    return { g, l, r }
  }
  if (treeTops.length) {
    const COLORS = ['#7A5A44', '#5E6E8A', '#C9773E', '#8E8A7E']
    const list = Array.from({ length: 16 }, () => {
      const b = makeBird(pick(COLORS))
      group.add(b.g)
      const a = pick(treeTops)
      return { ...b, from: a.clone(), to: a.clone(), k: 1, rest: R() * 6, flying: false, scared: false }
    })
    const pickTree = (from: Vector3, c: EcoCtx, minAway: number) => {
      let best = from
      for (let k = 0; k < 12; k++) {
        const cand = pick(treeTops)
        const d = cand.distanceTo(from)
        if (d > 30 || d < 4) continue
        if (threat(cand.x, cand.z, c).dist < minAway) continue
        best = cand
        break
      }
      return best
    }
    updates.push((dt, t, e, c) => {
      // 清晨鸟最多（twilight 加成），夜里和雨天都躲在树里
      const act = clamp01(e.day * 0.8 + e.twilight * 1.2) * (e.wet ? 0 : 1) * (e.storm ? 0 : 1) * bySeason(e.season, { spring: 1, summer: 0.9, autumn: 0.7, winter: 0.45 })
      const n = showN(list.length, act)
      list.forEach((b, i) => {
        b.g.visible = i < n
        if (!b.g.visible) return
        if (!b.flying) {
          b.rest -= dt
          b.g.position.copy(b.to)
          b.g.position.y += Math.abs(Math.sin(t * 6 + i)) * 0.05
          b.l.rotation.z = b.r.rotation.z = -0.2
          const scared = threat(b.to.x, b.to.z, c).dist < 5.5
          if (b.rest <= 0 || scared) {
            b.from.copy(b.to)
            b.to.copy(pickTree(b.from, c, scared ? 10 : 0))
            b.scared = scared
            b.k = 0
            b.flying = true
            b.g.rotation.y = Math.atan2(b.to.x - b.from.x, b.to.z - b.from.z)
          }
        } else {
          const len = b.from.distanceTo(b.to)
          b.k = Math.min(1, b.k + (dt * (b.scared ? 13 : 9)) / Math.max(4, len))
          b.g.position.lerpVectors(b.from, b.to, b.k)
          // 弧线飞得比树冠高，不穿过别的树
          b.g.position.y += Math.sin(b.k * Math.PI) * Math.max(3.5, len * 0.3)
          const f = Math.sin(t * 30 + i) * 0.9
          b.l.rotation.z = f
          b.r.rotation.z = -f
          if (b.k >= 1) {
            b.flying = false
            b.rest = 3 + R() * 8
          }
        }
      })
    })
  }

  // ======================================================================
  // 雁阵：春秋迁徙
  // ======================================================================
  {
    const flock = new Group()
    const birds = Array.from({ length: 11 }, (_, i) => {
      const b = makeBird('#6E6A64')
      b.g.scale.setScalar(2.4)
      const row = Math.ceil(i / 2)
      const side = i === 0 ? 0 : i % 2 ? 1 : -1
      b.g.position.set(side * row * 2.4, 0, -row * 2.6)
      flock.add(b.g)
      return b
    })
    group.add(flock)
    updates.push((_dt, t, e) => {
      const act = clamp01(e.day + e.twilight) * bySeason(e.season, { spring: 0.8, summer: 0, autumn: 1, winter: 0 }) * (e.storm ? 0 : 1)
      const PERIOD = 80
      const k = (t % PERIOD) / 40
      flock.visible = act > 0.3 && k < 1
      if (!flock.visible) return
      // 秋天往南飞，春天往北飞
      const south = e.season === 'autumn'
      const z = south ? -170 + k * 300 : 130 - k * 300
      flock.position.set(-30 + k * 50, 42, z)
      flock.rotation.y = south ? 0.17 : Math.PI + 0.17
      birds.forEach((b, i) => {
        const f = Math.sin(t * 5 + i * 0.4) * 0.6
        b.l.rotation.z = f
        b.r.rotation.z = -f
      })
    })
  }

  // ======================================================================
  // 鹿：吃草、慢慢走；有人靠近先抬头张望，再近就跑开
  // ======================================================================
  {
    const coat = kit.toon('#B07A4E')
    const belly = kit.toon('#EADBC4')
    const dark = kit.toon('#4A3A30')
    const ok = landOk(0.8)
    const list = Array.from({ length: 4 }, (_, i) => {
      const g = new Group()
      const body = new Mesh(kit.track(new SphereGeometry(0.5, 12, 8)), coat)
      body.scale.set(0.7, 0.75, 1.5)
      body.position.y = 1.25
      const neck = new Group()
      neck.position.set(0, 1.5, 0.6)
      const n = new Mesh(kit.track(new CylinderGeometry(0.13, 0.18, 0.8, 6)), coat)
      n.position.y = 0.35
      n.rotation.x = 0.4
      const head = new Mesh(kit.track(new SphereGeometry(0.2, 8, 6)), coat)
      head.scale.set(0.8, 0.8, 1.5)
      head.position.set(0, 0.7, 0.25)
      const ears = [-1, 1].map((s) => {
        const e = new Mesh(kit.track(new SphereGeometry(0.09, 6, 4)), coat)
        e.scale.set(0.5, 1.4, 0.4)
        e.position.set(s * 0.15, 0.85, 0.12)
        return e
      })
      neck.add(n, head, ...ears)
      if (i === 0) {
        // 一只公鹿有角
        for (const s of [-1, 1]) {
          const ant = new Mesh(kit.track(new CylinderGeometry(0.02, 0.03, 0.5, 4)), dark)
          ant.position.set(s * 0.1, 1.05, 0.1)
          ant.rotation.z = s * -0.4
          neck.add(ant)
        }
      }
      const legs: Mesh[] = []
      for (const [x, z] of [
        [0.2, 0.5],
        [-0.2, 0.5],
        [0.2, -0.5],
        [-0.2, -0.5],
      ] as const) {
        const l = new Mesh(kit.track(new CylinderGeometry(0.06, 0.04, 1.0, 5)), coat)
        l.geometry.translate(0, -0.5, 0)
        l.position.set(x, 1.05, z)
        legs.push(l)
        g.add(l)
      }
      const tail = new Mesh(kit.track(new SphereGeometry(0.1, 6, 4)), belly)
      tail.position.set(0, 1.4, -0.78)
      g.add(body, neck, tail)
      g.traverse((o) => ((o as Mesh).castShadow = true))
      group.add(g)
      const start = pick(edge.length ? edge : meadow)
      const b = bodies.add({ kind: 'deer', x: start[0], z: start[1], r: 0.75, mass: 8 })
      return { g, b, neck, legs, tail, target: new Vector3(start[0], 0, start[1]), graze: R() * 5, state: 'graze' as 'graze' | 'walk' | 'alert' | 'flee', timer: 0, heading: R() * 6, gait: 0 }
    })
    updates.push((dt, t, e, c) => {
      const act = habit.crepuscular(e) * (e.storm ? 0 : 1)
      coat.color.set(e.season === 'winter' ? '#8E806E' : '#B07A4E')
      const n = showN(list.length, act + 0.15)
      list.forEach((d, i) => {
        const show = i < n
        d.g.visible = show
        d.b.active = show
        if (!show) return
        const th = threat(d.b.x, d.b.z, c, 0.8)
        // 状态切换
        if (th.dist < 7 && d.state !== 'flee') {
          d.state = 'flee'
          d.timer = 3 + R() * 2
        } else if (th.dist < 13 && (d.state === 'graze' || d.state === 'walk')) {
          d.state = 'alert'
          d.timer = 1.5 + R()
        }
        let speed = 0
        if (d.state === 'flee') {
          d.timer -= dt
          speed = 5.2
          const a = walk(d.b, th.ax, th.az, speed * dt, ok)
          if (a !== null) d.heading = a
          if (d.timer <= 0 && th.dist > 14) {
            d.state = 'alert'
            d.timer = 2
          }
        } else if (d.state === 'alert') {
          d.timer -= dt
          // 转身看着威胁
          const want = Math.atan2(-th.ax, -th.az)
          let da = want - d.heading
          da = Math.atan2(Math.sin(da), Math.cos(da))
          d.heading += da * Math.min(1, dt * 3)
          if (d.timer <= 0 && th.dist > 13) d.state = 'graze'
        } else if (d.state === 'graze') {
          d.graze -= dt
          if (d.graze <= 0) {
            const cpt = pick(edge.length ? edge : meadow)
            d.target.set(cpt[0] + (R() - 0.5) * 6, 0, cpt[1] + (R() - 0.5) * 6)
            if (d.target.distanceTo(new Vector3(d.b.x, 0, d.b.z)) > 25) d.target.set(d.b.x + (R() - 0.5) * 12, 0, d.b.z + (R() - 0.5) * 12)
            d.state = 'walk'
          }
        } else {
          const dx = d.target.x - d.b.x
          const dz = d.target.z - d.b.z
          const dist = Math.hypot(dx, dz)
          speed = 1.2
          const a = dist > 0.4 ? walk(d.b, dx / dist, dz / dist, speed * dt, ok) : null
          if (a !== null) d.heading = a
          if (dist <= 0.4 || a === null) {
            d.state = 'graze'
            d.graze = 4 + R() * 8
          }
        }
        // 姿态
        const headDown = d.state === 'graze' ? 1.3 : d.state === 'flee' ? -0.15 : 0
        d.neck.rotation.x += (headDown - d.neck.rotation.x) * Math.min(1, dt * 4)
        d.gait += dt * (speed > 3 ? 11 : 6) * (speed > 0 ? 1 : 0)
        d.legs.forEach((l, k) => (l.rotation.x = speed > 0 ? Math.sin(d.gait + (k === 0 || k === 3 ? 0 : Math.PI)) * (speed > 3 ? 0.7 : 0.35) : 0))
        d.tail.position.y = d.state === 'flee' ? 1.55 : 1.4
        d.g.rotation.y = d.heading
        const bob = speed > 3 ? Math.abs(Math.sin(d.gait)) * 0.15 : 0
        d.g.position.set(d.b.x, groundAt(d.b.x, d.b.z) + bob, d.b.z)
      })
    })
  }

  // ======================================================================
  // 兔子：一蹦一蹦；有人靠近先立起来张望，再近就蹦着逃开
  // ======================================================================
  {
    const fur = kit.toon('#A88E74')
    const ok = landOk(0.3)
    const list = Array.from({ length: 6 }, () => {
      const g = new Group()
      const body = new Mesh(kit.track(new SphereGeometry(0.22, 8, 6)), fur)
      body.scale.set(0.9, 0.85, 1.2)
      body.position.y = 0.22
      const head = new Mesh(kit.track(new SphereGeometry(0.14, 8, 6)), fur)
      head.position.set(0, 0.38, 0.22)
      g.add(body, head)
      for (const s of [-1, 1]) {
        const ear = new Mesh(kit.track(new SphereGeometry(0.05, 6, 4)), fur)
        ear.scale.set(0.8, 3, 0.6)
        ear.position.set(s * 0.06, 0.58, 0.18)
        g.add(ear)
      }
      group.add(g)
      const home = pick(meadow)
      const b = bodies.add({ kind: 'rabbit', x: home[0], z: home[1], r: 0.28, mass: 1 })
      return { g, b, home, hop: 0, dir: R() * 6, rest: R() * 3, state: 'wander' as 'wander' | 'alert' | 'flee', timer: 0 }
    })
    updates.push((dt, _t, e, c) => {
      const act = clamp01(habit.crepuscular(e) + e.day * 0.2) * (e.wet ? 0.1 : 1)
      fur.color.set(e.season === 'winter' ? '#F2F2EE' : '#A88E74')
      const n = showN(list.length, act)
      list.forEach((r, i) => {
        const show = i < n
        r.g.visible = show
        r.b.active = show
        if (!show) return
        const th = threat(r.b.x, r.b.z, c, 1.3)
        if (th.dist < 4.5 && r.state !== 'flee') {
          r.state = 'flee'
          r.timer = 2.5
          r.dir = Math.atan2(th.ax, th.az) + (R() - 0.5) * 0.6
          r.rest = 0
          r.hop = 1
        } else if (th.dist < 8 && r.state === 'wander') {
          r.state = 'alert'
          r.timer = 1.2
        }
        if (r.state === 'alert') {
          r.timer -= dt
          r.g.scale.set(1, 1.25, 1)
          r.dir += Math.atan2(Math.sin(Math.atan2(-th.ax, -th.az) - r.dir), Math.cos(Math.atan2(-th.ax, -th.az) - r.dir)) * Math.min(1, dt * 4)
          if (r.timer <= 0 && th.dist > 8) r.state = 'wander'
        } else r.g.scale.set(1, 1, 1)
        const fleeing = r.state === 'flee'
        if (fleeing) {
          r.timer -= dt
          if (r.timer <= 0 && th.dist > 9) {
            r.state = 'wander'
            // 换个窝，不再回到人旁边
            r.home = [r.b.x, r.b.z]
          }
        }
        if (r.state !== 'alert') {
          if (r.rest > 0) {
            r.rest -= dt
            if (r.rest <= 0) {
              r.hop = 1
              if (!fleeing) {
                r.dir += (R() - 0.5) * 2
                if (Math.hypot(r.b.x - r.home[0], r.b.z - r.home[1]) > 6) r.dir = Math.atan2(r.home[0] - r.b.x, r.home[1] - r.b.z)
              }
            }
          } else {
            r.hop -= dt * (fleeing ? 3.4 : 2.6)
            const a = walk(r.b, Math.sin(r.dir), Math.cos(r.dir), dt * (fleeing ? 5 : 2.2), ok)
            if (a !== null) r.dir = a
            else r.dir += Math.PI * 0.5
            if (r.hop <= 0) r.rest = fleeing ? 0.05 : R() < 0.6 ? 0.15 : 1 + R() * 3
          }
        }
        const air = r.rest > 0 || r.state === 'alert' ? 0 : Math.sin(Math.max(0, r.hop) * Math.PI) * (fleeing ? 0.5 : 0.35)
        r.g.position.set(r.b.x, groundAt(r.b.x, r.b.z) + air, r.b.z)
        r.g.rotation.y = r.dir
      })
    })
  }

  // ======================================================================
  // 螃蟹：沙滩上横着走；人或狗靠近就横着冲向海里，钻进沙子，过一会儿在别处冒出来
  // ======================================================================
  {
    const crabMat = kit.toon('#E2603E')
    const beachOk = (r: number) => (x: number, z: number) => {
      const s = shore(x, z)
      return s > -1.5 && s < 7 && !solid(x, z, r)
    }
    const ok = beachOk(0.25)
    const spawn = (avoid: { x: number; z: number }[]) => {
      for (let k = 0; k < 20; k++) {
        const p = around(R() * Math.PI * 2, -2 - R() * 3)
        if (!ok(p.x, p.z)) continue
        if (avoid.some((a) => Math.hypot(a.x - p.x, a.z - p.z) < 7)) continue
        return p
      }
      return around(R() * Math.PI * 2, -3)
    }
    const list = Array.from({ length: 10 }, () => {
      const g = new Group()
      const body = new Mesh(kit.track(new SphereGeometry(0.22, 10, 6)), crabMat)
      body.scale.set(1.2, 0.5, 0.9)
      body.position.y = 0.14
      g.add(body)
      const legs: Mesh[] = []
      for (const s of [-1, 1])
        for (let k = 0; k < 3; k++) {
          const l = new Mesh(kit.track(new CylinderGeometry(0.02, 0.02, 0.28, 3)), crabMat)
          l.rotation.z = s * 1.0
          l.position.set(s * 0.3, 0.1, -0.12 + k * 0.12)
          g.add(l)
          legs.push(l)
        }
      for (const s of [-1, 1]) {
        const claw = new Mesh(kit.track(new SphereGeometry(0.08, 6, 4)), crabMat)
        claw.position.set(s * 0.18, 0.18, 0.25)
        g.add(claw)
      }
      group.add(g)
      const p = spawn([])
      const b = bodies.add({ kind: 'crab', x: p.x, z: p.z, r: 0.32, mass: 0.6 })
      const crab = { g, b, legs, dir: R() < 0.5 ? -1 : 1, ph: R() * 20, state: 'walk' as 'walk' | 'flee' | 'dig' | 'hidden' | 'emerge', timer: 0, sink: 0, heading: 0 }
      // 被碰到（狗、人、别的螃蟹）也会吓跑
      b.onBump = (o) => {
        if (o.kind !== 'crab' && crab.state === 'walk') {
          crab.state = 'flee'
          crab.timer = 2
        }
      }
      return crab
    })
    updates.push((dt, t, e, c) => {
      const act = clamp01(e.twilight + e.night * 0.8 + 0.15) * (e.wet ? 0.2 : 1) * (e.season === 'winter' ? 0.3 : 1)
      const n = showN(list.length, act)
      list.forEach((cr, i) => {
        const allowed = i < n
        if (!allowed && cr.state !== 'hidden') {
          cr.state = 'dig'
          cr.timer = 0.6
        }
        const th = threat(cr.b.x, cr.b.z, c, 0.75)
        if (cr.state === 'walk' && th.dist < 3.5) {
          cr.state = 'flee'
          cr.timer = 2.2
        }
        // 往海的方向
        const [seaX, seaZ] = seaward(cr.b.x, cr.b.z)
        let moving = false
        if (cr.state === 'walk') {
          // 走一会儿停一会儿，沿着海岸横着走
          const cycle = (t + cr.ph) % 10
          if (cycle < 4) {
            const a = walk(cr.b, -seaZ * cr.dir, seaX * cr.dir, dt * 0.5, ok)
            if (a === null) cr.dir *= -1
            moving = true
          }
          cr.heading = Math.atan2(seaX, seaZ)
        } else if (cr.state === 'flee') {
          // 逃跑方向：远离威胁 + 往海里
          const fx = th.ax * 0.6 + seaX
          const fz = th.az * 0.6 + seaZ
          const fl = Math.hypot(fx, fz) || 1
          const nx = cr.b.x + (fx / fl) * dt * 3.2
          const nz = cr.b.z + (fz / fl) * dt * 3.2
          if (!solid(nx, nz, 0.25)) {
            cr.b.x = nx
            cr.b.z = nz
          }
          moving = true
          cr.timer -= dt
          // 到了水边或者跑够了，就钻进沙里
          if (shore(cr.b.x, cr.b.z) < -0.8 || cr.timer <= 0) {
            cr.state = 'dig'
            cr.timer = 0.6
          }
        } else if (cr.state === 'dig') {
          cr.timer -= dt
          cr.sink = Math.min(1, cr.sink + dt / 0.6)
          if (cr.timer <= 0) {
            cr.state = 'hidden'
            cr.timer = 8 + R() * 10
          }
        } else if (cr.state === 'hidden') {
          cr.timer -= dt
          if (cr.timer <= 0 && allowed) {
            const p = spawn([c.player, c.dog])
            cr.b.x = p.x
            cr.b.z = p.z
            cr.state = 'emerge'
            cr.timer = 0.7
          }
        } else if (cr.state === 'emerge') {
          cr.timer -= dt
          cr.sink = Math.max(0, cr.sink - dt / 0.7)
          if (cr.timer <= 0) cr.state = 'walk'
        }
        cr.b.active = cr.state === 'walk' || cr.state === 'flee'
        cr.g.visible = cr.state !== 'hidden'
        cr.legs.forEach((l, k) => (l.rotation.x = moving ? Math.sin(t * (cr.state === 'flee' ? 30 : 18) + k) * 0.45 : 0))
        cr.g.position.set(cr.b.x, groundAt(cr.b.x, cr.b.z) - cr.sink * 0.35, cr.b.z)
        cr.g.rotation.y = cr.heading
      })
    })
  }

  // ======================================================================
  // 青蛙：溪边，下雨最多；有人靠近就跳进溪里
  // ======================================================================
  {
    const skin = kit.toon('#6FAE4A')
    const list = Array.from({ length: 8 }, () => {
      const g = new Group()
      const bm = new Mesh(kit.track(new SphereGeometry(0.15, 8, 6)), skin)
      bm.scale.set(1, 0.65, 1.15)
      bm.position.y = 0.1
      g.add(bm)
      for (const s of [-1, 1]) {
        const eye = new Mesh(kit.track(new SphereGeometry(0.045, 6, 4)), skin)
        eye.position.set(s * 0.07, 0.2, 0.08)
        g.add(eye)
      }
      group.add(g)
      const ri = Math.floor(RIVER.length * (0.45 + R() * 0.45))
      const p = RIVER[ri]!
      const side = R() < 0.5 ? -1 : 1
      let x = p[0] + side * (3 + R())
      let z = p[1] + (R() - 0.5) * 2
      if (solid(x, z, 0.3)) {
        x = p[0] - side * 3.4
        z = p[1]
      }
      const b = bodies.add({ kind: 'frog', x, z, r: 0.18, mass: 0.3 })
      return { g, b, home: [x, z] as [number, number], river: p, ph: R() * 10, state: 'sit' as 'sit' | 'leap' | 'hidden', timer: 0, from: new Vector3(), k: 0 }
    })
    updates.push((dt, t, e, c) => {
      const base = bySeason(e.season, { spring: 0.7, summer: 1, autumn: 0.4, winter: 0 })
      const act = base * (e.wet ? 1 : clamp01(0.3 + e.night * 0.6))
      const n = showN(list.length, act)
      list.forEach((f, i) => {
        const allowed = i < n
        if (f.state === 'sit') {
          if (!allowed) f.state = 'hidden'
          else if (threat(f.b.x, f.b.z, c, 1.2).dist < 3) {
            f.state = 'leap'
            f.k = 0
            f.from.set(f.b.x, groundAt(f.b.x, f.b.z), f.b.z)
            f.g.rotation.y = Math.atan2(f.river[0] - f.b.x, f.river[1] - f.b.z)
          }
        } else if (f.state === 'leap') {
          f.k = Math.min(1, f.k + dt * 2.2)
          f.b.x = f.from.x + (f.river[0] - f.from.x) * f.k
          f.b.z = f.from.z + (f.river[1] - f.from.z) * f.k
          if (f.k >= 1) {
            f.state = 'hidden'
            f.timer = 12 + R() * 10
          }
        } else {
          f.timer -= dt
          if (f.timer <= 0 && allowed && threat(f.home[0], f.home[1], c).dist > 8) {
            f.b.x = f.home[0]
            f.b.z = f.home[1]
            f.state = 'sit'
          }
        }
        f.b.active = f.state === 'sit'
        f.g.visible = f.state !== 'hidden'
        if (!f.g.visible) return
        if (f.state === 'leap') {
          const y = f.from.y + (0.2 - f.from.y) * f.k + Math.sin(f.k * Math.PI) * 0.8
          f.g.position.set(f.b.x, y, f.b.z)
        } else {
          const cyc = (t + f.ph) % 6
          const jump = cyc < 0.4 ? Math.sin((cyc / 0.4) * Math.PI) * 0.3 : 0
          f.g.position.set(f.b.x, groundAt(f.b.x, f.b.z) + jump, f.b.z)
          f.g.rotation.y = f.ph
        }
      })
    })
  }

  // ======================================================================
  // 飞蛾：夏秋夜里绕着路灯
  // ======================================================================
  if (bulbs.length) {
    const PER = 5
    const geo = kit.track(new BufferGeometry())
    const pos = new Float32Array(bulbs.length * PER * 3)
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    const mat = kit.track(new PointsMaterial({ color: '#FFF1C8', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }))
    const pts = new Points(geo, mat)
    pts.frustumCulled = false
    group.add(pts)
    updates.push((_dt, t, e) => {
      const act = habit.nocturnal(e) * bySeason(e.season, { spring: 0.4, summer: 1, autumn: 0.7, winter: 0 }) * (e.wet ? 0 : 1)
      mat.opacity = act * 0.9
      if (act <= 0) return
      bulbs.forEach((b, i) => {
        for (let k = 0; k < PER; k++) {
          const a = t * (2 + k * 0.7) + i * 3 + k
          pos.set([b.x + Math.cos(a) * 0.5, b.y + Math.sin(a * 1.7) * 0.3, b.z + Math.sin(a) * 0.5], (i * PER + k) * 3)
        }
      })
      geo.attributes.position!.needsUpdate = true
    })
  }

  return {
    group,
    update(dt, t, eco, ctx) {
      for (const u of updates) u(dt, t, eco, ctx)
    },
  }
}
