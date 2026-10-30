/** 搭房子用的小零件：盒子、人字屋顶、窗、门、路灯。 */
import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  type Material,
} from 'three'
import type { Kit } from './kit'

export interface Mats {
  win: Material
  bulb: Material
  white: Material
  wood: Material
  darkWood: Material
  stone: Material
  metal: Material
}

export function createProps(kit: Kit, mats: Mats) {
  const geoCache = new Map<string, BoxGeometry>()
  const boxGeo = (w: number, h: number, d: number) => {
    const key = `${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}`
    let g = geoCache.get(key)
    if (!g) {
      g = kit.track(new BoxGeometry(w, h, d))
      geoCache.set(key, g)
    }
    return g
  }

  /** 盒子，y 是底面高度 */
  function box(w: number, h: number, d: number, mat: Material, x = 0, y = 0, z = 0, shadow = true) {
    const m = new Mesh(boxGeo(w, h, d), mat)
    m.position.set(x, y + h / 2, z)
    m.castShadow = shadow
    m.receiveShadow = true
    return m
  }

  function cyl(rt: number, rb: number, h: number, mat: Material, x = 0, y = 0, z = 0, seg = 10) {
    const m = new Mesh(kit.track(new CylinderGeometry(rt, rb, h, seg)), mat)
    m.position.set(x, y + h / 2, z)
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  /** 人字屋顶：屋脊沿 x，两片有厚度的屋面板，加两头的山墙三角 */
  function gable(w: number, d: number, rise: number, roofMat: Material, wallMat: Material, y: number, overhang = 0.5, thick = 0.22) {
    const g = new Group()
    const hd = d / 2 + overhang
    const a = Math.atan2(rise, d / 2)
    const L = hd / Math.cos(a)
    for (const side of [1, -1]) {
      const slab = new Mesh(boxGeo(w + overhang * 2, thick, L), roofMat)
      slab.rotation.x = side * a
      slab.position.set(0, y + rise - (hd / 2) * Math.tan(a) + thick / 2, (side * hd) / 2)
      slab.castShadow = slab.receiveShadow = true
      g.add(slab)
    }
    const shape = new Shape()
    shape.moveTo(-d / 2, 0)
    shape.lineTo(d / 2, 0)
    shape.lineTo(0, rise)
    shape.closePath()
    const tri = kit.track(new ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }))
    tri.rotateY(Math.PI / 2)
    tri.translate(-w / 2, 0, 0)
    const m = new Mesh(tri, wallMat)
    m.position.y = y
    m.castShadow = m.receiveShadow = true
    g.add(m)
    // 屋脊压条
    const ridge = new Mesh(boxGeo(w + overhang * 2 + 0.1, thick * 1.2, 0.36), roofMat)
    ridge.position.set(0, y + rise + thick * 0.9, 0)
    ridge.castShadow = true
    g.add(ridge)
    // 山墙两头的白色封檐板
    for (const end of [-1, 1])
      for (const side of [1, -1]) {
        const fb = new Mesh(boxGeo(0.1, 0.22, L + 0.05), mats.white)
        fb.rotation.x = side * a
        fb.position.set(end * (w / 2 + overhang + 0.02), y + rise - (hd / 2) * Math.tan(a) + 0.02, (side * hd) / 2)
        g.add(fb)
      }
    return g
  }

  const winGeo = kit.track(new PlaneGeometry(1, 1))
  const flowerGeo = kit.track(new SphereGeometry(0.11, 6, 4))
  const flowerMats = ['#E8586A', '#F2C641', '#F4F0F2', '#B48AE0'].map((c) => kit.toon(c))
  /** 窗：白框 + 发光玻璃。face 是窗所在墙面的朝向（弧度，0 = +z） */
  function window_(x: number, y: number, z: number, face: number, w = 1.1, h = 1.0) {
    const g = new Group()
    const frame = box(w + 0.24, h + 0.24, 0.1, mats.white, 0, -0.12 - h / 2, 0, false)
    const glass = new Mesh(winGeo, mats.win)
    glass.scale.set(w, h, 1)
    glass.position.z = 0.06
    const bar = box(0.07, h, 0.04, mats.white, 0, -h / 2, 0.08, false)
    const sill = box(w + 0.4, 0.1, 0.25, mats.white, 0, -h / 2 - 0.2, 0.1, false)
    const hbar = box(w, 0.06, 0.04, mats.white, 0, -0.03, 0.08, false)
    // 窗台花箱：一排小花
    const planter = box(w + 0.1, 0.22, 0.26, mats.darkWood, 0, -h / 2 - 0.42, 0.2, false)
    g.add(frame, glass, bar, hbar, sill, planter)
    for (let i = 0; i < 4; i++) {
      const fl = new Mesh(flowerGeo, flowerMats[i % flowerMats.length]!)
      fl.position.set(-w / 2 + 0.15 + (i * (w - 0.3)) / 3, -h / 2 - 0.16, 0.2)
      g.add(fl)
    }
    g.position.set(x, y, z)
    g.rotation.y = face
    return g
  }

  function door(x: number, z: number, face: number, y = 0, w = 1.15, h = 2.3, mat = mats.darkWood) {
    const g = new Group()
    g.add(box(w + 0.2, h + 0.12, 0.08, mats.white, 0, 0, 0, false))
    g.add(box(w, h, 0.12, mat, 0, 0, 0.03, false))
    const knob = new Mesh(kit.track(new SphereGeometry(0.06, 6, 4)), mats.metal)
    knob.position.set(w * 0.35, h * 0.48, 0.12)
    g.add(knob)
    g.position.set(x, y, z)
    g.rotation.y = face
    return g
  }

  /**
   * 一栋房子。正面朝 +z，原点在地面中心。
   * windows：正面门两侧和左右侧墙上的窗数。
   */
  function house(o: {
    w: number
    d: number
    h: number
    wall: Material
    roof: Material
    rise?: number
    door?: boolean
    sideWindows?: number
    frontWindows?: number
    base?: Material
  }) {
    const g = new Group()
    const rise = o.rise ?? o.d * 0.38
    if (o.base) g.add(box(o.w + 0.3, 0.45, o.d + 0.3, o.base, 0, -0.2, 0))
    g.add(box(o.w, o.h, o.d, o.wall))
    g.add(gable(o.w, o.d, rise, o.roof, o.wall, o.h))
    if (o.door !== false) g.add(door(0, o.d / 2 + 0.01, 0, 0.05))
    const fw = o.frontWindows ?? 2
    for (let i = 0; i < fw; i++) {
      const x = (i % 2 ? 1 : -1) * (o.w / 4 + 0.35) * (fw > 2 ? (i < 2 ? 0.75 : 1.5) : 1)
      g.add(window_(x, o.h * 0.72, o.d / 2 + 0.02, 0))
    }
    const sw = o.sideWindows ?? 1
    for (let i = 0; i < sw; i++) {
      const z = sw === 1 ? 0 : -o.d / 4 + (i * o.d) / 2
      g.add(window_(o.w / 2 + 0.02, o.h * 0.72, z, Math.PI / 2))
      g.add(window_(-o.w / 2 - 0.02, o.h * 0.72, z, -Math.PI / 2))
    }
    // 背面也开一扇，从后面看不是一面白墙
    g.add(window_(0, o.h * 0.72, -o.d / 2 - 0.02, Math.PI))
    // 墙脚一圈深色踢脚，墙角四根白色角柱
    g.add(box(o.w + 0.06, 0.32, o.d + 0.06, mats.darkWood, 0, 0, 0, false))
    for (const [x, z] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const)
      g.add(box(0.16, o.h, 0.16, mats.white, (x * o.w) / 2, 0, (z * o.d) / 2, false))
    return g
  }

  /** 路灯：木杆 + 小灯箱。返回灯泡的局部位置，用来放光晕 */
  function lamp(height = 3.4) {
    const g = new Group()
    g.add(cyl(0.07, 0.1, height, mats.darkWood, 0, 0, 0, 6))
    g.add(box(0.7, 0.08, 0.12, mats.darkWood, 0.25, height - 0.25, 0, false))
    const head = box(0.34, 0.42, 0.34, mats.bulb, 0.5, height - 0.72, 0, false)
    const cap = box(0.48, 0.08, 0.48, mats.darkWood, 0.5, height - 0.32, 0, false)
    g.add(head, cap)
    return { group: g, bulb: [0.5, height - 0.5, 0] as const }
  }

  function bench(len = 2.2) {
    const g = new Group()
    g.add(box(len, 0.1, 0.5, mats.wood, 0, 0.48, 0))
    g.add(box(len, 0.45, 0.08, mats.wood, 0, 0.62, -0.24))
    for (const x of [-len / 2 + 0.2, len / 2 - 0.2]) g.add(box(0.1, 0.5, 0.45, mats.darkWood, x, 0, 0, false))
    return g
  }

  return { box, cyl, gable, window: window_, door, house, lamp, bench, boxGeo }
}

export type Props = ReturnType<typeof createProps>
