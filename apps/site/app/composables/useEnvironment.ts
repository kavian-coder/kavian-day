import { PHASES, resolveEnvironment, type Environment, type PhaseId, type Season, type WeatherId } from '@kavian/env'

interface Remote {
  lat: number | null
  city: string | null
  weatherCode: number | null
  temperature: number | null
}

interface Preview {
  phase?: PhaseId
  season?: Season
  weather?: WeatherId
}

const midpoint = (id: PhaseId, base: Date) => {
  const p = PHASES.find((x) => x.id === id)!
  const [sh, sm] = p.start.split(':').map(Number)
  const [eh, em] = p.end.split(':').map(Number)
  const s = sh! * 60 + sm!
  const e = eh! * 60 + em!
  const mid = (s + (((e - s + 1440) % 1440) / 2)) % 1440
  const d = new Date(base)
  d.setHours(Math.floor(mid / 60), Math.round(mid % 60), 0, 0)
  return d
}

/** 世界此刻的时段、季节、天气。全站共享一份状态。 */
export function useEnvironment() {
  const now = useState('kw-now', () => new Date())
  const remote = useState<Remote | null>('kw-remote', () => null)
  const preview = useState<Preview>('kw-preview', () => ({}))

  const env = computed<Environment>(() => {
    const date = preview.value.phase ? midpoint(preview.value.phase, now.value) : now.value
    const base = resolveEnvironment({
      date,
      region: 'coast',
      lat: remote.value?.lat,
      weatherCode: remote.value?.weatherCode,
      temperature: remote.value?.temperature,
      city: remote.value?.city,
    })
    if (preview.value.season) base.season = preview.value.season
    if (preview.value.weather) base.weather = preview.value.weather
    if (preview.value.phase || preview.value.season || preview.value.weather) base.source = 'preview'
    return base
  })

  const light = computed(() => env.value.phase.ui)
  const previewing = computed(() => env.value.source === 'preview')

  if (import.meta.client && !useState('kw-env-started', () => false).value) {
    useState('kw-env-started').value = true
    setInterval(() => (now.value = new Date()), 30_000)
    // /api/env 是 Cloudflare Pages Functions，本地开发服务器上没有，开发时就不去请求（免得控制台报 404）
    if (!import.meta.dev)
      $fetch<Remote>('/api/env', { timeout: 2000 })
        .then((r) => (remote.value = r))
        .catch(() => {
          // 接口失败时：季节按北半球，天气按季节随机。
        })
  }

  return {
    env,
    light,
    previewing,
    setPreview: (kind: keyof Preview, id: string) => (preview.value = { ...preview.value, [kind]: id }),
    resetPreview: () => (preview.value = {}),
  }
}
