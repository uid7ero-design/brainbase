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

describe('Phase C4.4A — a capability the organisation lacks is never silently reported as a misleading "0", and neither is a genuinely failed request', () => {
  it('every count is derived via resolveResourceCount(enabled, ok, length) — not a raw `?? 0` that would conflate "not entitled" or "request failed" with a real zero', () => {
    const setCountsBlock = source.slice(source.indexOf('setCounts({'), source.indexOf('});', source.indexOf('setCounts({')))
    expect(setCountsBlock).toMatch(/customers:\s*resolveResourceCount\(wantsShared,\s*customersOk,\s*customersData\?\.customers\?\.length\)/)
    expect(setCountsBlock).toMatch(/products:\s*resolveResourceCount\(wantsShared,\s*productsOk,\s*productsData\?\.products\?\.length\)/)
    expect(setCountsBlock).toMatch(/quotes:\s*resolveResourceCount\(quotes,\s*quotesOk,\s*quotesData\?\.quotes\?\.length\)/)
    expect(setCountsBlock).toMatch(/draftQuotes:\s*resolveResourceCount\(quotes,\s*quotesOk,\s*draftQuotesLength\)/)
    expect(setCountsBlock).toMatch(/invoices:\s*resolveResourceCount\(invoicing,\s*invoicesOk,\s*invoicesData\?\.invoices\?\.length\)/)
    expect(setCountsBlock).toMatch(/draftInvoices:\s*resolveResourceCount\(invoicing,\s*invoicesOk,\s*draftInvoicesLength\)/)
    expect(setCountsBlock).not.toMatch(/\?\?\s*0/)
  })

  it('each resource\'s own `ok` flag is derived independently, per resource, from its own response — never borrowed from another resource', () => {
    expect(source).toMatch(/const customersOk = wantsShared \? !!customersRes\?\.ok : false/)
    expect(source).toMatch(/const productsOk = wantsShared \? !!productsRes\?\.ok : false/)
    expect(source).toMatch(/const quotesOk = quotes \? !!quotesRes\?\.ok : false/)
    expect(source).toMatch(/const invoicesOk = invoicing \? !!invoicesRes\?\.ok : false/)
  })

  it('StatCard renders "—" for "unavailable"/loading and a visibly distinct "Error" for a failed-but-entitled request — never coercing either into "0"', () => {
    const statCardFn = source.slice(source.indexOf('function StatCard'), source.indexOf('\n}', source.indexOf('function StatCard')))
    expect(statCardFn).toMatch(/value === undefined \|\| value === 'unavailable' \? '—' : value === 'error' \? 'Error' : value/)
    // The prop type itself must admit the three-way ResourceCountState
    // (not just number | null | undefined) — otherwise TypeScript would
    // silently allow collapsing "request failed" back into a plain
    // number, re-opening exactly the bug this fix addresses.
    expect(statCardFn).toMatch(/value: ResourceCountState \| undefined/)
  })

  it('the Overview imports the shared, independently-tested resolveResourceCount helper rather than re-implementing the rule inline', () => {
    expect(source).toMatch(/import \{ resolveResourceCount, type ResourceCountState \} from '@\/lib\/commercial\/overviewCounts'/)
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
