/**
 * kavian.day 的世界：一座海岛上的小镇。
 * 岛的南边是海湾、沙滩和海边站；北半边是会下雪的山，溪水从山里流下来穿过树林和草地入海。
 * 环岛铁路绕岛一圈，岛外是珊瑚礁和深海。岛上的动物、海里的生物按时段、季节、天气出没。
 * 车站是入口，广场的大樟树是中心，几处地点散在岛上，对应网站的各个栏目。
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Box3,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Points,
  PointsMaterial,
  Ray,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Timer,
  Vector3,
  WebGLRenderer,
} from 'three'
import { AnimationMixer, LoopRepeat, type AnimationAction, type Material, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createBodies, type Body } from './bodies'
import { createBuildings } from './buildings'
import { createLandmarks } from './landmarks'
import { createTown } from './town'
import { createCameraRig, type ViewMode } from './camera'
import type { EcoState } from './eco'
import { createEcology } from './ecology'
import { createSeaLife } from './sealife'
import { createKit, type Season } from './kit'
import { PATHS, PIER, PLACES, RAIL_Y, RIVER, WALK, distTo, forestDensity, pathDist, place, railNear, riverNear, shore } from './layout'
import { createNature } from './nature'
import { ambientIntensity, blend, sunElevation, sunIntensity, type Weights } from './palette'
import { createPost } from './post'
import { createRail } from './rail'
import { createSky } from './sky'
import { createTerrain } from './terrain'
import { LAYER_NO_REFLECT, createWater } from './water'

export type { ViewMode }

export type WeatherId = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'storm' | 'thunder' | 'snow'

export interface WorldEnvironment {
  weights: Weights
  /** 窗光强度 0–1，来自当前时段。 */
  windows: number
  /** 星星可见度 0–1，来自当前时段。 */
  stars: number
  weather: WeatherId
  season: Season
}

export interface PlacePrompt {
  id: string
  /** 地点标签在屏幕上的位置（CSS 像素）。 */
  x: number
  y: number
}

export interface WorldOptions {
  canvas: HTMLCanvasElement
  quality?: 'high' | 'low'
  onError?: (message: string) => void
  onProgress?: (stage: string, progress: number) => void
  signal?: AbortSignal
  /** 角色靠近或离开可互动地点时调用（每次进出只调一次）。 */
  onPrompt?: (prompt: PlacePrompt | null) => void
  /** 提示还在，但它在屏幕上的位置变了（镜头或角色在动）。每帧最多一次，位置不变时不调。 */
  onPromptMove?: (x: number, y: number) => void
  /** 访客在地点旁按 E 时调用。 */
  onInteract?: (placeId: string) => void
  /** 宠物模型（GLB，带 idle / walk / run / sit 动画）。加载失败时保留灰模。 */
  petUrl?: string
  /** 视角切换时调用（V 键或 setView） */
  onViewChange?: (mode: ViewMode) => void
}

export interface WorldHandle {
  setEnvironment: (env: WorldEnvironment) => void
  /** 阅读面板、输入框打开时关闭角色输入。 */
  setInputEnabled: (enabled: boolean) => void
  /** 把镜头复位到默认的上帝视角。 */
  resetCamera: () => void
  /** 切换上帝视角 / 角色视角 */
  setView: (mode: ViewMode) => void
  dispose: () => void
}

interface Place {
  id: string
  position: Vector3
  radius: number
}

const WEATHER_LIGHT: Record<WeatherId, number> = {
  clear: 1,
  partly: 0.95,
  cloudy: 0.8,
  fog: 0.8,
  rain: 0.5,
  storm: 0.35,
  thunder: 0.32,
  snow: 0.85,
}
const CLOUD_COVER: Record<WeatherId, number> = {
  clear: 0.12,
  partly: 0.42,
  cloudy: 0.78,
  fog: 0.6,
  rain: 0.95,
  storm: 1,
  thunder: 1,
  snow: 0.9,
}
const WEATHER_WIND: Record<WeatherId, number> = {
  clear: 0.8,
  partly: 1,
  cloudy: 1.1,
  fog: 0.5,
  rain: 1.4,
  storm: 2,
  thunder: 1.8,
  snow: 0.7,
}

