import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Bot, ChevronRight, KeyRound, Loader2, MessageSquarePlus, Send, ShieldAlert, Trash2, Wrench } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useApi } from '../../lib/useApi'
import { dateTime, titleCase } from '../../lib/format'
import { testKey } from '../../lib/ai/claude'
import { clearKey, currentKey, getModel, keyRemembered, maskKey, setKey, setModel } from '../../lib/ai/key'
import { runTurn, type Step } from '../../lib/ai/orchestrator'
import { routeRiskAnalyst } from '../../lib/ai/agents/routeRisk'
import Markdown from '../../components/Markdown'
import { ErrorBox, PageHeader } from '../../components/ui'

interface Status { consent: boolean; budget_usd: number; spent_month_usd: number; remaining_usd: number; runs_month: number; models: { id: string; label: string; input_per_mtok: number; output_per_mtok: number }[] }
interface Conv { id: string; title: string; updated_at: string }
interface Msg { id: string; role: 'user' | 'assistant'; content: string; run_id: string | null; created_at: string }
interface RunDetail { id: string; agent: string; model: string; status: string; input_tokens: number; output_tokens: number; cost_usd: number; tool_calls: number; error: string | null; started_at: string; steps: Step[] }

const SUGGESTIONS = [
  'Which of our routes is most at risk in the next 3 days, and what should we do?',
  'Check all our sea routes now and summarise the weather threats.',
  'Is any of our sites likely to get heavy rain or storm-force winds this week?',
  'What changed in the risk on our riskiest route since its last check?',
]

const KIND_STYLE: Record<string, string> = {
  route: 'text-violet-500', model_call: 'text-sky-500', tool_call: 'text-amber-500', tool_result: 'text-emerald-500',
  final: 'text-calm', error: 'text-red-500', retry: 'text-orange-500', guard: 'text-red-400',
}

function StepLine({ s }: { s: Step }) {
  const [open, setOpen] = useState(false)
  const p = s.payload as Record<string, unknown>
  const summary = s.kind === 'model_call' ? `${(p.tool_requests as string[] | undefined)?.length ? `asks for ${(p.tool_requests as string[]).join(', ')}` : `stop: ${p.stop_reason}`} · ${(p.usage as { input_tokens?: number })?.input_tokens ?? 0}+${(p.usage as { output_tokens?: number })?.output_tokens ?? 0} tok`
    : s.kind === 'tool_call' ? `${s.name}(${JSON.stringify(p.input ?? {})})`
    : s.kind === 'tool_result' ? `${s.name}: ${p.ok ? `ok, ${p.chars} chars` : `failed – ${p.error}`}`
    : s.kind === 'route' ? `→ ${titleCase(String(s.name))}: ${p.reason}`
    : s.kind === 'retry' ? `retry ${p.attempt} after HTTP ${p.status} (wait ${p.wait_ms} ms)`
    : s.kind === 'guard' ? String(p.reason)
    : s.kind === 'error' ? String(p.message)
    : `answer, ${p.chars} chars`
  return (
    <li className="text-xs">
      <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(!open)}>
        <ChevronRight size={12} className={`mt-0.5 shrink-0 transition ${open ? 'rotate-90' : ''}`} />
        <span className={`num w-20 shrink-0 font-semibold ${KIND_STYLE[s.kind]}`}>{s.kind.replace('_', ' ')}</span>
        <span className="min-w-0 break-words text-slate-600 dark:text-slate-300">{summary}</span>
      </button>
      {open && <pre className="ml-5 mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 text-[11px] dark:bg-ink-950">{JSON.stringify(p, null, 2)}</pre>}
    </li>
  )
}

function KeyPanel({ onChange, model }: { onChange: () => void; model: string }) {
  const [k, setK] = useState('')
  const [remember, setRemember] = useState(false)
  const [state, setState] = useState<{ busy?: boolean; err?: string; ok?: string }>({})
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setState({ busy: true })
    try { await testKey(k.trim(), model); setKey(k.trim(), remember); setK(''); setState({ ok: 'Key works and is saved in this browser.' }); onChange() }
    catch (err) { setState({ err: (err as Error).message }) }
  }
  return (
    <form onSubmit={save} className="card space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold"><KeyRound size={16} className="text-signal" />Your Anthropic API key</div>
      <p className="text-xs text-slate-500">The AI runs in your browser with your own key (this site has no server to keep a shared key safe). The key is sent only to api.anthropic.com, never to this app or its logs. Anyone using this browser profile could read it, so use a key with a spending limit set in your Anthropic console.</p>
      <input type="password" autoComplete="off" className="input font-mono" placeholder="sk-ant-…" value={k} onChange={(e) => setK(e.target.value)} />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember on this device (otherwise forgotten when the tab closes)</label>
      {state.err && <ErrorBox message={state.err} />}
      {state.ok && <p className="text-xs text-emerald-600">{state.ok}</p>}
      <button className="btn-primary" disabled={k.trim().length < 20 || state.busy}>{state.busy ? <><Loader2 size={15} className="animate-spin" />Testing key…</> : 'Test & save key'}</button>
    </form>
  )
}

