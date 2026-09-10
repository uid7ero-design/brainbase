import { describe, it, expect } from 'vitest'
import {
  PURCHASE_ORDER_STATUSES, isPurchaseOrderEditable, isValidPurchaseOrderTransition,
  assertPurchaseOrderTransition, assertPurchaseOrderEditable, type PurchaseOrderStatus,
} from '@/lib/commercial/purchaseOrderLifecycle'

// Phase C6.2 — the central purchase-order transition authority, mirroring
// tests/containment/commercialInvoiceLifecycle.test.ts's/
// commercialQuoteLifecycle.test.ts's own exhaustive enumeration
// approach: every legal and illegal transition among the five statuses
// is checked explicitly, not just a handful of examples, so a future
// edit to the transition table cannot silently legalise/forbid a
// transition without a test noticing.

describe('Phase C6.2 — purchase order lifecycle: exactly five statuses, no PAID/RECEIVED', () => {
  it('has exactly DRAFT, PENDING_APPROVAL, APPROVED, ISSUED, CANCELLED', () => {
    expect(PURCHASE_ORDER_STATUSES).toEqual(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'CANCELLED'])
  })
})

describe('Phase C6.2 — isPurchaseOrderEditable(): DRAFT only', () => {
  it('DRAFT is editable', () => expect(isPurchaseOrderEditable('DRAFT')).toBe(true))
  it.each(['PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'CANCELLED'] as PurchaseOrderStatus[])('%s is NOT editable', (status) => {
    expect(isPurchaseOrderEditable(status)).toBe(false)
  })
})

const LEGAL: [PurchaseOrderStatus, PurchaseOrderStatus][] = [
  ['DRAFT', 'PENDING_APPROVAL'],
  ['PENDING_APPROVAL', 'APPROVED'],
  ['PENDING_APPROVAL', 'DRAFT'],
  ['APPROVED', 'ISSUED'],
  ['ISSUED', 'CANCELLED'],
]

// Every OTHER (from, to) pair among the five statuses is illegal,
// including same-status "transitions" and any move out of CANCELLED
// (the sole terminal state).
const ALL_PAIRS: [PurchaseOrderStatus, PurchaseOrderStatus][] = PURCHASE_ORDER_STATUSES.flatMap(from =>
  PURCHASE_ORDER_STATUSES.map(to => [from, to] as [PurchaseOrderStatus, PurchaseOrderStatus]),
)
const ILLEGAL = ALL_PAIRS.filter(([from, to]) => !LEGAL.some(([lf, lt]) => lf === from && lt === to))

describe('Phase C6.2 — assertPurchaseOrderTransition(): every legal transition succeeds', () => {
  it.each(LEGAL)('%s -> %s is legal', (from, to) => {
    expect(isValidPurchaseOrderTransition(from, to)).toBe(true)
    expect(() => assertPurchaseOrderTransition(from, to)).not.toThrow()
  })
})

describe('Phase C6.2 — assertPurchaseOrderTransition(): every other pair is rejected, including same-status and terminal-state moves', () => {
  it.each(ILLEGAL)('%s -> %s is illegal', (from, to) => {
    expect(isValidPurchaseOrderTransition(from, to)).toBe(false)
    expect(() => assertPurchaseOrderTransition(from, to)).toThrow(`Cannot transition purchase order from ${from} to ${to}`)
  })

  it('CANCELLED has zero legal outgoing transitions (terminal)', () => {
    for (const to of PURCHASE_ORDER_STATUSES) {
      expect(isValidPurchaseOrderTransition('CANCELLED', to), `CANCELLED -> ${to}`).toBe(false)
    }
  })

  it('DRAFT cannot go directly to APPROVED, ISSUED, or CANCELLED — must pass through PENDING_APPROVAL', () => {
    expect(isValidPurchaseOrderTransition('DRAFT', 'APPROVED')).toBe(false)
    expect(isValidPurchaseOrderTransition('DRAFT', 'ISSUED')).toBe(false)
    expect(isValidPurchaseOrderTransition('DRAFT', 'CANCELLED')).toBe(false)
  })

  it('APPROVED cannot go back to DRAFT or PENDING_APPROVAL — approval is not reversible via the return path', () => {
    expect(isValidPurchaseOrderTransition('APPROVED', 'DRAFT')).toBe(false)
    expect(isValidPurchaseOrderTransition('APPROVED', 'PENDING_APPROVAL')).toBe(false)
  })

  it('ISSUED cannot go back to DRAFT, PENDING_APPROVAL, or APPROVED — issued POs are immutable except for cancellation', () => {
    expect(isValidPurchaseOrderTransition('ISSUED', 'DRAFT')).toBe(false)
    expect(isValidPurchaseOrderTransition('ISSUED', 'PENDING_APPROVAL')).toBe(false)
    expect(isValidPurchaseOrderTransition('ISSUED', 'APPROVED')).toBe(false)
  })

  it('cannot approve twice: APPROVED -> APPROVED is illegal', () => {
    expect(isValidPurchaseOrderTransition('APPROVED', 'APPROVED')).toBe(false)
  })

  it('cannot issue twice: ISSUED -> ISSUED is illegal', () => {
    expect(isValidPurchaseOrderTransition('ISSUED', 'ISSUED')).toBe(false)
  })
})

describe('Phase C6.2 — assertPurchaseOrderEditable()', () => {
  it('does not throw for DRAFT', () => expect(() => assertPurchaseOrderEditable('DRAFT')).not.toThrow())
  it.each(['PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'CANCELLED'] as PurchaseOrderStatus[])('throws for %s', (status) => {
    expect(() => assertPurchaseOrderEditable(status)).toThrow(`Purchase order is ${status} and can no longer be edited`)
  })
})
