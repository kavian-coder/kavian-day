/**
 * 世界布局 v2：热带海湾小镇 + 小岛群。对照 doc/world/v2-concept 的合并总览图。
 *
 *   北边是雨林山脊（瀑布、观景台、风车、水塔），山脚下沿海有一条环岛铁路；
 *   山坡一层层下到海湾北岸，是坡地小镇（主街、夜晚街道、书店、照相馆……）；
 *   海湾三面是陆地，东南角是湾口，铁路从湾口上的低桥跨过去；
 *   湾南是一条细长的沙洲，海边车站就在沙洲上：一边是海湾，一边是外海和珊瑚礁；
 *   沙洲南边是沙滩公园和游乐栈桥；西边是高高的岬角和灯塔；东边是山坡，我的家在那里；
 *   铁路过桥去东北的露营岛，东边还有一座正在修桥的工地岛；南边的潜水岛用长木栈道连着。
 *
 * 单位约等于米。x 向东，z 向南，y 向上。海面 y = 0。
 */
import { clamp, fbm, lerp, rng, smoothstep } from './noise'

export type V2 = readonly [number, number]

/**
 * 世界圈：只存在于代码里的边界，世界里看不出来。
 * - 所有陆地、小岛、桥、地标都放在离圆心 WORLD.r 以内。
 * - 圈外先留一圈自然的礁盘浅水（REEF 米），然后海底慢慢落进深海；落下去的半径带低频起伏，不是正圆。
 * - 深海的水不透明、颜色不再随深度变化，所以圈外是一片没有尽头的同色大海。
 * 以后世界变大，只改 r：地形网格、水、镜头范围都跟着变。
 */
export const WORLD = { x: 18, z: 14, r: 180 } as const
/** 深海海底：比这更深，水的颜色就不再变化（见 water.ts） */
export const ABYSS = -24
/** 陆地外留给礁盘浅水的宽度，之后才开始往深海落 */
const REEF = 16
const SHELF_IN = WORLD.r + REEF
/** 从开始下落到完全是深海的宽度 */
const SHELF_OUT = SHELF_IN + 40
/** 下落半径的起伏幅度（米） */
const SHELF_WOBBLE = 10

/** 地形网格覆盖的范围：深海再往外留一截，网格边缘永远在不透明的深水下面 */
const TERRAIN_HALF = SHELF_OUT + SHELF_WOBBLE + 8
export const TERRAIN = {
  minX: WORLD.x - TERRAIN_HALF,
  maxX: WORLD.x + TERRAIN_HALF,
  minZ: WORLD.z - TERRAIN_HALF,
  maxZ: WORLD.z + TERRAIN_HALF,
  seg: 460,
} as const

/** 有陆地的范围：海岸距离场和地形高度在这里预先算好缓存，范围外按公式算（都是海） */
export const CONTENT = { minX: -178, maxX: 206, minZ: -136, maxZ: 150 } as const

// ---------- 折线工具
/** 只要距离，不要位置参数；用包围盒跳过远处线段，比 distToPolyline 快。 */
export function distTo(x: number, z: number, pts: readonly V2[], max = Infinity) {
  let best = max
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    if (x < Math.min(a[0], b[0]) - best || x > Math.max(a[0], b[0]) + best) continue
    if (z < Math.min(a[1], b[1]) - best || z > Math.max(a[1], b[1]) + best) continue
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1)
    const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t))
    if (d < best) best = d
  }
  return best
}

export function distToPolyline(x: number, z: number, pts: readonly V2[]) {
  let best = Infinity
  let bestT = 0
  let acc = 0
  let total = 0
  const lens: number[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    lens.push(l)
    total += l
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const l2 = dx * dx + dz * dz || 1
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1)
    const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t))
    if (d < best) {
      best = d
      bestT = (acc + t * lens[i]!) / (total || 1)
    }
    acc += lens[i]!
  }
  return { d: best, t: bestT }
}

const catmull = (a: number, b: number, c: number, d: number, t: number) => {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
}

/** Catmull-Rom 平滑后重新采样成密一点的折线。 */
export function smoothLine(pts: readonly V2[], step = 1.5): V2[] {
  const out: V2[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step))
    for (let k = 0; k < n; k++) {
      const t = k / n
      out.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)])
    }
  }
  out.push(pts[pts.length - 1]!)
  return out
}

/** 闭合的 Catmull-Rom 平滑（首尾相接） */
function smoothLoop(pts: readonly V2[], step: number): V2[] {
  const out: V2[] = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!
    const p1 = pts[i]!
    const p2 = pts[(i + 1) % n]!
    const p3 = pts[(i + 2) % n]!
    const m = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step))
    for (let k = 0; k < m; k++) {
      const t = k / m
      out.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)])
    }
  }
  out.push(out[0]!)
  return out
}

// ======================================================================
// 海岸线
// ======================================================================
/**
 * 主岛的海岸（顺时针看地图：从沙洲南岸往东，绕过湾口进海湾，再出来绕东岬、北岸、西岬）。
 * 海湾是这条线往里凹进去的一块，湾口在东南角。
 */
