<script setup lang="ts">
import { PHASES } from '@kavian/env'
import type { PlacePrompt, ViewMode, WorldHandle } from '@kavian/world'
// 界面组件直接引入：不依赖开发服务器有没有扫描到 packages/ui 里新加的文件
import KwControlsHint from '@kavian/ui/KwControlsHint.vue'
import KwDirectory from '@kavian/ui/KwDirectory.vue'
import KwEnvPanel from '@kavian/ui/KwEnvPanel.vue'
import KwIcon from '@kavian/ui/KwIcon.vue'
import KwIconButton from '@kavian/ui/KwIconButton.vue'
import KwInteractPrompt from '@kavian/ui/KwInteractPrompt.vue'
import KwLogo from '@kavian/ui/KwLogo.vue'
import KwTopBar from '@kavian/ui/KwTopBar.vue'
import KwWorldClock from '@kavian/ui/KwWorldClock.vue'

const { t } = useI18n()
const localePath = useLocalePath()
const switchLocalePath = useSwitchLocalePath()
const { locale } = useI18n()
const { env, previewing, setPreview, resetPreview } = useEnvironment()

useHead({ title: () => t('world.title') })

const canvas = ref<HTMLCanvasElement | null>(null)
const loading = ref(true)
const failed = ref(false)
const loadProgress = ref(3)
const loadStage = ref('prepare')
const contentFirst = ref(false)
const lifecycle = new AbortController()
const loadingLabels: Record<string, [string, string]> = {
  prepare: ['正在唤醒这片海', 'Waking up the ocean'],
  terrain: ['山脊正在浮现', 'Shaping the mountains'],
  coast: ['潮水漫过海岸', 'Bringing in the tide'],
  town: ['沿着海湾，搭起小镇', 'Building the bay town'],
  nature: ['让雨林长起来', 'Growing the rainforest'],
  life: ['列车、海鸟和小伙伴就位', 'Welcoming life to the island'],
  light: ['把阳光洒进世界', 'Letting the light in'],
  ready: ['欢迎来到我的世界', 'Welcome to my world'],
}
const loadingText = computed(() => loadingLabels[loadStage.value]?.[locale.value === 'zh' ? 0 : 1] ?? '')
function showContentFirst() { contentFirst.value = true; panel.value = 'directory' }
// 地点提示：只在进出地点时更新（会重绘）；跟着镜头移动时直接改元素位置，不经过 Vue
const prompt = shallowRef<PlacePrompt | null>(null)
const promptRef = ref<{ $el: HTMLElement } | null>(null)
// 最新位置放在普通对象里：页面因为别的原因重绘时，提示也会用上最新位置
const promptPos = { x: 0, y: 0 }
const setPrompt = (p: PlacePrompt | null) => {
  if (p) {
    promptPos.x = p.x
    promptPos.y = p.y
  }
  prompt.value = p
}
const movePrompt = (x: number, y: number) => {
  promptPos.x = x
  promptPos.y = y
  const el = promptRef.value?.$el
  if (!el) return
  el.style.left = `${x}px`
  el.style.top = `${y}px`
}
let world: WorldHandle | null = null

// ---------- 界面状态：同一时间最多开一个面板
type Panel = 'env' | 'settings' | 'directory' | null
const panel = ref<Panel>(null)
const togglePanel = (p: Exclude<Panel, null>) => (panel.value = panel.value === p ? null : p)

const view = ref<ViewMode>('god')
function setView(m: ViewMode) {
  view.value = m
  world?.setView(m)
}

// 沉浸模式：界面收起，能全屏就全屏；Esc 或右上角的小按钮退出
const immersive = ref(false)
async function enterImmersive() {
  panel.value = null
  immersive.value = true
  try {
    if (document.fullscreenEnabled && !document.fullscreenElement) await document.documentElement.requestFullscreen()
  } catch {
    /* 浏览器不让全屏也没关系，界面照样收起 */
  }
}
async function exitImmersive() {
  immersive.value = false
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
  } catch {
    /* 忽略 */
  }
}
const onFullscreen = () => {
  if (!document.fullscreenElement) immersive.value = false
}

