import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Save } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/useApi'
import { allocate, CRITERIA, scoreSuppliers, weightsTotal, type Weights } from '../../lib/vendorScoring'
import { money, num } from '../../lib/format'
import { Empty, ErrorBox, Loading, PageHeader } from '../../components/ui'
import { VendorsPage as VendorTable } from './DataPages'

interface Sup { id: string; code: string; name: string; category: string; country: string; on_time_delivery_rate: number | null; quality_score: number | null; avg_lead_time_days: number | null
  financial_stability_score: number | null; risk_exposure_score: number | null; capacity_units_per_month: number | null; moq_units: number | null; annual_spend: number | null }

export default function VendorsPage() {
  const { can } = useAuth()
  const sups = useApi<Sup[]>('/suppliers')
  const wApi = useApi<{ weights: Weights; is_default: boolean; defaults: Weights }>('/vendor-scoring/weights')
  const [tab, setTab] = useState<'score' | 'table'>('score')
  const [w, setW] = useState<Weights | null>(null)
  const [category, setCategory] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [quotes, setQuotes] = useState<Record<string, string>>({})
  const [demand, setDemand] = useState(1000)
  const [strategy, setStrategy] = useState<'single' | 'dual'>('dual')
  const [primary, setPrimary] = useState(70)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { if (wApi.data) setW(wApi.data.weights) }, [wApi.data])

  const all = useMemo(() => sups.data ?? [], [sups.data])
  const cats = useMemo(() => [...new Set(all.map((s) => s.category))].sort(), [all])
  useEffect(() => { if (!category && cats.length) setCategory(cats[0]) }, [cats, category])
  useEffect(() => { setPicked(all.filter((s) => s.category === category).map((s) => s.id)) }, [category, all])

  const total = w ? weightsTotal(w) : 0
  const canEdit = can('company:update') || can('procurement:write')
  const ranked = useMemo(() => {
    if (!w || Math.abs(total - 100) > 0.001) return null
    const list = all.filter((s) => picked.includes(s.id)).map((s) => ({ ...s, quote: quotes[s.id] ? Number(quotes[s.id]) : null }))
    return list.length ? scoreSuppliers(list, w) : null
  }, [all, picked, quotes, w, total])
  const alloc = useMemo(() => (ranked && demand > 0 ? allocate(ranked, demand, strategy, primary) : null), [ranked, demand, strategy, primary])

  const saveWeights = async () => {
    setMsg(null)
    try { await api('/vendor-scoring/weights', { method: 'PUT', json: w }); setMsg({ ok: true, text: 'Weights saved for the company.' }); void wApi.reload() }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }
  const saveSnapshot = async () => {
    if (!ranked) return
    try {
      await api('/finance/scenarios', { method: 'POST', json: { name: `Vendor scoring – ${category} – ${new Date().toLocaleDateString('en-IN')}`, kind: 'vendor_scoring',
        inputs: { weights: w, category, quotes, demand, strategy, primary_share_pct: primary },
        results: { ranking: ranked.map((r) => ({ name: r.name, total: Math.round(r.total * 10) / 10, missing: r.missing })), allocation: alloc } } })
      setMsg({ ok: true, text: 'Snapshot saved under Financial Intelligence → saved scenarios.' })
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }

  if (sups.loading || wApi.loading) return <Loading />
  if (sups.error) return <ErrorBox message={sups.error} />

  return (
    <>
      <PageHeader title="Vendor Performance" subtitle="Weighted supplier scoring and demand allocation, computed with transparent formulas from your supplier records and quotes." />
      <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-0.5 text-sm dark:bg-ink-800 w-fit">
        {(['score', 'table'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-md px-4 py-1.5 ${tab === t ? 'bg-white font-semibold shadow dark:bg-ink-700' : ''}`}>{t === 'score' ? 'Scoring & allocation' : 'Supplier records'}</button>)}
      </div>
      {tab === 'table' ? <VendorTable /> : !all.length ? <Empty>No suppliers yet. <Link className="text-signal underline" to="/app/import">Import suppliers</Link> with quality, on-time rate, lead time, financial-stability and risk scores.</Empty> : (
        <div className="grid gap-4 xl:grid-cols-[330px_1fr]">
          <div className="space-y-4">
            <div className="card p-4">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Weights</h3><span className={`num text-xs font-semibold ${Math.abs(total - 100) > 0.001 ? 'text-red-500' : 'text-emerald-600'}`}>{num(total, 1)}% / 100%</span></div>
              {w && CRITERIA.map((c) => (
                <div key={c.key} className="mt-2">
                  <div className="flex justify-between text-xs"><span title={c.basis}>{c.label}</span><span className="num">{w[c.key]}%</span></div>
                  <input type="range" min={0} max={100} step={1} value={w[c.key]} disabled={!canEdit} className="w-full accent-[#f5a524]" onChange={(e) => setW({ ...w, [c.key]: Number(e.target.value) })} />
                </div>
              ))}
              {Math.abs(total - 100) > 0.001 && <p className="mt-2 text-xs text-red-500">Weights must total exactly 100% before scoring.</p>}
              <div className="mt-3 flex gap-2">
                {canEdit && <button className="btn-primary !py-1.5 text-xs" disabled={Math.abs(total - 100) > 0.001} onClick={saveWeights}><Save size={13} />Save weights</button>}
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => wApi.data && setW(wApi.data.defaults)}>Reset to default</button>
              </div>
              {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{msg.text}</p>}
            </div>
            <div className="card space-y-3 p-4 text-sm">
              <div><label className="label">Category to compare</label><select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="space-y-1.5">{all.filter((s) => s.category === category).map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
                  <span className="min-w-0 flex-1 truncate text-xs">{s.name}</span>
                  <input className="input !w-28 !py-1 text-xs" type="number" placeholder="Quote ₹/unit" value={quotes[s.id] ?? ''} onChange={(e) => setQuotes({ ...quotes, [s.id]: e.target.value })} />
                </div>))}</div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">Monthly demand (units)</label><input type="number" className="input" value={demand} onChange={(e) => setDemand(Number(e.target.value))} /></div>
                <div><label className="label">Strategy</label><select className="input" value={strategy} onChange={(e) => setStrategy(e.target.value as 'single' | 'dual')}><option value="dual">Dual sourcing</option><option value="single">Single source</option></select></div>
              </div>
              {strategy === 'dual' && <div><label className="label">Primary supplier share: {primary}%</label><input type="range" min={50} max={95} value={primary} className="w-full accent-[#f5a524]" onChange={(e) => setPrimary(Number(e.target.value))} /></div>}
            </div>
          </div>

          <div className="space-y-4">
            {!ranked ? <Empty>Pick at least one supplier, and make sure weights total 100%.</Empty> : (
              <>
                <div className="card overflow-x-auto p-4">
                  <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Ranking – {category}</h3>
                    {(can('finance:write') || can('procurement:write')) && <button className="btn-ghost !py-1 text-xs" onClick={saveSnapshot}><Save size={13} />Save snapshot</button>}</div>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">Supplier</th>{CRITERIA.map((c) => <th key={c.key} className="px-2 py-1.5" title={c.basis}>{c.label.split(' ')[0]} <span className="text-[10px]">({w![c.key]}%)</span></th>)}<th className="px-2 py-1.5">Score</th></tr></thead>
                    <tbody>{ranked.map((r) => (
                      <tr key={r.id} className={`border-t border-slate-100 dark:border-ink-800 ${r.rank === 1 ? 'bg-emerald-50 dark:bg-emerald-500/10' : ''}`}>
                        <td className="px-2 py-1.5 font-semibold">{r.rank}</td>
                        <td className="px-2 py-1.5"><div className="font-medium">{r.name}</div>{r.missing.length > 0 && <div className="text-[11px] text-amber-600">missing: {r.missing.join(', ')} (scored 0)</div>}</td>
                        {CRITERIA.map((c) => <td key={c.key} className={`num px-2 py-1.5 ${r.sub[c.key] == null ? 'text-amber-500' : ''}`}>{r.sub[c.key] == null ? '—' : num(r.sub[c.key]!, 0)}</td>)}
                        <td className="num px-2 py-1.5 font-semibold">{num(r.total, 1)}</td>
                      </tr>))}</tbody>
                  </table>
                  <p className="mt-2 text-[11px] text-slate-500">Score = Σ weight × sub-score. Price and lead time are scaled between the suppliers compared (best = 100, worst = 0); quality, on-time rate, financial stability and 100 − risk exposure use their own 0–100 scales. Hover a header for its basis.</p>
                </div>
                {alloc && (
                  <div className="card p-4">
                    <h3 className="text-sm font-semibold">Recommended allocation of {num(demand)} units/month</h3>
                    <div className="mt-3 space-y-2">{alloc.allocations.map((a) => (
                      <div key={a.id}><div className="flex justify-between text-sm"><span>{a.name}</span><span className="num">{num(a.units)} units · {num(a.sharePct, 1)}%{quotes[a.id] ? ` · ${money(a.units * Number(quotes[a.id]))}` : ''}</span></div>
                        <div className="mt-1 h-2 rounded bg-slate-100 dark:bg-ink-800"><div className="h-2 rounded bg-calm" style={{ width: `${a.sharePct}%` }} /></div></div>))}</div>
                    {alloc.unmet > 0 && <p className="mt-2 text-sm font-medium text-red-500">{num(alloc.unmet)} units unplaced: not enough capacity among the suppliers compared.</p>}
                    {alloc.notes.length > 0 && <ul className="mt-3 list-disc pl-5 text-xs text-slate-500">{alloc.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
                    <p className="mt-2 text-[11px] text-slate-500">Rule-based allocation (capacity caps, MOQ, shortfall passed down the ranking), not a mathematical optimum. Missing capacity is treated as unlimited.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
