// In-browser port of the FastAPI backend, used ONLY by the claude.ai preview build (VITE_PREVIEW=1).
// It mirrors the real API's routes, validation and rules so the same React app runs unchanged,
// but it is NOT a security boundary: everything lives in this viewer's browser storage.
type Rec = Record<string, unknown>
interface Company { id: string; name: string; slug: string; industry: string; company_size: string; headquarters: string; country: string | null; registration_number: string | null; status: string; is_demo: boolean; ai_external_processing: boolean; ai_monthly_budget_usd: number; data_retention_days: number; created_at: string }
interface Profile { company_id: string; description: string | null; product_categories: string[]; admin_contact_name: string | null; admin_contact_email: string | null; admin_contact_phone: string | null; website: string | null; currency: string }
interface Loc { id: string; company_id: string; name: string; kind: string; city: string | null; country: string | null; latitude: number | null; longitude: number | null }
interface User { id: string; company_id: string; email: string; full_name: string; job_title: string | null; role: string; pw: string; salt: string; is_active: boolean; failed: number; locked_until: number | null; last_login_at: string | null; created_at: string }
interface Session { id: string; user_id: string; access: string; refresh: string; access_exp: number; refresh_exp: number; revoked: boolean }
interface Audit { id: string; company_id: string | null; actor_user_id: string | null; actor_type: string; action: string; entity_type: string | null; entity_id: string | null; outcome: string; ip_address: string | null; details: Rec; created_at: string }
interface State { v: 2; companies: Company[]; profiles: Profile[]; locations: Loc[]; users: User[]; sessions: Session[]; audit: Audit[]; ops: Record<string, Rec[]>; routes: Rec[]; checks: Rec[]; ai?: { convs: Rec[]; msgs: Rec[]; runs: Rec[]; steps: Rec[] } }

const KEY = 'bra.preview.state.v2' // v1 held the removed Aureon demo
const ACCESS_MS = 30 * 60e3, REFRESH_MS = 7 * 864e5, MAX_FAIL = 5, LOCK_MS = 15 * 60e3
const ROLES = ['company_admin', 'supply_chain_manager', 'procurement_manager', 'finance_manager', 'analyst', 'read_only']
const ALL = ['company:read', 'company:update', 'users:read', 'users:manage', 'ops:read', 'ops:write', 'procurement:write', 'finance:read', 'audit:read', 'approvals:high_impact', 'ai:use']
const PERMS: Record<string, string[]> = {
  company_admin: ALL,
  supply_chain_manager: ['company:read', 'users:read', 'ops:read', 'ops:write', 'finance:read', 'approvals:high_impact', 'ai:use'],
  procurement_manager: ['company:read', 'users:read', 'ops:read', 'procurement:write', 'finance:read', 'approvals:high_impact', 'ai:use'],
  finance_manager: ['company:read', 'users:read', 'ops:read', 'finance:read', 'approvals:high_impact', 'ai:use'],
  analyst: ['company:read', 'ops:read', 'finance:read', 'ai:use'],
  read_only: ['company:read', 'ops:read'],
}

const uid = () => crypto.randomUUID()
const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
const nowIso = () => new Date().toISOString()
async function hash(pw: string, salt: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pw))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

class HttpError extends Error { status: number; detail: unknown; constructor(s: number, d: unknown) { super(String(d)); this.status = s; this.detail = d } }
const err = (s: number, d: unknown): never => { throw new HttpError(s, d) }

// ---------- state ----------
let S: State
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)) } catch { /* storage unavailable: state lives in memory */ } }
function load(): State | null { try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : null } catch { return null } }

function seed(): State {
  try { localStorage.removeItem('bra.preview.state.v1') } catch { /* ignore */ }
  return { v: 2, companies: [], profiles: [], locations: [], users: [], sessions: [], audit: [], ops: { suppliers: [], products: [], inventory: [], shipments: [], disruptions: [] }, routes: [], checks: [] }
}

function mkAudit(a: Partial<Audit> & { action: string; company_id: string | null }): Audit {
  const details = Object.fromEntries(Object.entries(a.details ?? {}).map(([k, v]) => [k, /password|token|secret/i.test(k) ? '[redacted]' : v]))
  return { id: uid(), actor_user_id: null, actor_type: 'user', entity_type: null, entity_id: null, outcome: 'success', ip_address: 'browser-preview', created_at: nowIso(), ...a, details }
}
const audit = (a: Parameters<typeof mkAudit>[0]) => S.audit.push(mkAudit(a))

// ---------- validation (mirrors backend/app/schemas) ----------
const pwProblems = (p: string) => [p.length < 12 && 'must be at least 12 characters', !/[A-Za-z]/.test(p) && 'must contain a letter', !/\d/.test(p) && 'must contain a digit', !/[^A-Za-z0-9]/.test(p) && 'must contain a symbol'].filter(Boolean) as string[]
function v422(field: string, msg: string): never { return err(422, [{ loc: ['body', field], msg }]) }
function only(body: Rec, allowed: string[]) { for (const k of Object.keys(body)) if (!allowed.includes(k)) v422(k, 'Extra inputs are not permitted') }
function str(body: Rec, k: string, min: number, max: number, required = true) {
  const v = body[k]
  if (v == null || v === '') { if (required) v422(k, 'Field required'); return null }
  if (typeof v !== 'string') return v422(k, 'Input should be a valid string')
  const t = v.trim(); if (t.length < min) v422(k, `String should have at least ${min} characters`); if (t.length > max) v422(k, `String should have at most ${max} characters`)
  return t
}
const email = (body: Rec, k: string) => { const e = str(body, k, 3, 254)!; if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) v422(k, 'value is not a valid email address'); return e.toLowerCase() }

// ---------- auth ----------
interface Ctx { user: User; session: Session; company: Company | null }
function issue(user: User) {
  const s: Session = { id: uid(), user_id: user.id, access: rand(), refresh: rand(), access_exp: Date.now() + ACCESS_MS, refresh_exp: Date.now() + REFRESH_MS, revoked: false }
  S.sessions.push(s)
  return { access_token: s.access, refresh_token: s.refresh, token_type: 'bearer', expires_in: ACCESS_MS / 1000 }
}
function authCtx(token: string | null): Ctx {
  const s = token ? S.sessions.find((x) => x.access === token) : undefined
  const u = s && S.users.find((x) => x.id === s.user_id)
  if (!s || !u || s.revoked || s.access_exp < Date.now() || !u.is_active) return err(401, 'Not authenticated')
  const c = S.companies.find((x) => x.id === u.company_id) ?? null
  if (c && c.status !== 'active') err(403, 'Company workspace is not active')
  return { user: u, session: s, company: c }
}
function need(ctx: Ctx, perm: string) { if (!(PERMS[ctx.user.role] ?? []).includes(perm)) err(403, `Missing permission: ${perm}`) }
const noDemo = (ctx: Ctx) => { if (ctx.company?.is_demo) err(403, 'The demo workspace is read-only') }
const mine = <T extends { company_id: string | null }>(arr: T[], ctx: Ctx) => arr.filter((x) => x.company_id === ctx.user.company_id)
const revokeAll = (userId: string) => S.sessions.forEach((s) => { if (s.user_id === userId) s.revoked = true })