export async function createWorld(options: WorldOptions): Promise<WorldHandle> {
  const { canvas } = options
  const compatibility = new URLSearchParams(location.search).has('compatible') || (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent))
  const high = options.quality !== 'low' && !compatibility

  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 1.5 : 1))
  renderer.setClearColor('#387f99', 1)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.shadowMap.enabled = high
  renderer.shadowMap.type = PCFShadowMap

  const kit = createKit(high)
  const { track } = kit
  const checkpoint = async (stage: string, progress: number) => {
    options.onProgress?.(stage, progress)
    // Yield between real construction stages, so the loading scene can paint.
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    if (options.signal?.aborted) {
      kit.disposeAll()
      renderer.dispose()
      throw new DOMException('World initialization cancelled', 'AbortError')
    }
  }
  await checkpoint('terrain', 12)
  const scene = new Scene()
  scene.fog = new Fog(0xdceff6, 70, 260)
  const camera = new PerspectiveCamera(38, 1, 0.3, 1600)
  camera.layers.enable(LAYER_NO_REFLECT)
  let disposed = false

  // ---------- 世界内容
  const perf = (label: string, t0: number) => console.info(`[perf] ${label} ${(performance.now() - t0).toFixed(0)}ms`)
  let pt = performance.now()
  const terrain = createTerrain(kit, forestDensity)
  perf('terrain', pt)
  await checkpoint('coast', 28)
  scene.add(terrain.mesh)
  const water = createWater(kit, terrain.heightTex, terrain.heightBounds)
  scene.add(water.sea, water.river, water.mist)
  // 房子先建，树和草要避开房子、站台、栈桥
  pt = performance.now()
  const buildings = createBuildings(kit, terrain.groundAt)
  perf('buildings', pt)
  scene.add(buildings.group)
  const landmarks = createLandmarks(kit, terrain.groundAt, buildings.mats)
  buildings.group.add(landmarks.group)
  buildings.obstacles.push(...landmarks.obstacles)
  buildings.decks.push(...landmarks.decks)
  const decks = buildings.decks
  const builtUp = (x: number, z: number, margin: number) => {
    for (const o of buildings.obstacles) if ((x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + margin) ** 2) return true
    for (const d of decks) if (d.at(x, z) !== null || d.at(x + margin, z) !== null || d.at(x - margin, z) !== null || d.at(x, z + margin) !== null || d.at(x, z - margin) !== null) return true
    return false
  }
  // 坡地小镇：在铁路、树之前建，电线杆和树都要让开房子
  pt = performance.now()
  await checkpoint('town', 42)
  const town = createTown(kit, terrain.groundAt, buildings.mats, builtUp)
  perf('town', pt)
  scene.add(town.group)
  buildings.obstacles.push(...town.obstacles)
  decks.push(...town.decks)
  // 铁路（含电线）在树之前建：树冠要避开列车开过的空间和电线
  pt = performance.now()
  const rail = createRail(kit, terrain.groundAt, buildings.mats, builtUp)
  perf('rail', pt)
  scene.add(rail.group)

  // 房子的包围盒：种树时树冠要避开，角色视角的镜头也用它来避让
  const camBoxes: Box3[] = []
  buildings.group.updateMatrixWorld(true)
  buildings.group.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh || (m.material as Material).transparent || m.userData.merged) return
    const b = new Box3().setFromObject(m)
    const sz = b.getSize(new Vector3())
    if (Math.max(sz.x, sz.z) < 0.5 || sz.y < 0.3) return
    camBoxes.push(b)
  })
  camBoxes.push(...town.boxes)

  // 净空：铁轨两边各 1.95 米（车厢半宽 1.25，留 0.7 余量）往上整个是空的——列车不会钻进树冠，
  // 从上面看也不会有树叶盖在铁轨上；电线周围 0.7 米；房子外扩 0.35 米
  const clearance = (() => {
    const CAR_W = 1.95
    const WIRE_R = 0.7
    const wirePts: number[] = []
    const w = rail.wires
    for (let i = 0; i < w.length; i += 6) {
      const n = Math.max(1, Math.ceil(Math.hypot(w[i + 3]! - w[i]!, w[i + 5]! - w[i + 2]!) / 0.8))
      for (let k = 0; k <= n; k++) {
        const t = k / n
        wirePts.push(w[i]! + (w[i + 3]! - w[i]!) * t, w[i + 1]! + (w[i + 4]! - w[i + 1]!) * t, w[i + 2]! + (w[i + 5]! - w[i + 2]!) * t)
      }
    }
    const cell = (x: number, z: number) => Math.floor(x / 4) * 1000 + Math.floor(z / 4)
    const wireGrid = new Map<number, number[]>()
    for (let i = 0; i < wirePts.length; i += 3) {
      const k = cell(wirePts[i]!, wirePts[i + 2]!)
      if (!wireGrid.has(k)) wireGrid.set(k, [])
      wireGrid.get(k)!.push(i)
    }
    const wireNear = (x: number, z: number, r: number, y?: number) => {
      const c = Math.ceil(r / 4)
      const cx = Math.floor(x / 4)
      const cz = Math.floor(z / 4)
      for (let i = -c; i <= c; i++)
        for (let j = -c; j <= c; j++)
          for (const idx of wireGrid.get((cx + i) * 1000 + cz + j) ?? []) {
            if (Math.hypot(wirePts[idx]! - x, wirePts[idx + 2]! - z) > r) continue
            if (y === undefined || Math.abs(wirePts[idx + 1]! - y) < WIRE_R) return true
          }
      return false
    }
    const boxes = camBoxes.map((b) => b.clone().expandByScalar(0.35))
    const p = new Vector3()
    // 房子包围盒按 8 米一格分桶，逐点检查时只看所在的格子
    const BC = 8
    const boxGrid = new Map<number, Box3[]>()
    for (const b of boxes)
      for (let i = Math.floor(b.min.x / BC); i <= Math.floor(b.max.x / BC); i++)
        for (let j = Math.floor(b.min.z / BC); j <= Math.floor(b.max.z / BC); j++) {
          const k = i * 4096 + j
          if (!boxGrid.has(k)) boxGrid.set(k, [])
          boxGrid.get(k)!.push(b)
        }
    // 一棵树逐点检查时，铁路、电线杆的判断结果可以按树缓存
    let near: { rail: boolean; poles: [number, number][] } = { rail: false, poles: [] }
    return {
      near(x: number, z: number, r: number) {
        const rn = railNear(x, z, r + CAR_W)
        const railHit = !!(rn && rn.tunnel < 0.5)
        const poles = rail.poles.filter(([px, pz]) => (x - px) ** 2 + (z - pz) ** 2 < (r + 1) ** 2)
        near = { rail: railHit, poles }
        if (railHit || poles.length) return true
        if (wireNear(x, z, r + WIRE_R)) return true
        for (let i = Math.floor((x - r) / BC); i <= Math.floor((x + r) / BC); i++)
          for (let j = Math.floor((z - r) / BC); j <= Math.floor((z + r) / BC); j++)
            for (const b of boxGrid.get(i * 4096 + j) ?? []) if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return true
        return false
      },
      at(x: number, y: number, z: number) {
        for (const [px, pz] of near.poles) if ((x - px) ** 2 + (z - pz) ** 2 < 0.6 * 0.6) return true
        if (near.rail && y > RAIL_Y - 0.3) {
          const rn = railNear(x, z, CAR_W)
          if (rn && rn.tunnel < 0.5) return true
        }
        if (wireNear(x, z, WIRE_R, y)) return true
        p.set(x, y, z)
        for (const b of boxGrid.get(Math.floor(x / BC) * 4096 + Math.floor(z / BC)) ?? []) if (b.containsPoint(p)) return true
        return false
      },
    }
  })()
  pt = performance.now()
  await checkpoint('nature', 60)
  const nature = createNature(kit, terrain.groundAt, terrain.colorAt, builtUp, clearance)
  perf('nature', pt)
  scene.add(nature.group)
  const sky = createSky(kit)
  scene.add(sky.group, sky.dome)
  pt = performance.now()
  const sealife = createSeaLife(kit, terrain.groundAt)
  perf('sealife', pt)
  scene.add(sealife.group)
  await checkpoint('life', 76)
  const post = compatibility ? {
    setSize: (_w: number, _h: number) => {},
    setGrade: (_grade: Color, _lines: number, _saturation: number) => {},
    setMood: (_o: { cloudShadow: number; bloom: number; shadowTint: Color }) => {},
    render: (s: Scene, c: PerspectiveCamera) => { renderer.setRenderTarget(null); renderer.render(s, c) },
  } : createPost(kit, renderer)

  // 小物件（灯杆、站牌、长椅、栏杆、电线杆、道口……）自动生成碰撞圆：
  // 贴着地面（或栈桥、站台）、有一定高度、占地不大的网格，沿长边排一串小圆
  const propObstacles: { x: number; z: number; r: number }[] = []
  const surfaceNoProps = (x: number, z: number) => {
    let y = terrain.groundAt(x, z)
    for (const d of decks) {
      const h = d.at(x, z)
      if (h !== null) y = Math.max(y, h)
    }
    return y
  }
  const collectProps = (root: Object3D, skip: Object3D[] = []) => {
    root.updateMatrixWorld(true)
    const box = new Box3()
    const size = new Vector3()
    const c = new Vector3()
    const visit = (o: Object3D) => {
      if (skip.includes(o)) return
      const m = o as Mesh
      if (m.isMesh && !m.userData.merged && !(m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh && !(m.material as Material).transparent) {
        box.setFromObject(m)
        box.getSize(size)
        box.getCenter(c)
        const foot = Math.max(size.x, size.z)
        const ground = surfaceNoProps(c.x, c.z)
        if (foot < 4 && size.y > 0.42 && box.min.y < ground + 0.7 && box.max.y > ground + 0.42) {
          const long = size.x >= size.z ? 'x' : 'z'
          const short = Math.min(size.x, size.z)
          const r = Math.max(0.15, short / 2)
          const n = Math.max(1, Math.ceil(foot / (r * 2)))
          for (let i = 0; i < n; i++) {
            const k = n === 1 ? 0.5 : i / (n - 1)
            const x = long === 'x' ? box.min.x + r + (size.x - 2 * r) * k : c.x
            const z = long === 'z' ? box.min.z + r + (size.z - 2 * r) * k : c.z
            propObstacles.push({ x, z, r })
          }
        }
      }
      for (const ch of o.children) visit(ch)
    }
    visit(root)
  }
  collectProps(buildings.group)
  collectProps(rail.group, rail.cars)

  // 静态障碍（树干、石头、房子、小物件）放进 4 米一格的网格，查询只看附近几格
  const obstacles = [...nature.obstacles, ...buildings.obstacles, ...propObstacles, ...rail.poles.map(([x, z]) => ({ x, z, r: 0.25 }))]
  const CELL = 4
  const grid = new Map<number, typeof obstacles>()
  const key = (i: number, j: number) => i * 4096 + j
  for (const o of obstacles) {
    const i0 = Math.floor((o.x - o.r) / CELL)
    const i1 = Math.floor((o.x + o.r) / CELL)
    const j0 = Math.floor((o.z - o.r) / CELL)
    const j1 = Math.floor((o.z + o.r) / CELL)
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j)
        if (!grid.has(k)) grid.set(k, [])
        grid.get(k)!.push(o)
      }
  }
  /** (x, z) 处半径 r 的圆会不会碰到树干、石头、房子 */
  const solid = (x: number, z: number, r: number) => {
    const i0 = Math.floor((x - r - 1) / CELL)
    const i1 = Math.floor((x + r + 1) / CELL)
    const j0 = Math.floor((z - r - 1) / CELL)
    const j1 = Math.floor((z + r + 1) / CELL)
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const list = grid.get(key(i, j))
        if (!list) continue
        for (const o of list) if ((x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + r) ** 2) return true
      }
    return false
  }

  await checkpoint('light', 88)
  // 会走动的身体：角色、狗和动物，统一做碰撞分离
  const bodies = createBodies()
  pt = performance.now()
  const ecology = createEcology(kit, terrain.groundAt, nature.treeTops, buildings.bulbs, bodies, solid)
  perf('ecology', pt)
  scene.add(ecology.group)
  const surfaceAt = (x: number, z: number) => {
    let y = terrain.groundAt(x, z)
    for (const d of decks) {
      const h = d.at(x, z)
      if (h !== null) y = Math.max(y, h)
    }
    return y
  }
  const walkable = (x: number, z: number) => {
    if (z < WALK.minZ) return false
    const onDeck = decks.some((d) => d.at(x, z) !== null)
    if (!onDeck) {
      if (terrain.groundAt(x, z) < 0.08) return false // 可以走到湿沙滩上
      if (distTo(x, z, RIVER, 3) < 2.4) return false
    }
    return !solid(x, z, 0.4)
  }

  // ---------- 光
  const sun = new DirectionalLight(0xffffff, 2.5)
  sun.castShadow = high
  sun.shadow.mapSize.set(4096, 4096)
  const sc = sun.shadow.camera
  sc.left = -48
  sc.right = 48
  sc.top = 48
  sc.bottom = -48
  sc.near = 1
  sc.far = 260
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.04
  sun.shadow.radius = 3
  scene.add(sun, sun.target)
  const hemi = new HemisphereLight(0xffffff, 0x6a7a5a, 1)
  scene.add(hemi)
  const lamps = (['station', 'plaza', 'home', 'notes'] as const).map((id) => {
    const p = place(id)
    const l = new PointLight(0xffc062, 0, 16, 1.6)
    l.position.set(p.x, terrain.groundAt(p.x, p.z) + 3.2, p.z)
    scene.add(l)
    return l
  })

  // 灯泡的光晕
  const glowGeo = track(new BufferGeometry())
  glowGeo.setAttribute('position', new BufferAttribute(new Float32Array([...buildings.bulbs, ...rail.bulbs].flatMap((v) => [v.x, v.y, v.z])), 3))
  const glowMat = track(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { color: { value: new Color('#FFC873') }, opacity: { value: 0 }, scale: { value: 500 } },
      vertexShader: /* glsl */ `uniform float scale; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 2.6 * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform vec3 color; uniform float opacity; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.2); gl_FragColor = vec4(color * a * opacity, 1.0); }`,
    }),
  )
  const glows = new Points(glowGeo, glowMat)
  glows.frustumCulled = false
  scene.add(glows)

  // ---------- 角色（灰模占位）与狗
  const toon = (c: string) => kit.toon(c)
  const start = place('station')
  const player = new Group()
  const torso = new Mesh(track(new CapsuleGeometry(0.42, 0.9, 6, 12)), toon('#FBFAF7'))
  torso.position.y = 0.95
  const legs = new Mesh(track(new CapsuleGeometry(0.36, 0.3, 4, 10)), toon('#7FB8E0'))
  legs.position.y = 0.55
  const head = new Mesh(track(new SphereGeometry(0.38, 20, 16)), toon('#F6D2B5'))
  head.position.y = 1.85
  const hair = new Mesh(track(new SphereGeometry(0.4, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2)), toon('#2E2626'))
  hair.position.y = 1.9
  const nose = new Mesh(track(new SphereGeometry(0.08, 8, 8)), toon('#F6D2B5'))
  nose.position.set(0, 1.83, 0.37)
  for (const m of [torso, legs, head, hair]) m.castShadow = true
  player.add(torso, legs, head, hair, nose)
  player.position.set(start.x + 2.6, 0, start.z + 0.8)
  player.position.y = surfaceAt(player.position.x, player.position.z)
  player.rotation.y = Math.PI
  scene.add(player)

  const dog = new Group()
  const dogTorso = new Mesh(track(new CapsuleGeometry(0.28, 0.6, 4, 10)), toon('#E9A25A'))
  dogTorso.rotation.x = Math.PI / 2
  dogTorso.position.y = 0.45
  const dogHead = new Mesh(track(new SphereGeometry(0.26, 14, 12)), toon('#E9A25A'))
  dogHead.position.set(0, 0.75, 0.45)
  dogTorso.castShadow = dogHead.castShadow = true
  dog.add(dogTorso, dogHead)
  dog.position.set(player.position.x + 1.4, 0, player.position.z + 1.2)
  dog.position.y = surfaceAt(dog.position.x, dog.position.z)
  scene.add(dog)

  // 宠物模型：GLB 单位是米（柴犬肩高 0.39），按占位角色身高换算到场景比例。
  const PET_SCALE = 2.25 / 1.72
  let petMixer: AnimationMixer | null = null
  const petActions: Record<string, AnimationAction> = {}
  let petState = ''
  let stillFor = 0
  function playPet(name: string) {
    if (name === petState || !petActions[name]) return
    const next = petActions[name]!
    next.reset().setLoop(LoopRepeat, Infinity).fadeIn(0.25).play()
    if (petState && petActions[petState]) petActions[petState]!.fadeOut(0.25)
    petState = name
  }
  if (options.petUrl) {
    new GLTFLoader().load(
      options.petUrl,
      (gltf) => {
        if (disposed) return
        const model = gltf.scene
        model.scale.setScalar(PET_SCALE)
        model.traverse((o: Object3D) => {
          const m = o as Mesh
          if (!m.isMesh) return
          const src = m.material as Material & { color?: Color }
          const hasVC = !!m.geometry.getAttribute('color')
          m.material = kit.toon(hasVC ? 0xffffff : (src.color ?? new Color(0xffffff)), { vertexColors: hasVC })
          src.dispose()
          track(m.geometry)
          m.castShadow = true
        })
        dog.remove(dogTorso, dogHead)
        dog.add(model)
        petMixer = new AnimationMixer(model)
        for (const clip of gltf.animations) petActions[clip.name] = petMixer.clipAction(clip)
        playPet('idle')
      },
      undefined,
      () => {
        /* 保留灰模 */
      },
    )
  }

  // ---------- 身体（碰撞用）和狗的行为
  const playerBody = bodies.add({ kind: 'player', x: player.position.x, z: player.position.z, r: 0.45, mass: 60 })
  const dogBody = bodies.add({ kind: 'dog', x: dog.position.x, z: dog.position.z, r: 0.42, mass: 6 })
  const dogWalkable = (x: number, z: number) => {
    const onDeck = decks.some((d) => d.at(x, z) !== null)
    if (!onDeck) {
      if (terrain.groundAt(x, z) < 0.05) return false
      if (distTo(x, z, RIVER, 3) < 2.3) return false
    }
    return !solid(x, z, 0.35)
  }
  const blockedFor = (b: Body, x: number, z: number) => {
    switch (b.kind) {
      case 'player':
        return !walkable(x, z)
      case 'dog':
        return !dogWalkable(x, z)
      case 'deer':
      case 'rabbit': {
        if (shore(x, z) < 10) return true
        const rv = riverNear(x, z, 3.5)
        return (!!rv && rv.d < 3) || solid(x, z, b.r)
      }
      case 'crab': {
        const sh = shore(x, z)
        return sh < -1.5 || sh > 7 || solid(x, z, b.r)
      }
      default:
        return solid(x, z, b.r)
    }
  }

  /**
   * 狗：平时跟在身后。角色停下来时，狗会对附近的小动物感兴趣：
   * - 螃蟹、青蛙、兔子：追过去；它们钻进沙里、跳进溪里或跑远了，就在原地闻一闻再回来
   * - 鹿：不靠近，站着盯着看，偶尔蹦一下（像在叫）
   * - 小动物突然贴到身上：吓一跳往后蹦，然后盯着它
   * 角色一走远，狗就放下这些跟上来。
   */
  type DogState = 'follow' | 'chase' | 'sniff' | 'watch' | 'startle'
  let dogState: DogState = 'follow'
  let dogTimer = 0
  let dogTarget: Body | null = null
  let dogHopY = 0
  let dogHopT = 0
  let dogCooldown = 0
  const dogSpot = new Vector3()
  const dogAway = new Vector3()
  const dogStep = (dx: number, dz: number, dist: number) => {
    const base = Math.atan2(dx, dz)
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
      const a = base + off
      const x = dogBody.x + Math.sin(a) * dist
      const z = dogBody.z + Math.cos(a) * dist
      if (dogWalkable(x, z)) {
        dogBody.x = x
        dogBody.z = z
        return a
      }
    }
    return null
  }
  const faceDog = (x: number, z: number, dt: number, rate = 10) => {
    let da = Math.atan2(x - dogBody.x, z - dogBody.z) - dog.rotation.y
    da = Math.atan2(Math.sin(da), Math.cos(da))
    dog.rotation.y += da * Math.min(1, dt * rate)
  }
  const isCritter = (b: Body) => b.kind === 'crab' || b.kind === 'frog' || b.kind === 'rabbit' || b.kind === 'deer'
  let dogStuck = 0
  let trainScare = 0
  function updateDog(dt: number, t: number, playerMoving: boolean) {
    const toPlayer = Math.hypot(playerBody.x - dogBody.x, playerBody.z - dogBody.z)
    // 列车开过身边：吓一跳往旁边蹦（之后一小会儿不再重复）
    trainScare -= dt
    if (dogState !== 'startle' && trainScare <= 0) {
      for (const c of rail.carBoxes()) {
        const ca = Math.cos(c.ang)
        const sa = Math.sin(c.ang)
        const dx = dogBody.x - c.x
        const dz = dogBody.z - c.z
        const u = ca * dx + sa * dz
        const v = -sa * dx + ca * dz
        if (Math.abs(u) < c.hl + 1.5 && Math.abs(v) < c.hw + 1.6) {
          dogState = 'startle'
          dogTarget = null
          dogAway.set(-sa * Math.sign(v || 1), 0, ca * Math.sign(v || 1))
          dogHopT = 0
          trainScare = 2.5
          break
        }
      }
    }
    const near = bodies.nearest(dogBody.x, dogBody.z, 12, isCritter)
    dogCooldown -= dt
    dogTimer -= dt
    // 小动物突然贴到身上：吓一跳
    if (dogState !== 'startle' && near && near.dist < 0.55 && near.body.kind !== 'deer') {
      dogState = 'startle'
      dogTarget = near.body
      dogAway.set(dogBody.x - near.body.x, 0, dogBody.z - near.body.z).normalize()
      dogHopT = 0
    }
    // 角色停下来了，狗开始对周围感兴趣
    if (dogState === 'follow' && near && !playerMoving && stillFor > 1 && toPlayer < 9 && dogCooldown <= 0) {
      if (near.body.kind === 'deer') {
        if (near.dist < 12) {
          dogState = 'watch'
          dogTimer = 4
          dogTarget = near.body
        }
      } else if (near.dist < 8) {
        dogState = 'chase'
        dogTimer = 3
        dogTarget = near.body
      }
    }
    // 角色走远了：什么都放下，跟上
    if (dogState !== 'startle' && dogState !== 'follow' && (toPlayer > 12 || (playerMoving && toPlayer > 4))) {
      dogState = 'follow'
      dogCooldown = 3
    }
    dogHopY = 0
    let anim = 'idle'
    if (dogState === 'startle') {
      dogHopT = Math.min(1, dogHopT + dt / 0.5)
      dogStep(dogAway.x, dogAway.z, dt * 3.2 * (1 - dogHopT))
      dogHopY = Math.sin(dogHopT * Math.PI) * 0.45
      if (dogTarget) faceDog(dogTarget.x, dogTarget.z, dt, 14)
      if (dogHopT >= 1) {
        dogState = 'watch'
        dogTimer = 2
      }
    } else if (dogState === 'chase' && dogTarget) {
      if (!dogTarget.active) {
        // 钻进沙里 / 跳进水里了：去那里闻一闻
        dogState = 'sniff'
        dogSpot.set(dogTarget.x, 0, dogTarget.z)
        dogTimer = 2.5
      } else {
        const dx = dogTarget.x - dogBody.x
        const dz = dogTarget.z - dogBody.z
        const d = Math.hypot(dx, dz)
        if (dogTimer <= 0) {
          dogState = 'follow'
          dogCooldown = 4
        } else if (d > 1.1) {
          const a = dogStep(dx / d, dz / d, Math.min(d - 1.1, 6.5 * dt))
          if (a !== null) dog.rotation.y = a
          else dogState = 'watch' // 追到水边过不去了，就站着看
          anim = 'run'
        } else faceDog(dogTarget.x, dogTarget.z, dt)
      }
    } else if (dogState === 'sniff') {
      const dx = dogSpot.x - dogBody.x
      const dz = dogSpot.z - dogBody.z
      const d = Math.hypot(dx, dz)
      if (d > 0.9 && dogStep(dx / d, dz / d, Math.min(d - 0.9, 2.5 * dt)) !== null) anim = 'walk'
      else {
        faceDog(dogSpot.x, dogSpot.z, dt)
        dogHopY = -Math.max(0, Math.sin(t * 9)) * 0.04 // 低头闻
      }
      if (dogTimer <= 0) {
        dogState = 'follow'
        dogCooldown = 5
      }
    } else if (dogState === 'watch') {
      if (dogTarget && dogTarget.active) faceDog(dogTarget.x, dogTarget.z, dt, 6)
      // 偶尔蹦一下，像在叫
      const c = t % 1.6
      dogHopY = c < 0.25 ? Math.sin((c / 0.25) * Math.PI) * 0.12 : 0
      if (dogTimer <= 0 || !dogTarget?.active) {
        dogState = 'follow'
        dogCooldown = 5
      }
    }
    if (dogState === 'follow') {
      behind.set(0.9, 0, -1.6).applyAxisAngle(up, player.rotation.y)
      const tx = playerBody.x + behind.x
      const tz = playerBody.z + behind.z
      const gap = Math.hypot(tx - dogBody.x, tz - dogBody.z)
      if (gap > 0.4) {
        const fast = gap > 4
        const stepLen = Math.min(gap, (fast ? 8 : 3.8) * dt)
        const a = dogStep((tx - dogBody.x) / gap, (tz - dogBody.z) / gap, stepLen)
        if (a !== null) {
          dog.rotation.y = a
          dogStuck = 0
        } else if ((dogStuck += dt) > 1.5 && gap > 6) {
          // 卡住太久就绕到角色身边（不会卡在树后面不动）
          dogBody.x = playerBody.x - Math.sin(player.rotation.y) * 1.4
          dogBody.z = playerBody.z - Math.cos(player.rotation.y) * 1.4
          dogStuck = 0
        }
        anim = fast ? 'run' : 'walk'
      } else {
        // 看着角色的方向等着；等久了就坐下
        faceDog(playerBody.x + Math.sin(player.rotation.y) * 3, playerBody.z + Math.cos(player.rotation.y) * 3, dt, 3)
        anim = stillFor > 2.5 ? 'sit' : 'idle'
      }
    }
    playPet(anim)
  }

  // ---------- 镜头避让：镜头和看着的点之间被房子、列车、树冠、山挡住，就把镜头拉到挡住的东西前面
  const ray = new Ray()
  const hit = new Vector3()
  const carBox = new Box3()
  let camDist = Infinity
  function keepCameraClear(dt: number, full: boolean) {
    // Map panning must never use the shoulder-camera collision spring.
    // Its focus height lags terrain, so the ray can start underground and collapse to 1.2 m.
    if (!full) {
      camDist = Infinity
      player.visible = true
      return
    }
    const fx = rig.focus.x
    const fy = rig.focus.y
    const fz = rig.focus.z
    const dx = camera.position.x - fx
    const dy = camera.position.y - fy
    const dz = camera.position.z - fz
    const len = Math.hypot(dx, dy, dz)
    if (len < 0.01) return
    ray.origin.set(fx, fy, fz)
    ray.direction.set(dx / len, dy / len, dz / len)
    let tMin = len
    const test = (b: Box3) => {
      if (b.containsPoint(ray.origin) || b.distanceToPoint(ray.origin) > tMin) return
      if (ray.intersectBox(b, hit)) tMin = Math.min(tMin, hit.distanceTo(ray.origin))
    }
    if (full) for (const b of camBoxes) test(b)
    if (full) for (const c of rail.cars) if (c.visible) test(carBox.setFromObject(c))
    if (full) for (const c of nature.crowns) {
      if (Math.abs(c.x - fx) > len + c.r || Math.abs(c.z - fz) > len + c.r) continue
      const ox = fx - c.x
      const oy = fy - c.y
      const oz = fz - c.z
      const b = ox * ray.direction.x + oy * ray.direction.y + oz * ray.direction.z
      const cc = ox * ox + oy * oy + oz * oz - c.r * c.r
      const disc = b * b - cc
      if (disc < 0) continue
      const t0 = -b - Math.sqrt(disc)
      if (t0 > 0.05) tMin = Math.min(tMin, t0)
      else if (cc < 0) tMin = Math.min(tMin, rig.mode === 'follow' ? 3 : tMin) // 站在树冠下：镜头贴近
    }
    // 山和坡
    for (let i = 1; i <= 12; i++) {
      const k = (i / 12) * tMin
      const x = fx + ray.direction.x * k
      const y = fy + ray.direction.y * k
      const z = fz + ray.direction.z * k
      if (terrain.groundAt(x, z) + 0.5 > y) {
        tMin = Math.max(0.5, k - tMin / 12)
        break
      }
    }
    // 拉近要快，拉远要慢一点，免得镜头一闪一闪
    const want = Math.max(1.2, tMin - 0.35)
    camDist = want < camDist ? want : camDist + (want - camDist) * (1 - Math.pow(0.03, dt))
    if (camDist < len) {
      camera.position.set(fx + ray.direction.x * camDist, fy + ray.direction.y * camDist, fz + ray.direction.z * camDist)
      camera.lookAt(rig.focus)
    } else camDist = len
    // 镜头被挤到贴着角色时，把角色藏起来，免得镜头钻进角色身体里
    player.visible = Math.min(camDist, len) > 1.7
  }

  // ---------- 地点
  const places: Place[] = PLACES.filter((p) => p.radius > 0).map((p) => ({
    id: p.id,
    position: buildings.anchors[p.id] ?? new Vector3(p.x, terrain.groundAt(p.x, p.z) + 3, p.z),
    radius: p.radius,
  }))

  // ---------- 天气粒子
  const RAIN = high ? 2600 : 900
  const rainGeo = track(new BufferGeometry())
  const rainPos = new Float32Array(RAIN * 6)
  const rainSeeds = new Float32Array(RAIN * 3)
  for (let i = 0; i < RAIN; i++) {
    const x = (Math.random() - 0.5) * 80
    const y = Math.random() * 34
    const z = (Math.random() - 0.5) * 80
    rainSeeds.set([x / 80, y / 34, z / 80], i * 3)
    rainPos.set([x, y, z, x + 0.05, y + 0.7, z], i * 6)
  }
  rainGeo.setAttribute('position', new BufferAttribute(rainPos, 3))
  const rainMat = track(new LineBasicMaterial({ color: 0xdfe8f5, transparent: true, opacity: 0.55, depthWrite: false }))
  const rain = new LineSegments(rainGeo, rainMat)
  rain.visible = false
  rain.frustumCulled = false
  scene.add(rain)

  // 萤火虫：夏夜溪边
  const FLIES = 90
  const flyGeo = track(new BufferGeometry())
  const flyBase = new Float32Array(FLIES * 3)
  for (let i = 0; i < FLIES; i++) {
    const p = RIVER[Math.floor(RIVER.length * (0.35 + Math.random() * 0.6))]!
    const x = p[0] + (Math.random() - 0.5) * 14
    const z = p[1] + (Math.random() - 0.5) * 14
    flyBase.set([x, terrain.groundAt(x, z) + 0.6 + Math.random() * 2, z], i * 3)
  }
  flyGeo.setAttribute('position', new BufferAttribute(flyBase.slice(), 3))
  const flyMat = track(new PointsMaterial({ color: 0xfff3a0, size: 4, sizeAttenuation: false, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }))
  const flies = new Points(flyGeo, flyMat)
  flies.frustumCulled = false
  scene.add(flies)

  // 飘落物：春天的花瓣、秋天的落叶
  const DRIFT = high ? 260 : 100
  const driftGeo = track(new BufferGeometry())
  const driftPos = new Float32Array(DRIFT * 3)
  for (let i = 0; i < DRIFT; i++) driftPos.set([(Math.random() - 0.5) * 50, Math.random() * 14, (Math.random() - 0.5) * 50], i * 3)
  driftGeo.setAttribute('position', new BufferAttribute(driftPos, 3))
  const petal = document.createElement('canvas')
  petal.width = petal.height = 32
  {
    const g = petal.getContext('2d')!
    g.fillStyle = '#fff'
    g.beginPath()
    g.ellipse(16, 16, 14, 8, 0.6, 0, Math.PI * 2)
    g.fill()
  }
  const driftMat = track(new PointsMaterial({ color: 0xf8c7d6, size: 0.32, map: track(new CanvasTexture(petal)), alphaTest: 0.4, transparent: true, depthWrite: false }))
  const drift = new Points(driftGeo, driftMat)
  drift.frustumCulled = false
  drift.visible = false
  scene.add(drift)

  // ---------- 环境
  let env: WorldEnvironment = {
    weights: { noon: 1, dawn: 0, dusk: 0, night: 0 },
    windows: 0,
    stars: 0,
    weather: 'partly',
    season: 'summer',
  }
  let season: Season | null = null
  let night = 0
  const eco: EcoState = { day: 1, night: 0, twilight: 0, season: 'summer', wet: false, storm: false, snow: false, fog: false, wind: 1 }
  const moonDir = new Vector3(-0.3, 0.75, -0.6).normalize()
  const fogBase = { near: 70, far: 260 }
  const sunOffset = new Vector3(60, 90, 45)
  const sunDir = new Vector3()
  const c1 = new Color()
  const c2 = new Color()
  function applyEnvironment() {
    const w = env.weights
    const dim = WEATHER_LIGHT[env.weather]
    const wet = env.weather === 'rain' || env.weather === 'storm' || env.weather === 'thunder'
    kit.wind.value = WEATHER_WIND[env.weather]
    if (env.season !== season) {
      season = env.season
      terrain.setSeason(season)
      nature.setSeason(season)
    }
    const zenith = blend('sky-zenith', w)
    const horizon = blend('sky-horizon', w)
    const grey = blend('cloud-shade', w)
    if (dim < 1) {
      zenith.lerp(grey, (1 - dim) * 1.2)
      horizon.lerp(grey, 1 - dim)
    }
    const haze = blend('haze', w)
    if (dim < 1) haze.lerp(grey, (1 - dim) * 0.6)
    const fog = scene.fog as Fog
    fog.color.copy(haze)
    fogBase.near = env.weather === 'fog' ? 12 : wet ? 40 : 70
    fogBase.far = env.weather === 'fog' ? 90 : wet ? 170 : 260
    fog.near = fogBase.near
    fog.far = fogBase.far

    // 太阳：清晨在东边低处，中午在南偏西的高处，傍晚落到西边海上
    const elev = sunElevation(w)
    const day = w.dawn + w.noon + w.dusk || 1
    const ax = (w.dawn * 1 + w.noon * -0.42 + w.dusk * -1) / day
    const az = (w.dawn * -0.3 + w.noon * 0.9 + w.dusk * 0.35) / day
    const hl = Math.hypot(ax, az) || 1
    sunDir.set((ax / hl) * Math.cos(elev), Math.sin(elev), (az / hl) * Math.cos(elev)).normalize()
    // 夜里主光换成月光（从北边的高处照下来）
    sunOffset.copy(sunDir).lerp(moonDir, w.night).normalize().multiplyScalar(130)
    sun.color.copy(blend('sun', w))
    sun.intensity = sunIntensity(w) * dim
    hemi.color.copy(blend('sky-horizon', w))
    hemi.groundColor.copy(blend('foliage-shade', w))
    hemi.intensity = ambientIntensity(w) * (0.6 + 0.4 * dim)

    night = Math.min(1, env.windows + (wet ? 0.3 : 0))
    sky.setColors({
      zenith,
      horizon,
      sun: blend('sun', w),
      sunDir,
      sunVis: Math.max(0, 1 - w.night * 1.3) * (dim > 0.9 ? 1 : dim > 0.75 ? 0.3 : 0),
      moonDir,
      moonVis: w.night * (env.weather === 'clear' || env.weather === 'partly' ? 1 : 0.15),
      cloudLit: blend('cloud-lit', w).lerp(grey, (1 - dim) * 0.9),
      cloudShade: blend('cloud-shade', w).lerp(grey, (1 - dim) * 0.6).multiplyScalar(1 - (1 - dim) * 0.4),
      haze,
      mountain: blend('foliage-shade', w, c1),
      stars: env.weather === 'clear' || env.weather === 'partly' ? env.stars * 0.9 : env.weather === 'cloudy' ? env.stars * 0.3 : 0,
      cover: CLOUD_COVER[env.weather],
      towers: (env.season === 'summer' ? 1 : env.season === 'winter' ? 0.35 : 0.65) * (wet || env.weather === 'fog' ? 0.3 : 1),
    })
    water.setEnv({
      shallow: blend('water-shallow', w),
      deep: blend('water-deep', w),
      foam: c2.setRGB(1, 1, 1).lerp(blend('cloud-lit', w), 0.3).multiplyScalar(0.55 + 0.45 * (1 - w.night)),
      fog: haze,
      fogNear: fog.near,
      fogFar: fog.far,
      sparkle: (w.noon * 1 + w.dawn * 0.7 + w.dusk * 0.8) * (dim > 0.9 ? 1 : dim > 0.75 ? 0.25 : 0) + w.night * 0.15,
      sunDir: w.night > 0.6 ? moonDir : sunDir,
      sunColor: w.night > 0.6 ? c1.set('#BFD0FF') : blend('sun', w),
      zenith,
      horizon,
      winter: env.season === 'winter' ? 1 : 0,
      rain: wet ? (env.weather === 'rain' ? 0.6 : 1) : 0,
    })
    terrain.setWeather(wet ? 1 : env.weather === 'fog' ? 0.25 : 0, horizon, Math.max(0, 1 - w.night) * dim)
    buildings.setSnow(env.season === 'winter' ? (env.weather === 'snow' ? 1 : 0.75) : env.weather === 'snow' ? 0.4 : 0)
    eco.day = Math.min(1, w.noon + 0.4 * (w.dawn + w.dusk))
    eco.night = w.night
    eco.twilight = w.dawn + w.dusk
    eco.season = env.season
    eco.wet = wet
    eco.storm = env.weather === 'storm' || env.weather === 'thunder'
    eco.snow = env.weather === 'snow'
    eco.fog = env.weather === 'fog'
    eco.wind = kit.wind.value
    sky.setGulls(Math.round(7 * Math.min(1, eco.day + eco.twilight * 0.5) * (eco.storm ? 0 : eco.wet ? 0.4 : 1)))

    const m = buildings.mats
    ;(m.win as unknown as { color: Color }).color.copy(c1.set('#8C93A0').lerp(blend('window-glow', w), night))
    ;(m.bulb as unknown as { color: Color }).color.copy(c1.set('#E9E3D3').lerp(c2.set('#FFE2A3'), night))
    m.vend.color.copy(c1.set('#DDE9F2').lerp(c2.set('#F4FBFF'), night).multiplyScalar(0.85 + night * 0.6))
    glowMat.uniforms.opacity!.value = night * 0.9
    for (const l of lamps) l.intensity = night * 14

    // 萤火虫：初夏到初秋的夜里，雨天不出来
    flyMat.opacity = (env.season === 'summer' ? 0.95 : env.season === 'autumn' ? 0.35 : 0) * Math.min(1, w.night * 1.5) * (wet ? 0 : 1)
    drift.visible = !wet && (env.season === 'spring' || env.season === 'autumn')
    driftMat.color.set(env.season === 'spring' ? '#F8C7D6' : '#E58A3A')

    rain.visible = wet || env.weather === 'snow'
    rainMat.color.set(env.weather === 'snow' ? 0xffffff : 0xdfe8f5)
    rainMat.opacity = env.weather === 'snow' ? 0.9 : 0.55

    post.setGrade(c1.setRGB(1, 1, 1).lerp(blend('grade', w), 0.5), 1, 1.06 + 0.06 * w.noon)
    const CLOUD_SHADOW: Record<WeatherId, number> = { clear: 0.45, partly: 1, cloudy: 0.5, fog: 0, rain: 0, storm: 0, thunder: 0, snow: 0.2 }
    post.setMood({
      cloudShadow: CLOUD_SHADOW[env.weather] * (1 - w.night) * (1 - w.dusk * 0.5),
      bloom: 0.35 + night * 0.55,
      shadowTint: c1.copy(blend('sky-zenith', w)).lerp(c2.setRGB(1, 1, 1), 0.35),
    })
  }
  applyEnvironment()

  // ---------- 输入
  const keys = new Set<string>()
  let inputEnabled = true
  const isTyping = () => {
    const el = document.activeElement
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)
  }
  let nearPlace: Place | null = null
  const onKeyDown = (e: KeyboardEvent) => {
    if (!inputEnabled || isTyping()) return
    const k = e.key.toLowerCase()
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
      keys.add(k)
      if (k.startsWith('arrow')) e.preventDefault()
    }
    if (k === 'e' && nearPlace) options.onInteract?.(nearPlace.id)
  }
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase())
  const onBlur = () => keys.clear()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  // 镜头：上帝视角 / 角色视角，见 camera.ts
  const DEFAULT = { mode: 'god' as ViewMode, yaw: 0, pitch: 0.8, distance: 215 }
  const rig = createCameraRig(canvas, camera, DEFAULT, options.onViewChange)

  // ---------- 尺寸
  const resize = () => {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    post.setSize(w, h)
    water.setSize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio())
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    glowMat.uniforms.scale!.value = (h * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360))
  }
  const onContextLost = (event: Event) => { event.preventDefault(); options.onError?.('图形设备连接中断，请使用兼容模式重新打开。') }
  canvas.addEventListener('webglcontextlost', onContextLost)
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  resize()

  // ---------- 循环
  const timer = new Timer()
  const move = new Vector3()
  const up = new Vector3(0, 1, 0)
  const camTarget = new Vector3()
  const screen = new Vector3()
  const behind = new Vector3()
  let frame = 0
  let lastPromptId: string | null = null
  let lastPromptX = 0
  let lastPromptY = 0
  let walkPhase = 0

  let paused = false
  let simT = 0
  // 画面持续跟不上（低于约 40 帧）时，把渲染分辨率从 1.5 倍降到 1 倍；只降一次，不来回跳
  let slowT = 0
  function tick() {
    frame = requestAnimationFrame(tick)
    if (document.hidden || paused) return
    timer.update()
    const raw = timer.getDelta()
    if (renderer.getPixelRatio() > 1 && raw < 0.5) {
      slowT = raw > 1 / 40 ? slowT + raw : Math.max(0, slowT - raw * 0.5)
      if (slowT > 2.5) {
        renderer.setPixelRatio(1)
        resize()
        slowT = 0
      }
    }
    try { step(Math.min(raw, 0.05)) } catch (error) {
      cancelAnimationFrame(frame)
      options.onError?.(error instanceof Error ? error.message : String(error))
      console.error(error)
    }
  }
  function step(dt: number, draw = true) {
    simT += dt
    const t = simT
    kit.time.value = t

    // ---------- 角色移动：相对镜头朝向，撞到东西就沿着滑
    const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0)
    const r = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0)
    let moving = false
    if ((f !== 0 || r !== 0) && inputEnabled) {
      move.set(r, 0, -f).normalize().applyAxisAngle(up, rig.yaw)
      let speed = keys.has('shift') ? 8 : 4
      let face = Math.atan2(move.x, move.z)
      // 角色视角里按 S：面朝前方往后退，镜头不转
      if (rig.mode === 'follow' && f < 0) {
        face = rig.yaw + Math.PI + r * -0.35
        speed *= 0.55
      }
      const nx = playerBody.x + move.x * speed * dt
      const nz = playerBody.z + move.z * speed * dt
      if (walkable(nx, nz)) {
        playerBody.x = nx
        playerBody.z = nz
      } else if (walkable(nx, playerBody.z)) playerBody.x = nx
      else if (walkable(playerBody.x, nz)) playerBody.z = nz
      let da = face - player.rotation.y
      da = Math.atan2(Math.sin(da), Math.cos(da))
      player.rotation.y += da * Math.min(1, dt * 12)
      moving = true
      walkPhase += dt * (keys.has('shift') ? 16 : 11)
    }
    if (moving) stillFor = 0
    else stillFor += dt

    // ---------- 狗、动物、列车，然后统一做碰撞分离
    updateDog(dt, t, moving)
    rail.update(dt, t)
    const carBoxes = rail.carBoxes()
    ecology.update(dt, t, eco, { player: playerBody, dog: dogBody, playerMoving: moving, train: carBoxes })
    sealife.update(dt, t, eco, playerBody)
    bodies.resolve(blockedFor, carBoxes)
    player.position.x = playerBody.x
    player.position.z = playerBody.z
    const ground = surfaceAt(player.position.x, player.position.z)
    const bob = moving ? Math.abs(Math.sin(walkPhase)) * 0.07 : 0
    player.position.y += (ground + bob - player.position.y) * Math.min(1, dt * 18)
    dog.position.x = dogBody.x
    dog.position.z = dogBody.z
    dog.position.y += (surfaceAt(dog.position.x, dog.position.z) + dogHopY - dog.position.y) * Math.min(1, dt * 20)
    petMixer?.update(dt)

    // ---------- 镜头：角色一动就回到角色身上；镜头和角色之间隔着东西就拉近
    if (moving) rig.follow = true
    camTarget.set(player.position.x, player.position.y + 1.4, player.position.z)
    rig.update(dt, { target: camTarget, heading: player.rotation.y, moving, groundAt: surfaceAt })
    // 上帝视角从高处往下看，只避开山；角色视角离得近，房子、列车、树冠都要避开
    keepCameraClear(dt, rig.mode === 'follow')
    const focus = rig.focus
    sky.dome.position.copy(camera.position)
    sun.target.position.copy(focus)
    sun.position.copy(focus).add(sunOffset)
    // 拉远时雾和阴影范围跟着变大
    const fog = scene.fog as Fog
    fog.near = fogBase.near + rig.distance * 0.7
    fog.far = fogBase.far + rig.distance * 1.6
    water.setFog(fog.near, fog.far)
    const ext = Math.min(140, Math.max(48, rig.distance * 1.1))
    if (Math.abs(sc.right - ext) > 2) {
      sc.left = sc.bottom = -ext
      sc.right = sc.top = ext
      sc.updateProjectionMatrix()
    }

    // 环境动画
    sky.update(dt, t)
    buildings.update(t, dt, night)
    landmarks.update(t, night)
    landmarks.updateHome(player.position.x, player.position.z)
    town.update(t)
    if (rain.visible) {
      const arr = rainGeo.attributes.position!.array as Float32Array
      const snow = env.weather === 'snow'
      // Fixed particle budget; expand the weather volume with the visible world.
      const distance = camera.position.distanceTo(rig.focus)
      const span = Math.max(90, distance * Math.tan(camera.fov * Math.PI / 360) * 2.8 * Math.max(1, camera.aspect))
      const height = Math.max(100, distance * 0.9)
      const fall = snow ? 3.5 : 32
      const len = snow ? Math.max(0.12, span * 0.0006) : Math.max(0.7, span * 0.003)
      for (let i = 0; i < RAIN; i++) {
        const k = i * 6, seed = i * 3
        rainSeeds[seed + 1] = (rainSeeds[seed + 1]! - fall * dt / height + 1) % 1
        const x = rainSeeds[seed]! * span + (snow ? Math.sin(t * 0.6 + i) * 0.5 : 0)
        const z = rainSeeds[seed + 2]! * span
        const y = rainSeeds[seed + 1]! * height - 8
        arr[k] = x
        arr[k + 1] = y
        arr[k + 2] = z
        arr[k + 3] = x + (snow ? len * 0.4 : 0.12)
        arr[k + 4] = y + len
        arr[k + 5] = z
      }
      rainGeo.attributes.position!.needsUpdate = true
      rain.position.set(rig.focus.x, Math.max(0, rig.focus.y - 12), rig.focus.z)
    }
    if (flyMat.opacity > 0) {
      const arr = flyGeo.attributes.position!.array as Float32Array
      for (let i = 0; i < FLIES; i++) {
        arr[i * 3] = flyBase[i * 3]! + Math.sin(t * 0.5 + i) * 0.8
        arr[i * 3 + 1] = flyBase[i * 3 + 1]! + Math.sin(t * 0.9 + i * 1.7) * 0.4
        arr[i * 3 + 2] = flyBase[i * 3 + 2]! + Math.cos(t * 0.4 + i * 0.6) * 0.8
      }
      flyGeo.attributes.position!.needsUpdate = true
    }
    if (drift.visible) {
      const arr = driftGeo.attributes.position!.array as Float32Array
      for (let i = 0; i < DRIFT; i++) {
        arr[i * 3]! += (0.6 + Math.sin(t * 0.7 + i) * 0.5) * dt * kit.wind.value
        arr[i * 3 + 1]! -= (0.5 + (i % 5) * 0.08) * dt
        arr[i * 3 + 2]! += Math.cos(t * 0.5 + i * 0.3) * dt * 0.4
        if (arr[i * 3 + 1]! < -2) {
          arr[i * 3 + 1] = 12 + Math.random() * 3
          arr[i * 3] = (Math.random() - 0.5) * 50
          arr[i * 3 + 2] = (Math.random() - 0.5) * 50
        }
      }
      driftGeo.attributes.position!.needsUpdate = true
      drift.position.set(focus.x, focus.y, focus.z)
    }

    // 地点提示
    nearPlace = null
    for (const p of places) {
      const dx = p.position.x - player.position.x
      const dz = p.position.z - player.position.z
      if (dx * dx + dz * dz < p.radius * p.radius) nearPlace = p
    }
    if (nearPlace) {
      // 进出地点时才通知一次（界面据此重绘）；之后只在位置真的变了时报新坐标，
      // 由界面直接改那一个元素的位置，避免整页每帧重绘
      screen.copy(nearPlace.position).project(camera)
      const px = ((screen.x + 1) / 2) * canvas.clientWidth
      const py = ((1 - screen.y) / 2) * canvas.clientHeight
      if (nearPlace.id !== lastPromptId) {
        options.onPrompt?.({ id: nearPlace.id, x: px, y: py })
        lastPromptId = nearPlace.id
        lastPromptX = px
        lastPromptY = py
      } else if (Math.abs(px - lastPromptX) > 0.5 || Math.abs(py - lastPromptY) > 0.5) {
        options.onPromptMove?.(px, py)
        lastPromptX = px
        lastPromptY = py
      }
    } else if (lastPromptId) {
      options.onPrompt?.(null)
      lastPromptId = null
    }

    if (draw) {
      water.renderReflection(renderer, scene, camera)
      post.render(scene, camera)
    }
  }
  // 开场是上帝视角，看着岛的中南部
  rig.follow = false
  rig.focus.set(8, 2, -6)
  // Compile before revealing the first frame; do not expose a blank WebGL canvas.
  if (!compatibility) await renderer.compileAsync(scene, camera)
  else renderer.compile(scene, camera)
  tick()
  options.onProgress?.('ready', 100)

  let debugPanel: HTMLElement | undefined
  let debugTimer: ReturnType<typeof setInterval> | undefined
  // 调试：地址带 ?debug 时可以在控制台摆镜头、瞬移
  if (new URLSearchParams(location.search).has('debug')) {
    debugPanel = document.createElement('details')
    debugPanel.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:200;background:#173f50;color:#edf2e7;padding:10px 14px;max-width:520px;font:12px system-ui;border-radius:8px;max-height:40vh;overflow:auto'
    const summary = document.createElement('summary'); summary.textContent = '场景检查'; debugPanel.append(summary)
    const report = document.createElement('output'); report.style.cssText='display:block;white-space:pre-wrap;margin-top:8px'
    const status = document.createElement('span');status.style.cssText='display:block;margin:8px 0';debugPanel.append(status)
    const button = (text: string, fn: () => void) => { const b=document.createElement('button');b.textContent=text;b.style.cssText='padding:6px 9px;margin:3px;background:#e7eddf;color:#173f50;border:0;border-radius:3px;cursor:pointer'; b.onclick=fn;debugPanel!.append(b) }
    const views: [string, number, number, number][] = [['总览',8,-6,215],['海域边界',170,20,150],['山体瀑布',6,-64,80],['车站',8,31,45],['住宅',84,-12,44],['游乐栈桥',-9,68,70],['潜水岛',32,103,60]]
    for(const [name,x,z,d] of views)button(name,()=>{rig.setMode('god');rig.follow=false;rig.focus.set(x,Math.max(0,terrain.groundAt(x,z))+1.2,z);rig.setDistance(d);rig.setPitch(.8);rig.yaw=0})
    button('进入家中',()=>{player.position.set(84,landmarks.homeY+.22,-9);playerBody.x=84;playerBody.z=-9;rig.setMode('god');rig.follow=true;rig.setDistance(20);rig.setPitch(.8);rig.yaw=0})
    button('连续拖动检查',()=>{
      rig.setMode('god');rig.follow=false;rig.setDistance(150);rig.setPitch(.8)
      let n=0,min=Infinity,max=0
      const run=()=>{if(disposed)return; const a=n/90*Math.PI*2;rig.focus.set(50+90*Math.sin(a),rig.focus.y,-38+45*Math.cos(a));min=Math.min(min,camera.position.distanceTo(rig.focus));max=Math.max(max,camera.position.distanceTo(rig.focus));n++;if(n<180)requestAnimationFrame(run);else report.textContent=JSON.stringify({cameraDistanceMin:+min.toFixed(2),cameraDistanceMax:+max.toFixed(2),target:150},null,2)}
      requestAnimationFrame(run)
    })
    button('路线与性能',()=>{
      const bad:number[][]=[];PATHS.forEach((p,i)=>p.forEach(([x,z])=>{if(!walkable(x,z))bad.push([i,+x.toFixed(1),+z.toFixed(1)])}))
      renderer.info.autoReset=false;renderer.info.reset();water.renderReflection(renderer,scene,camera);post.render(scene,camera)
      report.textContent=JSON.stringify({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pathBlocked:bad},null,2);renderer.info.autoReset=true
    })
    debugPanel.append(report);document.body.append(debugPanel)
    debugTimer=setInterval(()=>{status.textContent=`镜头距离 ${camera.position.distanceTo(rig.focus).toFixed(1)} m · 地标 ${Object.keys(landmarks.sites).length}`},500)

    ;(window as unknown as Record<string, unknown>).__kv = {
      cam: (y: number, p: number, d: number, mode?: ViewMode) => {
        if (mode) rig.setMode(mode, player.rotation.y)
        rig.yaw = y
        rig.setPitch(p)
        rig.setDistance(d)
      },
      look: (x: number, z: number) => {
        rig.follow = false
        rig.focus.set(x, Math.max(0, terrain.groundAt(x, z)) + 1.2, z)
      },
      go: (x: number, z: number, rot = player.rotation.y) => {
        player.position.set(x, surfaceAt(x, z), z)
        player.rotation.y = rot
        dog.position.set(x + 1.2, surfaceAt(x + 1.2, z + 1), z + 1)
        playerBody.x = x
        playerBody.z = z
        dogBody.x = x + 1.2
        dogBody.z = z + 1
        rig.follow = true
        rig.focus.set(x, player.position.y + 1.4, z)
      },
      pause: (v: boolean) => (paused = v),
      bodies: () => bodies.list.map((b) => ({ k: b.kind, x: +b.x.toFixed(2), z: +b.z.toFixed(2), r: b.r, a: b.active, solid: solid(b.x, b.z, b.r * 0.6) })),
      dog: () => ({ state: dogState, x: dogBody.x, z: dogBody.z, target: dogTarget ? [dogTarget.kind, dogTarget.x, dogTarget.z] : null }),
      dw: (x: number, z: number) => [dogWalkable(x, z), terrain.groundAt(x, z), solid(x, z, 0.35), shore(x, z)],
      keys,
      why: (x: number, z: number) => ({
        deck: decks.some((d) => d.at(x, z) !== null),
        g: terrain.groundAt(x, z),
        river: distTo(x, z, RIVER, 5),
        hits: obstacles.filter((o) => (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + 0.4) ** 2).map((o) => [o.x.toFixed(1), o.z.toFixed(1), o.r.toFixed(2), propObstacles.includes(o) ? 'prop' : buildings.obstacles.includes(o) ? 'bld' : 'nat']),
      }),
      /** 每条小路、桥、栈桥上能不能走 */
      pathCheck: () => {
        const bad: number[][] = []
        PATHS.forEach((p, i) => p.forEach(([x, z]) => {
          if (!walkable(x, z)) bad.push([i, +x.toFixed(1), +z.toFixed(1)])
        }))
        for (let z = PIER.z0; z < PIER.z1; z += 1) if (!walkable(PIER.x, z)) bad.push([99, PIER.x, z])
        return bad
      },
      /** 静态穿插检查：树、石头和房子、站台、铁轨、溪流、小路有没有叠在一起 */
      audit: () => {
        const out: Record<string, number> = { props: propObstacles.length }
        for (const [k, n] of Object.entries(nature.cleared)) out[`cleared-${k}`] = n
        const bump = (k: string) => (out[k] = (out[k] ?? 0) + 1)
        for (const o of nature.obstacles) {
          for (const b of buildings.obstacles) if (Math.hypot(o.x - b.x, o.z - b.z) < o.r + b.r) bump('tree/rock-building')
          if (decks.some((d) => d.at(o.x, o.z) !== null)) bump('tree/rock-deck')
          const rn = railNear(o.x, o.z, 4)
          if (rn && rn.tunnel < 0.5 && rn.d < 2.2 + o.r) bump('tree/rock-rail')
          const rv = riverNear(o.x, o.z, 4)
          if (rv && rv.d < 1.8 + o.r * 0.5) bump('tree/rock-river')
          if (pathDist(o.x, o.z, 3) < 0.9 + o.r * 0.5) bump('tree/rock-path')
        }
        return out
      },
      /** (x, z) 附近的树冠包围球 */
      crowns: (x: number, z: number, r = 8) => nature.crowns.filter((c) => Math.hypot(c.x - x, c.z - z) < r),
      /** 车厢的实际尺寸 */
      carSize: () => {
        const c = rail.cars[0]!
        const b = new Box3().setFromObject(c)
        return { min: b.min.toArray(), max: b.max.toArray(), y: c.position.y }
      },
      /** 每块内容有多少个网格（找绘制次数大头用） */
      stats: () => {
        const named: [string, Object3D][] = [['terrain', terrain.mesh], ['buildings', buildings.group], ['town', town.group], ['rail', rail.group], ['nature', nature.group], ['sky', sky.group], ['sealife', sealife.group], ['ecology', ecology.group]]
        const out: Record<string, number> = {}
        for (const [n, o] of named) {
          let c = 0
          o.traverse((x) => {
            if ((x as Mesh).isMesh && x.visible) c++
          })
          out[n] = c
        }
        return out
      },
      camState: () => ({ x: rig.focus.x, z: rig.focus.z, yaw: rig.yaw, pitch: rig.pitch, d: rig.distance, follow: rig.follow }),
      info: () => {
        renderer.info.autoReset = false
        renderer.info.reset()
        post.render(scene, camera)
        const r = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles }
        renderer.info.autoReset = true
        return r
      },
      h: (x: number, z: number) => terrain.groundAt(x, z),
      pos: () => [player.position.x, player.position.y, player.position.z],
      /** 往前走 n 帧（不画），再画一帧 */
      step: (n = 1, dt = 1 / 30) => {
        for (let i = 0; i < n; i++) step(dt, i === n - 1)
      },
      env: (e: Partial<WorldEnvironment>) => {
        env = { ...env, ...e }
        applyEnvironment()
      },
    }
  }

  return {
    setEnvironment(next) {
      env = next
      applyEnvironment()
    },
    setInputEnabled(enabled) {
      inputEnabled = enabled
      if (!enabled) keys.clear()
    },
    resetCamera() {
      rig.setMode('god')
      rig.yaw = DEFAULT.yaw
      rig.setPitch(DEFAULT.pitch)
      rig.setDistance(DEFAULT.distance)
      rig.follow = true
    },
    setView(mode) {
      rig.setMode(mode, player.rotation.y)
    },
    dispose() {
      disposed = true
      petMixer?.stopAllAction()
      cancelAnimationFrame(frame)
      ro.disconnect()
      canvas.removeEventListener('webglcontextlost', onContextLost)
      clearInterval(debugTimer)
      debugPanel?.remove()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      rig.dispose()
      kit.disposeAll()
      renderer.dispose()
    },
  }
}
