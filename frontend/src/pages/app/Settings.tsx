import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2, UserPlus } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/useApi'
import { dateTime, titleCase } from '../../lib/format'
import { Badge, ErrorBox, Loading, PageHeader, Table } from '../../components/ui'
import PlaceSearch from '../../components/PlaceSearch'

interface Company {
  id: string; name: string; slug: string; industry: string; company_size: string; headquarters: string; country: string | null
  registration_number: string | null; is_demo: boolean; ai_external_processing: boolean; ai_monthly_budget_usd: number; data_retention_days: number
  description: string | null; product_categories: string[]; website: string | null; currency: string; created_at: string
  locations: { id: string; name: string; kind: string; city: string | null; country: string | null; latitude: number | null; longitude: number | null }[]
}
interface U { id: string; email: string; full_name: string; job_title: string | null; role: string; is_active: boolean; last_login_at: string | null }

function Section({ title, children, desc }: { title: string; desc?: string; children: React.ReactNode }) {
  return <section className="card p-5"><h2 className="font-display text-base font-bold">{title}</h2>{desc && <p className="mt-0.5 text-xs text-slate-500">{desc}</p>}<div className="mt-4">{children}</div></section>
}

export default function SettingsPage() {
  const { can, me } = useAuth()
  const { data: c, error, loading, reload } = useApi<Company>('/company')
  const editable = can('company:update') && !me?.is_demo
  const [form, setForm] = useState<Partial<Company>>({})
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [loc, setLoc] = useState<{ name: string; kind: string; city: string; country: string; latitude?: number; longitude?: number }>({ name: '', kind: 'warehouse', city: '', country: '' })
  useEffect(() => { if (c) setForm({ name: c.name, industry: c.industry, headquarters: c.headquarters, description: c.description ?? '', website: c.website ?? '', currency: c.currency, ai_external_processing: c.ai_external_processing, ai_monthly_budget_usd: c.ai_monthly_budget_usd, data_retention_days: c.data_retention_days }) }, [c])

  if (loading) return <Loading />
  if (error || !c) return <ErrorBox message={error ?? 'Not found'} />

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null)
    try { await fn(); setMsg({ ok: true, text: ok }); await reload() } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }
  const save = (e: FormEvent) => { e.preventDefault(); void run(() => api('/company', { method: 'PATCH', json: { ...form, website: form.website || null } }), 'Profile saved.') }

  return (
    <>
      <PageHeader title="Company Settings" subtitle={`Workspace ${c.slug} · created ${dateTime(c.created_at)}`} />
      {msg && <div className={`mb-4 rounded-lg p-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : ''}`}>{msg.ok ? msg.text : <ErrorBox message={msg.text} />}</div>}
      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Company profile" desc={editable ? 'Visible only to members of this workspace.' : 'Read-only for your role or in the demo workspace.'}>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            {(['name', 'industry', 'headquarters', 'website'] as const).map((k) => (
              <div key={k}><label className="label">{titleCase(k)}</label><input className="input" disabled={!editable} value={String(form[k] ?? '')} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
            ))}
            <div><label className="label">Currency (ISO)</label><input className="input" maxLength={3} disabled={!editable} value={form.currency ?? ''} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
            <div><label className="label">Data retention (days)</label><input type="number" min={30} max={3650} className="input" disabled={!editable} value={form.data_retention_days ?? 730} onChange={(e) => setForm({ ...form, data_retention_days: Number(e.target.value) })} /></div>
            <div><label className="label">AI budget per month (USD)</label><input type="number" min={0} step="0.5" className="input" disabled={!editable} value={form.ai_monthly_budget_usd ?? 10} onChange={(e) => setForm({ ...form, ai_monthly_budget_usd: Number(e.target.value) })} /></div>
            <div className="sm:col-span-2"><label className="label">Description</label><textarea rows={3} className="input" disabled={!editable} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <label className="flex gap-2 rounded-lg border border-slate-200 p-3 text-sm sm:col-span-2 dark:border-ink-700">
              <input type="checkbox" className="mt-1" disabled={!editable} checked={!!form.ai_external_processing} onChange={(e) => setForm({ ...form, ai_external_processing: e.target.checked })} />
              <span><b>Allow external AI processing.</b> When on, AI agents may send the records they read (routes, sites, risk checks) to the Anthropic Claude API for analysis, using each user's own key. Off by default. Every run is audit-logged and counted against the monthly AI budget.</span>
            </label>
            <div className="text-xs text-slate-500 sm:col-span-2">Size {c.company_size} · Registration {c.registration_number ?? '—'} · Categories: {c.product_categories.join(', ') || '—'}</div>
            {editable && <div className="sm:col-span-2"><button className="btn-primary">Save profile</button></div>}
          </form>
        </Section>

        <Section title="Locations" desc="Headquarters, plants, warehouses and distribution centres.">
          <div className="space-y-1.5">
            {c.locations.map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm dark:border-ink-800">
                <Badge value={l.kind} tone={l.kind === 'manufacturing' ? 'amber' : l.kind === 'headquarters' ? 'violet' : 'blue'} />
                <span className="flex-1">{l.name}</span><span className="text-xs text-slate-500">{[l.city, l.country].filter(Boolean).join(', ')}</span>
                {l.latitude != null ? <span className="text-[11px] text-calm" title={`${l.latitude}, ${l.longitude}`}>on map</span>
                  : editable ? <span className="w-44"><PlaceSearch placeholder="Place on map…" onSelect={(p) => run(() => api(`/company/locations/${l.id}`, { method: 'PATCH', json: { name: l.name, kind: l.kind, city: l.city ?? p.name, country: l.country ?? p.country ?? null, latitude: p.latitude, longitude: p.longitude } }), `${l.name} placed on the map.`)} /></span>
                  : <span className="text-[11px] text-amber-600">not on map</span>}
                {editable && <button aria-label="Delete location" className="p-1 text-slate-400 hover:text-red-500" onClick={() => run(() => api(`/company/locations/${l.id}`, { method: 'DELETE' }), 'Location removed.')}><Trash2 size={15} /></button>}
              </div>
            ))}
          </div>
          {editable && (<>
            <div className="mt-4"><PlaceSearch placeholder="Find the new location's place (fills city, country and map position)…" onSelect={(p) => setLoc((x) => ({ ...x, name: x.name || p.name, city: p.name, country: p.country ?? '', latitude: p.latitude, longitude: p.longitude }))} /></div>
            <form className="mt-2 grid gap-2 sm:grid-cols-[1.3fr_1.2fr_1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); void run(() => api('/company/locations', { method: 'POST', json: { ...loc, city: loc.city || null, country: loc.country || null, latitude: loc.latitude ?? null, longitude: loc.longitude ?? null } }), 'Location added.').then(() => setLoc({ name: '', kind: 'warehouse', city: '', country: '' })) }}>
              <input required minLength={2} className="input" placeholder="Name" value={loc.name} onChange={(e) => setLoc({ ...loc, name: e.target.value })} />
              <select className="input" value={loc.kind} onChange={(e) => setLoc({ ...loc, kind: e.target.value })}>{['manufacturing', 'warehouse', 'distribution', 'headquarters'].map((k) => <option key={k}>{k}</option>)}</select>
              <input className="input" placeholder="City" value={loc.city} onChange={(e) => setLoc({ ...loc, city: e.target.value })} />
              <input className="input" placeholder="Country" value={loc.country} onChange={(e) => setLoc({ ...loc, country: e.target.value })} />
              <button className="btn-ghost"><Plus size={15} />Add</button>
            </form>
          </>)}
        </Section>
      </div>
      {can('users:read') && <div className="mt-5"><Team editable={can('users:manage') && !me?.is_demo} selfId={me?.id ?? ''} /></div>}
    </>
  )
}

