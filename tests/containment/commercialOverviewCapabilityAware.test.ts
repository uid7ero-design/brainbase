import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C4.4A (Finding 3) — static containment proving
// app/commercial/page.tsx (the Commercial Overview) is genuinely
// capability-aware, not merely "fetches everything and hides failures."
// This repo's vitest config has no DOM rendering harness (see
// CLAUDE.md), so this proves the SOURCE's own control flow: which
// fetches are conditional on which capability, and that a capability
// the organisation lacks never gets silently coerced to a misleading
// "0" the way the pre-C4.4A version did.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const source = stripComments(readSource('app/commercial/page.tsx'))

describe('Phase C4.4A — Commercial Overview reads its own capability set before fetching anything else', () => {
  it('fetches /api/me first, and derives quotes/invoicing booleans from enabledCapabilities', () => {
    expect(source).toMatch(/fetch\('\/api\/me'\)/)
    expect(source).toMatch(/enabledCapabilities/)
    expect(source).toMatch(/capabilityKeys\.has\('quotes'\)/)
    expect(source).toMatch(/capabilityKeys\.has\('invoicing'\)/)
  })
})

describe('Phase C4.4A — quote and invoice data are fetched ONLY when the corresponding capability is present', () => {
  it('the quotes fetch is conditional on the quotes boolean, not unconditional', () => {
    // The old, buggy shape fetched unconditionally:
    //   fetch('/api/commercial/quotes')
    // with no ternary guarding it. The new shape must gate it.
    const fetchBlock = source.slice(source.indexOf('const [customersRes'), source.indexOf(']);', source.indexOf('const [customersRes')))
    expect(fetchBlock).toMatch(/quotes\s*\?\s*fetch\('\/api\/commercial\/quotes'\)\s*:\s*Promise\.resolve\(null\)/)
  })

  it('the invoices fetch is conditional on the invoicing boolean', () => {
    const fetchBlock = source.slice(source.indexOf('const [customersRes'), source.indexOf(']);', source.indexOf('const [customersRes')))
    expect(fetchBlock).toMatch(/invoicing\s*\?\s*fetch\('\/api\/commercial\/invoices'\)\s*:\s*Promise\.resolve\(null\)/)
  })

  it('customers/products are fetched when EITHER quotes or invoicing is present (shared resources), not gated on quotes alone', () => {
    const fetchBlock = source.slice(source.indexOf('const [customersRes'), source.indexOf(']);', source.indexOf('const [customersRes')))
    expect(fetchBlock).toMatch(/wantsShared\s*\?\s*fetch\('\/api\/commercial\/customers'\)/)
    expect(fetchBlock).toMatch(/wantsShared\s*\?\s*fetch\('\/api\/commercial\/products'\)/)
    expect(source).toMatch(/const wantsShared = quotes \|\| invoicing/)
  })
})

describe('Phase C4.4A — a capability the organisation lacks is never silently reported as a misleading "0"', () => {
  it('quotes/draftQuotes counts are set to null (not 0) when the organisation lacks the quotes capability — the old bug used an unconditional `?? 0`', () => {
    const setCountsBlock = source.slice(source.indexOf('setCounts({'), source.indexOf('});', source.indexOf('setCounts({')))
    expect(setCountsBlock).toMatch(/quotes:\s*quotes\s*\?\s*\(quotesData\?\.\w+\?\.\w+\s*\?\?\s*0\)\s*:\s*null/)
    expect(setCountsBlock).toMatch(/draftQuotes:\s*quotes\s*\?/)
  })

  it('invoices/draftInvoices counts are set to null when the organisation lacks the invoicing capability', () => {
    const setCountsBlock = source.slice(source.indexOf('setCounts({'), source.indexOf('});', source.indexOf('setCounts({')))
    expect(setCountsBlock).toMatch(/invoices:\s*invoicing\s*\?/)
    expect(setCountsBlock).toMatch(/draftInvoices:\s*invoicing\s*\?/)
  })

  it('StatCard renders "—" (never "0") for a null value — the UI-level guard that makes the null-vs-zero distinction actually visible', () => {
    const statCardFn = source.slice(source.indexOf('function StatCard'), source.indexOf('\n}', source.indexOf('function StatCard')))
    expect(statCardFn).toMatch(/value \?\? '—'/)
    // The prop type itself must admit null (not just undefined) —
    // otherwise TypeScript would have silently allowed passing 0 in a
    // context that meant "no access", re-opening exactly the bug this
    // phase fixes.
    expect(statCardFn).toMatch(/value: number \| null \| undefined/)
  })
})

describe('Phase C4.4A — stat cards themselves are only rendered for a capability the organisation actually has', () => {
  it('Quotes and Draft Quotes cards are gated on hasQuotes', () => {
    expect(source).toMatch(/\{hasQuotes && <StatCard label="Quotes"/)
    expect(source).toMatch(/\{hasQuotes && <StatCard label="Draft Quotes"/)
  })

  it('Invoices and Draft Invoices cards are gated on hasInvoicing', () => {
    expect(source).toMatch(/\{hasInvoicing && <StatCard label="Invoices"/)
    expect(source).toMatch(/\{hasInvoicing && <StatCard label="Draft Invoices"/)
  })

  it('Customers and Products cards are gated on EITHER capability (shared), never on quotes alone', () => {
    expect(source).toMatch(/\{\(hasQuotes \|\| hasInvoicing\) && <StatCard label="Customers"/)
    expect(source).toMatch(/\{\(hasQuotes \|\| hasInvoicing\) && <StatCard label="Products/)
  })
})

describe('Phase C4.4A — "Get started" copy is capability-appropriate, never assumes Quotes for an invoicing-only organisation', () => {
  it('shows quote-oriented copy/links only when hasQuotes', () => {
    const idx = source.indexOf('{hasQuotes && (')
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(idx, source.indexOf(')}', idx))
    expect(block).toMatch(/New Quote/)
  })

  it('shows invoice-oriented copy/links for an invoicing-only organisation (hasInvoicing but not hasQuotes), never silently falling back to quote copy', () => {
    const idx = source.indexOf('{!hasQuotes && hasInvoicing && (')
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(idx, source.indexOf(')}', idx))
    expect(block).toMatch(/New Invoice/)
  })
})
