import { useEffect, useMemo, useState } from 'react'
import { Lock, Plus, ShieldCheck, Trash2, Unlock } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/useApi'
import { analyse, sentiment, type Resp } from '../../lib/feedback'
import { dateTime, num } from '../../lib/format'
import { parseCsv } from '../../components/CsvImport'
import { Badge, Empty, ErrorBox, Kpi, Loading, PageHeader } from '../../components/ui'

interface Survey { id: string; title: string; question: string; consent_text: string; is_open: boolean; created_at: string; responses: number }
interface R extends Resp { id: string; received_at: string }
const CONSENT = 'I agree that my rating and comments may be stored by the company and analysed to improve its products and service. I can ask for my response to be deleted at any time.'

export default function ConsumerPage() {
  const { can } = useAuth()
  const surveys = useApi<Survey[]>('/feedback/surveys')
  const [sid, setSid] = useState('')
  const resp = useApi<R[]>(sid ? `/feedback/surveys/${sid}/responses` : null)
  const [newS, setNewS] = useState<{ title: string; consent_text: string } | null>(null)
  const [one, setOne] = useState({ score: 8, comment: '', product_sku: '', region: '', channel: '', consent: false })
  const [csv, setCsv] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const canWrite = can('feedback:write')
  useEffect(() => { if (!sid && surveys.data?.length) setSid(surveys.data[0].id) }, [surveys.data, sid])
  const sv = surveys.data?.find((s) => s.id === sid)
  const a = useMemo(() => analyse(resp.data ?? []), [resp.data])

  const run = async (f: () => Promise<unknown>, ok: string) => {
    setMsg(null)
    try { await f(); setMsg({ ok: true, text: ok }); void resp.reload(); void surveys.reload() } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }
  const addOne = () => run(async () => {
    await api(`/feedback/surveys/${sid}/responses`, { method: 'POST', json: { rows: [{ ...one, comment: one.comment || null, product_sku: one.product_sku || null, region: one.region || null, channel: one.channel || null }] } })
    setOne({ ...one, comment: '', consent: false })
  }, 'Response recorded.')
  const addCsv = () => run(async () => {
    const rows = parseCsv(csv).map((r) => ({ score: Number(r.score), comment: r.comment || null, product_sku: r.product_sku || null, region: r.region || null, channel: r.channel || null,
      consent: /^(true|yes|y|1)$/i.test((r.consent ?? '').trim()) }))
    const res = await api<{ created: number }>(`/feedback/surveys/${sid}/responses`, { method: 'POST', json: { rows } }); setCsv(''); return res
  }, 'Responses imported.')

  if (surveys.loading) return <Loading />
  if (surveys.error) return <ErrorBox message={surveys.error} />

  return (
    <>
      <PageHeader title="Consumer Intelligence" subtitle="Consent-based customer surveys: NPS, sentiment and recurring complaint themes, broken down by product, region and channel."
        actions={canWrite && !newS ? <button className="btn-primary" onClick={() => setNewS({ title: '', consent_text: CONSENT })}><Plus size={15} />New survey</button> : undefined} />
      {newS && (
        <div className="card mb-4 space-y-3 p-5">
          <div><label className="label">Survey title</label><input className="input" value={newS.title} placeholder="e.g. Q4 delivery experience" onChange={(e) => setNewS({ ...newS, title: e.target.value })} /></div>
          <div><label className="label">Consent notice shown to every respondent</label><textarea rows={3} className="input" value={newS.consent_text} onChange={(e) => setNewS({ ...newS, consent_text: e.target.value })} /></div>
          <p className="text-[11px] text-slate-500">The default wording is a starting point, not legal text. Adapt it to the data-protection law that applies to you (for India, the Digital Personal Data Protection Act, 2023).</p>
          <div className="flex gap-2"><button className="btn-primary" onClick={() => run(async () => { const s = await api<Survey>('/feedback/surveys', { method: 'POST', json: newS }); setNewS(null); setSid(s.id) }, 'Survey created.')}>Create</button><button className="btn-ghost" onClick={() => setNewS(null)}>Cancel</button></div>
        </div>)}
      {!surveys.data?.length ? <Empty>No surveys yet. Create one, then record responses collected with its consent notice (in person, by phone, or imported from your survey tool as CSV).</Empty> : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select className="input !w-auto" value={sid} onChange={(e) => setSid(e.target.value)}>{surveys.data.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.responses})</option>)}</select>
            {sv && <Badge value={sv.is_open ? 'open' : 'closed'} tone={sv.is_open ? 'green' : 'slate'} />}
            {sv && canWrite && <button className="btn-ghost !py-1 text-xs" onClick={() => run(() => api(`/feedback/surveys/${sv.id}?is_open=${!sv.is_open}`, { method: 'PATCH' }), sv.is_open ? 'Survey closed.' : 'Survey reopened.')}>{sv.is_open ? <><Lock size={13} />Close</> : <><Unlock size={13} />Reopen</>}</button>}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi label="NPS" value={a.overall.nps == null ? '—' : num(a.overall.nps, 1)} hint="% promoters − % detractors" tone={a.overall.nps == null ? undefined : a.overall.nps < 0 ? 'risk' : a.overall.nps < 30 ? 'warn' : 'ok'} />
            <Kpi label="Responses" value={a.overall.n} />
            <Kpi label="Promoters (9–10)" value={a.overall.promoters} />
            <Kpi label="Detractors (0–6)" value={a.overall.detractors} />
            <Kpi label="Negative comments" value={a.sentiment.negative} hint={`${a.sentiment.positive} positive · ${a.sentiment.neutral} neutral`} />
          </div>
          {a.overall.n > 0 && a.overall.n < 30 && <p className="mt-2 text-xs text-amber-600">Fewer than 30 responses: treat NPS and segment figures as indicative only.</p>}

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div className="card p-4">
              <h3 className="text-sm font-semibold">Recurring complaint themes</h3>
              {!a.themes.length ? <p className="mt-2 text-sm text-slate-500">No themes detected yet.</p> : a.themes.map((t) => (
                <div key={t.name} className="mt-2 border-t border-slate-100 pt-2 text-sm dark:border-ink-800">
                  <div className="flex justify-between"><span className="font-medium">{t.name}</span><span className="num text-xs">{t.count} mentions · {t.detractors} detractors · avg {num(t.avgScore, 1)}/10</span></div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">“{t.examples[0]}”</div>
                </div>))}
              <p className="mt-2 text-[11px] text-slate-500">Themes and sentiment use a keyword lexicon (see lib/feedback.ts), so sarcasm and unusual phrasing can be misread. Read the comments before acting.</p>
            </div>
            <div className="card p-4">
              <h3 className="text-sm font-semibold">NPS by segment</h3>
              {(['byProduct', 'byRegion', 'byChannel'] as const).map((k) => a[k].some((x) => x.key !== '—') && (
                <div key={k} className="mt-2"><div className="text-xs font-semibold uppercase text-slate-500">{k.slice(2)}</div>
                  {a[k].map((x) => <div key={x.key} className="mt-1 flex justify-between text-sm"><span>{x.key}</span><span className={`num ${(x.nps ?? 0) < 0 ? 'text-red-500' : ''}`}>{num(x.nps, 1)} <span className="text-xs text-slate-500">(n={x.n})</span></span></div>)}</div>))}
              {!a.byProduct.some((x) => x.key !== '—') && !a.byRegion.some((x) => x.key !== '—') && <p className="mt-2 text-sm text-slate-500">Add product SKU, region or channel to responses to see segments.</p>}
            </div>
          </div>

          {canWrite && sv?.is_open && (
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <div className="card space-y-2 p-4">
                <h3 className="text-sm font-semibold">Record a response</h3>
                <p className="text-xs text-slate-500">{sv.question}</p>
                <div className="flex flex-wrap gap-1">{Array.from({ length: 11 }, (_, i) => <button key={i} onClick={() => setOne({ ...one, score: i })} className={`h-8 w-8 rounded text-sm ${one.score === i ? 'bg-signal font-semibold text-ink-950' : 'bg-slate-100 dark:bg-ink-800'}`}>{i}</button>)}</div>
                <textarea rows={2} className="input" placeholder="Comment (optional)" value={one.comment} onChange={(e) => setOne({ ...one, comment: e.target.value })} />
                <div className="grid grid-cols-3 gap-2">
                  <input className="input" placeholder="Product SKU" value={one.product_sku} onChange={(e) => setOne({ ...one, product_sku: e.target.value })} />
                  <input className="input" placeholder="Region" value={one.region} onChange={(e) => setOne({ ...one, region: e.target.value })} />
                  <input className="input" placeholder="Channel" value={one.channel} onChange={(e) => setOne({ ...one, channel: e.target.value })} />
                </div>
                <label className="flex items-start gap-2 rounded bg-slate-50 p-2 text-xs dark:bg-ink-800"><input type="checkbox" className="mt-0.5" checked={one.consent} onChange={(e) => setOne({ ...one, consent: e.target.checked })} /><span><ShieldCheck size={12} className="mr-1 inline text-calm" />The respondent agreed to: “{sv.consent_text}”</span></label>
                <button className="btn-primary" disabled={!one.consent} onClick={addOne}>Save response</button>
              </div>
              <div className="card space-y-2 p-4">
                <h3 className="text-sm font-semibold">Import responses (CSV)</h3>
                <p className="text-xs text-slate-500">Columns: <code>score,comment,product_sku,region,channel,consent</code>. Every row needs consent = yes; if any row lacks it, nothing is imported.</p>
                <textarea rows={6} className="input font-mono text-xs" placeholder={'score,comment,region,consent\n9,Arrived on time,South,yes'} value={csv} onChange={(e) => setCsv(e.target.value)} />
                <button className="btn-primary" disabled={!csv.trim()} onClick={addCsv}>Import</button>
              </div>
            </div>)}
          {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{msg.text}</p>}

          <div className="card mt-4 overflow-x-auto p-4">
            <h3 className="text-sm font-semibold">Responses</h3>
            {!resp.data?.length ? <p className="mt-2 text-sm text-slate-500">No responses yet.</p> : (
              <table className="mt-2 w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1">Score</th><th>Comment</th><th>Sentiment</th><th>Segment</th><th>Received</th><th /></tr></thead>
                <tbody>{resp.data.map((r) => { const s = sentiment(r.comment); return (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-ink-800">
                    <td className={`num py-1.5 font-semibold ${r.score <= 6 ? 'text-red-500' : r.score >= 9 ? 'text-emerald-600' : ''}`}>{r.score}</td>
                    <td className="max-w-md truncate">{r.comment ?? '—'}</td><td><Badge value={s.label} /></td>
                    <td className="text-xs text-slate-500">{[r.product_sku, r.region, r.channel].filter(Boolean).join(' · ') || '—'}</td><td className="text-xs">{dateTime(r.received_at)}</td>
                    <td>{canWrite && <button aria-label="Delete response" title="Delete (e.g. consent withdrawn)" className="p-1 text-slate-400 hover:text-red-500" onClick={() => run(() => api(`/feedback/responses/${r.id}`, { method: 'DELETE' }), 'Response deleted.')}><Trash2 size={13} /></button>}</td>
                  </tr>) })}</tbody></table>)}
          </div>
        </>
      )}
    </>
  )
}
