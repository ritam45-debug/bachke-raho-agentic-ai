import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/useApi'
import { dateTime, money, titleCase } from '../../lib/format'
import RequestApproval from '../../components/RequestApproval'
import { Badge, Empty, ErrorBox, Kpi, Loading, PageHeader } from '../../components/ui'

interface Appr { id: string; title: string; action_type: string; details: string; justification: string | null; estimated_cost: number | null; source: string | null; source_ref: string | null
  status: string; requested_by: string | null; requested_by_name: string | null; decided_by_name: string | null; decided_at: string | null; decision_note: string | null; outcome: string | null; outcome_at: string | null; created_at: string }

function Card({ a, reload }: { a: Appr; reload: () => void }) {
  const { can, me } = useAuth()
  const [note, setNote] = useState('')
  const [outcome, setOutcome] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const act = async (path: string, json?: unknown) => { setErr(null); try { await api(`/approvals/${a.id}/${path}`, { method: 'POST', json }); reload() } catch (e) { setErr((e as Error).message) } }
  const mine = a.requested_by === me?.id
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{a.title}</span><Badge value={a.status} /><Badge value={a.action_type} tone="slate" /></div>
          <div className="mt-0.5 text-xs text-slate-500">Requested by {a.requested_by_name ?? 'former user'} · {dateTime(a.created_at)}{a.source && a.source !== 'manual' ? ` · from ${titleCase(a.source)}${a.source_ref ? ` (${a.source_ref})` : ''}` : ''}</div>
        </div>
        {a.estimated_cost != null && <div className="num text-sm font-semibold">{money(a.estimated_cost)}</div>}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{a.details}</p>
      {a.justification && <p className="mt-1 text-sm text-slate-500"><b>Why:</b> {a.justification}</p>}
      {a.decided_by_name && <p className="mt-2 text-sm"><b>{titleCase(a.status)}</b> by {a.decided_by_name} · {dateTime(a.decided_at)}{a.decision_note ? `: “${a.decision_note}”` : ''}</p>}
      {a.outcome && <p className="mt-1 rounded bg-emerald-50 p-2 text-sm dark:bg-emerald-500/10"><b>Outcome</b> ({dateTime(a.outcome_at)}): {a.outcome}</p>}
      {a.status === 'pending' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {can('approvals:high_impact') && !mine && <>
            <input className="input !w-72" placeholder="Decision note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn-primary !py-1.5" onClick={() => act('decision', { decision: 'approved', note: note || null })}><Check size={14} />Approve</button>
            <button className="btn-ghost !py-1.5" onClick={() => act('decision', { decision: 'rejected', note: note || null })}><X size={14} />Reject</button>
          </>}
          {mine && <><span className="text-xs text-slate-500">Waiting for another approver.</span><button className="btn-ghost !py-1 text-xs" onClick={() => act('cancel')}>Cancel request</button></>}
          {!mine && !can('approvals:high_impact') && <span className="text-xs text-slate-500">Waiting for an approver.</span>}
        </div>)}
      {a.status === 'approved' && !a.outcome && (mine || can('approvals:high_impact')) && (
        <div className="mt-3 flex gap-2"><input className="input" placeholder="What happened after the action? (outcome monitoring)" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          <button className="btn-ghost whitespace-nowrap" disabled={outcome.trim().length < 3} onClick={() => act('outcome', { outcome })}>Record outcome</button></div>)}
      {err && <div className="mt-2"><ErrorBox message={err} /></div>}
    </div>
  )
}

export default function ApprovalsPage() {
  const [tab, setTab] = useState<'pending' | 'all'>('pending')
  const list = useApi<Appr[]>(tab === 'pending' ? '/approvals?status=pending' : '/approvals')
  const all = useApi<Appr[]>('/approvals')
  const rows = all.data ?? []
  if (list.loading && !list.data) return <Loading />
  if (list.error) return <ErrorBox message={list.error} />
  const reload = () => { void list.reload(); void all.reload() }
  return (
    <>
      <PageHeader title="Approvals" subtitle="High-impact actions (expediting, supplier switches, reroutes, extra spend) need a human decision from an approver who did not raise the request." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Pending" value={rows.filter((a) => a.status === 'pending').length} tone={rows.some((a) => a.status === 'pending') ? 'warn' : undefined} />
        <Kpi label="Approved" value={rows.filter((a) => a.status === 'approved').length} />
        <Kpi label="Rejected" value={rows.filter((a) => a.status === 'rejected').length} />
        <Kpi label="Awaiting outcome" value={rows.filter((a) => a.status === 'approved' && !a.outcome).length} hint="approved, result not yet recorded" />
      </div>
      <div className="my-4"><RequestApproval source="manual" title="" details="" action="other" label="New approval request" onDone={() => { void list.reload(); void all.reload() }} /></div>
      <div className="mb-3 flex w-fit gap-1 rounded-lg bg-slate-100 p-0.5 text-sm dark:bg-ink-800">
        {(['pending', 'all'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-md px-4 py-1.5 ${tab === t ? 'bg-white font-semibold shadow dark:bg-ink-700' : ''}`}>{t === 'pending' ? 'Pending' : 'All requests'}</button>)}
      </div>
      {!list.data?.length ? <Empty>{tab === 'pending' ? 'No pending requests.' : 'No requests yet. Raise one here, or from a risky route on the Route & Risk Map.'}</Empty>
        : <div className="space-y-2">{list.data.map((a) => <Card key={a.id} a={a} reload={reload} />)}</div>}
    </>
  )
}
