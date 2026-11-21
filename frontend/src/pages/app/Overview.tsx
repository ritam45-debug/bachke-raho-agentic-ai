import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CheckCircle2, Circle } from 'lucide-react'
import { useApi } from '../../lib/useApi'
import { useAuth } from '../../lib/auth'
import { dateTime, money, num, titleCase } from '../../lib/format'
import { BAND_COLOR } from '../../components/LiveMap'
import { Badge, ErrorBox, Kpi, Loading, PageHeader, SeverityPill } from '../../components/ui'

interface Overview {
  data_mode: string; currency: string
  kpis: Record<string, number> & { last_route_check_at?: string | null }
  charts: {
    inventory_status: { status: string; count: number }[]
    inventory_value_by_location: { location: string; value: number }[]
    shipment_status: { status: string; count: number }[]
    supplier_performance: { supplier: string; country: string; on_time_pct: number; quality: number | null }[]
  }
  route_risks: { id: string; name: string; mode: string; score: number; band: string; checked_at: string; top_factor: string | null }[]
  active_disruptions: { id: string; title: string; severity: number; verification: string; category: string; affected_countries: string[] }[]
  rules: Record<string, string>
}

const STATUS_COLOR: Record<string, string> = {
  stockout: '#dc2626', critical: '#f87171', reorder: '#f5a524', healthy: '#2dd4bf', excess: '#60a5fa',
  planned: '#94a3b8', in_transit: '#60a5fa', delayed: '#f87171', delivered: '#2dd4bf', cancelled: '#64748b',
}
const tip = { contentStyle: { background: '#0b1b33', border: '1px solid #1c375c', borderRadius: 8, color: '#e2e8f0', fontSize: 12 } }

function ChartCard({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">{title}</h3>{note && <span className="text-[11px] text-slate-500">{note}</span>}</div>
      <div className="h-60">{children}</div>
    </div>
  )
}

