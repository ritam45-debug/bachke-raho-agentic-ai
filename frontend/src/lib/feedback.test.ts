import { describe, expect, it } from 'vitest'
import { analyse, nps, sentiment, themesOf } from './feedback'

describe('NPS', () => {
  it('uses promoters 9–10 minus detractors 0–6', () => {
    // 3 promoters, 1 passive, 2 detractors over 6 → (3 − 2) / 6 = 16.7
    expect(nps([10, 9, 9, 8, 6, 0])).toEqual({ n: 6, promoters: 3, passives: 1, detractors: 2, nps: 16.7 })
    expect(nps([]).nps).toBeNull()
  })
})

describe('sentiment lexicon', () => {
  it('scores and handles negation', () => {
    expect(sentiment('Delivery was fast and the staff were helpful').label).toBe('positive')
    expect(sentiment('Box arrived damaged and late').label).toBe('negative')
    expect(sentiment('The packaging was not good').label).toBe('negative')
    expect(sentiment("It wasn't bad at all").label).toBe('positive')
    expect(sentiment('Arrived on time').label).toBe('positive')
    expect(sentiment('').label).toBe('neutral')
  })
})

describe('themes', () => {
  it('detects complaint themes by keyword', () => {
    expect(themesOf('Order was late and the box was crushed')).toEqual(['Late / slow delivery', 'Damage / packaging'])
    expect(themesOf('Great taste')).toEqual(['Product quality'])
    expect(themesOf(null)).toEqual([])
  })
  it('aggregates themes and segments', () => {
    const a = analyse([
      { score: 2, comment: 'late again', region: 'South' }, { score: 4, comment: 'very late, box damaged', region: 'South' },
      { score: 10, comment: 'on time, great', region: 'North' },
    ])
    expect(a.themes[0]).toMatchObject({ name: 'Late / slow delivery', count: 2, detractors: 2, avgScore: 3 })
    expect(a.byRegion[0]).toMatchObject({ key: 'South', nps: -100 })
    expect(a.overall.nps).toBe(-33.3)
  })
})
