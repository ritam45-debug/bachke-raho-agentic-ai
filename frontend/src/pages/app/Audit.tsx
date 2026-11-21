import { useState } from 'react'
import { Download } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { dateTime, saveTextFile, titleCase } from '../../lib/format'
import { Badge, ErrorBox, Loading, PageHeader, Table } from '../../components/ui'

const FILTERS = ['', 'auth.', 'company.', 'user.', 'location.', 'audit.', 'demo.']

export default function AuditPage() {
  const [action, setAction] = useState('')
  const path = `/audit-logs?limit=200${action ? `&action=${encodeURIComponent(action)}` : ''}`
  const { data, error, loading } = useApi<Record<string, unknown>[]>(path)

  const exportCsv = async () => {
    const csv = await api<string>(`/audit-logs/export${action ? `?action=${encodeURIComponent(action)}` : ''}`)
    await saveTextFile('audit-log.csv', csv)
  }

  return (
    <>
      <PageHeader title="Audit & Activity" subtitle="Append-only record of security and data events in this workspace. From Phase 2 every agent run, recommendation and approval is recorded here too." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="input !w-48" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Event type">
          {FILTERS.map((f) => <option key={f} value={f}>{f ? titleCase(f.replace('.', '')) + ' events' : 'All events'}</option>)}
        </select>
        <button className="btn-ghost ml-auto" onClick={exportCsv}><Download size={15} /> Export CSV</button>
      </div>
      {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
        <Table rows={data ?? []} cols={[
          { key: 'created_at', label: 'When', render: (r) => <span className="whitespace-nowrap text-xs">{dateTime(r.created_at as string)}</span> },
          { key: 'action', label: 'Action', render: (r) => <span className="num text-xs">{String(r.action)}</span> },
          { key: 'outcome', label: 'Outcome', render: (r) => <Badge value={String(r.outcome)} /> },
          { key: 'actor_type', label: 'Actor', render: (r) => titleCase(String(r.actor_type)) },
          { key: 'ip_address', label: 'IP', render: (r) => <span className="num text-xs">{String(r.ip_address ?? '—')}</span> },
          { key: 'details', label: 'Details', render: (r) => <code className="text-xs text-slate-500">{JSON.stringify(r.details)}</code> },
        ]} />
      )}
    </>
  )
}