const MAIN_COAST_KEYS: V2[] = [
  // 沙洲南岸（外海一侧的沙滩）
  [-74, 45], [-46, 48], [-18, 47], [0, 44], [16, 43], [34, 42.5],
  // 沙洲东头，拐进湾口
  [44, 38], [45, 30],
  // 沙洲北岸（海湾一侧）
  [34, 23], [10, 21.5], [-14, 21], [-34, 19],
  // 海湾西岸、北岸、东岸
  [-46, 12], [-51, -1], [-48, -12], [-34, -16.5], [-10, -17.5], [14, -17], [36, -15.5], [50, -10],
  [56, 2], [57, 14],
  // 东岬西南角（湾口东侧），然后是东岬外侧
  [60, 23], [67, 31], [84, 36], [104, 27], [118, 8], [124, -16], [118, -42], [108, -66], [96, -86],
  // 北岸
  [72, -97], [36, -101], [0, -102], [-36, -100], [-70, -95], [-96, -84],
  // 西北、西岬
  [-110, -64], [-114, -40], [-124, -24], [-140, -12], [-147, 2], [-141, 18], [-124, 25], [-104, 23], [-91, 31], [-84, 42],
]
export const MAIN_COAST: V2[] = smoothLoop(MAIN_COAST_KEYS, 1.5)

/** 小岛：潜水岛、露营岛、工地岛 */
export const ISLETS = [
  { id: 'dive', x: 32, z: 103, r: 19, seed: 1.3 },
  { id: 'camp', x: 152, z: -50, r: 17, seed: 2.7 },
  { id: 'build', x: 174, z: 20, r: 15, seed: 4.1 },
] as const
const islet = (id: (typeof ISLETS)[number]['id']) => ISLETS.find((i) => i.id === id)!

function isletShore(i: (typeof ISLETS)[number], x: number, z: number) {
  const dx = x - i.x
  const dz = z - i.z
  const th = Math.atan2(dz, dx)
  const r = i.r * (1 + 0.1 * Math.sin(2 * th + i.seed) + 0.07 * Math.sin(3 * th + 2 * i.seed) + 0.04 * Math.sin(5 * th + i.seed * 3))
  return r - Math.hypot(dx, dz)
}

/** 主岛的有向距离场（正 = 岛上），1.5 米一格，启动时算一次 */
const SDF = (() => {
  const step = 1.5
  const nx = Math.ceil((CONTENT.maxX - CONTENT.minX) / step) + 1
  const nz = Math.ceil((CONTENT.maxZ - CONTENT.minZ) / step) + 1
  const data = new Float32Array(nx * nz)
  const P = MAIN_COAST
  const n = P.length - 1
  // 线段分桶，加快最近距离的查询
  const B = 12
  const bx = Math.ceil((CONTENT.maxX - CONTENT.minX) / B) + 1
  const bz = Math.ceil((CONTENT.maxZ - CONTENT.minZ) / B) + 1
  const buckets: number[][] = Array.from({ length: bx * bz }, () => [])
  for (let i = 0; i < n; i++) {
    const a = P[i]!
    const b = P[i + 1]!
    const i0 = Math.floor((Math.min(a[0], b[0]) - CONTENT.minX) / B)
    const i1 = Math.floor((Math.max(a[0], b[0]) - CONTENT.minX) / B)
    const j0 = Math.floor((Math.min(a[1], b[1]) - CONTENT.minZ) / B)
    const j1 = Math.floor((Math.max(a[1], b[1]) - CONTENT.minZ) / B)
    for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) buckets[jj * bx + ii]!.push(i)
  }
  const segDist = (x: number, z: number, i: number) => {
    const a = P[i]!
    const b = P[i + 1]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1)
    return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t))
  }
  for (let j = 0; j < nz; j++) {
    const z = CONTENT.minZ + j * step
    // 这一行和海岸线的交点（奇偶规则判断里外）
    const xs: number[] = []
    for (let i = 0; i < n; i++) {
      const a = P[i]!
      const b = P[i + 1]!
      if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
    }
    xs.sort((p, q) => p - q)
    for (let i = 0; i < nx; i++) {
      const x = CONTENT.minX + i * step
      let inside = false
      for (const c of xs) if (c < x) inside = !inside
      // 从所在的桶往外一圈圈找，找到之后再多看一圈
      const ci = Math.floor((x - CONTENT.minX) / B)
      const cj = Math.floor((z - CONTENT.minZ) / B)
      let best = Infinity
      for (let ring = 0; ring < Math.max(bx, bz); ring++) {
        for (let jj = cj - ring; jj <= cj + ring; jj++)
          for (let ii = ci - ring; ii <= ci + ring; ii++) {
            if (Math.max(Math.abs(ii - ci), Math.abs(jj - cj)) !== ring) continue
            if (ii < 0 || jj < 0 || ii >= bx || jj >= bz) continue
            for (const s of buckets[jj * bx + ii]!) best = Math.min(best, segDist(x, z, s))
          }
        if (best < (ring - 0.5) * B) break
        if (ring > 8 && best < Infinity) break
      }
      data[j * nx + i] = inside ? best : -best
    }
  }
  return { data, nx, nz, step }
})()

function mainShore(x: number, z: number): number {
  const { data, nx, nz, step } = SDF
  const fx = (x - CONTENT.minX) / step
  const fz = (z - CONTENT.minZ) / step
  if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) {
    // 缓存范围外：取最近的边缘点的值，再减去离开边缘的距离（陆地都在里面，所以这样是连续的）
    const cx = Math.min(Math.max(x, CONTENT.minX), CONTENT.maxX - step * 1.01)
    const cz = Math.min(Math.max(z, CONTENT.minZ), CONTENT.maxZ - step * 1.01)
    return mainShore(cx, cz) - Math.hypot(x - cx, z - cz)
  }
  const i = Math.floor(fx)
  const j = Math.floor(fz)
  const tx = fx - i
  const tz = fz - j
  const a = data[j * nx + i]!
  const b = data[j * nx + i + 1]!
  const c = data[(j + 1) * nx + i]!
  const d = data[(j + 1) * nx + i + 1]!
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz)
}

/** 离海岸线的距离：正数在陆地上（主岛或小岛），负数在海里 */
export function shore(x: number, z: number) {
  let s = mainShore(x, z)
  for (const i of ISLETS) s = Math.max(s, isletShore(i, x, z))
  return s + 1.1 * fbm(x * 0.06 + 30, z * 0.06)
}