function Team({ editable, selfId }: { editable: boolean; selfId: string }) {
  const { data, error, loading, reload } = useApi<U[]>('/users')
  const { data: roles } = useApi<string[]>('/users/roles')
  const [nu, setNu] = useState({ email: '', full_name: '', job_title: '', role: 'analyst', temporary_password: '' })
  const [err, setErr] = useState<string | null>(null)
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await reload() } catch (e) { setErr((e as Error).message) } }

  return (
    <Section title="Team & roles" desc="Changing someone's role or deactivating them signs them out everywhere immediately.">
      {err && <div className="mb-3"><ErrorBox message={err} /></div>}
      {loading ? <Loading /> : error ? <ErrorBox message={error} /> : (
        <Table rows={(data ?? []) as unknown as Record<string, unknown>[]} cols={[
          { key: 'full_name', label: 'Name', render: (r) => <div><div className="font-medium">{String(r.full_name)}</div><div className="text-xs text-slate-500">{String(r.email)}</div></div> },
          { key: 'role', label: 'Role', render: (r) => editable && r.id !== selfId
            ? <select className="input !w-52 !py-1" value={String(r.role)} onChange={(e) => act(() => api(`/users/${r.id}`, { method: 'PATCH', json: { role: e.target.value } }))}>{(roles ?? []).map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</select>
            : titleCase(String(r.role)) },
          { key: 'last_login_at', label: 'Last login', render: (r) => dateTime(r.last_login_at as string) },
          { key: 'is_active', label: 'Status', render: (r) => editable && r.id !== selfId
            ? <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => act(() => api(`/users/${r.id}`, { method: 'PATCH', json: { is_active: !r.is_active } }))}>{r.is_active ? 'Deactivate' : 'Reactivate'}</button>
            : <Badge value={r.is_active ? 'active' : 'inactive'} tone={r.is_active ? 'green' : 'slate'} /> },
        ]} />
      )}
      {editable && (
        <form className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); void act(() => api('/users', { method: 'POST', json: { ...nu, job_title: nu.job_title || null } })).then(() => setNu({ email: '', full_name: '', job_title: '', role: 'analyst', temporary_password: '' })) }}>
          <input required className="input" placeholder="Full name" value={nu.full_name} onChange={(e) => setNu({ ...nu, full_name: e.target.value })} />
          <input required type="email" className="input" placeholder="Email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
          <input className="input" placeholder="Job title" value={nu.job_title} onChange={(e) => setNu({ ...nu, job_title: e.target.value })} />
          <select className="input" value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>{(roles ?? []).map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</select>
          <input required type="password" autoComplete="new-password" className="input" placeholder="Temporary password" value={nu.temporary_password} onChange={(e) => setNu({ ...nu, temporary_password: e.target.value })} />
          <button className="btn-primary"><UserPlus size={15} />Add</button>
        </form>
      )}
      {editable && <p className="mt-2 text-xs text-slate-500">Share the temporary password through a separate channel. In-app notifications are live; email invitations need an email provider, which is not connected.</p>}
    </Section>
  )
}
