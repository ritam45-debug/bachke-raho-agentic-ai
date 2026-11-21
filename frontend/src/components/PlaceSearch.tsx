import { useEffect, useRef, useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import { searchPlaces, type Place } from '../lib/liveData'

/** Search a city/port/place by name (Open-Meteo geocoding). Debounced; one request per pause in typing. */
export default function PlaceSearch({ onSelect, placeholder = 'Search a city, port or place…' }: { onSelect: (p: Place) => void; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Place[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    clearTimeout(timer.current)
    if (q.trim().length < 2) { setRes([]); return }
    timer.current = setTimeout(async () => {
      try { setErr(null); setRes(await searchPlaces(q)); setOpen(true) } catch (e) { setErr((e as Error).message); setRes([]) }
    }, 450)
    return () => clearTimeout(timer.current)
  }, [q])

  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-slate-400" />
      <input className="input !pl-9" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} />
      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
      {open && res.length > 0 && (
        <ul className="absolute z-[1000] mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-ink-700 dark:bg-ink-900">
          {res.map((p) => (
            <li key={`${p.latitude},${p.longitude}`}>
              <button type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-ink-800"
                onClick={() => { onSelect(p); setQ(''); setRes([]); setOpen(false) }}>
                <MapPin size={14} className="mt-0.5 shrink-0 text-signal" />
                <span>{p.name}<span className="block text-xs text-slate-500">{[p.admin1, p.country].filter(Boolean).join(', ')} · {p.latitude.toFixed(2)}, {p.longitude.toFixed(2)}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
