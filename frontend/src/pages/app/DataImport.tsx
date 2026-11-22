import { useMemo, useState } from 'react'
import { CheckCircle2, Copy, FileUp, Loader2 } from 'lucide-react'
import { api } from '../../lib/api'
import { parseCsv } from '../../components/CsvImport'
import { ErrorBox, PageHeader } from '../../components/ui'

type Entity = 'suppliers' | 'products' | 'inventory' | 'shipments'

const SPECS: Record<Entity, { label: string; required: string[]; optional: string[]; example: string; note: string }> = {
  suppliers: {
    label: 'Suppliers', required: ['code', 'name', 'category', 'country'],
    optional: ['city', 'on_time_delivery_rate', 'quality_score', 'avg_lead_time_days', 'annual_spend', 'financial_stability_score', 'risk_exposure_score', 'capacity_units_per_month', 'moq_units'],
    example: 'code,name,category,country,city,on_time_delivery_rate,quality_score,avg_lead_time_days,annual_spend,financial_stability_score,risk_exposure_score,capacity_units_per_month,moq_units\nSUP-01,Alpha Metals,Steel,India,Pune,92%,88,10,4500000,70,20,5000,200\nSUP-02,Beta Polymers,Plastics,Vietnam,Hanoi,80%,75,25,1800000,55,45,3000,500\n',
    note: 'Re-importing a code updates that supplier. On-time rate accepts 0.92, 92 or 92%. Scores are your own 0–100 assessments (risk exposure: 0 = none, 100 = extreme).',
  },
  products: {
    label: 'Products', required: ['sku', 'name', 'kind', 'category', 'unit_cost'], optional: ['unit', 'unit_price', 'conversion_cost', 'primary_supplier_code'],
    example: 'sku,name,kind,category,unit,unit_cost,unit_price,conversion_cost,primary_supplier_code\nRM-STEEL,Steel sheet 2mm,raw_material,Metals,kg,120,,,SUP-01\nFG-CAB,Steel cabinet,finished_good,Furniture,unit,900,1500,150,\n',
    note: 'kind is raw_material, component or finished_good. Import suppliers first so primary_supplier_code can be matched.',
  },
  inventory: {
    label: 'Inventory', required: ['sku', 'location', 'quantity_on_hand', 'avg_daily_demand'], optional: ['lead_time_days', 'safety_stock', 'reorder_point'],
    example: 'sku,location,quantity_on_hand,avg_daily_demand,lead_time_days,safety_stock,reorder_point\nRM-STEEL,Plant 1,4200,350,10,1200,\nFG-CAB,Plant 1,180,12,,30,\n',
    note: 'location must match a saved location name. If reorder_point is blank it is calculated as demand × lead time + safety stock; a blank lead time uses the primary supplier\'s lead time.',
  },
  shipments: {
    label: 'Shipments', required: ['reference', 'direction', 'quantity', 'value', 'origin', 'origin_country', 'destination', 'mode', 'status'],
    optional: ['supplier_code', 'sku', 'freight_cost', 'carrier', 'departed_at', 'original_eta', 'current_eta', 'delivered_at'],
    example: 'reference,direction,supplier_code,sku,quantity,value,freight_cost,origin,origin_country,destination,mode,carrier,status,departed_at,original_eta,current_eta,delivered_at\nPO-1001,inbound,SUP-02,RM-STEEL,8000,960000,42000,Hai Phong,Vietnam,Chennai,sea,OceanCo,delayed,2026-11-02,2026-11-20,2026-11-26,\nSO-2001,outbound,,FG-CAB,60,90000,3500,Chennai,India,Bengaluru,road,RoadFast,delivered,2026-11-10,2026-11-12,2026-11-12,2026-11-13\n',
    note: 'mode: sea, air, road or rail. status: planned, in_transit, delayed, delivered or cancelled. Dates as YYYY-MM-DD. Re-importing a reference updates it.',
  },
}
const ORDER: Entity[] = ['suppliers', 'products', 'inventory', 'shipments']