// ---------- locations & routes (mirror backend/app/api/company.py and routes_api.py) ----------
const KINDS = ['headquarters', 'manufacturing', 'warehouse', 'distribution']
function coord(v: unknown, field: string, lim: number): number | null {
  if (v == null || v === '') return null
  const n = Number(v); if (!Number.isFinite(n) || Math.abs(n) > lim) v422(field, `Must be between -${lim} and ${lim}`)
  return n
}
function locFrom(b: Rec, companyId: string): Loc {
  const name = str(b, 'name', 2, 160)!
  if (!KINDS.includes(b.kind as string)) v422('kind', 'Invalid location kind')
  return { id: uid(), company_id: companyId, name, kind: b.kind as string, city: (b.city as string) || null, country: (b.country as string) || null,
    latitude: coord(b.latitude, 'latitude', 90), longitude: coord(b.longitude, 'longitude', 180) }
}
const bandOf = (s: number) => (s >= 75 ? 'high' : s >= 50 ? 'elevated' : s >= 25 ? 'moderate' : 'low')
function ownRoute(ctx: Ctx, id: string): Rec { const r = (S.routes as Rec[]).find((x) => x.id === id && x.company_id === ctx.user.company_id); if (!r) err(404, 'Route not found'); return r! }
function routeEnd(ctx: Ctx, b: Rec, side: string): Rec {
  const id = b[`${side}_location_id`] as string | undefined, Side = side[0].toUpperCase() + side.slice(1)
  if (id) {
    const l = mine(S.locations, ctx).find((x) => x.id === id)
    if (!l) err(404, `${Side} location not found`)
    if (l!.latitude == null || l!.longitude == null) err(422, `${Side} location '${l!.name}' has no map coordinates yet`)
    return { [`${side}_location_id`]: l!.id, [`${side}_label`]: l!.name, [`${side}_lat`]: l!.latitude, [`${side}_lon`]: l!.longitude }
  }
  const label = b[`${side}_label`], lat = coord(b[`${side}_lat`], `${side}_lat`, 90), lon = coord(b[`${side}_lon`], `${side}_lon`, 180)
  if (!label || lat == null || lon == null) err(422, `${Side}: choose a saved location or give a label with latitude and longitude`)
  return { [`${side}_location_id`]: null, [`${side}_label`]: label, [`${side}_lat`]: lat, [`${side}_lon`]: lon }
}
function buildRoute(ctx: Ctx, b: Rec): Rec {
  const name = str(b, 'name', 2, 160)!
  if (!['sea', 'air', 'road', 'rail'].includes(b.mode as string)) v422('mode', 'Mode must be sea, air, road or rail')
  return { id: uid(), company_id: ctx.company!.id, name, mode: b.mode, notes: (b.notes as string) || null, created_by: ctx.user.id, created_at: nowIso(),
    ...routeEnd(ctx, b, 'origin'), ...routeEnd(ctx, b, 'destination') }
}
function latestCheck(routeId: unknown): Rec | null {
  return (S.checks as Rec[]).filter((c) => c.route_id === routeId).sort((a, b) => String(b.checked_at).localeCompare(String(a.checked_at)))[0] ?? null
}
const routeOut = (r: Rec) => ({ ...r, latest_check: latestCheck(r.id) })

// ---------- Phase 3 import validation (mirrors the Pydantic row models) ----------
const n = (v: unknown) => (v === '' || v == null ? null : Number(String(v).replace(/%$/, '')))
function rowErr(i: number, f: string, m: string): never { return err(422, `Row ${i}: ${f} – ${m}`) }
function reqStr(r: Rec, i: number, f: string, min = 1): string { const v = String(r[f] ?? '').trim(); if (v.length < min) rowErr(i, f, 'Field required'); return v }
function numIn(r: Rec, i: number, f: string, lo: number, hi = Infinity, required = false): number | null {
  const v = n(r[f]); if (v == null) { if (required) rowErr(i, f, 'Field required'); return null }
  if (!Number.isFinite(v) || v < lo || v > hi) rowErr(i, f, `must be between ${lo} and ${hi}`); return v
}
function oneOf(r: Rec, i: number, f: string, opts: string[]): string { const v = String(r[f] ?? '').trim(); if (!opts.includes(v)) rowErr(i, f, `must be one of ${opts.join(', ')}`); return v }
const dt = (v: unknown) => (v ? new Date(String(v)).toISOString() : null)

