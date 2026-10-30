import { color } from '@kavian/tokens'

/** 固定色板（不随时段变化），用于占位模型。 */
export const pal = {
  sky: color('pal-sky'),
  sea: color('pal-sea'),
  leaf: color('pal-leaf'),
  forest: color('pal-forest'),
  sand: '#EBD9B4',
  lamp: color('pal-amber'),
  sunset: color('pal-sunset'),
} as const