export default function DataImportPage() {
  const [entity, setEntity] = useState<Entity>('suppliers')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const spec = SPECS[entity]
  const rows = useMemo(() => { try { return parseCsv(text) } catch { return [] } }, [text])
  const missingCols = rows.length ? spec.required.filter((c) => !(c in rows[0])) : []

  const run = async () => {
    setBusy(true); setResult(null)
    try {
      const r = await api<{ created: number; updated: number }>(`/${entity}/bulk`, { method: 'POST', json: { rows } })
      setResult({ ok: true, msg: `${spec.label}: ${r.created} created, ${r.updated} updated.` }); setText('')
    } catch (e) { setResult({ ok: false, msg: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <>
      <PageHeader title="Data Import" subtitle="Bring your suppliers, products, inventory and shipments in from Excel or your ERP as CSV. Each file is checked as a whole: every row is saved, or none are, and errors name the row." />
      <ol className="mb-5 flex flex-wrap gap-2 text-xs">
        {ORDER.map((e, i) => (
          <li key={e}><button onClick={() => { setEntity(e); setText(''); setResult(null) }}
            className={`rounded-full border px-3 py-1.5 ${entity === e ? 'border-signal bg-signal/10 font-semibold' : 'border-slate-300 dark:border-ink-700'}`}>{i + 1}. {SPECS[e].label}</button></li>
        ))}
        <li className="self-center text-slate-500">Import in this order. Locations come from Company Settings or the Route &amp; Risk Map.</li>
      </ol>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="card space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button className="text-signal hover:underline" onClick={() => setText(spec.example)}>Use example</button>
            <button className="flex items-center gap-1 hover:underline" onClick={async () => { try { await navigator.clipboard.writeText(spec.example); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* blocked */ } }}><Copy size={12} />{copied ? 'Copied' : 'Copy template'}</button>
            <label className="ml-auto flex cursor-pointer items-center gap-1 hover:underline"><FileUp size={13} />Choose .csv file
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = '' }} /></label>
          </div>
          <textarea rows={10} className="input font-mono text-xs" placeholder={`Paste ${spec.label.toLowerCase()} CSV here (first line = column names)…`} value={text} onChange={(e) => { setText(e.target.value); setResult(null) }} />
          {rows.length > 0 && (
            <div className="text-xs">
              <div className="mb-1 text-slate-500">{rows.length} row{rows.length > 1 ? 's' : ''} detected{missingCols.length ? '' : ' · all required columns present'}</div>
              {missingCols.length > 0 && <ErrorBox message={`Missing required column(s): ${missingCols.join(', ')}`} />}
              <div className="mt-2 overflow-x-auto"><table className="text-[11px]"><thead><tr>{Object.keys(rows[0]).map((c) => <th key={c} className="px-2 py-1 text-left font-semibold text-slate-500">{c}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i} className="border-t border-slate-100 dark:border-ink-800">{Object.keys(rows[0]).map((c) => <td key={c} className="whitespace-nowrap px-2 py-1">{r[c]}</td>)}</tr>)}</tbody></table></div>
            </div>
          )}
          {result && (result.ok ? <p className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 size={16} />{result.msg}</p> : <ErrorBox message={result.msg} />)}
          <button className="btn-primary" disabled={!rows.length || missingCols.length > 0 || busy} onClick={run}>
            {busy ? <><Loader2 size={15} className="animate-spin" />Importing…</> : `Import ${rows.length || ''} ${spec.label.toLowerCase()}`}
          </button>
        </div>
        <aside className="card space-y-3 p-5 text-sm">
          <h3 className="font-semibold">{spec.label} columns</h3>
          <div><div className="label">Required</div><div className="flex flex-wrap gap-1">{spec.required.map((c) => <code key={c} className="rounded bg-signal/15 px-1.5 py-0.5 text-xs">{c}</code>)}</div></div>
          <div><div className="label">Optional</div><div className="flex flex-wrap gap-1">{spec.optional.map((c) => <code key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-ink-800">{c}</code>)}</div></div>
          <p className="text-xs text-slate-500">{spec.note}</p>
          <p className="text-xs text-slate-500">Up to 2,000 rows per file. Imported rows are marked "upload" as their source and every import is recorded in the audit log.</p>
        </aside>
      </div>
    </>
  )
}
