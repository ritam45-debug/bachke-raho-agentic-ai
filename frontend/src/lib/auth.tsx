import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, hasRefreshToken, restoreSession, setTokens, type TokenPair } from './api'

export interface Me {
  id: string; email: string; full_name: string; job_title: string | null; role: string
  permissions: string[]; company_id: string | null; company_name: string | null; is_demo: boolean
}

interface AuthState {
  me: Me | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (body: unknown) => Promise<void>
  logout: () => Promise<void>
  can: (perm: string) => boolean
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const loadMe = useCallback(async () => setMe(await api<Me>('/auth/me')), [])

  useEffect(() => {
    (async () => {
      try { if (hasRefreshToken() && (await restoreSession())) await loadMe() } catch { setTokens(null) }
      setLoading(false)
    })()
  }, [loadMe])

  const withTokens = async (p: Promise<TokenPair>) => { setTokens(await p); await loadMe() }

  const value: AuthState = {
    me, loading,
    login: (email, password) => withTokens(api('/auth/login', { method: 'POST', json: { email, password } })),
    register: (body) => withTokens(api('/auth/register-company', { method: 'POST', json: body })),
    logout: async () => {
      try { await api('/auth/logout', { method: 'POST' }) } catch { /* session may already be gone */ }
      setTokens(null); setMe(null)
    },
    can: (perm) => !!me?.permissions.includes(perm),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
