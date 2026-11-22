import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from './Markdown'

const html = (t: string) => renderToStaticMarkup(<Markdown text={t} />)

describe('Markdown', () => {
  it('keeps snake_case identifiers intact inside italics', () => {
    expect(html('_Source: list_routes_')).toContain('<em>Source: list_routes</em>')
    expect(html('call get_route_risk_history now')).toContain('get_route_risk_history')
  })
  it('renders headings, bold, lists and never raw HTML', () => {
    const out = html('## Plan\n**Bottom line** – ok\n1. one\n2. two\n- a\n<script>alert(1)</script>')
    expect(out).toContain('<h4'); expect(out).toContain('<strong>Bottom line</strong>')
    expect(out).toContain('<ol'); expect(out).toContain('<ul')
    expect(out).not.toContain('<script>'); expect(out).toContain('&lt;script&gt;')
  })
})