/** 海湾内部（0–1）：水更平静、更浅，底是白沙 */
export function bayFactor(x: number, z: number) {
  const ex = (x - 4) / 52
  const ez = (z - 2) / 19
  return 1 - smoothstep(0.75, 1.15, Math.hypot(ex, ez))
}

/** 往海里的方向（海岸距离下降最快的方向） */
export function seaward(x: number, z: number): V2 {
  const e = 1.5
  const gx = shore(x + e, z) - shore(x - e, z)
  const gz = shore(x, z + e) - shore(x, z - e)
  const l = Math.hypot(gx, gz) || 1
  return [-gx / l, -gz / l]
}

/** 沿主岛海岸线取一点：t 是 0–1 的位置，off 是往海里偏的米数（负数往岛里）。用来放沿岸的生物。 */
const COAST_LEN: number[] = (() => {
  const acc = [0]
  for (let i = 1; i < MAIN_COAST.length; i++) acc.push(acc[i - 1]! + Math.hypot(MAIN_COAST[i]![0] - MAIN_COAST[i - 1]![0], MAIN_COAST[i]![1] - MAIN_COAST[i - 1]![1]))
  return acc
})()
export function coastPoint(t: number, off: number): V2 {
  const total = COAST_LEN[COAST_LEN.length - 1]!
  const L = (((t % 1) + 1) % 1) * total
  let i = 1
  while (i < COAST_LEN.length - 1 && COAST_LEN[i]! < L) i++
  const a = MAIN_COAST[i - 1]!
  const b = MAIN_COAST[i]!
  const k = (L - COAST_LEN[i - 1]!) / (COAST_LEN[i]! - COAST_LEN[i - 1]! || 1)
  const x = lerp(a[0], b[0], k)
  const z = lerp(a[1], b[1], k)
  const [sx, sz] = seaward(x, z)
  // 往海里偏的时候，碰到对岸（海湾、窄水道）就往回收，保证点在水里
  let o = off
  while (o > 2 && shore(x + sx * o, z + sz * o) > -1.5) o *= 0.8
  return [x + sx * o, z + sz * o]
}

/** 外海的一圈：从岛中间往 theta 方向，过了最外面的陆地（包括小岛）再往外 off 米。海豚、鲸用。 */
const OUTER_C: V2 = [10, -25]
const OUTER_R: number[] = (() => {
  const n = 720
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2
    let r = 300
    while (r > 0 && shore(OUTER_C[0] + Math.cos(th) * r, OUTER_C[1] + Math.sin(th) * r) < -2) r -= 2
    out.push(r)
  }
  // 平滑一下，免得绕过小岛时突然跳
  return out.map((_, i) => {
    let m = 0
    for (let k = -12; k <= 12; k++) m = Math.max(m, out[(i + k + n) % n]!)
    return m
  })
})()
export function outerPoint(theta: number, off: number): V2 {
  const n = OUTER_R.length
  const f = ((((theta / (Math.PI * 2)) % 1) + 1) % 1) * n
  const i = Math.floor(f)
  const r = lerp(OUTER_R[i % n]!, OUTER_R[(i + 1) % n]!, f - i) + off
  return [OUTER_C[0] + Math.cos(theta) * r, OUTER_C[1] + Math.sin(theta) * r]
}

// ======================================================================
// 地点
// ======================================================================
export interface PlaceDef {
  id: string
  x: number
  z: number
  /** 平整地基的半径 */
  pad: number
  /** 互动半径 */
  radius: number
}

/** 去潜水岛的长木栈道：从沙洲南岸一直伸到潜水岛北岸 */
export const PIER = (() => {
  const x = 30
  let z0 = 36
  while (shore(x, z0) > 0 && z0 < 80) z0 += 0.25
  z0 -= 3.5
  let z1 = z0 + 10
  while (shore(x, z1) < 0 && z1 < 140) z1 += 0.25
  z1 += 2
  return { x, z0, z1, half: 1.4, y: 1.15 } as const
})()

export const PLACES: PlaceDef[] = [
  // 海边车站在沙洲上，月台朝外海
  { id: 'station', x: 8, z: 27.5, pad: 6, radius: 4.5 },
  // 小镇广场（大榕树）
  { id: 'plaza', x: -12, z: -32, pad: 8, radius: 0 },
  // 港口工作室（作品）
  { id: 'work', x: 40, z: -31, pad: 6.5, radius: 5 },
  // 植物温室（试验）
  { id: 'lab', x: -34, z: -34, pad: 5.5, radius: 4.5 },
  // 书店咖啡（笔记）
  { id: 'notes', x: 14, z: -31, pad: 5.5, radius: 4.5 },
  // 东坡上的家（关于我）
  { id: 'home', x: 84, z: -12, pad: 9, radius: 5 },
  // 潜水岛
  { id: 'pier', x: PIER.x, z: PIER.z1 - 2, pad: 0, radius: 4 },
  // 西岬灯塔
  { id: 'lighthouse', x: -130, z: 3, pad: 6, radius: 4.5 },
  // 北山观景台
  { id: 'viewpoint', x: 40, z: -78, pad: 5, radius: 4 },
]
export const place = (id: string) => PLACES.find((p) => p.id === id)!

