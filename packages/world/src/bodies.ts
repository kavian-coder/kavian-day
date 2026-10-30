/**
 * 会走动的东西（角色、狗、鹿、兔子、螃蟹、青蛙……）都登记成一个“身体”：地面上的一个圆。
 * 每帧最后统一做一次分离：两个身体重叠就按体重把它们推开，轻的被推得多。
 * 这样任何两只动物、动物和角色、动物和狗都不会穿进对方身体里。
 *
 * 静态障碍（树干、石头、房子）和地形（海、溪）由各自的 blocked 函数挡住；
 * 列车是会动的障碍，单独处理：压在车厢范围里的身体会被推到铁轨两边。
 */
export type BodyKind = 'player' | 'dog' | 'deer' | 'rabbit' | 'crab' | 'frog'

export interface Body {
  kind: BodyKind
  x: number
  z: number
  /** 半径（米） */
  r: number
  /** 体重：越重越不容易被推动 */
  mass: number
  /** 不在场（藏起来、没出现）的身体不参与碰撞 */
  active: boolean
  /** 刚被碰到时的回调，用来让动物“躲一下” */
  onBump?: (other: Body) => void
}

/** 列车车厢：中心、朝向、半长、半宽 */
export interface CarBox {
  x: number
  z: number
  ang: number
  hl: number
  hw: number
}

export function createBodies() {
  const list: Body[] = []
  return {
    list,
    add(b: Omit<Body, 'active'> & { active?: boolean }) {
      const body: Body = { active: true, ...b }
      list.push(body)
      return body
    },
    /** 离 (x, z) 最近、符合条件的身体 */
    nearest(x: number, z: number, max: number, filter: (b: Body) => boolean) {
      let best: Body | null = null
      let bd = max
      for (const b of list) {
        if (!b.active || !filter(b)) continue
        const d = Math.hypot(b.x - x, b.z - z) - b.r
        if (d < bd) {
          bd = d
          best = b
        }
      }
      return best ? { body: best, dist: bd } : null
    },
    /**
     * 分离：迭代几次，把所有重叠的身体推开；被推的位置不能进障碍。
     * cars：列车车厢，压在里面的身体推到车厢侧面。
     */
    resolve(blocked: (b: Body, x: number, z: number) => boolean, cars: CarBox[]) {
      for (let it = 0; it < 3; it++) {
        for (let i = 0; i < list.length; i++) {
          const a = list[i]!
          if (!a.active) continue
          for (let j = i + 1; j < list.length; j++) {
            const b = list[j]!
            if (!b.active) continue
            const dx = b.x - a.x
            const dz = b.z - a.z
            const min = a.r + b.r
            const d2 = dx * dx + dz * dz
            if (d2 >= min * min) continue
            const d = Math.sqrt(d2) || 0.0001
            const push = min - d
            const nx = d2 > 0 ? dx / d : 1
            const nz = d2 > 0 ? dz / d : 0
            const wa = b.mass / (a.mass + b.mass)
            const wb = 1 - wa
            const ax = a.x - nx * push * wa
            const az = a.z - nz * push * wa
            const bx = b.x + nx * push * wb
            const bz = b.z + nz * push * wb
            if (!blocked(a, ax, az)) {
              a.x = ax
              a.z = az
            }
            if (!blocked(b, bx, bz)) {
              b.x = bx
              b.z = bz
            }
            if (it === 0) {
              a.onBump?.(b)
              b.onBump?.(a)
            }
          }
        }
      }
      // 列车：把身体推到车厢外
      for (const c of cars) {
        const ca = Math.cos(c.ang)
        const sa = Math.sin(c.ang)
        for (const b of list) {
          if (!b.active) continue
          const dx = b.x - c.x
          const dz = b.z - c.z
          const u = ca * dx + sa * dz
          const v = -sa * dx + ca * dz
          if (Math.abs(u) > c.hl + b.r || Math.abs(v) > c.hw + b.r) continue
          const nv = (v >= 0 ? 1 : -1) * (c.hw + b.r + 0.02)
          b.x = c.x + ca * u - sa * nv
          b.z = c.z + sa * u + ca * nv
        }
      }
    },
  }
}

export type Bodies = ReturnType<typeof createBodies>
