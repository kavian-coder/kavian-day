/**
 * 镜头：两种视角，V 键或界面按钮切换。
 *
 * 上帝视角（god）
 * - 左键拖动 / 单指拖动 / 触控板双指滑动：平移，像拖地图
 * - 右键或 Alt + 拖动 / 双指旋转：转方向，上下拖改俯仰（可以一直转到正上方往下看）
 * - 滚轮 / 捏合：缩放，最远能看到整座岛
 *
 * 角色视角（follow）
 * - 镜头跟在角色身后、略高于肩膀
 * - 拖动转视角，滚轮拉近拉远；镜头不会自己转
 *
 * 键盘只管走（WASD / 方向键，Shift 跑）和切换视角（V）；镜头方向只由鼠标 / 触控板控制。
 */
import { Vector3, type PerspectiveCamera } from 'three'

export type ViewMode = 'god' | 'follow'

export interface CameraRig {
  mode: ViewMode
  yaw: number
  pitch: number
  distance: number
  /** 镜头看着的点 */
  focus: Vector3
  /** true：焦点跟着角色；false：自由查看 */
  follow: boolean
  update: (dt: number, o: { target: Vector3; heading: number; moving: boolean; groundAt: (x: number, z: number) => number }) => void
  setMode: (m: ViewMode, heading?: number) => void
  recenter: () => void
  setDistance: (v: number) => void
  setPitch: (v: number) => void
  dispose: () => void
}

const LIMIT = { minX: -155, maxX: 195, minZ: -150, maxZ: 135 }
const RANGE: Record<ViewMode, { pitch: [number, number]; dist: [number, number] }> = {
  god: { pitch: [0.15, 1.56], dist: [10, 240] },
  follow: { pitch: [-0.2, 1.1], dist: [3.5, 22] },
}