function switchLanguage() {
  navigateTo(switchLocalePath(locale.value === 'zh' ? 'en' : 'zh'))
}

const placeIds = ['work', 'lab', 'notes', 'pier', 'home'] as const
const directory = computed(() =>
  placeIds.map((id) => ({
    name: t(`places.${id}.name`),
    hint: t(`places.${id}.hint`),
    count: '—',
    href: id === 'home' ? localePath('/about') : '#',
  })),
)

const time = ref('')
const updateTime = () => {
  time.value = new Date().toLocaleTimeString(locale.value === 'zh' ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
}

const opt = (kind: 'phase' | 'season' | 'weather', id: string) => ({ id, label: t(`${kind}.${id}`) })
const PHASE_ICON: Record<string, string> = {
  predawn: 'moon',
  dawn: 'sunrise',
  'early-morning': 'sunrise',
  morning: 'sun',
  forenoon: 'sun',
  midday: 'sun',
  afternoon: 'sun',
  'late-afternoon': 'sunrise',
  dusk: 'sunrise',
  evening: 'moon',
  'late-night': 'moon',
}
const clock = computed(() => ({
  phase: opt('phase', env.value.phase.id),
  season: opt('season', env.value.season),
  weather: opt('weather', env.value.weather),
  phaseIcon: PHASE_ICON[env.value.phase.id] ?? 'sun',
}))
const envOptions = computed(() => ({
  phases: PHASES.map((p) => opt('phase', p.id)),
  seasons: ['spring', 'summer', 'autumn', 'winter'].map((s) => opt('season', s)),
  weathers: ['clear', 'cloudy', 'rain', 'snow'].map((w) => opt('weather', w)),
}))

const isZh = computed(() => locale.value === 'zh')
const keyboardControls = computed(() => [
  { keys: ['W', 'A', 'S', 'D'], text: t('world.walk') },
  { keys: ['Shift'], text: t('world.run') },
  { keys: ['V'], text: t('world.switchView') },
  { keys: ['E'], text: t('world.interact') },
])
const pointerControls = computed(() =>
  view.value === 'god'
    ? [
        { keys: [isZh.value ? '拖动' : 'Drag'], text: t('world.pan') },
        { keys: [isZh.value ? '右键拖动' : 'Right-drag'], text: t('world.rotate') },
        { keys: [isZh.value ? '滚轮 / 捏合' : 'Wheel / pinch'], text: t('world.zoom') },
      ]
    : [
        { keys: [isZh.value ? '拖动' : 'Drag'], text: t('world.turn') },
        { keys: [isZh.value ? '滚轮 / 捏合' : 'Wheel / pinch'], text: t('world.nearFar') },
      ],
)

// 第一次来的小提示：几秒后自己消失，或者一开始走就消失
const hint = ref(false)
function dismissHint() {
  hint.value = false
  try {
    localStorage.setItem('kw_hint_seen', '1')
  } catch {
    /* 隐私模式下存不了，下次再显示一次也无妨 */
  }
}

function pushEnvironment() {
  world?.setEnvironment({
    weights: env.value.weights,
    windows: env.value.phase.windows,
    stars: env.value.phase.stars,
    weather: env.value.weather,
    season: env.value.season,
  })
}
watch(env, pushEnvironment, { deep: true })

function interact(id: string) {
  if (id === 'station') panel.value = 'directory'
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (panel.value) panel.value = null
    else if (immersive.value) exitImmersive()
  }
  if (hint.value && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) dismissHint()
}
// 点到场景上就把面板收起来
const onCanvasDown = () => (panel.value = null)

let timer: ReturnType<typeof setInterval> | undefined
onBeforeUnmount(() => {
  lifecycle.abort()
  clearInterval(timer)
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFullscreen)
  world?.dispose()
})

