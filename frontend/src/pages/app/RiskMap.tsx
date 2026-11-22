import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Loader2, MapPin, Plus, Radar, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/useApi'
import { dateTime, titleCase } from '../../lib/format'
import type { LatLon } from '../../lib/geo'
import { routeGeometry, type NaturalEvent, type Quake, type SourceStatus } from '../../lib/liveData'
import { assessRoute, FORECAST_DAYS, loadHazards, RULES_VERSION, type Factor } from '../../lib/liveRisk'
import LiveMap, { BAND_COLOR, MapLegend, type Layers } from '../../components/LiveMap'
import PlaceSearch from '../../components/PlaceSearch'
import CsvImport from '../../components/CsvImport'
import { Badge, ErrorBox, PageHeader } from '../../components/ui'
import RequestApproval from '../../components/RequestApproval'

export interface Loc { id: string; name: string; kind: string; city: string | null; country: string | null; latitude: number | null; longitude: number | null }
interface Check { id: string; score: number; band: string; factors: Factor[]; sources: SourceStatus[]; checked_at: string; forecast_days: number }
export interface RouteRow {
  id: string; name: string; mode: string; origin_label: string; destination_label: string; origin_lat: number; origin_lon: number
  destination_lat: number; destination_lon: number; origin_location_id: string | null; destination_location_id: string | null; latest_check: Check | null
}
type Endpoint = { locId?: string; label?: string; lat?: number; lon?: number }

function ScorePill({ c }: { c: Check | null }) {
  if (!c) return <span className="text-xs text-slate-400">not checked</span>
  return <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold text-white" style={{ background: BAND_COLOR[c.band] }}>
    <span className="num">{c.score}</span>{titleCase(c.band)}</span>
}

