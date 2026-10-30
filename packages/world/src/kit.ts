/** 各个模块共用的东西：三渲二材质、风、时间、统一释放。 */
import {
  BufferAttribute,
  Color,
  DataTexture,
  Matrix4,
  Mesh,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  Vector3,
  type BufferGeometry,
  type ColorRepresentation,
  type Material,
  type MeshToonMaterialParameters,
  type Object3D,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export interface Kit {
  high: boolean
  gradientMap: DataTexture
  /** 秒，所有着色器共用 */
  time: { value: number }
  /** 风力 0–2，跟着天气变 */
  wind: { value: number }
  track: <T extends { dispose: () => void }>(x: T) => T
  toon: (color: ColorRepresentation, extra?: MeshToonMaterialParameters) => MeshToonMaterial
  /** 给材质加上随风摆动：离 base 越高摆得越多。 */
  sway: (m: MeshToonMaterial, amount: number, base?: number) => MeshToonMaterial
  /** 给材质加一层程序化的表面花纹（不用贴图），scale 是花纹的疏密 */
  pattern: (m: MeshToonMaterial, kind: Pattern, scale?: number, strength?: number) => MeshToonMaterial
  /** 往着色器里插代码；同一个材质可以叠好几层 */
  patch: (m: MeshToonMaterial, key: string, fn: (shader: Shader) => void) => MeshToonMaterial
  disposeAll: () => void
}

export type Pattern = 'plaster' | 'plank' | 'roof' | 'stone' | 'paving' | 'wood' | 'metal' | 'gravel' | 'panel' | 'bark'
type Shader = { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }

/** 着色器里共用的噪声函数 */
export const GLSL_NOISE = /* glsl */ `
float kvHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float kvNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(kvHash(i), kvHash(i + vec2(1, 0)), f.x), mix(kvHash(i + vec2(0, 1)), kvHash(i + vec2(1, 1)), f.x), f.y);
}
float kvFbm(vec2 p) { return kvNoise(p) * 0.5 + kvNoise(p * 2.03 + 7.1) * 0.3 + kvNoise(p * 4.1 - 3.7) * 0.2; }
vec2 kvCell(vec2 p) {
  // 返回 (到最近格点的距离, 到第二近的距离)
  vec2 i = floor(p); vec2 f = fract(p); float d1 = 9.0; float d2 = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(kvHash(i + g), kvHash(i + g + 19.7));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(d1, d2);
}
`

const PATTERN_GLSL: Record<Pattern, string> = {
  // 墙面灰泥：大块的深浅 + 细小斑点
  plaster: `k = 0.95 + 0.07 * kvFbm(uv * 0.6) - 0.05 * step(0.82, kvNoise(uv * 9.0));`,
  // 横向木板：板缝、每块板的深浅、木纹
  plank: `float row = floor(uv.y * 2.6); float fy = fract(uv.y * 2.6);
    k = 0.9 + 0.12 * kvHash(vec2(row, 3.0)) + 0.05 * kvNoise(vec2(uv.x * 0.8, row * 7.0 + uv.y * 30.0));
    k *= mix(0.72, 1.0, smoothstep(0.0, 0.08, fy) * smoothstep(1.0, 0.94, fy));`,
  // 瓦：一排排横瓦，上下错缝
  roof: `float row = floor(uv.y * 2.2); float fy = fract(uv.y * 2.2);
    float fx = fract(uv.x * 1.3 + kvHash(vec2(row, 1.0)) * 0.5 + row * 0.5);
    k = 0.92 + 0.1 * kvHash(vec2(row, floor(uv.x * 1.3 + row * 0.5)));
    k *= mix(0.74, 1.0, smoothstep(0.0, 0.12, fy)) * mix(0.86, 1.0, smoothstep(0.0, 0.05, fx) * smoothstep(1.0, 0.95, fx));
    k *= 1.0 + 0.08 * smoothstep(0.55, 0.95, fy);`,
  // 石块：不规则的石缝
  stone: `vec2 c = kvCell(uv * 1.1); k = mix(0.68, 1.0, smoothstep(0.02, 0.12, c.y - c.x)) * (0.9 + 0.12 * kvHash(floor(uv * 1.1 + c.x)));
    k *= 0.95 + 0.08 * kvNoise(uv * 6.0);`,
  // 地砖
  paving: `vec2 g = uv * 0.9; g.x += floor(g.y) * 0.5; vec2 f = fract(g);
    float e = smoothstep(0.0, 0.05, f.x) * smoothstep(1.0, 0.95, f.x) * smoothstep(0.0, 0.05, f.y) * smoothstep(1.0, 0.95, f.y);
    k = mix(0.8, 1.0, e) * (0.93 + 0.09 * kvHash(floor(g)));`,
  // 木头（顺着长边的纹）
  wood: `k = 0.9 + 0.08 * kvNoise(vec2(uv.x * 0.6, uv.y * 14.0)) + 0.05 * kvNoise(uv * 3.0);`,
  // 金属：竖向细划痕
  metal: `k = 0.95 + 0.06 * kvNoise(vec2(uv.x * 20.0, uv.y * 0.6));`,
  // 碎石
  gravel: `vec2 c = kvCell(uv * 5.0); k = 0.8 + 0.3 * kvHash(floor(uv * 5.0 + c.x * 3.0)) * smoothstep(0.0, 0.3, c.y - c.x);`,
  // 车身：竖向接缝
  panel: `float fx = fract(uv.x * 0.7); k = mix(0.86, 1.0, smoothstep(0.0, 0.02, fx) * smoothstep(1.0, 0.98, fx)) * (0.97 + 0.04 * kvNoise(uv * 2.0));`,
  // 树皮：竖纹
  bark: `k = 0.82 + 0.25 * kvNoise(vec2(uv.x * 9.0, uv.y * 1.2));`,
}

function toonGradient(): DataTexture {
  // 三级色阶：暗部、中间、亮部。暗部不压太黑，像动画里只有一层影子色。
  const data = new Uint8Array([140, 205, 255])
  const tex = new DataTexture(data, data.length, 1, RedFormat)
  tex.minFilter = NearestFilter
  tex.magFilter = NearestFilter
  tex.needsUpdate = true
  return tex
}

export function createKit(high: boolean): Kit {
  const disposables: { dispose: () => void }[] = []
  const track = <T extends { dispose: () => void }>(x: T) => {
    disposables.push(x)
    return x
  }
  const gradientMap = track(toonGradient())
  const time = { value: 0 }
  const wind = { value: 1 }
  const toon = (color: ColorRepresentation, extra: MeshToonMaterialParameters = {}) =>
    track(new MeshToonMaterial({ color, gradientMap, ...extra }))
  // 同一个材质可以叠多个补丁（摆动 + 花纹 + 公告板……），按顺序执行
  const patch = (m: MeshToonMaterial, key: string, fn: (shader: Shader) => void) => {
    const list = ((m.userData.patches as { key: string; fn: (s: Shader) => void }[] | undefined) ??= [])
    list.push({ key, fn })
    m.onBeforeCompile = (shader) => {
      for (const p of list) p.fn(shader as unknown as Shader)
    }
    m.customProgramCacheKey = () => list.map((p) => p.key).join('|')
    return m
  }
  const pattern = (m: MeshToonMaterial, kind: Pattern, scale = 1, strength = 1) =>
    patch(m, `pat_${kind}_${scale}_${strength}`, (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec3 kvWP;\nvarying vec3 kvWN;\nvoid main() {')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          // 用物体自己的坐标：房子转了方向，瓦和木板也跟着转
          kvWP = transformed;
          kvWN = normalize(objectNormal);`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `varying vec3 kvWP;\nvarying vec3 kvWN;\n${GLSL_NOISE}\nvoid main() {`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec3 an = abs(kvWN);
            // 选主轴投影：墙面用（水平方向, 高度），顶面用 xz
            vec2 uv = an.y > 0.75 ? kvWP.xz : (an.x > an.z ? kvWP.zy : kvWP.xy);
            uv *= ${scale.toFixed(3)};
            float k = 1.0;
            ${PATTERN_GLSL[kind]}
            diffuseColor.rgb *= mix(1.0, k, ${strength.toFixed(3)});
          }`,
        )
    })
  const sway = (m: MeshToonMaterial, amount: number, base = 0) =>
    patch(m, `sway${amount}_${base}`, (shader) => {
      shader.uniforms.uTime = time
      shader.uniforms.uWind = wind
      shader.vertexShader =
        'uniform float uTime;\nuniform float uWind;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float swH = max(transformed.y - ${base.toFixed(3)}, 0.0);
          vec2 swP = vec2(0.0);
          #ifdef USE_INSTANCING
            swP = instanceMatrix[3].xz;
          #endif
          float swA = ${amount.toFixed(4)} * uWind * swH * swH;
          float swT = uTime * (1.2 + 0.4 * uWind);
          transformed.x += (sin(swT + swP.x * 0.31 + swP.y * 0.17) + 0.4 * sin(swT * 2.3 + swP.y)) * swA;
          transformed.z += cos(swT * 0.8 + swP.x * 0.2 - swP.y * 0.29) * swA * 0.6;`,
        )
    })
  return {
    high,
    gradientMap,
    time,
    wind,
    track,
    toon,
    sway,
    pattern,
    patch,
    disposeAll: () => {
      for (const d of disposables) d.dispose()
      disposables.length = 0
    },
  }
}

/** 把法线改成从中心向外：一团叶子像一个整体那样受光，是动画背景里树的常见画法。 */
export function spherize(geo: BufferGeometry, center = new Vector3(), amount = 1, squashY = 1) {
  const pos = geo.getAttribute('position')
  const nor = geo.getAttribute('normal')
  const v = new Vector3()
  const n = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(center)
    v.y *= squashY
    v.normalize()
    n.fromBufferAttribute(nor, i).lerp(v, amount).normalize()
    nor.setXYZ(i, n.x, n.y, n.z)
  }
  nor.needsUpdate = true
  return geo
}

/** 按高度刷一层顶点色：底部暗、顶部亮。 */
export function gradeY(geo: BufferGeometry, y0: number, y1: number, bottom: number, top = 1) {
  const pos = geo.getAttribute('position')
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0)))
    const k = bottom + (top - bottom) * t
    col.set([k, k, k], i * 3)
  }
  geo.setAttribute('color', new BufferAttribute(col, 3))
  return geo
}

/** 给整块几何体刷一个固定顶点色（合并不同颜色的零件时用）。 */
export function paint(geo: BufferGeometry, color: ColorRepresentation) {
  const c = new Color(color)
  const n = geo.getAttribute('position').count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3)
  geo.setAttribute('color', new BufferAttribute(col, 3))
  return geo
}

/**
 * 把一组不会动的网格按材质合并成少数几个网格，减少绘制次数。
 * 只合并普通 Mesh（不动 InstancedMesh、Points、Line）；合并后原来的子物体从 root 里移除。
 */
export function mergeStatic(root: Object3D, track: <T extends { dispose: () => void }>(x: T) => T) {
  root.updateMatrixWorld(true)
  const inv = new Matrix4().copy(root.matrixWorld).invert()
  const byMat = new Map<Material, { geos: BufferGeometry[]; cast: boolean }>()
  const remove: Object3D[] = []
  root.traverse((o) => {
    const m = o as Mesh
    let ancestor: Object3D | null = o
    while (ancestor && ancestor !== root) {
      if (ancestor.userData.dynamic) return
      ancestor = ancestor.parent
    }
    if (!m.isMesh || (m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh || Array.isArray(m.material)) return
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()) as BufferGeometry
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k)
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    g.applyMatrix4(new Matrix4().multiplyMatrices(inv, m.matrixWorld))
    const e = byMat.get(m.material) ?? { geos: [], cast: false }
    e.geos.push(g)
    e.cast ||= m.castShadow
    byMat.set(m.material, e)
    remove.push(m)
  })
  for (const m of remove) m.parent?.remove(m)
  for (const [mat, e] of byMat) {
    // 有的带顶点色、有的不带：统一补成白色
    const withColor = e.geos.some((g) => g.getAttribute('color'))
    if (withColor)
      for (const g of e.geos)
        if (!g.getAttribute('color')) g.setAttribute('color', new BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3))
    const merged = mergeGeometries(e.geos)
    e.geos.forEach((g) => g.dispose())
    if (!merged) continue
    track(merged)
    const mesh = new Mesh(merged, mat)
    mesh.castShadow = e.cast
    mesh.receiveShadow = true
    // 合并后的网格包围盒很大，不能拿来当房子的包围盒或者小物件的碰撞体
    mesh.userData.merged = true
    root.add(mesh)
  }
}
