import { describe, expect, it } from 'vitest'
import { compareModes, performance, slipDays, type ShipmentRec } from './logistics'

const base: ShipmentRec = { reference: 'x', mode: 'sea', carrier: 'A', origin: 'X', destination: 'Y', status: 'delivered', quantity: 1, value: 1000,
  freight_cost: 100, original_eta: '2026-11-10T00:00:00Z', current_eta: '2026-11-10T00:00:00Z', delivered_at: '2026-11-10T00:00:00Z' }

describe('logistics', () => {
  it('measures slip only where it can be assessed', () => {
    expect(slipDays(base)).toBe(0)
    expect(slipDays({ ...base, delivered_at: '2026-11-13T00:00:00Z' })).toBe(3)
    expect(slipDays({ ...base, status: 'delayed', delivered_at: null, current_eta: '2026-11-15T00:00:00Z' })).toBe(5)
    expect(slipDays({ ...base, status: 'in_transit', delivered_at: null })).toBeNull()
    expect(slipDays({ ...base, status: 'cancelled' })).toBeNull()
    expect(slipDays({ ...base, original_eta: null })).toBeNull()
  })

  it('aggregates on-time %, average slip and freight share by group', () => {
    const rows = [base, { ...base, delivered_at: '2026-11-14T00:00:00Z' }, { ...base, carrier: 'B', freight_cost: null }]
    const [a, b] = performance(rows, (s) => s.carrier ?? '—')
    expect(a).toMatchObject({ key: 'A', shipments: 2, assessed: 2, onTimePct: 50, avgSlipDays: 2, freight: 200, freightPctOfValue: 10 })
    expect(b).toMatchObject({ key: 'B', shipments: 1, freightPctOfValue: null })
  })

  it('compares transport modes on landed cost', () => {
    const r = compareModes([
      { label: 'Sea', freight: 1000, transitDays: 30, onTimePct: 80, lateDaysIfLate: 7 },
      { label: 'Air', freight: 5000, transitDays: 3, onTimePct: 95, lateDaysIfLate: 1 },
    ], { goodsValue: 365000, carryingRatePct: 20, costPerLateDay: 2000 })
    const sea = r.find((x) => x.label === 'Sea')!
    expect(sea.pipelineCost).toBeCloseTo(6000)          // 365000 × 20% × 30/365
    expect(sea.expectedLateCost).toBeCloseTo(2800)      // 20% × 7 × 2000
    expect(sea.total).toBeCloseTo(9800)
    expect(r[0].label).toBe('Air')                      // 5000 + 600 + 100 = 5700 < 9800
  })
})
