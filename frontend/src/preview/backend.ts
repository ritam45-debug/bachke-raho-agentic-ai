// In-browser port of the FastAPI backend, used ONLY by the claude.ai preview build (VITE_PREVIEW=1).
// It mirrors the real API's routes, validation and rules so the same React app runs unchanged,
// but it is NOT a security boundary: everything lives in this viewer's browser storage.
import demo from './demoData.json'

type Rec = Record<string, unknown>
interface Company { id: string; name: string; slug: string; industry: string; company_size: string; headquarters: string; country: string | null; registration_number: string | null; status: string; is_demo: boolean; ai_external_processing: boolean; data_retention_days: number; created_at: string }
interface Profile { company_id: string; description: string | null; product_categories: string[]; admin_contact_name: string | null; admin_contact_email: string | null; admin_contact_phone: string | null; website: string | null; currency: string }
interface Loc { id: string; company_id: string; name: string; kind: string; city: string | null; country: string | null }
interface User { id: string; company_id: string; email: string; full_name: string; job_title: string | null; role: string; pw: string; salt: string; is_active: boolean; failed: number; locked_until: number | null; last_login_at: string | null; created_at: string }
interface Session { id: string; user_id: string; access: string; refresh: string; access_exp: number; refresh_exp: number; revoked: boolean }
interface Audit { id: string; company_id: string | null; actor_user_id: string | null; actor_type: string; action: string; entity_type: string | null; entity_id: string | null; outcome: string; ip_address: string | null; details: Rec; created_at: string }
interface State { v: 1; companies: Company[]; profiles: Profile[]; locations: Loc[]; users: User[]; sessions: Session[]; audit: Audit[]; ops: Record<string, Rec[]> }

