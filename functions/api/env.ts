/**
 * GET /api/env — Cloudflare Pages Function
 *
 * 从 Cloudflare 提供的请求信息里读出访客的大致位置（来自 IP，城市级），
 * 再向 Open-Meteo 查询当前天气。不保存、不记录位置，只返回取整后的纬度（用于判断半球）。
 * Open-Meteo：非商业用途免费、无需密钥，页面需注明数据来源。
 */

interface CfInfo {
  latitude?: string
  longitude?: string
  city?: string
  timezone?: string
}

interface Context {
  request: Request & { cf?: CfInfo }
  waitUntil: (p: Promise<unknown>) => void
}

const json = (body: unknown, maxAge = 600) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `private, max-age=${maxAge}` },
  })

export async function onRequestGet({ request, waitUntil }: Context): Promise<Response> {
  const cf = request.cf ?? {}
  const lat = cf.latitude ? Number(cf.latitude) : null
  const lon = cf.longitude ? Number(cf.longitude) : null
  const base = { lat: lat === null ? null : Math.round(lat), city: cf.city ?? null, weatherCode: null, temperature: null }
  if (lat === null || lon === null) return json(base, 60)

  // 按 0.1° 网格缓存 30 分钟，同一片区域的访客共享一次查询。
  const gridLat = lat.toFixed(1)
  const gridLon = lon.toFixed(1)
  const api = `https://api.open-meteo.com/v1/forecast?latitude=${gridLat}&longitude=${gridLon}&current=weather_code,temperature_2m&timezone=auto`
  const cache = (caches as unknown as { default: Cache }).default
  const key = new Request(api)
  let res = await cache.match(key)
  if (!res) {
    try {
      const upstream = await fetch(api, { signal: AbortSignal.timeout(1500) })
      if (!upstream.ok) return json(base, 60)
      res = new Response(upstream.body, upstream)
      res.headers.set('cache-control', 'public, max-age=1800')
      waitUntil(cache.put(key, res.clone()))
    } catch {
      return json(base, 60)
    }
  }
  const data = (await res.json()) as { current?: { weather_code?: number; temperature_2m?: number } }
  return json({
    ...base,
    weatherCode: data.current?.weather_code ?? null,
    temperature: data.current?.temperature_2m ?? null,
  })
}
