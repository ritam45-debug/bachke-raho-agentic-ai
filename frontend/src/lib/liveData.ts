// Live public data used by the Route & Risk Map and Weather tools. All calls run from the viewer's browser,
// only when a user asks (never on a timer), with short-lived caching so repeated views don't re-fetch.
//
// Sources and terms (see documentation/LIVE_DATA.md):
//  - Open-Meteo forecast, marine and geocoding APIs: free, no key, non-commercial use only, CC BY 4.0.
//  - USGS earthquake GeoJSON feeds (public domain), updated every minute.
//  - NASA EONET v3 natural events.
//  - OSRM public demo server for road geometry: non-commercial, max 1 request/second.
import { greatCircle, type LatLon } from './geo'

export interface SourceStatus { name: string; url: string; status: 'ok' | 'failed' | 'skipped'; fetched_at: string }
export interface Fetched<T> { data: T | null; source: SourceStatus }

const TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { at: number; value: unknown }>()

async function getJson<T>(name: string, url: string, display = url.split('?')[0]): Promise<Fetched<T>> {
  const hit = cache.get(url)
  const fetched_at = new Date().toISOString()
  if (hit && Date.now() - hit.at < TTL_MS) return { data: hit.value as T, source: { name, url: display, status: 'ok', fetched_at: new Date(hit.at).toISOString() } }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    const r = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const value = (await r.json()) as T
    cache.set(url, { at: Date.now(), value })
    return { data: value, source: { name, url: display, status: 'ok', fetched_at } }
  } catch {
    return { data: null, source: { name, url: display, status: 'failed', fetched_at } }
  }
}

const round = (n: number) => Math.round(n * 100) / 100
const coordParams = (pts: LatLon[]) =>
  `latitude=${pts.map((p) => round(p[0])).join(',')}&longitude=${pts.map((p) => round(p[1])).join(',')}`

// ---------- geocoding ----------
export interface Place { name: string; country?: string; admin1?: string; latitude: number; longitude: number }
export async function searchPlaces(q: string): Promise<Place[]> {
  if (q.trim().length < 2) return []
  const r = await getJson<{ results?: Place[] }>('Open-Meteo geocoding',
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.trim())}&count=6&language=en&format=json`)
  if (r.source.status === 'failed') throw new Error('Place search is unavailable right now')
  return r.data?.results ?? []
}

// ---------- weather ----------
export interface DailyForecast {
  time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]
  precipitation_sum: number[]; precipitation_probability_max: (number | null)[]; wind_speed_10m_max: number[]; wind_gusts_10m_max: number[]
}
interface ForecastResp { latitude: number; longitude: number; timezone?: string; daily: DailyForecast }

export const DAILY_VARS = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max'

/** One request for many points (Open-Meteo accepts comma-separated coordinate lists). */
export async function forecastFor(points: LatLon[], days: number): Promise<Fetched<ForecastResp[]>> {
  const url = `https://api.open-meteo.com/v1/forecast?${coordParams(points)}&daily=${DAILY_VARS}&forecast_days=${days}&timezone=auto&wind_speed_unit=kmh`
  const r = await getJson<ForecastResp | ForecastResp[]>('Open-Meteo forecast', url)
  return { data: r.data ? (Array.isArray(r.data) ? r.data : [r.data]) : null, source: r.source }
}

interface MarineResp { daily?: { time: string[]; wave_height_max: (number | null)[] } }
export async function marineFor(points: LatLon[], days: number): Promise<Fetched<MarineResp[]>> {
  const url = `https://marine-api.open-meteo.com/v1/marine?${coordParams(points)}&daily=wave_height_max&forecast_days=${days}&timezone=auto`
  const r = await getJson<MarineResp | MarineResp[]>('Open-Meteo marine', url)
  return { data: r.data ? (Array.isArray(r.data) ? r.data : [r.data]) : null, source: r.source }
}

