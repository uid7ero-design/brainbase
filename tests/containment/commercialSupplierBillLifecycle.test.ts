import { describe, it, expect } from 'vitest'
import {
  SUPPLIER_BILL_STATUSES, isSupplierBillEditable, isValidSupplierBillTransition,
  assertSupplierBillTransition, assertSupplierBillEditable, type SupplierBillStatus,
} from '@/lib/commercial/supplierBillLifecycle'

// Phase C7.4 — the central supplier-bill transition authority, mirroring
// tests/containment/commercialPurchaseReceiptLifecycle.test.ts's own
// exhaustive enumeration approach: every legal and illegal transition
// among the three statuses is checked explicitly.

describe('Phase C7.4 — supplier bill lifecycle: exactly three statuses, no approval state', () => {
  it('has exactly DRAFT, POSTED, CANCELLED', () => {
    expect(SUPPLIER_BILL_STATUSES).toEqual(['DRAFT', 'POSTED', 'CANCELLED'])
  })

  it('does not include PENDING_APPROVAL or APPROVED anywhere', () => {
    expect(SUPPLIER_BILL_STATUSES).not.toContain('PENDING_APPROVAL')
    expect(SUPPLIER_BILL_STATUSES).not.toContain('APPROVED')
  })
})

describe('Phase C7.4 — isSupplierBillEditable(): DRAFT only', () => {
  it('DRAFT is editable', () => expect(isSupplierBillEditable('DRAFT')).toBe(true))
  it.each(['POSTED', 'CANCELLED'] as SupplierBillStatus[])('%s is NOT editable', (status) => {
    expect(isSupplierBillEditable(status)).toBe(false)
  })
})

const LEGAL: [SupplierBillStatus, SupplierBillStatus][] = [
  ['DRAFT', 'POSTED'],
  ['POSTED', 'CANCELLED'],
]

const ALL_PAIRS: [SupplierBillStatus, SupplierBillStatus][] = SUPPLIER_BILL_STATUSES.flatMap(from =>
  SUPPLIER_BILL_STATUSES.map(to => [from, to] as [SupplierBillStatus, SupplierBillStatus]),
)
const ILLEGAL = ALL_PAIRS.filter(([from, to]) => !LEGAL.some(([lf, lt]) => lf === from && lt === to))

describe('Phase C7.4 — assertSupplierBillTransition(): every legal transition succeeds', () => {
  it.each(LEGAL)('%s -> %s is legal', (from, to) => {
    expect(isValidSupplierBillTransition(from, to)).toBe(true)
    expect(() => assertSupplierBillTransition(from, to)).not.toThrow()
  })
})

describe('Phase C7.4 — assertSupplierBillTransition(): every other pair is rejected', () => {
  it.each(ILLEGAL)('%s -> %s is illegal', (from, to) => {
    expect(isValidSupplierBillTransition(from, to)).toBe(false)
    expect(() => assertSupplierBillTransition(from, to)).toThrow(`Cannot transition supplier bill from ${from} to ${to}`)
  })

  it('CANCELLED has zero legal outgoing transitions (terminal)', () => {
    for (const to of SUPPLIER_BILL_STATUSES) {
      expect(isValidSupplierBillTransition('CANCELLED', to), `CANCELLED -> ${to}`).toBe(false)
    }
  })

  it('DRAFT cannot go directly to CANCELLED — a never-posted draft is deleted, not cancelled', () => {
    expect(isValidSupplierBillTransition('DRAFT', 'CANCELLED')).toBe(false)
  })

  it('cannot post twice: POSTED -> POSTED is illegal', () => {
    expect(isValidSupplierBillTransition('POSTED', 'POSTED')).toBe(false)
  })

  it('POSTED cannot revert to DRAFT — posted bills are immutable except for cancellation', () => {
    expect(isValidSupplierBillTransition('POSTED', 'DRAFT')).toBe(false)
  })
})

describe('Phase C7.4 — assertSupplierBillEditable()', () => {
  it('does not throw for DRAFT', () => expect(() => assertSupplierBillEditable('DRAFT')).not.toThrow())
  it.each(['POSTED', 'CANCELLED'] as SupplierBillStatus[])('throws for %s', (status) => {
    expect(() => assertSupplierBillEditable(status)).toThrow(`Supplier bill is ${status} and can no longer be edited`)
  })
})
