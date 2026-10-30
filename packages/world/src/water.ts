/**
 * 海和溪流。
 * - 水深从地形高度图里读：浅处几乎透明，能看到沙子、焦散和鱼；越深越蓝、越不透明
 * - 海面有平面反射（岛、树、云倒映在海上），越斜着看反射越强
 * - 波浪法线让反射和阳光碎成一片片闪光；太阳在前方时海上有一条亮带
 * - 岸边泡沫和一道道推上岸的浪线；下雨时水面有一圈圈涟漪
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  HalfFloatType,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Points,
  AdditiveBlending,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type DataTexture,
  type Scene,
  type WebGLRenderer,
} from 'three'
import type { Kit } from './kit'
import { TERRAIN, riverSurface, shore } from './layout'

/** 不参与反射的东西放在这些图层上（海面自己、水下的鱼和珊瑚、草和花这类小东西） */
export const LAYER_NO_REFLECT = 1

const COMMON = /* glsl */ `
uniform sampler2D hTex;
uniform vec4 hBox;
uniform vec3 shallow;
uniform vec3 deep;
uniform vec3 foam;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float time;
uniform float sparkle;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 skyZenith;
uniform vec3 skyHorizon;
uniform float rain;
uniform float winter;
varying vec3 vW;
varying float vDist;
float ground(vec2 p) {
  vec2 uv = (p - hBox.xy) / hBox.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -24.0;
  float h = texture2D(hTex, uv).r;
  vec2 edgeMeters = min(uv, 1.0 - uv) * hBox.zw;
  float interior = smoothstep(0.0, 18.0, min(edgeMeters.x, edgeMeters.y));
  return mix(-24.0, h, interior);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
// 两层波的高度，用差分求法线
float waveH(vec2 p) {
  return vnoise(p * 0.45 + vec2(time * 0.22, time * 0.13)) * 0.6
       + vnoise(p * 1.3 - vec2(time * 0.35, -time * 0.28)) * 0.3
       + vnoise(p * 3.4 + vec2(time * 0.6, time * 0.5)) * 0.1;
}
vec3 waveNormal(vec2 p, float k) {
  float e = 0.12;
  float h = waveH(p);
  return normalize(vec3((h - waveH(p + vec2(e, 0.0))) * k, 1.0, (h - waveH(p + vec2(0.0, e))) * k));
}
// 雨滴涟漪：每个格子里一个随时间扩散的圆环
float ripples(vec2 p) {
  float r = 0.0;
  for (int i = 0; i < 2; i++) {
    vec2 q = p * (1.6 + float(i) * 0.7) + float(i) * 13.1;
    vec2 c = floor(q);
    vec2 f = fract(q) - 0.5 - (vec2(hash(c), hash(c + 7.0)) - 0.5) * 0.5;
    float ph = fract(time * 0.9 + hash(c + 3.0));
    float d = length(f);
    r += (1.0 - smoothstep(0.0, 0.05, abs(d - ph * 0.45))) * (1.0 - ph);
  }
  return r;
}
vec3 skyAt(vec3 dir) {
  return mix(skyHorizon, skyZenith, pow(clamp(dir.y, 0.0, 1.0), 0.6));
}
`

const VERT = /* glsl */ `
uniform mat4 textureMatrix;
varying vec3 vW;
varying float vDist;
varying vec4 vRefl;
attribute float flow;
attribute float fade;
varying float vFlow;
varying float vFade;
varying vec2 vUv;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vFlow = flow;
  vFade = fade;
  vUv = uv;
  vRefl = textureMatrix * w;
  vec4 mvPosition = viewMatrix * w;
  vDist = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`