function importRows(entity: string, rows: Rec[], cid: string) {
  const T = (t: string) => (S.ops[t] as Rec[]).filter((x) => x.company_id === cid)
  let created = 0, updated = 0
  const upsert = (table: string, match: (x: Rec) => boolean, vals: Rec) => {
    const ex = T(table).find(match)
    if (ex) { for (const [k, v] of Object.entries(vals)) if (v != null) ex[k] = v; ex.data_source = 'upload'; updated++ }
    else { (S.ops[table] as Rec[]).push({ id: uid(), company_id: cid, data_source: 'upload', ...vals }); created++ }
  }
  if (entity === 'suppliers') {
    const parsed = rows.map((r, k) => { const i = k + 1; let otd = n(r.on_time_delivery_rate); if (otd != null && otd > 1) otd = otd / 100
      if (otd != null && (otd < 0 || otd > 1)) rowErr(i, 'on_time_delivery_rate', 'must be 0–1 or 0–100%')
      return { code: reqStr(r, i, 'code'), name: reqStr(r, i, 'name', 2), category: reqStr(r, i, 'category'), country: reqStr(r, i, 'country', 2), city: r.city || null,
        on_time_delivery_rate: otd, quality_score: numIn(r, i, 'quality_score', 0, 100), avg_lead_time_days: numIn(r, i, 'avg_lead_time_days', 0, 730),
        annual_spend: numIn(r, i, 'annual_spend', 0), financial_stability_score: numIn(r, i, 'financial_stability_score', 0, 100),
        risk_exposure_score: numIn(r, i, 'risk_exposure_score', 0, 100), capacity_units_per_month: numIn(r, i, 'capacity_units_per_month', 0), moq_units: numIn(r, i, 'moq_units', 0), is_active: true } })
    parsed.forEach((v) => upsert('suppliers', (x) => x.code === v.code, v))
  } else if (entity === 'products') {
    const sup = Object.fromEntries(T('suppliers').map((x) => [x.code, x.id]))
    const parsed = rows.map((r, k) => { const i = k + 1, code = String(r.primary_supplier_code ?? '').trim()
      if (code && !sup[code]) err(422, `Unknown supplier code(s): ${code}. Import suppliers first.`)
      return { sku: reqStr(r, i, 'sku'), name: reqStr(r, i, 'name', 2), kind: oneOf(r, i, 'kind', ['raw_material', 'component', 'finished_good']), category: reqStr(r, i, 'category'),
        unit: String(r.unit || 'unit'), unit_cost: numIn(r, i, 'unit_cost', 0, Infinity, true), unit_price: numIn(r, i, 'unit_price', 0), conversion_cost: numIn(r, i, 'conversion_cost', 0),
        primary_supplier_id: code ? sup[code] : null } })
    parsed.forEach((v) => upsert('products', (x) => x.sku === v.sku, v))
  } else if (entity === 'inventory') {
    const prods = Object.fromEntries(T('products').map((x) => [x.sku, x])), sups = Object.fromEntries(T('suppliers').map((x) => [x.id, x]))
    const locs = Object.fromEntries(S.locations.filter((l) => l.company_id === cid).map((l) => [l.name.toLowerCase(), l]))
    const parsed = rows.map((r, k) => { const i = k + 1, sku = reqStr(r, i, 'sku'), loc = reqStr(r, i, 'location')
      if (!prods[sku]) err(422, `Row ${i}: unknown SKU '${sku}'. Import products and add locations first.`)
      if (!locs[loc.toLowerCase()]) err(422, `Row ${i}: unknown location '${loc}'. Import products and add locations first.`)
      const d = numIn(r, i, 'avg_daily_demand', 0, Infinity, true)!, sup = sups[prods[sku].primary_supplier_id as string]
      const lead = numIn(r, i, 'lead_time_days', 0, 730) ?? Number(sup?.avg_lead_time_days ?? 0), ss = numIn(r, i, 'safety_stock', 0) ?? 0
      return { product_id: prods[sku].id, location_id: locs[loc.toLowerCase()].id, quantity_on_hand: numIn(r, i, 'quantity_on_hand', 0, Infinity, true),
        avg_daily_demand: d, lead_time_days: lead, safety_stock: ss, reorder_point: numIn(r, i, 'reorder_point', 0) ?? d * lead + ss } })
    parsed.forEach((v) => upsert('inventory', (x) => x.product_id === v.product_id && x.location_id === v.location_id, v))
  } else {
    const sup = Object.fromEntries(T('suppliers').map((x) => [x.code, x.id])), prods = Object.fromEntries(T('products').map((x) => [x.sku, x.id]))
    const parsed = rows.map((r, k) => { const i = k + 1, sc = String(r.supplier_code ?? '').trim(), sku = String(r.sku ?? '').trim()
      if (sc && !sup[sc]) err(422, `Row ${i}: unknown supplier '${sc}'`); if (sku && !prods[sku]) err(422, `Row ${i}: unknown SKU '${sku}'`)
      const oe = dt(r.original_eta)
      return { reference: reqStr(r, i, 'reference'), direction: oneOf(r, i, 'direction', ['inbound', 'outbound']), supplier_id: sc ? sup[sc] : null, product_id: sku ? prods[sku] : null,
        quantity: numIn(r, i, 'quantity', 0, Infinity, true), value: numIn(r, i, 'value', 0, Infinity, true), freight_cost: numIn(r, i, 'freight_cost', 0),
        origin: reqStr(r, i, 'origin'), origin_country: reqStr(r, i, 'origin_country', 2), destination: reqStr(r, i, 'destination'), mode: oneOf(r, i, 'mode', ['sea', 'air', 'road', 'rail']),
        carrier: r.carrier || null, status: oneOf(r, i, 'status', ['planned', 'in_transit', 'delayed', 'delivered', 'cancelled']),
        departed_at: dt(r.departed_at), original_eta: oe, current_eta: dt(r.current_eta) ?? oe, delivered_at: dt(r.delivered_at) } })
    parsed.forEach((v) => upsert('shipments', (x) => x.reference === v.reference, v))
  }
  return { created, updated }
}

// ---------- AI pricing (mirrors backend PRICES; USD per million tokens) ----------
const AI_PRICES: Record<string, { label: string; in: number; out: number; long_in?: number; long_out?: number; long_from?: number }> = {
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', in: 2, out: 10 },
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5', in: 0.1, out: 0.5, long_in: 0.5, long_out: 2.5, long_from: 100000 },
}
function aiCost(model: string, i: number, o: number) {
  const p = AI_PRICES[model]; const long = p.long_from != null && i > p.long_from
  return (i * (long ? p.long_in! : p.in) + o * (long ? p.long_out! : p.out)) / 1e6
}

// ---------- analytics (mirrors backend/app/analytics/inventory_metrics.py) ----------
const cover = (q: number, d: number) => (d > 0 ? q / d : null)
function stockStatus(q: number, rop: number, ss: number, d: number, lt: number) {
  if (q <= 0) return 'stockout'
  const c = cover(q, d)
  if (q <= ss || (c !== null && c < lt)) return 'critical'
  if (q <= rop) return 'reorder'
  if (c !== null && c > 4 * Math.max(lt, 1) && c > 120) return 'excess'
  return 'healthy'
}
const ORDER = ['stockout', 'critical', 'reorder', 'healthy', 'excess']

function companyOut(ctx: Ctx) {
  const c = ctx.company!, p = S.profiles.find((x) => x.company_id === c.id)!
  const locations = mine(S.locations, ctx).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).map(({ id, name, kind, city, country, latitude, longitude }) => ({ id, name, kind, city, country, latitude, longitude }))
  const { company_id: _omit, ...profile } = p; void _omit
  return { ...c, ...profile, locations }
}
const userOut = (u: User) => ({ id: u.id, email: u.email, full_name: u.full_name, job_title: u.job_title, role: u.role, is_active: u.is_active, last_login_at: u.last_login_at, created_at: u.created_at })

function inventoryRows(ctx: Ctx) {
  const prods = Object.fromEntries(mine(S.ops.products as never[], ctx).map((p: Rec) => [p.id, p]))
  const locs = Object.fromEntries(mine(S.locations, ctx).map((l) => [l.id, l]))
  return (mine(S.ops.inventory as never[], ctx) as Rec[]).map((i) => {
    const p = prods[i.product_id as string] as Rec | undefined, n = (k: string) => i[k] as number
    const c = cover(n('quantity_on_hand'), n('avg_daily_demand'))
    return { id: i.id, sku: p?.sku, product: p?.name, kind: p?.kind, location: locs[i.location_id as string]?.name, quantity_on_hand: n('quantity_on_hand'), reorder_point: n('reorder_point'), safety_stock: n('safety_stock'), avg_daily_demand: n('avg_daily_demand'), lead_time_days: n('lead_time_days'), days_of_cover: c === null ? null : Math.round(c * 10) / 10, stock_value: Math.round(n('quantity_on_hand') * ((p?.unit_cost as number) ?? 0) * 100) / 100, status: stockStatus(n('quantity_on_hand'), n('reorder_point'), n('safety_stock'), n('avg_daily_demand'), n('lead_time_days')), data_source: i.data_source }
  }).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || String(a.sku).localeCompare(String(b.sku)))
}
const supName = (ctx: Ctx) => Object.fromEntries((mine(S.ops.suppliers as never[], ctx) as Rec[]).map((s) => [s.id, s.name]))

