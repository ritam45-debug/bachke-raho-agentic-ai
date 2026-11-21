# BAchke Raho Agnetic AI: Technical Architecture

*Predict. Prevent. Protect.* Version 0.1 (Phase 1 complete), 21 Nov 2026.

This document answers the brief's "first task": requirements analysis, architecture, agent hierarchy, database
schema, external dependencies, risks and costs, and which features work now versus which need integrations.
The phase plan is in [ROADMAP.md](ROADMAP.md), security controls are in [SECURITY.md](SECURITY.md), and decisions made without
your input are in [ASSUMPTIONS.md](ASSUMPTIONS.md).

> **Evidence labels in this document:** **[Built]** = implemented and tested in this repo. **[Verified]** = checked
> against a cited source. **[Estimate]** = reasoned assumption, not measured. **[Design]** = planned, not yet built.

---

## 1. Requirements analysis

The brief describes 16 agents/modules. Some are really **platform layers**, not agents, and building them as agents
would be a mistake:

| Brief item | What it actually is | Why it matters |
|---|---|---|
| 11 Onboarding & profiles | Platform layer (tenancy) | Must exist before any agent; no LLM needed |
| 12 Confidentiality & cybersecurity | Cross-cutting layer | Enforced in code and DB, never by an LLM's judgement |
| 14 Dashboard | Presentation layer | Reads agent outputs; is not an agent itself |
| 16 Audit trail | Platform service | Must be deterministic and append-only. An LLM cannot be the audit authority |
| 10 Organisational memory | Shared service + retrieval tool | Every agent *uses* it; one memory agent curates it |
| 7 Vendor allocation, 8 Finance, parts of 3 Inventory | **Deterministic engines** wrapped as agent tools | The brief requires math, not LLM opinion. The LLM explains results; it does not compute them |

**Core principle:** *LLMs reason, narrate and choose between options; code calculates, enforces and records.*
Every number shown to a user comes from a deterministic function with unit tests, or is explicitly labelled as an
AI estimate with its assumptions shown.

### Non-negotiable requirements (from the brief) and where they live

| Requirement | Mechanism |
|---|---|
| Strict multi-tenant isolation | App-level `company_id` scoping **and** PostgreSQL Row-Level Security (§5) **[Built]** |
| No fabricated real-time data | `data_source` column on every operational row (`simulated / upload / api / manual`); `verification` on disruptions (`verified / unverified / simulated`) **[Built]** |
| Human approval for high-impact actions | Approval gate in orchestrator; `approvals:high_impact` permission already in RBAC **[Built: permission] / [Design: workflow]** |
| Score ≠ probability | Severity/risk scores are labelled "rule-based 0–100"; probabilities only where statistically estimated **[Built: labelling]** |
| No confidential data to external AI without authorisation | Per-tenant `ai_external_processing` flag, **off by default** **[Built]**; enforced at the AI gateway **[Design, Phase 2]** |
| Prompt-injection defence | Untrusted-content isolation in the AI gateway (§4.4) **[Design, Phase 2]** |

---

## 2. System architecture

