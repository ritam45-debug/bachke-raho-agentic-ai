import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useApi } from '../../lib/useApi'
import { date, money, num, titleCase, useCsvDownload } from '../../lib/format'
import { Badge, ErrorBox, Loading, PageHeader, PhasePanel, SeverityPill, Table, type Col } from '../../components/ui'

type Row = Record<string, unknown>

function useFiltered(rows: Row[] | null, keys: string[], filterKey?: string) {
  const [q, setQ] = useState('')
  const [f, setF] = useState('')
  const options = useMemo(() => filterKey && rows ? [...new Set(rows.map((r) => String(r[filterKey])))] : [], [rows, filterKey])
  const out = useMemo(() => (rows ?? []).filter((r) =>
    (!f || String(r[filterKey!]) === f) &&
    (!q || keys.some((k) => String(r[k] ?? '').toLowerCase().includes(q.toLowerCase())))), [rows, q, f, keys, filterKey])
  return { q, setQ, f, setF, options, out }
}

function Toolbar({ q, setQ, f, setF, options, label, onExport, count }: {
  q: string; setQ: (v: string) => void; f: string; setF: (v: string) => void; options: string[]; label?: string; onExport: () => void; count: number
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input className="input !w-64" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      {options.length > 0 && (
        <select className="input !w-48" value={f} onChange={(e) => setF(e.target.value)} aria-label={label}>
          <option value="">All {label}</option>{options.map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}
        </select>
      )}
      <span className="text-xs text-slate-500">{count} rows</span>
      <button className="btn-ghost ml-auto" onClick={onExport} disabled={!count}><Download size={15} /> Export CSV</button>
    </div>
  )
}

function DataPage({ path, title, subtitle, cols, search, filterKey, filterLabel, file, after }: {
  path: string; title: string; subtitle: string; cols: Col<Row>[]; search: string[]; filterKey?: string; filterLabel?: string; file: string; after?: React.ReactNode
}) {
  const { data, error, loading } = useApi<Row[]>(path)
  const t = useFiltered(data, search, filterKey)
  const dl = useCsvDownload()
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
        <>
          <Toolbar {...t} label={filterLabel} count={t.out.length} onExport={() => dl(file, t.out)} />
          <Table rows={t.out} cols={cols} empty="No records yet. Use Data Import (left menu) to upload a CSV." />
        </>
      )}
      {after && <div className="mt-6">{after}</div>}
    </>
  )
}

export function InventoryPage() {
  return <DataPage path="/inventory" title="Inventory Intelligence" file="inventory.csv" filterKey="status" filterLabel="statuses"
    search={['sku', 'product', 'location']}
    subtitle="Days of cover = on hand ÷ average daily demand. Critical = at/below safety stock or cover shorter than supplier lead time. Bands are rules, not probabilities."
    cols={[
      { key: 'sku', label: 'SKU', render: (r) => <span className="num text-xs">{String(r.sku)}</span> },
      { key: 'product', label: 'Product' }, { key: 'location', label: 'Location' },
      { key: 'quantity_on_hand', label: 'On hand', align: 'right', render: (r) => num(r.quantity_on_hand as number) },
      { key: 'reorder_point', label: 'ROP', align: 'right', render: (r) => num(r.reorder_point as number) },
      { key: 'safety_stock', label: 'Safety', align: 'right', render: (r) => num(r.safety_stock as number) },
      { key: 'days_of_cover', label: 'Cover (d)', align: 'right', render: (r) => num(r.days_of_cover as number, 1) },
      { key: 'lead_time_days', label: 'Lead (d)', align: 'right', render: (r) => num(r.lead_time_days as number) },
      { key: 'stock_value', label: 'Value', align: 'right', render: (r) => money(r.stock_value as number) },
      { key: 'status', label: 'Status', render: (r) => <Badge value={String(r.status)} /> },
    ]} />
}

export function ShipmentsPage() {
  return <DataPage path="/shipments" title="Shipment Tracking" file="shipments.csv" filterKey="status" filterLabel="statuses"
    search={['reference', 'supplier', 'product', 'origin', 'destination', 'carrier']}
    subtitle="Shipment records as held in this workspace. Live carrier tracking needs a connected tracking API (Phase 3); no positions are invented."
    cols={[
      { key: 'reference', label: 'Ref', render: (r) => <span className="num text-xs">{String(r.reference)}</span> },
      { key: 'direction', label: 'Dir', render: (r) => titleCase(String(r.direction)) },
      { key: 'product', label: 'Product' },
      { key: 'origin', label: 'Route', render: (r) => <span>{String(r.origin)} <span className="text-slate-400">→</span> {String(r.destination)}</span> },
      { key: 'mode', label: 'Mode', render: (r) => titleCase(String(r.mode)) },
      { key: 'current_eta', label: 'ETA', render: (r) => date(r.current_eta as string) },
      { key: 'delay_days', label: 'Slip (d)', align: 'right', render: (r) => (r.delay_days as number) > 0 ? <span className="text-red-500">+{num(r.delay_days as number, 1)}</span> : '0' },
      { key: 'value', label: 'Value', align: 'right', render: (r) => money(r.value as number) },
      { key: 'status', label: 'Status', render: (r) => <Badge value={String(r.status)} /> },
    ]} />
}

