import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { useApi } from '../../lib/useApi'
import { compareModes, performance, type ModeOption, type PerfRow, type ShipmentRec } from '../../lib/logistics'
import { money, num } from '../../lib/format'
import { Empty, ErrorBox, Kpi, Loading, PageHeader } from '../../components/ui'

function PerfTable({ title, rows }: { title: string; rows: PerfRow[] }) {
  return (
    <div className="card overflow-x-auto p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500">{['', 'Shipments', 'On time', 'Avg slip', 'Delayed now', 'Goods value', 'Freight', 'Freight / value'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.key} className="border-t border-slate-100 dark:border-ink-800">
            <td className="px-2 py-1.5 font-medium">{r.key}</td>
            <td className="num px-2 py-1.5">{r.shipments}</td>
            <td className={`num px-2 py-1.5 ${r.onTimePct != null && r.onTimePct < 85 ? 'text-red-500' : ''}`}>{r.onTimePct == null ? '—' : `${num(r.onTimePct, 0)}%`} <span className="text-[10px] text-slate-400">({r.assessed})</span></td>
            <td className="num px-2 py-1.5">{r.avgSlipDays == null ? '—' : `${num(r.avgSlipDays, 1)} d`}</td>
            <td className="num px-2 py-1.5">{r.delayed}</td>
            <td className="num px-2 py-1.5">{money(r.goodsValue)}</td>
            <td className="num px-2 py-1.5">{money(r.freight)}</td>
            <td className="num px-2 py-1.5">{r.freightPctOfValue == null ? '—' : `${num(r.freightPctOfValue, 1)}%`}</td>
          </tr>))}</tbody>
      </table>
    </div>
  )
}

const DEFAULT_OPTS: ModeOption[] = [
  { label: 'Sea', freight: 40000, transitDays: 28, onTimePct: 80, lateDaysIfLate: 6 },
  { label: 'Air', freight: 220000, transitDays: 3, onTimePct: 95, lateDaysIfLate: 1 },
  { label: 'Sea–air', freight: 120000, transitDays: 14, onTimePct: 88, lateDaysIfLate: 3 },
]

export default function LogisticsPage() {
  const { data, error, loading } = useApi<ShipmentRec[]>('/shipments')
  const rows = useMemo(() => data ?? [], [data])
  const byLane = useMemo(() => performance(rows, (s) => `${s.origin} → ${s.destination}`), [rows])
  const byCarrier = useMemo(() => performance(rows, (s) => s.carrier ?? 'Unspecified'), [rows])
  const byMode = useMemo(() => performance(rows, (s) => s.mode), [rows])
  const all = useMemo(() => performance(rows, () => 'all')[0], [rows])

  const [opts, setOpts] = useState<ModeOption[]>(DEFAULT_OPTS)
  const [inp, setInp] = useState({ goodsValue: 5000000, carryingRatePct: 20, costPerLateDay: 50000 })
  const results = useMemo(() => compareModes(opts, inp), [opts, inp])
  const setOpt = (i: number, k: keyof ModeOption, v: string) => setOpts(opts.map((o, j) => (j === i ? { ...o, [k]: k === 'label' ? v : Number(v) } : o)))

  if (loading) return <Loading />
  if (error) return <ErrorBox message={error} />

  return (
    <>
      <PageHeader title="Logistics Analytics" subtitle="Lane, carrier and mode performance from your shipment records, plus a landed-cost comparison of transport options. On time = delivered by the original ETA." />
      {!rows.length ? <div className="mb-5"><Empty>No shipments yet. <Link to="/app/import" className="text-signal underline">Import shipments</Link> (with ETAs, delivery dates and freight cost) to see lane and carrier performance.</Empty></div> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Shipments" value={num(all.shipments)} hint={`${all.assessed} with a measurable ETA`} />
            <Kpi label="On-time rate" value={all.onTimePct == null ? '—' : `${num(all.onTimePct, 0)}%`} tone={all.onTimePct != null && all.onTimePct < 85 ? 'warn' : 'ok'} />
            <Kpi label="Average slip" value={all.avgSlipDays == null ? '—' : `${num(all.avgSlipDays, 1)} days`} hint="late shipments count their delay; early counts 0" />
            <Kpi label="Freight / goods value" value={all.freightPctOfValue == null ? '—' : `${num(all.freightPctOfValue, 1)}%`} hint={money(all.freight) + ' freight recorded'} />
          </div>
          <div className="grid gap-4">
            <PerfTable title="By lane" rows={byLane} />
            <div className="grid gap-4 xl:grid-cols-2"><PerfTable title="By carrier" rows={byCarrier} /><PerfTable title="By mode" rows={byMode} /></div>
          </div>
        </>
      )}

      <div className="card mt-5 p-5">
        <h3 className="font-semibold">Transport option comparison (landed cost)</h3>
        <p className="mt-1 text-xs text-slate-500">Total = freight + cost of capital tied up in transit (goods value × annual carrying rate × days ÷ 365) + expected cost of lateness ((1 − on-time share) × late days × cost per late day). All inputs are your assumptions; use your lane history above to set on-time rates.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div><label className="label">Goods value (₹)</label><input type="number" className="input" value={inp.goodsValue} onChange={(e) => setInp({ ...inp, goodsValue: Number(e.target.value) })} /></div>
          <div><label className="label">Annual carrying rate (%)</label><input type="number" className="input" value={inp.carryingRatePct} onChange={(e) => setInp({ ...inp, carryingRatePct: Number(e.target.value) })} /></div>
          <div><label className="label">Cost per day late (₹)</label><input type="number" className="input" value={inp.costPerLateDay} onChange={(e) => setInp({ ...inp, costPerLateDay: Number(e.target.value) })} /></div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500">{['Option', 'Freight ₹', 'Transit days', 'On time %', 'Late days if late', ''].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{opts.map((o, i) => (
              <tr key={i}>
                <td className="px-1 py-1"><input className="input !py-1" value={o.label} onChange={(e) => setOpt(i, 'label', e.target.value)} /></td>
                {(['freight', 'transitDays', 'onTimePct', 'lateDaysIfLate'] as const).map((k) => <td key={k} className="px-1 py-1"><input type="number" className="input !py-1" value={o[k]} onChange={(e) => setOpt(i, k, e.target.value)} /></td>)}
                <td><button aria-label="Remove option" className="p-1 text-slate-400 hover:text-red-500" onClick={() => setOpts(opts.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>
              </tr>))}</tbody>
          </table>
          <button className="btn-ghost mt-2 !py-1 text-xs" onClick={() => setOpts([...opts, { label: `Option ${opts.length + 1}`, freight: 0, transitDays: 10, onTimePct: 85, lateDaysIfLate: 3 }])}><Plus size={13} />Add option</button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500">{['Rank', 'Option', 'Freight', 'In-transit capital', 'Expected lateness', 'Total landed cost'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{results.map((r, i) => (
              <tr key={i} className={`border-t border-slate-100 dark:border-ink-800 ${i === 0 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : ''}`}>
                <td className="px-2 py-1.5">{i + 1}</td><td className="px-2 py-1.5">{r.label}</td>
                <td className="num px-2 py-1.5">{money(r.freight)}</td><td className="num px-2 py-1.5">{money(r.pipelineCost)}</td>
                <td className="num px-2 py-1.5">{money(r.expectedLateCost)}</td><td className="num px-2 py-1.5">{money(r.total)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </div>
    </>
  )
}