// ======================================================================
// 高度
// ======================================================================
/** 海底：先是缓坡，再是一圈浅礁台地，最后掉进深海；海湾里是平缓的白沙底；潜水岛外有一圈环礁 */
function seaFloor(s: number, x: number, z: number) {
  const reef = -3.0 + 1.2 * (fbm(x * 0.08 + 7, z * 0.08 - 2) - 0.1)
  let h: number
  if (s > -8) h = s * 0.36
  else if (s > -22) h = lerp(-2.9, reef, smoothstep(-8, -13, s))
  else h = lerp(reef, -18, smoothstep(-22, -72, s))
  // 海湾：最深 3.6 米，底很平
  const bay = bayFactor(x, z)
  if (bay > 0) h = lerp(h, Math.max(-3.6, s * 0.3), bay)
  // 潜水岛的环礁：岛外一圈浅水泻湖，再外面是一圈礁脊
  const dv = islet('dive')
  const dd = Math.hypot(x - dv.x, z - dv.z)
  const lagoon = smoothstep(dv.r + 2, dv.r + 6, dd) * (1 - smoothstep(dv.r + 18, dv.r + 24, dd))
  h = lerp(h, Math.max(h, -2.4), lagoon)
  const crest = Math.exp(-((dd - (dv.r + 27)) ** 2) / 22) * (1 + 0.6 * fbm(x * 0.2, z * 0.2))
  h = Math.max(h, lerp(h, -0.55, clamp(crest, 0, 1)))
  // 世界圈：礁盘外缘慢慢落到深海。半径用低频噪声起伏，看起来是礁盘自然的边，不是一个圆
  const dW = Math.hypot(x - WORLD.x, z - WORLD.z) + SHELF_WOBBLE * fbm(x * 0.011 + 3.1, z * 0.011 - 5.7)
  h = Math.min(h, lerp(h, ABYSS, smoothstep(SHELF_IN, SHELF_OUT, dW)))
  return h
}


/** 坡地小镇：从海湾北岸往上的缓坡 */
function townSlope(x: number, z: number) {
  const k = smoothstep(-60, -46, x) * (1 - smoothstep(60, 72, x))
  return k * Math.max(0, -z - 19) * 0.3
}

/** 北山：东西走向的山脊，山顶约 30 米，北边临海的地方收成一条沿海平台 */
function northHills(x: number, z: number) {
  const ridge = Math.exp(-((z + 84) ** 2) / 360)
  // 沿山脊有几座峰：中间最高，两边低一些
  const peaks =
    1.0 * Math.exp(-((x - 10) ** 2) / 900) + 0.75 * Math.exp(-((x + 45) ** 2) / 700) + 0.7 * Math.exp(-((x - 62) ** 2) / 800) + 0.35
  const k = smoothstep(-130, -96, x) * (1 - smoothstep(98, 116, x))
  const rise = smoothstep(-48, -68, z)
  // 山坡上的沟谷和石崖
  const rough = 1 + 0.22 * fbm(x * 0.05, z * 0.05 + 11, 5) + 0.1 * Math.abs(fbm(x * 0.12 + 3, z * 0.12, 3))
  return (34 * ridge * peaks + 9 * rise) * k * rough
}

/** 瀑布：北山南坡上的一道石崖，崖下是水潭 */
export const FALLS = { x: 6, zTop: -63.5, zPool: -58, top: 21.5, pool: 9.2 } as const

/** 溪流：北山上流下来，过瀑布、水潭，穿过小镇流进海湾 */
export const RIVER: V2[] = smoothLine(
  [
    [1, -77],
    [4, -72],
    [6, -68],
    [FALLS.x, FALLS.zTop - 0.6],
    [FALLS.x, FALLS.zTop + 1.4],
    [FALLS.x - 0.5, FALLS.zPool],
    [3, -50],
    [5, -41],
    [2, -33],
    [4, -25],
    [6, -19],
    [7, -14],
  ],
  1,
)

/** 海湾北岸的石砌码头（0–1）：岸边直接是 2 米高的石墙，墙外的水一下子变深，船可以靠岸 */
export function quayMask(x: number, z: number) {
  if (distTo(x, z, RIVER, 6) < 4.5) return 0
  return smoothstep(-46, -38, x) * (1 - smoothstep(42, 50, x)) * (1 - smoothstep(-13, -8, z)) * smoothstep(-30, -22, z)
}

function baseHeightRaw(x: number, z: number) {
  const s = shore(x, z)
  const q = quayMask(x, z)
  if (s < 0) {
    const sf = seaFloor(s, x, z)
    return q > 0 ? lerp(sf, Math.min(sf, -2.4), q * smoothstep(0, -1.2, s)) : sf
  }
  // 海边：沙滩缓缓抬到 2 米左右；码头那一段直接是平的
  const beach = lerp(Math.min(s * 0.32, 2.05), 2.05, q * smoothstep(0, 0.3, s))
  const rolling = 0.9 * fbm(x * 0.04 + 3, z * 0.04 - 7)
  // 沿海平台：铁路、沿岸小路都在这一层，离岸 6 米以内不起山
  const shelf = smoothstep(6, 20, s)
  // 小镇坡地：平滑的坡，房子自己带石砌台基
  const town = townSlope(x, z)
  // 北山
  const hills = northHills(x, z) * shelf
  // 东岬山坡：家在半山腰
  const east = 24 * Math.exp(-((x - 96) ** 2 + (z + 30) ** 2) / 900) * shelf
  // 西岬：高高的平台，临海是陡崖，灯塔在最西头
  const westK = Math.exp(-((x + 124) ** 2) / 420 - ((z - 2) ** 2) / 300)
  const west = (13.5 + 1.5 * fbm(x * 0.08, z * 0.08)) * clamp(westK * 1.6, 0, 1) * smoothstep(1.2, 6, s)
  // 露营岛中间有一座小石丘；潜水岛是低平的沙岛
  const cp = islet('camp')
  const campHill = 6.5 * Math.exp(-((x - cp.x - 3) ** 2 + (z - cp.z + 2) ** 2) / 70) * smoothstep(2, 8, s)
  const inland = Math.max(beach, 1.9 + Math.max(0, rolling) * shelf * (1 - smoothstep(-20, -30, z)) * 0.6)
  let h = inland + Math.max(town, hills * 0.95, east, west, campHill)
  // 瀑布：崖顶以北抬到崖顶高度，崖下挖出水潭
  const fx = Math.abs(x - FALLS.x)
  const cliffK = 1 - smoothstep(5, 11, fx)
  if (cliffK > 0) {
    const above = smoothstep(FALLS.zTop + 1.2, FALLS.zTop - 0.6, z)
    const target = lerp(FALLS.pool + 1.4, Math.max(h, FALLS.top + 0.6), above)
    h = lerp(h, Math.max(target, z < FALLS.zTop ? h : 0), cliffK * smoothstep(FALLS.zPool + 14, FALLS.zPool + 4, z) * smoothstep(-80, -70, z))
  }
  return h
}