```
┌────────────────────────── Browser (React + Vite + Tailwind + Recharts) ──────────────────────────┐
│ Landing · Register · Login · Route & Risk Map · Weather · dashboard sections · (P2) AI chat      │
└───────────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                                │ HTTPS, JWT bearer
┌───────────────────────────────────────────────▼──────────────────────────────────────────────────┐
│ FastAPI (Python)                                                                                   │
│  ├─ security/   auth (JWT + rotating refresh), RBAC, TenantContext, rate limit, headers   [Built] │
│  ├─ api/        auth · company · users · dashboard · operations · audit · admin           [Built] │
│  ├─ analytics/  deterministic engines: inventory ✔, vendor scoring, finance, risk         [P1–P4] │
│  ├─ orchestrator/ LangGraph state machine + Postgres checkpointer + approval interrupts   [P2,P6] │
│  ├─ agents/     specialist agents = prompt + tool allow-list + output schema              [P2–P5] │
│  ├─ integrations/ AI gateway (Claude), weather, news/RSS, tracking, commodities, regs     [P2–P5] │
│  └─ services/   audit, tenant repo, notifications                                         [Built/P6]│
└───────┬───────────────────────────────┬─────────────────────────────────┬────────────────────────┘
        │ SQL (non-owner role, RLS)     │ jobs                              │ outbound HTTPS
┌───────▼─────────┐            ┌────────▼────────┐                 ┌───────▼────────────────────────┐
│ PostgreSQL 16   │            │ Worker + sched. │                 │ Anthropic Claude API ·         │
│ (Supabase or    │            │ (P3: polling    │                 │ weather · news/RSS · tracking ·│
│ managed PG)     │            │  feeds, P6:     │                 │ commodity · regulatory sources │
│ + pgvector (P5) │            │  monitoring)    │                 └────────────────────────────────┘
└─────────────────┘            └─────────────────┘
```

### Technology choices and deviations from the brief

| Brief recommendation | Decision | Reason |
|---|---|---|
| React **or** Next.js | **React + Vite** | The backend is a separate FastAPI service, so Next.js server features would duplicate it. Vite builds a static bundle that any CDN can host. |
| Supabase PostgreSQL | **Plain PostgreSQL, Supabase-compatible** | Code uses standard Postgres + RLS. It runs on Supabase, Neon, RDS or Cloud SQL unchanged. Tests run against real Postgres 16 in CI. |
| Supabase Auth (implied) | **Own auth in FastAPI** (bcrypt + JWT + server-side sessions) | Tenant and role live in our own tables, which RLS and RBAC depend on. Keeps the app portable. Trade-off: MFA/SSO must be built (Phase 7) instead of configured. |
| LangGraph | **Keep LangGraph** (Phase 2) | Durable state via a Postgres checkpointer, plus built-in "interrupt" for human approval, match §4–5 of the brief directly. To be re-confirmed against its current docs at Phase 2 start. |
| SQLite | Dev/test only | Production refuses to boot with SQLite (`config.py`). |

---

## 3. Agent hierarchy

```
                          ┌──────────────────────────────┐
                          │  Central Orchestrator         │  LangGraph graph; task state; retries;
                          │  (no domain opinions)         │  approval interrupts; execution log
                          └──────────────┬───────────────┘
        ┌──────────────── Sensing ───────┼────────── Analysis ───────────┬──────── Decision ─────────┐
 Global Disruption (2)       Inventory (3)        Vendor Risk (6)          Consulting (1)
 Shipment Monitor (5)        Logistics (4)        Vendor Allocation (7)*   └ produces recommendation
 Compliance (13)             Financial (8)*       Product Lifecycle (9)      + alternatives + reasoning
 Consumer Sentiment (15)
        └──────────────────── shared services (not agents) ──────────────────────────────────────────┘
          Organisational Memory (10) · Audit/Accountability (16) · Tenancy (11) · Security (12)
          * = deterministic engine first; LLM only explains
```

### Agent contract (Phase 2 build)

Each agent is a small declarative unit:

| Field | Example (Inventory agent) |
|---|---|
| `name`, `autonomy_max` | `inventory`, `L2` (it can recommend but never execute) |
| `tools` (allow-list) | `get_inventory_positions`, `compute_days_of_cover`, `forecast_demand`, `memory.search` |
| `input` schema | affected SKUs, locations, delay days |
| `output` schema (Pydantic) | `stockout_risks[]{sku, location, days_of_cover, gap_days, evidence[]}` |
| `model` | Claude Sonnet for analysis; Haiku for classification/extraction (cost) |

Tools always run **in the caller's tenant context**. An agent cannot ask for another company's data because the
tool layer injects `company_id` from the session, never from model output.

### Orchestration of the brief's port-disruption scenario

