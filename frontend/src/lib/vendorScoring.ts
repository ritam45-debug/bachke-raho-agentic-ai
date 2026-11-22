// Phase 4 weighted vendor evaluation and allocation. Deterministic maths; the inputs and every sub-score are shown.
export type Criterion = 'cost' | 'quality' | 'reliability' | 'lead_time' | 'financial' | 'risk'
export type Weights = Record<Criterion, number>
export const CRITERIA: { key: Criterion; label: string; basis: string }[] = [
  { key: 'cost', label: 'Purchase cost', basis: 'quoted unit price, cheapest = 100, dearest = 0 (min–max across the suppliers compared)' },
  { key: 'quality', label: 'Quality', basis: 'quality score as recorded (0–100)' },
  { key: 'reliability', label: 'Delivery reliability', basis: 'on-time delivery rate × 100' },
  { key: 'lead_time', label: 'Lead time', basis: 'average lead time, shortest = 100, longest = 0 (min–max)' },
  { key: 'financial', label: 'Financial stability', basis: 'your 0–100 assessment' },
  { key: 'risk', label: 'Risk exposure', basis: '100 − your 0–100 risk exposure score' },
]

export interface SupplierIn {
  id: string; name: string; quote: number | null; quality_score: number | null; on_time_delivery_rate: number | null
  avg_lead_time_days: number | null; financial_stability_score: number | null; risk_exposure_score: number | null
  capacity_units_per_month: number | null; moq_units: number | null
}
export interface Scored extends SupplierIn { sub: Record<Criterion, number | null>; total: number; missing: Criterion[]; rank: number }

export function weightsTotal(w: Weights) { return Object.values(w).reduce((a, b) => a + b, 0) }

const minMax = (v: number | null, lo: number, hi: number, lowerIsBetter: boolean) => {
  if (v == null) return null
  if (hi === lo) return 100
  const s = ((v - lo) / (hi - lo)) * 100
  return lowerIsBetter ? 100 - s : s
}

/** Missing inputs score 0 for that criterion (conservative) and are listed, so gaps cannot silently help a supplier. */
export function scoreSuppliers(sups: SupplierIn[], w: Weights): Scored[] {
  if (Math.abs(weightsTotal(w) - 100) > 0.001) throw new Error('Weights must total 100%')
  const range = (f: (s: SupplierIn) => number | null) => {
    const vals = sups.map(f).filter((x): x is number => x != null)
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 0]
  }
  const [qLo, qHi] = range((s) => s.quote), [lLo, lHi] = range((s) => s.avg_lead_time_days)
  const scored = sups.map((s) => {
    const sub: Record<Criterion, number | null> = {
      cost: minMax(s.quote, qLo, qHi, true),
      quality: s.quality_score,
      reliability: s.on_time_delivery_rate == null ? null : s.on_time_delivery_rate * 100,
      lead_time: minMax(s.avg_lead_time_days, lLo, lHi, true),
      financial: s.financial_stability_score,
      risk: s.risk_exposure_score == null ? null : 100 - s.risk_exposure_score,
    }
    const missing = (Object.keys(sub) as Criterion[]).filter((k) => sub[k] == null && w[k] > 0)
    const total = (Object.keys(sub) as Criterion[]).reduce((a, k) => a + ((sub[k] ?? 0) * w[k]) / 100, 0)
    return { ...s, sub, total, missing, rank: 0 }
  }).sort((a, b) => b.total - a.total)
  scored.forEach((s, i) => { s.rank = i + 1 })
  return scored
}

export interface Allocation { id: string; name: string; units: number; sharePct: number; note?: string }
export interface AllocationResult { allocations: Allocation[]; unmet: number; notes: string[] }

/**
 * Rule-based allocation of monthly demand to ranked suppliers:
 *  1. target split: primary share to the best supplier, the rest to the next (dual sourcing), or 100% (single);
 *  2. each allocation is capped at the supplier's monthly capacity;
 *  3. an allocation below the supplier's MOQ is raised to the MOQ if demand and capacity allow, otherwise dropped;
 *  4. any shortfall is passed down the ranking to suppliers with spare capacity.
 * A heuristic, not a mathematical optimum; the notes explain every adjustment.
 */
export function allocate(ranked: Scored[], demand: number, strategy: 'single' | 'dual', primarySharePct = 70): AllocationResult {
  const notes: string[] = []
  const alloc = new Map<string, number>()
  const cap = (s: Scored) => s.capacity_units_per_month ?? Infinity
  const targets = strategy === 'single' || ranked.length < 2
    ? [[ranked[0], demand]] as const
    : [[ranked[0], demand * primarySharePct / 100], [ranked[1], demand * (100 - primarySharePct) / 100]] as const
  for (const [s, t] of targets) {
    if (!s) continue
    let u = Math.min(t, cap(s))
    if (u < t) notes.push(`${s.name}: capped at capacity ${cap(s)} units`)
    if (s.moq_units && u > 0 && u < s.moq_units) {
      if (s.moq_units <= cap(s) && s.moq_units <= demand) { notes.push(`${s.name}: raised from ${Math.round(u)} to MOQ ${s.moq_units}`); u = s.moq_units }
      else { notes.push(`${s.name}: dropped, ${Math.round(u)} units is below MOQ ${s.moq_units}`); u = 0 }
    }
    alloc.set(s.id, u)
  }
  // rebalance: if MOQ raises pushed the total over demand, trim the lower-ranked allocation (never below its MOQ)
  let total = [...alloc.values()].reduce((a, b) => a + b, 0)
  if (total > demand) {
    for (const s of [...ranked].reverse()) {
      const u = alloc.get(s.id) ?? 0, floor = s.moq_units ?? 0
      const cut = Math.min(total - demand, u - floor)
      if (cut > 0) { alloc.set(s.id, u - cut); total -= cut }
      if (total <= demand) break
    }
  }
  // pass any shortfall down the ranking
  let short = demand - [...alloc.values()].reduce((a, b) => a + b, 0)
  for (const s of ranked) {
    if (short <= 1e-9) break
    const have = alloc.get(s.id) ?? 0, spare = cap(s) - have
    if (spare <= 0) continue
    let add = Math.min(spare, short)
    if (have === 0 && s.moq_units && add < s.moq_units) { if (s.moq_units <= spare) add = s.moq_units; else continue }
    alloc.set(s.id, have + add); short -= add
    notes.push(`${s.name}: +${Math.round(add)} units to cover shortfall`)
  }
  const allocations = ranked.filter((s) => (alloc.get(s.id) ?? 0) > 0)
    .map((s) => ({ id: s.id, name: s.name, units: alloc.get(s.id)!, sharePct: (alloc.get(s.id)! / demand) * 100 }))
  const unmet = Math.max(0, short)
  if (unmet > 0) notes.push(`${Math.round(unmet)} units cannot be placed with the capacity available`)
  return { allocations, unmet, notes }
}
