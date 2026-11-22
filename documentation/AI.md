# Phase 2: AI agents

## What it does
The **AI Consulting Centre** lets a user ask the **Route Risk Analyst** about their routes, sites and the weather and natural
hazards around them. The agent reads the company's own data through read-only tools, can run a fresh live risk check, and
answers in a fixed format: bottom line → what the data shows (cited) → what to do → limits. Every answer links to a full
trace: routing decision, each model call (tokens), each tool call with its input and result, the final answer, and the
server-priced cost.

## Where it runs (and why)
The live site is static (GitHub Pages), so there is no server to hold a shared API key safely. The agent therefore runs in
the user's browser with **their own Anthropic key** ("bring your own key"):

- The key is stored only in that browser (this tab by default, or "this device" if chosen) and sent only to
  `api.anthropic.com` with Anthropic's browser opt-in header. It never reaches this app's backend, database or logs (tested).
- Anyone using the same browser profile could read it, so users should set a spending limit on the key in the Anthropic console.

**Deviation from the original brief:** the brief asked for Claude to be called server-side through LangGraph. On static
hosting that is impossible, so a small TypeScript state machine (`frontend/src/lib/ai/orchestrator.ts`) does the
orchestrator's jobs: routing, task state, bounded tool loop, retries, execution log and limits. When the FastAPI backend is
hosted (Phase 7), the same agent contract can move server-side and use the company's key from a secret store.

## Controls

| Control | How | Where enforced |
|---|---|---|
| Company consent | Runs are refused unless an admin enabled "Allow external AI processing" | Server (`POST /ai/runs` → 403) |
| Monthly budget | Runs are refused once this month's recorded cost reaches the company's budget (default $10) | Server (`429`) |
| Cost | Recomputed by the server from token counts × published prices; the browser's estimate is display-only | Server |
| Who can use AI | `ai:use`: admins, the three manager roles and analysts. Not read-only users | Server (RBAC) |
| Data access | Tools call this app's own API with the user's session, so company filters, RLS and roles apply. An agent sees no more than its user | Server |
| Autonomy | Levels 1–2 only (information and recommendation). Level 3 execution is refused until Phase 6 approvals exist. Only one tool writes anything: `run_live_route_check` saves a risk observation | Server + agent design |
| Prompt injection | Tool output is wrapped in `<untrusted_data>` tags (closing tags inside are neutralised); the system prompt forbids following instructions found there | Browser (tested) |
| Runaway loops | ≤ 8 model calls, ≤ 14 tool calls, ≤ 2 identical calls per answer; unknown tools rejected | Browser (tested) |
| Errors | Retries 408/429/5xx/529 with backoff (honours `retry-after`); bad key fails fast with a clear message | Browser (tested) |
| Audit | `ai.run_started`, `ai.run_finished` (tokens, cost, tools), `ai.run_blocked` (consent/budget) in the audit log; steps in `agent_steps` | Server |
| Privacy | Conversations are visible only to their author; admins (audit:read) can review runs in their company | Server |

**Limitation:** because the model call happens in the browser, a user who modifies the page could bypass the browser-side
loop limits or under-report tokens to the server. Consent and the budget gate still apply at the start of every run. Hard
enforcement needs the server-side mode (Phase 7).

## Models and prices
`claude-sonnet-5-5` (default) at $2 / $10 per million input/output tokens, and `claude-haiku-5-5` at $0.10 / $0.50 (prompts
≤ 100K tokens), from the Claude API pricing page (checked 21 Nov 2026). The system prompt is sent with prompt caching.

## Tests
- Backend (`backend/tests/test_ai_api.py`, Postgres RLS test): consent and budget gates, server pricing incl. Haiku's long-prompt
  tier, lifecycle, step ordering and truncation, cross-company and cross-user isolation, role restrictions.
- Frontend unit (`npm test`, `orchestrator.test.ts`): tool loop and trace, untrusted-data wrapping, consent block, retry, bad key,
  loop limits, repeated/unknown tools, Markdown safety.
- Browser e2e with a faked Claude API: full user flow incl. key handling, trace, audit and budget block.
- **Live** (`.github/workflows/ai-live.yml`): the same flow against the real Claude API using the `ANTHROPIC_API_KEY`
  repository secret. Phase 2 counts as verified only when this passes.