export function createCameraRig(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  init: { mode: ViewMode; yaw: number; pitch: number; distance: number },
  onModeChange?: (m: ViewMode) => void,
): CameraRig {
  let goalDist = init.distance
  let goalPitch = init.pitch
  const rig: CameraRig = {
    mode: init.mode,
    yaw: init.yaw,
    pitch: init.pitch,
    distance: init.distance,
    focus: new Vector3(),
    follow: init.mode === 'follow',
    update,
    setMode,
    recenter: () => (rig.follow = true),
    setDistance: (v) => {
      goalDist = v
      rig.distance = v
    },
    setPitch: (v) => {
      goalPitch = v
      rig.pitch = v
    },
    dispose,
  }
  const right = new Vector3()
  const fwd = new Vector3()
  const clampPitch = (p: number) => Math.min(RANGE[rig.mode].pitch[1], Math.max(RANGE[rig.mode].pitch[0], p))
  const clampDist = (d: number) => Math.min(RANGE[rig.mode].dist[1], Math.max(RANGE[rig.mode].dist[0], d))

  function setMode(m: ViewMode, heading = rig.yaw - Math.PI) {
    if (m === rig.mode) return
    rig.mode = m
    if (m === 'follow') {
      rig.follow = true
      goalDist = 9
      goalPitch = 0.24
      rig.yaw = heading + Math.PI
    } else {
      goalDist = 80
      goalPitch = 1.0
    }
    onModeChange?.(m)
  }

  /** 屏幕上拖动 dx, dy 像素，地面跟着手走 */
  function panBy(dx: number, dy: number) {
    const perPx = (2 * goalDist * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, canvas.clientHeight)
    right.set(Math.cos(rig.yaw), 0, -Math.sin(rig.yaw))
    fwd.set(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw))
    const stretch = 1 / Math.max(0.35, Math.sin(rig.pitch))
    rig.focus.addScaledVector(right, -dx * perPx)
    rig.focus.addScaledVector(fwd, dy * perPx * stretch)
    rig.follow = false
  }
  function rotateBy(dx: number, dy: number) {
    rig.yaw -= dx * 0.005
    goalPitch = clampPitch(goalPitch + dy * 0.004)
  }
  function zoomBy(factor: number) {
    goalDist = clampDist(goalDist * factor)
  }
  /** 左键拖动：上帝视角平移，角色视角转镜头 */
  const primaryDrag = (dx: number, dy: number) => (rig.mode === 'god' ? panBy(dx, dy) : rotateBy(dx, dy))

  // ---------- 指针
  const pointers = new Map<number, { x: number; y: number }>()
  let mode: 'primary' | 'rotate' | null = null
  let pinch = { d: 0, a: 0, mx: 0, my: 0 }
  const twoFinger = () => {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]
    return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
  }
  const onPointerDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 2) pinch = twoFinger()
    mode = e.button === 2 || e.button === 1 || e.altKey || e.ctrlKey || e.metaKey ? 'rotate' : 'primary'
  }
  const onPointerMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    if (pointers.size >= 2) {
      const now = twoFinger()
      if (pinch.d > 0 && now.d > 0) zoomBy(pinch.d / now.d)
      let da = now.a - pinch.a
      da = Math.atan2(Math.sin(da), Math.cos(da))
      rig.yaw += da
      if (rig.mode === 'god') panBy(now.mx - pinch.mx, now.my - pinch.my)
      else rotateBy(0, now.my - pinch.my)
      pinch = now
      return
    }
    if (mode === 'rotate') rotateBy(dx, dy)
    else if (mode === 'primary') primaryDrag(dx, dy)
  }
  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    if (pointers.size === 0) mode = null
    if (pointers.size === 2) pinch = twoFinger()
  }
  const onContextMenu = (e: Event) => e.preventDefault()

  // ---------- 滚轮 / 触控板
  // 鼠标滚轮一格是 120 的整数倍；触控板是连续的小数值
  const isMouseWheel = (e: WheelEvent) => {
    const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0
    return e.deltaMode !== 0 || (legacy !== 0 && legacy % 120 === 0) || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY))
  }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (e.ctrlKey) zoomBy(Math.exp(e.deltaY * 0.012)) // 触控板捏合
    else if (isMouseWheel(e)) zoomBy(Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 200) * 0.0018))
    else if (e.shiftKey || rig.mode === 'follow') rotateBy(-e.deltaX, -e.deltaY * 0.6)
    else panBy(-e.deltaX, -e.deltaY) // 触控板双指滑动
  }
  // Safari 的触控板捏合
  let lastScale = 1
  const onGestureStart = (e: Event) => {
    e.preventDefault()
    lastScale = 1
  }
  const onGestureChange = (e: Event) => {
    e.preventDefault()
    const s = (e as Event & { scale: number }).scale
    zoomBy(lastScale / s)
    lastScale = s
  }
  let headingNow = 0
  const onKey = (e: KeyboardEvent) => {
    const el = document.activeElement
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
    if (e.key === 'v' || e.key === 'V') setMode(rig.mode === 'god' ? 'follow' : 'god', headingNow)
  }

  canvas.style.touchAction = 'none'
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('contextmenu', onContextMenu)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('gesturestart', onGestureStart)
  canvas.addEventListener('gesturechange', onGestureChange)
  window.addEventListener('keydown', onKey)

  const goal = new Vector3()
  function update(dt: number, o: { target: Vector3; heading: number; moving: boolean; groundAt: (x: number, z: number) => number }) {
    headingNow = o.heading
    const k = 1 - Math.pow(0.0005, dt)
    rig.distance += (goalDist - rig.distance) * k
    rig.pitch += (goalPitch - rig.pitch) * k
    if (rig.mode === 'follow') {
      rig.follow = true
      goal.copy(o.target).add(right.set(0, 0.4, 0))
      rig.focus.lerp(goal, 1 - Math.pow(0.00002, dt))
      // 镜头方向只由鼠标 / 触控板控制，不会自己转
    } else if (rig.follow) rig.focus.lerp(o.target, 1 - Math.pow(0.002, dt))
    else {
      const cx=(LIMIT.minX+LIMIT.maxX)/2, cz=(LIMIT.minZ+LIMIT.maxZ)/2
      const radius=Math.max(LIMIT.maxX-LIMIT.minX,LIMIT.maxZ-LIMIT.minZ)/2
      const dx=rig.focus.x-cx,dz=rig.focus.z-cz,d=Math.hypot(dx,dz)
      if(d>radius){rig.focus.x=cx+dx/d*radius;rig.focus.z=cz+dz/d*radius}
      rig.focus.y += (Math.max(0, o.groundAt(rig.focus.x, rig.focus.z)) + 1.2 - rig.focus.y) * (1 - Math.pow(0.01, dt))
    }
    const cp = Math.cos(rig.pitch)
    camera.position
      .set(Math.sin(rig.yaw) * cp, Math.sin(rig.pitch), Math.cos(rig.yaw) * cp)
      .multiplyScalar(rig.distance)
      .add(rig.focus)
    camera.position.y = Math.max(camera.position.y, o.groundAt(camera.position.x, camera.position.z) + (rig.mode === 'follow' ? 0.6 : 1.2), 0.5)
    // 正上方往下看时 lookAt 的“上”方向会翻，提前用镜头朝向当上方
    if (rig.pitch > 1.5) camera.up.set(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw))
    else camera.up.set(0, 1, 0)
    camera.lookAt(rig.focus)
  }

  function dispose() {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('contextmenu', onContextMenu)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('gesturestart', onGestureStart)
    canvas.removeEventListener('gesturechange', onGestureChange)
    window.removeEventListener('keydown', onKey)
  }

  return rig
}
