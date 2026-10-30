import { Color } from 'three'
import { LIGHTS, WORLD_KEYS, worldPalette, type LightId, type WorldKey } from '@kavian/tokens'

export type Weights = Record<LightId, number>

const palettes = Object.fromEntries(
  LIGHTS.map((id) => {
    const p = worldPalette(id)
    return [id, Object.fromEntries(WORLD_KEYS.map((k) => [k, new Color(p[k])]))]
  }),
) as Record<LightId, Record<WorldKey, Color>>

/** 按四个光照锚点的权重混合出一种场景颜色（在线性空间里混合）。 */
export function blend(key: WorldKey, weights: Weights, target = new Color()): Color {
  target.setRGB(0, 0, 0)
  for (const id of LIGHTS) {
    const w = weights[id]
    if (w <= 0) continue
    const c = palettes[id][key]
    target.r += c.r * w
    target.g += c.g * w
    target.b += c.b * w
  }
  return target
}

/** 主光强度、太阳高度角（弧度）也按权重混合。 */
const SUN_INTENSITY: Record<LightId, number> = { noon: 2.6, dawn: 1.3, dusk: 1.5, night: 0.45 }
const SUN_ELEVATION: Record<LightId, number> = { noon: 1.0, dawn: 0.22, dusk: 0.18, night: 0.9 }
const AMBIENT: Record<LightId, number> = { noon: 1.1, dawn: 0.95, dusk: 0.9, night: 1.0 }

export function mixNumber(table: Record<LightId, number>, weights: Weights): number {
  return LIGHTS.reduce((sum, id) => sum + table[id] * weights[id], 0)
}

export const sunIntensity = (w: Weights) => mixNumber(SUN_INTENSITY, w)
export const sunElevation = (w: Weights) => mixNumber(SUN_ELEVATION, w)
export const ambientIntensity = (w: Weights) => mixNumber(AMBIENT, w)