function overview(ctx: Ctx) {
  const inv = inventoryRows(ctx), ships = mine(S.ops.shipments as never[], ctx) as Rec[], sups = mine(S.ops.suppliers as never[], ctx) as Rec[], dis = mine(S.ops.disruptions as never[], ctx) as Rec[]
  const count = (arr: Rec[], k: string, v: string) => arr.filter((x) => x[k] === v).length
  const byLoc: Record<string, number> = {}
  inv.forEach((i) => { byLoc[i.location ?? 'Unknown'] = (byLoc[i.location ?? 'Unknown'] ?? 0) + i.stock_value })
  const active = dis.filter((d) => d.status !== 'resolved').sort((a, b) => (b.severity as number) - (a.severity as number))
  const flagged = sups.filter((s) => ((s.on_time_delivery_rate as number) ?? 1) < 0.85 || ((s.quality_score as number) ?? 100) < 80)
  const profile = S.profiles.find((p) => p.company_id === ctx.user.company_id)
  const sim = [...inv, ...ships, ...sups].some((x) => (x as Rec).data_source === 'simulated')
  const routes = mine(S.routes as never[], ctx) as Rec[], locsAll = mine(S.locations, ctx)
  const withCheck = routes.map((r) => ({ r, c: latestCheck(r.id) })).filter((x) => x.c) as { r: Rec; c: Rec }[]
  return {
    data_mode: sim ? 'simulated' : 'company_data', currency: profile?.currency ?? 'INR',
    kpis: {
      inventory_value: Math.round(inv.reduce((a, i) => a + i.stock_value, 0) * 100) / 100, sku_locations: inv.length,
      at_risk_stock_positions: count(inv as Rec[], 'status', 'stockout') + count(inv as Rec[], 'status', 'critical'), reorder_needed: count(inv as Rec[], 'status', 'reorder'),
      open_shipments: ships.filter((s) => ['planned', 'in_transit', 'delayed'].includes(s.status as string)).length, delayed_shipments: count(ships, 'status', 'delayed'),
      delayed_shipment_value: ships.filter((s) => s.status === 'delayed').reduce((a, s) => a + (s.value as number), 0),
      active_disruptions: active.length, max_active_severity: active.length ? (active[0].severity as number) : 0, suppliers: sups.length, flagged_suppliers: flagged.length,
      locations: locsAll.length, locations_mapped: locsAll.filter((l) => l.latitude != null && l.longitude != null).length, routes: routes.length,
      routes_checked: withCheck.length, routes_elevated_or_high: withCheck.filter((x) => (x.c.score as number) >= 50).length,
      max_route_score: withCheck.reduce((m, x) => Math.max(m, x.c.score as number), 0),
      last_route_check_at: withCheck.reduce<string | null>((m, x) => (!m || String(x.c.checked_at) > m ? String(x.c.checked_at) : m), null),
    },
    charts: {
      inventory_status: ORDER.map((status) => ({ status, count: count(inv as Rec[], 'status', status) })),
      inventory_value_by_location: Object.entries(byLoc).map(([location, value]) => ({ location, value: Math.round(value) })).sort((a, b) => b.value - a.value),
      shipment_status: ['planned', 'in_transit', 'delayed', 'delivered', 'cancelled'].map((status) => ({ status, count: count(ships, 'status', status) })),
      supplier_performance: sups.map((s) => ({ supplier: s.name, country: s.country, on_time_pct: Math.round((s.on_time_delivery_rate as number) * 1000) / 10, quality: s.quality_score })).sort((a, b) => a.on_time_pct - b.on_time_pct),
    },
    route_risks: withCheck.sort((a, b) => (b.c.score as number) - (a.c.score as number)).slice(0, 8).map(({ r, c }) => {
      const f = ((c.factors as Rec[]) ?? []).reduce<Rec | null>((m, x) => (!m || Number(x.points) > Number(m.points) ? x : m), null)
      return { id: r.id, name: r.name, mode: r.mode, score: c.score, band: c.band, checked_at: c.checked_at, top_factor: f ? f.detail : null }
    }),
    active_disruptions: active.map((d) => ({ id: d.id, title: d.title, severity: d.severity, verification: d.verification, category: d.category, affected_countries: d.affected_countries })),
    rules: { flagged_supplier: 'on-time delivery < 85% or quality < 80', severity_note: 'Severity is a rule-based 0–100 score, not a statistical probability.' },
  }
}

function csvOf(rows: Audit[]) {
  const esc = (v: unknown) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const cols = ['created_at', 'action', 'outcome', 'actor_type', 'actor_user_id', 'entity_type', 'entity_id', 'ip_address', 'details'] as const
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}

