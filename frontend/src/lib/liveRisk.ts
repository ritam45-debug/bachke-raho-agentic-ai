// Transparent, rule-based route risk score (0–100) built from live public data.
// It is NOT a probability of disruption. Every point awarded is listed as a factor with its source.
//
// Thresholds and where they come from (documentation/LIVE_DATA.md):
//   Wind gusts — Beaufort scale: gale ≥ 62 km/h, storm ≥ 89 km/h.
//   Rain       — India Meteorological Department daily categories: heavy ≥ 64.5 mm, very heavy ≥ 115.6 mm, extremely heavy ≥ 204.5 mm.
//   Thunderstorm / snow — WMO weather codes reported by Open-Meteo.
//   Waves, earthquake magnitudes, hazard radii and all POINT values — platform defaults (assumptions), not external standards.
import { distanceToPathKm, samplePath, type LatLon } from './geo'
import { forecastFor, marineFor, openNaturalEvents, recentQuakes, routeGeometry, WMO, type NaturalEvent, type Quake, type RouteGeometry, type SourceStatus } from './liveData'

export const RULES_VERSION = '1.0'
export const FORECAST_DAYS = 3

export interface Factor { name: string; points: number; detail: string; source: string; observed_at?: string }
export interface RiskResult { score: number; band: 'low' | 'moderate' | 'elevated' | 'high'; factors: Factor[]; sources: SourceStatus[]; geometry: RouteGeometry }
export interface RouteLike { id: string; name: string; mode: string; origin_lat: number; origin_lon: number; destination_lat: number; destination_lon: number }

export const bandFor = (s: number): RiskResult['band'] => (s >= 75 ? 'high' : s >= 50 ? 'elevated' : s >= 25 ? 'moderate' : 'low')

/** Severity of one forecast day at one place — shared with the Weather tool. */
export function dayFlags(d: { gust: number; rain: number; code: number }) {
  const flags: { label: string; level: 'watch' | 'warning' }[] = []
  if (d.gust >= 89) flags.push({ label: `Storm-force gusts ${Math.round(d.gust)} km/h`, level: 'warning' })
  else if (d.gust >= 62) flags.push({ label: `Gale-force gusts ${Math.round(d.gust)} km/h`, level: 'watch' })
  if (d.rain >= 204.5) flags.push({ label: `Extremely heavy rain ${Math.round(d.rain)} mm`, level: 'warning' })
  else if (d.rain >= 115.6) flags.push({ label: `Very heavy rain ${Math.round(d.rain)} mm`, level: 'warning' })
  else if (d.rain >= 64.5) flags.push({ label: `Heavy rain ${Math.round(d.rain)} mm`, level: 'watch' })
  if (d.code >= 95) flags.push({ label: WMO[d.code] ?? 'Thunderstorm', level: d.code >= 96 ? 'warning' : 'watch' })
  if ([71, 73, 75, 77, 85, 86].includes(d.code)) flags.push({ label: WMO[d.code], level: d.code === 75 || d.code === 86 ? 'warning' : 'watch' })
  return flags
}

// Hazard radii (km) and points by NASA EONET category — platform defaults.
const EONET_RULES: Record<string, { radius: number; points: number }> = {
  severeStorms: { radius: 500, points: 30 }, floods: { radius: 300, points: 25 }, volcanoes: { radius: 300, points: 20 },
  wildfires: { radius: 150, points: 15 }, landslides: { radius: 150, points: 10 }, seaLakeIce: { radius: 300, points: 10 },
  snow: { radius: 200, points: 10 }, tempExtremes: { radius: 200, points: 10 }, dustHaze: { radius: 200, points: 5 },
}
const QUAKE_RADIUS_KM = 300

// Shared hazard feeds are fetched once per "check all" run, not once per route.
export async function loadHazards() {
  const [quakes, events] = await Promise.all([recentQuakes(), openNaturalEvents()])
  return { quakes, events }
}
type Hazards = Awaited<ReturnType<typeof loadHazards>>