onMounted(async () => {
  updateTime()
  timer = setInterval(updateTime, 30_000)
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFullscreen)
  try {
    hint.value = !localStorage.getItem('kw_hint_seen')
  } catch {
    hint.value = true
  }
  if (hint.value) setTimeout(dismissHint, 9000)
  try {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const { createWorld } = await import('@kavian/world')
    // 加载期间组件可能已经被重新挂载（水合不一致时会这样），旧实例就不再创建世界
    if (!canvas.value || lifecycle.signal.aborted) return
    world = await createWorld({
      signal: lifecycle.signal,
      onError: () => { failed.value = true; contentFirst.value = false },
      onProgress: (stage, progress) => { loadStage.value = stage; loadProgress.value = progress },
      canvas: canvas.value!,
      quality: window.matchMedia('(max-width: 768px)').matches ? 'low' : 'high',
      petUrl: '/models/pet_dog_shiba.glb',
      onPrompt: setPrompt,
      onPromptMove: movePrompt,
      onViewChange: (m) => (view.value = m),
      onInteract: interact,
    })
    if (lifecycle.signal.aborted) { world.dispose(); return }
    pushEnvironment()
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  } catch (err) {
    if (lifecycle.signal.aborted) return
    console.error(err)
    failed.value = true
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="world" :class="{ 'world--immersive': immersive, 'world--loading': loading }">
    <canvas ref="canvas" class="world__canvas" :aria-label="t('world.title')" @pointerdown="onCanvasDown"></canvas>

    <!-- 左上：logo 和导航 -->
    <Transition name="kw-hud">
      <header v-show="!immersive" class="world__left">
        <KwTopBar :name="t('site.name')" :label="t('site.nav')">
          <template #logo>
            <NuxtLink class="kw-logo" :to="localePath('/')" :aria-label="t('site.name')" :title="t('site.name')"><KwLogo /></NuxtLink>
          </template>
          <template #nav>
            <NuxtLink :to="localePath('/')" aria-current="page">{{ t('nav.world') }}</NuxtLink>
            <a href="#" @click.prevent="togglePanel('directory')">{{ t('nav.work') }}</a>
            <a href="#" @click.prevent="togglePanel('directory')">{{ t('nav.notes') }}</a>
            <a href="#" @click.prevent="togglePanel('directory')">{{ t('nav.life') }}</a>
            <NuxtLink :to="localePath('/about')">{{ t('nav.about') }}</NuxtLink>
          </template>
        </KwTopBar>
        <Transition name="kw-slide">
          <KwDirectory v-if="panel === 'directory'" class="world__dir" :title="t('world.directory')" :close-label="t('world.close')" :items="directory" @close="panel = null" />
        </Transition>
      </header>
    </Transition>

    <!-- 右上：时段天气 + 视角 + 语言 + 设置 + 沉浸，合在一个胶囊里 -->
    <Transition name="kw-hud">
      <div v-show="!immersive" class="world__right">
        <div class="kw-capsule kw-glass">
          <KwWorldClock
            v-bind="clock"
            :temperature="env.temperature"
            :time="time"
            :previewing="previewing"
            :open="panel === 'env'"
            :label="t('clock.toggle')"
            @toggle="togglePanel('env')"
          />
          <span class="kw-capsule__sep" aria-hidden="true"></span>
          <KwIconButton
            :icon="view === 'god' ? 'god' : 'follow'"
            :label="`${view === 'god' ? t('world.godView') : t('world.followView')} · V`"
            @click="setView(view === 'god' ? 'follow' : 'god')"
          />
          <KwIconButton icon="globe" :badge="isZh ? 'EN' : '中'" :label="t('world.language')" @click="switchLanguage" />
          <KwIconButton icon="sliders" :label="t('world.settings')" :pressed="panel === 'settings'" @click="togglePanel('settings')" />
        </div>

        <Transition name="kw-pop">
          <KwEnvPanel
            v-if="panel === 'env'"
            class="world__popover"
            :phase="env.phase.id"
            :season="env.season"
            :weather="env.weather"
            v-bind="envOptions"
            :previewing="previewing"
            :labels="{
              previewTitle: t('clock.previewTitle'),
              season: t('clock.season'),
              weather: t('clock.weather'),
              reset: t('clock.reset'),
              live: t('clock.live'),
              liveHint: env.city ? t('clock.liveCity', { city: env.city }) : t('clock.liveHint'),
              source: t('clock.source'),
            }"
            @preview="setPreview"
            @reset="resetPreview"
          />
        </Transition>

        <Transition name="kw-pop">
          <div v-if="panel === 'settings'" class="kw-settings kw-glass world__popover" role="dialog" :aria-label="t('world.settings')">
            <div class="kw-settings__section">
              <span class="kw-label">{{ t('world.view') }}</span>
              <div class="kw-seg kw-seg--sm kw-seg--glass" role="group">
                <button :aria-pressed="view === 'god'" @click="setView('god')"><KwIcon name="god" :size="16" />{{ t('world.godView') }}</button>
                <button :aria-pressed="view === 'follow'" @click="setView('follow')"><KwIcon name="follow" :size="16" />{{ t('world.followView') }}</button>
              </div>
            </div>
            <div class="kw-settings__section">
              <span class="kw-label kw-settings__title"><KwIcon name="keyboard" :size="15" />{{ t('world.keyboard') }}</span>
              <KwControlsHint :label="t('world.keyboard')" :items="keyboardControls" />
              <span class="kw-label kw-settings__title"><KwIcon name="pointer" :size="15" />{{ t('world.pointer') }}</span>
              <KwControlsHint :label="t('world.pointer')" :items="pointerControls" />
            </div>
            <div class="kw-settings__section">
              <button class="kw-rowbtn" type="button" @click="enterImmersive">
                <KwIcon name="expand" />
                <span>{{ t('world.immersive') }}<small>{{ t('world.immersiveHint') }}</small></span>
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- 沉浸模式下只留一个小按钮 -->
    <Transition name="kw-fade">
      <button v-if="immersive" class="world__exit kw-glass" type="button" :aria-label="t('world.exitImmersive')" :title="t('world.exitImmersive')" @click="exitImmersive">
        <KwIcon name="collapse" />
      </button>
    </Transition>

    <KwInteractPrompt
      v-if="prompt"
      ref="promptRef"
      key-name="E"
      :action="prompt.id === 'station' ? t('world.enter') : t('world.underConstruction')"
      :target="t(`places.${prompt.id}.name`)"
      :locked="prompt.id !== 'station'"
      :x="promptPos.x"
      :y="promptPos.y"
      @activate="interact(prompt.id)"
    />

    <Transition name="kw-rise">
      <div v-if="hint && !loading && !immersive" class="world__hint">
        <div class="kw-hint kw-glass">
          <span><span class="kw-key">W</span><span class="kw-key">A</span><span class="kw-key">S</span><span class="kw-key">D</span> {{ t('world.walk') }}</span>
          <span>·</span>
          <span>{{ t('world.hintDrag') }}</span>
          <span>·</span>
          <span><span class="kw-key">V</span> {{ t('world.switchView') }}</span>
        </div>
      </div>
    </Transition>

    <Transition name="arrival">
      <div v-if="(loading || failed) && !contentFirst" class="world__loader" :style="{ '--arrival': loadProgress / 100 }">
        <div class="arrival__sea" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="arrival__scene" aria-hidden="true">
          <svg viewBox="0 0 420 240" fill="none">
            <ellipse class="arrival__ripples" cx="210" cy="179" rx="174" ry="33" />
            <ellipse class="arrival__ripples" cx="210" cy="179" rx="145" ry="23" />
            <path class="arrival__island" d="M57 172Q70 155 109 151L145 114L166 130L210 62L253 128L280 108L318 150Q360 153 369 174Q338 207 210 210Q91 207 57 172Z" />
            <path class="arrival__ridge" d="M109 151L145 114L166 130L210 62L253 128L280 108L318 150L273 143L248 150L209 111L179 155L143 146Z" />
            <g class="arrival__village">
              <path d="M124 159V140H147V159M157 169V145H183V169M239 166V143H265V166M279 164V146H300V164" fill="#F1E7CE"/>
              <path d="M119 141L135 130L152 141M151 146L169 134L189 146M234 144L252 132L270 144M275 147L289 138L305 147" fill="#C97862"/>
              <path d="M197 178V159H223V178M192 160L210 148L229 160" fill="#F1E7CE"/>
              <path d="M87 161L91 125H99L103 161" fill="#F1E7CE"/><path d="M87 125H103L95 116Z" fill="#C97862"/>
            </g>
            <path class="arrival__route" d="M77 173Q210 211 343 173" />
            <circle class="arrival__traveller" r="4" fill="#F7E8B5"><animateMotion dur="4s" repeatCount="indefinite" path="M77 173Q210 211 343 173" /></circle>
          </svg>
        </div>
        <div class="arrival__copy" role="status" aria-live="polite">
          <p class="arrival__name">Kavian</p>
          <h1>{{ failed ? (isZh ? '海岛暂时没有醒来' : 'The island could not wake up') : (isZh ? '世界，正在发生' : 'A world coming to life') }}</h1>
          <p class="arrival__stage">{{ failed ? (isZh ? '暂时无法打开 3D 世界，你仍可以浏览内容。' : 'The 3D world is unavailable. You can still browse the content.') : loadingText }}</p>
          <div v-if="!failed" class="arrival__progress" role="progressbar" :aria-label="isZh ? '世界构建进度' : 'World preparation'" :aria-valuenow="loadProgress" aria-valuemin="0" aria-valuemax="100"><span :style="{ transform: `scaleX(${loadProgress / 100})` }"></span></div>
          <a v-if="failed" class="arrival__skip" :href="`${localePath('/')}?compatible=1`">{{ isZh ? '使用兼容模式重试' : 'Retry in compatibility mode' }}</a>
          <button class="arrival__skip" type="button" @click="showContentFirst">{{ t('world.contentFirst') }} <span aria-hidden="true">↗</span></button>
        </div>
        <p class="arrival__footer">{{ isZh ? '海风、日光，还有慢慢生长的日常。' : 'Sea breeze, sunlight, and a life that keeps growing.' }}</p>
      </div>
    </Transition>
  </main>
</template>

<style scoped>
.world { position: fixed; inset: 0; overflow: hidden; }
.world__canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; z-index: var(--z-world); }
.world__left {
  position: absolute; z-index: var(--z-hud);
  top: max(var(--space-4), env(safe-area-inset-top, 0px));
  left: max(var(--space-4), env(safe-area-inset-left, 0px));
  display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2);
}
.world__dir { transform-origin: top left; }
.world__right {
  position: absolute; z-index: var(--z-hud);
  top: max(var(--space-4), env(safe-area-inset-top, 0px));
  right: max(var(--space-4), env(safe-area-inset-right, 0px));
}
/* 面板贴着胶囊右边往下展开，不会把胶囊挤走 */
.world__popover { position: absolute; top: calc(100% + 10px); right: 0; transform-origin: top right; }
.world__exit {
  position: absolute; z-index: var(--z-hud);
  top: max(var(--space-4), env(safe-area-inset-top, 0px));
  right: max(var(--space-4), env(safe-area-inset-right, 0px));
  display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
  opacity: 0.55; transition: opacity var(--dur-quick) var(--ease-out);
}
.world__exit:hover, .world__exit:focus-visible { opacity: 1; }
.world__hint {
  position: absolute; z-index: var(--z-hud); left: 0; right: 0;
  bottom: max(var(--space-6), env(safe-area-inset-bottom, 0px));
  display: flex; justify-content: center; pointer-events: none;
}

