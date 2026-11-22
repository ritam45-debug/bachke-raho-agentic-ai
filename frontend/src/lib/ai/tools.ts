// Read-only, tenant-scoped tools the agents may call. Every tool goes through this app's own API with the
// signed-in user's session, so the server's company filter, row-level security and role checks always apply:
// an agent can never see more than the person using it.
import { api } from '../api'
import { forecastFor, WMO } from '../liveData'
import { assessRoute, dayFlags, FORECAST_DAYS, RULES_VERSION, type RouteLike } from '../liveRisk'
import type { ToolSchema } from './claude'

export interface Tool extends ToolSchema {
  /** L1 tools only read. 'records' tools also save an observation (a risk check), never a business action. */
  effect: 'read' | 'records'
  run: (input: Record<string, unknown>) => Promise<unknown>
}

const MAX_RESULT_CHARS = 12000

/**
 * Tool output can contain text that companies or outside feeds wrote (route names, notes, news titles).
 * It is wrapped as data and the system prompt tells the model never to follow instructions found inside.
 */
export function wrapUntrusted(tool: string, value: unknown): string {
  let json = JSON.stringify(value, null, 0) ?? 'null'
  if (json.length > MAX_RESULT_CHARS) json = json.slice(0, MAX_RESULT_CHARS) + '…[truncated]'
  // Neutralise any attempt to close the wrapper from inside the data.
  json = json.replace(/<\/?untrusted_data/gi, '[tag removed]')
  return `<untrusted_data source="tool:${tool}">\n${json}\n</untrusted_data>`
}

const str = (v: unknown, name: string) => { if (typeof v !== 'string' || !v) throw new Error(`"${name}" is required`); return v }
const num = (v: unknown, name: string, min: number, max: number) => {
  const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new Error(`"${name}" must be between ${min} and ${max}`); return n
}

interface RouteRow extends RouteLike { origin_label: string; destination_label: string; latest_check: { score: number; band: string; checked_at: string; factors: { name: string; points: number; detail: string; source: string }[] } | null }

export const TOOLS: Tool[] = [
  {
    name: 'get_company_overview', effect: 'read',
    description: 'Headline KPIs for the company: routes watched and checked, routes at elevated/high risk, highest route score, sites on the map, open/delayed shipments, active disruptions, plus the riskiest routes.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const o = await api<{ kpis: Record<string, unknown>; route_risks: unknown[] }>('/dashboard/overview')
      return { kpis: o.kpis, riskiest_routes: o.route_risks }
    },
  },
  {
    name: 'list_locations', effect: 'read',
    description: "The company's sites (headquarters, plants, warehouses, distribution centres) with city, country and map coordinates (null if not placed on the map).",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => (await api<{ locations: unknown[] }>('/company')).locations,
  },
  {
    name: 'list_routes', effect: 'read',
    description: 'All watched transport routes with mode, endpoints and their LATEST stored risk check (0-100 rule-based score, band, check time and the factors that produced it). latest_check is null if never checked.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => (await api<RouteRow[]>('/routes')).map((r) => ({
      id: r.id, name: r.name, mode: r.mode, from: r.origin_label, to: r.destination_label,
      latest_check: r.latest_check && { score: r.latest_check.score, band: r.latest_check.band, checked_at: r.latest_check.checked_at, factors: r.latest_check.factors },
    })),
  },
  {
    name: 'get_route_risk_history', effect: 'read',
    description: 'The stored risk-check history (newest first, up to 10) for one route, to see whether risk is rising or falling.',
    input_schema: { type: 'object', properties: { route_id: { type: 'string', description: 'Route id from list_routes' } }, required: ['route_id'], additionalProperties: false },
    run: async (i) => {
      const h = await api<{ score: number; band: string; checked_at: string; factors: { name: string; points: number }[] }[]>(`/routes/${encodeURIComponent(str(i.route_id, 'route_id'))}/risk-checks`)
      return h.slice(0, 10).map((c) => ({ score: c.score, band: c.band, checked_at: c.checked_at, factors: c.factors.map((f) => `${f.name} +${f.points}`) }))
    },
  },
  {
    name: 'run_live_route_check', effect: 'records',
    description: `Run a fresh live risk check on one route now (weather ${FORECAST_DAYS}-day forecast, waves for sea routes, USGS earthquakes, NASA EONET events) and save it to the route's history. Use when the latest check is missing or older than about 6 hours, or the user asks for current conditions.`,
    input_schema: { type: 'object', properties: { route_id: { type: 'string' } }, required: ['route_id'], additionalProperties: false },
    run: async (i) => {
      const id = str(i.route_id, 'route_id')
      const route = (await api<RouteRow[]>('/routes')).find((r) => r.id === id)
      if (!route) throw new Error('Route not found in this company')
      const res = await assessRoute(route)
      const ok = res.sources.filter((s) => s.status === 'ok').length
      if (!ok) throw new Error('No live data source could be reached from this browser')
      await api(`/routes/${id}/risk-checks`, { method: 'POST', json: { score: res.score, band: res.band, factors: res.factors, sources: res.sources, forecast_days: FORECAST_DAYS, rules_version: RULES_VERSION } })
      return { route: route.name, score: res.score, band: res.band, factors: res.factors, sources: res.sources.map((s) => `${s.name}: ${s.status}`), path_note: res.geometry.note }
    },
  },
  {
    name: 'get_weather_forecast', effect: 'read',
    description: 'Daily weather forecast (Open-Meteo) for a coordinate: conditions, temperature, rain, wind and gusts, with days flagged against IMD rain and Beaufort wind thresholds.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['latitude', 'longitude'],
      properties: { latitude: { type: 'number' }, longitude: { type: 'number' }, days: { type: 'integer', minimum: 1, maximum: 16, description: 'Default 7' }, place_name: { type: 'string' } },
    },
    run: async (i) => {
      const lat = num(i.latitude, 'latitude', -90, 90), lon = num(i.longitude, 'longitude', -180, 180)
      const days = i.days == null ? 7 : num(i.days, 'days', 1, 16)
      const r = await forecastFor([[lat, lon]], days)
      if (!r.data) throw new Error('Forecast service unavailable')
      const d = r.data[0].daily
      return {
        place: i.place_name ?? `${lat}, ${lon}`, source: 'Open-Meteo', fetched_at: r.source.fetched_at,
        days: d.time.map((t, k) => ({
          date: t, conditions: WMO[d.weather_code[k]] ?? d.weather_code[k], t_min: d.temperature_2m_min[k], t_max: d.temperature_2m_max[k],
          rain_mm: d.precipitation_sum[k], rain_prob_pct: d.precipitation_probability_max[k], wind_kmh: d.wind_speed_10m_max[k], gust_kmh: d.wind_gusts_10m_max[k],
          flags: dayFlags({ gust: d.wind_gusts_10m_max[k] ?? 0, rain: d.precipitation_sum[k] ?? 0, code: d.weather_code[k] ?? 0 }).map((f) => `${f.level}: ${f.label}`),
        })),
      }
    },
  },
  {
    name: 'list_disruptions', effect: 'read',
    description: "Disruption records logged for this company (title, category, 0-100 severity, status, verification, affected countries and suppliers).",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => api('/disruptions'),
  },
]

export const toolSchemas = (tools: Tool[]): ToolSchema[] => tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }))