export default function ConsultingPage() {
  const { me, can } = useAuth()
  const status = useApi<Status>('/ai/status')
  const convs = useApi<Conv[]>('/ai/conversations')
  const [active, setActive] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<Step[]>([])
  const [trace, setTrace] = useState<RunDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [key, setKeyState] = useState<string | null>(currentKey())
  const [model, setModelState] = useState(getModel())
  const [showKey, setShowKey] = useState(!currentKey())
  const end = useRef<HTMLDivElement>(null)

  const loadConv = useCallback(async (id: string) => {
    setActive(id); setTrace(null); setLive([])
    const c = await api<{ messages: Msg[] }>(`/ai/conversations/${id}`)
    setMsgs(c.messages)
  }, [])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, live])

  const openTrace = async (runId: string) => setTrace(await api<RunDetail>(`/ai/runs/${runId}`))

  const ask = async (q: string) => {
    if (!q.trim() || busy || !key) return
    setErr(null); setBusy(true); setLive([]); setTrace(null)
    try {
      let cid = active
      if (!cid) { cid = (await api<Conv>('/ai/conversations', { method: 'POST', json: { title: q.slice(0, 80) } })).id; setActive(cid) }
      const history = msgs.map((m) => ({ role: m.role, content: m.content }))
      const um = await api<Msg>(`/ai/conversations/${cid}/messages`, { method: 'POST', json: { role: 'user', content: q } })
      setMsgs((m) => [...m, um]); setInput('')
      const r = await runTurn({ question: q, history, conversationId: cid, apiKey: key, model, company: me?.company_name ?? 'the company', onStep: (s) => setLive((l) => [...l, s]) })
      if (r.status === 'failed' && !r.text) { setErr(r.error ?? 'The agent could not answer.'); if (r.runId) void openTrace(r.runId) }
      else {
        const am = await api<Msg>(`/ai/conversations/${cid}/messages`, { method: 'POST', json: { role: 'assistant', content: r.text, run_id: r.runId } })
        setMsgs((m) => [...m, am])
        if (r.runId) void openTrace(r.runId)
      }
      void status.reload(); void convs.reload()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false); setLive([]) }
  }

  const st = status.data
  const isAdmin = can('company:update')
  const enableAi = async () => { await api('/company', { method: 'PATCH', json: { ai_external_processing: true } }); await status.reload() }

  return (
    <>
      <PageHeader title="AI Consulting Centre" subtitle={`Ask the ${routeRiskAnalyst.label}. ${routeRiskAnalyst.describe} Every answer shows the tools it used and what it cost.`} />

      {status.error && <ErrorBox message={status.error} />}
      {st && !st.consent && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 border-amber-300 p-4 dark:border-amber-500/40">
          <ShieldAlert className="text-amber-500" />
          <div className="min-w-0 flex-1 text-sm"><b>AI is switched off for this company.</b> Turning it on lets agents send the company records they read (routes, sites, risk checks) to Anthropic's Claude API for analysis. Every run is logged.</div>
          {isAdmin ? <button className="btn-primary" onClick={enableAi}>Allow external AI processing</button> : <span className="text-xs text-slate-500">Ask a company administrator to enable it in Company Settings.</span>}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500">
        {st && <span>This month: <b className="num text-slate-700 dark:text-slate-200">${st.spent_month_usd.toFixed(4)}</b> of ${st.budget_usd.toFixed(2)} budget · {st.runs_month} runs</span>}
        <label className="flex items-center gap-1.5">Model
          <select className="input !w-auto !py-1 text-xs" value={model} onChange={(e) => { setModel(e.target.value); setModelState(e.target.value) }}>
            {(st?.models ?? []).map((m) => <option key={m.id} value={m.id}>{m.label} (${m.input_per_mtok}/${m.output_per_mtok} per M tokens)</option>)}
          </select>
        </label>
        <span className="flex items-center gap-2"><KeyRound size={13} />{key ? <>{maskKey(key)} {keyRemembered() ? '(this device)' : '(this tab)'}
          <button className="text-signal hover:underline" onClick={() => setShowKey(!showKey)}>change</button>
          <button className="hover:underline" onClick={() => { clearKey(); setKeyState(null); setShowKey(true) }}>remove</button></> : 'no key yet'}</span>
      </div>

      {showKey && <div className="mb-4 max-w-2xl"><KeyPanel model={model} onChange={() => { setKeyState(currentKey()); setShowKey(false) }} /></div>}

      <div className="grid gap-4 xl:grid-cols-[230px_1fr_360px]">
        <aside className="card h-fit p-2">
          <button className="btn-ghost mb-2 w-full" onClick={() => { setActive(null); setMsgs([]); setTrace(null) }}><MessageSquarePlus size={15} />New chat</button>
          {(convs.data ?? []).map((c) => (
            <div key={c.id} className={`group flex items-center rounded-lg ${active === c.id ? 'bg-slate-100 dark:bg-ink-800' : 'hover:bg-slate-50 dark:hover:bg-ink-800/50'}`}>
              <button className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm" onClick={() => loadConv(c.id)} title={c.title}>{c.title}</button>
              <button aria-label="Delete conversation" className="p-1.5 text-slate-400 opacity-0 hover:text-red-500 group-hover:opacity-100"
                onClick={async () => { await api(`/ai/conversations/${c.id}`, { method: 'DELETE' }); if (active === c.id) { setActive(null); setMsgs([]) } void convs.reload() }}><Trash2 size={13} /></button>
            </div>
          ))}
          {!convs.data?.length && <p className="px-2 py-3 text-xs text-slate-500">Your conversations appear here. Only you can see them.</p>}
        </aside>

        <section className="card flex min-h-[520px] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {!msgs.length && !busy && (
              <div className="mx-auto max-w-xl py-6 text-center">
                <Bot className="mx-auto text-signal" size={32} />
                <p className="mt-2 text-sm text-slate-500">Ask about your routes, sites and the weather and hazards around them.</p>
                <div className="mt-4 grid gap-2 text-left">{SUGGESTIONS.map((s) => <button key={s} disabled={!key || !st?.consent} className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-signal disabled:opacity-50 dark:border-ink-700" onClick={() => ask(s)}>{s}</button>)}</div>
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
                {m.role === 'user'
                  ? <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-ink-900 px-4 py-2 text-sm text-white dark:bg-ink-700">{m.content}</div>
                  : <div className="max-w-full">
                      <Markdown text={m.content} />
                      {m.run_id && <button className="mt-1 flex items-center gap-1 text-xs text-signal hover:underline" onClick={() => openTrace(m.run_id!)}><Wrench size={12} />How this answer was made</button>}
                    </div>}
              </div>
            ))}
            {busy && (
              <div className="rounded-lg border border-dashed border-slate-300 p-3 dark:border-ink-700">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500"><Loader2 size={13} className="animate-spin" />Working…</div>
                <ul className="space-y-1">{live.map((s) => <StepLine key={s.seq} s={s} />)}</ul>
              </div>
            )}
            {err && <ErrorBox message={err} />}
            <div ref={end} />
          </div>
          <form className="flex gap-2 border-t border-slate-200 p-3 dark:border-ink-700" onSubmit={(e) => { e.preventDefault(); void ask(input) }}>
            <input className="input" placeholder={!st?.consent ? 'AI is switched off for this company' : !key ? 'Add your Anthropic key above to start' : 'Ask about route risk, weather or your sites…'}
              value={input} onChange={(e) => setInput(e.target.value)} disabled={busy || !key || !st?.consent} maxLength={4000} />
            <button className="btn-primary" disabled={busy || !input.trim() || !key || !st?.consent} aria-label="Send">{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button>
          </form>
        </section>

        <aside className="card h-fit p-4">
          <h3 className="text-sm font-semibold">Agent trace</h3>
          {!trace ? <p className="mt-2 text-xs text-slate-500">Choose "How this answer was made" under an answer to see which agent ran, every tool call with its input and result, tokens and cost.</p> : (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><div className="text-slate-500">Agent</div><div className="font-medium">{titleCase(trace.agent)}</div></div>
                <div><div className="text-slate-500">Status</div><div className={`font-medium ${trace.status === 'completed' ? 'text-emerald-600' : 'text-red-500'}`}>{trace.status}</div></div>
                <div><div className="text-slate-500">Tokens in/out</div><div className="num">{trace.input_tokens.toLocaleString()} / {trace.output_tokens.toLocaleString()}</div></div>
                <div><div className="text-slate-500">Cost (server-priced)</div><div className="num">${trace.cost_usd.toFixed(5)}</div></div>
                <div><div className="text-slate-500">Tool calls</div><div className="num">{trace.tool_calls}</div></div>
                <div><div className="text-slate-500">Started</div><div>{dateTime(trace.started_at)}</div></div>
              </div>
              {trace.error && <ErrorBox message={trace.error} />}
              <ul className="space-y-1.5 border-t border-slate-100 pt-3 dark:border-ink-800">{trace.steps.map((s) => <StepLine key={s.seq} s={s} />)}</ul>
              <p className="text-[11px] text-slate-500">Run {trace.id.slice(0, 8)} · recorded in the audit log as ai.run_started / ai.run_finished.</p>
            </div>
          )}
        </aside>
      </div>
    </>
  )
}
