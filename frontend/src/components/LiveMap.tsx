import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatLon } from '../lib/geo'
import type { NaturalEvent, Quake } from '../lib/liveData'

export interface MapLocation { id: string; name: string; kind: string; latitude: number; longitude: number }
export interface MapRoute { id: string; name: string; mode: string; path: LatLon[]; band?: string | null; score?: number | null }
export interface Layers { locations: boolean; routes: boolean; quakes: boolean; events: boolean }

const KIND_COLOR: Record<string, string> = { headquarters: '#a78bfa', manufacturing: '#f5a524', warehouse: '#60a5fa', distribution: '#2dd4bf' }
export const BAND_COLOR: Record<string, string> = { high: '#dc2626', elevated: '#f97316', moderate: '#eab308', low: '#22c55e' }
const EVENT_COLOR: Record<string, string> = { severeStorms: '#38bdf8', wildfires: '#ef4444', volcanoes: '#b91c1c', floods: '#3b82f6' }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export default function LiveMap({ locations, routes, quakes, events, layers, selectedRouteId, onSelectRoute, onPick, height = 520 }: {
  locations: MapLocation[]; routes: MapRoute[]; quakes: Quake[]; events: NaturalEvent[]; layers: Layers
  selectedRouteId?: string | null; onSelectRoute?: (id: string) => void; onPick?: (p: LatLon) => void; height?: number
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const groups = useRef<Record<string, L.LayerGroup>>({})
  const fitted = useRef(false)
  const pickRef = useRef(onPick)
  pickRef.current = onPick

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { worldCopyJump: true, minZoom: 2 }).setView([20, 78], 3)
    // OSM tile policy: visible attribution, browser Referer, normal interactive viewing only.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)
    for (const k of ['events', 'quakes', 'routes', 'locations']) groups.current[k] = L.layerGroup().addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => pickRef.current?.([e.latlng.lat, e.latlng.lng]))
    map.current = m
    return () => { m.remove(); map.current = null }
  }, [])

  useEffect(() => {
    const m = map.current, g = groups.current
    if (!m) return
    Object.values(g).forEach((x) => x.clearLayers())
    const bounds: L.LatLngExpression[] = []

    if (layers.events) for (const e of events) {
      L.circleMarker([e.lat, e.lon], { radius: 6, color: EVENT_COLOR[e.category] ?? '#94a3b8', weight: 2, fillOpacity: 0.35 })
        .bindPopup(`<b>${esc(e.title)}</b><br>${esc(e.categoryTitle)} · ${new Date(e.date).toLocaleDateString()}${e.magnitude ? ` · ${esc(e.magnitude)}` : ''}<br><small>NASA EONET (open event)</small>`)
        .addTo(g.events)
    }
    if (layers.quakes) for (const q of quakes) {
      L.circleMarker([q.lat, q.lon], { radius: Math.max(3, (q.mag - 3) * 3), color: '#ea580c', weight: 1, fillOpacity: 0.45 })
        .bindPopup(`<b>M${q.mag.toFixed(1)}</b> ${esc(q.place)}<br>${new Date(q.time).toLocaleString()}<br><small>USGS</small>`)
        .addTo(g.quakes)
    }
    if (layers.routes) for (const r of routes) {
      const sel = r.id === selectedRouteId
      const color = r.band ? BAND_COLOR[r.band] : '#94a3b8'
      const line = L.polyline(r.path, { color, weight: sel ? 6 : 3.5, opacity: sel ? 1 : 0.8, dashArray: r.mode === 'air' ? '6 8' : r.band ? undefined : '2 6' })
        .bindTooltip(`${esc(r.name)} · ${r.mode}${r.score != null ? ` · risk ${r.score}/100` : ' · not checked'}`, { sticky: true })
        .on('click', () => onSelectRoute?.(r.id))
        .addTo(g.routes)
      if (sel) line.bringToFront()
      r.path.forEach((p) => bounds.push(p))
    }
    if (layers.locations) for (const l of locations) {
      L.circleMarker([l.latitude, l.longitude], { radius: 7, color: '#0b1b33', weight: 2, fillColor: KIND_COLOR[l.kind] ?? '#94a3b8', fillOpacity: 1 })
        .bindTooltip(`${esc(l.name)} · ${l.kind}`)
        .addTo(g.locations)
      bounds.push([l.latitude, l.longitude])
    }
    if (!fitted.current && bounds.length) { m.fitBounds(L.latLngBounds(bounds).pad(0.2), { maxZoom: 6 }); fitted.current = true }
  }, [locations, routes, quakes, events, layers, selectedRouteId, onSelectRoute])

  useEffect(() => {
    const r = routes.find((x) => x.id === selectedRouteId)
    if (r && map.current && r.path.length) map.current.fitBounds(L.latLngBounds(r.path).pad(0.25), { maxZoom: 7 })
  }, [selectedRouteId]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} style={{ height }} className={`z-0 w-full overflow-hidden rounded-xl border border-slate-200 dark:border-ink-700 ${onPick ? 'cursor-crosshair' : ''}`} />
}

export function MapLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
      {Object.entries(KIND_COLOR).map(([k, c]) => <span key={k} className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />{k}</span>)}
      <span className="mx-1 text-slate-300">|</span>
      {Object.entries(BAND_COLOR).map(([k, c]) => <span key={k} className="flex items-center gap-1"><i className="inline-block h-1 w-4 rounded" style={{ background: c }} />{k} risk</span>)}
      <span className="flex items-center gap-1"><i className="inline-block h-1 w-4 rounded bg-slate-400" />not checked</span>
      <span className="mx-1 text-slate-300">|</span>
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full border-2 border-orange-600" />earthquake</span>
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full border-2 border-sky-400" />storm / natural event</span>
    </div>
  )
}
