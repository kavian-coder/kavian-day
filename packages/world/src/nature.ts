/**
 * 自然：树、竹子以外的植被、草、花、石头。全部用 InstancedMesh，一种东西一次绘制。
 * 树冠的法线做了“球形化”，整团叶子像一个体积那样受光，接近动画背景里的画法。
 */
import {
  BufferGeometry,
  CanvasTexture,
  SRGBColorSpace,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Material,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { gradeY, spherize, type Kit, type Season } from './kit'
import { PLACES, CONTENT, pathDist, railNear, shore, forestDensity, inlandFactor, isClear, place, RIVER, distTo, PATHS, townFactor } from './layout'
import { rng } from './noise'
import { LAYER_NO_REFLECT } from './water'

type Blob = [number, number, number, number]

/** 位置决定的伪随机，用来让顶点抖动后不开裂 */
const h3 = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  return s - Math.floor(s)
}

function blobGeo(blobs: Blob[], detail: number, center: Vector3, squash = 1, lump = 0.14, amount = 0.82): BufferGeometry {
  const parts = blobs.map(([x, y, z, r]) => {
    const g = new IcosahedronGeometry(r, detail)
    const p = g.getAttribute('position')
    const v = new Vector3()
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i)
      const k = 1 + (h3(v.x + x, v.y + y, v.z + z) - 0.5) * lump * 2
      p.setXYZ(i, v.x * k, v.y * k * 0.92, v.z * k)
    }
    g.translate(x, y, z)
    return g
  })
  const g = mergeGeometries(parts)!
  parts.forEach((p) => p.dispose())
  g.computeVertexNormals()
  spherize(g, center, amount, squash)
  return g
}

function nonIndexed(g: BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g
  if (n !== g) g.dispose()
  return n
}

// ---------- 几何体
const BROAD_BLOBS: Blob[] = [
  [0, 5.4, 0, 2.1],
  [1.4, 4.6, 0.5, 1.5],
  [-1.3, 4.7, -0.4, 1.55],
  [0.3, 4.4, -1.4, 1.4],
  [-0.4, 4.5, 1.4, 1.4],
  [0.2, 6.5, 0.2, 1.3],
]
const BROAD_C = new Vector3(0, 5.2, 0)
const SAKURA_BLOBS: Blob[] = [
  [0, 4.8, 0, 2.0],
  [1.9, 4.3, 0.4, 1.5],
  [-1.9, 4.4, -0.3, 1.5],
  [0.4, 4.2, -1.8, 1.4],
  [-0.5, 4.2, 1.8, 1.4],
  [1.2, 5.3, -1.0, 1.2],
  [-1.1, 5.4, 1.0, 1.2],
]
const SAKURA_C = new Vector3(0, 4.6, 0)
const BUSH_BLOBS: Blob[] = [
  [0, 0.6, 0, 0.85],
  [0.7, 0.45, 0.2, 0.6],
  [-0.6, 0.45, -0.2, 0.62],
]
const BUSH_C = new Vector3(0, 0.4, 0)
const shrink = (blobs: Blob[], k: number): Blob[] => blobs.map(([x, y, z, r]) => [x, y, z, r * k])

/** 树冠的“芯”：比叶片层小一圈，负责投影子和填住叶片之间的空隙 */
function broadleafCrown() {
  return gradeY(blobGeo(shrink(BROAD_BLOBS, 0.82), 1, BROAD_C), 3.2, 7.2, 0.7, 1.0)
}
function sakuraCrown() {
  return gradeY(blobGeo(shrink(SAKURA_BLOBS, 0.82), 1, SAKURA_C, 1.5), 3, 6.4, 0.76, 1.0)
}

