# Assumptions made without your input

Change any of these and the code or docs will follow.

1. **Product name spelling.** "BAchke Raho Agnetic AI" is used exactly as given in the brief; the repo folder uses "agentic", as in the brief's suggested structure.
2. **Primary market is India.** Default currency INR, crores/lakhs formatting, demo company in Pune. Currency is configurable per company.
3. **One user = one company.** Email is globally unique. Consultants serving several companies would need separate accounts (multi-membership can be added later).
4. **Self-service registration** creates an active workspace immediately. If you want platform approval before activation, set new companies to `suspended` and approve from `/admin/companies`.
5. **Super admin is a platform operator** who can list and suspend companies but cannot read any company's operational data. No super admin is created automatically; create one via a database script when needed.
6. **External AI processing is opt-in per company** and off by default.
7. **The demo workspace is read-only** and opened as an Analyst, so visitors cannot alter it.
8. **Disruptions are tenant-scoped in Phase 1.** A platform-wide `global_events` table with per-company impact records replaces this in Phase 3.
9. **Inventory demand inputs** (average daily demand, lead time, safety stock) are supplied with the data in Phase 1; forecasting them is Phase 3.
10. **All Aureon data is fictional**, including supplier and carrier names (marked "(fictional)").
