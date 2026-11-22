import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { api } from '../lib/api'
import { dateTime } from '../lib/format'

interface N { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

export default function NotificationBell() {
  const [data, setData] = useState<{ unread: number; items: N[] }>({ unread: 0, items: [] })
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  const load = () => api<{ unread: number; items: N[] }>('/notifications').then(setData).catch(() => undefined)
  useEffect(() => { void load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const openItem = async (n: N) => { if (!n.read_at) await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined); setOpen(false); void load(); if (n.link) nav(n.link) }
  return (
    <div className="relative" ref={ref}>
      <button aria-label={`Notifications (${data.unread} unread)`} className="relative rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-ink-800" onClick={() => { setOpen(!open); void load() }}>
        <Bell size={18} />
        {data.unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm font-semibold dark:border-ink-800">Notifications
            {data.unread > 0 && <button className="text-xs font-normal text-signal hover:underline" onClick={async () => { await api('/notifications/read-all', { method: 'POST' }); void load() }}>Mark all read</button>}</div>
          <ul className="max-h-96 overflow-y-auto">{!data.items.length ? <li className="p-4 text-sm text-slate-500">Nothing yet.</li> : data.items.map((n) => (
            <li key={n.id}><button onClick={() => openItem(n)} className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-ink-800 ${n.read_at ? 'text-slate-500' : 'font-medium'}`}>
              {n.title}{n.body && <div className="truncate text-xs font-normal text-slate-500">{n.body}</div>}<div className="text-[10px] font-normal text-slate-400">{dateTime(n.created_at)}</div></button></li>))}</ul>
        </div>)}
    </div>
  )
}
