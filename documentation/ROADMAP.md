# Phase-wise development roadmap

Each phase ends with working software, passing tests (SQLite **and** Postgres/RLS in CI), updated docs, and a demo.
No fake buttons: unbuilt sections show a "planned capabilities" panel with nothing clickable.

| Phase | Scope | Exit criteria | Needs from you |
|---|---|---|---|
| **1 ✅ Done** | Repo, FastAPI + React foundations, company registration, auth (JWT + rotating refresh + lockout), 7-role RBAC, tenant isolation (app + RLS), audit log, Alembic migrations, simulated Aureon demo, dashboard shell with 6 live sections, CI, Docker | 27 tests pass on Postgres 16, 24 on SQLite; browser walkthrough of demo, register, team and audit | — |
| **1+ ✅ Done** | Aureon demo removed; live Route & Risk Map (OSM, Open-Meteo, USGS, NASA EONET, OSRM); Weather Forecast tool; CSV import; setup checklist; new logo | 33 backend tests on Postgres; browser test of map, checks, import and weather | — |
| **2 (built; live test pending key)** | Built: consent + budget gates and server-side pricing, append-only run/step trace (RLS), agent contract, **Route Risk Analyst** (L1/L2; replaces Inventory as first agent because companies have no inventory data until Phase 3), 7 read-only tools, injection defence, retries and loop limits, AI Consulting Centre. Runs in the browser with each user's own key (static hosting), so a TypeScript state machine replaces LangGraph (see AI.md) | Chat answers inventory questions using tools only; every call visible in the audit log; refuses when consent is off | **Anthropic API key** (set as a secret, never in code) |
| **3 ✅ Done** | CSV import for suppliers, products, inventory and shipments (validation, preview, row-numbered errors, all-or-nothing, upsert by natural key, reorder point = d·L + SS), generic delete, Logistics page (delay/slip performance, landed-cost mode comparison). PDF/Excel upload and the paid tracking/news feeds are **not** built: live disruptions come from the free feeds of Phase 1+ | Import into a new tenant fills every dashboard; 45 SQLite / 50 Postgres tests | — |
| **4 ✅ Done** | Weighted vendor scoring (default 25/20/20/15/10/10, company-editable, sum-to-100 enforced, missing inputs scored 0 and flagged), dual/single-source allocation with capacity + MOQ (**rule-based, not linear programming**: see ASSUMPTIONS), Financial Intelligence (holding cost, disruption impact, mitigation ROI, break-even likelihood and days, sensitivity grid, saved scenarios), Product Lifecycle (BOM, cost build-up vs recorded cost, supplier concentration, linked stock and shipments) | Unit tests match hand-calculated cases; browser test `e2e/phase4.mjs` checks ranking, allocation, ₹5.50 L impact and ₹830 built-up cost | Your own carrying-cost rate (20% planning default otherwise) |
| **5 ✅ Done** | **Legal & Compliance** register (official source URL required, jurisdiction, effective/review dates, owner, status; source text kept separate from the company's interpretation; rule-based attention flags; "not legal advice" notice). **Consumer Intelligence** (surveys with a consent notice; responses without consent are rejected and never stored; NPS, keyword-lexicon sentiment, complaint themes, NPS by product/region/channel; per-response deletion). **Organisational Memory** (incidents, lessons, decisions, playbooks; tags; keyword search; author/admin delete; admin JSON export). **Not built:** pgvector semantic retrieval, PDF/Excel report generator, automatic regulation monitoring | 4 backend tests (SQLite + Postgres RLS), 4 unit tests, browser test `e2e/phase5_6.mjs` | Jurisdictions to prioritise (you add requirements yourself) |
| **6 ✅ Done** | Approval requests for high-impact actions (expedite, switch supplier, reroute, safety stock, spend); decided only by `approvals:high_impact` holders, **never by the requester** (API rule + DB constraint); rejection needs a reason; cancel; outcome recording; raised manually or from an elevated/high route on the Risk Map; in-app notifications with a bell; every step audit-logged. **Not built:** automatic execution (by design nothing is executed), email notifications, AI agent raising requests on its own | Browser test runs request → notify → approve → notify → outcome across two users | Email provider (optional) |
| **7** | Security assessment (OWASP ASVS L2 checklist, dependency scan, pen-test script), TOTP MFA, httpOnly refresh cookie + CSP, Redis rate limit, performance tuning, deployment, final demo | Deployed URL; security report; load test results | **Hosting accounts** (frontend, API, managed Postgres) and domain |

## GitHub

The repository is ready to push (`.gitignore` excludes secrets and `.env`). Creating the remote repo needs your GitHub
account. Either share the repo name/owner so it can be pushed, or run:

```bash
cd bachke-raho-agentic-ai
git init && git add . && git commit -m "Phase 1: foundations, tenancy, auth, RBAC, audit, dashboard"
gh repo create bachke-raho-agentic-ai --private --source . --push
```