// ---------- hazards ----------
export interface Quake { id: string; mag: number; place: string; time: number; url: string; lat: number; lon: number }
export async function recentQuakes(): Promise<Fetched<Quake[]>> {
  const r = await getJson<{ features: { id: string; properties: { mag: number; place: string; time: number; url: string }; geometry: { coordinates: number[] } }[] }>(
    'USGS earthquakes (M4.5+, 7 days)', 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson')
  return {
    data: r.data ? r.data.features.map((f) => ({ id: f.id, mag: f.properties.mag, place: f.properties.place, time: f.properties.time, url: f.properties.url, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] })) : null,
    source: r.source,
  }
}

export interface NaturalEvent { id: string; title: string; category: string; categoryTitle: string; date: string; lat: number; lon: number; link: string; magnitude?: string }
interface EonetEvent { id: string; title: string; link: string; categories: { id: string; title: string }[]; geometry: { date: string; type: string; coordinates: unknown; magnitudeValue?: number | null; magnitudeUnit?: string | null }[] }

function firstPoint(type: string, c: unknown): LatLon | null {
  if (type === 'Point' && Array.isArray(c)) return [c[1] as number, c[0] as number]
  if (type === 'Polygon' && Array.isArray(c) && Array.isArray(c[0])) {
    const ring = c[0] as number[][]
    const lat = ring.reduce((a, p) => a + p[1], 0) / ring.length, lon = ring.reduce((a, p) => a + p[0], 0) / ring.length
    return [lat, lon]
  }
  return null
}

export async function openNaturalEvents(): Promise<Fetched<NaturalEvent[]>> {
  const r = await getJson<{ events: EonetEvent[] }>('NASA EONET (open events, 30 days)', 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30')
  const out: NaturalEvent[] = []
  for (const e of r.data?.events ?? []) {
    const g = e.geometry[e.geometry.length - 1] // most recent position
    const p = g ? firstPoint(g.type, g.coordinates) : null
    if (!p) continue
    out.push({ id: e.id, title: e.title, category: e.categories[0]?.id ?? 'other', categoryTitle: e.categories[0]?.title ?? 'Other', date: g.date, lat: p[0], lon: p[1], link: e.link,
      magnitude: g.magnitudeValue != null ? `${g.magnitudeValue} ${g.magnitudeUnit ?? ''}`.trim() : undefined })
  }
  return { data: r.data ? out : null, source: r.source }
}

// ---------- route geometry ----------
let lastOsrm = 0
export interface RouteGeometry { path: LatLon[]; kind: 'road' | 'great-circle'; note: string; source?: SourceStatus }

export async function routeGeometry(mode: string, a: LatLon, b: LatLon): Promise<RouteGeometry> {
  if (mode === 'road') {
    const wait = 1100 - (Date.now() - lastOsrm) // public server allows at most 1 request per second
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastOsrm = Date.now()
    const url = `https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=simplified&geometries=geojson`
    const r = await getJson<{ routes?: { geometry: { coordinates: number[][] }; distance: number; duration: number }[] }>('OSRM road routing', url)
    const best = r.data?.routes?.[0]
    if (best) return { path: best.geometry.coordinates.map((c) => [c[1], c[0]] as LatLon), kind: 'road', source: r.source,
      note: `Road route ≈ ${Math.round(best.distance / 1000)} km, ${(best.duration / 3600).toFixed(1)} h driving (OSRM, OpenStreetMap data)` }
    return { path: greatCircle(a, b), kind: 'great-circle', source: r.source, note: 'Road routing unavailable — showing a straight line instead' }
  }
  const note = mode === 'air' ? 'Great-circle flight path'
    : mode === 'sea' ? 'Straight-line (great-circle) path — real shipping lanes, ports and chokepoints are not modelled yet'
    : 'Straight-line path — rail network not modelled yet'
  return { path: greatCircle(a, b), kind: 'great-circle', note }
}

export const WMO: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Heavy freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 97: 'Severe thunderstorm', 99: 'Thunderstorm, heavy hail',
}
