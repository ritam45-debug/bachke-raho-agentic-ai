import { useEffect, useMemo, useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/useApi'
import { breakEvenDays, disruptionImpact, holdingCost, mitigationRoi, sensitivity, type ImpactIn } from '../../lib/finance'
import { dateTime, money, num, titleCase } from '../../lib/format'
import { ErrorBox, Kpi, Loading, PageHeader } from '../../components/ui'

interface Settings { carrying_cost_pct: number; revenue_per_day: number | null; gross_margin_pct: number | null; downtime_cost_per_day: number | null }
interface Scenario { id: string; name: string; kind: string; inputs: Record<string, unknown>; results: Record<string, unknown>; created_at: string }

function Field({ label, value, onChange, suffix, from }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; from?: string }) {
  return <div><label className="label">{label}{suffix ? ` (${suffix})` : ''}{from && <span className="ml-1 text-[10px] text-calm">· {from}</span>}</label><input type="number" className="input" value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>
}

export default function FinancePage() {
  const { can } = useAuth()
  const sApi = useApi<{ settings: Settings; is_default: boolean }>('/finance/settings')
  const scen = useApi<Scenario[]>('/finance/scenarios')
  const ov = useApi<{ kpis: Record<string, number> }>('/dashboard/overview')
  const [st, setSt] = useState<Settings | null>(null)
  const [imp, setImp] = useState<ImpactIn>({ days: 10, revenuePerDayAtRisk: 0, grossMarginPct: 30, downtimeCostPerDay: 0, expediteCost: 0, penaltyCost: 0 })
  const [mit, setMit] = useState({ likelihoodPct: 30, effectivenessPct: 70, mitigationCost: 500000 })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [name, setName] = useState('')
  useEffect(() => {
    if (!sApi.data) return
    const s = sApi.data.settings; setSt(s)
    setImp((i) => ({ ...i, revenuePerDayAtRisk: s.revenue_per_day ?? i.revenuePerDayAtRisk, grossMarginPct: s.gross_margin_pct ?? i.grossMarginPct, downtimeCostPerDay: s.downtime_cost_per_day ?? i.downtimeCostPerDay }))
  }, [sApi.data])

  const invValue = ov.data?.kpis.inventory_value ?? 0
  const hold = st ? holdingCost(invValue, st.carrying_cost_pct) : null
  const impact = useMemo(() => disruptionImpact(imp), [imp])
  const roi = useMemo(() => mitigationRoi({ impactTotal: impact.total, ...mit }), [impact.total, mit])
  const beDays = breakEvenDays(impact.perDay, mit.effectivenessPct, mit.mitigationCost)
  const grid = useMemo(() => sensitivity(imp, { effectivenessPct: mit.effectivenessPct, mitigationCost: mit.mitigationCost }), [imp, mit])
  const canWrite = can('finance:write')

  const saveSettings = async () => {
    setMsg(null)
    try { await api('/finance/settings', { method: 'PUT', json: st }); setMsg({ ok: true, text: 'Finance settings saved.' }); void sApi.reload() } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }
  const saveScenario = async () => {
    setMsg(null)
    try {
      await api('/finance/scenarios', { method: 'POST', json: { name: name || `Disruption ${imp.days} days`, kind: 'mitigation_roi', inputs: { ...imp, ...mit }, results: { impact, roi, break_even_days: beDays } } })
      setName(''); setMsg({ ok: true, text: 'Scenario saved.' }); void scen.reload()
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }

  if (sApi.loading) return <Loading />
  if (sApi.error) return <ErrorBox message={sApi.error} />

  return (
    <>
      <PageHeader title="Financial Intelligence" subtitle="What disruptions could cost and whether mitigation pays. Every figure is an estimate from the inputs shown; inputs marked 'your records' come from your data, the rest are assumptions you set." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Inventory value" value={money(invValue)} hint="your records" />
        <Kpi label="Holding cost / year" value={hold ? money(hold.annual) : '—'} hint={st ? `at ${st.carrying_cost_pct}% carrying rate (assumption)` : ''} />
        <Kpi label="Holding cost / month" value={hold ? money(hold.monthly) : '—'} />
        <Kpi label="Delayed goods value" value={money(ov.data?.kpis.delayed_shipment_value ?? 0)} hint="your records" tone={(ov.data?.kpis.delayed_shipment_value ?? 0) > 0 ? 'warn' : undefined} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="card space-y-3 p-5">
          <h3 className="font-semibold">1. Disruption impact</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Disruption length" suffix="days" value={imp.days} onChange={(v) => setImp({ ...imp, days: v })} />
            <Field label="Revenue at risk per day" suffix="₹" value={imp.revenuePerDayAtRisk} onChange={(v) => setImp({ ...imp, revenuePerDayAtRisk: v })} from={st?.revenue_per_day != null ? 'settings' : undefined} />
            <Field label="Gross margin" suffix="%" value={imp.grossMarginPct} onChange={(v) => setImp({ ...imp, grossMarginPct: v })} from={st?.gross_margin_pct != null ? 'settings' : undefined} />
            <Field label="Downtime cost per day" suffix="₹" value={imp.downtimeCostPerDay} onChange={(v) => setImp({ ...imp, downtimeCostPerDay: v })} from={st?.downtime_cost_per_day != null ? 'settings' : undefined} />
            <Field label="Expediting / spot buys" suffix="₹ one-off" value={imp.expediteCost} onChange={(v) => setImp({ ...imp, expediteCost: v })} />
            <Field label="Contract penalties" suffix="₹" value={imp.penaltyCost} onChange={(v) => setImp({ ...imp, penaltyCost: v })} />
          </div>
          <table className="w-full text-sm"><tbody>
            {[['Lost margin (days × revenue × margin)', impact.lostMargin], ['Downtime (days × cost per day)', impact.downtime], ['Expediting', impact.expedite], ['Penalties', impact.penalties]].map(([l, v]) => (
              <tr key={l as string} className="border-t border-slate-100 dark:border-ink-800"><td className="py-1.5">{l}</td><td className="num py-1.5 text-right">{money(v as number)}</td></tr>))}
            <tr className="border-t-2 border-slate-300 font-semibold dark:border-ink-700"><td className="py-1.5">Estimated impact if it happens</td><td className="num py-1.5 text-right">{money(impact.total)}</td></tr>
          </tbody></table>
        </div>

        <div className="card space-y-3 p-5">
          <h3 className="font-semibold">2. Is mitigation worth it?</h3>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Likelihood" suffix="%" value={mit.likelihoodPct} onChange={(v) => setMit({ ...mit, likelihoodPct: v })} />
            <Field label="Loss avoided" suffix="%" value={mit.effectivenessPct} onChange={(v) => setMit({ ...mit, effectivenessPct: v })} />
            <Field label="Mitigation cost" suffix="₹" value={mit.mitigationCost} onChange={(v) => setMit({ ...mit, mitigationCost: v })} />
          </div>
          <table className="w-full text-sm"><tbody>
            {[['Expected loss (likelihood × impact)', money(roi.expectedLoss)], ['Expected benefit (× loss avoided)', money(roi.benefit)], ['Net benefit (benefit − cost)', money(roi.net)],
              ['ROI', roi.roiPct == null ? '—' : `${num(roi.roiPct, 0)}%`], ['Break-even likelihood', roi.breakEvenLikelihoodPct == null ? '—' : `${num(roi.breakEvenLikelihoodPct, 1)}%`],
              ['Break-even disruption length (if it happens)', beDays == null ? '—' : `${num(beDays, 1)} days`]].map(([l, v]) => (
              <tr key={l} className="border-t border-slate-100 dark:border-ink-800"><td className="py-1.5">{l}</td><td className="num py-1.5 text-right">{v}</td></tr>))}
          </tbody></table>
          <p className={`rounded-lg p-2 text-sm font-medium ${roi.worthIt ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'}`}>
            {roi.worthIt ? 'On these assumptions, mitigating is expected to pay back.' : 'On these assumptions, mitigation costs more than the loss it is expected to avoid.'}</p>
          {canWrite && <div className="flex gap-2"><input className="input" placeholder="Scenario name" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-primary whitespace-nowrap" onClick={saveScenario}><Save size={14} />Save scenario</button></div>}
          {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{msg.text}</p>}
        </div>
      </div>

      <div className="card mt-4 overflow-x-auto p-5">
        <h3 className="font-semibold">3. Sensitivity: net benefit of mitigating</h3>
        <p className="mt-1 text-xs text-slate-500">Rows vary the disruption length (50%–200% of your estimate); columns vary its likelihood. Green = mitigation pays.</p>
        <table className="mt-3 text-sm"><thead><tr><th className="px-3 py-1.5 text-left text-xs text-slate-500">Days \ Likelihood</th>{grid[0].cells.map((c) => <th key={c.likelihoodPct} className="px-3 py-1.5 text-xs text-slate-500">{c.likelihoodPct}%</th>)}</tr></thead>
          <tbody>{grid.map((r) => <tr key={r.days}><td className="num px-3 py-1.5 font-medium">{r.days}</td>{r.cells.map((c) => <td key={c.likelihoodPct} className={`num px-3 py-1.5 text-right ${c.net > 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'}`}>{money(c.net)}</td>)}</tr>)}</tbody></table>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="card space-y-3 p-5">
          <h3 className="font-semibold">Company finance assumptions</h3>
          {st && <div className="grid grid-cols-2 gap-3">
            <Field label="Annual carrying cost" suffix="%" value={st.carrying_cost_pct} onChange={(v) => setSt({ ...st, carrying_cost_pct: v })} />
            <Field label="Revenue per day" suffix="₹" value={st.revenue_per_day ?? 0} onChange={(v) => setSt({ ...st, revenue_per_day: v })} />
            <Field label="Gross margin" suffix="%" value={st.gross_margin_pct ?? 0} onChange={(v) => setSt({ ...st, gross_margin_pct: v })} />
            <Field label="Downtime cost per day" suffix="₹" value={st.downtime_cost_per_day ?? 0} onChange={(v) => setSt({ ...st, downtime_cost_per_day: v })} />
          </div>}
          <p className="text-[11px] text-slate-500">{sApi.data?.is_default ? 'Using the platform default carrying rate of 20%, a common planning assumption, not a figure for your company. Replace it with your own.' : 'Saved company assumptions.'}</p>
          {canWrite ? <button className="btn-ghost" onClick={saveSettings}><Save size={14} />Save assumptions</button> : <p className="text-xs text-slate-500">Only finance managers and admins can change these.</p>}
        </div>
        <div className="card p-5">
          <h3 className="font-semibold">Saved scenarios</h3>
          {!scen.data?.length ? <p className="mt-2 text-sm text-slate-500">No saved scenarios yet.</p> : (
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-ink-800">{scen.data.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{s.name}</span><span className="text-xs text-slate-500">{titleCase(s.kind)} · {dateTime(s.created_at)}</span></span>
                {s.kind === 'mitigation_roi' && <span className="num text-xs">{money(Number((s.results.roi as { net?: number })?.net ?? 0))} net</span>}
                {(canWrite || can('procurement:write')) && <button aria-label="Delete scenario" className="p-1 text-slate-400 hover:text-red-500" onClick={async () => { await api(`/finance/scenarios/${s.id}`, { method: 'DELETE' }); void scen.reload() }}><Trash2 size={14} /></button>}
              </li>))}</ul>
          )}
        </div>
      </div>
    </>
  )
}
