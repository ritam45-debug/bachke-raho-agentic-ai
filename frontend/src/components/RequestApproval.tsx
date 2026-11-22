import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ErrorBox } from './ui'

export const ACTIONS = ['expedite_shipment', 'switch_supplier', 'reroute', 'safety_stock_change', 'spend', 'other'] as const

/** Raises a human-approval request for a high-impact mitigation. Nothing is executed: the request is recorded,
 *  approvers are notified, and someone other than the requester must decide. */
export default function RequestApproval({ source, sourceRef, title, details, action = 'reroute', compact, label = 'Request mitigation approval', onDone }: {
  source: 'manual' | 'route_risk' | 'ai_agent' | 'vendor_scoring' | 'finance'; sourceRef?: string; title: string; details: string; action?: typeof ACTIONS[number]; compact?: boolean; label?: string; onDone?: () => void
}) {
  const { can } = useAuth()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ title, details, action_type: action as string, estimated_cost: '', justification: '' })
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!(can('ops:write') || can('procurement:write') || can('finance:write'))) return null
  if (done) return <p className="text-sm text-emerald-600">Approval requested. Approvers have been notified. <Link to="/app/approvals" className="underline">View request</Link></p>
  if (!open) return <button className={`btn-ghost ${compact ? '!py-1 text-xs' : ''}`} onClick={() => setOpen(true)}><ShieldCheck size={14} />{label}</button>
  const submit = async () => {
    setErr(null)
    try {
      await api('/approvals', { method: 'POST', json: { ...f, estimated_cost: f.estimated_cost === '' ? null : Number(f.estimated_cost), justification: f.justification || null, source, source_ref: sourceRef ?? null } })
      setDone(true); onDone?.()
    } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-ink-700">
      <div className="text-sm font-semibold">{label}</div>
      <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <select className="input" value={f.action_type} onChange={(e) => setF({ ...f, action_type: e.target.value })}>{ACTIONS.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}</select>
        <input className="input" type="number" min={0} placeholder="Estimated cost ₹" value={f.estimated_cost} onChange={(e) => setF({ ...f, estimated_cost: e.target.value })} />
      </div>
      <textarea rows={3} className="input text-xs" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} />
      <textarea rows={2} className="input text-xs" placeholder="Why is this worth doing? (optional)" value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} />
      {err && <ErrorBox message={err} />}
      <div className="flex gap-2"><button className="btn-primary !py-1.5 text-sm" onClick={submit}>Send for approval</button><button className="btn-ghost !py-1.5 text-sm" onClick={() => setOpen(false)}>Cancel</button></div>
      <p className="text-[11px] text-slate-500">Nothing is executed automatically. An approver other than you must decide, and the decision is audit-logged.</p>
    </div>
  )
}
