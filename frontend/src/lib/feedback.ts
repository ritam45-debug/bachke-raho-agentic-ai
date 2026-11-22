// Consumer-feedback analytics. All rule-based and explainable; nothing here is a statistical model.
// NPS uses the standard definition: % promoters (9–10) − % detractors (0–6), passives are 7–8.

export interface Resp { score: number; comment: string | null; product_sku?: string | null; region?: string | null; channel?: string | null; received_at?: string }

export function nps(scores: number[]) {
  const n = scores.length
  const promoters = scores.filter((s) => s >= 9).length, detractors = scores.filter((s) => s <= 6).length
  return { n, promoters, passives: n - promoters - detractors, detractors, nps: n ? Math.round(((promoters - detractors) / n) * 1000) / 10 : null }
}

// Small domain lexicon. Words are matched on whole-word stems; a negator within the previous 3 words flips polarity.
const POS = ['good', 'great', 'excellent', 'fast', 'quick', 'happy', 'love', 'reliable', 'helpful', 'fresh', 'perfect', 'easy', 'smooth', 'satisfied', 'recommend', 'on time', 'intact', 'friendly', 'affordable', 'best']
const NEG = ['bad', 'poor', 'late', 'delay', 'delayed', 'slow', 'damaged', 'broken', 'leak', 'leaking', 'missing', 'wrong', 'rude', 'expensive', 'worst', 'stale', 'defective', 'refund', 'complaint', 'unhappy', 'never', 'dirty', 'cracked', 'torn', 'disappointed', 'terrible', 'awful']
const NEGATORS = ['not', 'no', "n't", 'never', 'hardly', 'without']

export function sentiment(text: string | null | undefined): { score: number; label: 'positive' | 'neutral' | 'negative'; hits: string[] } {
  if (!text) return { score: 0, label: 'neutral', hits: [] }
  const t = text.toLowerCase().replace(/n't\b/g, " n't")
  const words = t.split(/[^a-z']+/).filter(Boolean)
  let score = 0; const hits: string[] = []
  const flipAt = (i: number) => words.slice(Math.max(0, i - 3), i).some((w) => NEGATORS.includes(w))
  words.forEach((w, i) => {
    const p = POS.includes(w), n = NEG.includes(w) && w !== 'never'
    if (!p && !n) return
    const v = (p ? 1 : -1) * (flipAt(i) ? -1 : 1)
    score += v; hits.push(`${flipAt(i) ? 'not ' : ''}${w}`)
  })
  if (/\bon time\b/.test(t) && !/\bnot on time\b/.test(t)) { score += 1; hits.push('on time') }
  return { score, label: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral', hits }
}

export const THEMES: Record<string, string[]> = {
  'Late / slow delivery': ['late', 'delay', 'delayed', 'slow', 'waiting', 'days', 'eta', 'took'],
  'Damage / packaging': ['damaged', 'broken', 'leak', 'leaking', 'cracked', 'torn', 'dented', 'packaging', 'box', 'crushed'],
  'Product quality': ['quality', 'defective', 'stale', 'expired', 'faulty', 'taste', 'smell', 'fresh'],
  'Wrong / missing items': ['wrong', 'missing', 'short', 'incomplete', 'substitute'],
  'Price / value': ['price', 'expensive', 'costly', 'cheap', 'value', 'affordable', 'overpriced'],
  'Availability / stock-outs': ['stock', 'unavailable', 'available', 'sold out', 'restock'],
  'Service / support': ['support', 'rude', 'helpful', 'call', 'response', 'staff', 'refund', 'service'],
}

export function themesOf(text: string | null | undefined): string[] {
  if (!text) return []
  const t = ` ${text.toLowerCase()} `
  return Object.entries(THEMES).filter(([, kws]) => kws.some((k) => new RegExp(`[^a-z]${k}[^a-z]`).test(t))).map(([k]) => k)
}

export function analyse(rows: Resp[]) {
  const scored = rows.map((r) => ({ ...r, s: sentiment(r.comment), themes: themesOf(r.comment) }))
  const theme: Record<string, { count: number; detractors: number; avgScore: number; examples: string[] }> = {}
  for (const r of scored) for (const th of r.themes) {
    const x = (theme[th] ??= { count: 0, detractors: 0, avgScore: 0, examples: [] })
    x.avgScore = (x.avgScore * x.count + r.score) / (x.count + 1); x.count++
    if (r.score <= 6) x.detractors++
    if (x.examples.length < 3 && r.comment) x.examples.push(r.comment)
  }
  const by = (key: 'product_sku' | 'region' | 'channel') => {
    const g: Record<string, number[]> = {}
    for (const r of rows) { const k = r[key] || '—'; (g[k] ??= []).push(r.score) }
    return Object.entries(g).map(([k, v]) => ({ key: k, ...nps(v) })).sort((a, b) => (a.nps ?? 0) - (b.nps ?? 0))
  }
  return {
    overall: nps(rows.map((r) => r.score)),
    sentiment: { positive: scored.filter((r) => r.s.label === 'positive').length, neutral: scored.filter((r) => r.s.label === 'neutral').length, negative: scored.filter((r) => r.s.label === 'negative').length },
    themes: Object.entries(theme).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count),
    byProduct: by('product_sku'), byRegion: by('region'), byChannel: by('channel'), scored,
  }
}
