// Thin API client. Access token lives in memory only; the rotating refresh token is kept in
// sessionStorage so a reload keeps you signed in for this tab. (Phase 7 moves it to an httpOnly cookie.)
import { previewFetch } from '../preview/backend'

const BASE = (import.meta.env.VITE_API_BASE ?? '') + '/api/v1'
export const PREVIEW = import.meta.env.VITE_PREVIEW === '1'
// In the claude.ai preview build, requests go to an in-browser port of the API instead of the network.
const doFetch: typeof fetch = PREVIEW ? ((i, init) => previewFetch(String(i), init)) : ((i, init) => fetch(i, init))
const RT_KEY = 'bra.rt'

let accessToken: string | null = null
let refreshing: Promise<boolean> | null = null

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface TokenPair { access_token: string; refresh_token: string; expires_in: number }

export function setTokens(t: TokenPair | null) {
  accessToken = t?.access_token ?? null
  try {
    if (t) sessionStorage.setItem(RT_KEY, t.refresh_token)
    else sessionStorage.removeItem(RT_KEY)
  } catch { /* storage unavailable */ }
}

export function hasRefreshToken() {
  try { return !!sessionStorage.getItem(RT_KEY) } catch { return false }
}

async function tryRefresh(): Promise<boolean> {
  let rt: string | null = null
  try { rt = sessionStorage.getItem(RT_KEY) } catch { /* ignore */ }
  if (!rt) return false
  refreshing ??= (async () => {
    const r = await doFetch(`${BASE}/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }),
    })
    if (!r.ok) { setTokens(null); return false }
    setTokens(await r.json())
    return true
  })().finally(() => { refreshing = null })
  return refreshing
}

function messageFrom(body: unknown, fallback: string): string {
  const d = (body as { detail?: unknown })?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((e: { loc?: string[]; msg?: string }) => `${e.loc?.slice(-1)[0] ?? ''}: ${e.msg ?? ''}`.replace(/^: /, '')).join(' · ')
  return fallback
}

export async function api<T>(path: string, opts: RequestInit & { json?: unknown } = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
  const r = await doFetch(`${BASE}${path}`, { ...opts, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body })
  if (r.status === 401 && retry && !path.startsWith('/auth/login') && (await tryRefresh())) {
    return api<T>(path, opts, false)
  }
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new ApiError(r.status, messageFrom(body, `Request failed (${r.status})`))
  }
  if (r.status === 204) return undefined as T
  const ct = r.headers.get('content-type') ?? ''
  return (ct.includes('application/json') ? r.json() : r.text()) as Promise<T>
}

export async function restoreSession(): Promise<boolean> {
  return accessToken ? true : tryRefresh()
}
