import { timePhases, seasons, weather, type LightId, LIGHTS } from '@kavian/tokens'

export type PhaseId = 'dawn' | 'midday' | 'dusk' | 'late-night'

export interface Phase {
  id: PhaseId
  zh: string
  en: string
  start: string
  end: string
  ui: LightId
  light: Partial<Record<LightId, number>>
  stars: number
  windows: number
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Region = 'coast' | 'mountain'
export type WeatherId = 'clear' | 'cloudy' | 'rain' | 'snow'

export const PHASES = timePhases.phases as Phase[]

/** 相邻时段在交界前后各这么多分钟内过渡（对应 dur-phase 90s）。 */
const BLEND_MINUTES = 0.75

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}

/** 一天中的第几分钟（按传入 Date 的本地时间，也就是访客本地时间）。 */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60
}

function contains(phase: Phase, minutes: number): boolean {
  const s = toMinutes(phase.start)
  const e = toMinutes(phase.end)
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e
}

/** 返回当前时段。 */
export function resolvePhase(date: Date): Phase {
  const m = minutesOfDay(date)
  return PHASES.find((p) => contains(p, m)) ?? PHASES[0]!
}

export type LightWeights = Record<LightId, number>

const emptyWeights = (): LightWeights => ({ noon: 0, dawn: 0, dusk: 0, night: 0 })

function weightsOf(phase: Phase): LightWeights {
  const w = emptyWeights()
  for (const id of LIGHTS) w[id] = phase.light[id] ?? 0
  return w
}

/** 四个光照锚点的混合权重，时段交界处平滑过渡。权重之和为 1。 */
export function lightWeights(date: Date): LightWeights {
  const m = minutesOfDay(date)
  const idx = PHASES.findIndex((p) => contains(p, m))
  const current = PHASES[idx]!
  const next = PHASES[(idx + 1) % PHASES.length]!
  const prev = PHASES[(idx - 1 + PHASES.length) % PHASES.length]!
  const toEnd = (toMinutes(current.end) - m + 1440) % 1440
  const fromStart = (m - toMinutes(current.start) + 1440) % 1440
  let a = current
  let b = current
  let t = 0
  if (toEnd < BLEND_MINUTES) {
    b = next
    t = 0.5 - toEnd / (2 * BLEND_MINUTES)
  } else if (fromStart < BLEND_MINUTES) {
    a = prev
    b = current
    t = 0.5 + fromStart / (2 * BLEND_MINUTES)
  }
  const wa = weightsOf(a)
  const wb = weightsOf(b)
  const out = emptyWeights()
  for (const id of LIGHTS) out[id] = wa[id] * (1 - t) + wb[id] * t
  return out
}

/** 季节：按访客所在半球；|纬度| < 15° 视为常夏；没有纬度时按北半球。 */
export function resolveSeason(date: Date, lat?: number | null): { season: Season; tropical: boolean } {
  const month = date.getMonth() + 1
  if (lat != null && Math.abs(lat) < 15) return { season: 'summer', tropical: true }
  const table = lat != null && lat < 0 ? seasons.months.south : seasons.months.north
  const season = (Object.keys(table) as Season[]).find((s) => (table[s] as number[]).includes(month)) ?? 'summer'
  return { season, tropical: false }
}

/** WMO 天气代码 → 天气状态。雪只在山间区域出现，其他区域变成雨。 */
export function mapWeather(code: number, region: Region): WeatherId {
  const id = ((weather.wmo as Record<string, string>)[String(code)] ?? 'cloudy') as WeatherId
  if (id === 'snow' && region !== 'mountain') return 'rain'
  return id
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/** 拿不到真实天气时：按季节概率随机，以访客本地日期为种子，同一天内保持一致。 */
export function fallbackWeather(season: Season, date: Date, region: Region): WeatherId {
  const seed = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  const odds = (weather.fallbackOdds as Record<Season, Record<string, number>>)[season]
  let r = hash(seed)
  for (const [id, p] of Object.entries(odds)) {
    if (r < p) return id === 'snow' && region !== 'mountain' ? 'rain' : (id as WeatherId)
    r -= p
  }
  return 'clear'
}

export interface Environment {
  phase: Phase
  weights: LightWeights
  season: Season
  tropical: boolean
  weather: WeatherId
  temperature: number | null
  city: string | null
  source: 'live' | 'fallback' | 'preview'
}

export interface EnvInput {
  date: Date
  region: Region
  lat?: number | null
  weatherCode?: number | null
  temperature?: number | null
  city?: string | null
}

/** 汇总一次环境状态。 */
export function resolveEnvironment(input: EnvInput): Environment {
  const { date, region } = input
  const { season, tropical } = resolveSeason(date, input.lat)
  const live = input.weatherCode != null
  return {
    phase: resolvePhase(date),
    weights: lightWeights(date),
    season,
    tropical,
    weather: live ? mapWeather(input.weatherCode!, region) : fallbackWeather(season, date, region),
    temperature: input.temperature ?? null,
    city: input.city ?? null,
    source: live ? 'live' : 'fallback',
  }
}
