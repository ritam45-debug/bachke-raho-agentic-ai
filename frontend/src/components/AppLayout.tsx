import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, Bot, Boxes, BrainCircuit, Building2, ClipboardList, Gauge, Globe2, IndianRupee, LogOut,
  Menu, Moon, PackageSearch, Route, Scale, Ship, Smile, Sun, Truck, X,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { titleCase } from '../lib/format'
import { Logo, SimulatedBanner } from './ui'

export const SECTIONS = [
  { to: '/app', label: 'Executive Overview', icon: Gauge, end: true },
  { to: '/app/disruptions', label: 'Global Disruptions', icon: Globe2 },
  { to: '/app/inventory', label: 'Inventory Intelligence', icon: Boxes },
  { to: '/app/logistics', label: 'Logistics Analytics', icon: Route, phase: 3 },
  { to: '/app/shipments', label: 'Shipment Tracking', icon: Ship },
  { to: '/app/vendors', label: 'Vendor Performance', icon: Truck },
  { to: '/app/products', label: 'Product Lifecycle', icon: PackageSearch },
  { to: '/app/finance', label: 'Financial Intelligence', icon: IndianRupee, phase: 4 },
  { to: '/app/compliance', label: 'Legal & Compliance', icon: Scale, phase: 5 },
  { to: '/app/consumer', label: 'Consumer Intelligence', icon: Smile, phase: 5 },
  { to: '/app/memory', label: 'Organisational Memory', icon: BrainCircuit, phase: 5 },
  { to: '/app/consulting', label: 'AI Consulting Centre', icon: Bot, phase: 2 },
  { to: '/app/audit', label: 'Audit & Activity', icon: ClipboardList, perm: 'audit:read' },
  { to: '/app/settings', label: 'Company Settings', icon: Building2 },
]

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('theme', dark ? 'dark' : 'light') } catch { /* ignore */ }
  }, [dark])
  return [dark, () => setDark((d) => !d)] as const
}

export function ThemeToggle() {
  const [dark, toggle] = useTheme()
  return (
    <button onClick={toggle} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-ink-800" aria-label="Toggle theme" title="Toggle light/dark">
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}

export default function AppLayout() {
  const { me, logout, can } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [loc.pathname])

  const sidebar = (
    <nav className="flex h-full flex-col gap-0.5 overflow-y-auto p-3">
      <div className="mb-4 px-2 pt-1"><Logo /></div>
      {SECTIONS.filter((s) => !s.perm || can(s.perm)).map((s) => (
        <NavLink key={s.to} to={s.to} end={s.end}
          className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${isActive
            ? 'bg-ink-900 font-semibold text-white dark:bg-ink-800' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-800/60'}`}>
          <s.icon size={17} className="shrink-0" />
          <span className="flex-1 truncate">{s.label}</span>
          {s.phase && <span className="rounded bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-600 dark:bg-ink-700 dark:text-slate-300">P{s.phase}</span>}
        </NavLink>
      ))}
      <div className="mt-auto rounded-lg border border-slate-200 p-3 text-xs dark:border-ink-700">
        <div className="flex items-center gap-1.5 font-semibold"><Activity size={13} className="text-calm" /> Agent layer</div>
        <p className="mt-1 text-slate-500 dark:text-slate-400">Agents and the orchestrator switch on in Phase 2. Current figures are deterministic calculations on your data.</p>
      </div>
    </nav>
  )

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block dark:border-ink-800 dark:bg-ink-950">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white dark:bg-ink-950">
            <button className="absolute right-3 top-3 p-1" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-ink-800 dark:bg-ink-950/80">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{me?.company_name}</div>
            <div className="truncate text-xs text-slate-500 dark:text-slate-400">{me?.full_name} · {titleCase(me?.role ?? '')}</div>
          </div>
          <ThemeToggle />
          <button onClick={() => { nav('/'); void logout() }} className="btn-ghost !px-3" title="Sign out"><LogOut size={16} /><span className="hidden sm:inline">Sign out</span></button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {me?.is_demo && <div className="mb-4"><SimulatedBanner /></div>}
          <Outlet />
        </main>
      </div>
    </div>
  )
}