const SEA_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tRefl;
uniform float reflOn;
varying vec4 vRefl;
void main() {
  float g = ground(vW.xz);
  float depth = max(0.0, vW.y - g);
  float n = vnoise(vW.xz * 0.3 + vec2(time * 0.05, 0.0));
  float n2 = vnoise(vW.xz * 1.3 - vec2(0.0, time * 0.2));
  // 远处的浪平一点，免得闪成一片噪点
  float calm = 1.0 - smoothstep(60.0, 400.0, vDist) * 0.8;
  vec3 N = waveNormal(vW.xz, 1.6 * calm);
  if (rain > 0.0) {
    float rp = ripples(vW.xz) * rain;
    N = normalize(N + vec3(rp * 0.35, 0.0, rp * 0.25));
  }
  vec3 V = normalize(cameraPosition - vW);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);

  // 水体颜色：越深越蓝
  // 浅处偏青绿、中间是饱和的蓝绿、深处是深蓝
  vec3 mid = mix(shallow, deep, 0.45) * vec3(0.8, 1.05, 1.05);
  float opticalDepth = max(0.0, depth + (n - 0.5) * 0.25);
  vec3 body = mix(shallow, mid, 1.0 - exp(-opticalDepth * 0.23));
  body = mix(body, deep, 1.0 - exp(-opticalDepth * 0.065));

  // 反射：有反射图就用（带波浪扭曲），没有就用天空色
  vec3 R = reflect(-V, N);
  vec3 refl = skyAt(R);
  if (reflOn > 0.5) {
    vec4 rc = vRefl;
    rc.xy += N.xz * 0.9 * rc.w * 0.04;
    vec2 ruv = rc.xy / max(rc.w, 0.0001);
    vec2 border = min(ruv, 1.0 - ruv);
    float valid = smoothstep(0.0, 0.06, min(border.x, border.y)) * step(0.0, rc.w);
    refl = mix(refl, texture2D(tRefl, clamp(ruv, 0.001, 0.999)).rgb, 0.88 * valid);
  }
  vec3 c = mix(body, refl, clamp(fres * 1.1, 0.0, 0.92));

  // 阳光：一条闪光带 + 细碎的亮点
  vec3 H = normalize(normalize(sunDir) + V);
  float nh = max(dot(N, H), 0.0);
  float spec = (pow(nh, 600.0) * 9.0 + pow(nh, 80.0) * 0.5) * sparkle;
  float glit = step(0.9, vnoise(vW.xz * 2.4 + vec2(time * 0.9, -time * 0.6))) * pow(nh, 30.0) * sparkle * 2.5;

  // 岸边泡沫
  float edge = 1.0 - smoothstep(0.04, 0.2 + n * 0.22, depth);
  // 两道往岸上推的浪线
  float lines = 0.0;
  for (int i = 0; i < 2; i++) {
    float ph = fract(time * 0.09 + float(i) * 0.5);
    float wd = mix(2.0, 0.05, ph) + (n - 0.5) * 0.5;
    float l = 1.0 - smoothstep(0.03, 0.08 + 0.05 * ph, abs(depth - wd));
    l *= smoothstep(0.0, 0.25, ph) * (1.0 - smoothstep(0.75, 1.0, ph));
    l *= step(0.35, n2);
    lines = max(lines, l);
  }
  // 礁盘外缘的一圈碎浪
  float reefBreak = (1.0 - smoothstep(0.0, 0.7, abs(depth - 2.6))) * step(0.62, vnoise(vW.xz * 0.7 + vec2(time * 0.4, 0.0))) * 0.35;
  // 深海零星的白浪
  float caps = smoothstep(0.90, 0.98, vnoise(vW.xz * 0.5 + vec2(time * 0.15, time * 0.07))) * smoothstep(0.55, 0.7, n) * smoothstep(5.0, 12.0, depth) * 0.18;
  float white = max(max(edge, lines * 0.9), max(caps, reefBreak));
  c = mix(c, foam, white);
  c += sunColor * (spec + glit) * (1.0 - white);

  // 透明度：浅处很透，深处不透；斜看时反射让它变“实”
  // Deep water must be opaque: a residual 5% exposes the rectangular terrain edge.
  float a = mix(0.18, 1.0, 1.0 - exp(-depth * 0.65));
  a = mix(a, 1.0, smoothstep(6.0, 10.0, depth));
  a = max(a, fres * 0.9);
  a = max(a, white);
  a = min(1.0, a + spec * 0.5);
  // Stationary near-shore ice follows actual seabed depth around every island.
  float iceNoise = vnoise(vW.xz * 0.22);
  float ice = winter * (1.0 - smoothstep(2.0, 6.0, depth + (iceNoise - 0.5) * 1.5));
  float frost = vnoise(vW.xz * 3.0);
  float cracks = 1.0 - smoothstep(0.015, 0.045, abs(vnoise(vW.xz * 0.6) - 0.5));
  vec3 iceColor = mix(vec3(0.49, 0.72, 0.78), vec3(0.86, 0.94, 0.93), frost * 0.65 + 0.25);
  iceColor = mix(iceColor, vec3(0.36, 0.59, 0.67), cracks * 0.28);
  iceColor *= max(vec3(0.18), skyHorizon * 0.65 + sunColor * 0.35);
  c = mix(c, iceColor, ice);
  a = mix(a, 0.98, ice);
  float f = smoothstep(fogNear, fogFar, vDist);
  gl_FragColor = vec4(mix(c, fogColor, f), mix(a, 1.0, f));
}
`

const RIVER_FRAG = /* glsl */ `
${COMMON}
varying float vFlow;
varying float vFade;
varying vec2 vUv;
void main() {
  float flowK = min(vFlow, 1.0);
  float fall = smoothstep(1.6, 3.2, vFlow);
  float depth = max(0.0, vW.y - ground(vW.xz));
  float n = vnoise(vec2(vUv.x * 4.0, vUv.y * 0.6 - time * 1.1));
  vec3 N = waveNormal(vec2(vUv.x * 3.0, vUv.y - time * (1.0 + flowK * 3.0)), 1.2);
  if (rain > 0.0) N = normalize(N + vec3(ripples(vW.xz) * rain * 0.3, 0.0, 0.0));
  vec3 V = normalize(cameraPosition - vW);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 c = mix(shallow, deep, smoothstep(0.1, 1.4, depth) * 0.75);
  c = mix(c, skyAt(reflect(-V, N)), fres * 0.8);
  // 顺流的细条纹
  float s = fract(vUv.y * 0.35 - time * (0.6 + flowK * 1.8) + n * 0.6);
  float stripe = (1.0 - smoothstep(0.0, 0.06, abs(s - 0.5))) * step(0.45, n);
  float edge = (1.0 - smoothstep(0.03, 0.18 + n * 0.12, depth)) * (1.0 - fall);
  float rapids = smoothstep(0.15, 0.5, flowK) * step(0.55, vnoise(vec2(vUv.x * 6.0, vUv.y * 1.5 - time * 3.0))) * (1.0 - fall);
  float white = max(max(edge, stripe * 0.55), rapids * 0.85);
  c = mix(c, foam, white);
  // 瀑布：竖着往下流的条纹，亮白和浅青两档（三渲二），两边薄、中间厚
  if (fall > 0.0) {
    float sx = vUv.x * 9.0;
    float s1 = vnoise(vec2(sx, vUv.y * 0.22 - time * 2.4));
    float s2 = vnoise(vec2(sx * 2.1 + 5.0, vUv.y * 0.5 - time * 3.6));
    float k = s1 * 0.6 + s2 * 0.4;
    float threads = pow(0.5 + 0.5 * sin(sx * 7.0 + s1 * 3.0), 6.0);
    float veil = smoothstep(0.18, 0.85, k);
    vec3 fc = mix(shallow * 0.82, foam, 0.35 + 0.45 * veil + threads * 0.16);
    c = mix(c, fc, fall);
    white = max(white, fall * 0.3);
  }
  vec3 H = normalize(normalize(sunDir) + V);
  c += sunColor * pow(max(dot(N, H), 0.0), 300.0) * 5.0 * sparkle * (1.0 - white);
  float a = mix(0.35, 0.9, smoothstep(0.0, 1.2, depth));
  a = max(max(a, edge), fres * 0.8);
  // 瀑布本身是不透明的水帘，两侧边缘稍微透一点
  float ragged = vnoise(vec2(vUv.x * 25.0, vUv.y * 1.3 - time * 6.0));
  float curtain = smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.86, 1.0, vUv.x));
  a = mix(a, (0.52 + ragged * 0.36) * curtain, fall);
  a *= vFade;
  float f = smoothstep(fogNear, fogFar, vDist);
  gl_FragColor = vec4(mix(c, fogColor, f), a);
}
`

export interface WaterEnv {
  shallow: Color
  deep: Color
  foam: Color
  fog: Color
  fogNear: number
  fogFar: number
  sparkle: number
  sunDir: Vector3
  sunColor: Color
  zenith: Color
  horizon: Color
  rain: number
  winter: number
}

export interface Water {
  sea: Mesh
  river: Mesh
  /** 瀑布底下的水雾和水花 */
  mist: Points
  setEnv: (e: WaterEnv) => void
  /** 画海面倒影（在主画面之前调用） */
  renderReflection: (renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) => void
  setSize: (w: number, h: number) => void
  /** 雾的范围跟着镜头远近变 */
  setFog: (near: number, far: number) => void
}

export function createWater(kit: Kit, heightTex: DataTexture, bounds = { minX: TERRAIN.minX as number, minZ: TERRAIN.minZ as number, width: TERRAIN.maxX - TERRAIN.minX, depth: TERRAIN.maxZ - TERRAIN.minZ }): Water {
  const reflTarget = kit.track(new WebGLRenderTarget(1, 1, { type: HalfFloatType }))
  const textureMatrix = new Matrix4()
  const uniforms = () => ({
    hTex: { value: heightTex },
    hBox: { value: new Vector4(bounds.minX, bounds.minZ, bounds.width, bounds.depth) },
    shallow: { value: new Color('#7FD8D2') },
    deep: { value: new Color('#2F7FB5') },
    foam: { value: new Color('#FFFFFF') },
    fogColor: { value: new Color('#DCEFF6') },
    fogNear: { value: 120 },
    fogFar: { value: 520 },
    time: kit.time,
    sparkle: { value: 1 },
    sunDir: { value: new Vector3(0, 1, 0) },
    sunColor: { value: new Color(1, 1, 1) },
    skyZenith: { value: new Color() },
    skyHorizon: { value: new Color() },
    rain: { value: 0 },
    winter: { value: 0 },
    textureMatrix: { value: textureMatrix },
    tRefl: { value: reflTarget.texture },
    reflOn: { value: 0 },
  })
  const mk = (frag: string) =>
    kit.track(new ShaderMaterial({ uniforms: uniforms(), vertexShader: VERT, fragmentShader: frag, transparent: true }))
  const seaMat = mk(SEA_FRAG)
  const riverMat = mk(RIVER_FRAG)

  const seaGeo = kit.track(new PlaneGeometry(2400, 2400, 1, 1))
  seaGeo.rotateX(-Math.PI / 2)
  seaGeo.setAttribute('flow', new BufferAttribute(new Float32Array(4), 1))
  seaGeo.setAttribute('fade', new BufferAttribute(new Float32Array([1, 1, 1, 1]), 1))
  const sea = new Mesh(seaGeo, seaMat)
  sea.renderOrder = 1
  sea.layers.set(LAYER_NO_REFLECT)

  // 溪流：沿河道铺一条带子
  const all = riverSurface()
  // 入海口：河面一直铺到海岸线外 3 米，在岸线前后 3 米里慢慢变透明，和底下的海水接上；
  // 河面在这之前已经平缓地落到海面（见 layout 的 RIVER_Y），所以没有台阶，河道里也看不到海浪
  const FADE_FROM = 3
  const FADE_TO = -3
  let end = all.pts.length
  for (let i = 0; i < all.pts.length; i++)
    if (shore(all.pts[i]![0], all.pts[i]![1]) < FADE_TO) {
      end = i + 1
      break
    }
  const pts = all.pts.slice(0, end)
  const y = all.y.slice(0, end)
  const HALF = 3.6
  const verts: number[] = []
  const uvs: number[] = []
  const flow: number[] = []
  const fade: number[] = []
  const index: number[] = []
  let along = 0
  const dir = new Vector3()
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const a = pts[Math.max(0, i - 1)]!
    const b = pts[Math.min(pts.length - 1, i + 1)]!
    dir.set(b[0] - a[0], 0, b[1] - a[1]).normalize()
    const yy = y[i]!
    // uv.y 按水面上的真实长度算（瀑布那一段是竖着的，纹理不会被拉长）
    if (i > 0) along += Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1], y[i - 1]! - yy)
    const slope = i > 0 ? Math.max(0, y[i - 1]! - yy) / Math.max(0.01, Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1])) : 0
    const width = HALF * (1 - Math.min(1, slope) * 0.4)
    verts.push(p[0] + dir.z * width, yy, p[1] - dir.x * width, p[0] - dir.z * width, yy, p[1] + dir.x * width)
    uvs.push(0, along, 1, along)
    // flow：0–1 是缓流到急流，大于 1.6 是瀑布（陡到接近垂直）
    const fl = Math.min(4, slope * 2)
    flow.push(fl, fl)
    const sh = shore(p[0], p[1])
    const fv = Math.min(1, Math.max(0, (sh - FADE_TO) / (FADE_FROM - FADE_TO)))
    const fs = fv * fv * (3 - 2 * fv)
    fade.push(fs, fs)
    if (i > 0) {
      const o = (i - 1) * 2
      index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2)
    }
  }
  const riverGeo = kit.track(new BufferGeometry())
  riverGeo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3))
  riverGeo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  riverGeo.setAttribute('flow', new BufferAttribute(new Float32Array(flow), 1))
  riverGeo.setAttribute('fade', new BufferAttribute(new Float32Array(fade), 1))
  riverGeo.setIndex(index)
  // 溪水在海水之后画、不写深度：入海口两层水叠在一起时，海水先画好，溪水半透明地盖在上面慢慢淡出
  riverMat.depthWrite = false
  const river = new Mesh(riverGeo, riverMat)
  river.renderOrder = 2
  river.layers.set(LAYER_NO_REFLECT)

  // ---------- 瀑布底下的水雾：找到水面落差最大的那一段，在落点放一团慢慢升起、散开的白雾
  let fallI = 1
  let fallDrop = 0
  for (let i = 1; i < pts.length; i++) {
    const d = y[i - 1]! - y[i]!
    if (d > fallDrop) {
      fallDrop = d
      fallI = i
    }
  }
  // 往下游找到落差结束的地方（水潭）
  let poolI = fallI
  while (poolI < pts.length - 1 && y[poolI]! - y[poolI + 1]! > 0.3) poolI++
  const pool = pts[poolI]!
  const poolY = y[poolI]!
  const MIST = kit.high ? 160 : 64
  const mistPos = new Float32Array(MIST * 3)
  const mistSeed = new Float32Array(MIST)
  for (let i = 0; i < MIST; i++) {
    mistPos.set([pool[0] + (Math.random() - 0.5) * 5, poolY, pool[1] + (Math.random() - 0.5) * 4], i * 3)
    mistSeed[i] = Math.random()
  }
  const mistGeo = kit.track(new BufferGeometry())
  mistGeo.setAttribute('position', new BufferAttribute(mistPos, 3))
  mistGeo.setAttribute('seed', new BufferAttribute(mistSeed, 1))
  const mistMat = kit.track(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { time: kit.time, scale: { value: 600 }, strength: { value: fallDrop > 3 ? 1 : 0 } },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float time;
        uniform float scale;
        varying float vA;
        void main() {
          float t = fract(time * 0.18 + seed);
          vec3 p = position;
          p.y += t * 4.0;
          p.x += sin(seed * 40.0 + time * 0.7) * t * 1.6;
          p.z += cos(seed * 23.0 + time * 0.6) * t * 1.6;
          vA = smoothstep(0.0, 0.15, t) * (1.0 - t);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = min(100.0, (0.8 + t * 2.0) * scale / max(0.5, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float strength;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - d), 1.6) * vA * 0.32 * strength;
          gl_FragColor = vec4(vec3(a), 1.0);
        }`,
    }),
  )
  const mist = new Points(mistGeo, mistMat)
  mist.frustumCulled = false
  mist.layers.set(LAYER_NO_REFLECT)

  // ---------- 平面反射：把镜头沿海面（y = 0）翻到水下，再往上看
  const reflCam = new PerspectiveCamera()
  reflCam.layers.set(0)
  const clip = [new Plane(new Vector3(0, 1, 0), 0.05)]
  const v = new Vector3()
  const look = new Vector3()
  const up = new Vector3()
  const bias = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)

  let frames = 0
  function renderReflection(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    // 头几帧阴影贴图还没建好，先不画倒影
    if (!kit.high || frames++ < 3) return
    camera.getWorldPosition(v)
    if (v.y < 0.2) return
    camera.getWorldDirection(look).add(v)
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    reflCam.position.set(v.x, -v.y, v.z)
    reflCam.up.set(up.x, -up.y, up.z)
    reflCam.lookAt(look.x, -look.y, look.z)
    reflCam.fov = camera.fov
    reflCam.aspect = camera.aspect
    reflCam.near = camera.near
    reflCam.far = camera.far
    reflCam.updateProjectionMatrix()
    reflCam.updateMatrixWorld()
    textureMatrix.copy(bias).multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse)

    const prevTarget = renderer.getRenderTarget()
    const prevClip = renderer.clippingPlanes
    const prevShadow = renderer.shadowMap.autoUpdate
    renderer.clippingPlanes = clip
    renderer.shadowMap.autoUpdate = false
    renderer.setRenderTarget(reflTarget)
    renderer.clear()
    renderer.render(scene, reflCam)
    renderer.setRenderTarget(prevTarget)
    renderer.clippingPlanes = prevClip
    renderer.shadowMap.autoUpdate = prevShadow
    seaMat.uniforms.reflOn!.value = 1
  }

  return {
    sea,
    river,
    mist,
    renderReflection,
    setFog(near, far) {
      seaMat.uniforms.fogNear!.value = near * 2.2
      seaMat.uniforms.fogFar!.value = Math.max(far * 3, 260)
      riverMat.uniforms.fogNear!.value = near
      riverMat.uniforms.fogFar!.value = far
    },
    setSize(w, h) {
      const scale = Math.min(0.5, 960 / Math.max(w, h))
      reflTarget.setSize(Math.max(1, Math.floor(w * scale)), Math.max(1, Math.floor(h * scale)))
      seaMat.uniforms.reflOn!.value = 0
    },
    setEnv(e) {
      for (const m of [seaMat, riverMat]) {
        const u = m.uniforms
        u.shallow!.value.copy(e.shallow)
        u.deep!.value.copy(e.deep)
        u.foam!.value.copy(e.foam)
        u.fogColor!.value.copy(e.fog)
        u.sparkle!.value = e.sparkle
        u.sunDir!.value.copy(e.sunDir)
        u.sunColor!.value.copy(e.sunColor)
        u.skyZenith!.value.copy(e.zenith)
        u.skyHorizon!.value.copy(e.horizon)
        u.rain!.value = e.rain
        u.winter!.value = e.winter
      }
      seaMat.uniforms.fogNear!.value = e.fogNear * 2.2
      seaMat.uniforms.fogFar!.value = Math.max(e.fogFar * 3, 260)
      riverMat.uniforms.fogNear!.value = e.fogNear
      riverMat.uniforms.fogFar!.value = e.fogFar
    },
  }
}