/** 一片片朝向镜头的叶片卡，贴在几个球团的表面上 */
function cardGeo(blobs: Blob[], center: Vector3, count: number, half: number, seed: number, squash = 1) {
  const R = rng(seed)
  const total = blobs.reduce((a, b) => a + b[3] * b[3], 0)
  let y0 = Infinity
  let y1 = -Infinity
  for (const [, y, , r] of blobs) {
    y0 = Math.min(y0, y - r)
    y1 = Math.max(y1, y + r)
  }
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const corner: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const d = new Vector3()
  const bc = new Vector3()
  const p = new Vector3()
  const n = new Vector3()
  for (let i = 0; i < count; i++) {
    let t = R() * total
    let b = blobs[0]!
    for (const bb of blobs) {
      t -= bb[3] * bb[3]
      if (t <= 0) {
        b = bb
        break
      }
    }
    bc.set(b[0], b[1], b[2])
    d.set(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1)
    if (d.lengthSq() < 0.01) d.set(0, 1, 0)
    d.normalize()
    const outward = bc.clone().sub(center)
    if (outward.lengthSq() > 0.01 && d.dot(outward.normalize()) < -0.25) d.negate()
    p.copy(bc).addScaledVector(d, b[3] * (0.72 + R() * 0.32))
    n.copy(p).sub(center)
    n.y *= squash
    n.normalize().lerp(d, 0.25).normalize()
    const ang = R() * Math.PI * 2
    const h = half * (0.8 + R() * 0.45)
    const shade = (0.78 + 0.34 * Math.min(1, Math.max(0, (p.y - y0) / (y1 - y0)))) * (0.9 + R() * 0.2)
    const base = i * 4
    ;[
      [-1, -1, 0, 0],
      [1, -1, 1, 0],
      [1, 1, 1, 1],
      [-1, 1, 0, 1],
    ].forEach(([cx, cy, u, v]) => {
      pos.push(p.x, p.y, p.z)
      nor.push(n.x, n.y, n.z)
      uv.push(u!, v!)
      corner.push((cx! * Math.cos(ang) - cy! * Math.sin(ang)) * h, (cx! * Math.sin(ang) + cy! * Math.cos(ang)) * h)
      col.push(shade, shade, shade)
    })
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setAttribute('corner', new Float32BufferAttribute(corner, 2))
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  g.boundingSphere!.radius += half * 1.5
  return g
}

/** 叶片贴图：一簇椭圆小叶子，灰度表示明暗，颜色由实例色给 */
function leafTexture() {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const R = rng(4)
  const leaves = Array.from({ length: 46 }, () => {
    const a = R() * Math.PI * 2
    const rr = Math.sqrt(R()) * S * 0.31
    return { x: S / 2 + Math.cos(a) * rr, y: S / 2 + Math.sin(a) * rr * 0.9, rot: R() * Math.PI * 2, l: S * (0.055 + R() * 0.04), v: 175 + Math.floor(R() * 80) }
  }).sort((a, b) => a.v - b.v)
  for (const lf of leaves) {
    g.save()
    g.translate(lf.x, lf.y)
    g.rotate(lf.rot)
    g.fillStyle = `rgb(${lf.v},${lf.v},${lf.v})`
    g.beginPath()
    g.moveTo(-lf.l, 0)
    g.quadraticCurveTo(0, -lf.l * 0.62, lf.l, 0)
    g.quadraticCurveTo(0, lf.l * 0.62, -lf.l, 0)
    g.fill()
    g.strokeStyle = `rgba(80,100,70,.35)`
    g.lineWidth = .7
    g.beginPath(); g.moveTo(-lf.l*.8,0);g.lineTo(lf.l*.8,0);g.stroke()
    g.restore()
  }
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  return tex
}

function trunkGeo(h: number, r: number, branches: boolean) {
  const parts: BufferGeometry[] = [nonIndexed(new CylinderGeometry(r * 0.65, r, h, 7).translate(0, h / 2, 0))]
  if (branches) {
    for (let i = 0; i < 3; i++) {
      const b = new CylinderGeometry(r * 0.2, r * 0.42, h * 0.55, 5).translate(0, h * 0.27, 0)
      b.rotateZ(0.75)
      b.rotateY((i * Math.PI * 2) / 3 + 0.4)
      b.translate(0, h * 0.62, 0)
      parts.push(nonIndexed(b))
      const angle = (i * Math.PI * 2) / 3 + 0.4
      for (let j = 0; j < 3; j++) {
        const twig = new CylinderGeometry(r * 0.025, r * 0.12, h * 0.3, 4).translate(0, h * 0.15, 0)
        twig.rotateZ(0.45 + j * 0.35)
        twig.rotateY(angle + (j - 1) * 0.65)
        twig.translate(-Math.cos(angle) * h * 0.25, h * (0.83 + j * 0.05), Math.sin(angle) * h * 0.25)
        parts.push(nonIndexed(twig))
      }
    }
  }
  const g = mergeGeometries(parts)!
  parts.forEach((p) => p.dispose())
  return g
}

function coniferGeo() {
  const tiers: [number, number, number][] = [
    [2.3, 3.4, 2.7],
    [1.75, 3.0, 4.6],
    [1.15, 2.6, 6.3],
    [0.6, 1.8, 7.7],
  ]
  const parts = tiers.map(([r, h, y]) => {
    const g = nonIndexed(new ConeGeometry(r, h, 9, 1, true))
    // 下摆往外翘一点
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setY(i, p.getY(i) + (h3(p.getX(i), y, p.getZ(i)) - 0.5) * 0.5)
    return g.translate(0, y, 0)
  })
  const g = mergeGeometries(parts)!
  parts.forEach((p) => p.dispose())
  g.computeVertexNormals()
  spherize(g, new Vector3(0, 4.4, 0), 0.55, 0.6)
  return gradeY(g, 1, 8.6, 0.72, 1.12)
}

/** 针叶卡：贴在每一层锥面上，朝外下垂的一簇簇针叶 */
function coniferCards(count: number, seed: number) {
  const tiers: [number, number, number][] = [
    [2.3, 3.4, 2.7],
    [1.75, 3.0, 4.6],
    [1.15, 2.6, 6.3],
    [0.6, 1.8, 7.7],
  ]
  const R = rng(seed)
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const corner: number[] = []
  const col: number[] = []
  const idx: number[] = []
  for (let i = 0; i < count; i++) {
    const [r, h, y] = tiers[Math.min(3, Math.floor(Math.pow(R(), 0.8) * 4))]!
    const a = R() * Math.PI * 2
    const f = 0.15 + R() * 0.85 // 从锥顶往下
    const rr = r * f * (0.85 + R() * 0.2)
    const py = y + h / 2 - f * h
    const nx = Math.cos(a)
    const nz = Math.sin(a)
    const len = Math.hypot(nx, 0.45, nz)
    const half = 0.55 + 0.35 * f
    const shade = (0.72 + 0.4 * ((py - 1) / 8)) * (0.9 + R() * 0.2)
    const ang = R() * Math.PI * 2
    const base = i * 4
    ;[
      [-1, -1, 0, 0],
      [1, -1, 1, 0],
      [1, 1, 1, 1],
      [-1, 1, 0, 1],
    ].forEach(([cx, cy, u, v]) => {
      pos.push(nx * rr, py, nz * rr)
      nor.push(nx / len, 0.45 / len, nz / len)
      uv.push(u!, v!)
      corner.push((cx! * Math.cos(ang) - cy! * Math.sin(ang)) * half, (cx! * Math.sin(ang) + cy! * Math.cos(ang)) * half)
      col.push(shade, shade, shade)
    })
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setAttribute('corner', new Float32BufferAttribute(corner, 2))
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  g.boundingSphere!.radius += 1.5
  return g
}

/** 针叶贴图：从中间往外放射的细针 */
function needleTexture() {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const R = rng(8)
  g.lineCap = 'round'
  for (let i = 0; i < 70; i++) {
    const a = R() * Math.PI * 2
    const l = S * (0.18 + R() * 0.24)
    const v = 160 + Math.floor(R() * 95)
    g.strokeStyle = `rgb(${v},${v},${v})`
    g.lineWidth = 2 + R() * 2.5
    const ox = S / 2 + (R() - 0.5) * S * 0.2
    const oy = S / 2 + (R() - 0.5) * S * 0.2
    g.beginPath()
    g.moveTo(ox, oy)
    g.lineTo(ox + Math.cos(a) * l, oy + Math.sin(a) * l * 0.8)
    g.stroke()
  }
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  return tex
}

function palmGeo(): { trunk: BufferGeometry; fronds: BufferGeometry } {
  const H = 6.5
  const bend = (y: number) => 0.035 * y * y
  const trunk = nonIndexed(new CylinderGeometry(0.17, 0.27, H, 6, 10).translate(0, H / 2, 0))
  const p = trunk.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i)
    // 一节一节的树干
    const ring = 1 + 0.12 * Math.max(0, Math.sin(y * 7))
    p.setXYZ(i, p.getX(i) * ring + bend(y), y, p.getZ(i) * ring)
  }
  trunk.computeVertexNormals()
  // 叶子：每片是一根下垂的叶轴，两边排着细长的小叶
  const top = new Vector3(bend(H), H, 0)
  const pos: number[] = []
  const R = rng(14)
  const FRONDS = 9
  for (let i = 0; i < FRONDS; i++) {
    const ang = (i / FRONDS) * Math.PI * 2 + R() * 0.3
    const len = 3.2 + R() * 0.8
    const lift = 0.35 + R() * 0.4
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    const rib = (t: number) => {
      const d = t * len
      return new Vector3(top.x + ca * d, top.y + lift * t * 1.6 - 1.9 * t * t, top.z + sa * d)
    }
    const N = 14
    for (let k = 1; k <= N; k++) {
      const t = k / N
      const p0 = rib(t - 0.5 / N)
      const p1 = rib(t + 0.4 / N)
      const leafL = Math.sin(Math.PI * Math.min(1, t * 1.1)) * 0.95 + 0.15
      for (const side of [-1, 1]) {
        // 小叶从叶轴斜着向外、向前、略往下垂
        const tip = rib(Math.min(1, t + 0.06)).add(new Vector3(-sa * side * leafL, -0.35 * leafL, ca * side * leafL))
        pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, tip.x, tip.y, tip.z)
      }
    }
  }
  const fronds = new BufferGeometry()
  fronds.setAttribute('position', new Float32BufferAttribute(pos, 3))
  fronds.setAttribute('normal', new Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  gradeY(fronds, H - 2.2, H + 0.6, 0.72, 1.12)
  return { trunk, fronds }
}

