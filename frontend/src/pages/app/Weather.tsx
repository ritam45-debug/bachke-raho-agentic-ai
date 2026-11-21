import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CloudSun, Loader2, RefreshCw } from 'lucide-react'
import { useApi } from '../../lib/useApi'
import { forecastFor, WMO, type DailyForecast } from '../../lib/liveData'
import { dayFlags } from '../../lib/liveRisk'
import PlaceSearch from '../../components/PlaceSearch'
import { Empty, ErrorBox, PageHeader } from '../../components/ui'
import type { Loc, RouteRow } from './RiskMap'

interface Spot { key: string; name: string; lat: number; lon: number; sub?: string }
const tip = { contentStyle: { background: '#0b1b33', border: '1px solid #1c375c', borderRadius: 8, color: '#e2e8f0', fontSize: 12 } }
const dayLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

function rows(d: DailyForecast) {
  return d.time.map((t, i) => {
    const gust = d.wind_gusts_10m_max[i] ?? 0, rain = d.precipitation_sum[i] ?? 0, code = d.weather_code[i] ?? 0
    return { date: t, label: dayLabel(t), code, cond: WMO[code] ?? `Code ${code}`, tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i],
      rain, prob: d.precipitation_probability_max[i], wind: d.wind_speed_10m_max[i], gust, flags: dayFlags({ gust, rain, code }) }
  })
}

