import { describe, expect, it } from 'vitest'
import { PHASES, fallbackWeather, lightWeights, mapWeather, resolvePhase, resolveSeason } from '../src/index'

const at = (h: number, m = 0, month = 7, day = 15) => new Date(2026, month - 1, day, h, m, 0)

describe('时段', () => {
  it('4 个时段覆盖整整 24 小时', () => {
    expect(PHASES).toHaveLength(4)
    const seen = new Set<string>()
    for (let m = 0; m < 1440; m += 5) seen.add(resolvePhase(at(Math.floor(m / 60), m % 60)).id)
    expect(seen.size).toBe(4)
  })

  it.each([
    [0, 30, 'late-night'],
    [3, 0, 'late-night'],
    [5, 30, 'dawn'],
    [7, 0, 'dawn'],
    [9, 0, 'midday'],
    [11, 0, 'midday'],
    [12, 0, 'midday'],
    [15, 40, 'midday'],
    [17, 30, 'dusk'],
    [18, 30, 'dusk'],
    [21, 0, 'late-night'],
    [23, 30, 'late-night'],
  ])('%i:%i 是 %s', (h, m, id) => {
    expect(resolvePhase(at(h, m)).id).toBe(id)
  })

  it('光照权重之和为 1，交界处平滑过渡', () => {
    for (let m = 0; m < 1440; m += 1) {
      const w = lightWeights(at(Math.floor(m / 60), m % 60))
      expect(w.noon + w.dawn + w.dusk + w.night).toBeCloseTo(1, 6)
    }
    const before = lightWeights(new Date(2026, 6, 15, 18, 59, 50))
    const after = lightWeights(new Date(2026, 6, 15, 19, 0, 10))
    expect(Math.abs(before.night - after.night)).toBeLessThan(0.3)
  })
})

describe('季节', () => {
  it('北半球 7 月是夏天，南半球 7 月是冬天', () => {
    expect(resolveSeason(at(12, 0, 7), 31).season).toBe('summer')
    expect(resolveSeason(at(12, 0, 7), -33).season).toBe('winter')
  })
  it('赤道附近常夏', () => {
    expect(resolveSeason(at(12, 0, 1), 1.3)).toEqual({ season: 'summer', tropical: true })
  })
  it('没有纬度时按北半球', () => {
    expect(resolveSeason(at(12, 0, 12)).season).toBe('winter')
  })
})

describe('天气', () => {
  it('WMO 代码映射', () => {
    expect(mapWeather(0, 'coast')).toBe('clear')
    expect(mapWeather(63, 'coast')).toBe('rain')
    expect(mapWeather(95, 'coast')).toBe('rain')
  })
  it('雪只下在山间', () => {
    expect(mapWeather(73, 'mountain')).toBe('snow')
    expect(mapWeather(73, 'coast')).toBe('rain')
  })
  it('随机天气同一天内一致', () => {
    const a = fallbackWeather('summer', new Date(2026, 6, 15, 8), 'coast')
    const b = fallbackWeather('summer', new Date(2026, 6, 15, 22), 'coast')
    expect(a).toBe(b)
  })
})
