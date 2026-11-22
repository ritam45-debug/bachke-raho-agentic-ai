import { useState } from 'react'
import { Download, Plus, Search, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/useApi'
import { dateTime, saveTextFile, titleCase } from '../../lib/format'
import { Badge, Empty, ErrorBox, PageHeader } from '../../components/ui'

interface Entry { id: string; title: string; body: string; kind: string; tags: string[]; related: string | null; created_by: string | null; created_at: string }
const KINDS = ['incident', 'lesson', 'decision', 'playbook', 'note']
const BLANK = { title: '', body: '', kind: 'lesson', tags: '', related: '' }

export default function MemoryPage() {
  const { can, me } = useAuth()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [applied, setApplied] = useState('')
  const params = new URLSearchParams(); if (applied) params.set('q', applied); if (kind) params.set('kind', kind)
  const list = useApi<Entry[]>(`/memory${params.toString() ? `?${params}` : ''}`)
  const [form, setForm] = useState<typeof BLANK | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    if (!form) return
    setErr(null)
    try {
      await api('/memory', { method: 'POST', json: { ...form, related: form.related || null, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) } })
      setForm(null); void list.reload()
    } catch (e) { setErr((e as Error).message) }
  }
  const exportAll = async () => {
    const d = await api<unknown>('/memory/export')
    await saveTextFile(`organisational-memory-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(d, null, 2))
  }

  return (
    <>
      <PageHeader title="Organisational Memory" subtitle="What the company learned from past disruptions, decisions and playbooks, searchable by everyone so the next decision starts from experience."
        actions={<div className="flex gap-2">
          {can('company:update') && <button className="btn-ghost" onClick={exportAll}><Download size={15} />Export</button>}
          {can('memory:write') && !form && <button className="btn-primary" onClick={() => setForm({ ...BLANK })}><Plus size={15} />Add entry</button>}
        </div>} />
      {form && (
        <div className="card mb-4 space-y-3 p-5">
          <div className="grid gap-3 md:grid-cols-[1fr_180px]">
            <div><label className="label">Title</label><input className="input" value={form.title} placeholder="e.g. Chennai port congestion, Dec 2025" onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><label className="label">Type</label><select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}</select></div>
          </div>
          <div><label className="label">What happened, what was done, what we learned</label><textarea rows={5} className="input" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></div>
          <div className="grid gap-3 md:grid-cols-2">
            <div><label className="label">Tags (comma separated)</label><input className="input" value={form.tags} placeholder="port, chennai, sea freight" onChange={(e) => setForm({ ...form, tags: e.target.value })} /></div>
            <div><label className="label">Related to</label><input className="input" value={form.related} placeholder="supplier, route, PO or shipment reference" onChange={(e) => setForm({ ...form, related: e.target.value })} /></div>
          </div>
          <p className="text-[11px] text-slate-500">Do not paste personal data, contract secrets or passwords here: every user in your company can read memory entries.</p>
          {err && <ErrorBox message={err} />}
          <div className="flex gap-2"><button className="btn-primary" onClick={save}>Save</button><button className="btn-ghost" onClick={() => setForm(null)}>Cancel</button></div>
        </div>)}
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()) }}>
        <div className="relative min-w-60 flex-1"><Search size={15} className="absolute left-3 top-2.5 text-slate-400" /><input className="input !pl-9" placeholder="Search titles, text, tags…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input !w-auto" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All types</option>{KINDS.map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}</select>
        <button className="btn-ghost" type="submit">Search</button>
        {applied && <button className="btn-ghost" type="button" onClick={() => { setQ(''); setApplied('') }}>Clear</button>}
      </form>
      {list.error ? <ErrorBox message={list.error} /> : !list.data?.length ? <Empty>{applied || kind ? 'No entries match.' : 'No entries yet. Record the first lesson from a past disruption or decision.'}</Empty> : (
        <div className="space-y-2">{list.data.map((m) => (
          <article key={m.id} className="card p-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{m.title}</h3><Badge value={m.kind} tone={m.kind === 'incident' ? 'red' : m.kind === 'decision' ? 'blue' : m.kind === 'lesson' ? 'green' : 'slate'} /></div>
                <div className="text-xs text-slate-500">{dateTime(m.created_at)}{m.related ? ` · ${m.related}` : ''}</div>
              </div>
              {can('memory:write') && (m.created_by === me?.id || can('company:update')) && <button aria-label="Delete entry" className="p-1 text-slate-400 hover:text-red-500" onClick={async () => { await api(`/memory/${m.id}`, { method: 'DELETE' }); void list.reload() }}><Trash2 size={14} /></button>}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{m.body}</p>
            {m.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{m.tags.map((t) => <button key={t} onClick={() => { setQ(t); setApplied(t) }} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] hover:bg-signal/20 dark:bg-ink-800">#{t}</button>)}</div>}
          </article>))}</div>
      )}
    </>
  )
}
