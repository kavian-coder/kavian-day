/**
 * 天空：渐变穹顶、太阳和月亮、云、远岛剪影、海鸥、星星。
 * 云直接画在天空穹顶上（跟着镜头走，等于在无限远处），所以永远不会和岛上的东西穿插：
 * - 头顶的积云：投影到一个高空平面上的噪声，边缘清楚，向阳一侧亮、厚的地方暗
 * - 海平线上的积雨云：一团团圆形的“云泡”叠起来，上亮下暗、底部平，是夏日动画里的经典画法
 */
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import type { Kit } from './kit'
import { fbm, rng } from './noise'

export interface Sky {
  group: Group
  /** 跟着镜头走的部分（穹顶、星星） */
  dome: Group
  setColors: (o: {
    zenith: Color
    horizon: Color
    sun: Color
    sunDir: Vector3
    sunVis: number
    moonDir: Vector3
    moonVis: number
    cloudLit: Color
    cloudShade: Color
    haze: Color
    mountain: Color
    stars: number
    /** 云量 0–1 */
    cover: number
    /** 海平线积雨云的大小 0–1（夏天最大） */
    towers: number
  }) => void
  update: (dt: number, t: number) => void
  /** 海鸥只在白天、不刮暴风时出来 */
  setGulls: (n: number) => void
}

