import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, FlaskConical, Lock, Radar, ShieldCheck, Workflow } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Logo } from '../components/ui'
import { ThemeToggle } from '../components/AppLayout'

const QUESTIONS = [
  'What is happening in our supply chain right now?',
  'What could go wrong next?',
  'How would it hit inventory, logistics, vendors and cash?',
  'What is the best corrective action?',
  'Can it be executed — with approval — before losses land?',
]

const PILLARS = [
  { icon: Radar, title: 'Predict', text: 'Disruption, shipment, inventory and vendor signals scored on a transparent 0–100 scale, with evidence.' },
  { icon: Workflow, title: 'Prevent', text: 'Specialised agents hand findings to each other and an orchestrator assembles a costed mitigation plan.' },
  { icon: ShieldCheck, title: 'Protect', text: 'High-impact actions wait for an authorised human. Every decision is written to an append-only audit trail.' },
]

export default function Landing() {
  const { demo, me } = useAuth()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const openDemo = async () => {
    setBusy(true); setErr(null)
    try { await demo(); nav('/app') } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {me ? (
            <Link to="/app" className="btn-primary">Open your workspace <ArrowRight size={16} /></Link>
          ) : (
            <>
              <Link to="/login" className="btn-ghost">Company login</Link>
              <Link to="/register" className="btn-primary hidden sm:inline-flex">Register company</Link>
            </>
          )}
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-10 lg:grid-cols-[1.15fr_1fr] lg:pt-16">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-xs font-medium dark:border-ink-700">
            <span className="h-1.5 w-1.5 rounded-full bg-calm" /> Multi-agent supply chain intelligence
          </div>
          <h1 className="mt-5 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            See the disruption<br />before it becomes<br /><span className="text-signal">a loss.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-600 dark:text-slate-300">
            BAchke Raho Agnetic AI watches suppliers, shipments, inventory and world events for your company,
            works out what each risk would cost, and proposes the fix — for a human to approve.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={openDemo} disabled={busy} className="btn-primary !px-5 !py-3 text-base">
              <FlaskConical size={18} /> {busy ? 'Opening…' : 'Open demo workspace'}
            </button>
            <Link to="/register" className="btn-ghost !px-5 !py-3 text-base">Register your company <ArrowRight size={18} /></Link>
          </div>
          {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
          <p className="mt-3 text-xs text-slate-500">The demo uses a fictional company (Aureon Electronics) with clearly labelled simulated data.</p>
        </div>

        <div className="card self-start p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Five questions it answers</div>
          <ol className="mt-4 space-y-3">
            {QUESTIONS.map((q, i) => (
              <li key={q} className="flex gap-3">
                <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink-900 text-xs text-signal dark:bg-ink-800">{i + 1}</span>
                <span className="pt-0.5 text-sm">{q}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-white py-14 dark:border-ink-800 dark:bg-ink-900/40">
        <div className="mx-auto grid max-w-6xl gap-5 px-5 md:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.title}>
              <p.icon className="text-signal" size={26} />
              <h3 className="mt-3 font-display text-xl font-bold">{p.title}</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{p.text}</p>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-10 flex max-w-6xl flex-wrap gap-x-8 gap-y-2 px-5 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><Lock size={13} /> Per-company isolated workspaces</span>
          <span className="flex items-center gap-1.5"><Eye size={13} /> Simulated data is always labelled</span>
          <span className="flex items-center gap-1.5"><ShieldCheck size={13} /> Your data goes to an external AI only after you opt in</span>
        </div>
      </section>
    </div>
  )
}
