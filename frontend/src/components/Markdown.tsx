import type { ReactNode } from 'react'

// Small, safe Markdown renderer for agent answers: builds React elements (no raw HTML is ever injected).
// Supports headings, bold, italic, inline code, bullet and numbered lists, and paragraphs.
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  // Italic _x_ only at word boundaries, so identifiers like list_routes stay intact.
  const re = /(\*\*[^*]+\*\*|`[^`]+`|(?<![\w])_[^\n]+?_(?![\w]))/g
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={`${key}-${i++}`} className="rounded bg-slate-100 px-1 text-[0.9em] dark:bg-ink-800">{t.slice(1, -1)}</code>)
    else out.push(<em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  const flushPara = () => { if (para.length) { blocks.push(<p key={`p${blocks.length}`} className="my-2">{inline(para.join(' '), `p${blocks.length}`)}</p>); para = [] } }
  const flushList = () => {
    if (!list) return
    const Tag = list.ordered ? 'ol' : 'ul'
    blocks.push(<Tag key={`l${blocks.length}`} className={`my-2 space-y-1 pl-5 ${list.ordered ? 'list-decimal' : 'list-disc'}`}>
      {list.items.map((it, i) => <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>)}</Tag>)
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    const ul = line.match(/^\s*[-*•]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (h) { flushPara(); flushList(); blocks.push(<h4 key={`h${blocks.length}`} className="mb-1 mt-3 font-display text-sm font-bold">{inline(h[2], `h${blocks.length}`)}</h4>) }
    else if (ul || ol) {
      flushPara()
      const ordered = !!ol
      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, items: [] }
      list.items.push((ul ?? ol)![1])
    } else if (!line.trim()) { flushPara(); flushList() }
    else { flushList(); para.push(line.trim()) }
  }
  flushPara(); flushList()
  return <div className="text-sm leading-relaxed">{blocks}</div>
}
