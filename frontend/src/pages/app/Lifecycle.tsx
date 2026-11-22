import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/useApi'
import { costBuildUp, supplierExposure, type BomRec, type ProductRec, type SupplierRec } from '../../lib/bom'
import { date, money, num } from '../../lib/format'
import { Badge, Empty, ErrorBox, Kpi, Loading, PageHeader } from '../../components/ui'
import { ProductsPage as ProductTable } from './DataPages'

interface Ship { id: string; reference: string; product: string | null; status: string; current_eta: string | null; delay_days: number | null; direction: string; supplier: string | null }

const STAGES = ['Raw material procurement', 'Supplier selection', 'Purchase orders', 'Manufacturing', 'Quality inspection', 'Packaging', 'Warehousing', 'Distribution', 'Transportation', 'Final delivery', 'Customer feedback & returns']

export default function LifecyclePage() {
  const { can } = useAuth()
  const prods = useApi<ProductRec[]>('/products')
  const bomApi = useApi<BomRec[]>('/bom')
  const sups = useApi<SupplierRec[]>('/suppliers')
  const ships = useApi<Ship[]>('/shipments')
  const inv = useApi<{ product: string; quantity_on_hand: number; location: string; status: string }[]>('/inventory')
  const [tab, setTab] = useState<'trace' | 'catalogue'>('trace')
  const [fgId, setFgId] = useState('')
  const [add, setAdd] = useState({ component_sku: '', qty: 1 })
  const [err, setErr] = useState<string | null>(null)
  const canEdit = can('ops:write') || can('procurement:write')

  const products = useMemo(() => prods.data ?? [], [prods.data])
  const fgs = products.filter((p) => p.kind === 'finished_good')
  useEffect(() => { if (!fgId && fgs.length) setFgId(fgs[0].id) }, [fgs, fgId])
  const fg = products.find((p) => p.id === fgId)
  const build = useMemo(() => (fg ? costBuildUp(fg, bomApi.data ?? [], products) : null), [fg, bomApi.data, products])
  const exposure = useMemo(() => (build ? supplierExposure(build.lines, sups.data ?? []) : []), [build, sups.data])
  const componentNames = new Set(build?.lines.map((l) => l.name) ?? [])
  const inbound = (ships.data ?? []).filter((s) => s.direction === 'inbound' && s.product && componentNames.has(s.product) && s.status !== 'delivered' && s.status !== 'cancelled')
  const outbound = (ships.data ?? []).filter((s) => s.direction === 'outbound' && fg && s.product === fg.name)
  const stock = (inv.data ?? []).filter((i) => i.product === fg?.name || componentNames.has(i.product))

  const addLine = async () => {
    if (!fg) return
    setErr(null)
    try { await api('/bom/bulk', { method: 'POST', json: { rows: [{ parent_sku: fg.sku, component_sku: add.component_sku, quantity_per_unit: add.qty }] } }); setAdd({ component_sku: '', qty: 1 }); void bomApi.reload() }
    catch (e) { setErr((e as Error).message) }
  }

  if (prods.loading || bomApi.loading) return <Loading />
  if (prods.error) return <ErrorBox message={prods.error} />

  return (
    <>
      <PageHeader title="Product Lifecycle" subtitle="Trace each finished product to its components, suppliers, stock and shipments, and rebuild its cost from the bill of materials." />
      <div className="mb-4 flex w-fit gap-1 rounded-lg bg-slate-100 p-0.5 text-sm dark:bg-ink-800">
        {(['trace', 'catalogue'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-md px-4 py-1.5 ${tab === t ? 'bg-white font-semibold shadow dark:bg-ink-700' : ''}`}>{t === 'trace' ? 'Traceability & cost' : 'Product catalogue'}</button>)}
      </div>
      {tab === 'catalogue' ? <ProductTable /> : !fgs.length ? <Empty>No finished goods yet. <Link className="text-signal underline" to="/app/import">Import products</Link> (kind = finished_good, with price and conversion cost) and their components.</Empty> : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select className="input !w-auto" value={fgId} onChange={(e) => setFgId(e.target.value)}>{fgs.map((p) => <option key={p.id} value={p.id}>{p.sku} – {p.name}</option>)}</select>
            <div className="flex flex-wrap gap-1 text-[10px] text-slate-500">{STAGES.map((s, i) => <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-ink-800">{i + 1}. {s}</span>)}</div>
          </div>
          {build && fg && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Kpi label="Material cost" value={money(build.material)} hint={`${build.lines.length} components`} />
                <Kpi label="Conversion cost" value={money(build.conversion)} hint="labour + overhead per unit" />
                <Kpi label="Built-up unit cost" value={money(build.builtCost)} hint={`recorded ${money(build.recordedCost)} (${build.variance >= 0 ? '+' : ''}${money(build.variance)})`} tone={Math.abs(build.variance) > 0.05 * (build.recordedCost || 1) ? 'warn' : 'ok'} />
                <Kpi label="Unit margin" value={build.margin == null ? '—' : money(build.margin)} hint={build.marginPct == null ? 'no price recorded' : `${num(build.marginPct, 1)}% of price`} tone={build.margin != null && build.margin < 0 ? 'risk' : undefined} />
                <Kpi label="Material share" value={build.materialSharePct == null ? '—' : `${num(build.materialSharePct, 0)}%`} hint="of built-up cost" />
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div className="card p-4">
                  <h3 className="text-sm font-semibold">Bill of materials</h3>
                  {!build.lines.length ? <p className="mt-2 text-sm text-slate-500">No components linked yet.</p> : (
                    <table className="mt-2 w-full text-sm"><thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1">Component</th><th>Qty / unit</th><th>Unit cost</th><th>Cost</th><th /></tr></thead>
                      <tbody>{build.lines.map((l) => (
                        <tr key={l.id} className="border-t border-slate-100 dark:border-ink-800"><td className="py-1.5">{l.sku} <span className="text-xs text-slate-500">{l.name}</span></td>
                          <td className="num">{num(l.qty, 2)}</td><td className="num">{money(l.unitCost)}</td><td className="num">{money(l.cost)}</td>
                          <td>{canEdit && <button aria-label="Remove component" className="p-1 text-slate-400 hover:text-red-500" onClick={async () => { await api(`/bom/${l.id}`, { method: 'DELETE' }); void bomApi.reload() }}><Trash2 size={13} /></button>}</td></tr>))}</tbody></table>
                  )}
                  {canEdit && (
                    <div className="mt-3 flex gap-2">
                      <select className="input" value={add.component_sku} onChange={(e) => setAdd({ ...add, component_sku: e.target.value })}>
                        <option value="">Add component…</option>{products.filter((p) => p.kind !== 'finished_good').map((p) => <option key={p.id} value={p.sku}>{p.sku} – {p.name}</option>)}</select>
                      <input type="number" min={0.001} step="any" className="input !w-24" value={add.qty} onChange={(e) => setAdd({ ...add, qty: Number(e.target.value) })} />
                      <button className="btn-primary" disabled={!add.component_sku || !(add.qty > 0)} onClick={addLine}><Plus size={14} /></button>
                    </div>)}
                  {err && <div className="mt-2"><ErrorBox message={err} /></div>}
                </div>
                <div className="card p-4">
                  <h3 className="text-sm font-semibold">Supplier dependence (share of material cost)</h3>
                  {!exposure.length ? <p className="mt-2 text-sm text-slate-500">Link components to see which suppliers this product depends on.</p> : exposure.map((e) => (
                    <div key={e.supplier?.id ?? 'none'} className="mt-2">
                      <div className="flex justify-between text-sm"><span>{e.supplier ? `${e.supplier.name} (${e.supplier.country})` : 'No primary supplier set'}</span><span className="num">{num(e.sharePct, 0)}%</span></div>
                      <div className="mt-1 h-2 rounded bg-slate-100 dark:bg-ink-800"><div className={`h-2 rounded ${e.sharePct > 50 ? 'bg-red-400' : 'bg-calm'}`} style={{ width: `${e.sharePct}%` }} /></div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{e.skus.join(', ')}{e.supplier?.on_time_delivery_rate != null && ` · on time ${num(e.supplier.on_time_delivery_rate * 100, 0)}%`}{e.supplier?.risk_exposure_score != null && ` · risk ${e.supplier.risk_exposure_score}/100`}</div>
                    </div>))}
                  {exposure.some((e) => e.sharePct > 50) && <p className="mt-3 text-xs font-medium text-red-500">Concentration: one supplier provides over half of this product's material cost.</p>}
                </div>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <div className="card p-4"><h3 className="text-sm font-semibold">Stock (product and components)</h3>
                  {!stock.length ? <p className="mt-2 text-sm text-slate-500">No inventory records.</p> : stock.map((s, i) => <div key={i} className="mt-1.5 flex items-center justify-between gap-2 text-sm"><span className="truncate">{s.product} <span className="text-xs text-slate-500">@ {s.location}</span></span><span className="flex items-center gap-2"><span className="num">{num(s.quantity_on_hand)}</span><Badge value={s.status} /></span></div>)}</div>
                <div className="card p-4"><h3 className="text-sm font-semibold">Open inbound component shipments</h3>
                  {!inbound.length ? <p className="mt-2 text-sm text-slate-500">None open.</p> : inbound.map((s) => <div key={s.id} className="mt-1.5 flex items-center justify-between gap-2 text-sm"><span className="truncate">{s.reference} · {s.product}</span><span className="flex items-center gap-2 text-xs">{date(s.current_eta)}<Badge value={s.status} /></span></div>)}</div>
                <div className="card p-4"><h3 className="text-sm font-semibold">Outbound deliveries of this product</h3>
                  {!outbound.length ? <p className="mt-2 text-sm text-slate-500">None recorded.</p> : outbound.map((s) => <div key={s.id} className="mt-1.5 flex items-center justify-between gap-2 text-sm"><span>{s.reference}</span><span className="flex items-center gap-2 text-xs">{date(s.current_eta)}<Badge value={s.status} /></span></div>)}</div>
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}
