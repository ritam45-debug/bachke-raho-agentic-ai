export function money(v: number, currency = 'INR') {
  if (currency === 'INR') {
    if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`
    if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`
  }
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v)
}

export const num = (v: number | null | undefined, d = 0) =>
  v == null ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: d }).format(v)

export const date = (v: string | null | undefined) =>
  v ? new Date(v.endsWith('Z') || v.includes('+') ? v : v + 'Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export const dateTime = (v: string | null | undefined) =>
  v ? new Date(v.endsWith('Z') || v.includes('+') ? v : v + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export function useCsvDownload() {
  return (filename: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return
    const cols = Object.keys(rows[0])
    const esc = (v: unknown) => {
      const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: filename })
    a.click()
    URL.revokeObjectURL(url)
  }
}
