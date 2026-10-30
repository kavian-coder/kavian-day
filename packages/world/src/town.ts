/**
 * 坡地小镇（v2）：沿着海湾北岸和几条上坡街道，一排排白墙、淡彩墙、陶红瓦或青绿瓦的房子。
 * 对照 doc/world/v2-concept 的总览图、夜晚街道、小镇主街。
 *
 * 所有房子按材质合并成几块大网格（墙、瓦、窗框、玻璃、木头、花），所以几百个零件也只有几次绘制。
 * 每栋房子：
 *   - 地基按四个角里最高的地面取平，低的那边用石砌台基补上，不会悬空也不会陷进坡里；
 *   - 1–3 层，窗户带白窗框，一部分有木百叶；底层临街的有条纹遮阳篷（小店）；
 *   - 坡屋顶（四坡）或平屋顶（女儿墙、水箱、太阳能板）；
 *   - 一部分墙角爬着三角梅。
 * 夜里一部分窗户亮暖光（和其他房子共用窗户材质）。
 */
import { BoxGeometry, Box3, BufferGeometry, Color, Float32BufferAttribute, Group, IcosahedronGeometry, Matrix4, Mesh, Quaternion, Vector3, CylinderGeometry, type Material } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mergeStatic, type Kit } from './kit'
import { LOTS, MAIN_COAST, RIVER, distTo, quayMask, seaward, shore, type V2 } from './layout'
import { rng } from './noise'
import type { Mats } from './props'

export interface Town {
  group: Group
  /** 碰撞圆 */
  obstacles: { x: number; z: number; r: number }[]
  /** 每栋房子的包围盒：镜头避让、树冠净空用 */
  boxes: Box3[]
  /** 房子的位置和朝向（以后挂栏目、做门口提示用） */
  houses: House[]
  /** 可以走上去的木码头 */
  decks: { at: (x: number, z: number) => number | null }[]
  /** 船跟着浪起伏 */
  update: (t: number) => void
}

export interface House {
  x: number
  z: number
  ang: number
  w: number
  d: number
  y: number
  floors: number
  shop: boolean
}

const WALLS = ['#FAF6EE', '#FBF3E1', '#F5E6C8', '#F7DABB', '#F3CFC6', '#D6EBE4', '#D3E3F2', '#F6E7A8', '#FFFFFF', '#FAF6EE', '#F1E9DA']
const ROOFS_RED = ['#D8653C', '#C9552F', '#E0784A', '#BD4D2E', '#D96F45']
const ROOFS_TEAL = ['#3F8F94', '#3B7EA6', '#4A9AA0']
const SHUTTERS = ['#3E8F8A', '#4C7FB0', '#5E9C5A', '#9A6A45', '#2F7A92']
const AWNINGS = ['#D9483B', '#2F79B8', '#2E9C83', '#E6A12E']
const BOUGAIN = ['#E0408E', '#F0609F', '#D63480', '#F27BB1']

/** 四坡屋顶：屋脊沿 x，底面在 y = 0，四周出檐 o */
function hipRoof(w: number, d: number, rise: number, o: number) {
  const swap = d > w
  const W = (swap ? d : w) / 2 + o
  const D = (swap ? w : d) / 2 + o
  const r = Math.max(0, W - D)
  const E1 = [-W, 0, -D]
  const E2 = [W, 0, -D]
  const E3 = [W, 0, D]
  const E4 = [-W, 0, D]
  const R1 = [-r, rise, 0]
  const R2 = [r, rise, 0]
  const tris = [
    // 前坡（+z）
    E4, E3, R2, E4, R2, R1,
    // 后坡
    E2, E1, R1, E2, R1, R2,
    // 两头
    E3, E2, R2,
    E1, E4, R1,
    // 底面（檐下）
    E1, E2, E3, E1, E3, E4,
  ]
  const pos: number[] = []
  for (const v of tris) pos.push(v[0]!, v[1]!, v[2]!)
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  if (swap) g.rotateY(Math.PI / 2)
  g.computeVertexNormals()
  return g
}

