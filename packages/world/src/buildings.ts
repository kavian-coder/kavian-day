/**
 * 各个地点的建筑和小物件：海边车站、广场、造物间、试验棚、林间书屋、小屋、栈桥和灯塔、木桥、路灯。
 * 全部用简单几何体拼出来，颜色走明亮的夏日小镇路线。
 */
import {
  AdditiveBlending,
  BoxGeometry,
  ShaderMaterial,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Object3D,
} from 'three'
import { mergeStatic, type Kit } from './kit'
import { FOOT_BRIDGES, PATHS, PIER, PLACES, RAIL, RAIL_Y, RIVER, distTo, lotNear, place, railNear, type V2 } from './layout'
import { createProps, type Mats } from './props'

export interface Deck {
  /** 返回这一点的走道高度，不在走道上返回 null */
  at: (x: number, z: number) => number | null
}

export interface Buildings {
  group: Group
  obstacles: { x: number; z: number; r: number }[]
  decks: Deck[]
  /** 夜里会亮的灯泡位置（世界坐标），用来放光晕 */
  bulbs: Vector3[]
  /** 互动提示的位置 */
  anchors: Record<string, Vector3>
  update: (t: number, dt: number, night: number) => void
  /** 屋顶积雪 0–1 */
  setSnow: (k: number) => void
  mats: Mats & { vend: MeshBasicMaterial }
}

/** 离 (x,z) 最近的铁路点和切线角 */
export function railFrame(x: number, z: number) {
  let best = Infinity
  let bi = 0
  RAIL.forEach((p, i) => {
    const d = (p[0] - x) ** 2 + (p[1] - z) ** 2
    if (d < best) {
      best = d
      bi = i
    }
  })
  const a = RAIL[Math.max(0, bi - 2)]!
  const b = RAIL[Math.min(RAIL.length - 1, bi + 2)]!
  // 统一成朝东的方向，这样“v < 0”总是北边（陆地一侧）
  let ang = Math.atan2(b[1] - a[1], b[0] - a[0])
  if (Math.cos(ang) < 0) ang += Math.PI
  return { p: RAIL[bi]!, ang }
}

/** 局部坐标（沿线 u、横向 v）转世界坐标 */
const frameToWorld = (o: V2, ang: number, u: number, v: number): V2 => [
  o[0] + Math.cos(ang) * u - Math.sin(ang) * v,
  o[1] + Math.sin(ang) * u + Math.cos(ang) * v,
]
const worldToFrame = (o: V2, ang: number, x: number, z: number): V2 => {
  const dx = x - o[0]
  const dz = z - o[1]
  return [Math.cos(ang) * dx + Math.sin(ang) * dz, -Math.sin(ang) * dx + Math.cos(ang) * dz]
}

function signTexture(lines: { text: string; size: number; color: string; y: number; weight?: number }[], w: number, h: number, bg: string) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = bg
  g.fillRect(0, 0, w, h)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const l of lines) {
    g.fillStyle = l.color
    g.font = `${l.weight ?? 700} ${l.size}px "PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Microsoft YaHei",sans-serif`
    g.fillText(l.text, w / 2, l.y)
  }
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

