# Assumptions made without your input

Change any of these and the code or docs will follow.

1. **Product name spelling.** "BAchke Raho Agnetic AI" is used exactly as given in the brief; the repo folder uses "agentic", as in the brief's suggested structure.
2. **Primary market is India.** Default currency INR, crores/lakhs formatting. Currency is configurable per company.
3. **One user = one company.** Email is globally unique. Consultants serving several companies would need separate accounts (multi-membership can be added later).
4. **Self-service registration** creates an active workspace immediately. If you want platform approval before activation, set new companies to `suspended` and approve from `/admin/companies`.
5. **Super admin is a platform operator** who can list and suspend companies but cannot read any company's operational data. No super admin is created automatically; create one via a database script when needed.
6. **External AI processing is opt-in per company** and off by default.
7. **No demo company.** The Aureon example from the original brief was removed on request; new companies start empty and use the setup checklist and CSV import.
8. **Disruptions are tenant-scoped in Phase 1.** A platform-wide `global_events` table with per-company impact records replaces this in Phase 3.
9. **Inventory demand inputs** (average daily demand, lead time, safety stock) are supplied with the data in Phase 1; forecasting them is Phase 3.
10. **Live risk thresholds** for waves, earthquakes and natural-event radii are platform defaults; wind and rain thresholds follow Beaufort and IMD (see LIVE_DATA.md).
11. **Live feeds are called from the browser** for now (works on static hosting). Moving them server-side, with a scheduler, comes with Phase 3.

## Phase 4 calculations (estimates, not forecasts)
- **Vendor score** = Σ weight × sub-score (0–100). Price and lead time are min–max scaled across the suppliers being compared; quality, on-time rate and financial stability use their own 0–100 scale; risk uses 100 − risk exposure. A missing input scores 0 and is flagged, so incomplete suppliers are never silently favoured.
- **Allocation** is a rule-based heuristic (primary share to rank 1, remainder to rank 2, capped by capacity, MOQ respected, shortfall passed down the ranking). It is not a linear-programming optimum; the brief's LP is deferred because no solver runs in the static build.
- **Holding cost** default carrying rate 20%/year is a planning convention, not a measured figure for any company. Replace it in Financial Intelligence → assumptions.
- **Disruption impact** = days × revenue/day × margin + days × downtime/day + expediting + penalties. **Expected loss** = likelihood × impact; likelihood is the user's own judgement, never a model output.
