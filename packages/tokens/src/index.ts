import tokens from './tokens.json'
import timePhases from '../data/time-phases.json'
import seasons from '../data/seasons.json'
import weather from '../data/weather.json'

export { tokens, timePhases, seasons, weather }

/** 四种光照锚点，同时是界面主题的 id。 */
export type LightId = 'noon' | 'dawn' | 'dusk' | 'night'
export const LIGHTS: LightId[] = ['noon', 'dawn', 'dusk', 'night']

type ThemedValue = string | Record<string, string>

const colorMap = new Map<string, ThemedValue>(
  tokens.color.tokens.map((t: { name: string; value: ThemedValue }) => [t.name, t.value]),
)

/** 取某个颜色变量在某种光照下的值。 */
export function color(name: string, light: LightId = 'noon'): string {
  const value = colorMap.get(name)
  if (value === undefined) throw new Error(`Unknown color token: ${name}`)
  if (typeof value === 'string') return value
  return value[light] ?? value.noon ?? Object.values(value)[0]!
}

/** 场景渲染用的颜色名（不含 world- 前缀）。 */
export const WORLD_KEYS = [
  'sky-zenith',
  'sky-horizon',
  'sun',
  'cloud-lit',
  'cloud-shade',
  'haze',
  'water-shallow',
  'water-deep',
  'foliage',
  'foliage-shade',
  'window-glow',
  'grade',
] as const
export type WorldKey = (typeof WORLD_KEYS)[number]
export type WorldPalette = Record<WorldKey, string>

/** 某个光照锚点下的整套场景颜色。 */
export function worldPalette(light: LightId): WorldPalette {
  return Object.fromEntries(WORLD_KEYS.map((k) => [k, color(`world-${k}`, light)])) as WorldPalette
}
