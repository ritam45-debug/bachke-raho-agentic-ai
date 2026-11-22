import { useMemo, useState } from 'react'
import { AlertTriangle, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/useApi'
import { date } from '../../lib/format'
import { Badge, Empty, ErrorBox, Kpi, Loading, PageHeader } from '../../components/ui'

interface Req { id: string; title: string; jurisdiction: string; category: string; regulator: string | null; source_url: string; effective_date: string | null; review_date: string | null
  status: string; owner_user_id: string | null; applies_to: string | null; obligation: string | null; interpretation: string | null; evidence: string | null; updated_at: string; flags: string[] }
const STATUSES = ['not_assessed', 'in_progress', 'gap', 'compliant', 'not_applicable']
const BLANK = { title: '', jurisdiction: '', category: '', regulator: '', source_url: '', effective_date: '', review_date: '', status: 'not_assessed', owner_user_id: '', applies_to: '', obligation: '', interpretation: '', evidence: '' }

export default function CompliancePage() {
  const { can } = useAuth()
  const list = useApi<Req[]>('/compliance')
  const users = useApi<{ id: string; full_name: string }[]>(can('users:read') ? '/users' : null)
  const [form, setForm] = useState<typeof BLANK | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'attention'>('all')
  const canWrite = can('compliance:write')
  const rows = useMemo(() => (list.data ?? []).filter((r) => filter === 'all' || r.flags.length), [list.data, filter])
  const owner = (id: string | null) => users.data?.find((u) => u.id === id)?.full_name ?? (id ? 'Assigned' : '—')
  const all = list.data ?? []

  const save = async () => {
    if (!form) return
    setErr(null)
    const json = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' && k !== 'status' ? null : v]))
    try {
      await api(editId ? `/compliance/${editId}` : '/compliance', { method: editId ? 'PUT' : 'POST', json })
      setForm(null); setEditId(null); void list.reload()
    } catch (e) { setErr((e as Error).message) }
  }
  const edit = (r: Req) => { setEditId(r.id); setForm(Object.fromEntries(Object.keys(BLANK).map((k) => [k, (r as unknown as Record<string, string | null>)[k] ?? ''])) as typeof BLANK) }
  const F = (k: keyof typeof BLANK, label: string, type = 'text', ph = '') => (
    <div><label className="label">{label}</label><input type={type} className="input" placeholder={ph} value={form![k]} onChange={(e) => setForm({ ...form!, [k]: e.target.value })} /></div>)
  const T = (k: keyof typeof BLANK, label: string, ph: string) => (
    <div className="md:col-span-3"><label className="label">{label}</label><textarea rows={2} className="input" placeholder={ph} value={form![k]} onChange={(e) => setForm({ ...form!, [k]: e.target.value })} /></div>)

  if (list.loading) return <Loading />
  if (list.error) return <ErrorBox message={list.error} />

  return (
    <>
      <PageHeader title="Legal & Compliance" subtitle="A register of the regulations, standards and contract terms your supply chain must meet, each tied to its official source, dates and owner."
        actions={canWrite && !form ? <button className="btn-primary" onClick={() => { setEditId(null); setForm({ ...BLANK }) }}><Plus size={15} />Add requirement</button> : undefined} />
      <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
        <AlertTriangle size={13} className="mr-1 inline" />This register records what your team has found and decided. It is not legal advice and does not track law changes by itself: always confirm against the linked official source, and take qualified legal advice for decisions.
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Requirements" value={all.length} />
        <Kpi label="Compliant" value={all.filter((r) => r.status === 'compliant').length} tone="ok" />
        <Kpi label="Gaps" value={all.filter((r) => r.status === 'gap').length} tone={all.some((r) => r.status === 'gap') ? 'risk' : undefined} />
        <Kpi label="Need attention" value={all.filter((r) => r.flags.length).length} tone={all.some((r) => r.flags.length) ? 'warn' : undefined} />
        <Kpi label="Review overdue" value={all.filter((r) => r.flags.includes('Review overdue')).length} />
      </div>

      {form && (
        <div className="card mt-4 p-5">
          <h3 className="font-semibold">{editId ? 'Edit requirement' : 'New requirement'}</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {F('title', 'Requirement *', 'text', 'e.g. EPR registration for plastic packaging')}
            {F('jurisdiction', 'Jurisdiction *', 'text', 'e.g. India, EU, Tamil Nadu')}
            {F('category', 'Category *', 'text', 'e.g. Environment, Customs, Labelling')}
            {F('regulator', 'Regulator / issuer', 'text', 'e.g. CPCB, DGFT, BIS')}
            {F('source_url', 'Official source URL *', 'url', 'https://…')}
            {F('applies_to', 'Applies to', 'text', 'products, sites or lanes')}
            {F('effective_date', 'Effective date', 'date')}
            {F('review_date', 'Next review', 'date')}
            <div><label className="label">Status</label><select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></div>
            {users.data && <div><label className="label">Owner</label><select className="input" value={form.owner_user_id} onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })}><option value="">— none —</option>{users.data.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></div>}
            {T('obligation', 'What the source says (fact)', 'Quote or paraphrase the obligation, with section number')}
            {T('interpretation', 'What it means for us (interpretation)', "Your team's reading: kept separate from the source text")}
            {T('evidence', 'Evidence of compliance', 'Certificate numbers, filings, document locations')}
          </div>
          {err && <div className="mt-3"><ErrorBox message={err} /></div>}
          <div className="mt-3 flex gap-2"><button className="btn-primary" onClick={save}>Save</button><button className="btn-ghost" onClick={() => { setForm(null); setEditId(null) }}>Cancel</button></div>
        </div>
      )}

      <div className="mt-4 flex w-fit gap-1 rounded-lg bg-slate-100 p-0.5 text-sm dark:bg-ink-800">
        {(['all', 'attention'] as const).map((t) => <button key={t} onClick={() => setFilter(t)} className={`rounded-md px-4 py-1.5 ${filter === t ? 'bg-white font-semibold shadow dark:bg-ink-700' : ''}`}>{t === 'all' ? 'All' : 'Needs attention'}</button>)}
      </div>
      {!rows.length ? <div className="mt-3"><Empty>{all.length ? 'Nothing needs attention.' : 'No requirements yet. Add the rules that apply to your products, sites and trade lanes, each with its official source.'}</Empty></div> : (
        <div className="mt-3 space-y-2">{rows.map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{r.title}</span><Badge value={r.status} /></div>
                <div className="mt-0.5 text-xs text-slate-500">{r.jurisdiction} · {r.category}{r.regulator ? ` · ${r.regulator}` : ''} · effective {date(r.effective_date)} · review {date(r.review_date)} · owner {owner(r.owner_user_id)}</div>
                <a className="mt-1 inline-flex items-center gap-1 text-xs text-signal hover:underline" href={r.source_url} target="_blank" rel="noreferrer">Official source <ExternalLink size={11} /></a>
              </div>
              {canWrite && <div className="flex gap-1"><button aria-label="Edit" className="p-1 text-slate-400 hover:text-signal" onClick={() => edit(r)}><Pencil size={14} /></button>
                <button aria-label="Delete" className="p-1 text-slate-400 hover:text-red-500" onClick={async () => { await api(`/compliance/${r.id}`, { method: 'DELETE' }); void list.reload() }}><Trash2 size={14} /></button></div>}
            </div>
            {(r.obligation || r.interpretation) && <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
              {r.obligation && <div className="rounded bg-slate-50 p-2 dark:bg-ink-800"><div className="text-[10px] font-semibold uppercase text-slate-500">Source says (fact)</div>{r.obligation}</div>}
              {r.interpretation && <div className="rounded bg-blue-50 p-2 dark:bg-blue-500/10"><div className="text-[10px] font-semibold uppercase text-slate-500">Our interpretation</div>{r.interpretation}</div>}
            </div>}
            {r.flags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{r.flags.map((f) => <span key={f} className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{f}</span>)}</div>}
          </div>))}</div>
      )}
    </>
  )
}
