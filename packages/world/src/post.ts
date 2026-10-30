/**
 * 后期：先把场景画到一张离屏图（带深度），再用全屏着色器加上
 * - 彩色描边：按深度跳变找轮廓，线色取自底色压暗，像动画里的彩色线
 * - 环境光遮蔽（AO）：物体相接的缝里、墙脚、树下压暗一点，画面更有体积
 * - 云影：从深度还原出世界坐标，地上飘过大块的云的影子
 * - 泛光：亮处（灯、阳光下的水花）向外晕开
 * - 调色和暗角
 */
import {
  Color,
  DepthTexture,
  HalfFloatType,
  UnsignedByteType,
  LinearFilter,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three'
import { GLSL_NOISE, type Kit } from './kit'

export interface Post {
  setSize: (w: number, h: number) => void
  render: (scene: Scene, camera: PerspectiveCamera) => void
  setGrade: (grade: Color, lines: number, saturation: number) => void
  /** 云影强度 0–1、泛光强度 */
  setMood: (o: { cloudShadow: number; bloom: number; shadowTint: Color }) => void
}

const QUAD_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`

export function createPost(kit: Kit, renderer: WebGLRenderer): Post {
  // Safari/Intel drivers may expose float attachments but fail float MSAA resolves.
  const safari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent)
  const hdr = !safari && renderer.extensions.has('EXT_color_buffer_float')
  const targetType = hdr ? HalfFloatType : UnsignedByteType
  const target = kit.track(
    new WebGLRenderTarget(1, 1, {
      type: targetType,
      samples: hdr && kit.high ? 4 : 0,
      depthTexture: new DepthTexture(1, 1),
    }),
  )
  // 泛光：四分之一分辨率，提亮部 → 横向模糊 → 纵向模糊
  const bloomA = kit.track(new WebGLRenderTarget(1, 1, { type: targetType, minFilter: LinearFilter, magFilter: LinearFilter }))
  const bloomB = kit.track(new WebGLRenderTarget(1, 1, { type: targetType, minFilter: LinearFilter, magFilter: LinearFilter }))

  const brightMat = kit.track(
    new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { tColor: { value: target.texture }, threshold: { value: 1.0 } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `uniform sampler2D tColor; uniform float threshold; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tColor, vUv).rgb; float l = max(c.r, max(c.g, c.b));
          gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.35, l), 1.0); }`,
    }),
  )
  const blurMat = kit.track(
    new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { tSrc: { value: null }, dir: { value: new Vector2(1, 0) } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `uniform sampler2D tSrc; uniform vec2 dir; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
          c += (texture2D(tSrc, vUv + dir * 1.385).rgb + texture2D(tSrc, vUv - dir * 1.385).rgb) * 0.316;
          c += (texture2D(tSrc, vUv + dir * 3.231).rgb + texture2D(tSrc, vUv - dir * 3.231).rgb) * 0.07;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  )

  const mat = kit.track(
    new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: target.texture },
        tDepth: { value: target.depthTexture },
        tBloom: { value: bloomB.texture },
        res: { value: new Vector2(1, 1) },
        near: { value: 0.5 },
        far: { value: 1200 },
        grade: { value: new Color(1, 1, 1) },
        lines: { value: 1 },
        sat: { value: 1.08 },
        px: { value: 1 },
        projInv: { value: new Matrix4() },
        viewInv: { value: new Matrix4() },
        time: kit.time,
        wind: kit.wind,
        cloudShadow: { value: 1 },
        bloom: { value: 0.6 },
        shadowTint: { value: new Color(0.75, 0.8, 0.95) },
        aoOn: { value: kit.high ? 1 : 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tBloom;
        uniform vec2 res; uniform float near; uniform float far;
        uniform vec3 grade; uniform float lines; uniform float sat; uniform float px;
        uniform mat4 projInv; uniform mat4 viewInv; uniform float time; uniform float wind;
        uniform float cloudShadow; uniform float bloom; uniform vec3 shadowTint; uniform float aoOn;
        varying vec2 vUv;
        ${GLSL_NOISE}
        float rawDepth(vec2 uv) { return texture2D(tDepth, uv).x; }
        float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
        float linAt(vec2 uv) { return lin(rawDepth(uv)); }
        vec3 worldPos(vec2 uv, float d) {
          vec4 v = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          v /= v.w;
          return (viewInv * v).xyz;
        }
        void main() {
          vec3 col = texture2D(tColor, vUv).rgb;
          float raw = rawDepth(vUv);
          float d0 = lin(raw);
          bool sky = raw > 0.99999;
          vec2 o = px / res;

          // ---- 描边
          float dl = linAt(vUv - vec2(o.x, 0.0));
          float dr = linAt(vUv + vec2(o.x, 0.0));
          float du = linAt(vUv + vec2(0.0, o.y));
          float dd = linAt(vUv - vec2(0.0, o.y));
          float lap = (dl + dr + du + dd - 4.0 * d0) / d0;
          float edge = smoothstep(0.03, 0.1, lap) * (1.0 - smoothstep(60.0, 200.0, d0));

          // ---- AO：在屏幕上一圈采样，前面有东西挡着就压暗
          float ao = 0.0;
          if (aoOn > 0.5 && !sky) {
            float rad = clamp(26.0 / d0, 1.5, 22.0);
            float range = 1.2 + d0 * 0.012;
            for (int i = 0; i < 8; i++) {
              float a = float(i) * 2.399 + kvHash(vUv * res) * 6.283;
              float r = (float(i) + 1.0) / 8.0;
              vec2 off = vec2(cos(a), sin(a)) * rad * r * o;
              float ds = linAt(vUv + off);
              float diff = d0 - ds;
              ao += smoothstep(0.03 * range, 0.25 * range, diff) * (1.0 - smoothstep(range, range * 2.5, diff));
            }
            ao = ao / 8.0;
          }
          col *= 1.0 - ao * 0.45;

          // ---- 云影
          if (!sky && cloudShadow > 0.0) {
            vec3 wp = worldPos(vUv, raw);
            vec2 q = wp.xz * 0.011 + vec2(time * 0.012 * wind, time * 0.004);
            float c = kvFbm(q) ;
            float sh = smoothstep(0.5, 0.62, c) * cloudShadow * (1.0 - smoothstep(150.0, 400.0, d0));
            col = mix(col, col * shadowTint, sh * 0.55);
          }

          // ---- 描边叠上去
          vec3 ink = col * vec3(0.42, 0.36, 0.40);
          col = mix(col, ink, edge * 0.8 * lines);

          // ---- 泛光
          col += texture2D(tBloom, vUv).rgb * bloom;

          // ---- 调色、暗角
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l), col, sat);
          col *= grade;
          vec2 q2 = vUv - 0.5;
          col *= 1.0 - dot(q2, q2) * 0.36;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  )
  const quad = new Mesh(kit.track(new PlaneGeometry(2, 2)), mat)
  quad.frustumCulled = false
  const scene2 = new Scene()
  scene2.add(quad)
  const cam2 = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const pass = (m: ShaderMaterial, out: WebGLRenderTarget | null) => {
    quad.material = m
    renderer.setRenderTarget(out)
    renderer.render(scene2, cam2)
  }

  return {
    setSize(w, h) {
      const pr = renderer.getPixelRatio()
      const W = Math.floor(w * pr)
      const H = Math.floor(h * pr)
      target.setSize(W, H)
      bloomA.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2))
      bloomB.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2))
      mat.uniforms.res!.value.set(W, H)
      mat.uniforms.px!.value = Math.max(1, pr * 0.9)
    },
    render(scene, camera) {
      mat.uniforms.near!.value = camera.near
      mat.uniforms.far!.value = camera.far
      mat.uniforms.projInv!.value.copy(camera.projectionMatrixInverse)
      mat.uniforms.viewInv!.value.copy(camera.matrixWorld)
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      // 泛光
      const bw = bloomA.width
      const bh = bloomA.height
      pass(brightMat, bloomA)
      blurMat.uniforms.tSrc!.value = bloomA.texture
      blurMat.uniforms.dir!.value.set(1.6 / bw, 0)
      pass(blurMat, bloomB)
      blurMat.uniforms.tSrc!.value = bloomB.texture
      blurMat.uniforms.dir!.value.set(0, 1.6 / bh)
      pass(blurMat, bloomA)
      blurMat.uniforms.tSrc!.value = bloomA.texture
      blurMat.uniforms.dir!.value.set(3.2 / bw, 0)
      pass(blurMat, bloomB)
      blurMat.uniforms.tSrc!.value = bloomB.texture
      blurMat.uniforms.dir!.value.set(0, 3.2 / bh)
      pass(blurMat, bloomA)
      mat.uniforms.tBloom!.value = bloomA.texture
      pass(mat, null)
    },
    setGrade(grade, lines, saturation) {
      mat.uniforms.grade!.value.copy(grade)
      mat.uniforms.lines!.value = lines
      mat.uniforms.sat!.value = saturation
    },
    setMood(o) {
      mat.uniforms.cloudShadow!.value = o.cloudShadow
      mat.uniforms.bloom!.value = o.bloom
      mat.uniforms.shadowTint!.value.copy(o.shadowTint)
    },
  }
}