// 地形查询很频繁，算一张 0.75 米的缓存
const BASE = (() => {
  const step = 0.75
  const nx = Math.ceil((CONTENT.maxX - CONTENT.minX) / step) + 1
  const nz = Math.ceil((CONTENT.maxZ - CONTENT.minZ) / step) + 1
  const data = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) data[j * nx + i] = baseHeightRaw(CONTENT.minX + i * step, CONTENT.minZ + j * step)
  return { data, nx, nz, step }
})()
function baseHeight(x: number, z: number) {
  const { data, nx, nz, step } = BASE
  const fx = (x - CONTENT.minX) / step
  const fz = (z - CONTENT.minZ) / step
  if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return baseHeightRaw(x, z)
  const i = Math.floor(fx)
  const j = Math.floor(fz)
  const tx = fx - i
  const tz = fz - j
  return lerp(lerp(data[j * nx + i]!, data[j * nx + i + 1]!, tx), lerp(data[(j + 1) * nx + i]!, data[(j + 1) * nx + i + 1]!, tx), tz)
}

// ======================================================================
// 铁路
// ======================================================================
/**
 * 环岛铁路（首尾相接），按列车的行驶方向排：沙洲 → 湾口桥 → 东岬沿海 → 跨海桥上露营岛 →
 * 跨海桥回北岸 → 北岸沿海 → 西北 → 西岬脚下 → 回到沙洲。
 */
const RAIL_KEYS: V2[] = [
  [-66, 35.5], [-36, 36.5], [-10, 37.5], [8, 37.8], [24, 36.5], [37, 33.5],
  // 湾口桥
  [50, 30], [66, 26.5],
  // 东岬南岸、东岸
  [84, 28.5], [101, 18], [111, 0], [114, -20],
  // 跨海桥去露营岛，穿过小岛，再跨海回北岸
  [126, -32], [141, -40], [153, -51], [151, -64], [138, -76], [116, -83], [96, -88],
  // 北岸
  [70, -91], [36, -95], [0, -96], [-36, -94], [-68, -89], [-92, -78],
  // 西北、西边
  [-104, -60], [-106, -38], [-100, -18], [-96, 4], [-88, 24], [-78, 32],
]
export const RAIL: V2[] = smoothLoop(RAIL_KEYS, 1)
export const RAIL_Y = 2.1

/** 每个铁路点是否在隧道里（0 或 1）：山比路基高很多的地方钻山 */
export const RAIL_TUNNEL: number[] = (() => {
  const raw = RAIL.map(([x, z]) => smoothstep(7, 9.5, baseHeight(x, z)))
  return raw.map((_, i) => {
    let s = 0
    for (let k = -6; k <= 6; k++) s += raw[(i + k + raw.length) % raw.length]!
    return s / 13 > 0.5 ? 1 : 0
  })
})()

/** 每个铁路点是否在桥上（0 或 1）：下面是海 */
export const RAIL_BRIDGE: number[] = (() => {
  const raw = RAIL.map(([x, z]) => (baseHeight(x, z) < 0.9 ? 1 : 0))
  // 往两头各多延 3 米，桥头搭在岸上
  return raw.map((_, i) => {
    for (let k = -3; k <= 3; k++) if (raw[(i + k + raw.length) % raw.length]) return 1
    return 0
  })
})()

/** 离铁路最近的点：距离、是不是隧道、是不是桥 */
export function railNear(x: number, z: number, max: number) {
  let best = max
  let tun = 0
  let br = 0
  for (let i = 0; i < RAIL.length - 1; i++) {
    const a = RAIL[i]!
    const b = RAIL[i + 1]!
    if (x < Math.min(a[0], b[0]) - best || x > Math.max(a[0], b[0]) + best) continue
    if (z < Math.min(a[1], b[1]) - best || z > Math.max(a[1], b[1]) + best) continue
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1)
    const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t))
    if (d < best) {
      best = d
      tun = RAIL_TUNNEL[i]!
      br = RAIL_BRIDGE[i]!
    }
  }
  return best < max ? { d: best, tunnel: tun, bridge: br } : null
}

/** 工地岛：从东岬伸出去、修到一半的桥（只有桥墩和一小段桥面，没有列车） */
export const UNFINISHED_BRIDGE: V2[] = [
  [108, 12],
  [130, 15],
  [150, 18],
  [166, 20],
]