const KEY = 'bra.preview.state.v1'
const ACCESS_MS = 30 * 60e3, REFRESH_MS = 7 * 864e5, MAX_FAIL = 5, LOCK_MS = 15 * 60e3
const ROLES = ['company_admin', 'supply_chain_manager', 'procurement_manager', 'finance_manager', 'analyst', 'read_only']
const ALL = ['company:read', 'company:update', 'users:read', 'users:manage', 'ops:read', 'ops:write', 'procurement:write', 'finance:read', 'audit:read', 'approvals:high_impact']
const PERMS: Record<string, string[]> = {
  company_admin: ALL,
  supply_chain_manager: ['company:read', 'users:read', 'ops:read', 'ops:write', 'finance:read', 'approvals:high_impact'],
  procurement_manager: ['company:read', 'users:read', 'ops:read', 'procurement:write', 'finance:read', 'approvals:high_impact'],
  finance_manager: ['company:read', 'users:read', 'ops:read', 'finance:read', 'approvals:high_impact'],
  analyst: ['company:read', 'ops:read', 'finance:read'],
  read_only: ['company:read', 'ops:read'],
}
const DEMO_EMAIL = 'demo.analyst@aureon-demo.invalid'

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
  const t0 = Date.now(), day = (o: string) => new Date(t0 + Number(o) * 864e5).toISOString()
  const cid = uid()
  const st: State = { v: 1, companies: [], profiles: [], locations: [], users: [], sessions: [], audit: [], ops: { suppliers: [], products: [], inventory: [], shipments: [], disruptions: [] } }
  st.companies.push({ id: cid, name: 'Aureon Electronics Pvt. Ltd. (Demo)', slug: 'aureon-electronics-demo', industry: 'Electronics manufacturing', company_size: '1001-5000', headquarters: 'Pune, India', country: 'India', registration_number: 'SIMULATED-U00000MH2015PTC000000', status: 'active', is_demo: true, ai_external_processing: false, data_retention_days: 730, created_at: nowIso() })
  st.profiles.push({ company_id: cid, currency: 'INR', website: null, description: 'SIMULATED demo company. Consumer and industrial electronics maker with three plants, three warehouses and a distribution centre in India.', product_categories: ['Energy devices', 'Portable power', 'Audio', 'Smart home', 'EV infrastructure'], admin_contact_name: 'Demo Administrator', admin_contact_email: 'demo.admin@aureon-demo.invalid', admin_contact_phone: null })
  const D = demo as Record<string, Record<string, string>[]>
  const locs: Record<string, string> = {}, sups: Record<string, string> = {}, prods: Record<string, string> = {}
  for (const r of D.locations) { const id = uid(); locs[r.name] = id; st.locations.push({ id, company_id: cid, name: r.name, kind: r.kind, city: r.city, country: r.country }) }
  for (const r of D.suppliers) { const id = uid(); sups[r.code] = id; st.ops.suppliers.push({ id, company_id: cid, code: r.code, name: r.name, category: r.category, country: r.country, city: r.city, on_time_delivery_rate: +r.on_time_delivery_rate, quality_score: +r.quality_score, avg_lead_time_days: +r.avg_lead_time_days, annual_spend: +r.annual_spend, is_active: true, data_source: 'simulated' }) }
  for (const r of D.products) { const id = uid(); prods[r.sku] = id; st.ops.products.push({ id, company_id: cid, sku: r.sku, name: r.name, kind: r.kind, category: r.category, unit: r.unit, unit_cost: +r.unit_cost, unit_price: r.unit_price ? +r.unit_price : null, primary_supplier_id: r.primary_supplier_code ? sups[r.primary_supplier_code] : null, data_source: 'simulated' }) }
  for (const r of D.inventory) st.ops.inventory.push({ id: uid(), company_id: cid, product_id: prods[r.sku], location_id: locs[r.location], quantity_on_hand: +r.quantity_on_hand, reorder_point: +r.reorder_point, safety_stock: +r.safety_stock, avg_daily_demand: +r.avg_daily_demand, lead_time_days: +r.lead_time_days, data_source: 'simulated' })
  for (const r of D.shipments) st.ops.shipments.push({ id: uid(), company_id: cid, reference: r.reference, direction: r.direction, supplier_id: r.supplier_code ? sups[r.supplier_code] : null, product_id: prods[r.sku], quantity: +r.quantity, value: +r.value, origin: r.origin, origin_country: r.origin_country, destination: r.destination, mode: r.mode, carrier: r.carrier, status: r.status, departed_at: +r.departed_offset_days <= 0 ? day(r.departed_offset_days) : null, original_eta: day(r.original_eta_offset_days), current_eta: day(r.current_eta_offset_days), data_source: 'simulated' })
  for (const r of D.disruptions) st.ops.disruptions.push({ id: uid(), company_id: cid, title: r.title, category: r.category, severity: +r.severity, status: r.status, verification: 'simulated', affected_countries: r.affected_countries.split(';').filter(Boolean), affected_supplier_ids: r.affected_supplier_codes.split(';').filter(Boolean).map((c) => sups[c]), summary: r.summary, source_name: 'Simulation engine (demo data)', source_url: null, detected_at: day(r.detected_offset_days), resolved_at: r.resolved_offset_days ? day(r.resolved_offset_days) : null })
  for (const [email, name, role] of [[DEMO_EMAIL, 'Demo Analyst', 'analyst'], ['demo.admin@aureon-demo.invalid', 'Demo Administrator', 'company_admin']])
    st.users.push({ id: uid(), company_id: cid, email, full_name: name, job_title: 'Simulated user', role, pw: rand(), salt: rand(), is_active: true, failed: 0, locked_until: null, last_login_at: null, created_at: nowIso() })
  st.audit.push(mkAudit({ action: 'demo.seeded', company_id: cid, actor_type: 'system', entity_type: 'company', entity_id: cid }))
  return st
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
  const locations = mine(S.locations, ctx).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).map(({ id, name, kind, city, country }) => ({ id, name, kind, city, country }))
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
  const sim = ctx.company?.is_demo || [...inv, ...ships, ...sups].some((x) => (x as Rec).data_source === 'simulated')
  return {
    data_mode: sim ? 'simulated' : 'company_data', currency: profile?.currency ?? 'INR',
    kpis: {
      inventory_value: Math.round(inv.reduce((a, i) => a + i.stock_value, 0) * 100) / 100, sku_locations: inv.length,
      at_risk_stock_positions: count(inv as Rec[], 'status', 'stockout') + count(inv as Rec[], 'status', 'critical'), reorder_needed: count(inv as Rec[], 'status', 'reorder'),
      open_shipments: ships.filter((s) => ['planned', 'in_transit', 'delayed'].includes(s.status as string)).length, delayed_shipments: count(ships, 'status', 'delayed'),
      delayed_shipment_value: ships.filter((s) => s.status === 'delayed').reduce((a, s) => a + (s.value as number), 0),
      active_disruptions: active.length, max_active_severity: active.length ? (active[0].severity as number) : 0, suppliers: sups.length, flagged_suppliers: flagged.length,
    },
    charts: {
      inventory_status: ORDER.map((status) => ({ status, count: count(inv as Rec[], 'status', status) })),
      inventory_value_by_location: Object.entries(byLoc).map(([location, value]) => ({ location, value: Math.round(value) })).sort((a, b) => b.value - a.value),
      shipment_status: ['planned', 'in_transit', 'delayed', 'delivered', 'cancelled'].map((status) => ({ status, count: count(ships, 'status', status) })),
      supplier_performance: sups.map((s) => ({ supplier: s.name, country: s.country, on_time_pct: Math.round((s.on_time_delivery_rate as number) * 1000) / 10, quality: s.quality_score })).sort((a, b) => a.on_time_pct - b.on_time_pct),
    },
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
    const c: Company = { id: uid(), name, slug, industry, company_size: body.company_size as string, headquarters: hq, country: (body.country as string) || null, registration_number: (body.registration_number as string) || null, status: 'active', is_demo: false, ai_external_processing: false, data_retention_days: 730, created_at: nowIso() }
    S.companies.push(c)
    S.profiles.push({ company_id: c.id, description: null, product_categories: ((body.product_categories as string[]) ?? []).map((x) => x.trim()).filter(Boolean), admin_contact_name: full, admin_contact_email: em, admin_contact_phone: (body.admin_phone as string) || null, website: null, currency: 'INR' })
    S.locations.push({ id: uid(), company_id: c.id, name: `${name} HQ`, kind: 'headquarters', city: hq, country: c.country })
    for (const l of (body.locations as Rec[]) ?? []) S.locations.push({ id: uid(), company_id: c.id, name: String(l.name), kind: String(l.kind), city: (l.city as string) || null, country: (l.country as string) || null })
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
  if (M('POST', '/auth/demo')) {
    const u = S.users.find((x) => x.email === DEMO_EMAIL)!
    u.last_login_at = nowIso()
    audit({ action: 'auth.demo_login', company_id: u.company_id, actor_user_id: u.id })
    return [200, issue(u)]
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
    only(body, ['name', 'industry', 'company_size', 'headquarters', 'description', 'product_categories', 'website', 'currency', 'ai_external_processing', 'data_retention_days'])
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
    const name = str(body, 'name', 2, 160)!
    if (!['headquarters', 'manufacturing', 'warehouse', 'distribution'].includes(body.kind as string)) v422('kind', 'Invalid location kind')
    const l: Loc = { id: uid(), company_id: ctx.company!.id, name, kind: body.kind as string, city: (body.city as string) || null, country: (body.country as string) || null }
    S.locations.push(l)
    audit({ action: 'location.created', company_id: l.company_id, actor_user_id: ctx.user.id, entity_type: 'location', entity_id: l.id, details: { kind: l.kind } })
    return [201, l]
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
