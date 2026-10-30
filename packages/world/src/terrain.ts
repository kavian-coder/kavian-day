/** 地形：一整块高度网格。顶点色按地面类型和季节刷，海边常夏，内陆和山里有四季。 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  RedFormat,
} from 'three'
import { GLSL_NOISE, type Kit, type Season } from './kit'
import { PATHS, RIVER, TERRAIN, distTo, heightAt, inlandFactor, railNear, shore, offshoreHeight } from './layout'
import { fbm, lerp, smoothstep } from './noise'

export interface Terrain {
  mesh: Mesh
  /** 高度图（半精度浮点），水面着色器用它算水深 */
  heightTex: DataTexture
  heightBounds: { minX: number; minZ: number; width: number; depth: number }
  /** 地面高度（双线性插值） */
  groundAt: (x: number, z: number) => number
  /** 某处的地面颜色（当前季节），草丛借用它来贴合地面 */
  colorAt: (x: number, z: number, target: Color) => Color
  setSeason: (s: Season) => void
  /** 湿润程度 0–1、天空色（水洼反射）、焦散强度（白天有太阳时强） */
  setWeather: (wet: number, sky: Color, caustics: number) => void
}

const C = (hex: string) => new Color(hex)
const SAND = C('#F1DDB2')
const WET_SAND = C('#D8BE8E')
const DIRT = C('#D9BD8F')
const GRAVEL = C('#B5AA98')
const ROCK = C('#8D9685')
const ROCK_DARK = C('#65796E')
const SNOW = C('#F3F6FA')
const RIVERBED = C('#B9B08C')
const SEA_SAND = C('#EEDDB4')
const REEF = C('#A79A72')
const REEF2 = C('#8E9C70')
const DEEP_SAND = C('#B8B39C')

const GRASS: Record<Season, [Color, Color]> = {
  spring: [C('#A9D774'), C('#86C463')],
  summer: [C('#86C35A'), C('#5FA84C')],
  autumn: [C('#D3BD6A'), C('#B98F4E')],
  winter: [C('#EDF1F5'), C('#DCE4EB')],
}
const FOREST_FLOOR: Record<Season, Color> = {
  spring: C('#6EA857'),
  summer: C('#4F9147'),
  autumn: C('#AE7A3F'),
  winter: C('#E1E8EE'),
}
const MOUNTAIN: Record<Season, Color> = {
  spring: C('#7FAE6A'),
  summer: C('#5E9A5A'),
  autumn: C('#B4864C'),
  winter: C('#E8EDF2'),
}

