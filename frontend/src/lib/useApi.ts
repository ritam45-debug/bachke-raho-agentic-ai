import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!path)
  // Only the latest request may update state, so a slow response for an old path never overwrites newer data.
  // A reload() captured before the path changed fetches the current path, not the old one.
  const seq = useRef(0)
  const current = useRef(path)
  useEffect(() => { current.current = path }, [path])

  const reload = useCallback(async () => {
    const p = current.current
    if (!p) return
    const mine = ++seq.current
    setLoading(true)
    setError(null)
    try { const d = await api<T>(p); if (mine === seq.current) setData(d) }
    catch (e) { if (mine === seq.current) setError((e as Error).message) }
    finally { if (mine === seq.current) setLoading(false) }
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps -- a new path must produce a new reload so the effect below refetches

  useEffect(() => { void reload() }, [reload])
  return { data, error, loading, reload }
}