function EndpointPicker({ label, locs, value, onChange, picking, onPickMode }: {
  label: string; locs: Loc[]; value: Endpoint; onChange: (e: Endpoint) => void; picking: boolean; onPickMode: () => void
}) {
  const mapped = locs.filter((l) => l.latitude != null)
  return (
    <div className="space-y-1.5">
      <label className="label">{label}</label>
      <select className="input" value={value.locId ?? (value.lat != null ? '__custom' : '')}
        onChange={(e) => onChange(e.target.value && e.target.value !== '__custom' ? { locId: e.target.value } : {})}>
        <option value="">Choose a saved location…</option>
        {mapped.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        {value.lat != null && !value.locId && <option value="__custom">{value.label}</option>}
      </select>
      {!value.locId && (
        <div className="flex gap-2">
          <div className="flex-1"><PlaceSearch placeholder="…or search any place" onSelect={(p) => onChange({ label: [p.name, p.country].filter(Boolean).join(', '), lat: p.latitude, lon: p.longitude })} /></div>
          <button type="button" className={`btn-ghost !px-2.5 ${picking ? '!border-signal text-signal' : ''}`} title="Click on the map" onClick={onPickMode}><MapPin size={15} /></button>
        </div>
      )}
    </div>
  )
}

export default function RiskMapPage() {
  const { can } = useAuth()
  const canEdit = can('ops:write')
  const canEditLocs = can('company:update')
  const company = useApi<{ locations: Loc[]; is_demo: boolean }>('/company')
  const routesApi = useApi<RouteRow[]>('/routes')
  const locs = useMemo(() => company.data?.locations ?? [], [company.data])
  const routes = useMemo(() => routesApi.data ?? [], [routesApi.data])

  const [layers, setLayers] = useState<Layers>({ locations: true, routes: true, quakes: true, events: true })
  const [quakes, setQuakes] = useState<Quake[]>([])
  const [events, setEvents] = useState<NaturalEvent[]>([])
  const [hazardSources, setHazardSources] = useState<SourceStatus[]>([])
  const [hazardsLoading, setHazardsLoading] = useState(false)
  const [paths, setPaths] = useState<Record<string, { path: LatLon[]; note: string }>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [checking, setChecking] = useState<Record<string, boolean>>({})
  const [progress, setProgress] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [panel, setPanel] = useState<'route' | 'location' | 'import' | null>(null)
  const [pickFor, setPickFor] = useState<'origin' | 'destination' | 'location' | null>(null)
  const [form, setForm] = useState<{ name: string; mode: string; origin: Endpoint; destination: Endpoint }>({ name: '', mode: 'road', origin: {}, destination: {} })
  const [locForm, setLocForm] = useState<{ name: string; kind: string; city: string; country: string; lat?: number; lon?: number }>({ name: '', kind: 'warehouse', city: '', country: '' })
  const [importKind, setImportKind] = useState<'locations' | 'routes'>('locations')
  const [history, setHistory] = useState<Check[] | null>(null)

  const refreshHazards = useCallback(async () => {
    setHazardsLoading(true)
    const h = await loadHazards()
    setQuakes(h.quakes.data ?? []); setEvents(h.events.data ?? [])
    setHazardSources([h.quakes.source, h.events.source])
    setHazardsLoading(false)
    return h
  }, [])
  useEffect(() => { void refreshHazards() }, [refreshHazards])

  // Route geometry: straight/great-circle lines are computed locally; road routes ask OSRM (throttled, cached).
  useEffect(() => {
    let alive = true
    ;(async () => {
      for (const r of routes) {
        if (paths[r.id] || !alive) continue
        const g = await routeGeometry(r.mode, [r.origin_lat, r.origin_lon], [r.destination_lat, r.destination_lon])
        if (alive) setPaths((p) => ({ ...p, [r.id]: { path: g.path, note: g.note } }))
      }
    })()
    return () => { alive = false }
  }, [routes]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setHistory(null)
    if (selected) api<Check[]>(`/routes/${selected}/risk-checks`).then(setHistory).catch(() => setHistory([]))
  }, [selected, routesApi.data])

  const mapLocs = useMemo(() => locs.filter((l) => l.latitude != null && l.longitude != null).map((l) => ({ ...l, latitude: l.latitude!, longitude: l.longitude! })), [locs])
  const mapRoutes = useMemo(() => routes.map((r) => ({ id: r.id, name: r.name, mode: r.mode, band: r.latest_check?.band, score: r.latest_check?.score,
    path: paths[r.id]?.path ?? [[r.origin_lat, r.origin_lon], [r.destination_lat, r.destination_lon]] as LatLon[] })), [routes, paths])

  const check = async (list: RouteRow[]) => {
    const ids = list.map((r) => r.id)
    setErr(null)
    const h = await refreshHazards() // shared hazard feeds fetched once for the whole batch
    let failed = 0
    for (const [i, id] of ids.entries()) {
      const r = list[i]
      setChecking((c) => ({ ...c, [id]: true }))
      setProgress(ids.length > 1 ? `Checking ${i + 1} of ${ids.length}: ${r.name}` : null)
      try {
        const res = await assessRoute(r, h)
        setPaths((p) => ({ ...p, [id]: { path: res.geometry.path, note: res.geometry.note } }))
        if (!res.sources.some((s) => s.status === 'ok')) throw new Error('No live source could be reached')
        await api(`/routes/${id}/risk-checks`, { method: 'POST', json: { score: res.score, band: res.band, factors: res.factors, sources: res.sources, forecast_days: FORECAST_DAYS, rules_version: RULES_VERSION } })
      } catch (e) { failed++; setErr(`${r.name}: ${(e as Error).message}`) }
      setChecking((c) => ({ ...c, [id]: false }))
    }
    setProgress(null)
    await routesApi.reload()
    if (failed && ids.length > 1) setErr(`${failed} of ${ids.length} checks could not be completed. Live sources may be blocked on this network.`)
  }

  const saveRoute = async () => {
    setErr(null)
    const side = (e: Endpoint, s: string) => e.locId ? { [`${s}_location_id`]: e.locId } : { [`${s}_label`]: e.label, [`${s}_lat`]: e.lat, [`${s}_lon`]: e.lon }
    try {
      const r = await api<RouteRow>('/routes', { method: 'POST', json: { name: form.name, mode: form.mode, ...side(form.origin, 'origin'), ...side(form.destination, 'destination') } })
      setForm({ name: '', mode: 'road', origin: {}, destination: {} }); setPanel(null); setPickFor(null)
      await routesApi.reload(); setSelected(r.id); void check([r])
    } catch (e) { setErr((e as Error).message) }
  }

  const saveLocation = async () => {
    setErr(null)
    try {
      await api('/company/locations', { method: 'POST', json: { name: locForm.name, kind: locForm.kind, city: locForm.city || null, country: locForm.country || null, latitude: locForm.lat ?? null, longitude: locForm.lon ?? null } })
      setLocForm({ name: '', kind: 'warehouse', city: '', country: '' }); setPanel(null); setPickFor(null); await company.reload()
    } catch (e) { setErr((e as Error).message) }
  }

  const onPick = pickFor ? (p: LatLon) => {
    const label = `Pinned ${p[0].toFixed(3)}, ${p[1].toFixed(3)}`
    if (pickFor === 'location') setLocForm((f) => ({ ...f, lat: p[0], lon: p[1] }))
    else setForm((f) => ({ ...f, [pickFor]: { label, lat: p[0], lon: p[1] } }))
    setPickFor(null)
  } : undefined

  const sel = routes.find((r) => r.id === selected)
  const anyChecking = Object.values(checking).some(Boolean)
  const failedHazard = hazardSources.filter((s) => s.status === 'failed')

  return (
    <>
      <PageHeader title="Route & Risk Map"
        subtitle={`Your locations and routes on a live map, checked against live weather (${FORECAST_DAYS}-day forecast), sea state, earthquakes and natural events. Scores are rule-based 0–100, not probabilities.`}
        actions={<>
          <button className="btn-ghost" onClick={() => void refreshHazards()} disabled={hazardsLoading}><RefreshCw size={15} className={hazardsLoading ? 'animate-spin' : ''} />Hazards</button>
          <button className="btn-primary" disabled={!routes.length || anyChecking} onClick={() => check(routes)}>
            {anyChecking ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />}Check all routes</button>
        </>} />

      {progress && <p className="mb-3 text-sm text-slate-500">{progress}</p>}
      {err && <div className="mb-3"><ErrorBox message={err} /></div>}
      {failedHazard.length > 0 && <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
        Could not reach {failedHazard.map((s) => s.name).join(' and ')}. Hazard layers may be incomplete. If you are viewing this inside Claude, live data is blocked there: open the GitHub Pages version.</div>}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-2">
          {pickFor && <div className="rounded-lg bg-signal/15 px-3 py-2 text-sm font-medium">Click the map to place the {pickFor}. <button className="ml-2 underline" onClick={() => setPickFor(null)}>Cancel</button></div>}
          <LiveMap locations={mapLocs} routes={mapRoutes} quakes={quakes} events={events} layers={layers} selectedRouteId={selected} onSelectRoute={setSelected} onPick={onPick} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-3 text-xs">
              {(Object.keys(layers) as (keyof Layers)[]).map((k) => (
                <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                  {k === 'events' ? `Natural events (${events.length})` : k === 'quakes' ? `Earthquakes M4.5+ (${quakes.length})` : titleCase(k)}</label>
              ))}
            </div>
            <MapLegend />
          </div>
          <p className="text-[11px] text-slate-500">Live data: Open-Meteo (CC BY 4.0) · USGS · NASA EONET · OSRM · map © OpenStreetMap contributors. Fetched from your browser on demand and cached for 10 minutes.</p>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {canEdit && <button className={`btn-ghost ${panel === 'route' ? '!border-signal' : ''}`} onClick={() => setPanel(panel === 'route' ? null : 'route')}><Plus size={15} />Route</button>}
            {canEditLocs && !company.data?.is_demo && <button className={`btn-ghost ${panel === 'location' ? '!border-signal' : ''}`} onClick={() => setPanel(panel === 'location' ? null : 'location')}><MapPin size={15} />Location</button>}
            {(canEdit || canEditLocs) && <button className={`btn-ghost ${panel === 'import' ? '!border-signal' : ''}`} onClick={() => setPanel(panel === 'import' ? null : 'import')}><Upload size={15} />Import CSV</button>}
          </div>

          {panel === 'route' && (
            <div className="card space-y-3 p-4">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">New route</h3><button onClick={() => setPanel(null)} aria-label="Close"><X size={16} /></button></div>
              <div className="grid grid-cols-[1fr_110px] gap-2">
                <div><label className="label">Name</label><input className="input" placeholder="e.g. Chennai → Singapore" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><label className="label">Mode</label><select className="input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>{['road', 'sea', 'air', 'rail'].map((m) => <option key={m}>{m}</option>)}</select></div>
              </div>
              <EndpointPicker label="From" locs={locs} value={form.origin} onChange={(o) => setForm({ ...form, origin: o })} picking={pickFor === 'origin'} onPickMode={() => setPickFor('origin')} />
              <EndpointPicker label="To" locs={locs} value={form.destination} onChange={(d) => setForm({ ...form, destination: d })} picking={pickFor === 'destination'} onPickMode={() => setPickFor('destination')} />
              <button className="btn-primary w-full" disabled={form.name.trim().length < 2 || !(form.origin.locId || form.origin.lat != null) || !(form.destination.locId || form.destination.lat != null)} onClick={saveRoute}>Save & check risk</button>
            </div>
          )}

          {panel === 'location' && (
            <div className="card space-y-3 p-4">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">New location</h3><button onClick={() => setPanel(null)} aria-label="Close"><X size={16} /></button></div>
              <PlaceSearch onSelect={(p) => setLocForm((f) => ({ ...f, name: f.name || p.name, city: p.name, country: p.country ?? '', lat: p.latitude, lon: p.longitude }))} />
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2"><label className="label">Name</label><input className="input" value={locForm.name} onChange={(e) => setLocForm({ ...locForm, name: e.target.value })} /></div>
                <div><label className="label">Type</label><select className="input" value={locForm.kind} onChange={(e) => setLocForm({ ...locForm, kind: e.target.value })}>{['manufacturing', 'warehouse', 'distribution', 'headquarters'].map((k) => <option key={k}>{k}</option>)}</select></div>
                <div><label className="label">Country</label><input className="input" value={locForm.country} onChange={(e) => setLocForm({ ...locForm, country: e.target.value })} /></div>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{locForm.lat != null ? `${locForm.lat.toFixed(4)}, ${locForm.lon!.toFixed(4)}` : 'No coordinates yet'}</span>
                <button className="flex items-center gap-1 text-signal hover:underline" onClick={() => setPickFor('location')}><MapPin size={13} />Pick on map</button>
              </div>
              <button className="btn-primary w-full" disabled={locForm.name.trim().length < 2 || locForm.lat == null} onClick={saveLocation}>Save location</button>
            </div>
          )}

          {panel === 'import' && (
            <div className="card space-y-3 p-4">
              <div className="flex items-center justify-between">
                <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs dark:bg-ink-800">
                  {(['locations', 'routes'] as const).filter((k) => (k === 'locations' ? canEditLocs : canEdit)).map((k) => (
                    <button key={k} className={`rounded-md px-3 py-1 ${importKind === k ? 'bg-white font-semibold shadow dark:bg-ink-700' : ''}`} onClick={() => setImportKind(k)}>{titleCase(k)}</button>
                  ))}
                </div>
                <button onClick={() => setPanel(null)} aria-label="Close"><X size={16} /></button>
              </div>
              <CsvImport kind={importKind} locations={locs} onDone={() => { void company.reload(); void routesApi.reload() }} />
            </div>
          )}

          <div className="card divide-y divide-slate-100 dark:divide-ink-800">
            <div className="flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><span>Routes ({routes.length})</span><span>Latest risk</span></div>
            {!routes.length && <p className="p-4 text-sm text-slate-500">No routes yet. Add one, or import a CSV, to start watching it.</p>}
            {routes.map((r) => (
              <button key={r.id} onClick={() => setSelected(r.id)} className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-ink-800/50 ${selected === r.id ? 'bg-slate-50 dark:bg-ink-800/60' : ''}`}>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.name}</span><span className="block truncate text-xs text-slate-500">{titleCase(r.mode)} · {r.origin_label} → {r.destination_label}</span></span>
                {checking[r.id] ? <Loader2 size={15} className="animate-spin text-slate-400" /> : <ScorePill c={r.latest_check} />}
              </button>
            ))}
          </div>

          {sel && (
            <div className="card space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div><h3 className="font-semibold">{sel.name}</h3><p className="text-xs text-slate-500">{paths[sel.id]?.note ?? 'Loading path…'}</p></div>
                <div className="flex gap-1">
                  <button className="btn-ghost !px-2.5 !py-1.5 text-xs" disabled={checking[sel.id]} onClick={() => check([sel])}><Activity size={14} />Check now</button>
                  {canEdit && <button className="btn-ghost !px-2 !py-1.5" aria-label="Delete route" onClick={async () => { await api(`/routes/${sel.id}`, { method: 'DELETE' }); setSelected(null); await routesApi.reload() }}><Trash2 size={14} /></button>}
                </div>
              </div>
              {sel.latest_check ? (
                <>
                  <div className="flex items-center gap-3"><ScorePill c={sel.latest_check} /><span className="text-xs text-slate-500">checked {dateTime(sel.latest_check.checked_at)}</span></div>
                  {sel.latest_check.factors.length ? (
                    <ul className="space-y-1.5">{sel.latest_check.factors.map((f, i) => (
                      <li key={i} className="flex gap-2 text-sm"><span className="num w-8 shrink-0 text-right text-xs font-semibold text-slate-500">+{f.points}</span>
                        <span><b className="font-medium">{f.name}.</b> {f.detail} <span className="text-xs text-slate-400">({f.source})</span></span></li>
                    ))}</ul>
                  ) : <p className="text-sm text-emerald-600 dark:text-emerald-400">No hazards above thresholds along this route in the next {sel.latest_check.forecast_days} days.</p>}
                  <div className="flex flex-wrap gap-1.5">{sel.latest_check.sources.map((s) => <Badge key={s.name} value={`${s.name}: ${s.status}`} tone={s.status === 'ok' ? 'green' : 'amber'} />)}</div>
                  {(sel.latest_check.band === 'elevated' || sel.latest_check.band === 'high') && (
                    <RequestApproval key={sel.latest_check.id} compact source="route_risk" sourceRef={sel.name} title={`Mitigate ${titleCase(sel.latest_check.band)} risk on ${sel.name}`}
                      details={`Route risk score ${sel.latest_check.score} (${sel.latest_check.band}, rule-based, not a probability) at ${dateTime(sel.latest_check.checked_at)}.\n${sel.latest_check.factors.map((f) => `• ${f.name}: ${f.detail} (${f.source})`).join('\n')}\nProposed action: `} />
                  )}
                </>
              ) : <p className="text-sm text-slate-500">Not checked yet.</p>}
              {history && history.length > 1 && (
                <div><div className="label">History</div><div className="flex items-end gap-1">{history.slice(0, 20).reverse().map((h) => (
                  <div key={h.id} title={`${h.score} · ${dateTime(h.checked_at)}`} className="w-3 rounded-t" style={{ height: 4 + h.score * 0.4, background: BAND_COLOR[h.band] }} />
                ))}</div></div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
