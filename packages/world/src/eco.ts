/**
 * 生态状态：把时段、季节、天气换算成各种生物都能用的几个数，
 * 每种生物再按自己的习性算出“现在有多活跃”（0–1），决定出来多少只。
 */
import type { Season } from './kit'

export interface EcoState {
  /** 白天程度 0–1 */
  day: number
  /** 夜晚程度 0–1 */
  night: number
  /** 晨昏程度 0–1（黎明、黄昏） */
  twilight: number
  season: Season
  /** 下雨（含雷雨） */
  wet: boolean
  /** 雷雨、暴风 */
  storm: boolean
  snow: boolean
  fog: boolean
  /** 风力 */
  wind: number
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** 按季节查表 */
export const bySeason = (s: Season, t: Record<Season, number>) => t[s]

/** 一些常用的习性 */
export const habit = {
  /** 白天活动、怕雨 */
  diurnal: (e: EcoState) => clamp01(e.day + e.twilight * 0.5) * (e.wet ? 0.1 : 1) * (e.storm ? 0 : 1) * (e.fog ? 0.6 : 1),
  /** 晨昏最活跃（鹿、兔子） */
  crepuscular: (e: EcoState) => clamp01(e.twilight * 1.2 + e.day * 0.45 + e.night * 0.1) * (e.storm ? 0 : e.wet ? 0.4 : 1),
  /** 夜里出来 */
  nocturnal: (e: EcoState) => clamp01(e.night + e.twilight * 0.4),
}