// ======================================================================
// 溪流：北山上流下来，过瀑布、水潭，穿过小镇流进海湾
// ======================================================================
/** 溪上的小桥：滨海路过入海口、上层横街过溪 */
export const FOOT_BRIDGES: V2[] = [
  [5.1, -21.6],
  [3.9, -45.8],
]
export const BRIDGE: V2 = FOOT_BRIDGES[0]!
export const BRIDGE_ENDS: [V2, V2] = (() => {
  let bi = 0
  let best = Infinity
  RIVER.forEach((p, i) => {
    const d = (p[0] - BRIDGE[0]) ** 2 + (p[1] - BRIDGE[1]) ** 2
    if (d < best) {
      best = d
      bi = i
    }
  })
  const a = RIVER[Math.max(0, bi - 2)]!
  const b = RIVER[Math.min(RIVER.length - 1, bi + 2)]!
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2
  const e1: V2 = [BRIDGE[0] + Math.cos(ang) * 6.5, BRIDGE[1] + Math.sin(ang) * 6.5]
  const e2: V2 = [BRIDGE[0] - Math.cos(ang) * 6.5, BRIDGE[1] - Math.sin(ang) * 6.5]
  return e1[0] > e2[0] ? [e1, e2] : [e2, e1]
})()

// ======================================================================
// 街道和小路
// ======================================================================
const PATH_KEYS: V2[][] = [
  // 0 沙洲步道：车站 → 西头，再沿海湾西岸上到小镇
  [[30, 27], [8, 25.5], [-20, 26], [-46, 24], [-56, 10], [-56, -6], [-50, -22]],
  // 1 海湾北岸的滨海路（主路）
  [[-50, -22], [-30, -21.5], [-6, -22], [18, -21.5], [42, -20], [56, -16], [62, -6], [64, 8]],
  // 2 主街：从滨海路往北上坡（尽头看得见渡轮码头）
  [[30, -21], [29, -30], [30, -40], [32, -49]],
  // 3 夜晚街道：从广场往下到滨海路，台阶一路下去
  [[-12, -48], [-12, -38], [-11, -29], [-10, -21.5]],
  // 4 上层横街
  [[-44, -44], [-24, -45], [-12, -46], [8, -46], [32, -49], [52, -46]],
  // 5 去潜水岛：从车站东边穿过铁路，上木栈道
  [[22, 26.5], [27, 30], [30, 34], [30, PIER.z0 + 1]],
  // 6 去灯塔：沿海湾西岸往西，上岬角
  [[-56, 6], [-76, 10], [-98, 12], [-116, 6], [-126, 3]],
  // 7 回家：滨海路东头上东坡，走到家门口前廊的正前方（家的西墙在 x = 78，路不能从墙里穿过去）
  [[62, -6], [72, -8.5], [84, -7.2]],
  // 8 沙滩公园：从步道穿过铁路到沙滩
  [[-30, 26], [-32, 33], [-34, 41]],
  // 9 去游乐栈桥
  [[-6, 25.5], [-8, 33], [-9, 42]],
  // 10 上山步道：从上层横街绕到北山观景台
  [[8, -46], [16, -56], [26, -62], [32, -70], [40, -76]],
]
export const PATHS: V2[][] = PATH_KEYS.map((p) => smoothLine(p, 1))

/** 平行于小路的距离（米），镇上的街道会把台地切成坡道 */
export function pathDist(x: number, z: number, max = 6) {
  let d = max
  for (const p of PATHS) d = Math.min(d, distTo(x, z, p, d))
  return d
}
export const nearPath = (x: number, z: number, w = 1.6) => pathDist(x, z, w + 0.01) < w

// ======================================================================
// 最终高度
// ======================================================================
const PAD_H = new Map<string, number>()
for (const p of PLACES) if (p.pad) PAD_H.set(p.id, p.id === 'station' ? RAIL_Y - 0.15 : Math.max(1.4, baseHeight(p.x, p.z)))

/** 街道上不要台阶：用不分层的坡度，做成连续的坡道 */
function streetHeight(x: number, z: number) {
  const s = shore(x, z)
  const beach = Math.min(Math.max(s, 0) * 0.32, 2.05)
  return Math.max(beach, 1.9 + townSlope(x, z))
}

/** 还没平整房子地块时的高度：山、街道坡道、铁路路基 */
function preHeight(x: number, z: number, pd = pathDist(x, z, 4)) {
  let h = baseHeight(x, z)
  // 镇上的街道：把坡地抹成连续的坡道
  if (pd < 4 && townSlope(x, z) > 0.2) h = lerp(streetHeight(x, z), h, smoothstep(1.6, 3.6, pd))
  // 铁路路基（隧道段、桥段不动地形）
  const rn = railNear(x, z, 8)
  if (rn && !rn.bridge) h = lerp(h, RAIL_Y - 0.15, (1 - smoothstep(2.6, 6, rn.d)) * (1 - rn.tunnel))
  return h
}

// ======================================================================
// 小镇的房子地块：先在这里定好位置，地形按地块挖平、填平，房子坐在平地上，
// 地块之间自然形成一级级台地（陡的地方 town.ts 会砌上石挡墙）
// ======================================================================
export interface Lot {
  x: number
  z: number
  /** 绕 y 轴的转角：房子局部 +v（正面）在世界里是 (−sin ang, cos ang) */
  ang: number
  w: number
  d: number
  /** 地块平整后的高度 */
  y: number
  /** 平整前地块里最低、最高的地面 */
  lo: number
  hi: number
  floors: number
  shop: boolean
  /** 每栋房子自己的随机种子（颜色、窗户） */
  seed: number
}

/** 镇上的街道，房子沿街排 */
const TOWN_STREETS: { i: number; shop: number; sides: number[] }[] = [
  { i: 1, shop: 0.7, sides: [-1] },
  { i: 2, shop: 0.6, sides: [-1, 1] },
  { i: 3, shop: 0.5, sides: [-1, 1] },
  { i: 4, shop: 0.2, sides: [-1, 1] },
  { i: 0, shop: 0.15, sides: [1, -1] },
]