```
detect(2) → affected_shipments(5) → stockout_check(3) ─┐
                                   → alt_suppliers(6,7) ┼→ costing(8) → strategy(1) → [APPROVAL INTERRUPT]
                                   → alt_routes(4) ─────┘                                  │ approved
                                                       audit(16) ← execute L3 action ←────┘
                                                       monitor(2,5) until resolved
```

The three branches run in parallel. Results are cached on the task state, so repeated nodes don't re-call the LLM.
Recoverable tool or API errors retry with backoff; non-recoverable ones mark the branch `degraded`, and the
recommendation states what is missing.

### Autonomy levels

| Level | Allowed | Gate |
|---|---|---|
| L1 Information | read, analyse, score | none |
| L2 Recommendation | propose with costs and alternatives | none, but always audit-logged |
| L3 Authorised execution | **low-risk only**: draft PO, RFQ email draft, reroute *request*, internal report, notify staff, update risk record | Policy table per tenant + approval by a user holding `approvals:high_impact` for anything with financial, contractual or legal effect |

Nothing that commits money or a contract runs automatically. The executor exposes only "draft" and "request" verbs.

---

## 4. AI gateway (Phase 2)

All Claude calls go through one module, `integrations/ai_gateway.py`:

1. **Consent check:** refuses if the tenant's `ai_external_processing` is false.
2. **Data minimisation:** sends only the fields the agent's tools returned, never whole tables.
3. **Audit:** every call logs agent, model, token counts, cost and the hash of the prompt.
4. **Prompt-injection defence:** content from uploads, RSS, news or emails is wrapped as *data* in clearly delimited
   blocks. The system prompt states that instructions inside data blocks are never followed. Agents have no tool
   that can change permissions, read other tenants or send external messages without the approval gate. So
   a successful injection can at worst produce a bad recommendation, which a human reviews.
5. **Budget guard:** per-tenant monthly token cap.

---

## 5. Database schema

### Built in Phase 1 (migration `0001`, RLS in `0002`)

| Table | Key columns | Notes |
|---|---|---|
| `companies` | slug (unique), industry, size, status, `is_demo`, `ai_external_processing`, `data_retention_days` | tenant root |
| `company_profiles` | company_id (unique), categories JSON, contacts, currency | RLS |
| `locations` | kind ∈ {headquarters, manufacturing, warehouse, distribution}, lat/long, capacity | RLS |
| `users` | email (unique), role, `company_id` (NULL only for super_admin, enforced by CHECK), lockout fields, `mfa_enabled` | |
| `user_sessions` | sha256(refresh token), expiry, revoked_at, ip, user agent | revocation and theft detection |
| `audit_logs` | company_id, actor (user/agent/system), action, entity, outcome, ip, details JSON | **append-only trigger** on Postgres |
| `suppliers` | (company_id, code) unique, OTD rate, quality, lead time, spend, `data_source` | RLS |
| `products` | (company_id, sku) unique, kind ∈ {raw_material, component, finished_good}, cost, price | RLS |
| `inventory_items` | (company, product, location) unique, on-hand ≥ 0, ROP, safety stock, demand, lead time | RLS |
| `shipments` | (company_id, reference) unique, mode, status, original vs current ETA, `data_source` | RLS |
| `disruptions` | severity 0–100 (CHECK), status, **verification**, countries, suppliers, source URL | RLS |

### Added by later phases [Design]