export function VendorsPage() {
  return <DataPage path="/suppliers" title="Vendor Performance" file="suppliers.csv" filterKey="category" filterLabel="categories"
    search={['code', 'name', 'country', 'category']}
    subtitle="Historical performance as recorded. The configurable weighted vendor-scoring engine (cost 25 / quality 20 / reliability 20 / lead time 15 / financial 10 / risk 10) arrives in Phase 4."
    cols={[
      { key: 'code', label: 'Code', render: (r) => <span className="num text-xs">{String(r.code)}</span> },
      { key: 'name', label: 'Supplier' }, { key: 'category', label: 'Category' },
      { key: 'country', label: 'Country' },
      { key: 'on_time_delivery_rate', label: 'On-time', align: 'right', render: (r) => { const v = (r.on_time_delivery_rate as number) * 100; return <span className={v < 85 ? 'text-red-500' : ''}>{num(v, 0)}%</span> } },
      { key: 'quality_score', label: 'Quality', align: 'right', render: (r) => num(r.quality_score as number) },
      { key: 'avg_lead_time_days', label: 'Lead (d)', align: 'right', render: (r) => num(r.avg_lead_time_days as number) },
      { key: 'annual_spend', label: 'Annual spend', align: 'right', render: (r) => money(r.annual_spend as number) },
      { key: 'data_source', label: 'Source', render: (r) => <Badge value={String(r.data_source)} /> },
    ]} />
}

export function DisruptionsPage() {
  return <DataPage path="/disruptions" title="Global Disruptions" file="disruptions.csv" filterKey="status" filterLabel="statuses"
    search={['title', 'category', 'summary']}
    subtitle="Disruptions relevant to this company. Every record shows whether it is verified, unverified or simulated. Live news, weather and port feeds plus the world map arrive in Phase 3."
    cols={[
      { key: 'severity', label: 'Severity', render: (r) => <SeverityPill score={r.severity as number} /> },
      { key: 'title', label: 'Event', render: (r) => <div><div className="font-medium">{String(r.title)}</div><div className="mt-0.5 max-w-xl text-xs text-slate-500">{String(r.summary ?? '')}</div></div> },
      { key: 'category', label: 'Type', render: (r) => titleCase(String(r.category)) },
      { key: 'affected_countries', label: 'Countries', render: (r) => (r.affected_countries as string[]).join(', ') },
      { key: 'affected_suppliers', label: 'Suppliers', render: (r) => <span className="text-xs">{(r.affected_suppliers as string[]).join(', ') || '—'}</span> },
      { key: 'detected_at', label: 'Detected', render: (r) => date(r.detected_at as string) },
      { key: 'status', label: 'Status', render: (r) => <Badge value={String(r.status)} /> },
      { key: 'verification', label: 'Verification', render: (r) => <Badge value={String(r.verification)} /> },
    ]} />
}

export function ProductsPage() {
  return <DataPage path="/products" title="Product Lifecycle" file="products.csv" filterKey="kind" filterLabel="types"
    search={['sku', 'name', 'category', 'primary_supplier']}
    subtitle="Product and material catalogue. Stage-by-stage traceability (procurement → production → delivery → returns) arrives in Phase 4."
    cols={[
      { key: 'sku', label: 'SKU', render: (r) => <span className="num text-xs">{String(r.sku)}</span> },
      { key: 'name', label: 'Name' }, { key: 'kind', label: 'Type', render: (r) => titleCase(String(r.kind)) },
      { key: 'category', label: 'Category' },
      { key: 'unit_cost', label: 'Unit cost', align: 'right', render: (r) => money(r.unit_cost as number) },
      { key: 'unit_price', label: 'Price', align: 'right', render: (r) => r.unit_price ? money(r.unit_price as number) : '—' },
      { key: 'margin', label: 'Gross margin', align: 'right', render: (r) => r.unit_price ? `${num((1 - (r.unit_cost as number) / (r.unit_price as number)) * 100, 1)}%` : '—' },
      { key: 'primary_supplier', label: 'Primary supplier', render: (r) => String(r.primary_supplier ?? '—') },
    ]}
    after={<PhasePanel phase={4} title="Lifecycle traceability" items={['Link raw materials → batches → finished goods → shipments', 'Product-level cost build-up and profitability', 'Manufacturing bottleneck and defect analysis', 'Returns and feedback traced back to batches']} />} />
}
