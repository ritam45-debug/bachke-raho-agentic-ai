import { useState } from 'react'
import { Info, RotateCcw, X } from 'lucide-react'
import { resetPreview } from './backend'

/** Persistent notice that this build runs its backend inside the browser (claude.ai preview). */
export default function PreviewRibbon() {
  const [open, setOpen] = useState(true)
  const [confirm, setConfirm] = useState(false)
  if (!open) return (
    <button onClick={() => setOpen(true)} className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5 rounded-full bg-ink-900 px-3 py-1.5 text-xs font-semibold text-signal shadow-lg ring-1 ring-ink-700">
      <Info size={13} /> Preview mode
    </button>
  )
  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-xl bg-ink-900 p-3 text-xs text-slate-200 shadow-2xl ring-1 ring-ink-700 sm:flex sm:items-center sm:gap-3">
      <Info size={16} className="hidden shrink-0 text-signal sm:block" />
      <p className="flex-1">
        <b className="text-signal">Browser preview.</b> The API runs inside this page (a TypeScript port of the FastAPI backend), and everything you create is
        stored only in this browser. It shows how the product works; it is not the secure deployment. Production uses the Python API with PostgreSQL row-level security.
      </p>
      <div className="mt-2 flex shrink-0 gap-2 sm:mt-0">
        {confirm
          ? <button className="rounded-md bg-red-500/90 px-2.5 py-1.5 font-semibold text-white" onClick={() => { resetPreview(); location.reload() }}>Confirm reset</button>
          : <button className="flex items-center gap-1 rounded-md px-2.5 py-1.5 ring-1 ring-ink-700 hover:bg-ink-800" onClick={() => setConfirm(true)}><RotateCcw size={13} /> Reset data</button>}
        <button className="rounded-md p-1.5 hover:bg-ink-800" aria-label="Hide notice" onClick={() => { setOpen(false); setConfirm(false) }}><X size={14} /></button>
      </div>
    </div>
  )
}