export function createTerrain(kit: Kit, forest: (x: number, z: number) => number): Terrain {
  const { minX, maxX, minZ, maxZ } = TERRAIN
  const seg = kit.high ? TERRAIN.seg : 170
  const N = seg + 1
  const dx = (maxX - minX) / seg
  const dz = (maxZ - minZ) / seg

  const heights = new Float32Array(N * N)
  const pos = new Float32Array(N * N * 3)
  // 每个顶点的“地面类型”数据，换季时直接重刷颜色，不用再算距离
  const pathD = new Float32Array(N * N)
  const railD = new Float32Array(N * N)
  const riverD = new Float32Array(N * N)
  const inland = new Float32Array(N * N)
  const forestK = new Float32Array(N * N)
  const varN = new Float32Array(N * N)
  const shoreD = new Float32Array(N * N)

  for (let j = 0; j < N; j++) {
    const z = minZ + j * dz
    for (let i = 0; i < N; i++) {
      const x = minX + i * dx
      const k = j * N + i
      const h = heightAt(x, z)
      heights[k] = h
      pos.set([x, h, z], k * 3)
      let pd = 3
      for (const p of PATHS) pd = Math.min(pd, distTo(x, z, p, pd))
      pathD[k] = pd
      const rn = railNear(x, z, 4)
      railD[k] = rn && rn.tunnel < 0.5 ? rn.d : 4
      shoreD[k] = shore(x, z)
      riverD[k] = distTo(x, z, RIVER, 5)
      inland[k] = inlandFactor(x, z)
      forestK[k] = forest(x, z)
      varN[k] = fbm(x * 0.18 + 40, z * 0.18) * 0.5 + 0.5
    }
  }
  const idx: number[] = []
  for (let j = 0; j < seg; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * N + i
      const b = a + 1
      const c = a + N
      const d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  const geo = kit.track(new BufferGeometry())
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const nor = geo.getAttribute('normal')
  const colors = new Float32Array(N * N * 3)
  geo.setAttribute('color', new BufferAttribute(colors, 3))

  const mat = kit.toon(0xffffff, { vertexColors: true })
  // 地面的笔触：大块深浅、斜向的刷痕、细颗粒，再在大片区域里轻轻偏黄或偏青，像水彩背景
  const uWet = { value: 0 }
  const uCaus = { value: 1 }
  const uSky = { value: new Color(0.8, 0.9, 1) }
  kit.patch(mat, 'terrain', (shader) => {
    shader.uniforms.uTime = kit.time
    shader.uniforms.uWet = uWet
    shader.uniforms.uCaus = uCaus
    shader.uniforms.uSky = uSky
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 kvWP;\nvarying vec3 kvNormal;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\nkvWP = transformed; kvNormal = normal;')
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `varying vec3 kvWP;\nvarying vec3 kvNormal;\nfloat kvPuddle = 0.0;\nuniform float uTime;\nuniform float uWet;\nuniform float uCaus;\nuniform vec3 uSky;\n${GLSL_NOISE}\nvoid main() {`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 p = kvWP.xz;
          mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
          float big = kvFbm(p * 0.07);
          float stroke = kvNoise((r * p) * vec2(1.3, 0.16));
          float stroke2 = kvNoise((r * p) * vec2(0.22, 1.6) + 9.0);
          float grain = kvNoise(p * 4.0);
          float k = 0.9 + 0.16 * big + 0.07 * (stroke - 0.5) + 0.05 * (stroke2 - 0.5) + 0.05 * (grain - 0.5);
          diffuseColor.rgb *= k;
          // Vertical strata use height, so cliff faces no longer stretch a horizontal ground texture.
          float cliff = (1.0 - smoothstep(0.45, 0.8, normalize(kvNormal).y)) * smoothstep(2.0, 9.0, kvWP.y);
          if (cliff > 0.001) {
            vec2 rockUV = vec2(kvWP.x * 0.65 + kvWP.z * 0.5, kvWP.y);
            float warp = kvNoise(rockUV * 0.28) * 1.6;
            float strata = kvNoise(vec2(rockUV.x * 0.7, (kvWP.y + warp) * 1.8));
            float fissure = smoothstep(0.70, 0.85, kvNoise(rockUV * vec2(2.5, 0.3)));
            vec3 rockColor = mix(vec3(0.25,0.30,0.27), vec3(0.46,0.49,0.41), strata * 0.35 + kvNoise(rockUV * 1.5) * 0.65);
            rockColor *= 1.0 - fissure * 0.3;
            float moss = smoothstep(0.49, 0.72, kvFbm(rockUV * 0.45 + 18.0)) * (0.4 + 0.6 * normalize(kvNormal).y);
            rockColor = mix(rockColor, vec3(0.19,0.33,0.19), moss * 0.7);
            diffuseColor.rgb = mix(diffuseColor.rgb, rockColor, cliff * 0.9);
          }
          float warm = smoothstep(0.5, 0.85, kvNoise(p * 0.025 + 5.0));
          float cool = smoothstep(0.55, 0.9, kvNoise(p * 0.03 - 11.0));
          diffuseColor.rgb *= mix(vec3(1.0), vec3(1.07, 1.03, 0.88), warm * 0.7) * mix(vec3(1.0), vec3(0.92, 1.0, 1.04), cool * 0.6);
          // 海底的焦散：水面折射出的一圈圈亮纹，跟着时间晃动
          float under = smoothstep(0.15, -0.5, kvWP.y) * (1.0 - smoothstep(-4.0, -9.0, kvWP.y)) * (1.0 - smoothstep(30.0, 120.0, length(vViewPosition)));
          if (under > 0.0) {
            vec2 cp = kvWP.xz * 0.5;
            vec2 c1 = kvCell(cp + vec2(uTime * 0.13, uTime * 0.09));
            vec2 c2 = kvCell(cp * 1.37 - vec2(uTime * 0.1, -uTime * 0.07) + 3.1);
            // 用 F2-F1 的平滑边缘，再相乘，得到交叉的细亮纹
            float e1 = 1.0 - smoothstep(0.0, 0.22, c1.y - c1.x);
            float e2 = 1.0 - smoothstep(0.0, 0.22, c2.y - c2.x);
            float caus = e1 * 0.8 + e2 * 0.8 + e1 * e2 * 1.5;
            diffuseColor.rgb += vec3(0.85, 1.0, 0.98) * caus * under * 0.28 * uCaus;
          }
          // 雨天：地面变深，低洼处有水洼
          kvPuddle = 0.0;
          if (uWet > 0.0 && kvWP.y > 0.3) {
            diffuseColor.rgb *= 1.0 - 0.18 * uWet;
            kvPuddle = smoothstep(0.62, 0.72, kvFbm(kvWP.xz * 0.12 + 4.0)) * uWet;
          }
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          // 水洼和湿地面反射天空：越斜着看越亮
          vec3 vdir = normalize(vViewPosition);
          float fres = pow(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 3.0);
          outgoingLight = mix(outgoingLight, uSky, kvPuddle * (0.35 + 0.6 * fres) + uWet * fres * 0.25);
        }
        #include <opaque_fragment>`,
      )
  })
  const mesh = new Mesh(geo, mat)
  mesh.receiveShadow = true

  // Extend only the underwater apron. Land keeps its existing resolution; the apron
  // has eight coarse rings and shares the material, adding one draw instead of a huge terrain.
  const padding = 64
  const extentX = dx * padding, extentZ = dz * padding
  const outerN = N + padding * 2
  const half = new Uint16Array(outerN * outerN)
  for (let j = 0; j < outerN; j++) for (let i = 0; i < outerN; i++) {
    const ci = i - padding, cj = j - padding
    const h = ci >= 0 && ci < N && cj >= 0 && cj < N
      ? heights[cj * N + ci]!
      : offshoreHeight(minX + ci * dx, minZ + cj * dz)
    half[j * outerN + i] = DataUtils.toHalfFloat(h)
  }
  const heightTex = kit.track(new DataTexture(half, outerN, outerN, RedFormat, HalfFloatType))
  heightTex.minFilter = heightTex.magFilter = LinearFilter
  heightTex.needsUpdate = true
  const heightBounds = { minX: minX - extentX, minZ: minZ - extentZ, width: maxX - minX + extentX * 2, depth: maxZ - minZ + extentZ * 2 }
  const apronPos: number[] = [], apronColors: number[] = [], apronIndex: number[] = []
  const border: [number, number, number][] = []
  for(let i=0;i<seg;i++) border.push([minX+i*dx,minZ,heights[i]!])
  for(let j=0;j<seg;j++) border.push([maxX,minZ+j*dz,heights[j*N+seg]!])
  for(let i=seg;i>0;i--) border.push([minX+i*dx,maxZ,heights[seg*N+i]!])
  for(let j=seg;j>0;j--) border.push([minX,minZ+j*dz,heights[j*N]!])
  const count=border.length, rings=8
  for(let r=0;r<=rings;r++) for(let i=0;i<count;i++) {
    const [bx,bz,bh]=border[i]!, t=r/rings
    const cx=(minX+maxX)/2, cz=(minZ+maxZ)/2
    const radius=Math.hypot((maxX-minX)/2,(maxZ-minZ)/2)+Math.min(extentX,extentZ)
    const vx=bx-cx,vz=bz-cz,length=Math.hypot(vx,vz)
    const x=lerp(bx,cx+vx/length*radius,t)
    const z=lerp(bz,cz+vz/length*radius,t)
    const h=r===0?bh:offshoreHeight(x,z)
    apronPos.push(x,h,z)
    const c=SEA_SAND.clone().lerp(DEEP_SAND,smoothstep(-4,-12,h));apronColors.push(c.r,c.g,c.b)
    if(r<rings){const a=r*count+i,b=r*count+(i+1)%count,c=a+count,d=b+count;apronIndex.push(a,b,c,b,d,c)}
  }
  const apronGeo=kit.track(new BufferGeometry())
  apronGeo.setAttribute('position',new BufferAttribute(new Float32Array(apronPos),3))
  apronGeo.setAttribute('color',new BufferAttribute(new Float32Array(apronColors),3))
  apronGeo.setIndex(apronIndex);apronGeo.computeVertexNormals()
  const apron=new Mesh(apronGeo,mat);apron.name='offshore-apron';apron.receiveShadow=true;mesh.add(apron)

  function groundAt(x: number, z: number) {
    const fx = Math.min(Math.max((x - minX) / dx, 0), seg - 0.0001)
    const fz = Math.min(Math.max((z - minZ) / dz, 0), seg - 0.0001)
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const u = fx - i
    const v = fz - j
    const k = j * N + i
    const h00 = heights[k]!
    const h10 = heights[k + 1]!
    const h01 = heights[k + N]!
    const h11 = heights[k + N + 1]!
    return lerp(lerp(h00, h10, u), lerp(h01, h11, u), v)
  }

  let season: Season = 'summer'
  const tmp = new Color()
  const grassC = new Color()

  function shade(k: number, s: Season, out: Color) {
    const x = pos[k * 3]!
    const z = pos[k * 3 + 2]!
    const h = heights[k]!
    const ny = nor.getY(k)
    const coast = 1 - inland[k]!
    const v = varN[k]!
    // 海岸仅保留少量常绿底色，四季变化覆盖全岛。
    const g = GRASS[s]
    const gs = GRASS.summer
    grassC.copy(g[0]).lerp(g[1], v)
    tmp.copy(gs[0]).lerp(gs[1], v)
    grassC.lerp(tmp, coast * 0.2)
    out.copy(grassC)
    // 林下更暗
    tmp.copy(FOREST_FLOOR[s]).lerp(FOREST_FLOOR.summer, coast * 0.2)
    out.lerp(tmp, smoothstep(0.25, 0.75, forestK[k]!) * 0.8)
    // 山坡
    tmp.copy(MOUNTAIN[s]).lerp(MOUNTAIN.summer, s === 'winter' ? 0.3 : 0.6)
    out.lerp(tmp, smoothstep(9, 16, h))
    // 沙滩
    const s2 = shoreD[k]!
    const beach = 1 - smoothstep(4.5, 8.5, s2 + v * 2)
    out.lerp(SAND, beach * (1 - smoothstep(6, 10, h)))
    if (h < 0.35) out.lerp(WET_SAND, smoothstep(0.35, -0.2, h))
    // 海底：浅处是亮沙，礁盘上一块块长着藻的礁石，深处偏灰
    if (h < 0) {
      out.lerp(SEA_SAND, smoothstep(0, -0.8, h))
      const reef = smoothstep(0.55, 0.7, fbm(x * 0.09 - 3, z * 0.09 + 8) * 0.5 + 0.5) * smoothstep(-8, -12, s2) * smoothstep(-34, -28, s2)
      out.lerp(v > 0.5 ? REEF : REEF2, reef * 0.85)
      out.lerp(DEEP_SAND, smoothstep(-4, -12, h))
    }
    // 河床和河岸
    out.lerp(RIVERBED, 1 - smoothstep(2.2, 3.6, riverD[k]!))
    // 铁路道砟
    out.lerp(GRAVEL, 1 - smoothstep(2.4, 3.2, railD[k]!))
    // 小路
    const pathK = 1 - smoothstep(0.9, 1.6 + v * 0.4, pathD[k]!)
    out.lerp(s === 'winter' ? tmp.copy(DIRT).lerp(SNOW, 0.55 * inland[k]!) : DIRT, pathK)
    // 陡坡露出岩石
    // 树林里的坡被树盖住，只有很陡的地方（石崖）才露出岩石
    const rock = smoothstep(0.8, 0.42, ny) * smoothstep(1.5, 4, h)
    out.lerp(v > 0.5 ? ROCK : ROCK_DARK, rock)
    // 雪：冬天内陆全白，春秋只剩高山顶
    const snowLine = 999 // A tropical 60 m ridge has no permanent spring/autumn snow cap.
    if (s === 'winter') {
      const k2 = inland[k]! * (1 - pathK * 0.5) * (1 - rock * 0.5) * smoothstep(0.2, 1, h)
      out.lerp(SNOW, k2 * 0.92)
    } else out.lerp(SNOW, smoothstep(snowLine, snowLine + 3, h + v * 2) * smoothstep(0.55, 0.75, ny))
    return out
  }

  function setSeason(s: Season) {
    season = s
    const c = new Color()
    for (let k = 0; k < N * N; k++) {
      shade(k, s, c)
      colors[k * 3] = c.r
      colors[k * 3 + 1] = c.g
      colors[k * 3 + 2] = c.b
    }
    geo.getAttribute('color').needsUpdate = true
  }
  setSeason(season)

  function colorAt(x: number, z: number, target: Color) {
    const i = Math.round(Math.min(Math.max((x - minX) / dx, 0), seg))
    const j = Math.round(Math.min(Math.max((z - minZ) / dz, 0), seg))
    const k = j * N + i
    return target.setRGB(colors[k * 3]!, colors[k * 3 + 1]!, colors[k * 3 + 2]!)
  }

  return {
    mesh,
    heightTex,
    heightBounds,
    groundAt,
    colorAt,
    setSeason,
    setWeather(wet, sky, caustics) {
      uWet.value = wet
      uSky.value.copy(sky)
      uCaus.value = caustics
    },
  }
}