export async function assessRoute(route: RouteLike, hazards?: Hazards): Promise<RiskResult> {
  const a: LatLon = [route.origin_lat, route.origin_lon], b: LatLon = [route.destination_lat, route.destination_lon]
  const geometry = await routeGeometry(route.mode, a, b)
  const pts = samplePath(geometry.path, 6)
  const hz = hazards ?? (await loadHazards())
  const [wx, sea] = await Promise.all([
    forecastFor(pts, FORECAST_DAYS),
    route.mode === 'sea' ? marineFor(pts.slice(1, -1).length ? pts.slice(1, -1) : pts, FORECAST_DAYS) : Promise.resolve(null),
  ])
  const sources: SourceStatus[] = [wx.source, hz.quakes.source, hz.events.source, ...(sea ? [sea.source] : []), ...(geometry.source ? [geometry.source] : [])]
  const factors: Factor[] = []

  // --- weather along the route: worst value per hazard type (not summed across points) ---
  if (wx.data) {
    let gust = { v: 0, day: '' }, rain = { v: 0, day: '' }, storm = { code: 0, day: '' }, snow = { code: 0, day: '' }
    for (const p of wx.data) p.daily.time.forEach((day, i) => {
      const g = p.daily.wind_gusts_10m_max[i] ?? 0, r = p.daily.precipitation_sum[i] ?? 0, c = p.daily.weather_code[i] ?? 0
      if (g > gust.v) gust = { v: g, day }
      if (r > rain.v) rain = { v: r, day }
      if (c >= 95 && c > storm.code) storm = { code: c, day }
      if ([71, 73, 75, 77, 85, 86].includes(c) && c > snow.code) snow = { code: c, day }
    })
    const src = 'Open-Meteo forecast'
    if (gust.v >= 89) factors.push({ name: 'Storm-force wind', points: 35, detail: `Gusts up to ${Math.round(gust.v)} km/h forecast on ${gust.day} (Beaufort storm ≥ 89)`, source: src, observed_at: gust.day })
    else if (gust.v >= 62) factors.push({ name: 'Gale-force wind', points: 20, detail: `Gusts up to ${Math.round(gust.v)} km/h forecast on ${gust.day} (Beaufort gale ≥ 62)`, source: src, observed_at: gust.day })
    if (rain.v >= 204.5) factors.push({ name: 'Extremely heavy rain', points: 35, detail: `${Math.round(rain.v)} mm in a day forecast on ${rain.day} (IMD extremely heavy ≥ 204.5)`, source: src, observed_at: rain.day })
    else if (rain.v >= 115.6) factors.push({ name: 'Very heavy rain', points: 25, detail: `${Math.round(rain.v)} mm in a day forecast on ${rain.day} (IMD very heavy ≥ 115.6)`, source: src, observed_at: rain.day })
    else if (rain.v >= 64.5) factors.push({ name: 'Heavy rain', points: 12, detail: `${Math.round(rain.v)} mm in a day forecast on ${rain.day} (IMD heavy ≥ 64.5)`, source: src, observed_at: rain.day })
    if (storm.code) factors.push({ name: 'Thunderstorms', points: storm.code >= 96 ? 15 : 10, detail: `${WMO[storm.code]} forecast on ${storm.day}`, source: src, observed_at: storm.day })
    if (snow.code && route.mode !== 'sea') factors.push({ name: 'Snow', points: snow.code === 75 || snow.code === 86 ? 15 : 8, detail: `${WMO[snow.code]} forecast on ${snow.day}`, source: src, observed_at: snow.day })
  }

  // --- sea state (sea routes) ---
  if (sea?.data) {
    let wave = { v: 0, day: '' }
    for (const p of sea.data) p.daily?.time.forEach((day, i) => { const h = p.daily!.wave_height_max[i] ?? 0; if (h > wave.v) wave = { v: h, day } })
    if (wave.v >= 6) factors.push({ name: 'Very high waves', points: 30, detail: `Waves up to ${wave.v.toFixed(1)} m forecast on ${wave.day}`, source: 'Open-Meteo marine', observed_at: wave.day })
    else if (wave.v >= 4) factors.push({ name: 'High waves', points: 15, detail: `Waves up to ${wave.v.toFixed(1)} m forecast on ${wave.day}`, source: 'Open-Meteo marine', observed_at: wave.day })
  }

  // --- earthquakes near the route (past 7 days, M4.5+) ---
  const nearQuakes = (hz.quakes.data ?? []).map((q: Quake) => ({ q, km: distanceToPathKm([q.lat, q.lon], geometry.path) })).filter((x) => x.km <= QUAKE_RADIUS_KM)
  if (nearQuakes.length) {
    const worst = nearQuakes.reduce((m, x) => (x.q.mag > m.q.mag ? x : m))
    const pts = worst.q.mag >= 6.5 ? 25 : worst.q.mag >= 5.5 ? 12 : 5
    factors.push({ name: 'Recent earthquake', points: pts, source: 'USGS', observed_at: new Date(worst.q.time).toISOString(),
      detail: `M${worst.q.mag.toFixed(1)} ${worst.q.place}, ${Math.round(worst.km)} km from route${nearQuakes.length > 1 ? ` (+${nearQuakes.length - 1} more within ${QUAKE_RADIUS_KM} km)` : ''}` })
  }

  // --- open natural events near the route: worst per category, summed across categories ---
  const byCat = new Map<string, { e: NaturalEvent; km: number }>()
  for (const e of hz.events.data ?? []) {
    const rule = EONET_RULES[e.category]
    if (!rule) continue
    const km = distanceToPathKm([e.lat, e.lon], geometry.path)
    if (km <= rule.radius && (!byCat.has(e.category) || km < byCat.get(e.category)!.km)) byCat.set(e.category, { e, km })
  }
  for (const [cat, { e, km }] of byCat) factors.push({ name: e.categoryTitle, points: EONET_RULES[cat].points, source: 'NASA EONET', observed_at: e.date,
    detail: `${e.title}${e.magnitude ? ` (${e.magnitude})` : ''}, ${Math.round(km)} km from route` })

  factors.sort((x, y) => y.points - x.points)
  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0))
  return { score, band: bandFor(score), factors, sources, geometry }
}