function GettingStarted({ k }: { k: Overview['kpis'] }) {
  const { can } = useAuth()
  const { data: users } = useApi<unknown[]>(can('users:read') ? '/users' : null)
  const steps = [
    { done: k.locations_mapped > 0, label: 'Put your plants, warehouses and DCs on the map', hint: 'Search by name, click the map, or import a CSV', to: '/app/map' },
    { done: k.routes > 0, label: 'Add the routes you want watched', hint: 'Supplier → plant, plant → DC, port → port', to: '/app/map' },
    { done: k.routes_checked > 0, label: 'Run your first live risk check', hint: '"Check all routes" scores every route in one go', to: '/app/map' },
    { done: k.locations_mapped > 0 && k.routes_checked > 0, label: 'Review the weather watch for your sites', hint: '7-day flags for every location and route end', to: '/app/weather' },
    ...(can('users:manage') ? [{ done: (users?.length ?? 0) > 1, label: 'Invite your team with the right roles', hint: 'Analysts can check risk; managers can edit routes', to: '/app/settings' }] : []),
  ]
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null
  return (
    <div className="card mb-5 p-5">
      <div className="flex items-center justify-between"><h2 className="font-display text-base font-bold">Get set up</h2><span className="text-xs text-slate-500">{done} of {steps.length} done</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-800"><div className="h-full bg-calm transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ol className="mt-4 grid gap-2 md:grid-cols-2">
        {steps.map((s) => (
          <li key={s.label}><Link to={s.to} className="flex gap-3 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-ink-800/50">
            {s.done ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-calm" /> : <Circle size={18} className="mt-0.5 shrink-0 text-slate-400" />}
            <span><span className={`block text-sm font-medium ${s.done ? 'text-slate-400 line-through' : ''}`}>{s.label}</span><span className="block text-xs text-slate-500">{s.hint}</span></span>
          </Link></li>
        ))}
      </ol>
    </div>
  )
}

export default function OverviewPage() {
  const { data, error, loading } = useApi<Overview>('/dashboard/overview')
  if (loading) return <Loading />
  if (error) return <ErrorBox message={error} />
  if (!data) return null
  const k = data.kpis
  const cur = data.currency
  const hasOps = k.sku_locations > 0 || k.suppliers > 0 || k.open_shipments > 0

  return (
    <>
      <PageHeader title="Executive Overview" subtitle="Where your supply chain stands right now. Route risk comes from live public weather and hazard data; everything else is calculated from your own records." />
      <GettingStarted k={k} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Routes watched" value={num(k.routes)} hint={`${num(k.routes_checked)} checked${k.last_route_check_at ? ` · last ${dateTime(k.last_route_check_at)}` : ''}`} />
        <Kpi label="Routes at risk" value={num(k.routes_elevated_or_high)} hint="elevated or high (score ≥ 50)" tone={k.routes_elevated_or_high ? 'risk' : k.routes_checked ? 'ok' : undefined} />
        <Kpi label="Highest route score" value={k.routes_checked ? `${k.max_route_score}/100` : '—'} hint="rule-based, not a probability" tone={k.max_route_score >= 75 ? 'risk' : k.max_route_score >= 50 ? 'warn' : k.routes_checked ? 'ok' : undefined} />
        <Kpi label="Sites on map" value={`${num(k.locations_mapped)} / ${num(k.locations)}`} hint="locations with coordinates" tone={k.locations && k.locations_mapped < k.locations ? 'warn' : undefined} />
        <Kpi label="Open shipments" value={num(k.open_shipments)} hint={`${num(k.delayed_shipments)} delayed`} tone={k.delayed_shipments ? 'warn' : undefined} />
        <Kpi label="Active disruptions" value={num(k.active_disruptions)} hint={k.active_disruptions ? `max severity ${k.max_active_severity}/100` : 'none logged'} tone={k.max_active_severity >= 75 ? 'risk' : k.active_disruptions ? 'warn' : undefined} />
      </div>

      <div className="card mt-5 p-4">
        <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Riskiest routes (latest live check)</h3><Link to="/app/map" className="text-xs text-signal hover:underline">Open map</Link></div>
        {data.route_risks.length ? (
          <div className="divide-y divide-slate-100 dark:divide-ink-800">
            {data.route_risks.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="inline-flex w-24 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold text-white" style={{ background: BAND_COLOR[r.band] }}><span className="num">{r.score}</span>{titleCase(r.band)}</span>
                <span className="min-w-0 basis-full font-medium sm:basis-auto sm:flex-1">{r.name} <span className="text-xs font-normal text-slate-500">· {r.mode}</span></span>
                <span className="text-xs text-slate-500">{r.top_factor ?? 'No hazards above thresholds'}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">No routes checked yet. Add routes on the <Link to="/app/map" className="text-signal underline">Route & Risk Map</Link> and press "Check all routes".</p>}
      </div>

      {data.active_disruptions.length > 0 && (
        <div className="card mt-5 p-4">
          <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Active disruptions</h3><Link to="/app/disruptions" className="text-xs text-signal hover:underline">View all</Link></div>
          <div className="divide-y divide-slate-100 dark:divide-ink-800">
            {data.active_disruptions.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <SeverityPill score={d.severity} />
                <span className="min-w-0 basis-full font-medium sm:basis-auto sm:flex-1">{d.title}</span>
                <span className="text-xs text-slate-500">{titleCase(d.category)} · {d.affected_countries.join(', ')}</span>
                <Badge value={d.verification} />
              </div>
            ))}
          </div>
        </div>
      )}

      {hasOps && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Inventory value" value={money(k.inventory_value, cur)} hint={`${num(k.sku_locations)} SKU-locations`} />
            <Kpi label="At-risk stock" value={num(k.at_risk_stock_positions)} hint={`+${num(k.reorder_needed)} at reorder point`} tone={k.at_risk_stock_positions ? 'risk' : 'ok'} />
            <Kpi label="Delayed goods value" value={money(k.delayed_shipment_value, cur)} tone={k.delayed_shipments ? 'warn' : 'ok'} />
            <Kpi label="Flagged suppliers" value={`${num(k.flagged_suppliers)} / ${num(k.suppliers)}`} hint={data.rules.flagged_supplier} tone={k.flagged_suppliers ? 'warn' : 'ok'} />
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <ChartCard title="Stock positions by status" note="rule-based bands">
              <ResponsiveContainer><BarChart data={data.charts.inventory_status.map((r) => ({ ...r, name: titleCase(r.status) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" vertical={false} /><XAxis dataKey="name" fontSize={11} tickLine={false} /><YAxis fontSize={11} allowDecimals={false} width={30} tickLine={false} /><Tooltip {...tip} cursor={{ fill: '#94a3b822' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>{data.charts.inventory_status.map((r) => <Cell key={r.status} fill={STATUS_COLOR[r.status]} />)}</Bar>
              </BarChart></ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Shipments by status">
              <ResponsiveContainer><BarChart data={data.charts.shipment_status.map((r) => ({ ...r, name: titleCase(r.status) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" vertical={false} /><XAxis dataKey="name" fontSize={11} tickLine={false} /><YAxis fontSize={11} allowDecimals={false} width={30} tickLine={false} /><Tooltip {...tip} cursor={{ fill: '#94a3b822' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>{data.charts.shipment_status.map((r) => <Cell key={r.status} fill={STATUS_COLOR[r.status]} />)}</Bar>
              </BarChart></ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      )}
    </>
  )
}
