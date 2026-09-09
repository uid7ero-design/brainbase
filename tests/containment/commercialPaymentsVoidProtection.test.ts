import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C5.2 §F — behavioural tests for voidInvoice()'s new payment-block
// rule (lib/commercial/invoices.ts), using the exact same '@/lib/db'
// mocking harness tests/containment/commercialInvoicesDataAccess.test.ts
// already established for this same function's pre-existing behavior —
// a separate file so C5.2's own additions are clearly traceable, not
// because the mocking convention differs at all.

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

const logInvoiceVoidedMock = vi.fn()
vi.mock('@/lib/commercial/auditLog', () => ({
  logInvoiceVoided: (...a: unknown[]) => logInvoiceVoidedMock(...a),
  // voidInvoice()'s own module also imports these — unused by voidInvoice
  // itself but required so the module under test loads cleanly.
  logInvoiceCreated: vi.fn(), logInvoiceCreatedFromQuote: vi.fn(), logInvoiceUpdated: vi.fn(),
  logInvoiceIssued: vi.fn(), logInvoiceDeleted: vi.fn(),
}))

beforeEach(() => {
  sqlMock.mockReset()
  logInvoiceVoidedMock.mockReset()
})

const ORG = 'org-a'
const issuedInvoice = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv-1', organisation_id: ORG, customer_id: 'cust-1', source_quote_id: null, invoice_number: 'INV-000001',
  status: 'ISSUED', currency: 'AUD', due_date: '2026-09-23', payment_terms_days: 14,
  subtotal_cents: 12000, tax_cents: 1200, total_cents: 13200, overdue: false, ...overrides,
})

describe('Phase C5.2 §F — voidInvoice(): unpaid invoice is unaffected (regression)', () => {
  it('an unpaid ISSUED invoice can still be voided — active_paid is zero, the atomic UPDATE succeeds', async () => {
    sqlMock
      .mockResolvedValueOnce([issuedInvoice()]) // initial getInvoice() precondition read
      .mockResolvedValueOnce([{ ...issuedInvoice(), status: 'VOID', void_reason: 'Customer cancelled', voided_by: 'u1', voided_at: '2026-09-09T00:00:00.000Z' }]) // atomic UPDATE succeeds
    const { voidInvoice } = await import('@/lib/commercial/invoices')
    const voided = await voidInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', voidReason: 'Customer cancelled' })
    expect(voided.status).toBe('VOID')
    expect(voided.invoice_number).toBe('INV-000001')
    expect(logInvoiceVoidedMock).toHaveBeenCalledTimes(1)
    expect(sqlMock).toHaveBeenCalledTimes(2)
  })
})

describe('Phase C5.2 §F — voidInvoice(): paid invoice is blocked', () => {
  it('a partially-paid invoice cannot be voided — the atomic statement rejects (active_paid > 0), and the follow-up check reports the specific reason', async () => {
    sqlMock
      .mockResolvedValueOnce([issuedInvoice()]) // initial getInvoice()
      .mockResolvedValueOnce([]) // atomic UPDATE: zero rows (active_paid > 0 blocked it)
      .mockResolvedValueOnce([issuedInvoice()]) // follow-up getInvoice(): still ISSUED
      .mockResolvedValueOnce([{ paid_cents: 5000 }]) // follow-up paid-amount check: > 0
    const { voidInvoice } = await import('@/lib/commercial/invoices')
    await expect(voidInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', voidReason: 'x' }))
      .rejects.toThrow(/cannot void an invoice with recorded payments/)
    expect(logInvoiceVoidedMock).not.toHaveBeenCalled()
    expect(sqlMock).toHaveBeenCalledTimes(4)
  })

  it('a fully-paid invoice cannot be voided — same rejection path, active_paid equals the full total', async () => {
    sqlMock
      .mockResolvedValueOnce([issuedInvoice()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([issuedInvoice()])
      .mockResolvedValueOnce([{ paid_cents: 13200 }])
    const { voidInvoice } = await import('@/lib/commercial/invoices')
    await expect(voidInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', voidReason: 'x' }))
      .rejects.toThrow(/cannot void an invoice with recorded payments/)
    expect(logInvoiceVoidedMock).not.toHaveBeenCalled()
  })

  it('no invoice mutation occurs when the void is blocked — the atomic statement itself returned zero rows, nothing was ever committed', async () => {
    sqlMock
      .mockResolvedValueOnce([issuedInvoice()])
      .mockResolvedValueOnce([]) // this IS the atomic UPDATE attempt — it already updated nothing
      .mockResolvedValueOnce([issuedInvoice()])
      .mockResolvedValueOnce([{ paid_cents: 5000 }])
    const { voidInvoice } = await import('@/lib/commercial/invoices')
    await expect(voidInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', voidReason: 'x' })).rejects.toThrow()
    // Exactly one atomic-statement attempt (call #2) — no retry, no second UPDATE.
    expect(sqlMock.mock.calls).toHaveLength(4)
  })
})

describe('Phase C5.2 §F — voidInvoice(): becomes voidable again after reversal', () => {
  it('once active_paid returns to zero (all payments reversed), the invoice can be voided', async () => {
    sqlMock
      .mockResolvedValueOnce([issuedInvoice()]) // initial getInvoice()
      .mockResolvedValueOnce([{ ...issuedInvoice(), status: 'VOID', void_reason: 'Now voidable', voided_by: 'u1', voided_at: '2026-09-09T01:00:00.000Z' }]) // atomic UPDATE succeeds — active_paid CTE now sums to 0 since all allocations join only RECORDED payments
    const { voidInvoice } = await import('@/lib/commercial/invoices')
    const voided = await voidInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', voidReason: 'Now voidable' })
    expect(voided.status).toBe('VOID')
    expect(logInvoiceVoidedMock).toHaveBeenCalledTimes(1)
  })
})

describe('Phase C5.2 §F — voidInvoice(): genuine concurrency (status changed, not a payment)', () => {
  it('still reports a plain concurrency error when the invoice is no longer ISSUED for a reason other than payments', async () => {
    sqlMock
      .mockResolvedValueOnce([issuedInvoice()])
      .mockResolvedValueOnce([]) // atomic UPDATE: zero rows
      .mockResolvedValueOnce([issuedInvoice({ status: 'VOID' })]) // follow-up read: someone else already voided it
    const { voidInvoice } = await import('@/lib/commercial/invoices')
    await expect(voidInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', voidReason: 'x' }))
      .rejects.toThrow(/changed concurrently/)
    // Only 3 calls — the paid-amount check is never reached once status
    // is already confirmed non-ISSUED.
    expect(sqlMock).toHaveBeenCalledTimes(3)
  })
})
