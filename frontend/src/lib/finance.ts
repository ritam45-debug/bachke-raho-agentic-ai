// Phase 4 financial intelligence. Every figure is an ESTIMATE built from the inputs shown; inputs are assumptions
// unless they come from the company's own records (marked as such in the UI).

/** Annual cost of holding inventory = inventory value × carrying-cost rate. */
export function holdingCost(inventoryValue: number, carryingPct: number) {
  const annual = inventoryValue * carryingPct / 100
  return { annual, monthly: annual / 12, daily: annual / 365 }
}

export interface ImpactIn {
  days: number                 // expected disruption length
  revenuePerDayAtRisk: number  // revenue that cannot be shipped per disrupted day
  grossMarginPct: number       // margin lost on that revenue
  downtimeCostPerDay: number   // idle labour, fixed overhead absorbed, etc.
  expediteCost: number         // one-off premium freight / spot buys
  penaltyCost: number          // contractual penalties
}
export function disruptionImpact(i: ImpactIn) {
  const lostMargin = i.days * i.revenuePerDayAtRisk * i.grossMarginPct / 100
  const downtime = i.days * i.downtimeCostPerDay
  const total = lostMargin + downtime + i.expediteCost + i.penaltyCost
  return { lostMargin, downtime, expedite: i.expediteCost, penalties: i.penaltyCost, total, perDay: i.days ? total / i.days : 0 }
}

export interface MitigationIn { impactTotal: number; likelihoodPct: number; effectivenessPct: number; mitigationCost: number }
/**
 * Expected loss = likelihood × impact. Benefit = expected loss × share the mitigation avoids.
 * ROI = (benefit − cost) ÷ cost. Break-even likelihood = the likelihood at which benefit equals cost.
 */
export function mitigationRoi(m: MitigationIn) {
  const expectedLoss = m.impactTotal * m.likelihoodPct / 100
  const benefit = expectedLoss * m.effectivenessPct / 100
  const net = benefit - m.mitigationCost
  const roiPct = m.mitigationCost > 0 ? (net / m.mitigationCost) * 100 : null
  const denom = m.impactTotal * m.effectivenessPct / 100
  const breakEvenLikelihoodPct = denom > 0 ? (m.mitigationCost / denom) * 100 : null
  return { expectedLoss, benefit, net, roiPct, breakEvenLikelihoodPct, worthIt: net > 0 }
}

/** Break-even disruption length: days at which avoided losses equal the mitigation cost (given it happens). */
export function breakEvenDays(perDayLoss: number, effectivenessPct: number, mitigationCost: number) {
  const avoidedPerDay = perDayLoss * effectivenessPct / 100
  return avoidedPerDay > 0 ? mitigationCost / avoidedPerDay : null
}

/** Net benefit of mitigating across a grid of disruption lengths and likelihoods. */
export function sensitivity(base: ImpactIn, m: Omit<MitigationIn, 'impactTotal' | 'likelihoodPct'>, dayFactors = [0.5, 1, 1.5, 2], likelihoods = [10, 25, 50, 75]) {
  return dayFactors.map((f) => {
    const days = Math.max(0, Math.round(base.days * f * 10) / 10)
    const impact = disruptionImpact({ ...base, days }).total
    return { days, cells: likelihoods.map((l) => ({ likelihoodPct: l, net: mitigationRoi({ ...m, impactTotal: impact, likelihoodPct: l }).net })) }
  })
}