export default function WeatherPage() {
  const company = useApi<{ locations: Loc[] }>('/company')
  const routes = useApi<RouteRow[]>('/routes')
  const spots: Spot[] = useMemo(() => {
    const s: Spot[] = (company.data?.locations ?? []).filter((l) => l.latitude != null)
      .map((l) => ({ key: l.id, name: l.name, lat: l.latitude!, lon: l.longitude!, sub: [l.city, l.country].filter(Boolean).join(', ') }))
    // Route endpoints that are not saved locations (e.g. a customer's port) are watched too.
    for (const r of routes.data ?? []) {
      if (!r.origin_location_id) s.push({ key: `o-${r.id}`, name: r.origin_label, lat: r.origin_lat, lon: r.origin_lon, sub: `start of ${r.name}` })
      if (!r.destination_location_id) s.push({ key: `d-${r.id}`, name: r.destination_label, lat: r.destination_lat, lon: r.destination_lon, sub: `end of ${r.name}` })
    }
    return s
  }, [company.data, routes.data])

  const [days, setDays] = useState(7)
  const [watch, setWatch] = useState<{ spot: Spot; d: ReturnType<typeof rows> }[] | null>(null)
  const [watchErr, setWatchErr] = useState<string | null>(null)
  const [watchLoading, setWatchLoading] = useState(false)
  const [active, setActive] = useState<Spot | null>(null)
  const [detail, setDetail] = useState<ReturnType<typeof rows> | null>(null)
  const [detailErr, setDetailErr] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  // Weather watch: ONE request covers every watched place (Open-Meteo multi-coordinate call).
  const loadWatch = useCallback(async () => {
    if (!spots.length) { setWatch([]); return }
    setWatchLoading(true); setWatchErr(null)
    const r = await forecastFor(spots.map((s) => [s.lat, s.lon]), 7)
    if (!r.data) setWatchErr('Could not reach the Open-Meteo forecast service. If you are viewing this inside Claude, live data is blocked there: open the GitHub Pages version.')
    else { setWatch(r.data.map((f, i) => ({ spot: spots[i], d: rows(f.daily) }))); setFetchedAt(r.source.fetched_at) }
    setWatchLoading(false)
  }, [spots])
  useEffect(() => { void loadWatch() }, [loadWatch])

  useEffect(() => {
    if (!active) return
    setDetail(null); setDetailErr(null)
    forecastFor([[active.lat, active.lon]], days).then((r) => r.data ? setDetail(rows(r.data[0].daily)) : setDetailErr('Forecast unavailable right now.'))
  }, [active, days])

  const ranked = useMemo(() => (watch ?? []).map((w) => {
    const all = w.d.flatMap((x) => x.flags.map((f) => ({ ...f, day: x.label })))
    return { ...w, warnings: all.filter((f) => f.level === 'warning').length, watches: all.filter((f) => f.level === 'watch').length, first: all.find((f) => f.level === 'warning') ?? all[0] }
  }).sort((a, b) => b.warnings - a.warnings || b.watches - a.watches), [watch])

  return (
    <>
      <PageHeader title="Weather Forecast" subtitle="Daily forecasts for every location and route end you watch, with days flagged against IMD rainfall categories, the Beaufort wind scale and WMO thunderstorm/snow codes. Forecasts, not guarantees."
        actions={<button className="btn-ghost" onClick={() => void loadWatch()} disabled={watchLoading}><RefreshCw size={15} className={watchLoading ? 'animate-spin' : ''} />Refresh</button>} />

      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <div className="space-y-3">
          <PlaceSearch placeholder="Forecast for any place…" onSelect={(p) => setActive({ key: `p-${p.latitude},${p.longitude}`, name: p.name, lat: p.latitude, lon: p.longitude, sub: p.country })} />
          <div className="card">
            <div className="flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><span>7-day weather watch</span>{fetchedAt && <span className="normal-case">updated {new Date(fetchedAt).toLocaleTimeString()}</span>}</div>
            {watchLoading && <div className="flex items-center gap-2 px-4 pb-4 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" />Loading forecasts…</div>}
            {watchErr && <div className="px-4 pb-4"><ErrorBox message={watchErr} /></div>}
            {!watchLoading && !spots.length && <div className="p-4"><Empty>Add locations or routes on the Route & Risk Map to watch their weather.</Empty></div>}
            <div className="divide-y divide-slate-100 dark:divide-ink-800">
              {ranked.map((w) => (
                <button key={w.spot.key} onClick={() => setActive(w.spot)} className={`flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-ink-800/50 ${active?.key === w.spot.key ? 'bg-slate-50 dark:bg-ink-800/60' : ''}`}>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{w.spot.name}</span>
                    <span className="block truncate text-xs text-slate-500">{w.first ? `${w.first.day}: ${w.first.label}` : `${w.d[0]?.cond}, ${Math.round(w.d[0]?.tmax ?? 0)}° today`}</span></span>
                  {w.warnings > 0 && <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-500/15 dark:text-red-300">{w.warnings} warning{w.warnings > 1 ? 's' : ''}</span>}
                  {!w.warnings && w.watches > 0 && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{w.watches} watch</span>}
                  {!w.warnings && !w.watches && <span className="text-xs text-emerald-600 dark:text-emerald-400">clear</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          {!active ? <Empty><CloudSun className="mx-auto mb-2 text-slate-400" />Choose a place from the watch list or search to see its detailed forecast.</Empty> : (
            <div className="card p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><h2 className="font-display text-xl font-bold">{active.name}</h2><p className="text-xs text-slate-500">{active.sub} · {active.lat.toFixed(3)}, {active.lon.toFixed(3)}</p></div>
                <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs dark:bg-ink-800">
                  {[3, 7, 14, 16].map((d) => <button key={d} onClick={() => setDays(d)} className={`rounded-md px-3 py-1 ${days === d ? 'bg-white font-semibold shadow dark:bg-ink-700' : ''}`}>{d} days</button>)}
                </div>
              </div>
              {detailErr && <div className="mt-4"><ErrorBox message={detailErr} /></div>}
              {!detail && !detailErr && <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" />Loading…</div>}
              {detail && (
                <>
                  <div className="mt-4 h-64">
                    <ResponsiveContainer><ComposedChart data={detail}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" vertical={false} />
                      <XAxis dataKey="label" fontSize={11} tickLine={false} />
                      <YAxis yAxisId="t" fontSize={11} unit="°" width={36} tickLine={false} />
                      <YAxis yAxisId="r" orientation="right" fontSize={11} unit=" mm" width={50} tickLine={false} />
                      <Tooltip {...tip} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar yAxisId="r" dataKey="rain" name="Rain (mm)" fill="#60a5fa" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="t" dataKey="tmax" name="Max °C" stroke="#f5a524" strokeWidth={2} dot={false} />
                      <Line yAxisId="t" dataKey="tmin" name="Min °C" stroke="#2dd4bf" strokeWidth={2} dot={false} />
                    </ComposedChart></ResponsiveContainer>
                  </div>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-ink-700">
                        {['Day', 'Conditions', 'Temp °C', 'Rain', 'Wind / gusts km/h', 'Flags'].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
                      <tbody>{detail.map((d) => (
                        <tr key={d.date} className="border-b border-slate-100 last:border-0 dark:border-ink-800">
                          <td className="whitespace-nowrap px-2 py-2">{d.label}</td><td className="px-2 py-2">{d.cond}</td>
                          <td className="num px-2 py-2">{Math.round(d.tmin)}–{Math.round(d.tmax)}</td>
                          <td className="num whitespace-nowrap px-2 py-2">{d.rain.toFixed(1)} mm{d.prob != null ? ` · ${d.prob}%` : ''}</td>
                          <td className="num px-2 py-2">{Math.round(d.wind)} / {Math.round(d.gust)}</td>
                          <td className="px-2 py-2">{d.flags.length ? d.flags.map((f) => <span key={f.label} className={`mr-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium ${f.level === 'warning' ? 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'}`}>{f.label}</span>) : <span className="text-xs text-slate-400">—</span>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-[11px] text-slate-500">Source: Open-Meteo forecast API (CC BY 4.0), fetched from your browser. Forecast skill falls with lead time; treat days 8–16 as indicative only.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
