// Phase 3 logistics analytics: deterministic calculations on the company's own shipment records.
export interface ShipmentRec {
  reference: string; mode: string; carrier: string | null; origin: string; destination: string; status: string
  quantity: number; value: number; freight_cost: number | null; original_eta: string | null; current_eta: string | null; delivered_at: string | null
}

export interface PerfRow {
  key: string; shipments: number; assessed: number; onTimePct: number | null; avgSlipDays: number | null
  goodsValue: number; freight: number; freightPctOfValue: number | null; delayed: number
}

const days = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 864e5

/**
 * On time = delivered on or before the original ETA. Delayed in transit = current ETA after the original ETA.
 * Shipments without an original ETA (or still planned/in transit on schedule) are not assessed.
 */
export function slipDays(s: ShipmentRec): number | null {
  if (!s.original_eta || s.status === 'cancelled') return null
  if (s.status === 'delivered' && s.delivered_at) return days(s.delivered_at, s.original_eta)
  if (s.current_eta && (s.status === 'delayed' || days(s.current_eta, s.original_eta) > 0)) return days(s.current_eta, s.original_eta)
  return null
}

export function performance(rows: ShipmentRec[], keyOf: (s: ShipmentRec) => string): PerfRow[] {
  const groups = new Map<string, ShipmentRec[]>()
  for (const s of rows) { const k = keyOf(s); groups.set(k, [...(groups.get(k) ?? []), s]) }
  return [...groups.entries()].map(([key, g]) => {
    const slips = g.map(slipDays).filter((x): x is number => x != null)
    const freightRows = g.filter((s) => s.freight_cost != null)
    const freight = freightRows.reduce((a, s) => a + (s.freight_cost ?? 0), 0)
    const valueWithFreight = freightRows.reduce((a, s) => a + s.value, 0)
    return {
      key, shipments: g.length, assessed: slips.length,
      onTimePct: slips.length ? (slips.filter((d) => d <= 0).length / slips.length) * 100 : null,
      avgSlipDays: slips.length ? slips.reduce((a, d) => a + Math.max(0, d), 0) / slips.length : null,
      goodsValue: g.reduce((a, s) => a + s.value, 0), freight,
      freightPctOfValue: valueWithFreight ? (freight / valueWithFreight) * 100 : null,
      delayed: g.filter((s) => s.status === 'delayed').length,
    }
  }).sort((a, b) => b.shipments - a.shipments)
}

export interface ModeOption { label: string; freight: number; transitDays: number; onTimePct: number; lateDaysIfLate: number }
export interface ModeInputs { goodsValue: number; carryingRatePct: number; costPerLateDay: number }
export interface ModeResult extends ModeOption { pipelineCost: number; expectedLateCost: number; total: number }

/**
 * Landed-cost comparison for one shipment across transport options:
 *   pipeline carrying cost = goods value × annual carrying rate × transit days / 365
 *   expected lateness cost = (1 − on-time share) × late days × cost per late day
 *   total = freight + pipeline + expected lateness
 * Inputs are the user's assumptions and are shown with the result.
 */
export function compareModes(opts: ModeOption[], i: ModeInputs): ModeResult[] {
  return opts.map((o) => {
    const pipelineCost = i.goodsValue * (i.carryingRatePct / 100) * (o.transitDays / 365)
    const expectedLateCost = (1 - o.onTimePct / 100) * o.lateDaysIfLate * i.costPerLateDay
    return { ...o, pipelineCost, expectedLateCost, total: o.freight + pipelineCost + expectedLateCost }
  }).sort((a, b) => a.total - b.total)
}