export function createTown(
  kit: Kit,
  groundAt: (x: number, z: number) => number,
  mats: Mats,
  /** 已经被房子、站台、灯杆占用的地方（地块在 layout 里已经避开了，这里留着备用） */
  _builtUp?: (x: number, z: number, margin: number) => boolean,
): Town {
  const group = new Group()
  const R = rng(4242)
  const pick = <T>(a: readonly T[]) => a[Math.floor(R() * a.length)]!
  const obstacles: Town['obstacles'] = []
  const boxes: Box3[] = []
  const houses: House[] = []

  // ---------- 地块在 layout 里已经定好、地形也已经平整过
  for (const l of LOTS) houses.push({ x: l.x, z: l.z, ang: l.ang, w: l.w, d: l.d, y: l.y, floors: l.floors, shop: l.shop })

  // ---------- 生成几何
  const parts = { wall: [] as BufferGeometry[], roof: [] as BufferGeometry[], white: [] as BufferGeometry[], glass: [] as BufferGeometry[], glassDim: [] as BufferGeometry[], wood: [] as BufferGeometry[], plinth: [] as BufferGeometry[], plant: [] as BufferGeometry[], metal: [] as BufferGeometry[] }
  const m4 = new Matrix4()
  const q = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const tmpC = new Color()
  const colorize = (g: BufferGeometry, hex: string) => {
    tmpC.set(hex)
    const n = g.getAttribute('position').count
    const c = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) c.set([tmpC.r, tmpC.g, tmpC.b], i * 3)
    g.setAttribute('color', new Float32BufferAttribute(c, 3))
    return g
  }
  /** 放一个盒子：局部坐标 (u, y, v) 是盒子中心，旋转 rotY 跟房子一致 */
  let H: House
  const place = (g: BufferGeometry, u: number, y: number, v: number, extraRot = 0, tilt = 0) => {
    const ca = Math.cos(H.ang)
    const sa = Math.sin(H.ang)
    q.setFromAxisAngle(up, -H.ang + extraRot)
    if (tilt) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt))
    m4.compose(new Vector3(H.x + u * ca - v * sa, H.y + y, H.z + u * sa + v * ca), q, new Vector3(1, 1, 1))
    g.applyMatrix4(m4)
    return g
  }
  const box = (list: BufferGeometry[], w: number, h: number, d: number, u: number, y: number, v: number, color?: string, extraRot = 0, tilt = 0) => {
    const g = new BoxGeometry(w, h, d)
    g.deleteAttribute('uv')
    if (color) colorize(g, color)
    list.push(place(g, u, y, v, extraRot, tilt))
  }

  for (const h of houses) {
    H = h
    const ca = Math.cos(h.ang)
    const sa = Math.sin(h.ang)
    // 地块已经平整过：房子直接坐在平地上，墙脚往下多埋 0.6 米，免得边上有缝
    const lo = h.y - 0.6
    h.y = groundAt(h.x, h.z) + 0.02
    const FH = 2.9
    const Ht = h.floors * FH
    const wall = pick(WALLS)
    // 石砌台基：盖住坡下那一边
    box(parts.plinth, h.w + 0.3, 0.75, h.d + 0.3, 0, -0.3, 0)
    box(parts.wall, h.w, Ht, h.d, 0, Ht / 2, 0, wall)
    // 每层之间一条细腰线
    for (let f = 1; f < h.floors; f++) box(parts.white, h.w + 0.08, 0.14, h.d + 0.08, 0, f * FH, 0)
    // 窗户：正面和两侧
    const shutterC = pick(SHUTTERS)
    const shutters = R() < 0.55
    const faces: { len: number; v: number; rot: number }[] = [
      { len: h.w, v: h.d / 2, rot: 0 },
      { len: h.d, v: h.w / 2, rot: Math.PI / 2 },
      { len: h.d, v: h.w / 2, rot: -Math.PI / 2 },
      { len: h.w, v: h.d / 2, rot: Math.PI },
    ]
    faces.forEach((fc, fi) => {
      const n = Math.max(1, Math.floor((fc.len - 0.8) / 1.7))
      for (let f = 0; f < h.floors; f++) {
        for (let k = 0; k < n; k++) {
          const t = n === 1 ? 0 : (k / (n - 1) - 0.5) * (fc.len - 1.8)
          // 底层正面中间留给门
          if (fi === 0 && f === 0 && Math.abs(t) < 0.9) continue
          if (fi === 3 && R() < 0.4) continue
          const y = f * FH + 1.55
          // 把面上的 (t, v) 转成房子局部 (u, v)
          const cr = Math.cos(fc.rot)
          const sr = Math.sin(fc.rot)
          const lu = t * cr + fc.v * sr
          const lv = -t * sr + fc.v * cr
          const nu = sr
          const nv = cr
          box(parts.white, 0.98, 1.32, 0.1, lu + nu * 0.02, y, lv + nv * 0.02, undefined, fc.rot)
          box(R() < 0.7 ? parts.glass : parts.glassDim, 0.78, 1.1, 0.1, lu + nu * 0.05, y, lv + nv * 0.05, undefined, fc.rot)
          // Recessed glass, mullions and a transom stay in the existing material batches.
          box(parts.white, .045, 1.1, .06, lu + nu * .13, y, lv + nv * .13, undefined, fc.rot)
          box(parts.white, .78, .045, .06, lu + nu * .13, y + .16, lv + nv * .13, undefined, fc.rot)
          // 窗台
          box(parts.white, 1.1, 0.08, 0.22, lu + nu * 0.1, y - 0.68, lv + nv * 0.1, undefined, fc.rot)
          if (shutters && fi < 3) {
            for (const s of [-1, 1]) {
              const su = lu + cr * s * 0.72 + nu * 0.06
              const sv = lv - sr * s * 0.72 + nv * 0.06
              box(parts.wall, 0.42, 1.25, 0.06, su, y, sv, shutterC, fc.rot)
              for(let sl=0;sl<8;sl++)box(parts.wood,.34,.035,.045,su+nu*.045,y-.5+sl*.14,sv+nv*.045,undefined,fc.rot)
            }
          }
        }
      }
    })
    // 门前的台阶：地块比街面高的时候，一级级下到街上（每级高约 0.2 米、深 0.32 米）
    {
      const fx = h.x - (h.d / 2 + 2.6) * sa
      const fz = h.z + (h.d / 2 + 2.6) * ca
      const dy = h.y - groundAt(fx, fz)
      if (dy > 0.25) {
        const n = Math.min(10, Math.round(dy / 0.2))
        for (let i = 0; i < n; i++) {
          const top = -dy * ((i + 1) / (n + 1))
          const bottom = -dy - 0.3
          box(parts.plinth, 1.5, top - bottom, 0.34, 0, (top + bottom) / 2, h.d / 2 + 0.55 + i * 0.32)
        }
      }
    }
    // 门
    box(parts.white, 1.25, 2.3, 0.1, 0, 1.15, h.d / 2 + 0.02)
    box(parts.wood, 1.0, 2.1, 0.12, 0, 1.05, h.d / 2 + 0.05)
    box(parts.plinth, 1.6, 0.18, 0.7, 0, 0.0, h.d / 2 + 0.35)
    box(parts.metal,.045,.25,.07,.34,1.1,h.d/2+.15)
    for(const u of [-.34,.34])box(parts.wood,.035,1.85,.035,u,1.05,h.d/2+.13)
    // 小店：底层大玻璃 + 条纹遮阳篷
    if (h.shop) {
      for (const s of [-1, 1]) {
        box(parts.white, 1.6, 1.8, 0.1, s * Math.min(1.9, h.w / 2 - 1.1), 1.4, h.d / 2 + 0.03)
        box(parts.glass, 1.4, 1.6, 0.1, s * Math.min(1.9, h.w / 2 - 1.1), 1.4, h.d / 2 + 0.07)
      }
      const aw = h.w * 0.86
      const col = pick(AWNINGS)
      const strips = Math.max(6, Math.round(aw / 0.45))
      for (let i = 0; i < strips; i++) {
        const u = -aw / 2 + (i + 0.5) * (aw / strips)
        box(parts.wall, aw / strips + 0.01, 0.06, 1.3, u, 2.62, h.d / 2 + 0.6, i % 2 ? '#FBF7EE' : col, 0, 0.32)
      }
    }
    // 二楼阳台
    if (h.floors >= 2 && R() < 0.5) {
      const bw = Math.min(h.w - 1, 2.6 + R() * 1.5)
      box(parts.white, bw, 0.16, 0.9, 0, FH, h.d / 2 + 0.45)
      box(parts.metal, bw, 0.06, 0.06, 0, FH + 0.95, h.d / 2 + 0.88)
      for (let u = -bw / 2 + 0.1; u <= bw / 2; u += 0.22) box(parts.metal, 0.04, 0.95, 0.04, u, FH + 0.5, h.d / 2 + 0.88)
    }
    // 屋顶
    if (R() < 0.72) {
      const g = hipRoof(h.w, h.d, 1.1 + R() * 0.5, 0.45)
      colorize(g, R() < 0.68 ? pick(ROOFS_RED) : pick(ROOFS_TEAL))
      parts.roof.push(place(g, 0, Ht, 0))
      // 屋檐下一圈白封檐
      box(parts.white, h.w + 0.9, 0.16, h.d + 0.9, 0, Ht - 0.06, 0)
      if (R() < 0.35) box(parts.white, 0.6, 1.4, 0.6, (R() - 0.5) * h.w * 0.5, Ht + 0.7, -h.d * 0.15) // 烟囱
    } else {
      // 平屋顶：女儿墙、水箱、太阳能板
      box(parts.white, h.w + 0.1, 0.2, h.d + 0.1, 0, Ht, 0)
      for (const [u, v, w, d] of [
        [0, h.d / 2, h.w + 0.1, 0.18],
        [0, -h.d / 2, h.w + 0.1, 0.18],
        [h.w / 2, 0, 0.18, h.d],
        [-h.w / 2, 0, 0.18, h.d],
      ] as const)
        box(parts.wall, w, 0.6, d, u, Ht + 0.4, v, wall)
      if (R() < 0.6) {
        const tank = new CylinderGeometry(0.45, 0.45, 1.3, 10).rotateZ(Math.PI / 2)
        tank.deleteAttribute('uv')
        parts.metal.push(place(tank, -h.w * 0.25, Ht + 0.95, -h.d * 0.2))
      }
      box(parts.glassDim, 1.6, 0.06, 1.0, h.w * 0.15, Ht + 0.7, 0, undefined, 0, -0.5)
    }
    // 三角梅：从墙角爬上去的一团团粉红花
    if (R() < 0.45) {
      const cu = (R() < 0.5 ? -1 : 1) * (h.w / 2)
      const col = pick(BOUGAIN)
      for (let i = 0; i < 65; i++) {
        const t=i/64, u=cu+Math.sin(t*15)*.34+(R()-.5)*.45, y=.5+t*(Ht-.8)
        const g=new IcosahedronGeometry(.10+R()*.10,1)
        g.scale(1,.55,.6);g.deleteAttribute('uv');colorize(g,i%3===0?'#4E794D':col)
        parts.plant.push(place(g,u,y,h.d/2+.23+R()*.3))
      }
    }

    // 门口的花盆
    if (R() < 0.6)
      for (const s of [-1, 1]) {
        const pot = new CylinderGeometry(0.24, 0.18, 0.42, 8)
        pot.deleteAttribute('uv')
        colorize(pot, '#C46A43')
        parts.wall.push(place(pot, s * 0.95, 0.21, h.d / 2 + 0.55))
        const leaf = new IcosahedronGeometry(0.24, 1)
        leaf.deleteAttribute('uv')
        colorize(leaf, '#4F9A45')
        parts.plant.push(place(leaf, s * 0.95, 0.68, h.d / 2 + 0.55))
      }

    // 碰撞和包围盒
    const long = Math.max(h.w, h.d)
    const short = Math.min(h.w, h.d)
    const r = short / 2 + 0.25
    const n = Math.max(1, Math.ceil((long - short) / r) + 1)
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (long - short)
      const u = h.w >= h.d ? t : 0
      const v = h.w >= h.d ? 0 : t
      obstacles.push({ x: h.x + u * ca - v * sa, z: h.z + u * sa + v * ca, r })
    }
    const rad = Math.hypot(h.w, h.d) / 2 + 0.5
    boxes.push(new Box3(new Vector3(h.x - rad, lo - 0.5, h.z - rad), new Vector3(h.x + rad, h.y + Ht + 1.8, h.z + rad)))
  }

  // ---------- 合并
  const vc = { vertexColors: true }
  const M = {
    wall: kit.pattern(kit.toon(0xffffff, vc), 'plaster', 1.3, 0.8),
    roof: kit.pattern(kit.toon(0xffffff, vc), 'roof', 1),
    white: mats.white,
    glass: mats.win,
    glassDim: kit.toon('#4A6178'),
    wood: kit.pattern(kit.toon('#8E5E3B'), 'plank', 2),
    plinth: mats.stone,
    // 合并后的网格是世界坐标，不能用按高度摆动的 sway（会把高处的花甩出去）
    plant: kit.toon(0xffffff, vc),
    metal: kit.toon('#5E6A73'),
  }
  for (const [k, list] of Object.entries(parts) as [keyof typeof parts, BufferGeometry[]][]) {
    if (!list.length) continue
    const fixed = list.map((g) => {
      const ng = g.index ? g.toNonIndexed() : g
      if (!ng.getAttribute('color')) colorize(ng, '#FFFFFF')
      if (ng.getAttribute('uv')) ng.deleteAttribute('uv')
      if (!ng.getAttribute('normal')) ng.computeVertexNormals()
      return ng
    })
    const merged = mergeGeometries(fixed)
    fixed.forEach((g) => g.dispose())
    list.forEach((g) => g.dispose())
    if (!merged) continue
    kit.track(merged)
    const mesh = new Mesh(merged, M[k] as Material)
    mesh.castShadow = k !== 'glass' && k !== 'glassDim'
    mesh.receiveShadow = true
    group.add(mesh)
  }
  // ======================================================================
  // 港口：石砌码头墙、栏杆、伸进海湾的木码头和停着的船
  // ======================================================================
  const decks: Town['decks'] = []
  const anims: ((t: number) => void)[] = []
  {
    // 码头墙：沿着真实的海岸线（shore = 0）走，墙外皮在水里 0.9 米，墙顶比地面高一点
    const quayParts: BufferGeometry[] = []
    const railParts: BufferGeometry[] = []
    const edge: V2[] = []
    for (let i = 0; i < MAIN_COAST.length; i += 1) {
      const p = MAIN_COAST[i]!
      if (quayMask(p[0], p[1]) < 0.5) {
        if (edge.length) edge.push([NaN, NaN])
        continue
      }
      // 沿往海的方向找到真正的岸线
      const [sx, sz] = seaward(p[0], p[1])
      let lo = -4
      let hi = 4
      for (let k = 0; k < 18; k++) {
        const m = (lo + hi) / 2
        if (shore(p[0] + sx * m, p[1] + sz * m) > 0) lo = m
        else hi = m
      }
      edge.push([p[0] + sx * lo, p[1] + sz * lo])
    }
    for (let i = 1; i < edge.length; i++) {
      const a = edge[i - 1]!
      const b = edge[i]!
      if (Number.isNaN(a[0]) || Number.isNaN(b[0])) continue
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < 0.2 || len > 4) continue
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
      const [sx, sz] = seaward((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
      const cx = (a[0] + b[0]) / 2 + sx * 0.35
      const cz = (a[1] + b[1]) / 2 + sz * 0.35
      const wall = new BoxGeometry(len + 0.08, 4.6, 1.3)
      wall.deleteAttribute('uv')
      q.setFromAxisAngle(up, -ang)
      m4.compose(new Vector3(cx, 2.2 - 2.3, cz), q, new Vector3(1, 1, 1))
      quayParts.push(wall.applyMatrix4(m4))
      // 墙顶的压顶石
      const cap = new BoxGeometry(len + 0.08, 0.2, 1.5)
      cap.deleteAttribute('uv')
      m4.compose(new Vector3(cx, 2.2 + 0.05, cz), q, new Vector3(1, 1, 1))
      quayParts.push(cap.applyMatrix4(m4))
      // 栏杆：每 2.4 米一根柱子，顶上一根扶手
      const rx = cx + sx * 0.35
      const rz = cz + sz * 0.35
      const rail = new BoxGeometry(len + 0.05, 0.07, 0.07)
      rail.deleteAttribute('uv')
      m4.compose(new Vector3(rx, 3.15, rz), q, new Vector3(1, 1, 1))
      railParts.push(rail.applyMatrix4(m4))
      if (i % 2 === 0) {
        const post = new BoxGeometry(0.08, 1.0, 0.08)
        post.deleteAttribute('uv')
        m4.compose(new Vector3(rx, 2.7, rz), q, new Vector3(1, 1, 1))
        railParts.push(post.applyMatrix4(m4))
      }
    }
    const addMerged = (list: BufferGeometry[], mat: Material, shadow = true) => {
      if (!list.length) return
      const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)))
      list.forEach((x) => x.dispose())
      if (!g) return
      kit.track(g)
      const m = new Mesh(g, mat)
      m.castShadow = shadow
      m.receiveShadow = true
      group.add(m)
    }
    addMerged(quayParts, mats.stone)
    addMerged(railParts, mats.white, false)

    // 木码头：从码头墙往海湾里伸出去，每座两边停船
    const plank = kit.pattern(kit.toon('#B58A61'), 'plank', 1.6)
    const postM = mats.darkWood
    const hullM = kit.toon('#F6F3EC')
    const stripes = ['#2F6FB0', '#D9483B', '#2E9C83', '#E6A12E'].map((c) => kit.toon(c))
    const cabinM = kit.toon('#FFFFFF')
    const deckM = kit.pattern(kit.toon('#B88A5E'), 'plank', 3)
    const glassM = mats.win
    const boatGeo = (len: number, beam: number) => {
      const g = new BoxGeometry(beam, 0.8, len, 1, 1, 8)
      const p = g.getAttribute('position')
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i) / (len / 2)
        const front = Math.max(0, z)
        const taper = 1 - front * front * 0.85 - Math.max(0, -z) ** 4 * 0.15
        const bottom = p.getY(i) < 0 ? 0.55 : 1
        p.setX(i, p.getX(i) * taper * bottom)
        if (p.getY(i) > 0) p.setY(i, p.getY(i) + front * front * 0.35)
      }
      g.computeVertexNormals()
      return kit.track(g)
    }
    const makeBoat = (len: number, kind: 'fish' | 'row' | 'cruiser') => {
      const b = new Group()
      const hull = new Mesh(boatGeo(len, len * 0.36), hullM)
      hull.castShadow = true
      b.add(hull)
      // 船舷一圈色带、船舱里的木甲板（比船舷低一点，看得出船是空心的）
      const stripe = new Mesh(kit.track(new BoxGeometry(len * 0.36 * 0.98, 0.14, len * 0.9)), stripes[Math.floor(R() * stripes.length)]!)
      stripe.position.y = 0.2
      b.add(stripe)
      const inner = new Mesh(kit.track(new BoxGeometry(len * 0.36 * 0.78, 0.1, len * 0.7)), deckM)
      inner.position.set(0, 0.33, -len * 0.04)
      b.add(inner)
      for (const sd of [-1, 1]) {
        const rim = new Mesh(kit.track(new BoxGeometry(0.08, 0.12, len * 0.72)), hullM)
        rim.position.set(sd * len * 0.36 * 0.42, 0.44, -len * 0.04)
        b.add(rim)
      }
      if (kind === 'row') {
        for (const zz of [-0.2, 0.25]) {
          const seat = new Mesh(kit.track(new BoxGeometry(len * 0.3, 0.06, 0.22)), deckM)
          seat.position.set(0, 0.5, zz * len)
          b.add(seat)
        }
      }
      if (kind !== 'row') {
        const cab = new Mesh(kit.track(new BoxGeometry(len * 0.26, 0.9, len * 0.3)), cabinM)
        cab.position.set(0, 0.85, -len * 0.08)
        cab.castShadow = true
        b.add(cab)
        const win = new Mesh(kit.track(new BoxGeometry(len * 0.27, 0.32, len * 0.2)), glassM)
        win.position.set(0, 1.05, -len * 0.06)
        b.add(win)
        const roof = new Mesh(kit.track(new BoxGeometry(len * 0.3, 0.08, len * 0.34)), stripes[0]!)
        roof.position.set(0, 1.34, -len * 0.08)
        b.add(roof)
      }
      if (kind === 'fish') {
        const mast = new Mesh(kit.track(new CylinderGeometry(0.05, 0.06, 3.2, 6)), cabinM)
        mast.position.set(0, 2.2, len * 0.08)
        b.add(mast)
      }
      mergeStatic(b, kit.track)
      return b
    }
    const dockCount = 6
    const dockXs = Array.from({ length: dockCount }, (_, i) => -34 + i * 13 + (R() - 0.5) * 3)
    for (const dx0 of dockXs) {
      // 码头墙在这个 x 上的位置
      let z0 = -10
      while (shore(dx0, z0) < 0 && z0 > -30) z0 -= 0.25
      if (quayMask(dx0, z0) < 0.7 || distTo(dx0, z0, RIVER, 8) < 7) continue
      const L = 9 + R() * 5
      const W = 2.2
      const y = 1.55
      const za = z0 + 0.4
      const zb = z0 + L
      const g = new Group()
      const deck = new Mesh(kit.track(new BoxGeometry(W, 0.22, L)), plank)
      deck.position.set(0, -0.11, L / 2)
      deck.receiveShadow = deck.castShadow = true
      g.add(deck)
      for (let z = 1; z <= L; z += 2.5)
        for (const sd of [-1, 1]) {
          const p = new Mesh(kit.track(new CylinderGeometry(0.13, 0.13, 4, 6)), postM)
          p.position.set(sd * (W / 2 - 0.1), -2, z)
          g.add(p)
        }
      g.position.set(dx0, y, za)
      group.add(g)
      mergeStatic(g, kit.track)
      decks.push({ at: (x, z) => (Math.abs(x - dx0) < W / 2 && z > za - 0.6 && z < zb ? y : null) })
      // 两边停船
      for (const sd of [-1, 1]) {
        if (R() < 0.25) continue
        const kind = R() < 0.45 ? 'fish' : R() < 0.6 ? 'cruiser' : 'row'
        const len = kind === 'row' ? 3.2 : 5.5 + R() * 2.5
        const boat = makeBoat(len, kind)
        const bx = dx0 + sd * (W / 2 + len * 0.18 + 0.5)
        const bz = za + L * (0.35 + R() * 0.4)
        boat.position.set(bx, 0.32, bz)
        boat.rotation.y = (R() < 0.5 ? 0 : Math.PI) + (R() - 0.5) * 0.08
        group.add(boat)
        obstacles.push({ x: bx, z: bz, r: len * 0.2 })
        const ph = R() * 6
        anims.push((t) => {
          boat.position.y = 0.32 + Math.sin(t * 1.1 + ph) * 0.07
          boat.rotation.z = Math.sin(t * 0.9 + ph) * 0.04
          boat.rotation.x = Math.sin(t * 0.7 + ph * 2) * 0.02
        })
      }
    }
    // 湾里漂着几条小船：彼此、和码头上停的船都隔开至少 8 米，转来转去也碰不到
    const moored = obstacles.slice()
    const drifting: V2[] = []
    for (let i = 0; i < 20 && drifting.length < 4; i++) {
      // 码头最远伸到 z ≈ -2，漂着的船待在码头外面
      const x = -30 + R() * 70
      const z = 1 + R() * 11
      if (shore(x, z) > -5) continue
      if (drifting.some(([a, b]) => Math.hypot(a - x, b - z) < 9)) continue
      if (moored.some((o) => Math.hypot(o.x - x, o.z - z) < 8)) continue
      drifting.push([x, z])
      const len = 4 + R() * 3
      const boat = makeBoat(len, R() < 0.5 ? 'row' : 'fish')
      boat.position.set(x, 0.32, z)
      const ang0 = R() * 6.28
      boat.rotation.y = ang0
      group.add(boat)
      const ph = R() * 6
      anims.push((t) => {
        boat.position.y = 0.32 + Math.sin(t * 1.0 + ph) * 0.09
        boat.rotation.z = Math.sin(t * 0.8 + ph) * 0.05
        boat.rotation.y = ang0 + Math.sin(t * 0.05 + ph) * 0.3
      })
    }
  }

  console.info('[town]', houses.length, 'houses')
  return {
    group,
    obstacles,
    boxes,
    houses,
    decks,
    update(t) {
      for (const a of anims) a(t)
    },
  }
}
