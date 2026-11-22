# BAchke Raho Agnetic AI

**Predict. Prevent. Protect.** An enterprise multi-agent supply-chain intelligence platform.

> **Status: Phases 1–6 built and tested; Phase 7 (production hardening and hosting) not started.**
> - **1:** multi-company registration, secure auth, 7 roles, two-layer tenant isolation (app + PostgreSQL RLS), audit trail, live Route & Risk Map and Weather Forecast from public data.
> - **2:** AI Consulting Centre with the Route Risk Analyst (bring-your-own Anthropic key; live test with a real key still pending).
> - **3:** CSV import for suppliers, products, inventory and shipments; Logistics Analytics.
> - **4:** weighted vendor scoring and allocation, Financial Intelligence, Product Lifecycle (BOM cost build-up).
> - **5:** Legal & Compliance register, Consumer Intelligence (consented surveys, NPS, themes), Organisational Memory.
> - **6:** approval workflow for high-impact actions (no self-approval) with in-app notifications.
>
> What each phase does **not** include is listed in [ROADMAP.md](documentation/ROADMAP.md). See also [AI.md](documentation/AI.md), [LIVE_DATA.md](documentation/LIVE_DATA.md) and [ASSUMPTIONS.md](documentation/ASSUMPTIONS.md).

**Live preview:** https://ritam45-debug.github.io/bachke-raho-agentic-ai/

## Quick start (local, no Docker)

```bash
# 1. API (Python 3.11+)
cd backend
pip install -r requirements-dev.txt
cp ../.env.example .env            # optional for dev; set JWT_SECRET to keep sessions across restarts
uvicorn app.main:app --reload       # http://localhost:8000/docs  (SQLite, tables auto-created)

# 2. Web (Node 20+), in a second terminal
cd frontend
npm install
npm run dev                         # http://localhost:5173  → "Register your company"
```

## Browser preview (claude.ai)

`npm run build:preview` (in `frontend/`) builds one self-contained HTML file. In it, a TypeScript port of the API
(`src/preview/backend.ts`) runs inside the page, so the whole app works with no server.
Data is stored only in the viewer's browser, so this is a product preview, **not** the secure deployment.
The same build is published to **GitHub Pages** on every push to `main` (`.github/workflows/pages.yml`).
Regenerate its data with `python scripts/build_preview_data.py` after changing `sample_data/`.

## Full stack with PostgreSQL + RLS

```bash
docker compose up --build           # http://localhost:8080
```

This runs Postgres 16 and applies migrations as an owner role. The API then connects as a **non-owner** role, so
Row-Level Security is enforced.

## Tests

```bash
cd backend && pytest -q                         # SQLite (24 tests, 3 Postgres-only skipped)
# Against Postgres with RLS (as CI does): see .github/workflows/ci.yml
cd frontend && npm test && npm run build        # unit tests, type-check + production build
```

## What's in Phase 1

| Area | Delivered |
|---|---|
| Tenancy | Self-service company registration (company, locations, admin); isolated workspaces |
| Auth | bcrypt, JWT access tokens, rotating refresh tokens with theft detection, lockout, logout/revocation |
| RBAC | Super Admin, Company Admin, Supply Chain / Procurement / Finance Manager, Analyst, Read-only |
| Isolation | Session-scoped queries + PostgreSQL RLS (`FORCE`), tested by deliberately unfiltered queries |
| Audit | Append-only log (DB trigger), filter and CSV export |
| Dashboard | Executive overview (KPIs and charts), Disruptions, Inventory, Shipments, Vendors, Products, Audit, Settings; dark/light; mobile |
| Route & Risk Map | Live map (OpenStreetMap), place search, routes by road/sea/air/rail, live risk score from weather, waves, earthquakes and natural events, history per route |
| Weather Forecast | 3–16-day forecasts for every site and route end, days flagged by IMD rain and Beaufort wind thresholds |
| Fast setup | Getting-started checklist, CSV import of locations and routes (auto-geocoded, all-or-nothing), one-click "Check all routes" |
| Ops | Alembic migrations, GitHub Actions CI (SQLite + Postgres + frontend), Dockerfiles, compose |

## Repository layout

```
backend/app/        api · security · models · schemas · services · analytics · database · core
                    agents · orchestrator · integrations · workflows · utilities  (reserved for Phases 2–6)
backend/migrations/ Alembic (0001 schema, 0002 Postgres RLS + append-only audit)
backend/tests/      auth, tenant isolation, RBAC, formulas, Postgres RLS
frontend/src/       pages, components, lib (api client, auth)
documentation/      ARCHITECTURE · ROADMAP · SECURITY · ASSUMPTIONS · LIVE_DATA · AI
scripts/            super-admin creation, DB init
```

## Rules this codebase keeps

- Never commit secrets; configuration comes from the environment.
- Every data row records where it came from (`data_source`, `verification`); live checks store their sources.
- Numbers come from tested functions. AI will explain them, not invent them.
- High-impact actions require an authorised human.
