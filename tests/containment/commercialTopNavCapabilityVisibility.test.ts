import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C7.2 — repository-confirmed C6 follow-up: the global "Commercial"
// top-nav pill (components/nav/TopNav.tsx) was gated on `hasCommercial =
// enabledCapabilities.includes('quotes')` alone, even though the actual
// server-side gate it links to (app/commercial/layout.tsx) already
// allows 'quotes' OR 'invoicing' OR 'purchasing' and only blocks entry
// when NONE of the three are enabled. A purchasing-only organisation
// (entitled, and able to reach every Purchasing route/page directly by
// URL) had no way to discover /commercial from the top nav at all.
//
// This is a visibility-only fix — navigation visibility is not a
// security boundary; every Commercial route and app/commercial/layout.tsx
// itself independently re-enforce their own capability checks regardless
// of whether this pill is shown. These tests assert the SOURCE TEXT of
// the fix (this repo's containment-test convention — no jsdom/RTL
// harness exists, see CLAUDE.md), not rendered behaviour.

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const topNavSource = stripComments(
  fs.readFileSync(path.join(process.cwd(), 'components/nav/TopNav.tsx'), 'utf8').replace(/\r\n/g, '\n'),
)

const hasCommercialStart = topNavSource.indexOf('const hasCommercial =')
const hasCommercialEnd = topNavSource.indexOf(';', hasCommercialStart)
const hasCommercialBody = topNavSource.slice(hasCommercialStart, hasCommercialEnd)

const layoutSource = fs.readFileSync(path.join(process.cwd(), 'app/commercial/layout.tsx'), 'utf8')

describe('Phase C7.2 — Commercial top-nav pill visibility matches the server-side capability gate it links to', () => {
  it('hasCommercial checks quotes, invoicing, AND purchasing — not quotes alone', () => {
    expect(hasCommercialBody).toMatch(/enabledCapabilities\.includes\(\s*'quotes',?\s*\)/)
    expect(hasCommercialBody).toMatch(/enabledCapabilities\.includes\(\s*'invoicing',?\s*\)/)
    expect(hasCommercialBody).toMatch(/enabledCapabilities\.includes\(\s*'purchasing',?\s*\)/)
  })

  it('the three checks are OR-combined, not AND-combined (an organisation with only one of the three must still see the pill)', () => {
    // Between each `.includes(...)` call there must be `||`, never `&&`.
    const orCount = (hasCommercialBody.match(/\|\|/g) ?? []).length
    expect(orCount).toBeGreaterThanOrEqual(2)
    expect(hasCommercialBody).not.toMatch(/&&/)
  })

  it('app/commercial/layout.tsx (the actual page this pill links to) checks the same three capabilities and only blocks when none are allowed — the pill\'s visibility now matches its own destination\'s real gate', () => {
    expect(layoutSource).toMatch(/checkCapability\(session\.organisationId, 'quotes'\)/)
    expect(layoutSource).toMatch(/checkCapability\(session\.organisationId, 'invoicing'\)/)
    expect(layoutSource).toMatch(/checkCapability\(session\.organisationId, 'purchasing'\)/)
    expect(layoutSource).toMatch(/!quotesCapability\.allowed && !invoicingCapability\.allowed && !purchasingCapability\.allowed/)
  })

  it('the pill still renders exactly two <NavItem href="/commercial" ...> call sites (shared branch + LD Tennis branch) — the fix only changed the gating condition, not how many places render the pill', () => {
    const matches = topNavSource.match(/href="\/commercial"/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('the capability prop on the Commercial NavItem is untouched (still "quotes") — icon-choice cosmetics are a separate, deliberately out-of-scope concern from this visibility fix', () => {
    const idx = topNavSource.indexOf('href="/commercial"')
    const block = topNavSource.slice(idx, topNavSource.indexOf('/>', idx))
    expect(block).toContain('capability="quotes"')
  })
})