// ---------- router ----------
async function route(method: string, path: string, q: URLSearchParams, body: Rec, token: string | null): Promise<[number, unknown]> {
  const M = (m: string, p: string | RegExp) => method === m && (typeof p === 'string' ? path === p : p.test(path))

  if (M('POST', '/auth/register-company')) {
    only(body, ['company_name', 'industry', 'company_size', 'headquarters', 'country', 'registration_number', 'product_categories', 'locations', 'admin_full_name', 'admin_email', 'admin_job_title', 'admin_phone', 'password', 'accept_terms'])
    const name = str(body, 'company_name', 2, 200)!, industry = str(body, 'industry', 2, 120)!, hq = str(body, 'headquarters', 2, 200)!
    if (!['1-50', '51-200', '201-1000', '1001-5000', '5000+'].includes(body.company_size as string)) v422('company_size', 'Invalid company size')
    const full = str(body, 'admin_full_name', 2, 160)!, em = email(body, 'admin_email'), pw = String(body.password ?? '')
    const probs = pwProblems(pw); if (probs.length) v422('password', 'Value error, Password ' + probs.join('; '))
    if (body.accept_terms !== true) v422('accept_terms', 'Value error, Terms and data-processing notice must be accepted')
    if (S.users.some((u) => u.email === em)) err(409, 'An account with this email already exists')
    const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'company'
    let slug = base, n = 1; while (S.companies.some((c) => c.slug === slug)) slug = `${base}-${++n}`
    const c: Company = { id: uid(), name, slug, industry, company_size: body.company_size as string, headquarters: hq, country: (body.country as string) || null, registration_number: (body.registration_number as string) || null, status: 'active', is_demo: false, ai_external_processing: false, ai_monthly_budget_usd: 10, data_retention_days: 730, created_at: nowIso() }
    S.companies.push(c)
    S.profiles.push({ company_id: c.id, description: null, product_categories: ((body.product_categories as string[]) ?? []).map((x) => x.trim()).filter(Boolean), admin_contact_name: full, admin_contact_email: em, admin_contact_phone: (body.admin_phone as string) || null, website: null, currency: 'INR' })
    S.locations.push({ id: uid(), company_id: c.id, name: `${name} HQ`, kind: 'headquarters', city: hq, country: c.country, latitude: null, longitude: null })
    for (const l of (body.locations as Rec[]) ?? []) S.locations.push(locFrom(l, c.id))
    const salt = rand()
    const u: User = { id: uid(), company_id: c.id, email: em, full_name: full, job_title: (body.admin_job_title as string) || null, role: 'company_admin', pw: await hash(pw, salt), salt, is_active: true, failed: 0, locked_until: null, last_login_at: nowIso(), created_at: nowIso() }
    S.users.push(u)
    audit({ action: 'company.registered', company_id: c.id, actor_user_id: u.id, entity_type: 'company', entity_id: c.id, details: { name, locations: ((body.locations as Rec[]) ?? []).length + 1 } })
    return [201, issue(u)]
  }
  if (M('POST', '/auth/login')) {
    const em = email(body, 'email'), pw = String(body.password ?? '')
    const u = S.users.find((x) => x.email === em)
    const bad = () => err(401, 'Invalid email or password')
    if (!u) { await hash(pw, 'timing'); bad() }
    const user = u!
    if ((user.locked_until && user.locked_until > Date.now()) || !user.is_active) { audit({ action: 'auth.login', company_id: user.company_id, actor_user_id: user.id, outcome: 'denied', details: { reason: user.is_active ? 'locked' : 'inactive' } }); save(); bad() }
    if ((await hash(pw, user.salt)) !== user.pw) {
      user.failed += 1; const details: Rec = { attempt: user.failed }
      if (user.failed >= MAX_FAIL) { user.locked_until = Date.now() + LOCK_MS; user.failed = 0; details.locked_minutes = 15 }
      audit({ action: 'auth.login', company_id: user.company_id, actor_user_id: user.id, outcome: 'failure', details }); save(); bad()
    }
    user.failed = 0; user.locked_until = null; user.last_login_at = nowIso()
    audit({ action: 'auth.login', company_id: user.company_id, actor_user_id: user.id })
    return [200, issue(user)]
  }
  if (M('POST', '/auth/refresh')) {
    const s = S.sessions.find((x) => x.refresh === body.refresh_token)
    if (!s || s.refresh_exp < Date.now()) err(401, 'Invalid refresh token')
    const sess = s!, u = S.users.find((x) => x.id === sess.user_id)
    if (sess.revoked) { revokeAll(sess.user_id); audit({ action: 'auth.refresh_reuse_detected', company_id: u?.company_id ?? null, actor_user_id: sess.user_id, outcome: 'denied' }); save(); err(401, 'Invalid refresh token') }
    if (!u || !u.is_active) err(401, 'Invalid refresh token')
    sess.revoked = true
    return [200, issue(u!)]
  }
  const ctx = authCtx(token)
  if (M('POST', '/auth/logout')) { ctx.session.revoked = true; audit({ action: 'auth.logout', company_id: ctx.user.company_id, actor_user_id: ctx.user.id }); return [204, null] }
  if (M('GET', '/auth/me')) {
    const u = ctx.user
    return [200, { id: u.id, email: u.email, full_name: u.full_name, job_title: u.job_title, role: u.role, permissions: [...(PERMS[u.role] ?? [])].sort(), company_id: u.company_id, company_name: ctx.company?.name ?? null, is_demo: !!ctx.company?.is_demo }]
  }
  // ---- company ----
  if (M('GET', '/company')) { need(ctx, 'company:read'); return [200, companyOut(ctx)] }
  if (M('PATCH', '/company')) {
    need(ctx, 'company:update'); noDemo(ctx)
    only(body, ['name', 'industry', 'company_size', 'headquarters', 'description', 'product_categories', 'website', 'currency', 'ai_external_processing', 'ai_monthly_budget_usd', 'data_retention_days'])
    if (body.ai_monthly_budget_usd != null && (Number(body.ai_monthly_budget_usd) < 0 || Number(body.ai_monthly_budget_usd) > 100000)) v422('ai_monthly_budget_usd', 'Must be between 0 and 100000')
    if (body.currency != null && !/^[A-Z]{3}$/.test(String(body.currency))) v422('currency', 'Value error, Currency must be an ISO 4217 code, e.g. INR')
    if (body.data_retention_days != null && ((body.data_retention_days as number) < 30 || (body.data_retention_days as number) > 3650)) v422('data_retention_days', 'Must be between 30 and 3650')
    for (const k of ['name', 'industry', 'headquarters']) if (k in body) str(body, k, 2, 200)
    const c = ctx.company! as unknown as Rec, p = S.profiles.find((x) => x.company_id === ctx.company!.id)! as unknown as Rec
    for (const [k, v] of Object.entries(body)) (['description', 'product_categories', 'website', 'currency'].includes(k) ? p : c)[k] = v
    audit({ action: 'company.updated', company_id: ctx.company!.id, actor_user_id: ctx.user.id, entity_type: 'company', entity_id: ctx.company!.id, details: { fields: Object.keys(body).sort() } })
    return [200, companyOut(ctx)]
  }
  if (M('POST', '/company/locations')) {
    need(ctx, 'company:update'); noDemo(ctx)
    const l = locFrom(body, ctx.company!.id)
    S.locations.push(l)
    audit({ action: 'location.created', company_id: l.company_id, actor_user_id: ctx.user.id, entity_type: 'location', entity_id: l.id, details: { kind: l.kind } })
    return [201, l]
  }
  if (M('POST', '/company/locations/bulk')) {
    need(ctx, 'company:update'); noDemo(ctx)
    const rows = (body.locations as Rec[]) ?? []
    if (!rows.length || rows.length > 500) v422('locations', 'Provide 1–500 locations')
    const built = rows.map((r, i) => { try { return locFrom(r, ctx.company!.id) } catch (e) { if (e instanceof HttpError) err(422, [{ loc: ['body', 'locations', i], msg: `Row ${i + 1}: ${JSON.stringify(e.detail)}` }]); throw e } })
    S.locations.push(...built)
    audit({ action: 'location.bulk_imported', company_id: ctx.company!.id, actor_user_id: ctx.user.id, entity_type: 'location', details: { count: built.length } })
    return [201, built]
  }
  if (M('PATCH', /^\/company\/locations\/[\w-]+$/)) {
    need(ctx, 'company:update'); noDemo(ctx)
    const id = path.split('/').pop()!, l = mine(S.locations, ctx).find((x) => x.id === id)
    if (!l) err(404, 'Location not found')
    Object.assign(l!, { ...locFrom(body, l!.company_id), id: l!.id })
    audit({ action: 'location.updated', company_id: l!.company_id, actor_user_id: ctx.user.id, entity_type: 'location', entity_id: id })
    return [200, l]
  }
  if (M('DELETE', /^\/company\/locations\/[\w-]+$/)) {
    need(ctx, 'company:update'); noDemo(ctx)
    const id = path.split('/').pop()!, l = mine(S.locations, ctx).find((x) => x.id === id)
    if (!l) err(404, 'Location not found')
    if (l!.kind === 'headquarters' && mine(S.locations, ctx).filter((x) => x.kind === 'headquarters').length <= 1) err(409, 'A company must keep at least one headquarters')
    S.locations = S.locations.filter((x) => x.id !== id)
    audit({ action: 'location.deleted', company_id: ctx.company!.id, actor_user_id: ctx.user.id, entity_type: 'location', entity_id: id })
    return [204, null]
  }
  // ---- users ----
  if (M('GET', '/users/roles')) { need(ctx, 'users:read'); return [200, ROLES] }
  if (M('GET', '/users')) { need(ctx, 'users:read'); return [200, mine(S.users, ctx).map(userOut)] }
  if (M('POST', '/users')) {
    need(ctx, 'users:manage'); noDemo(ctx)
    only(body, ['email', 'full_name', 'job_title', 'role', 'temporary_password'])
    const em = email(body, 'email'), full = str(body, 'full_name', 2, 160)!
    if (!ROLES.includes(body.role as string)) v422('role', `Value error, Role must be one of ${ROLES.join(', ')}`)
    const probs = pwProblems(String(body.temporary_password ?? '')); if (probs.length) v422('temporary_password', 'Value error, Password ' + probs.join('; '))
    if (S.users.some((u) => u.email === em)) err(409, 'An account with this email already exists')
    const salt = rand()
    const u: User = { id: uid(), company_id: ctx.company!.id, email: em, full_name: full, job_title: (body.job_title as string) || null, role: body.role as string, pw: await hash(String(body.temporary_password), salt), salt, is_active: true, failed: 0, locked_until: null, last_login_at: null, created_at: nowIso() }
    S.users.push(u)
    audit({ action: 'user.created', company_id: u.company_id, actor_user_id: ctx.user.id, entity_type: 'user', entity_id: u.id, details: { role: u.role } })
    return [201, userOut(u)]
  }
  if (M('PATCH', /^\/users\/[\w-]+$/)) {
    need(ctx, 'users:manage'); noDemo(ctx)
    only(body, ['full_name', 'job_title', 'role', 'is_active'])
    const id = path.split('/').pop()!, u = mine(S.users, ctx).find((x) => x.id === id)
    if (!u) err(404, 'User not found')
    const target = u!
    if (body.role != null && !ROLES.includes(body.role as string)) v422('role', 'Invalid role')
    const demoting = (body.role != null && body.role !== 'company_admin') || body.is_active === false
    const others = mine(S.users, ctx).filter((x) => x.role === 'company_admin' && x.is_active && x.id !== target.id).length
    if (target.role === 'company_admin' && demoting && others === 0) err(409, 'A company must keep at least one active administrator')
    Object.assign(target, body)
    if (body.is_active === false || 'role' in body) revokeAll(target.id)
    audit({ action: 'user.updated', company_id: target.company_id, actor_user_id: ctx.user.id, entity_type: 'user', entity_id: target.id, details: body })
    return [200, userOut(target)]
  }
  // ---- routes & live risk ----
  if (M('GET', '/routes')) { need(ctx, 'ops:read'); return [200, mine(S.routes as never[], ctx).map((r: Rec) => routeOut(r))] }
  if (M('POST', '/routes')) {
    need(ctx, 'ops:write')
    const r = buildRoute(ctx, body); S.routes.push(r)
    audit({ action: 'route.created', company_id: ctx.company!.id, actor_user_id: ctx.user.id, entity_type: 'route', entity_id: r.id as string, details: { name: r.name, mode: r.mode } })
    return [201, routeOut(r)]
  }
  if (M('POST', '/routes/bulk')) {
    need(ctx, 'ops:write')
    const rows = (body.routes as Rec[]) ?? []
    if (!rows.length || rows.length > 500) v422('routes', 'Provide 1–500 routes')
    const built = rows.map((row, i) => { try { return buildRoute(ctx, row) } catch (e) { if (e instanceof HttpError) err(e.status, `Row ${i + 1}: ${typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail)}`); throw e } })
    S.routes.push(...built)
    audit({ action: 'route.bulk_imported', company_id: ctx.company!.id, actor_user_id: ctx.user.id, entity_type: 'route', details: { count: built.length } })
    return [201, built.map((r) => routeOut(r))]
  }
  if (M('DELETE', /^\/routes\/[\w-]+$/)) {
    need(ctx, 'ops:write')
    const r = ownRoute(ctx, path.split('/')[2])
    S.routes = S.routes.filter((x) => x.id !== r.id); S.checks = S.checks.filter((c) => c.route_id !== r.id)
    audit({ action: 'route.deleted', company_id: ctx.company!.id, actor_user_id: ctx.user.id, entity_type: 'route', entity_id: r.id as string, details: { name: r.name } })
    return [204, null]
  }
  if (M('POST', /^\/routes\/[\w-]+\/risk-checks$/)) {
    need(ctx, 'ops:read')
    const r = ownRoute(ctx, path.split('/')[2])
    const factors = (body.factors as Rec[]) ?? [], sources = (body.sources as Rec[]) ?? []
    if (!sources.length) v422('sources', 'At least one source is required')
    const expected = Math.min(100, factors.reduce((a, f) => a + Number(f.points ?? 0), 0))
    if (body.score !== expected) err(422, `Score ${body.score} does not match its factors (${expected})`)
    const c = { id: uid(), company_id: ctx.company!.id, route_id: r.id, score: expected, band: bandOf(expected), factors, sources,
      forecast_days: body.forecast_days ?? 3, rules_version: String(body.rules_version ?? ''), checked_by: ctx.user.id, checked_at: nowIso() }
    S.checks.push(c)
    audit({ action: 'route.risk_checked', company_id: ctx.company!.id, actor_user_id: ctx.user.id, entity_type: 'route', entity_id: r.id as string,
      details: { score: c.score, band: c.band, failed_sources: sources.filter((x) => x.status === 'failed').map((x) => x.name) } })
    return [201, c]
  }
  if (M('GET', /^\/routes\/[\w-]+\/risk-checks$/)) {
    need(ctx, 'ops:read')
    const r = ownRoute(ctx, path.split('/')[2])
    return [200, S.checks.filter((c) => c.route_id === r.id).sort((a, b) => String(b.checked_at).localeCompare(String(a.checked_at))).slice(0, 50)]
  }
  // ---- AI (mirrors backend/app/api/ai.py) ----
  if (path.startsWith('/ai/')) {
    need(ctx, 'ai:use')
    const A = (S.ai ??= { convs: [], msgs: [], runs: [], steps: [] })
    const cid = ctx.company!.id, uidMe = ctx.user.id
    const ownConv = (id: unknown) => { const c = A.convs.find((x) => x.id === id && x.company_id === cid && x.user_id === uidMe); if (!c) err(404, 'Conversation not found'); return c! }
    const ownRun = (id: unknown) => { const r = A.runs.find((x) => x.id === id && x.company_id === cid); if (!r || (r.user_id !== uidMe && !(PERMS[ctx.user.role] ?? []).includes('audit:read'))) err(404, 'Run not found'); return r! }
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)
    const spent = () => A.runs.filter((r) => r.company_id === cid && String(r.started_at) >= monthStart.toISOString()).reduce((a, r) => a + Number(r.cost_usd), 0)
    const runOut = (r: Rec) => Object.fromEntries(['id', 'conversation_id', 'agent', 'model', 'autonomy_level', 'status', 'input_tokens', 'output_tokens', 'cost_usd', 'tool_calls', 'error', 'started_at', 'finished_at'].map((k) => [k, r[k]]))
    const seg = path.split('/')
    if (M('GET', '/ai/status')) {
      const sp = spent(), budget = ctx.company!.ai_monthly_budget_usd ?? 10
      return [200, { consent: ctx.company!.ai_external_processing, budget_usd: budget, spent_month_usd: sp, remaining_usd: Math.max(0, budget - sp),
        runs_month: A.runs.filter((r) => r.company_id === cid && String(r.started_at) >= monthStart.toISOString()).length,
        models: Object.entries(AI_PRICES).map(([id, p]) => ({ id, label: p.label, input_per_mtok: p.in, output_per_mtok: p.out })),
        agents: [{ id: 'route_risk_analyst', label: 'Route Risk Analyst' }, { id: 'orchestrator', label: 'Orchestrator' }] }]
    }
    if (M('GET', '/ai/conversations')) return [200, A.convs.filter((c) => c.company_id === cid && c.user_id === uidMe).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))]
    if (M('POST', '/ai/conversations')) { const c = { id: uid(), company_id: cid, user_id: uidMe, title: str(body, 'title', 1, 200)!, created_at: nowIso(), updated_at: nowIso() }; A.convs.push(c); return [201, c] }
    if (M('GET', /^\/ai\/conversations\/[\w-]+$/)) { const c = ownConv(seg[3]); return [200, { ...c, messages: A.msgs.filter((m) => m.conversation_id === c.id) }] }
    if (M('DELETE', /^\/ai\/conversations\/[\w-]+$/)) {
      const c = ownConv(seg[3]); A.convs = A.convs.filter((x) => x !== c); A.msgs = A.msgs.filter((m) => m.conversation_id !== c.id)
      audit({ action: 'ai.conversation_deleted', company_id: cid, actor_user_id: uidMe, entity_type: 'ai_conversation', entity_id: c.id as string }); return [204, null]
    }
    if (M('POST', /^\/ai\/conversations\/[\w-]+\/messages$/)) {
      const c = ownConv(seg[3]); if (!['user', 'assistant'].includes(body.role as string)) v422('role', 'user or assistant')
      if (body.run_id) ownRun(body.run_id)
      const m = { id: uid(), company_id: cid, conversation_id: c.id, role: body.role, content: str(body, 'content', 1, 40000), run_id: body.run_id ?? null, created_at: nowIso() }
      A.msgs.push(m); c.updated_at = nowIso(); return [201, m]
    }
    if (M('POST', '/ai/runs')) {
      if (!AI_PRICES[body.model as string]) err(422, `Unsupported model. Use one of: ${Object.keys(AI_PRICES).join(', ')}`)
      if (!['route_risk_analyst', 'orchestrator'].includes(body.agent as string)) err(422, 'Unknown agent')
      if (![undefined, 1, 2].includes(body.autonomy_level as number)) v422('autonomy_level', 'Must be 1 or 2')
      if (!ctx.company!.ai_external_processing) { audit({ action: 'ai.run_blocked', company_id: cid, actor_user_id: uidMe, outcome: 'denied', details: { reason: 'consent_off' } }); save()
        err(403, "AI is switched off for this company. An administrator can enable 'Allow external AI processing' in Company Settings.") }
      const sp = spent(), budget = ctx.company!.ai_monthly_budget_usd ?? 10
      if (sp >= budget) { audit({ action: 'ai.run_blocked', company_id: cid, actor_user_id: uidMe, outcome: 'denied', details: { reason: 'budget', spent_usd: sp } }); save()
        err(429, `This month's AI budget ($${budget.toFixed(2)}) has been reached. An administrator can raise it in Company Settings.`) }
      if (body.conversation_id) ownConv(body.conversation_id)
      const r = { id: uid(), company_id: cid, conversation_id: body.conversation_id ?? null, user_id: uidMe, agent: body.agent, model: body.model, autonomy_level: body.autonomy_level ?? 2,
        status: 'running', input_tokens: 0, output_tokens: 0, cost_usd: 0, tool_calls: 0, error: null, started_at: nowIso(), finished_at: null }
      A.runs.push(r)
      audit({ action: 'ai.run_started', company_id: cid, actor_user_id: uidMe, actor_type: 'agent', entity_type: 'agent_run', entity_id: r.id, details: { agent: r.agent, model: r.model } })
      return [201, { ...runOut(r), remaining_usd: budget - sp }]
    }
    if (M('POST', /^\/ai\/runs\/[\w-]+\/steps$/)) {
      const r = ownRun(seg[3]); if (r.user_id !== uidMe || r.status !== 'running') err(409, 'Steps can only be added to your own running run')
      if (A.steps.some((x) => x.run_id === r.id && x.seq === body.seq)) err(409, `Step ${body.seq} already recorded`)
      let payload = (body.payload as Rec) ?? {}; const raw = JSON.stringify(payload); if (raw.length > 20000) payload = { truncated: true, preview: raw.slice(0, 20000) }
      A.steps.push({ id: uid(), company_id: cid, run_id: r.id, seq: body.seq, kind: body.kind, name: body.name ?? null, payload, created_at: nowIso() }); return [201, { seq: body.seq }]
    }
    if (M('POST', /^\/ai\/runs\/[\w-]+\/finish$/)) {
      const r = ownRun(seg[3]); if (r.user_id !== uidMe || r.status !== 'running') err(409, 'Only your own running run can be finished')
      const calls = (body.calls as { input_tokens: number; output_tokens: number }[]) ?? []
      Object.assign(r, { status: body.status, input_tokens: calls.reduce((a, c) => a + c.input_tokens, 0), output_tokens: calls.reduce((a, c) => a + c.output_tokens, 0),
        cost_usd: Math.round(calls.reduce((a, c) => a + aiCost(r.model as string, c.input_tokens, c.output_tokens), 0) * 1e6) / 1e6, tool_calls: body.tool_calls ?? 0, error: body.error ?? null, finished_at: nowIso() })
      audit({ action: 'ai.run_finished', company_id: cid, actor_user_id: uidMe, actor_type: 'agent', entity_type: 'agent_run', entity_id: r.id as string, outcome: r.status === 'completed' ? 'success' : 'failure',
        details: { agent: r.agent, model: r.model, status: r.status, input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_usd: r.cost_usd, tool_calls: r.tool_calls } })
      return [200, runOut(r)]
    }
    if (M('GET', '/ai/runs')) return [200, A.runs.filter((r) => r.company_id === cid && (r.user_id === uidMe || (PERMS[ctx.user.role] ?? []).includes('audit:read'))).map(runOut).reverse()]
    if (M('GET', /^\/ai\/runs\/[\w-]+$/)) { const r = ownRun(seg[3]); return [200, { ...runOut(r), steps: A.steps.filter((x) => x.run_id === r.id).sort((a, b) => Number(a.seq) - Number(b.seq)) }] }
  }
  // ---- Phase 3 imports & deletes (mirror backend/app/api/data_import.py) ----
  const bulk = M('POST', /^\/(suppliers|products|inventory|shipments)\/bulk$/)
  if (bulk || M('DELETE', /^\/(suppliers|products|inventory|shipments)\/[\w-]+$/)) {
    const entity = path.split('/')[1], perms = PERMS[ctx.user.role] ?? []
    const allowed = ['suppliers', 'products'].includes(entity) ? perms.includes('ops:write') || perms.includes('procurement:write') : perms.includes('ops:write')
    if (!allowed) err(403, 'Missing permission')
    const table = entity === 'inventory' ? 'inventory' : entity
    const cid = ctx.company!.id
    if (!bulk) {
      const id = path.split('/')[2], row = (S.ops[table] as Rec[]).find((x) => x.id === id && x.company_id === cid)
      if (!row) err(404, 'Not found')
      S.ops[table] = (S.ops[table] as Rec[]).filter((x) => x !== row)
      audit({ action: `${entity}.deleted`, company_id: cid, actor_user_id: ctx.user.id, entity_type: entity, entity_id: id }); return [204, null]
    }
    const rows = (body.rows as Rec[]) ?? []
    if (!rows.length || rows.length > 2000) v422('rows', 'Provide 1–2000 rows')
    const res = importRows(entity, rows, cid)
    audit({ action: `${entity === 'inventory' ? 'inventory' : entity.slice(0, -1)}.imported`, company_id: cid, actor_user_id: ctx.user.id, entity_type: entity, details: res })
    return [200, res]
  }
  // ---- operations & dashboard ----
  if (M('GET', '/dashboard/overview')) { need(ctx, 'ops:read'); return [200, overview(ctx)] }
  if (M('GET', '/inventory')) { need(ctx, 'ops:read'); const st = q.get('status'); return [200, inventoryRows(ctx).filter((r) => !st || r.status === st)] }
  if (M('GET', '/suppliers')) { need(ctx, 'ops:read'); return [200, (mine(S.ops.suppliers as never[], ctx) as Rec[]).sort((a, b) => String(a.name).localeCompare(String(b.name)))] }
  if (M('GET', '/products')) {
    need(ctx, 'ops:read'); const sn = supName(ctx)
    return [200, (mine(S.ops.products as never[], ctx) as Rec[]).map((p) => ({ ...p, primary_supplier: sn[p.primary_supplier_id as string] ?? null }) as Rec).sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.sku).localeCompare(String(b.sku)))]
  }
  if (M('GET', '/shipments')) {
    need(ctx, 'ops:read'); const sn = supName(ctx), st = q.get('status')
    const pn = Object.fromEntries((mine(S.ops.products as never[], ctx) as Rec[]).map((p) => [p.id, p.name]))
    return [200, (mine(S.ops.shipments as never[], ctx) as Rec[]).filter((s) => !st || s.status === st).map((s) => ({
      ...s, supplier: sn[s.supplier_id as string] ?? null, product: pn[s.product_id as string] ?? null,
      delay_days: s.original_eta && s.current_eta ? Math.round((Date.parse(s.current_eta as string) - Date.parse(s.original_eta as string)) / 864e4) / 10 : null,
    }) as Rec).sort((a, b) => String(a.current_eta).localeCompare(String(b.current_eta)))]
  }
  if (M('GET', '/disruptions')) {
    need(ctx, 'ops:read'); const sn = supName(ctx)
    return [200, (mine(S.ops.disruptions as never[], ctx) as Rec[]).map((d) => ({ ...d, affected_suppliers: ((d.affected_supplier_ids as string[]) ?? []).map((x) => sn[x]).filter(Boolean) }) as Rec).sort((a, b) => String(b.detected_at).localeCompare(String(a.detected_at)))]
  }
  // ---- audit ----
  if (M('GET', '/audit-logs') || M('GET', '/audit-logs/export')) {
    need(ctx, 'audit:read')
    const act = q.get('action')
    const rows = mine(S.audit, ctx).filter((a) => !act || a.action.startsWith(act)).sort((a, b) => b.created_at.localeCompare(a.created_at))
    if (path.endsWith('/export')) { audit({ action: 'audit.exported', company_id: ctx.company!.id, actor_user_id: ctx.user.id }); return [200, csvOf(rows)] }
    const limit = Math.min(Number(q.get('limit') ?? 100), 500), offset = Number(q.get('offset') ?? 0)
    return [200, rows.slice(offset, offset + limit)]
  }
  return err(404, 'Not Found')
}

