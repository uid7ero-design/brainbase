import { describe, it, expect } from 'vitest'
import {
  INVOICE_STATUSES, isInvoiceEditable, isValidInvoiceTransition,
  assertInvoiceTransition, assertInvoiceEditable, type InvoiceStatus,
} from '@/lib/commercial/invoiceLifecycle'

// Phase C4.1 — the central invoice transition authority, mirroring
// tests/containment/commercialQuoteLifecycle.test.ts's own exhaustive
// enumeration approach: every legal and illegal transition is checked
// explicitly, not just a handful of examples, so a future edit to the
// transition table cannot silently legalise/forbid a transition without
// a test noticing.

describe('Phase C4.1 — invoice lifecycle: exactly three statuses, no SENT/PAID/OVERDUE', () => {
  it('has exactly DRAFT, ISSUED, VOID', () => {
    expect(INVOICE_STATUSES).toEqual(['DRAFT', 'ISSUED', 'VOID'])
  })
})

describe('Phase C4.1 — isInvoiceEditable(): DRAFT only', () => {
  it('DRAFT is editable', () => expect(isInvoiceEditable('DRAFT')).toBe(true))
  it.each(['ISSUED', 'VOID'] as InvoiceStatus[])('%s is NOT editable', (status) => {
    expect(isInvoiceEditable(status)).toBe(false)
  })
})

const LEGAL: [InvoiceStatus, InvoiceStatus][] = [
  ['DRAFT', 'ISSUED'],
  ['ISSUED', 'VOID'],
]

// Every OTHER (from, to) pair among the three statuses is illegal,
// including same-status "transitions" and any move out of VOID (the
// sole terminal state).
const ALL_PAIRS: [InvoiceStatus, InvoiceStatus][] = INVOICE_STATUSES.flatMap(from =>
  INVOICE_STATUSES.map(to => [from, to] as [InvoiceStatus, InvoiceStatus]),
)
const ILLEGAL = ALL_PAIRS.filter(([from, to]) => !LEGAL.some(([lf, lt]) => lf === from && lt === to))

describe('Phase C4.1 — assertInvoiceTransition(): every legal transition succeeds', () => {
  it.each(LEGAL)('%s -> %s is legal', (from, to) => {
    expect(isValidInvoiceTransition(from, to)).toBe(true)
    expect(() => assertInvoiceTransition(from, to)).not.toThrow()
  })
})

describe('Phase C4.1 — assertInvoiceTransition(): every other pair is rejected, including same-status and terminal-state moves', () => {
  it.each(ILLEGAL)('%s -> %s is illegal', (from, to) => {
    expect(isValidInvoiceTransition(from, to)).toBe(false)
    expect(() => assertInvoiceTransition(from, to)).toThrow(`Cannot transition invoice from ${from} to ${to}`)
  })

  it('VOID has zero legal outgoing transitions (terminal)', () => {
    for (const to of INVOICE_STATUSES) {
      expect(isValidInvoiceTransition('VOID', to), `VOID -> ${to}`).toBe(false)
    }
  })

  it('DRAFT cannot go directly to VOID — only an ISSUED invoice may be voided', () => {
    expect(isValidInvoiceTransition('DRAFT', 'VOID')).toBe(false)
  })

  it('ISSUED cannot go back to DRAFT — issued invoices are immutable except for voiding', () => {
    expect(isValidInvoiceTransition('ISSUED', 'DRAFT')).toBe(false)
  })
})

describe('Phase C4.1 — assertInvoiceEditable()', () => {
  it('does not throw for DRAFT', () => expect(() => assertInvoiceEditable('DRAFT')).not.toThrow())
  it.each(['ISSUED', 'VOID'] as InvoiceStatus[])('throws for %s', (status) => {
    expect(() => assertInvoiceEditable(status)).toThrow(`Invoice is ${status} and can no longer be edited`)
  })
})
