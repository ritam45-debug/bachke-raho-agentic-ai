import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi } from '../../lib/useApi'
import { money, num, titleCase } from '../../lib/format'
import { Badge, Empty, ErrorBox, Kpi, Loading, PageHeader, SeverityPill } from '../../components/ui'

interface Overview {
  data_mode: string; currency: string
  kpis: Record<string, number>
  charts: {
    inventory_status: { status: string; count: number }[]
    inventory_value_by_location: { location: string; value: number }[]
    shipment_status: { status: string; count: number }[]
    supplier_performance: { supplier: string; country: string; on_time_pct: number; quality: number | null }[]
  }
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

export default function OverviewPage() {
  const { data, error, loading } = useApi<Overview>('/dashboard/overview')
  if (loading) return <Loading />
  if (error) return <ErrorBox message={error} />
  if (!data) return null
  const k = data.kpis
  const cur = data.currency
  const empty = k.sku_locations === 0 && k.suppliers === 0

  return (
    <>
      <PageHeader title="Executive Overview"
        subtitle="Where the supply chain stands right now. Figures are deterministic calculations on this workspace's records — no AI estimates on this page." />
      {empty && <div className="mb-5"><Empty>No operational data yet. CSV / Excel upload and integrations arrive in Phase 3 — the formats are in <code>sample_data/aureon/</code>. Meanwhile, set up your profile, locations and team in <Link className="text-signal underline" to="/app/settings">Company Settings</Link>.</Empty></div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Inventory value" value={money(k.inventory_value, cur)} hint={`${num(k.sku_locations)} SKU-locations`} />
        <Kpi label="At-risk stock" value={num(k.at_risk_stock_positions)} hint={`+${num(k.reorder_needed)} at reorder point`} tone={k.at_risk_stock_positions ? 'risk' : 'ok'} />
        <Kpi label="Open shipments" value={num(k.open_shipments)} hint="planned, in transit or delayed" />
        <Kpi label="Delayed shipments" value={num(k.delayed_shipments)} hint={`${money(k.delayed_shipment_value, cur)} in goods`} tone={k.delayed_shipments ? 'warn' : 'ok'} />
        <Kpi label="Active disruptions" value={num(k.active_disruptions)} hint={k.active_disruptions ? `max severity ${k.max_active_severity}/100` : 'none'} tone={k.max_active_severity >= 75 ? 'risk' : k.active_disruptions ? 'warn' : 'ok'} />
        <Kpi label="Flagged suppliers" value={`${num(k.flagged_suppliers)} / ${num(k.suppliers)}`} hint={data.rules.flagged_supplier} tone={k.flagged_suppliers ? 'warn' : 'ok'} />
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
          <p className="mt-2 text-[11px] text-slate-500">{data.rules.severity_note}</p>
        </div>
      )}

      {!empty && (
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
          <ChartCard title="Inventory value by location">
            <ResponsiveContainer><BarChart layout="vertical" data={data.charts.inventory_value_by_location} margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" horizontal={false} /><XAxis type="number" fontSize={11} tickFormatter={(v) => money(v, cur)} tickLine={false} />
              <YAxis type="category" dataKey="location" fontSize={11} width={150} tickLine={false} /><Tooltip {...tip} formatter={(v) => money(Number(v), cur)} cursor={{ fill: '#94a3b822' }} />
              <Bar dataKey="value" fill="#f5a524" radius={[0, 4, 4, 0]} />
            </BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Supplier on-time delivery (historical)" note="red < 85%">
            <ResponsiveContainer><BarChart layout="vertical" data={data.charts.supplier_performance.map((s) => ({ ...s, name: s.supplier.replace(' (fictional)', '') }))} margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" horizontal={false} /><XAxis type="number" domain={[60, 100]} fontSize={11} unit="%" tickLine={false} />
              <YAxis type="category" dataKey="name" fontSize={10} width={170} tickLine={false} interval={0} /><Tooltip {...tip} formatter={(v) => `${v}%`} cursor={{ fill: '#94a3b822' }} />
              <Bar dataKey="on_time_pct" radius={[0, 4, 4, 0]}>{data.charts.supplier_performance.map((s) => <Cell key={s.supplier} fill={s.on_time_pct < 85 ? '#f87171' : '#2dd4bf'} />)}</Bar>
            </BarChart></ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </>
  )
}