| Phase | Tables |
|---|---|
| 1+ (built) | `routes`, `route_risk_checks` (RLS; score must equal its factors) |
| 2 | `ai_conversations`, `ai_messages`, `agent_runs`, `agent_steps` (execution history), `tool_calls`, LangGraph checkpoint tables |
| 3 | `global_events` (platform-wide, not tenant-owned) + `company_event_impacts` (RLS); `logistics_routes`, `route_quotes`, `shipment_tracking_events`, `uploads` |
| 4 | `vendor_assessments`, `vendor_scorecards`, `scoring_weight_profiles` (CHECK sum = 100), `purchase_orders`, `po_lines`, `production_batches`, `bom_lines`, `financial_analyses`, `risk_assessments` |
| 5 | `memory_documents`, `memory_chunks` (pgvector embedding), `regulatory_updates`, `compliance_assessments`, `surveys`, `survey_questions`, `consumer_feedback` (consent flag) |
| 6 | `approval_requests`, `approval_policies`, `executed_actions`, `notifications`, `notification_preferences` |

**Rules every new table follows:** UUID PK; `company_id NOT NULL` FK with index; included in the RLS migration list;
`created_at`; `data_source` where data can be simulated; no free-text "status" without a CHECK.

### Two layers of tenant isolation [Built and tested]

1. **Application:** request schemas forbid unknown fields, so a client cannot send `company_id`. Every tenant query goes
   through `services/tenant_repo.scoped()`, which takes `company_id` from the authenticated session. Cross-tenant IDs
   return **404**, not 403, so existence is not leaked.
2. **Database:** RLS policy `company_id = current_setting('app.current_company_id')` with `FORCE ROW LEVEL SECURITY`.
   The API connects as a non-owner role. The tenant is pinned per transaction and re-applied automatically after every
   commit (an `after_begin` hook). This hook exists because the Postgres test suite caught reads silently losing
   their tenant after a commit.

`tests/test_postgres_rls.py` proves that a deliberately unfiltered `SELECT count(*) FROM suppliers` returns only the
pinned tenant's rows, and that inserting a row for another tenant is rejected.

---

## 6. External data dependencies

Prices for third-party data services change often and were **not verified** for this document. Check them before
committing to a provider in the phase that needs it.

| Need | Phase | Candidate sources (to evaluate) | Works without it? |
|---|---|---|---|
| LLM reasoning | 2 | Anthropic Claude API | No AI features; deterministic analytics still work |
| Weather and storms | 3 | Open-Meteo, OpenWeatherMap, national met agencies (e.g. IMD) | Yes, simulation mode |
| News / geopolitical events | 3 | GDELT, curated RSS (Reuters/AP-style wires, port authority notices), NewsAPI-type aggregators | Yes, simulation mode |
| Port congestion | 3 | Port authority notices; commercial AIS/port-call data providers | Yes, simulation and manual entry |
| Shipment tracking | 3 | Container/carrier tracking aggregators; carrier APIs; customer CSV uploads | Yes. CSV upload is the baseline |
| Commodity prices | 4 | World Bank commodity price data, exchange/market data vendors | Yes, manual/upload |
| Supplier financial health | 4 | Company registries (e.g. MCA for Indian firms), credit-data vendors | Partially, via manual scores |
| Regulatory updates | 5 | Official gazettes and trade portals (e.g. DGFT, CBIC for India), WTO notifications | Yes, manual entries with sources |
| Email/notifications | 6 | Any transactional email provider | In-app notifications only |

Every adapter sits behind an interface with a `SimulatedProvider` implementation, so the UI and agents work end-to-end
before a contract is signed, and simulated output is always labelled.

---

## 7. What works now vs. what needs integrations

