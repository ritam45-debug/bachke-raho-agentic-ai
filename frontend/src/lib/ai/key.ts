// The user's own Anthropic key. Stored only in this browser (session by default, or this device if they choose),
// sent only to api.anthropic.com, never to this app's backend or audit log.
const K = 'bra.anthropic_key', M = 'bra.ai_model'

export function getKey(): string | null {
  try { return sessionStorage.getItem(K) ?? localStorage.getItem(K) } catch { return null }
}
export function keyRemembered(): boolean { try { return !!localStorage.getItem(K) } catch { return false } }
export function setKey(key: string, remember: boolean) {
  try {
    clearKey()
    ;(remember ? localStorage : sessionStorage).setItem(K, key.trim())
  } catch { /* storage unavailable: key lives only in memory for this page */ memoryKey = key.trim() }
}
export function clearKey() { try { sessionStorage.removeItem(K); localStorage.removeItem(K) } catch { /* ignore */ } memoryKey = null }
let memoryKey: string | null = null
export const currentKey = () => getKey() ?? memoryKey
export const maskKey = (k: string) => (k.length > 12 ? `${k.slice(0, 7)}…${k.slice(-4)}` : '••••')

export function getModel(): string { try { return localStorage.getItem(M) ?? 'claude-sonnet-5-5' } catch { return 'claude-sonnet-5-5' } }
export function setModel(m: string) { try { localStorage.setItem(M, m) } catch { /* ignore */ } }
