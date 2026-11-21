# Phase-wise development roadmap

Each phase ends with working software, passing tests (SQLite **and** Postgres/RLS in CI), updated docs, and a demo.
No fake buttons: unbuilt sections show a "planned capabilities" panel with nothing clickable.

| Phase | Scope | Exit criteria | Needs from you |
|---|---|---|---|
| **1 ✅ Done** | Repo, FastAPI + React foundations, company registration, auth (JWT + rotating refresh + lockout), 7-role RBAC, tenant isolation (app + RLS), audit log, Alembic migrations, simulated Aureon demo, dashboard shell with 6 live sections, CI, Docker | 27 tests pass on Postgres 16, 24 on SQLite; browser walkthrough of demo, register, team and audit | — |
| **2** | AI gateway (consent, audit, budget, injection defence), LangGraph orchestrator with Postgres checkpointer, agent contract, first agent (Inventory, L1/L2), tool calling, `agent_runs`/`agent_steps` logs, AI chat in Consulting Centre | Chat answers inventory questions using tools only; every call visible in the audit log; refuses when consent is off | **Anthropic API key** (set as a secret, never in code) |
| **3** | Upload pipeline (CSV/Excel, then PDF) with validation and preview; Global Disruption agent with feed adapters + simulation; Shipment Monitor; Logistics agent with route/mode comparison; risk map; `global_events` split | Upload Aureon CSVs into a new tenant and see the same dashboard; simulated disruption flows to affected shipments | Choice of weather/news/tracking providers + keys (optional; simulation otherwise) |
| **4** | Vendor Risk agent, **weighted scoring engine** (default 25/20/20/15/10/10, admin-editable, sum-to-100 enforced, capacity/MOQ-aware dual-sourcing allocation via linear programming), Financial engine (holding, downtime, revenue at risk, break-even, sensitivity, mitigation ROI), Product lifecycle traceability | Scoring and finance outputs match hand-calculated test cases | Your preferred cost-of-capital / holding-cost defaults (assumptions used otherwise) |
| **5** | Organisational memory (pgvector, permissioned retrieval, admin export/delete), Compliance agent (sources + effective dates, fact vs interpretation), Consumer feedback (consent forms, sentiment, NPS), Consulting report generator (PDF + Excel) | Recommendation cites a past disruption from memory; report exports open correctly | Jurisdictions to prioritise for compliance |
| **6** | Full autonomous workflow of §11 scenario, approval requests and policies, L3 executor (draft/request verbs only), notifications, outcome monitoring | Scenario runs end-to-end in UI: detect → … → approve → record → monitor | Email provider (optional) |
| **7** | Security assessment (OWASP ASVS L2 checklist, dependency scan, pen-test script), TOTP MFA, httpOnly refresh cookie + CSP, Redis rate limit, performance tuning, deployment, final demo | Deployed URL; security report; load test results | **Hosting accounts** (frontend, API, managed Postgres) and domain |

## GitHub

The repository is ready to push (`.gitignore` excludes secrets and `.env`). Creating the remote repo needs your GitHub
account. Either share the repo name/owner so it can be pushed, or run:

```bash
cd bachke-raho-agentic-ai
git init && git add . && git commit -m "Phase 1: foundations, tenancy, auth, RBAC, audit, dashboard"
gh repo create bachke-raho-agentic-ai --private --source . --push
```