.world { background: #387f99; }
.world__canvas { opacity: 1; transition: opacity 1.1s ease; }
.world--loading .world__canvas { opacity: 0; }
.world__loader { position: absolute; inset: 0; z-index: var(--z-dialog); display: flex; flex-direction: column; align-items: center; justify-content: center; background: #173f50; color: #edf2e7; overflow: hidden; }
.arrival__scene { width: min(420px, 72vw); position: relative; }
.arrival__scene svg { display: block; width: 100%; overflow: visible; }
.arrival__island { fill: #9db79a; opacity: calc(.22 + var(--arrival) * .78); transition: opacity .8s; }
.arrival__ridge { fill: #507d70; }
.arrival__village { opacity: var(--arrival); transition: opacity .8s; }
.arrival__ripples { stroke: #a1cec7; stroke-width: 1.1; opacity: .3; }
.arrival__route { stroke: #e6ddc1; stroke-width: 1.5; stroke-dasharray: 3 4; opacity: .6; }
.arrival__copy { position: relative; width: min(420px, calc(100vw - 48px)); text-align: center; }
.arrival__name { margin: 0 0 12px; font-size: 18px; }
.arrival__copy h1 { font-size: clamp(27px, 4vw, 36px); font-weight: 500; line-height: 1.3; margin: 0; }
.arrival__stage { font-size: 14px; margin: 20px 0 24px; color: #c1d9d8; min-height: 24px; }
.arrival__progress { height: 3px; max-width: 200px; margin: auto; background: #355b68; overflow: hidden; border-radius: 2px; }
.arrival__progress span { display: block; width: 100%; height: 100%; transform-origin: left; background: #d8e6c2; transition: transform .65s ease; }
.arrival__skip { color: #d6e4e2; background: transparent; border: 0; margin-top: 28px; padding: 12px 18px; cursor: pointer; font-size: 14px; }
.arrival__skip:hover { color: white; }
.arrival__skip:focus-visible { outline: 2px solid #d8e6c2; outline-offset: 4px; }
.arrival__skip span { margin-left: 8px; }
.arrival__footer { position: absolute; bottom: max(26px, env(safe-area-inset-bottom)); margin: 0 20px; font-size: 12px; color: #b1c9ca; text-align: center; }
.arrival__sea { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.arrival__sea i { position: absolute; width: 150vw; height: 70vh; left: -25vw; top: 57%; border-radius: 50%; background: #1b495a; animation: tide 12s ease-in-out infinite alternate; }
.arrival__sea i:nth-child(2) { top: 67%; background: #205567; animation-delay: -5s; }
.arrival__sea i:nth-child(3) { top: 80%; background: #296578; animation-delay: -8s; }
@keyframes tide { from { transform: translateX(-4%) rotate(-3deg); } to { transform: translateX(4%) rotate(3deg); } }
.arrival-leave-active { transition: opacity 1.1s ease; pointer-events: none; }
.arrival-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .arrival__sea i { animation: none; } .arrival__traveller { display: none; } .world__canvas, .arrival-leave-active, .arrival__progress span { transition-duration: .01s; } }

:deep(.kw-prompt) { z-index: var(--z-hud); }

/* 窄屏：导航文字收起一部分，时钟只留时段和图标 */
@media (max-width: 720px) {
  .world__left :deep(.kw-nav a:not([aria-current])) { padding: 8px 10px; }
  .world__right :deep(.kw-clock__item), .world__right :deep(.kw-clock__sep), .world__right :deep(.kw-clock__time) { display: none; }
}
@media (max-width: 520px) {
  .world__right { top: auto; bottom: max(var(--space-4), env(safe-area-inset-bottom, 0px)); }
  .world__popover { top: auto; bottom: calc(100% + 10px); transform-origin: bottom right; }
  .world__hint { display: none; }
}
</style>
