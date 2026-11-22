// Central orchestrator (Phase 2). A small explicit state machine replaces LangGraph because the agents run in
// the browser on static hosting. It keeps the same responsibilities:
//   route → open run (server enforces consent + budget) → model/tool loop with limits → final answer → close run,
// logging every step to the server's append-only trace and retrying recoverable API errors.
import { api } from '../api'
import { callClaude, ClaudeError, type ContentBlock, type Message, type ToolResultBlock, type ToolUseBlock, type Usage } from './claude'
import { toolSchemas, wrapUntrusted } from './tools'
import { AGENTS, type AgentDef } from './agents/routeRisk'

export const LIMITS = { maxModelCalls: 8, maxToolCalls: 14, maxSameCall: 2, maxTokensPerCall: 1800 }

// Mirrors backend PRICES (USD per million tokens); the server recomputes the authoritative cost.
const PRICE: Record<string, [number, number]> = { 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] }
export const estimateCost = (model: string, u: Usage) => {
  const [i, o] = PRICE[model] ?? [0, 0]
  return ((u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)) * i + u.output_tokens * o) / 1e6
}

export interface Step { seq: number; kind: 'route' | 'model_call' | 'tool_call' | 'tool_result' | 'final' | 'error' | 'retry' | 'guard'; name?: string; payload: Record<string, unknown> }
export interface TurnResult { text: string; runId: string | null; status: 'completed' | 'failed' | 'stopped'; usage: { input: number; output: number; costUsd: number }; toolCalls: number; steps: Step[]; error?: string }
export interface TurnOptions {
  question: string; history: { role: 'user' | 'assistant'; content: string }[]; conversationId: string | null
  apiKey: string; model: string; company: string
  onStep?: (s: Step) => void
  fetchImpl?: typeof fetch
}

/** Routing decision. One specialist today; new agents register in AGENTS and get a rule here. */
export function routeQuestion(q: string): { agent: AgentDef; reason: string } {
  const agent = AGENTS.route_risk_analyst
  const hit = /(route|ship|port|weather|storm|cyclone|rain|wind|wave|earthquake|flood|risk|delay|forecast|site|plant|warehouse|lane|monsoon)/i.test(q)
  return { agent, reason: hit ? 'Question concerns routes, sites or weather risk' : 'Default specialist (only agent available in Phase 2)' }
}