export const LOT_REJECT: Record<string, number> = {}
export const LOTS: Lot[] = (() => {
  const R = rng(4242)
  const rej = (k: string) => (LOT_REJECT[k] = (LOT_REJECT[k] ?? 0) + 1)
  const lots: Lot[] = []
  const tryLot = (x: number, z: number, ang: number, shopChance: number) => {
    const w = 5.2 + R() * 3
    const d = 4.8 + R() * 2.2
    const floorsR = R()
    const shopR = R()
    const seed = Math.floor(R() * 1e9)
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    const ys: number[] = []
    for (const u of [-1, 0, 1])
      for (const v of [-1, 0, 1]) {
        const px = x + ((u * w) / 2) * ca - ((v * d) / 2) * sa
        const pz = z + ((u * w) / 2) * sa + ((v * d) / 2) * ca
        if (shore(px, pz) < 3.5) return rej('shore')
        const pd = pathDist(px, pz, 3)
        if (pd < 1.7) return rej('path')
        if (distTo(px, pz, RIVER, 6) < 5) return rej('river')
        const rn = railNear(px, pz, 7)
        if (rn && rn.d < 6) return rej('rail')
        for (const p of PLACES) if (p.pad && Math.hypot(px - p.x, pz - p.z) < p.pad + 1.2) return rej('place')
        const gy = preHeight(px, pz, pd)
        if (gy < 1.3) return rej('low')
        ys.push(gy)
      }
    for (const o of lots) if (Math.hypot(o.x - x, o.z - z) < (Math.max(o.w, o.d) + Math.max(w, d)) / 2 + 0.8) return rej('overlap')
    ys.sort((a, b) => a - b)
    const lo = ys[0]!
    const hi = ys[ys.length - 1]!
    if (hi - lo > 6.5) return rej('steep')
    const floors = floorsR < 0.25 ? 1 : floorsR < 0.75 ? 2 : 3
    lots.push({ x, z, ang, w, d, y: ys[4]!, lo, hi, floors, shop: shopR < shopChance, seed })
  }
  // 沿街两边：正面朝街
  for (const st of TOWN_STREETS) {
    const path = PATHS[st.i]!
    let acc = 0
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1]!
      const b = path[k]!
      acc += Math.hypot(b[0] - a[0], b[1] - a[1])
      if (acc < 6.8) continue
      acc = 0
      const dir = Math.atan2(b[1] - a[1], b[0] - a[0])
      for (const side of st.sides) {
        const nx = -Math.sin(dir) * side
        const nz = Math.cos(dir) * side
        const off = 6.2 + R() * 0.6
        const x = b[0] + nx * off
        const z = b[1] + nz * off
        if (townFactor(x, z) < 0.3 && st.i !== 0) continue
        tryLot(x, z, Math.atan2(nx, -nz), st.shop)
      }
    }
  }
  // 街道之间：一排排朝南（朝海湾）的房子
  for (let pass = 0; pass < 3; pass++)
    for (let z = -23; z > -70; z -= 7.2)
      for (let x = -62; x < 70; x += 7.6) {
        const jx = x + (R() - 0.5) * 3 + pass * 2.6
        const jz = z + (R() - 0.5) * 2.5 - pass * 2.4
        if (townFactor(jx, jz) < 0.35) continue
        if (pathDist(jx, jz, 6) < 4.0) continue
        tryLot(jx, jz, (R() - 0.5) * 0.3, 0)
      }
  return lots
})()

/** 地块按 8 米一格分桶 */
const LOT_GRID = (() => {
  const g = new Map<number, Lot[]>()
  for (const l of LOTS) {
    const r = Math.hypot(l.w, l.d) / 2 + 4
    for (let i = Math.floor((l.x - r) / 8); i <= Math.floor((l.x + r) / 8); i++)
      for (let j = Math.floor((l.z - r) / 8); j <= Math.floor((l.z + r) / 8); j++) {
        const k = i * 4096 + j
        if (!g.has(k)) g.set(k, [])
        g.get(k)!.push(l)
      }
  }
  return g
})()

/** (x, z) 离最近的地块边缘多远（在地块里是负数）和那个地块 */
export function lotNear(x: number, z: number) {
  let best: Lot | null = null
  let bd = Infinity
  for (const l of LOT_GRID.get(Math.floor(x / 8) * 4096 + Math.floor(z / 8)) ?? []) {
    const ca = Math.cos(l.ang)
    const sa = Math.sin(l.ang)
    const dx = x - l.x
    const dz = z - l.z
    const u = dx * ca + dz * sa
    const v = -dx * sa + dz * ca
    const eu = Math.abs(u) - l.w / 2
    const ev = Math.abs(v) - l.d / 2
    const e = eu > 0 || ev > 0 ? Math.hypot(Math.max(eu, 0), Math.max(ev, 0)) : Math.max(eu, ev)
    if (e < bd) {
      bd = e
      best = l
    }
  }
  return best ? { lot: best, d: bd } : null
}

export function heightAt(x: number, z: number) {
  // 远离岸边的海里只有海底，不用再查街道、铁路、地块（跨海桥段本来就不改地形）
  if (shore(x, z) < -16) return baseHeight(x, z)
  const pd = pathDist(x, z, 4)
  let h = preHeight(x, z, pd)
  // 房子地块：地块外 1 米以内是平的，再往外 2.5 米坡回原来的地面；街面不动
  const ln = lotNear(x, z)
  if (ln && ln.d < 3.5) h = lerp(h, ln.lot.y, (1 - smoothstep(1, 3.5, ln.d)) * smoothstep(1.3, 2.3, pd))
  // 建筑地基
  for (const p of PLACES) {
    if (!p.pad) continue
    const d = Math.hypot(x - p.x, z - p.z)
    if (d > p.pad + 5) continue
    h = lerp(h, PAD_H.get(p.id)!, 1 - smoothstep(p.pad, p.pad + 5, d))
  }
  // 溪流河床：跟着水面走，河道中间比水面低 1，两岸至少比水面高 0.3
  const rv = riverNear(x, z, 6)
  if (rv) {
    const sy = rv.y
    const bed = Math.max(sy - 1.05, lerp(-1.2, 0.04, smoothstep(2, 10, shore(x, z))))
    const bank = sy < 0.35 ? h : Math.max(h, sy + 0.32)
    h = rv.d < 1.8 ? bed : rv.d < 3.4 ? lerp(bed, bank, smoothstep(1.8, 3.4, rv.d)) : lerp(bank, h, smoothstep(3.4, 6, rv.d))
  }
  return h
}

