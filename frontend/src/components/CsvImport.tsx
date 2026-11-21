import { useState } from 'react'
import { Copy, FileUp, Loader2 } from 'lucide-react'
import { api } from '../lib/api'
import { searchPlaces } from '../lib/liveData'
import { ErrorBox } from './ui'

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false; else cell += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()))
  if (!head) return []
  const keys = head.map((h) => h.trim().toLowerCase())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

const TEMPLATES = {
  locations: 'name,kind,city,country,latitude,longitude\nPlant 1 – Chakan,manufacturing,Pune,India,,\nWH – Bhiwandi,warehouse,Bhiwandi,India,19.30,73.06\n',
  routes: 'name,mode,origin,destination\nChennai → Singapore,sea,Chennai,Singapore\nPune → Bhiwandi,road,Plant 1 – Chakan,WH – Bhiwandi\n',
}

interface SavedLoc { id: string; name: string; latitude: number | null; longitude: number | null }

/**
 * Paste or upload a CSV of locations or routes. Missing coordinates are filled by place search
 * (city + country for locations; place name for route ends that are not saved locations).
 * The server validates the whole file and saves all rows or none.
 */
export default function CsvImport({ kind, locations, onDone }: { kind: 'locations' | 'routes'; locations: SavedLoc[]; onDone: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const geocode = async (q: string) => { const [p] = await searchPlaces(q); return p ?? null }

  const run = async () => {
    setBusy(true); setMsg(null)
    try {
      const rows = parseCsv(text)
      if (!rows.length) throw new Error('No rows found. The first line must be the header.')
      if (rows.length > 500) throw new Error('Up to 500 rows per import.')
      if (kind === 'locations') {
        const out = []
        for (const [i, r] of rows.entries()) {
          let lat = r.latitude ? Number(r.latitude) : null, lon = r.longitude ? Number(r.longitude) : null
          if ((lat == null || lon == null) && (r.city || r.name)) {
            const p = await geocode([r.city || r.name, r.country].filter(Boolean).join(' '))
            if (p) { lat = p.latitude; lon = p.longitude }
          }
          if (!r.name) throw new Error(`Row ${i + 1}: name is required`)
          out.push({ name: r.name, kind: (r.kind || 'warehouse').toLowerCase(), city: r.city || null, country: r.country || null, latitude: lat, longitude: lon })
        }
        await api('/company/locations/bulk', { method: 'POST', json: { locations: out } })
        const unmapped = out.filter((x) => x.latitude == null).length
        setMsg({ ok: true, text: `Imported ${out.length} locations${unmapped ? ` (${unmapped} could not be placed on the map — add coordinates in Settings)` : ''}.` })
      } else {
        const byName = new Map(locations.map((l) => [l.name.toLowerCase(), l]))
        const end = async (v: string, i: number, side: string) => {
          const saved = byName.get(v.toLowerCase())
          if (saved) return { [`${side}_location_id`]: saved.id }
          const m = v.match(/^\s*(-?\d+(\.\d+)?)\s*[;|]\s*(-?\d+(\.\d+)?)\s*$/)
          if (m) return { [`${side}_label`]: v, [`${side}_lat`]: Number(m[1]), [`${side}_lon`]: Number(m[3]) }
          const p = await geocode(v)
          if (!p) throw new Error(`Row ${i + 1}: could not find "${v}" — use a saved location name, a place name, or "lat;lon"`)
          return { [`${side}_label`]: [p.name, p.country].filter(Boolean).join(', '), [`${side}_lat`]: p.latitude, [`${side}_lon`]: p.longitude }
        }
        const out = []
        for (const [i, r] of rows.entries()) {
          if (!r.name || !r.origin || !r.destination) throw new Error(`Row ${i + 1}: name, origin and destination are required`)
          out.push({ name: r.name, mode: (r.mode || 'road').toLowerCase(), ...(await end(r.origin, i, 'origin')), ...(await end(r.destination, i, 'destination')) })
        }
        await api('/routes/bulk', { method: 'POST', json: { routes: out } })
        setMsg({ ok: true, text: `Imported ${out.length} routes.` })
      }
      setText(''); onDone()
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>Columns: <code>{TEMPLATES[kind].split('\n')[0]}</code></span>
        <button type="button" className="flex items-center gap-1 text-signal hover:underline" onClick={() => setText(TEMPLATES[kind])}>Use example</button>
        <button type="button" className="flex items-center gap-1 hover:underline" onClick={async () => { try { await navigator.clipboard.writeText(TEMPLATES[kind]); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* blocked */ } }}>
          <Copy size={12} />{copied ? 'Copied' : 'Copy template'}
        </button>
        <label className="ml-auto flex cursor-pointer items-center gap-1 hover:underline"><FileUp size={13} />Choose .csv file
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = '' }} />
        </label>
      </div>
      <textarea rows={5} className="input font-mono text-xs" placeholder="Paste CSV here…" value={text} onChange={(e) => setText(e.target.value)} />
      {msg && (msg.ok ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{msg.text}</p> : <ErrorBox message={msg.text} />)}
      <button type="button" className="btn-primary" disabled={!text.trim() || busy} onClick={run}>
        {busy ? <><Loader2 size={15} className="animate-spin" />Importing…</> : `Import ${kind}`}
      </button>
      <p className="text-[11px] text-slate-500">All rows are saved together, or none are if any row is invalid. Missing coordinates are looked up by place name.</p>
    </div>
  )
}
