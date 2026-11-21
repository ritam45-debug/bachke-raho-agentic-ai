# BAchke Raho Agnetic AI

**Predict. Prevent. Protect.** An enterprise multi-agent supply-chain intelligence platform.

> **Status: Phase 1 of 7 complete.** This phase delivers the foundation: multi-company registration, secure auth,
> role-based access, two-layer tenant isolation (app + PostgreSQL RLS), audit trail, a simulated demo company and a
> live executive dashboard. AI agents start in Phase 2. See [documentation/ROADMAP.md](documentation/ROADMAP.md).

## Quick start (local, no Docker)

```bash
# 1. API (Python 3.11+)
cd backend
pip install -r requirements-dev.txt
cp ../.env.example .env            # optional for dev; set JWT_SECRET to keep sessions across restarts
uvicorn app.main:app --reload       # http://localhost:8000/docs  (SQLite + demo data auto-seeded)

# 2. Web (Node 20+), in a second terminal
cd frontend
npm install
npm run dev                         # http://localhost:5173  → "Open demo workspace"
```

## Browser preview (claude.ai)

`npm run build:preview` (in `frontend/`) builds one self-contained HTML file. In it, a TypeScript port of the API
(`src/preview/backend.ts`) runs inside the page against the same demo data, so the whole app works with no server.
Data is stored only in the viewer's browser, so this is a product demo, **not** the secure deployment.
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
cd frontend && npm run build                    # type-check + production build
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
| Demo | *Aureon Electronics Pvt. Ltd.*: fictional, labelled **simulated** everywhere, read-only |
| Ops | Alembic migrations, GitHub Actions CI (SQLite + Postgres + frontend), Dockerfiles, compose |

## Repository layout

```
backend/app/        api · security · models · schemas · services · analytics · database · core
                    agents · orchestrator · integrations · workflows · utilities  (reserved for Phases 2–6)
backend/migrations/ Alembic (0001 schema, 0002 Postgres RLS + append-only audit)
backend/tests/      auth, tenant isolation, RBAC, formulas, Postgres RLS
frontend/src/       pages, components, lib (api client, auth)
sample_data/aureon/ simulated CSVs (also the future upload formats)
documentation/      ARCHITECTURE · ROADMAP · SECURITY · ASSUMPTIONS
scripts/            sample-data generator, super-admin creation, DB init
```

## Rules this codebase keeps

- Never commit secrets; configuration comes from the environment.
- Simulated data is labelled at the row level (`data_source`, `verification`) and in the UI.
- Numbers come from tested functions. AI will explain them, not invent them.
- High-impact actions require an authorised human.