export async function runTurn(o: TurnOptions): Promise<TurnResult> {
  const steps: Step[] = []
  const calls: { input_tokens: number; output_tokens: number }[] = []
  let seq = 0, toolCalls = 0, runId: string | null = null
  const usage = { input: 0, output: 0, costUsd: 0 }

  const log = async (kind: Step['kind'], name: string | undefined, payload: Record<string, unknown>) => {
    const s: Step = { seq: seq++, kind, name, payload }
    steps.push(s)
    o.onStep?.(s)
    if (runId) await api(`/ai/runs/${runId}/steps`, { method: 'POST', json: { seq: s.seq, kind, name: name ?? null, payload } }).catch(() => undefined)
  }
  const finish = async (status: TurnResult['status'], text: string, error?: string): Promise<TurnResult> => {
    if (runId) await api(`/ai/runs/${runId}/finish`, { method: 'POST', json: { status, calls, tool_calls: toolCalls, error: error?.slice(0, 500) ?? null } }).catch(() => undefined)
    return { text, runId, status, usage, toolCalls, steps, error }
  }

  // 1. Route
  const { agent, reason } = routeQuestion(o.question)
  // 2. Open the run. The server refuses if AI is switched off for the company or the monthly budget is spent.
  try {
    const run = await api<{ id: string; remaining_usd: number }>('/ai/runs', { method: 'POST', json: { conversation_id: o.conversationId, agent: agent.id, model: o.model, autonomy_level: agent.autonomy } })
    runId = run.id
  } catch (e) {
    return { text: '', runId: null, status: 'failed', usage, toolCalls: 0, steps, error: (e as Error).message }
  }
  await log('route', agent.id, { reason, autonomy_level: agent.autonomy, tools: agent.tools.map((t) => t.name), model: o.model })

  const system = agent.system({ company: o.company, today: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' })
  const messages: Message[] = [...o.history.slice(-10).map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: o.question }]
  const seen = new Map<string, number>()

  // 3. Model ⇄ tool loop
  for (let call = 1; call <= LIMITS.maxModelCalls; call++) {
    let res
    try {
      res = await callClaude({
        apiKey: o.apiKey, model: o.model, system, messages, tools: toolSchemas(agent.tools), maxTokens: LIMITS.maxTokensPerCall, fetchImpl: o.fetchImpl,
        onRetry: (attempt, status, waitMs) => { void log('retry', 'anthropic', { attempt, status, wait_ms: waitMs }) },
      })
    } catch (e) {
      const msg = e instanceof ClaudeError ? e.message : (e as Error).message
      await log('error', 'anthropic', { message: msg, status: e instanceof ClaudeError ? e.status : null })
      return finish('failed', '', msg)
    }
    calls.push({ input_tokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0), output_tokens: res.usage.output_tokens })
    usage.input += calls[calls.length - 1].input_tokens; usage.output += res.usage.output_tokens; usage.costUsd += estimateCost(o.model, res.usage)
    const uses = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
    await log('model_call', o.model, { call, stop_reason: res.stop_reason, usage: res.usage, tool_requests: uses.map((u) => u.name) })
    messages.push({ role: 'assistant', content: res.content })

    if (res.stop_reason !== 'tool_use' || !uses.length) {
      const text = res.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text).join('\n').trim()
      await log('final', agent.id, { chars: text.length, stop_reason: res.stop_reason })
      if (res.stop_reason === 'max_tokens') return finish('completed', text + '\n\n_(Answer cut off at the length limit.)_')
      return finish('completed', text || '_(No answer returned.)_')
    }

    // 4. Execute requested tools (read-only, tenant-scoped through the app's own API)
    const results: ToolResultBlock[] = []
    for (const u of uses) {
      toolCalls++
      const key = `${u.name}:${JSON.stringify(u.input)}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
      const tool = agent.tools.find((t) => t.name === u.name)
      await log('tool_call', u.name, { input: u.input, effect: tool?.effect ?? 'unknown' })
      if (toolCalls > LIMITS.maxToolCalls || (seen.get(key) ?? 0) > LIMITS.maxSameCall) {
        await log('guard', u.name, { reason: toolCalls > LIMITS.maxToolCalls ? 'tool call limit reached' : 'repeated identical call' })
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'Tool limit reached. Answer now with the information you already have, stating any gaps.' })
        continue
      }
      if (!tool) {
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: `Unknown tool "${u.name}". Available: ${agent.tools.map((t) => t.name).join(', ')}` })
        await log('tool_result', u.name, { ok: false, error: 'unknown tool' })
        continue
      }
      try {
        const out = await tool.run(u.input ?? {})
        const wrapped = wrapUntrusted(u.name, out)
        results.push({ type: 'tool_result', tool_use_id: u.id, content: wrapped })
        await log('tool_result', u.name, { ok: true, chars: wrapped.length, preview: wrapped.slice(0, 1500) })
      } catch (e) {
        const msg = (e as Error).message
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: `Tool failed: ${msg}` })
        await log('tool_result', u.name, { ok: false, error: msg })
      }
    }
    messages.push({ role: 'user', content: results as ContentBlock[] })
  }

  // 5. Loop limit reached: stop and say so (never loop indefinitely or spend beyond the cap).
  await log('guard', 'orchestrator', { reason: `model call limit (${LIMITS.maxModelCalls}) reached` })
  return finish('stopped', 'I stopped before finishing because this question needed more steps than allowed. Try asking about fewer routes at once.', 'model call limit reached')
}
