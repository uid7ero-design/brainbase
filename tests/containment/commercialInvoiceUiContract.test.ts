import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C4.2 — UI-contract containment tests. This repo's vitest config
// only collects a plain-Node environment with no jsdom/React Testing
// Library harness (see CLAUDE.md), so these prove behavior via static
// source-text containment on the real component files — the same
// established idiom every other UI-adjacent containment test in this
// repo already uses.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

describe('Phase C4.2 blocker fix — invoice list page renders server-authoritative overdue, never recomputes it', () => {
  const source = readSource('app/commercial/invoices/page.tsx')

  it('contains no client-side "today" derivation or date comparison for overdue at all', () => {
    expect(source).not.toMatch(/new Date\(\)\.toISOString/)
    expect(source).not.toMatch(/\.slice\(0, 10\)/)
    expect(source).not.toMatch(/function isOverdue/)
  })

  it('renders inv.overdue directly, sourced from the API response', () => {
    expect(source).toMatch(/inv\.overdue && <OverdueBadge/)
  })

  it('the Invoice type declares overdue as a field received from the server, not computed locally', () => {
    const typeBlock = source.slice(source.indexOf('type Invoice = {'), source.indexOf('};', source.indexOf('type Invoice = {')))
    expect(typeBlock).toMatch(/overdue: boolean/)
  })
})

describe('Phase C4.2 §10 — Commercial navigation is per-capability gated for Invoices', () => {
  const source = readSource('app/commercial/_components/CommercialSidebar.tsx')

  it('accepts an invoicingEnabled prop and only includes Invoices in the nav when it is true', () => {
    expect(source).toMatch(/invoicingEnabled/)
    // Must be an actual conditional controlling whether the Invoices item
    // is included — not merely the TS prop declaration's own `?:` optional
    // marker (invoicingEnabled?: boolean), which would match a much looser
    // regex without the navItems assignment actually branching on it.
    const navItemsAssignment = source.slice(source.indexOf('const navItems ='), source.indexOf(';', source.indexOf('const navItems =')) + 1)
    expect(navItemsAssignment).toMatch(/invoicingEnabled/)
    expect(navItemsAssignment).toMatch(/\?/)
    expect(navItemsAssignment).toMatch(/'\/commercial\/invoices'/)
  })

  it('never renders Invoices as a disabled/greyed-out placeholder — it is included or omitted, never conditionally styled-disabled', () => {
    expect(source).not.toMatch(/Invoices.*disabled/i)
    expect(source).not.toMatch(/Coming soon/i)
  })

  it('the layout resolves BOTH quotes and invoicing capabilities and passes invoicingEnabled down explicitly', () => {
    const layout = readSource('app/commercial/layout.tsx')
    expect(layout).toMatch(/checkCapability\(session\.organisationId, 'quotes'\)/)
    expect(layout).toMatch(/checkCapability\(session\.organisationId, 'invoicing'\)/)
    expect(layout).toMatch(/invoicingEnabled=\{invoicingCapability\.allowed\}/)
  })
})

describe('Phase C4.2 §12 — new standalone invoice never fabricates a number before issue', () => {
  const source = readSource('app/commercial/invoices/new/page.tsx')

  it('contains no hardcoded INV-###### placeholder anywhere', () => {
    expect(source).not.toMatch(/INV-\d{6}/)
  })

  it('never sends invoiceNumber/status in the create request body', () => {
    const bodyBlock = source.slice(source.indexOf('body: JSON.stringify('), source.indexOf(');', source.indexOf('body: JSON.stringify(')))
    expect(bodyBlock).not.toMatch(/invoiceNumber/)
    expect(bodyBlock).not.toMatch(/status/)
  })
})

describe('Phase C4.2 §14 — invoice detail page: truthful draft copy, no fabricated number, no PDF/email/payment placeholders', () => {
  const source = readSource('app/commercial/invoices/[id]/page.tsx')

  it('shows truthful "number pending" copy for a draft, never a fabricated INV-###### value', () => {
    expect(source).toMatch(/Draft.*number pending/i)
    expect(source).not.toMatch(/INV-\d{6}/)
  })

  it('contains no PDF download, email send, or payment placeholder controls — C4.3/future phases only', () => {
    for (const forbidden of [/Download PDF/i, /Send Invoice/i, /Send Email/i, /Email Invoice/i, /Pay Now/i, /Mark Paid/i, /Coming soon/i]) {
      expect(source).not.toMatch(forbidden)
    }
  })

  it('never displays a payment/balance state', () => {
    expect(source).not.toMatch(/Amount Due/i)
    expect(source).not.toMatch(/Balance/i)
    expect(source).not.toMatch(/Payment Status/i)
  })

  it('the void confirmation copy explicitly disclaims refund/payment handling and is concise', () => {
    const block = source.slice(source.indexOf('confirmingVoid && ('), source.indexOf('Confirm Void'))
    expect(block).toMatch(/Payment\/refund handling is not part of this phase/)
  })

  it('void requires a non-empty reason before the confirm button is enabled', () => {
    expect(source).toMatch(/disabled=\{busy \|\| !voidReason\.trim\(\)\}/)
  })

  it('issue requires a due date before the action is available', () => {
    expect(source).toMatch(/disabled=\{busy \|\| !dueDate\}/)
  })

  it('a concurrency loss (409) is shown as a plain refresh message, never auto-retried', () => {
    const fn = source.slice(source.indexOf('async function issueInvoice()'), source.indexOf('async function voidInvoiceAction'))
    expect(fn).toMatch(/status === 409/)
    expect(fn).toMatch(/just issued by another request/i)
    expect(fn).not.toMatch(/setTimeout|retry/i)
  })

  it('Void Invoice is gated on isAdmin client-side (defense-in-depth UX; server remains authoritative)', () => {
    expect(source).toMatch(/isIssued && isAdmin && !confirmingVoid/)
  })
})

describe('Phase C4.2 §13 — quote detail Create Invoice entry point', () => {
  const source = readSource('app/commercial/quotes/[id]/page.tsx')

  it('is shown only for an ACCEPTED quote, gated on invoicing capability + manager+, and never hidden merely because an invoice already exists', () => {
    expect(source).toMatch(/quote\.status === 'ACCEPTED' && canCreateInvoice/)
    expect(source).not.toMatch(/already.*invoice.*hide|hide.*already.*invoice/i)
  })

  it('canCreateInvoice checks the invoicing capability specifically, not just any Commercial access', () => {
    const block = source.slice(source.indexOf('const hasInvoicing'), source.indexOf('setCanCreateInvoice(hasInvoicing'))
    expect(block).toMatch(/c\.key === 'invoicing'/)
  })

  it('redirects to the created invoice detail page on success', () => {
    const fn = source.slice(source.indexOf('async function createInvoiceFromThisQuote'), source.indexOf('async function deleteDraft'))
    expect(fn).toMatch(/router\.push\(`\/commercial\/invoices\/\$\{data\.invoice\.id\}`\)/)
  })
})

describe('Phase C4.2 — regression: C3 quote PDF/email surfaces remain untouched', () => {
  const source = readSource('app/commercial/quotes/[id]/page.tsx')

  it('still has Download PDF / Send Email for issued quotes — C4.2 did not remove or alter them', () => {
    expect(source).toMatch(/Download PDF/)
    expect(source).toMatch(/Send Email|Resend Email/)
  })
})