export async function previewFetch(input: string, init: RequestInit = {}): Promise<Response> {
  S ??= load() ?? seed()
  const url = new URL(input, 'https://preview.local')
  const path = url.pathname.replace(/^\/api\/v1/, '')
  const token = (new Headers(init.headers).get('Authorization') ?? '').replace(/^Bearer /, '') || null
  let body: Rec = {}
  try { body = init.body ? JSON.parse(String(init.body)) : {} } catch { return new Response(JSON.stringify({ detail: 'Invalid JSON' }), { status: 400 }) }
  await new Promise((r) => setTimeout(r, 60)) // keep loading states honest
  try {
    const [status, data] = await route((init.method ?? 'GET').toUpperCase(), path, url.searchParams, body, token)
    save()
    if (status === 204) return new Response(null, { status })
    if (typeof data === 'string') return new Response(data, { status, headers: { 'content-type': 'text/csv' } })
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  } catch (e) {
    if (e instanceof HttpError) return new Response(JSON.stringify({ detail: e.detail }), { status: e.status, headers: { 'content-type': 'application/json' } })
    console.error(e)
    return new Response(JSON.stringify({ detail: 'Preview backend error' }), { status: 500, headers: { 'content-type': 'application/json' } })
  }
}

export function resetPreview() { try { localStorage.removeItem(KEY); sessionStorage.clear() } catch { /* ignore */ } S = seed(); save() }
