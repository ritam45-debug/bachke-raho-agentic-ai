import type { ReactNode } from 'react'
import { FlaskConical, Hammer, Loader2, TriangleAlert } from 'lucide-react'
import { titleCase } from '../lib/format'

export function Logo({ size = 36, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
        <path d="M32 4 8 13v17c0 15 10 26 24 30 14-4 24-15 24-30V13z" className="fill-ink-900 dark:fill-ink-800" />
        <path d="M32 10 14 17v13c0 11 7 20 18 24 11-4 18-13 18-24V17z" fill="none" stroke="#f5a524" strokeWidth="3" />
        <path d="M20 38l8-9 6 5 10-12" fill="none" stroke="#2dd4bf" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="44" cy="22" r="3.5" fill="#f5a524" />
      </svg>
      {withText && (
        <div className="leading-tight">
          <div className="font-display text-[15px] font-bold tracking-tight">BAchke Raho <span className="text-signal">Agnetic AI</span></div>
          <div className="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Predict · Prevent · Protect</div>
        </div>
      )}
    </div>
  )
}

const TONE: Record<string, string> = {
  red: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
}

const STATUS_TONE: Record<string, string> = {
  stockout: 'red', critical: 'red', reorder: 'amber', healthy: 'green', excess: 'blue',
  delayed: 'red', in_transit: 'blue', planned: 'slate', delivered: 'green', cancelled: 'slate',
  active: 'red', monitoring: 'amber', resolved: 'green', simulated: 'violet', verified: 'green', unverified: 'amber',
  success: 'green', failure: 'red', denied: 'amber',
}

export function Badge({ value, tone }: { value: string; tone?: string }) {
  const t = TONE[tone ?? STATUS_TONE[value] ?? 'slate']
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${t}`}>{titleCase(value)}</span>
}

export function SeverityPill({ score }: { score: number }) {
  const tone = score >= 75 ? 'red' : score >= 50 ? 'amber' : score >= 25 ? 'blue' : 'green'
  const band = score >= 75 ? 'High' : score >= 50 ? 'Elevated' : score >= 25 ? 'Moderate' : 'Low'
  return <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ${TONE[tone]}`}><span className="num">{score}</span>{band}</span>
}

export function SimulatedBanner() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-xs text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200">
      <FlaskConical size={15} className="mt-0.5 shrink-0" />
      <span><b>Simulated data.</b> This is the fictional Aureon Electronics demo workspace. Companies, suppliers, shipments and events are invented and nothing here is real-time.</span>
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'risk' | 'warn' | 'ok' }) {
  const bar = tone === 'risk' ? 'bg-red-500' : tone === 'warn' ? 'bg-signal' : tone === 'ok' ? 'bg-calm' : 'bg-slate-300 dark:bg-ink-700'
  return (
    <div className="card relative overflow-hidden p-4">
      <div className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="num mt-2 text-2xl font-medium">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  )
}

export function Loading() {
  return <div className="flex items-center gap-2 p-8 text-sm text-slate-500"><Loader2 className="animate-spin" size={16} /> Loading…</div>
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"><TriangleAlert size={16} />{message}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-ink-700">{children}</div>
}

export function PhasePanel({ phase, title, items }: { phase: number; title: string; items: string[] }) {
  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 text-sm font-semibold text-signal"><Hammer size={16} /> Arrives in Phase {phase}</div>
      <h2 className="mt-2 font-display text-lg font-bold">{title}</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">This section is not built yet. Nothing here is clickable on purpose — no placeholder buttons. Planned capabilities:</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((i) => <li key={i} className="flex gap-2 text-sm"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-calm" />{i}</li>)}
      </ul>
    </div>
  )
}

export interface Col<T> { key: string; label: string; render?: (row: T) => ReactNode; align?: 'right' }

export function Table<T extends Record<string, unknown>>({ rows, cols, empty = 'No records yet.' }: { rows: T[]; cols: Col<T>[]; empty?: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-ink-700 dark:text-slate-400">
            {cols.map((c) => <th key={c.key} className={`px-3 py-2.5 font-medium ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={(r.id as string) ?? i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-ink-800 dark:hover:bg-ink-800/50">
              {cols.map((c) => (
                <td key={c.key} className={`px-3 py-2.5 align-top ${c.align === 'right' ? 'num text-right' : ''}`}>
                  {c.render ? c.render(r) : String(r[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
