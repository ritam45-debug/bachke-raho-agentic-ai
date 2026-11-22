import { describe, expect, it } from 'vitest'
import { allocate, scoreSuppliers, type SupplierIn, type Weights } from './vendorScoring'
import { breakEvenDays, disruptionImpact, holdingCost, mitigationRoi, sensitivity } from './finance'
import { costBuildUp, supplierExposure } from './bom'

const W: Weights = { cost: 25, quality: 20, reliability: 20, lead_time: 15, financial: 10, risk: 10 }
const S = (id: string, o: Partial<SupplierIn>): SupplierIn => ({ id, name: id, quote: null, quality_score: null, on_time_delivery_rate: null, avg_lead_time_days: null,
  financial_stability_score: null, risk_exposure_score: null, capacity_units_per_month: null, moq_units: null, ...o })

describe('vendor scoring', () => {
  const a = S('A', { quote: 100, quality_score: 90, on_time_delivery_rate: 0.95, avg_lead_time_days: 10, financial_stability_score: 80, risk_exposure_score: 20 })
  const b = S('B', { quote: 80, quality_score: 70, on_time_delivery_rate: 0.8, avg_lead_time_days: 30, financial_stability_score: 60, risk_exposure_score: 50 })

  it('computes sub-scores and weighted totals exactly', () => {
    const [first, second] = scoreSuppliers([a, b], W)
    // A: cost 0, quality 90, rel 95, lead 100, fin 80, risk 80 → 0 + 18 + 19 + 15 + 8 + 8 = 68
    expect(first.id).toBe('A'); expect(first.total).toBeCloseTo(68)
    // B: cost 100, quality 70, rel 80, lead 0, fin 60, risk 50 → 25 + 14 + 16 + 0 + 6 + 5 = 66
    expect(second.total).toBeCloseTo(66); expect(second.rank).toBe(2)
  })
  it('rejects weights not totalling 100 and penalises missing data visibly', () => {
    expect(() => scoreSuppliers([a], { ...W, cost: 30 })).toThrow(/100%/)
    const [, c] = scoreSuppliers([a, S('C', { quote: 90 })], W)
    expect(c.missing).toEqual(['quality', 'reliability', 'lead_time', 'financial', 'risk'])
  })
  it('allocates with dual sourcing, capacity caps, MOQ and shortfall pass-down', () => {
    const ranked = scoreSuppliers([{ ...a, capacity_units_per_month: 600, moq_units: 100 }, { ...b, capacity_units_per_month: 1000, moq_units: 400 }], W)
    const r = allocate(ranked, 1000, 'dual', 70)
    // A target 700 → capped 600; B target 300 → below MOQ 400 → raised to 400; total 1000
    expect(r.allocations.map((x) => [x.id, x.units])).toEqual([['A', 600], ['B', 400]])
    expect(r.unmet).toBe(0)
    const tight = allocate(scoreSuppliers([{ ...a, capacity_units_per_month: 300 }, { ...b, capacity_units_per_month: 200 }], W), 1000, 'single')
    expect(tight.allocations.map((x) => x.units)).toEqual([300, 200]); expect(tight.unmet).toBe(500)
  })
})

describe('finance', () => {
  it('holding cost', () => { expect(holdingCost(3_650_000, 20)).toEqual({ annual: 730_000, monthly: 730_000 / 12, daily: 2000 }) })
  const imp = { days: 10, revenuePerDayAtRisk: 1_000_000, grossMarginPct: 30, downtimeCostPerDay: 200_000, expediteCost: 500_000, penaltyCost: 100_000 }
  it('disruption impact', () => {
    const r = disruptionImpact(imp)
    expect(r).toMatchObject({ lostMargin: 3_000_000, downtime: 2_000_000, total: 5_600_000, perDay: 560_000 })
  })
  it('mitigation ROI, break-even likelihood and break-even days', () => {
    const r = mitigationRoi({ impactTotal: 5_600_000, likelihoodPct: 50, effectivenessPct: 80, mitigationCost: 1_000_000 })
    expect(r.expectedLoss).toBe(2_800_000); expect(r.benefit).toBe(2_240_000); expect(r.roiPct).toBeCloseTo(124)
    expect(r.breakEvenLikelihoodPct).toBeCloseTo(22.32, 1)
    expect(breakEvenDays(560_000, 80, 1_000_000)).toBeCloseTo(2.232, 2)
  })
  it('sensitivity grid has days × likelihood cells', () => {
    const g = sensitivity(imp, { effectivenessPct: 80, mitigationCost: 1_000_000 })
    expect(g).toHaveLength(4); expect(g[1].days).toBe(10); expect(g[1].cells[2].net).toBeCloseTo(1_240_000)
  })
})

describe('bill of materials', () => {
  const P = (id: string, o: object) => ({ id, sku: id, name: id, kind: 'component', unit_cost: 0, unit_price: null, conversion_cost: null, primary_supplier_id: null, ...o })
  const products = [P('FG', { kind: 'finished_good', unit_cost: 900, unit_price: 1500, conversion_cost: 150 }), P('STEEL', { unit_cost: 120, primary_supplier_id: 's1' }), P('HINGE', { unit_cost: 15, primary_supplier_id: 's2' })]
  const bom = [{ id: 'b1', parent_product_id: 'FG', component_product_id: 'STEEL', quantity_per_unit: 5 }, { id: 'b2', parent_product_id: 'FG', component_product_id: 'HINGE', quantity_per_unit: 4 }]
  it('builds cost and margin from components', () => {
    const c = costBuildUp(products[0], bom, products)
    expect(c.material).toBe(660); expect(c.builtCost).toBe(810); expect(c.variance).toBe(-90); expect(c.margin).toBe(690)
    const exp = supplierExposure(c.lines, [{ id: 's1', name: 'S1', country: 'IN', on_time_delivery_rate: 0.9, risk_exposure_score: 10 }, { id: 's2', name: 'S2', country: 'VN', on_time_delivery_rate: 0.8, risk_exposure_score: 40 }])
    expect(exp[0].supplier?.name).toBe('S1'); expect(exp[0].sharePct).toBeCloseTo(600 / 660 * 100)
  })
})
