import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ErrorBox, Logo } from '../components/ui'

const SIZES = ['1-50', '51-200', '201-1000', '1001-5000', '5000+']
const KINDS = ['manufacturing', 'warehouse', 'distribution']
type Loc = { name: string; kind: string; city: string; country: string }

export default function Register() {
  const { register } = useAuth()
  const nav = useNavigate()
  const [step, setStep] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({
    company_name: '', industry: '', company_size: '51-200', headquarters: '', country: 'India',
    registration_number: '', categories: '', admin_full_name: '', admin_email: '', admin_job_title: '',
    admin_phone: '', password: '', confirm: '', accept_terms: false,
  })
  const [locs, setLocs] = useState<Loc[]>([{ name: '', kind: 'manufacturing', city: '', country: 'India' }])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const pwIssues = [
    f.password.length < 12 && '12+ characters', !/[A-Za-z]/.test(f.password) && 'a letter',
    !/\d/.test(f.password) && 'a digit', !/[^A-Za-z0-9]/.test(f.password) && 'a symbol',
  ].filter(Boolean) as string[]

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (step < 2) { setStep(step + 1); return }
    if (pwIssues.length) { setErr(`Password needs ${pwIssues.join(', ')}`); return }
    if (f.password !== f.confirm) { setErr('Passwords do not match'); return }
    setBusy(true); setErr(null)
    try {
      await register({
        company_name: f.company_name, industry: f.industry, company_size: f.company_size, headquarters: f.headquarters,
        country: f.country || null, registration_number: f.registration_number || null,
        product_categories: f.categories.split(',').map((s) => s.trim()).filter(Boolean),
        locations: locs.filter((l) => l.name.trim()).map((l) => ({ ...l, city: l.city || null, country: l.country || null })),
        admin_full_name: f.admin_full_name, admin_email: f.admin_email, admin_job_title: f.admin_job_title || null,
        admin_phone: f.admin_phone || null, password: f.password, accept_terms: f.accept_terms,
      })
      nav('/app')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const steps = ['Company', 'Locations', 'Administrator']
  return (
    <div className="flex min-h-full items-start justify-center p-5 sm:items-center">
      <div className="w-full max-w-2xl">
        <Link to="/" className="mb-6 block"><Logo /></Link>
        <form onSubmit={submit} className="card p-6">
          <h1 className="font-display text-xl font-bold">Register your company</h1>
          <p className="mt-1 text-sm text-slate-500">Creates an isolated workspace. You become its Company Administrator.</p>
          <div className="mt-5 flex gap-2">
            {steps.map((s, i) => (
              <button type="button" key={s} onClick={() => i < step && setStep(i)}
                className={`flex-1 rounded-md border-b-2 pb-2 text-left text-xs font-semibold ${i === step ? 'border-signal' : i < step ? 'border-calm text-slate-500' : 'border-slate-200 text-slate-400 dark:border-ink-700'}`}>
                {i + 1}. {s}
              </button>
            ))}
          </div>
          <div className="mt-5">{err && <ErrorBox message={err} />}</div>

          {step === 0 && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label">Company name *</label><input required className="input" value={f.company_name} onChange={set('company_name')} /></div>
              <div><label className="label">Industry *</label><input required minLength={2} className="input" placeholder="e.g. Electronics manufacturing" value={f.industry} onChange={set('industry')} /></div>
              <div><label className="label">Company size *</label><select className="input" value={f.company_size} onChange={set('company_size')}>{SIZES.map((s) => <option key={s}>{s}</option>)}</select></div>
              <div><label className="label">Headquarters (city) *</label><input required minLength={2} className="input" value={f.headquarters} onChange={set('headquarters')} /></div>
              <div><label className="label">Country</label><input className="input" value={f.country} onChange={set('country')} /></div>
              <div><label className="label">Business registration no. (CIN/GSTIN)</label><input className="input" value={f.registration_number} onChange={set('registration_number')} /></div>
              <div><label className="label">Product categories (comma-separated)</label><input className="input" value={f.categories} onChange={set('categories')} /></div>
            </div>
          )}

          {step === 1 && (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-slate-500">Plants, warehouses and distribution centres. Headquarters is added automatically. You can add more later in Settings.</p>
              {locs.map((l, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
                  <input className="input" placeholder="Name, e.g. Plant 1 – Pune" value={l.name} onChange={(e) => setLocs(locs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <select className="input" value={l.kind} onChange={(e) => setLocs(locs.map((x, j) => j === i ? { ...x, kind: e.target.value } : x))}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
                  <input className="input" placeholder="City" value={l.city} onChange={(e) => setLocs(locs.map((x, j) => j === i ? { ...x, city: e.target.value } : x))} />
                  <input className="input" placeholder="Country" value={l.country} onChange={(e) => setLocs(locs.map((x, j) => j === i ? { ...x, country: e.target.value } : x))} />
                  <button type="button" className="btn-ghost !px-2" aria-label="Remove" onClick={() => setLocs(locs.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
                </div>
              ))}
              <button type="button" className="btn-ghost" onClick={() => setLocs([...locs, { name: '', kind: 'warehouse', city: '', country: 'India' }])}><Plus size={15} /> Add location</button>
            </div>
          )}

          {step === 2 && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div><label className="label">Full name *</label><input required minLength={2} className="input" value={f.admin_full_name} onChange={set('admin_full_name')} /></div>
              <div><label className="label">Job title</label><input className="input" value={f.admin_job_title} onChange={set('admin_job_title')} /></div>
              <div><label className="label">Work email *</label><input required type="email" autoComplete="username" className="input" value={f.admin_email} onChange={set('admin_email')} /></div>
              <div><label className="label">Phone</label><input className="input" value={f.admin_phone} onChange={set('admin_phone')} /></div>
              <div><label className="label">Password *</label><input required type="password" autoComplete="new-password" className="input" value={f.password} onChange={set('password')} />
                {f.password && pwIssues.length > 0 && <p className="mt-1 text-xs text-amber-600">Needs {pwIssues.join(', ')}</p>}</div>
              <div><label className="label">Confirm password *</label><input required type="password" autoComplete="new-password" className="input" value={f.confirm} onChange={set('confirm')} /></div>
              <label className="flex gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={f.accept_terms} onChange={(e) => setF({ ...f, accept_terms: e.target.checked })} required className="mt-1" />
                <span>I accept the terms and data-processing notice. Company data stays in this workspace and is not sent to any external AI provider unless an administrator enables it in Settings.</span>
              </label>
            </div>
          )}

          <div className="mt-6 flex justify-between">
            {step > 0 ? <button type="button" className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button> : <Link to="/login" className="btn-ghost">I have an account</Link>}
            <button className="btn-primary" disabled={busy}>{step < 2 ? 'Continue' : busy ? 'Creating workspace…' : 'Create workspace'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