| Capability | Status today |
|---|---|
| Company registration, isolated workspaces, 7 roles, login/refresh/logout, lockout, revocation | **Working** |
| Company profile, locations, team management, AI-consent switch, data retention setting | **Working** |
| Executive dashboard KPIs and charts; inventory status (days of cover, ROP, safety-stock bands) | **Working** on stored data |
| Inventory / shipments / vendors / disruptions / products tables with search, filter, CSV export | **Working** |
| Audit log with filter and CSV export; append-only on Postgres | **Working** |
| Route & Risk Map: live map, place search, routes, live risk checks with stored history | **Working** (public feeds, see LIVE_DATA.md) |
| Weather Forecast: 3–16-day forecasts and flagged days for every site | **Working** (Open-Meteo) |
| CSV import of locations and routes, getting-started checklist | **Working** |
| Light/dark theme, desktop/tablet/mobile layout | **Working** |
| Data upload (CSV/Excel/PDF) | Phase 3. Needs no external service |
| Vendor weighted scoring, finance engine, risk scores | Phases 3–4. Needs no external service |
| AI agents, orchestrator, chat, consulting reports | Phase 2+. **Needs Anthropic API key** |
| Live disruptions, weather, tracking, commodity, regulatory feeds | Phases 3–5. **Need provider accounts**; simulation until then |
| Executing actions (send RFQ, submit reroute) | Phase 6. **Needs email/ERP/carrier connections**; drafts work without |
| MFA, SSO | Phase 7 |

---

## 8. Risk scoring framework (applies from Phase 3)

All scores are on **0–100**, computed by versioned, configurable rules. Each score is returned with:
`score, band (Low <25 · Moderate 25–49 · Elevated 50–74 · High ≥75), factors[{name, weight, value, evidence}],
probability (null unless statistically estimated, with method stated), financial_impact {value, is_estimate,
assumptions[]}, mitigation`.

Phase 1 already applies two such rules, and shows them in the UI:
- **Stock status:** `critical` if on-hand ≤ safety stock or days of cover < lead time; `reorder` if ≤ ROP;
  `excess` if cover > 120 days and > 4× lead time.
- **Flagged supplier:** on-time delivery < 85% or quality < 80.

---

## 9. Technical risks and cost implications

### Technical risks

| Risk | Impact | Mitigation |
|---|---|---|
| LLM states numbers it didn't calculate | Wrong decisions | Agents get numbers only from tools; output schemas reject free-floating figures; UI shows the tool evidence |
| Prompt injection via uploads/news | Manipulated recommendation | §4.4: data/instruction separation, tool allow-lists, approval gate |
| Cross-tenant leak through a missed filter | Severe | Two layers (app + RLS) and dedicated tests; new tables must join the RLS list (CI check planned) |
| Feed quality / false alarms | Alert fatigue | Verification labels, source reliability weighting, de-duplication |
| Data-provider cost/lock-in | Budget | Adapter interface, simulation fallback, choose per tenant |
| Scope (16 modules) | Delivery slip | Strict phase gates; each phase ships working software |
| Refresh token in `sessionStorage` | XSS could steal a session | Short access TTL, rotation and reuse detection now; httpOnly cookie + CSP in Phase 7 |
| In-memory rate limiter | Weak once there are multiple API instances | Redis-backed limiter when scaling (Phase 7) |

### Cost implications

**Claude API** [Verified, pricing page]: Sonnet 5.5 costs **$2 input / $10 output per million tokens**, and Haiku 5.5 costs **$0.10 / $0.50** for prompts up to 100K tokens. The Batch API halves both, and prompt-cache reads cost 5% of base input on Sonnet.

**Per-workflow estimate** [Estimate, not measured]: assume one full disruption workflow is about 8 agent calls on Sonnet,
averaging 6K input and 1.5K output tokens each. That is 48K input × $2/M + 12K output × $10/M ≈ **$0.22 per run** before
caching. Assume 20 runs plus 200 chat turns (~4K in / 0.8K out each, ≈ $0.016 per turn) per tenant per month. That gives about
**$4.40 + $3.20 ≈ $8 per tenant per month**. Routing classification to Haiku and caching shared system prompts should cut
this further. **Phase 2 will replace this estimate with measured token counts** from the gateway's audit log.

**Hosting** [Estimate]: a small managed Postgres, one API container and a static frontend fit within entry tiers of
common providers at demo scale. Exact figures depend on the provider chosen at deployment (Phase 7).

**Data feeds:** the largest unknown. Commercial tracking and AIS data are typically priced per shipment or by contract.
Prices are to be verified per provider; see §6.

Source: [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
