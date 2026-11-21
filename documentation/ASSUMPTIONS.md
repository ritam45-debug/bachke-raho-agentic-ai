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