export function createBuildings(kit: Kit, groundAt: (x: number, z: number) => number): Buildings {
  const group = new Group()
  const obstacles: Buildings['obstacles'] = []
  const decks: Deck[] = []
  const bulbs: Vector3[] = []
  const anchors: Record<string, Vector3> = {}
  const anims: ((t: number, dt: number, night: number) => void)[] = []

  const win = kit.track(new MeshBasicMaterial({ color: '#8C8F9A' }))
  const bulb = kit.track(new MeshBasicMaterial({ color: '#FFF4D6' }))
  const vend = kit.track(new MeshBasicMaterial({ color: '#EAF4FF' }))
  // 灯塔光柱：柔和的体积光，越远越淡、边缘渐隐，看不出几何体的形状
  const beam = kit.track(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: { color: { value: new Color('#FFE9B8') }, opacity: { value: 0 }, len: { value: 34 } },
      vertexShader: /* glsl */ `uniform float len; varying float vT; varying vec3 vN; varying vec3 vV;
        void main(){
          vT = position.x / len;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `uniform vec3 color; uniform float opacity; varying float vT; varying vec3 vN; varying vec3 vV;
        void main(){
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
          float along = pow(1.0 - clamp(vT, 0.0, 1.0), 1.8) * smoothstep(0.0, 0.04, vT);
          gl_FragColor = vec4(color * edge * along * opacity, 1.0);
        }`,
    }),
  )
  const mats: Mats = {
    win,
    bulb,
    white: kit.pattern(kit.toon('#FBF8F2'), 'plaster', 1.2, 0.6),
    wood: kit.pattern(kit.toon('#C29469'), 'plank', 1.4),
    darkWood: kit.pattern(kit.toon('#6F5140'), 'wood', 1.5),
    stone: kit.pattern(kit.toon('#D9D2C4'), 'stone', 1),
    metal: kit.pattern(kit.toon('#7B8794'), 'metal', 1),
  }
  const P = createProps(kit, mats)
  const M = {
    cream: kit.pattern(kit.toon('#F7EEDC'), 'plank', 1.1, 0.7),
    whiteWall: kit.pattern(kit.toon('#FCF8EF'), 'plaster', 1),
    plank: kit.pattern(kit.toon('#B98B62'), 'plank', 1.6),
    logWall: kit.pattern(kit.toon('#A7754F'), 'plank', 0.8),
    roofTeal: kit.pattern(kit.toon('#3F93B4'), 'roof', 1.4),
    roofRed: kit.pattern(kit.toon('#CC5E43'), 'roof', 1.4),
    roofBlue: kit.pattern(kit.toon('#4778B8'), 'roof', 1.4),
    roofGreen: kit.pattern(kit.toon('#4E8962'), 'roof', 1.4),
    roofGrey: kit.pattern(kit.toon('#5C6773'), 'metal', 1),
    red: kit.toon('#D9483B'),
    yellow: kit.toon('#F2C641'),
    black: kit.toon('#33363C'),
    paving: kit.pattern(kit.toon('#E8DDC8'), 'paving', 0.9),
    paving2: kit.pattern(kit.toon('#D8CBB2'), 'paving', 1.2),
    glass: kit.toon('#CFF1EE', { transparent: true, opacity: 0.38, depthWrite: false }),
    leaf: kit.toon('#5FA64C'),
    sheet: kit.toon('#FFFFFF', { side: DoubleSide }),
    sheet2: kit.toon('#BFE0F2', { side: DoubleSide }),
    hull: kit.toon('#F5F3EE'),
    hullStripe: kit.toon('#3F86C6'),
  }

  const roofs = [M.roofTeal, M.roofRed, M.roofBlue, M.roofGreen, M.roofGrey].map((m) => ({ m, base: m.color.clone() }))
  const snowWhite = new Color('#F4F7FB')

  /** 把一组东西放到地面上 */
  const put = (o: Object3D, x: number, z: number, rotY = 0, yOff = 0) => {
    o.position.set(x, groundAt(x, z) + yOff, z)
    o.rotation.y = rotY
    group.add(o)
    return o
  }
  const addBulb = (o: Object3D, local: readonly [number, number, number]) => {
    o.updateMatrixWorld(true)
    bulbs.push(new Vector3(...local).applyMatrix4(o.matrixWorld))
  }
  /** 朝向某点的转角（让 +z 面向目标） */
  const face = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z)

  // ======================================================================
  // 海边车站：月台沿着铁路，站房在月台北边
  // ======================================================================
  {
    const st = place('station')
    const { p, ang } = railFrame(st.x, st.z + 3.4)
    const g = new Group()
    g.position.set(p[0], RAIL_Y - 0.15, p[1])
    g.rotation.y = -ang
    group.add(g)
    const PH = 0.55 // 月台高度
    // 月台：沿线 -11..11，横向 -1.7..-5.2（负 = 北，陆地一侧）
    g.add(P.box(22, PH, 3.5, M.paving, 0, 0, -3.45))
    g.add(P.box(22, 0.06, 0.35, M.yellow, 0, PH, -1.95, false)) // 盲道黄线
    g.add(P.box(22.4, 0.12, 0.3, mats.white, 0, PH - 0.12, -1.72, false))
    // 雨棚
    for (const u of [-6, -2, 2, 6]) g.add(P.box(0.16, 3.1, 0.16, mats.white, u, PH, -4.5))
    const canopy = P.box(14, 0.16, 3.4, M.roofTeal, 0, PH + 3.1, -3.4)
    canopy.rotation.x = -0.12
    g.add(canopy)
    // 站房
    const hut = P.house({ w: 6, d: 4.2, h: 3.2, wall: M.cream, roof: M.roofTeal, frontWindows: 2, sideWindows: 1, base: mats.stone })
    hut.position.set(7.2, PH, -8.2)
    hut.rotation.y = Math.PI
    g.add(hut)
    // 长椅、自动售货机、站牌
    const b1 = P.bench(2.4)
    b1.position.set(-4, PH, -4.3)
    g.add(b1)
    const b2 = P.bench(2.4)
    b2.position.set(3.8, PH, -4.3)
    g.add(b2)
    const vm = new Group()
    vm.add(P.box(1.05, 1.95, 0.8, M.red, 0, 0, 0))
    const vmFront = new Mesh(kit.track(new PlaneGeometry(0.8, 1.2)), vend)
    vmFront.position.set(0, 1.25, 0.41)
    vm.add(vmFront)
    vm.position.set(-8.6, PH, -4.6)
    g.add(vm)
    const signTex = kit.track(
      signTexture(
        [
          { text: '海 边', size: 120, color: '#2B3440', y: 112 },
          { text: 'UMIBE · kavian.day', size: 38, color: '#3F93B4', y: 210, weight: 600 },
        ],
        512,
        256,
        '#FFFFFF',
      ),
    )
    const sign = new Group()
    sign.add(P.box(0.12, 2.6, 0.12, mats.darkWood, -1.25, 0, 0), P.box(0.12, 2.6, 0.12, mats.darkWood, 1.25, 0, 0))
    const board = new Mesh(kit.track(new PlaneGeometry(2.8, 1.4)), kit.track(new MeshBasicMaterial({ map: signTex })))
    board.position.y = 2.75
    const boardBack = P.box(2.95, 1.5, 0.08, mats.white, 0, 2.0, -0.06)
    sign.add(board, boardBack)
    sign.position.set(0, PH, -2.5)
    g.add(sign)
    // 灯
    for (const u of [-8, 8]) {
      const l = P.lamp(3.2)
      l.group.position.set(u, PH, -4.8)
      g.add(l.group)
      addBulb(l.group, l.bulb)
    }
    // 自行车停在站房边上（两个圆圈 + 一根横杆）
    const bike = new Group()
    for (const u of [-0.55, 0.55]) {
      const wheel = new Mesh(kit.track(new CylinderGeometry(0.36, 0.36, 0.05, 14, 1, true)), M.black)
      wheel.rotation.x = Math.PI / 2
      wheel.position.set(u, 0.36, 0)
      bike.add(wheel)
    }
    bike.add(P.box(1.2, 0.06, 0.06, M.hullStripe, 0, 0.6, 0, false), P.box(0.06, 0.5, 0.06, M.hullStripe, 0.3, 0.45, 0, false))
    bike.position.set(3.3, 0, -10.8)
    bike.rotation.y = 0.3
    g.add(bike)

    g.updateMatrixWorld(true)
    const o: V2 = [p[0], p[1]]
    decks.push({
      at: (x, z) => {
        const [u, v] = worldToFrame(o, ang, x, z)
        if (u > -11 && u < 11 && v < -1.7 && v > -5.2) return RAIL_Y - 0.15 + PH
        return null
      },
    })
    const hutW = frameToWorld(o, ang, 7.2, -8.2)
    obstacles.push({ x: hutW[0], z: hutW[1], r: 3.2 })
    const vmW = frameToWorld(o, ang, -8.6, -4.6)
    obstacles.push({ x: vmW[0], z: vmW[1], r: 0.7 })
    const a = frameToWorld(o, ang, 0, -3.6)
    anchors.station = new Vector3(a[0], RAIL_Y + 0.4, a[1])
  }

  // ======================================================================
  // 广场：石板圆场、环形长椅、公告牌
  // ======================================================================
  {
    const pl = place('plaza')
    const y = groundAt(pl.x, pl.z)
    // 一圈圈不同深浅的石板
    ;[
      [6.6, M.paving2, -0.16],
      [6.2, M.paving, -0.12],
      [3.6, M.paving2, -0.1],
      [3.2, M.paving, -0.08],
    ].forEach(([r, m, dy]) => {
      const d = new Mesh(kit.track(new CylinderGeometry(r as number, (r as number) + 0.2, 0.3, 48)), m as typeof M.paving)
      d.position.set(pl.x, y + (dy as number), pl.z)
      d.receiveShadow = true
      group.add(d)
    })
    // 大樟树下的一圈石凳
    const cx = -4.5
    const cz = -4.5
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3
      const s = P.box(1.4, 0.45, 0.55, mats.stone, 0, 0, 0)
      const o = new Group()
      o.add(s)
      put(o, cx + Math.cos(a) * 2.6, cz + Math.sin(a) * 2.6, -a + Math.PI / 2, -0.05)
    }
    // 公告牌（以后可以放“最新内容”）
    const nb = new Group()
    nb.add(P.box(0.14, 2.2, 0.14, mats.darkWood, -1.1, 0, 0), P.box(0.14, 2.2, 0.14, mats.darkWood, 1.1, 0, 0))
    nb.add(P.box(2.5, 1.3, 0.12, mats.wood, 0, 0.9, 0))
    nb.add(P.box(0.7, 0.5, 0.02, mats.white, -0.5, 1.4, 0.07, false), P.box(0.6, 0.7, 0.02, M.sheet2, 0.45, 1.2, 0.07, false))
    nb.add(P.gable(2.6, 0.6, 0.35, M.roofRed, mats.wood, 2.2, 0.15, 0.1))
    put(nb, pl.x + 5.5, pl.z - 3.5, face(pl.x + 5.5, pl.z - 3.5, pl.x, pl.z + 4))
    obstacles.push({ x: pl.x + 5.5, z: pl.z - 3.5, r: 1.2 })
    for (const [dx, dz] of [
      [6.5, 3.5],
      [-6.8, 2.5],
    ] as const) {
      const l = P.lamp(3.4)
      put(l.group, pl.x + dx, pl.z + dz, Math.atan2(dx, dz) + Math.PI / 2)
      addBulb(l.group, l.bulb)
    }
  }

  // ======================================================================
  // 试验棚：玻璃温室，里面有植物和工作桌
  // ======================================================================
  {
    const pl = place('lab')
    const plaza = place('plaza')
    const rot = face(pl.x, pl.z, plaza.x, plaza.z)
    const g = new Group()
    const W = 7
    const D = 5
    const H = 2.8
    g.add(P.box(W, 0.6, D, mats.stone, 0, 0, 0))
    const glassBody = P.box(W - 0.1, H - 0.6, D - 0.1, M.glass, 0, 0.6, 0, false)
    g.add(glassBody)
    g.add(P.gable(W - 0.1, D - 0.1, 1.5, M.glass, M.glass, H, 0.05, 0.05))
    // 白色框架
    for (const x of [-W / 2, -W / 6, W / 6, W / 2])
      for (const z of [-D / 2, D / 2]) g.add(P.box(0.1, H, 0.1, mats.white, x, 0, z, false))
    for (const z of [-D / 2, D / 2]) g.add(P.box(W, 0.1, 0.1, mats.white, 0, H - 0.05, z, false))
    g.add(P.box(W, 0.1, 0.1, mats.white, 0, H + 1.45, 0, false))
    for (const x of [-W / 2, 0, W / 2]) {
      for (const s of [1, -1]) {
        const r = P.box(0.08, 0.08, 3.15, mats.white, x, H + 0.72, (s * D) / 4, false)
        r.rotation.x = s * Math.atan2(1.5, D / 2)
        g.add(r)
      }
    }
    // 里面的桌子和植物
    g.add(P.box(5, 0.1, 1.1, mats.wood, 0, 0.95, -1.4, false))
    const plantGeo = kit.track(new IcosahedronGeometry(0.42, 1))
    for (let i = 0; i < 7; i++) {
      const pm = new Mesh(plantGeo, i % 3 === 0 ? M.red : M.leaf)
      pm.position.set(-2.2 + i * 0.75, 1.35, -1.4 + (i % 2) * 0.2)
      pm.scale.setScalar(i % 3 === 0 ? 0.5 : 1)
      g.add(pm)
    }
    g.add(P.door(0, D / 2 + 0.02, 0, 0.6, 1.1, 2.1, M.glass))
    const cx = pl.x - Math.sin(rot) * 3.4
    const cz = pl.z - Math.cos(rot) * 3.4
    put(g, cx, cz, rot)
    obstacles.push({ x: cx, z: cz, r: 3.9 })
    // 门口的水桶和小花盆
    const pot = P.cyl(0.3, 0.22, 0.45, M.roofRed, 0, 0, 0)
    put(pot, cx + Math.sin(rot) * 3.2 + Math.cos(rot) * 1.6, cz + Math.cos(rot) * 3.2 - Math.sin(rot) * 1.6, 0)
    anchors.lab = new Vector3(pl.x, groundAt(pl.x, pl.z) + 3, pl.z)
  }

  // ======================================================================
  // 林间书屋：原木小屋，有门廊、吊灯和一摞书
  // ======================================================================
  {
    const pl = place('notes')
    const rot = face(pl.x, pl.z, -13.4, -1.6) // 朝向木桥方向
    const g = new Group()
    g.add(P.house({ w: 6.2, d: 5, h: 3.3, wall: M.logWall, roof: M.roofGreen, frontWindows: 2, sideWindows: 1, base: mats.stone }))
    // 门廊
    g.add(P.box(6.6, 0.25, 2.2, mats.wood, 0, 0, 3.5))
    for (const x of [-3, 3]) g.add(P.box(0.18, 3.0, 0.18, mats.darkWood, x, 0.25, 4.4))
    const porch = P.box(7, 0.16, 2.6, M.roofGreen, 0, 3.2, 3.6)
    porch.rotation.x = 0.18
    g.add(porch)
    const lantern = P.box(0.3, 0.42, 0.3, bulb, 1.6, 2.5, 4.3, false)
    g.add(lantern)
    // 书堆
    const bookCols = [M.roofRed, M.hullStripe, M.yellow, mats.white, M.roofGreen]
    for (let i = 0; i < 5; i++) {
      const bk = P.box(0.6 - i * 0.03, 0.12, 0.42, bookCols[i]!, -2.2, 0.25 + i * 0.12, 3.6, false)
      bk.rotation.y = (i % 2 ? 0.2 : -0.15)
      g.add(bk)
    }
    const cx = pl.x - Math.sin(rot) * 4.2
    const cz = pl.z - Math.cos(rot) * 4.2
    put(g, cx, cz, rot)
    addBulb(g, [1.6, 2.7, 4.3])
    obstacles.push({ x: cx, z: cz, r: 3.9 })
    anchors.notes = new Vector3(pl.x, groundAt(pl.x, pl.z) + 3, pl.z)
  }

  // ======================================================================
  // 栈桥、灯塔和小船
  // ======================================================================
  {
    const L = PIER.z1 - PIER.z0
    const g = new Group()
    g.add(P.box(PIER.half * 2, 0.22, L, M.plank, 0, -0.22, L / 2))
    for (let z = 0; z <= L; z += 3)
      for (const s of [-1, 1]) {
        g.add(P.cyl(0.16, 0.16, 4.2, mats.darkWood, s * (PIER.half - 0.1), -4, z, 6))
        if (z > 2) g.add(P.box(0.1, 0.9, 0.1, mats.darkWood, s * (PIER.half - 0.1), 0, z, false))
      }
    for (const s of [-1, 1]) g.add(P.box(0.08, 0.08, L - 2.5, mats.white, s * (PIER.half - 0.1), 0.85, L / 2 + 1.25, false))
    // 灯塔
    const lh = new Group()
    lh.add(P.cyl(1.7, 1.9, 0.6, mats.stone, 0, 0, 0, 16))
    lh.add(P.cyl(0.95, 1.2, 5.2, mats.white, 0, 0.6, 0, 14))
    for (const y of [1.6, 3.6]) lh.add(P.cyl(1.08, 1.12, 0.8, M.red, 0, y, 0, 14))
    lh.add(P.cyl(1.25, 1.25, 0.12, M.black, 0, 5.8, 0, 14))
    lh.add(P.cyl(0.6, 0.6, 0.8, bulb, 0, 5.9, 0, 10))
    const cap = new Mesh(kit.track(new ConeGeometry(0.85, 0.8, 12)), M.red)
    cap.position.y = 7.1
    lh.add(cap)
    // 灯塔在西岬的悬崖上（v2），放大一些，远处也看得见
    const lhp = place('lighthouse')
    const lhY = groundAt(lhp.x, lhp.z)
    lh.scale.setScalar(1.7)
    lh.position.set(lhp.x, lhY - 0.1, lhp.z)
    group.add(lh)
    obstacles.push({ x: lhp.x, z: lhp.z, r: 3.4 })
    // 夜里扫过海面的光柱
    const beamGeo = kit.track(new ConeGeometry(3.2, 60, 24, 1, true))
    beamGeo.translate(0, -30, 0)
    beamGeo.rotateZ(Math.PI / 2)
    const beamMesh = new Mesh(beamGeo, beam)
    beamMesh.position.set(lhp.x, lhY + 6.3 * 1.7, lhp.z)
    group.add(beamMesh)
    bulbs.push(new Vector3(lhp.x, lhY + 6.3 * 1.7, lhp.z))
    g.position.set(PIER.x, PIER.y, PIER.z0)
    group.add(g)
    g.updateMatrixWorld(true)
    anims.push((t, _dt, night) => {
      beamMesh.rotation.y = t * 0.6
      const k = Math.max(0, (night - 0.7) / 0.3)
      beam.uniforms.opacity!.value = k * 0.55
      beamMesh.visible = k > 0.01
    })
    const l = P.lamp(3)
    l.group.position.set(PIER.half - 0.2, 0, L - 3)
    g.add(l.group)
    addBulb(l.group, l.bulb)

    // 小船
    const boat = new Group()
    const hullGeo = kit.track(new BoxGeometry(1.5, 0.7, 4, 1, 1, 6))
    const hp = hullGeo.getAttribute('position')
    for (let i = 0; i < hp.count; i++) {
      const z = hp.getZ(i) / 2
      const taper = 1 - z * z * 0.75
      const bottom = hp.getY(i) < 0 ? 0.6 : 1
      hp.setX(i, hp.getX(i) * taper * bottom)
      if (hp.getY(i) > 0) hp.setY(i, hp.getY(i) + z * z * 0.25)
    }
    hullGeo.computeVertexNormals()
    const hull = new Mesh(hullGeo, M.hull)
    hull.castShadow = true
    boat.add(hull, P.box(1.25, 0.06, 3.0, M.hullStripe, 0, 0.36, 0, false), P.box(1.1, 0.1, 0.35, mats.wood, 0, 0.1, 0.4, false))
    boat.position.set(PIER.x + 3.2, 0.15, PIER.z0 + 12)
    boat.rotation.y = 0.15
    group.add(boat)
    anims.push((t) => {
      boat.position.y = 0.15 + Math.sin(t * 1.3) * 0.08
      boat.rotation.z = Math.sin(t * 1.1) * 0.05
      boat.rotation.x = Math.sin(t * 0.9 + 1) * 0.03
    })
    decks.push({
      at: (x, z) => (Math.abs(x - PIER.x) < PIER.half && z > PIER.z0 - 0.5 && z < PIER.z1 ? PIER.y : null),
    })
    anchors.pier = new Vector3(PIER.x, PIER.y + 2.6, place('pier').z)
  }

  // ======================================================================
  // 小溪上的木拱桥
  // ======================================================================
  for (const BRIDGE of FOOT_BRIDGES) {
    // 桥沿河道法线方向
    let bi = 0
    let best = Infinity
    RIVER.forEach((p, i) => {
      const d = (p[0] - BRIDGE[0]) ** 2 + (p[1] - BRIDGE[1]) ** 2
      if (d < best) {
        best = d
        bi = i
      }
    })
    // 桥身沿着从桥上过的那条路的方向（小路正好从桥面中间穿过，不会撞到栏杆）
    let ang = 0
    {
      let bd = Infinity
      for (const path of PATHS)
        for (let i = 1; i < path.length; i++) {
          const p = path[i]!
          const d = (p[0] - BRIDGE[0]) ** 2 + (p[1] - BRIDGE[1]) ** 2
          if (d < bd) {
            bd = d
            const q0 = path[Math.max(0, i - 3)]!
            const q1 = path[Math.min(path.length - 1, i + 3)]!
            ang = Math.atan2(q1[1] - q0[1], q1[0] - q0[0])
          }
        }
    }
    void bi
    const SPAN = 11
    const W = 1.3
    const y0 = Math.max(groundAt(BRIDGE[0] + Math.cos(ang) * 5.5, BRIDGE[1] + Math.sin(ang) * 5.5), groundAt(BRIDGE[0] - Math.cos(ang) * 5.5, BRIDGE[1] - Math.sin(ang) * 5.5))
    const arch = (u: number) => y0 + 0.9 * Math.cos((u / SPAN) * Math.PI) - 0.15
    const g = new Group()
    const n = 14
    for (let i = 0; i < n; i++) {
      const u0 = -SPAN / 2 + (i * SPAN) / n
      const u1 = u0 + SPAN / n
      const yA = arch(u0)
      const yB = arch(u1)
      const plank = P.box(SPAN / n + 0.05, 0.18, W * 2, M.plank, 0, 0, 0)
      plank.position.set((u0 + u1) / 2, (yA + yB) / 2 - 0.09, 0)
      plank.rotation.z = Math.atan2(yB - yA, SPAN / n)
      g.add(plank)
      for (const s of [-1, 1]) {
        const rail = P.box(SPAN / n + 0.05, 0.1, 0.1, M.roofRed, 0, 0, 0, false)
        rail.position.set((u0 + u1) / 2, (yA + yB) / 2 + 0.85, s * (W - 0.05))
        rail.rotation.z = plank.rotation.z
        g.add(rail)
        if (i % 2 === 0) g.add(P.box(0.12, 0.95, 0.12, M.roofRed, u0, yA - 0.05, s * (W - 0.05), false))
      }
    }
    g.position.set(BRIDGE[0], 0, BRIDGE[1])
    g.rotation.y = -ang
    group.add(g)
    const o: V2 = [BRIDGE[0], BRIDGE[1]]
    decks.push({
      at: (x, z) => {
        const [u, v] = worldToFrame(o, ang, x, z)
        return Math.abs(u) < SPAN / 2 && Math.abs(v) < W ? arch(u) : null
      },
    })
  }

  // ======================================================================
  // 小路边的路灯
  // ======================================================================
  {
    // 路灯很多，放进一个组最后合并（夜里亮灯是改材质颜色，合并后照样亮）
    const lampGroup = new Group()
    group.add(lampGroup)
    const used: V2[] = []
    for (const path of PATHS) {
      let acc = 0
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!
        const b = path[i]!
        acc += Math.hypot(b[0] - a[0], b[1] - a[1])
        if (acc < 11) continue
        acc = 0
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
        const x = b[0] - Math.sin(ang) * 1.9
        const z = b[1] + Math.cos(ang) * 1.9
        if (used.some((u) => Math.hypot(u[0] - x, u[1] - z) < 7)) continue
        if (PLACES.some((p) => Math.hypot(p.x - x, p.z - z) < Math.max(p.pad, 4))) continue
        // 不放在铁轨旁边（会被列车撞到）、溪里、房子和站台上
        const rn = railNear(x, z, 5)
        if (rn && rn.d < 4.2) continue
        if (distTo(x, z, RIVER, 4) < 3.2) continue
        const ln = lotNear(x, z)
        if (ln && ln.d < 0.8) continue
        if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 1) || decks.some((d) => d.at(x, z) !== null)) continue
        used.push([x, z])
        const l = P.lamp(3.2)
        put(l.group, x, z, -ang)
        lampGroup.add(l.group)
        addBulb(l.group, l.bulb)
        obstacles.push({ x, z, r: 0.22 })
      }
    }
    mergeStatic(lampGroup, kit.track)
  }

  return {
    group,
    obstacles,
    decks,
    bulbs,
    anchors,
    mats: { ...mats, vend },
    update(t, dt, night) {
      for (const a of anims) a(t, dt, night)
    },
    setSnow(k) {
      for (const r of roofs) r.m.color.copy(r.base).lerp(snowWhite, k * 0.85)
    },
  }
}