export function createSky(kit: Kit): Sky {
  const group = new Group()
  const dome = new Group()
  const R = rng(77)

  const skyMat = kit.track(
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: new Color() },
        horizon: { value: new Color() },
        sunColor: { value: new Color() },
        sunDir: { value: new Vector3(0, 1, 0) },
        sunVis: { value: 1 },
        moonDir: { value: new Vector3(0, 1, 0) },
        moonVis: { value: 0 },
        cloudLit: { value: new Color() },
        cloudShade: { value: new Color() },
        cover: { value: 0.45 },
        towers: { value: 1 },
        time: kit.time,
        wind: kit.wind,
      },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 sunDir; uniform float sunVis; uniform vec3 moonDir; uniform float moonVis;
        uniform vec3 cloudLit; uniform vec3 cloudShade; uniform float cover; uniform float towers; uniform float time; uniform float wind;
        varying vec3 vDir;
        float hash1(float n) { return fract(sin(n) * 43758.5453); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float s = 0.0; float a = 0.5;
          for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
          return s;
        }
        float adiff(float a, float b) { float d = a - b; return atan(sin(d), cos(d)); }

        // 头顶的积云
        vec4 layerClouds(vec3 d, vec2 sun2) {
          if (d.y <= 0.0) return vec4(0.0);
          vec2 p = d.xz / (d.y + 0.1) * 0.6 + vec2(time * 0.006 * wind, time * 0.0022);
          float n = fbm(p);
          float thr = mix(0.7, 0.36, cover);
          float a = smoothstep(thr, thr + 0.03, n);
          if (a <= 0.0) return vec4(0.0);
          // 向阳一侧薄、亮；云心厚、暗
          float toward = fbm(p + sun2 * 0.09);
          float lit = clamp(0.5 + (n - toward) * 6.0, 0.0, 1.0);
          float core = smoothstep(thr + 0.04, thr + 0.22, n);
          vec3 col = mix(cloudLit, cloudShade, core * 0.6);
          col = mix(col, cloudLit * 1.06, lit * 0.55 * (1.0 - core * 0.5));
          col = mix(col, horizon, (1.0 - smoothstep(0.05, 0.35, d.y)) * 0.45);
          return vec4(col, a * smoothstep(0.035, 0.16, d.y));
        }

        // 海平线上的积雨云：每座由十几个圆形“云泡”叠成
        vec4 towerClouds(vec3 d, float sunSide) {
          float az = atan(d.z, d.x);
          float e = asin(clamp(d.y, -1.0, 1.0));
          if (e > 0.42 || e < -0.03) return vec4(0.0);
          vec4 acc = vec4(0.0);
          vec2 L = normalize(vec2(sunSide * 0.7, 1.0));
          for (int k = 0; k < 6; k++) {
            float fk = float(k);
            float c = hash1(fk * 12.9 + 1.0) * 6.2832;
            float W = (0.07 + hash1(fk * 4.1) * 0.08) * (0.6 + 0.4 * towers);
            float H = (0.06 + hash1(fk * 7.3) * 0.2) * towers;
            float u = adiff(az, c);
            if (abs(u) > W * 1.8 || H < 0.01) continue;
            for (int j = 0; j < 14; j++) {
              float fj = float(j);
              float t = fj / 13.0;
              float px = (hash1(fk * 31.0 + fj * 1.7) - 0.5) * W * 2.0 * (1.0 - 0.55 * t);
              float py = H * t * 0.92;
              float r = W * (0.42 - 0.18 * t) * (0.75 + 0.5 * hash1(fk * 17.0 + fj * 2.3));
              vec2 q = vec2(u - px, e - py);
              float dist = length(q);
              if (dist > r) continue;
              if (e < -0.005) continue;
              vec2 nrm = q / r;
              float sh = smoothstep(-0.25, 0.35, dot(nrm, L));
              vec3 col = mix(cloudShade, cloudLit, sh);
              // 越往下越灰，底部平
              col = mix(col, cloudShade * 0.92, (1.0 - smoothstep(0.0, H * 0.3 + 0.01, e)) * 0.5);
              col = mix(col, horizon, 0.18 + 0.12 * (1.0 - t));
              // 外轮廓清楚，云泡之间的接缝柔一些
              float a = smoothstep(r, r - 0.0025, dist);
              float blendIn = acc.a > 0.0 ? smoothstep(r, r - 0.018, dist) : a;
              acc.rgb = mix(acc.rgb, col, blendIn);
              acc.a = max(acc.a, a);
            }
          }
          return acc;
        }

        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -1.0, 1.0);
          vec3 c = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5));
          c = mix(c, horizon * 1.06, (1.0 - smoothstep(0.0, 0.1, abs(h - 0.015))) * 0.5);
          float sd = max(dot(d, normalize(sunDir)), 0.0);
          // 太阳：大片柔光 + 一圈光环 + 很亮的日轮（亮到会被泛光晕开）
          c += sunColor * (pow(sd, 5.0) * 0.25 + pow(sd, 40.0) * 0.5 + pow(sd, 400.0) * 1.2) * sunVis;
          float ring = smoothstep(0.9955, 0.997, sd) * (1.0 - smoothstep(0.9975, 0.999, sd));
          c += sunColor * ring * 0.12 * sunVis;
          c = mix(c, vec3(1.0, 0.97, 0.88) * 3.2, smoothstep(0.99905, 0.99935, sd) * sunVis);
          // 月亮：带一点阴影的圆盘和淡淡的光晕
          float md = max(dot(d, normalize(moonDir)), 0.0);
          vec3 mside = normalize(cross(normalize(moonDir), vec3(0.0, 1.0, 0.0)) + vec3(0.0001));
          float disc = smoothstep(0.99935, 0.9996, md);
          float shade = smoothstep(-0.25, 0.6, dot(d - normalize(moonDir) * md, mside) * 60.0);
          c += vec3(0.75, 0.82, 1.0) * pow(md, 60.0) * 0.18 * moonVis;
          c = mix(c, vec3(1.0, 0.98, 0.9) * mix(0.55, 1.6, shade), disc * moonVis);
          // 云盖在太阳、月亮前面
          vec3 sdir = normalize(sunDir);
          vec2 sun2 = normalize(sdir.xz + vec2(0.0001));
          float sunAz = atan(sdir.z, sdir.x);
          vec4 tw = towerClouds(d, sign(adiff(sunAz, atan(d.z, d.x)) + 0.0001));
          c = mix(c, tw.rgb, tw.a);
          vec4 lc = layerClouds(d, sun2);
          c = mix(c, lc.rgb, lc.a);
          // 太阳附近的云边被照亮
          c += sunColor * pow(sd, 24.0) * lc.a * 0.35 * sunVis;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  )
  const sky = new Mesh(kit.track(new SphereGeometry(900, 32, 16)), skyMat)
  sky.renderOrder = -10
  dome.add(sky)

  // 星星
  const starGeo = kit.track(new BufferGeometry())
  const starPos = new Float32Array(900 * 3)
  for (let i = 0; i < 900; i++) {
    const th = R() * Math.PI * 2
    const y = 0.08 + R() * 0.92
    const r = Math.sqrt(1 - y * y)
    starPos.set([Math.cos(th) * r * 850, y * 850, Math.sin(th) * r * 850], i * 3)
  }
  starGeo.setAttribute('position', new BufferAttribute(starPos, 3))
  const starMat = kit.track(new PointsMaterial({ color: 0xffffff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }))
  dome.add(new Points(starGeo, starMat))

  // 远山剪影：北边两层，海上一座远岛
  const ridgeMat = (layer: number) =>
    kit.track(
      new ShaderMaterial({
        fog: false,
        uniforms: { top: { value: new Color() }, bottom: { value: new Color() }, layer: { value: layer } },
        vertexShader: /* glsl */ `attribute float k; varying float vK; void main(){ vK = k; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `uniform vec3 top; uniform vec3 bottom; varying float vK; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(0.0, 0.9, vK)), 1.0); }`,
      }),
    )
  const ridges: { mat: ShaderMaterial; layer: number }[] = []
  const ridge = (z: number, x0: number, x1: number, base: number, amp: number, freq: number, seed: number, layer: number, curve = 0) => {
    const pos: number[] = []
    const k: number[] = []
    const idx: number[] = []
    const n = Math.ceil((x1 - x0) / 6)
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n
      const zz = z + curve * (x / 400) ** 2 * 100
      const top = base + amp * Math.max(0.05, 0.55 + fbm(x * freq + seed, seed, 5))
      pos.push(x, -30, zz, x, top, zz)
      k.push(0, 1)
      if (i > 0) {
        const a = (i - 1) * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const g = kit.track(new BufferGeometry())
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    g.setAttribute('k', new Float32BufferAttribute(k, 1))
    g.setIndex(idx)
    const mat = ridgeMat(layer)
    ridges.push({ mat, layer })
    const m = new Mesh(g, mat)
    m.material.side = DoubleSide
    group.add(m)
  }
  // 海平线上几座远岛：一条朝向中心的剪影带
  for (const [ang, dist, w, h, seed, layer] of [
    [-1.9, 520, 260, 70, 3, 0.75],
    [-1.25, 640, 320, 95, 9, 0.85],
    [-2.6, 600, 200, 45, 21, 0.85],
    [0.35, 560, 140, 28, 5, 0.88],
    [2.75, 580, 180, 36, 13, 0.88],
  ] as const) {
    const before = group.children.length
    ridge(0, -w / 2, w / 2, -6, h, 4 / w, seed, layer)
    const m = group.children[before]!
    // 两头压低，像一座岛的轮廓
    const pos = (m as Mesh).geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setY(i, -6 + (pos.getY(i) + 6) * Math.pow(Math.sin(((pos.getX(i) / w) + 0.5) * Math.PI), 0.7))
    pos.needsUpdate = true
    m.position.set(Math.cos(ang) * dist, 0, Math.sin(ang) * dist - 40)
    m.rotation.y = Math.PI / 2 - ang
  }

  // 海鸥
  const gullMat = kit.toon('#FFFFFF', { side: DoubleSide })
  const wingGeo = kit.track(new BufferGeometry())
  // 一边翅膀两段，折成海鸥的“M”形
  wingGeo.setAttribute('position', new Float32BufferAttribute([0, 0, -0.18, 0, 0, 0.22, 0.5, 0.18, 0.02, 0.5, 0.18, 0.02, 0, 0, 0.22, 0.5, 0.18, -0.12, 0.5, 0.18, 0.02, 0.5, 0.18, -0.12, 1.05, -0.05, -0.2], 3))
  wingGeo.computeVertexNormals()
  const gulls = Array.from({ length: 7 }, (_, i) => {
    const g = new Group()
    const l = new Mesh(wingGeo, gullMat)
    const r = new Mesh(wingGeo, gullMat)
    r.scale.x = -1
    g.add(l, r)
    g.userData = { l, r, cx: -40 + R() * 90, cz: 52 + R() * 40, rad: 9 + R() * 14, h: 15 + R() * 10, sp: 0.18 + R() * 0.12, ph: R() * 6, dir: i % 2 ? 1 : -1 }
    group.add(g)
    return g
  })

  return {
    group,
    dome,
    setColors(o) {
      skyMat.uniforms.zenith!.value.copy(o.zenith)
      skyMat.uniforms.horizon!.value.copy(o.horizon)
      skyMat.uniforms.sunColor!.value.copy(o.sun)
      skyMat.uniforms.sunDir!.value.copy(o.sunDir)
      skyMat.uniforms.sunVis!.value = o.sunVis
      skyMat.uniforms.moonDir!.value.copy(o.moonDir)
      skyMat.uniforms.moonVis!.value = o.moonVis
      skyMat.uniforms.cloudLit!.value.copy(o.cloudLit)
      skyMat.uniforms.cloudShade!.value.copy(o.cloudShade).lerp(o.cloudLit, 0.2).lerp(o.zenith, 0.12)
      skyMat.uniforms.cover!.value = o.cover
      skyMat.uniforms.towers!.value = o.towers
      for (const r of ridges) {
        r.mat.uniforms.top!.value.copy(o.mountain).lerp(o.haze, r.layer)
        r.mat.uniforms.bottom!.value.copy(o.haze).lerp(o.horizon, 0.3)
      }
      starMat.opacity = o.stars
    },
    setGulls(n) {
      gulls.forEach((g, i) => (g.visible = i < n))
    },
    update(dt, t) {
      void dt
      for (const g of gulls) {
        const u = g.userData as { l: Mesh; r: Mesh; cx: number; cz: number; rad: number; h: number; sp: number; ph: number; dir: number }
        const a = t * u.sp * u.dir + u.ph
        g.position.set(u.cx + Math.cos(a) * u.rad, u.h + Math.sin(t * 0.7 + u.ph) * 1.2, u.cz + Math.sin(a) * u.rad)
        g.rotation.y = Math.atan2(-u.dir * Math.sin(a), u.dir * Math.cos(a))
        g.rotation.z = u.dir * 0.25
        const flap = Math.sin(t * 7 + u.ph) * 0.45 * (Math.sin(t * 0.8 + u.ph) > 0.2 ? 1 : 0.15)
        u.l.rotation.z = flap
        u.r.rotation.z = -flap
      }
    },
  }
}
