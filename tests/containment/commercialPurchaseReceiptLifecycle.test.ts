import { describe, it, expect } from 'vitest'
import {
  PURCHASE_RECEIPT_STATUSES, isPurchaseReceiptEditable, isValidPurchaseReceiptTransition,
  assertPurchaseReceiptTransition, assertPurchaseReceiptEditable, type PurchaseReceiptStatus,
} from '@/lib/commercial/purchaseReceiptLifecycle'

// Phase C7.3 — the central purchase-receipt transition authority,
// mirroring tests/containment/commercialPurchaseOrderLifecycle.test.ts's
// own exhaustive enumeration approach: every legal and illegal transition
// among the three statuses is checked explicitly, not just a handful of
// examples.

describe('Phase C7.3 — purchase receipt lifecycle: exactly three statuses, no approval state', () => {
  it('has exactly DRAFT, POSTED, CANCELLED', () => {
    expect(PURCHASE_RECEIPT_STATUSES).toEqual(['DRAFT', 'POSTED', 'CANCELLED'])
  })

  it('does not include PENDING_APPROVAL or APPROVED anywhere', () => {
    expect(PURCHASE_RECEIPT_STATUSES).not.toContain('PENDING_APPROVAL')
    expect(PURCHASE_RECEIPT_STATUSES).not.toContain('APPROVED')
  })
})

describe('Phase C7.3 — isPurchaseReceiptEditable(): DRAFT only', () => {
  it('DRAFT is editable', () => expect(isPurchaseReceiptEditable('DRAFT')).toBe(true))
  it.each(['POSTED', 'CANCELLED'] as PurchaseReceiptStatus[])('%s is NOT editable', (status) => {
    expect(isPurchaseReceiptEditable(status)).toBe(false)
  })
})

const LEGAL: [PurchaseReceiptStatus, PurchaseReceiptStatus][] = [
  ['DRAFT', 'POSTED'],
  ['POSTED', 'CANCELLED'],
]

// Every OTHER (from, to) pair among the three statuses is illegal,
// including same-status "transitions" and any move out of CANCELLED (the
// sole terminal state), and any move directly from DRAFT to CANCELLED
// (must go through POSTED first — a never-posted DRAFT is deleted, not
// cancelled; see deletePurchaseReceipt()).
const ALL_PAIRS: [PurchaseReceiptStatus, PurchaseReceiptStatus][] = PURCHASE_RECEIPT_STATUSES.flatMap(from =>
  PURCHASE_RECEIPT_STATUSES.map(to => [from, to] as [PurchaseReceiptStatus, PurchaseReceiptStatus]),
)
const ILLEGAL = ALL_PAIRS.filter(([from, to]) => !LEGAL.some(([lf, lt]) => lf === from && lt === to))

describe('Phase C7.3 — assertPurchaseReceiptTransition(): every legal transition succeeds', () => {
  it.each(LEGAL)('%s -> %s is legal', (from, to) => {
    expect(isValidPurchaseReceiptTransition(from, to)).toBe(true)
    expect(() => assertPurchaseReceiptTransition(from, to)).not.toThrow()
  })
})

describe('Phase C7.3 — assertPurchaseReceiptTransition(): every other pair is rejected, including same-status, terminal-state, and DRAFT -> CANCELLED moves', () => {
  it.each(ILLEGAL)('%s -> %s is illegal', (from, to) => {
    expect(isValidPurchaseReceiptTransition(from, to)).toBe(false)
    expect(() => assertPurchaseReceiptTransition(from, to)).toThrow(`Cannot transition purchase receipt from ${from} to ${to}`)
  })

  it('CANCELLED has zero legal outgoing transitions (terminal)', () => {
    for (const to of PURCHASE_RECEIPT_STATUSES) {
      expect(isValidPurchaseReceiptTransition('CANCELLED', to), `CANCELLED -> ${to}`).toBe(false)
    }
  })

  it('DRAFT cannot go directly to CANCELLED — a never-posted draft is deleted, not cancelled', () => {
    expect(isValidPurchaseReceiptTransition('DRAFT', 'CANCELLED')).toBe(false)
  })

  it('cannot post twice: POSTED -> POSTED is illegal', () => {
    expect(isValidPurchaseReceiptTransition('POSTED', 'POSTED')).toBe(false)
  })

  it('POSTED cannot revert to DRAFT — posted receipts are immutable except for cancellation', () => {
    expect(isValidPurchaseReceiptTransition('POSTED', 'DRAFT')).toBe(false)
  })
})

describe('Phase C7.3 — assertPurchaseReceiptEditable()', () => {
  it('does not throw for DRAFT', () => expect(() => assertPurchaseReceiptEditable('DRAFT')).not.toThrow())
  it.each(['POSTED', 'CANCELLED'] as PurchaseReceiptStatus[])('throws for %s', (status) => {
    expect(() => assertPurchaseReceiptEditable(status)).toThrow(`Purchase receipt is ${status} and can no longer be edited`)
  })
})
