// Minimal Claude Messages API client for the browser (bring-your-own-key).
// The key is sent only to api.anthropic.com, never to this app's backend. Anthropic requires the
// `anthropic-dangerous-direct-browser-access` header for browser calls; the name is a reminder that a key in a
// browser is visible to that browser's user, which is acceptable here only because it is the user's own key.

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2023-06-01'

export type TextBlock = { type: 'text'; text: string }
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock
export interface Message { role: 'user' | 'assistant'; content: string | ContentBlock[] }
export interface ToolSchema { name: string; description: string; input_schema: Record<string, unknown> }
export interface Usage { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
export interface ClaudeResponse { id: string; content: ContentBlock[]; stop_reason: string; usage: Usage; model: string }

export class ClaudeError extends Error {
  status: number
  retryable: boolean
  constructor(status: number, message: string, retryable = false) { super(message); this.status = status; this.retryable = retryable }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529])
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function explain(status: number, body: { error?: { type?: string; message?: string } } | null): string {
  const msg = body?.error?.message ?? ''
  if (status === 401) return 'The Anthropic API key was rejected. Check it in "AI key" settings.'
  if (status === 403) return `Anthropic refused the request: ${msg || 'permission denied for this key.'}`
  if (status === 404) return `Model not available to this key: ${msg}`
  if (status === 429) return 'Anthropic rate limit reached for this key. Try again shortly.'
  if (status === 529) return 'Anthropic is temporarily overloaded. Try again shortly.'
  if (status === 400) return `Request rejected by Anthropic: ${msg}`
  return `Anthropic API error ${status}${msg ? `: ${msg}` : ''}`
}

export interface CallOptions {
  apiKey: string; model: string; system: string; messages: Message[]; tools?: ToolSchema[]; maxTokens?: number
  /** Called before each retry so the orchestrator can log it. */
  onRetry?: (attempt: number, status: number, waitMs: number) => void
  fetchImpl?: typeof fetch
  maxAttempts?: number
  baseDelayMs?: number
}

/** One Messages API call with bounded retries (exponential backoff, honours retry-after). */
export async function callClaude(o: CallOptions): Promise<ClaudeResponse> {
  const f = o.fetchImpl ?? fetch
  const attempts = o.maxAttempts ?? 3
  const body = {
    model: o.model, max_tokens: o.maxTokens ?? 1500,
    // Cache the long, unchanging system prompt so later calls in the same tool loop are cheaper.
    system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
    messages: o.messages,
    ...(o.tools?.length ? { tools: o.tools } : {}),
  }
  let last: ClaudeError | null = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res: Response
    try {
      res = await f(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json', 'x-api-key': o.apiKey, 'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      })
    } catch {
      last = new ClaudeError(0, 'Could not reach api.anthropic.com (network blocked or offline).', true)
      if (attempt < attempts) { const w = (o.baseDelayMs ?? 1000) * 2 ** (attempt - 1); o.onRetry?.(attempt, 0, w); await sleep(w); continue }
      throw last
    }
    if (res.ok) return (await res.json()) as ClaudeResponse
    const parsed = await res.json().catch(() => null)
    last = new ClaudeError(res.status, explain(res.status, parsed), RETRYABLE.has(res.status))
    if (!last.retryable || attempt === attempts) throw last
    const ra = Number(res.headers.get('retry-after'))
    const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 20000) : (o.baseDelayMs ?? 1000) * 2 ** (attempt - 1)
    o.onRetry?.(attempt, res.status, wait)
    await sleep(wait)
  }
  throw last ?? new ClaudeError(0, 'Unknown error')
}

/** A tiny request to confirm a key works (counts against the user's own account). */
export async function testKey(apiKey: string, model: string, fetchImpl?: typeof fetch): Promise<void> {
  await callClaude({ apiKey, model, system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], maxTokens: 5, fetchImpl, maxAttempts: 1 })
}