/** 溪流水面高度：沿河道从上游到下游单调下降；快到海时平缓地落到海面。瀑布那一段是一道陡降。 */
const RIVER_Y: number[] = (() => {
  let mouth = RIVER.length - 1
  while (mouth > 0 && shore(RIVER[mouth]![0], RIVER[mouth]![1]) < 0) mouth--
  const toMouth: number[] = new Array(RIVER.length).fill(0)
  for (let i = mouth - 1; i >= 0; i--)
    toMouth[i] = toMouth[i + 1]! + Math.hypot(RIVER[i + 1]![0] - RIVER[i]![0], RIVER[i + 1]![1] - RIVER[i]![1])
  const y: number[] = []
  let prev = Infinity
  for (let i = 0; i < RIVER.length; i++) {
    const [x, z] = RIVER[i]!
    // 离入海口 6 米以内，水面平缓地落到海面；再往上游跟着地面走（小镇里是一级级的小跌水）
    let v = Math.min(prev - 0.02, baseHeight(x, z) - 0.55, 0.03 + toMouth[i]! * 0.06 + Math.max(0, toMouth[i]! - 6) * 2)
    // 瀑布：崖顶以上贴着崖顶，崖下是水潭的水面
    if (z < FALLS.zTop - 0.4) v = Math.min(v, Math.max(FALLS.top - 0.3, v))
    else if (z < FALLS.zPool + 3 && z > FALLS.zTop + 0.6) v = Math.min(v, FALLS.pool)
    y.push(v)
    prev = v
  }
  return y.map((v) => Math.max(v, 0.02))
})()

/** 离河道最近的点：距离和那里的水面高度。超过 max 返回 null */
export function riverNear(x: number, z: number, max: number) {
  let best = max
  let by = 0
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i]!
    const b = RIVER[i + 1]!
    if (x < Math.min(a[0], b[0]) - best || x > Math.max(a[0], b[0]) + best) continue
    if (z < Math.min(a[1], b[1]) - best || z > Math.max(a[1], b[1]) + best) continue
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1)
    const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t))
    if (d < best) {
      best = d
      by = lerp(RIVER_Y[i]!, RIVER_Y[i + 1]!, t)
    }
  }
  return best < max ? { d: best, y: by } : null
}

export function riverSurface(): { pts: V2[]; y: number[] } {
  return { pts: RIVER, y: RIVER_Y }
}

/** 0–1：内陆程度。热带海岛四季不明显，只有北山高处会有一点季节色。 */
export function inlandFactor(x: number, z: number) {
  return smoothstep(10, 30, shore(x, z)) * smoothstep(12, 22, baseHeight(x, z))
}

/** 不能种树、放石头的地方 */
export function isClear(x: number, z: number, margin = 0) {
  const rn = railNear(x, z, 5 + margin)
  if (rn && rn.tunnel < 0.5 && rn.d < 4.5 + margin) return false
  if (distTo(x, z, RIVER, 5 + margin) < 4.5 + margin) return false
  if (x > PIER.x - 4 && x < PIER.x + 4 && z > PIER.z0 - 4 && z < PIER.z1 + 4) return false
  if (nearPath(x, z, 2.4 + margin)) return false
  for (const p of PLACES) if (Math.hypot(x - p.x, z - p.z) < Math.max(p.pad, p.radius) + 2 + margin) return false
  if (distTo(x, z, UNFINISHED_BRIDGE, 4 + margin) < 3 + margin) return false
  return true
}

/** 能走到的范围：整张图（陆地由高度挡住，太陡的坡由 index 里的坡度检查挡住） */
export const WALK = { minZ: -135 }

/** 镇上的房子区：台地上一排排房子的范围（0–1），森林避开这里 */
export function townFactor(x: number, z: number) {
  return (1 - smoothstep(-60, -68, z)) * smoothstep(-14, -20, z) * smoothstep(-64, -52, x) * (1 - smoothstep(60, 70, x))
}

/** 0–1：森林密度。北山上是雨林，东岬、西北坡也有树；镇上、沙洲、沙滩上没有（棕榈另外种）。 */
export function forestDensity(x: number, z: number) {
  const n = fbm(x * 0.06 + 20, z * 0.06 - 4) * 0.5 + 0.5
  const s = shore(x, z)
  const hills = smoothstep(-46, -60, z)
  const eastSlope = smoothstep(70, 86, x) * (1 - smoothstep(10, 26, z)) * (1 - smoothstep(-6, 8, z) * (1 - smoothstep(78, 90, x)) * 0.0)
  const west = smoothstep(-80, -96, x) * (1 - smoothstep(-6, 8, z))
  // 只有真正盖了房子的那一片（z > -56）不长树，再往上的山坡是雨林
  const town = townFactor(x, z) * smoothstep(-60, -52, z)
  return clamp(Math.max(hills, eastSlope * 0.8, west * 0.7) * (0.55 + 0.75 * n) * (1 - town * 0.92), 0, 1) * smoothstep(7, 14, s)
}
