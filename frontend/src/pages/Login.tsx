import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ErrorBox, Logo } from '../components/ui'

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try { await login(email, password); nav('/app') } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 block"><Logo /></Link>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <h1 className="font-display text-xl font-bold">Company login</h1>
          {err && <ErrorBox message={err} />}
          <div><label className="label" htmlFor="email">Work email</label>
            <input id="email" type="email" autoComplete="username" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label className="label" htmlFor="pw">Password</label>
            <input id="pw" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="text-xs text-slate-500">After 5 failed attempts the account is locked for 15 minutes.</p>
        </form>
        <div className="mt-4 flex justify-between text-sm">
          <Link to="/register" className="text-signal hover:underline">Register a company</Link>
        </div>
      </div>
    </div>
  )
}