function bushGeo() {
  return gradeY(blobGeo(shrink(BUSH_BLOBS, 0.8), 1, BUSH_C), 0, 1.4, 0.7, 1.0)
}

function rockGeo() {
  const g = new DodecahedronGeometry(1, 0)
  const p = g.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const k = 0.8 + h3(x, y, z) * 0.45
    p.setXYZ(i, x * k * 1.2, Math.max(y * k * 0.7, -0.3), z * k)
  }
  g.computeVertexNormals()
  return g
}

function grassGeo() {
  // 一丛 12 根细长的弯叶，每根两节，根部暗、叶尖亮
  const verts: number[] = []
  const R = rng(3)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + R() * 0.8
    const h = 0.14 + R() * 0.28
    const lean = 0.08 + R() * 0.15
    const w = 0.012 + R() * 0.012
    const ox = Math.cos(a) * 0.14 * R()
    const oz = Math.sin(a) * 0.14 * R()
    const dx = Math.cos(a)
    const dz = Math.sin(a)
    const px = -dz * w
    const pz = dx * w
    // 中间节点稍微往外弯
    const mx = ox + dx * lean * 0.35
    const mz = oz + dz * lean * 0.35
    const tx = ox + dx * lean
    const tz = oz + dz * lean
    verts.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, mx + px * 0.7, h * 0.55, mz + pz * 0.7)
    verts.push(ox - px, 0, oz - pz, mx + px * 0.7, h * 0.55, mz + pz * 0.7, mx - px * 0.7, h * 0.55, mz - pz * 0.7)
    verts.push(mx - px * 0.7, h * 0.55, mz - pz * 0.7, mx + px * 0.7, h * 0.55, mz + pz * 0.7, tx, h, tz)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(verts, 3))
  g.setAttribute('normal', new Float32BufferAttribute(verts.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  return gradeY(g, 0, 0.75, 0.62, 1.22)
}

function flowerGeo() {
  // 一簇三朵小花：五瓣的星形花冠，花心暗一点
  const pos: number[] = []
  const col: number[] = []
  const R = rng(9)
  for (let f = 0; f < 3; f++) {
    const cx = (R() - 0.5) * 0.5
    const cz = (R() - 0.5) * 0.5
    const cy = 0.26 + R() * 0.2
    const rad = 0.1 + R() * 0.05
    const rot = R() * Math.PI
    const rim = Array.from({ length: 10 }, (_, k) => {
      const a = rot + (k / 10) * Math.PI * 2
      const r = k % 2 ? rad * 0.38 : rad
      return [cx + Math.cos(a) * r, cy + (k % 2 ? 0 : 0.015), cz + Math.sin(a) * r]
    })
    for (let k = 0; k < 10; k++) {
      const p = rim[k]!
      const q = rim[(k + 1) % 10]!
      pos.push(cx, cy + 0.02, cz, ...p, ...q)
      col.push(0.62, 0.55, 0.4, 1, 1, 1, 1, 1, 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  return g
}

// ---------- 季节色
const P = (...hex: string[]) => hex.map((h) => new Color(h))
// 阔叶林表现四季；棕榈保持常绿。
const BROADLEAF: Record<Season, Color[] | null> = {
  spring: P('#62B04A', '#4E9E3E', '#79C25A', '#3F8F3A'),
  summer: P('#55A646', '#3F933C', '#6DBB52', '#348437'),
  autumn: P('#D6A343', '#BC673B', '#DCC063', '#788B46'),
  winter: null,
}
// 凤凰木：花开的时候一树火红（v2 把樱花换成热带的开花树）
const SAKURA: Record<Season, Color[] | null> = {
  spring: P('#F0B1BD', '#F5CFD1', '#D98EAA'),
  summer: P('#E24A32', '#F2683A', '#D63A2C'),
  autumn: P('#D69B43', '#B96E3D', '#BDAC58'),
  winter: null,
}
const CONIFER: Record<Season, Color[]> = {
  spring: P('#4E9160', '#43865A'),
  summer: P('#3F8156', '#37744E'),
  autumn: P('#3F7B53', '#4A8058'),
  winter: P('#8FB3A6', '#A9C6BC'),
}
const BUSH: Record<Season, Color[]> = {
  spring: P('#5FA84A', '#78BA55'),
  summer: P('#4F9A45', '#5DA84E', '#3F8C3E'),
  autumn: P('#AD944B', '#C6A55D'),
  winter: P('#9DAA9D', '#B5BCAE'),
}
const FLOWERS: Record<Season, Color[] | null> = {
  spring: P('#FFFFFF', '#FFE27A', '#F7B6CF', '#C9B8F2'),
  summer: P('#7EA8EE', '#B79BEA', '#FFFFFF', '#F7D24C'),
  autumn: P('#E2473A', '#F19BC0', '#FFFFFF', '#F2A33A'),
  winter: null,
}

interface Inst {
  x: number
  y: number
  z: number
  s: number
  rot: number
  inland: number
  r: number
}

interface Kind {
  meshes: InstancedMesh[]
  items: Inst[]
  /** 季节换色：返回 null 表示这一季隐藏 */
  color?: (season: Season, it: Inst, out: Color) => Color | null
  /** 哪个网格要上色（默认第一个之外都不上色） */
  colored?: number[]
}

export interface Nature {
  group: Group
  setSeason: (s: Season) => void
  /** 树干等障碍（只算靠近步行区的） */
  obstacles: { x: number; z: number; r: number }[]
  /** 阔叶树和樱花的树梢（小鸟落脚的地方） */
  treeTops: Vector3[]
  /** 树冠的包围球，角色视角的镜头用来避开树冠 */
  crowns: { x: number; y: number; z: number; r: number }[]
  /** 因为树冠会碰到列车、电线、房子而没种的树（调试用） */
  cleared: Record<string, number>
}

/** 树冠、叶子不能伸进去的空间（列车开过的范围、电线、房子） */
export interface Clearance {
  /** (x, z) 周围 r 米内有没有需要避开的东西：没有就不用逐点检查 */
  near: (x: number, z: number, r: number) => boolean
  /** 这个点是不是在不能进的空间里 */
  at: (x: number, y: number, z: number) => boolean
}

export function createNature(
  kit: Kit,
  groundAt: (x: number, z: number) => number,
  colorAt: (x: number, z: number, c: Color) => Color,
  /** 房子、站台、栈桥等占用的地方（不长树、不长草） */
  blocked: (x: number, z: number, margin: number) => boolean = () => false,
  clearance?: Clearance,
): Nature {
  const group = new Group()
  const R = rng(20261029)
  const obstacles: Nature['obstacles'] = []
  const kinds: Kind[] = []

  const leafMat = (amount: number, base: number, side = false) =>
    kit.sway(kit.toon(0xffffff, side ? { vertexColors: true, side: DoubleSide } : { vertexColors: true }), amount, base)
  const barkMat = kit.pattern(kit.toon('#8A6446'), 'bark', 1)
  const barkLight = kit.pattern(kit.toon('#B08A68'), 'bark', 1.5)
  const rockMat = kit.pattern(kit.toon('#B3ACA2'), 'stone', 0.7)

  const G = {
    broadTrunk: kit.track(trunkGeo(4.2, 0.32, true)),
    broadCrown: kit.track(broadleafCrown()),
    sakuraTrunk: kit.track(trunkGeo(3.6, 0.3, true)),
    sakuraCrown: kit.track(sakuraCrown()),
    conifer: kit.track(coniferGeo()),
    coniferTrunk: kit.track(trunkGeo(2.2, 0.28, false)),
    coniferCards: kit.track(coniferCards(kit.high ? 90 : 50, 31)),
    bush: kit.track(bushGeo()),
    broadCards: kit.track(cardGeo(BROAD_BLOBS, BROAD_C, kit.high ? 110 : 60, 0.8, 11)),
    sakuraCards: kit.track(cardGeo(SAKURA_BLOBS, SAKURA_C, kit.high ? 120 : 65, 0.75, 12, 1.5)),
    bushCards: kit.track(cardGeo(BUSH_BLOBS, BUSH_C, 22, 0.5, 13)),
    rock: kit.track(rockGeo()),
    grass: kit.track(grassGeo()),
    flower: kit.track(flowerGeo()),
    ...(() => {
      const p = palmGeo()
      return { palmTrunk: kit.track(p.trunk), palmFronds: kit.track(p.fronds) }
    })(),
  }
  const leafTex = kit.track(leafTexture())
  /** 叶片卡材质：在顶点着色器里把每片卡转向镜头 */
  const needleTex = kit.track(needleTexture())
  const cardMat = (amount: number, base: number, map = leafTex) => {
    const m = kit.toon(0xffffff, { map, alphaTest: 0.5, vertexColors: true, side: DoubleSide, alphaToCoverage: kit.high })
    kit.sway(m, amount, base)
    return kit.patch(m, 'card', (shader) => {
      shader.vertexShader =
        'attribute vec2 corner;\n' +
        shader.vertexShader.replace(
          '#include <project_vertex>',
          `vec4 mvPosition = vec4(transformed, 1.0);
          float kvS = 1.0;
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
            kvS = length(instanceMatrix[0].xyz);
          #endif
          mvPosition = modelViewMatrix * mvPosition;
          mvPosition.xy += corner * kvS;
          gl_Position = projectionMatrix * mvPosition;`,
        )
    })
  }
  const broadCardMat = cardMat(0.012, 3)
  const sakuraCardMat = cardMat(0.012, 3)
  const bushCardMat = cardMat(0.05, 0)
  const coniferCardMat = cardMat(0.006, 1.5, needleTex)
  const crownMat = leafMat(0.012, 3)
  const sakuraMat = leafMat(0.012, 3)
  // 芯比叶片暗一档，看起来是树冠里面的阴影
  crownMat.color.setScalar(0.8)
  sakuraMat.color.setScalar(0.85)
  const coniferMat = leafMat(0.006, 1.5)
  const palmMat = leafMat(0.02, 4.5, true)
  const bushMat = leafMat(0.05, 0)
  bushMat.color.setScalar(0.8)
  const grassMat = kit.sway(kit.toon(0xffffff, { vertexColors: true, side: DoubleSide }), 0.35, 0)
  const flowerMat = kit.sway(kit.toon(0xffffff, { vertexColors: true, side: DoubleSide }), 0.25, 0)

  const lists = {
    broad: [] as Inst[],
    sakura: [] as Inst[],
    conifer: [] as Inst[],
    palm: [] as Inst[],
    bush: [] as Inst[],
    rock: [] as Inst[],
    grass: [] as Inst[],
    flower: [] as Inst[],
  }
  const add = (list: Inst[], x: number, z: number, s: number, yOff = 0) => {
    list.push({ x, z, y: groundAt(x, z) + yOff, s, rot: R() * Math.PI * 2, inland: inlandFactor(x, z), r: R() })
  }

  // ---------- 摆放
  const step = kit.high ? 3.2 : 4.4
  // 只在有陆地的范围里撒（世界圈外都是深海）
  const { minX, maxX, minZ, maxZ } = CONTENT
  for (let gx = minX + 2; gx < maxX - 2; gx += step)
    for (let gz = minZ + 2; gz < maxZ - 2; gz += step) {
      const x = gx + R() * step
      const z = gz + R() * step
      const h = groundAt(x, z)
      const s2 = shore(x, z)
      if (h < 0.8 || h > 80) continue
      if (!isClear(x, z, 0.5) || blocked(x, z, 2.5)) continue
      const fd = forestDensity(x, z)
      const roll = R()
      if (s2 < 13 && s2 > 3) {
        // 海边：椰子树成片，夹着灌木
        if (roll < 0.3) add(lists.palm, x, z, 0.85 + R() * 0.45)
        else if (roll < 0.42) add(lists.bush, x, z, 0.8 + R() * 0.6)
        continue
      }
      // 镇上：零星的椰子树和开花灌木，大部分地方留给房子和街道
      if (townFactor(x, z) > 0.4) {
        if (roll < 0.06) add(lists.palm, x, z, 0.9 + R() * 0.4)
        else if (roll < 0.1) add(lists.bush, x, z, 0.7 + R() * 0.5)
        continue
      }
      if (roll < fd * 0.9) {
        // 雨林：大树冠的阔叶树，中间夹着高高的椰子树
        if (R() < 0.2) add(lists.palm, x, z, 1.0 + R() * 0.45)
        else add(lists.broad, x, z, 0.95 + R() * 0.7, -0.1)
      } else if (roll < fd * 0.9 + 0.035) {
        add(lists.broad, x, z, 0.75 + R() * 0.4, -0.1)
      } else if (roll < fd * 0.9 + 0.09) {
        add(lists.bush, x, z, 0.7 + R() * 0.6)
      } else if (roll < fd * 0.9 + 0.11 || (h > 12 && roll < 0.3)) {
        add(lists.rock, x, z, 0.6 + R() * 1.3, -0.25)
      }
    }

  // 樱花：家门口的坡上，还有通往家的小路两边
  const home = place('home')
  const sakuraSpots: [number, number][] = [
    [home.x - 10, home.z + 4],
    [home.x + 9, home.z + 6],
    [home.x - 6, home.z - 9],
  ]
  for (const [sx, sz] of sakuraSpots) {
    // 种在小路两边，离路面至少 2.6 米
    let x = sx
    const z = sz
    for (let k = 0; k < 6 && pathDist(x, z, 4) < 2.6; k++) x += sx >= 3 ? 0.8 : -0.8
    if (!blocked(x, z, 2) && pathDist(x, z, 4) >= 2.6) add(lists.sakura, x, z, 0.95 + R() * 0.25, -0.1)
  }
  // 溪边多一些石头
  for (let i = 0; i < RIVER.length; i += 3) {
    const p = RIVER[i]!
    if (R() < 0.5) continue
    const side = R() < 0.5 ? -1 : 1
    const x = p[0] + side * (3.2 + R() * 1.4)
    const z = p[1] + (R() - 0.5) * 2
    if (Math.abs(x + 13.4) < 3 && Math.abs(z + 1.6) < 4) continue
    const rn = railNear(x, z, 6)
    if (!blocked(x, z, 1) && pathDist(x, z, 3) > 2.2 && !(rn && rn.d < 4.5)) add(lists.rock, x, z, 0.5 + R() * 0.7, -0.2)
  }
  // 草丛和花：步行区附近密，远处稀
  const grassN = kit.high ? 16000 : 4500
  for (let i = 0; i < grassN * 3 && lists.grass.length < grassN; i++) {
    const x = -78 + R() * 156
    const z = -56 + R() * 100
    const h = groundAt(x, z)
    if (h < 0.9 || shore(x, z) < 5) continue
    if (distTo(x, z, RIVER, 3) < 2.6) continue
    let pd = 2
    for (const p of PATHS) pd = Math.min(pd, distTo(x, z, p, pd))
    if (pd < 1.65) continue
    if (PLACES.some((pl) => Math.hypot(x - pl.x, z - pl.z) < Math.max(pl.pad, pl.radius) + 1)) continue
    // 铁轨、站台、房子、小路上一根草都不长
    if (!isClear(x, z, -1.6) || blocked(x, z, 0.6)) continue
    const meadow = 1 - forestDensity(x, z) * 0.6
    if (R() > meadow) continue
    if (R() < 0.16) add(lists.flower, x, z, 0.75 + R() * 0.45, -0.05)
    else add(lists.grass, x, z, 0.6 + R() * 0.55, -0.05)
  }

  // ---------- 净空：树冠、叶子、树干不能伸进列车开过的空间、电线和房子里。
  // 不靠估计的半径，而是拿这种树真实网格的顶点，按这一棵的朝向和大小摆好，逐点检查
  const cleared: Record<string, number> = {}
  if (clearance) {
    const sample = (gs: BufferGeometry[]) => {
      const pts: number[] = []
      let reach = 0
      for (const g of gs) {
        const p = g.getAttribute('position')
        const stride = Math.max(1, Math.floor(p.count / 260))
        for (let i = 0; i < p.count; i += stride) {
          pts.push(p.getX(i), p.getY(i), p.getZ(i))
          reach = Math.max(reach, Math.hypot(p.getX(i), p.getZ(i)))
        }
      }
      return { pts, reach: reach + 0.8 }
    }
    const TREES: [keyof typeof lists, BufferGeometry[]][] = [
      ['broad', [G.broadTrunk, G.broadCrown, G.broadCards]],
      ['sakura', [G.sakuraTrunk, G.sakuraCrown, G.sakuraCards]],
      ['conifer', [G.coniferTrunk, G.conifer, G.coniferCards]],
      ['palm', [G.palmTrunk, G.palmFronds]],
      ['bush', [G.bush, G.bushCards]],
    ]
    for (const [name, gs] of TREES) {
      const { pts, reach } = sample(gs)
      const before = lists[name].length
      lists[name] = lists[name].filter((it) => {
        if (!clearance.near(it.x, it.z, reach * it.s)) return true
        // 和 three.js 一样绕 Y 轴转 rot
        const c = Math.cos(it.rot)
        const sn = Math.sin(it.rot)
        for (let i = 0; i < pts.length; i += 3) {
          const lx = pts[i]! * it.s
          const lz = pts[i + 2]! * it.s
          if (clearance.at(it.x + lx * c + lz * sn, it.y + pts[i + 1]! * it.s, it.z - lx * sn + lz * c)) return false
        }
        return true
      })
      if (lists[name].length < before) cleared[name] = before - lists[name].length
    }
  }

  // ---------- 生成网格
  const m4 = new Matrix4()
  const q = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const v = new Vector3()
  const sv = new Vector3()
  const mk = (list: Inst[], parts: [BufferGeometry, Material][], shadow: boolean, kind: Omit<Kind, 'meshes' | 'items'>) => {
    if (!list.length) return []
    const meshes = parts.map(([g, m]) => {
      const im = new InstancedMesh(g, m, list.length)
      im.castShadow = shadow
      im.receiveShadow = true
      list.forEach((it, i) => {
        q.setFromAxisAngle(up, it.rot)
        m4.compose(v.set(it.x, it.y, it.z), q, sv.setScalar(it.s))
        im.setMatrixAt(i, m4)
      })
      im.computeBoundingSphere()
      group.add(im)
      return im
    })
    kinds.push({ meshes, items: list, ...kind })
    // 叶片卡不投影子（芯会投），否则影子是一张张方片
    for (const m of meshes) if ((m.material as Material).userData.patches?.some((p: { key: string }) => p.key === 'card')) m.castShadow = false
    return meshes
  }

  const pick = (arr: Color[], r: number) => arr[Math.floor(r * arr.length) % arr.length]!
  mk(lists.broad, [[G.broadTrunk, barkMat], [G.broadCrown, crownMat], [G.broadCards, broadCardMat]], true, {
    colored: [1, 2],
    color: (s, it, out) => {
      const pal = BROADLEAF[s]
      return pal ? out.copy(pick(pal, it.r)) : null
    },
  })
  mk(lists.sakura, [[G.sakuraTrunk, barkMat], [G.sakuraCrown, sakuraMat], [G.sakuraCards, sakuraCardMat]], true, {
    colored: [1, 2],
    color: (s, it, out) => {
      const pal = SAKURA[s]
      return pal ? out.copy(pick(pal, it.r)) : null
    },
  })
  coniferMat.color.setScalar(0.78)
  mk(lists.conifer, [[G.coniferTrunk, barkMat], [G.conifer, coniferMat], [G.coniferCards, coniferCardMat]], true, {
    colored: [1, 2],
    color: (s, it, out) => out.copy(pick(CONIFER[s], it.r)),
  })
  mk(lists.palm, [[G.palmTrunk, barkLight], [G.palmFronds, palmMat]], true, {
    colored: [1],
    color: (_s, it, out) => out.set(it.r < 0.5 ? '#5CAA4C' : '#6DB955'),
  })
  mk(lists.bush, [[G.bush, bushMat], [G.bushCards, bushCardMat]], true, {
    colored: [0, 1],
    color: (s, it, out) => out.copy(pick(BUSH[s], it.r)),
  })
  mk(lists.rock, [[G.rock, rockMat]], true, {})
  // 草按 4×4 的地块分开，镜头外的地块整块跳过不画
  const grassChunks = new Map<number, Inst[]>()
  for (const it of lists.grass) {
    const key = Math.floor((it.x + 66) / 33) * 8 + Math.floor((it.z + 56) / 24)
    if (!grassChunks.has(key)) grassChunks.set(key, [])
    grassChunks.get(key)!.push(it)
  }
  for (const chunk of grassChunks.values())
    for (const m of mk(chunk, [[G.grass, grassMat]], false, {
      colored: [0],
      color: (s, it, out) => {
        if (s === 'winter' && it.inland > 0.5) return null
        return colorAt(it.x, it.z, out).multiplyScalar(1.0)
      },
    }))
      m.layers.set(LAYER_NO_REFLECT)
  for (const m of mk(lists.flower, [[G.flower, flowerMat]], false, {
    colored: [0],
    color: (s, it, out) => {
      const pal = FLOWERS[s]
      return pal ? out.copy(pick(pal, it.r)) : null
    },
  }))
    m.layers.set(LAYER_NO_REFLECT)

  const treeTops = [...lists.broad, ...lists.sakura]
    .filter((it) => Math.abs(it.x) < 70 && it.z > -60)
    .map((it) => new Vector3(it.x, it.y + 6.6 * it.s, it.z))
  const crowns = [
    ...[...lists.broad, ...lists.sakura].map((it) => ({ x: it.x, y: it.y + 5.0 * it.s, z: it.z, r: 2.9 * it.s })),
    ...lists.conifer.map((it) => ({ x: it.x, y: it.y + 4.6 * it.s, z: it.z, r: 2.4 * it.s })),
    ...lists.palm.map((it) => ({ x: it.x, y: it.y + 6.2 * it.s, z: it.z, r: 2.2 * it.s })),
  ]
  // 靠近步行区的树干算障碍
  for (const list of [lists.broad, lists.sakura, lists.conifer, lists.palm])
    for (const it of list) if (Math.abs(it.x) < 66 && it.z > -54) obstacles.push({ x: it.x, z: it.z, r: 0.55 * it.s })
  for (const it of lists.rock) if (it.s > 1) obstacles.push({ x: it.x, z: it.z, r: 0.9 * it.s })

  // ---------- 广场的大樟树：常绿，是整个谷地的地标
  const camphor = new Group()
  {
    const trunk = new Mesh(kit.track(trunkGeo(6.5, 1.0, true)), barkMat)
    const roots = new Mesh(kit.track(new ConeGeometry(1.9, 1.6, 9).translate(0, 0.6, 0)), barkMat)
    // 樟树冠：一圈一圈往上收的小团，比一整个大球更有体积感
    const blobs: Blob[] = [[0, 11.2, 0, 3.0]]
    const RR = rng(5)
    for (const [ring, y, n, r] of [
      [4.6, 8.4, 9, 2.2],
      [3.2, 10.2, 7, 2.3],
      [1.6, 12.2, 4, 1.9],
    ] as const) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + RR() * 0.5 + y
        const rr = ring * (0.85 + RR() * 0.3)
        blobs.push([Math.cos(a) * rr, y + (RR() - 0.5) * 1.2, Math.sin(a) * rr, r * (0.8 + RR() * 0.45)])
      }
    }
    const crownGeo = kit.track(gradeY(blobGeo(blobs, 1, new Vector3(0, 9.5, 0), 1.2, 0.2, 0.62), 6.5, 14, 0.72, 1.14))
    const crown = new Mesh(crownGeo, kit.sway(kit.toon('#5A9E4C', { vertexColors: true }), 0.0025, 6))
    const cards = new Mesh(kit.track(cardGeo(blobs, new Vector3(0, 9.5, 0), kit.high ? 700 : 380, 1.05, 21, 1.2)), cardMat(0.0025, 6))
    cards.material.color.set('#5A9E4C')
    trunk.castShadow = crown.castShadow = roots.castShadow = true
    crown.receiveShadow = cards.receiveShadow = true
    crown.scale.setScalar(0.88)
    crown.position.y = 9.5 * 0.12
    camphor.add(trunk, roots, crown, cards)
    camphor.userData.cards = cards
    // 广场边上的大榕树（v2：跟着广场走）
    const pl = place('plaza')
    const cx = pl.x - 4.5
    const cz = pl.z - 6.5
    camphor.position.set(cx, groundAt(cx, cz) - 0.1, cz)
    camphor.userData.crown = crown
    group.add(camphor)
    obstacles.push({ x: cx, z: cz, r: 1.6 })
  }
  const camphorCrown = camphor.userData.crown as Mesh
  const CAMPHOR: Record<Season, string> = { spring: '#8CC25E', summer: '#579C4A', autumn: '#6C9A47', winter: '#6F9C70' }

  const c = new Color()
  function setSeason(s: Season) {
    for (const k of kinds) {
      if (!k.color) continue
      const idx = k.colored ?? [0]
      k.items.forEach((it, i) => {
        const col = k.color!(s, it, c)
        for (const mi of idx) {
          const mesh = k.meshes[mi]!
          // 隐藏：缩成 0
          q.setFromAxisAngle(up, it.rot)
          m4.compose(v.set(it.x, it.y, it.z), q, sv.setScalar(col ? it.s : 0))
          mesh.setMatrixAt(i, m4)
          mesh.setColorAt(i, col ?? c.set(0xffffff))
        }
      })
      for (const mi of idx) {
        const mesh = k.meshes[mi]!
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    }
    ;(camphorCrown.material as unknown as { color: Color }).color.set(CAMPHOR[s]).multiplyScalar(0.85)
    ;((camphor.userData.cards as Mesh).material as unknown as { color: Color }).color.set(CAMPHOR[s])
  }
  setSeason('summer')

  crowns.push({ x: camphor.position.x, y: camphor.position.y + 10, z: camphor.position.z, r: 6.5 })
  return { group, setSeason, obstacles, treeTops, crowns, cleared }
}
