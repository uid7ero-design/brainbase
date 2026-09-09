import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C5.2 — behavioural tests for lib/commercial/payments.ts,
// mirroring tests/containment/commercialInvoicesDataAccess.test.ts's own
// mocking discipline exactly: sibling modules (getInvoice from
// invoices.ts, the audit-log writers) are mocked directly, and '@/lib/db'
// is mocked at the sql-call level, in the exact call order the real
// code issues them — this isolates payments.ts's OWN logic (validation,
// atomic-statement result handling, error classification) from those
// modules' own separately-tested internals.

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

const getInvoiceMock = vi.fn()
vi.mock('@/lib/commercial/invoices', () => ({ getInvoice: (...a: unknown[]) => getInvoiceMock(...a) }))

const logPaymentRecordedMock = vi.fn()
const logPaymentReversedMock = vi.fn()
vi.mock('@/lib/commercial/auditLog', () => ({
  logPaymentRecorded: (...a: unknown[]) => logPaymentRecordedMock(...a),
  logPaymentReversed: (...a: unknown[]) => logPaymentReversedMock(...a),
}))

beforeEach(() => {
  sqlMock.mockReset()
  getInvoiceMock.mockReset()
  logPaymentRecordedMock.mockReset()
  logPaymentReversedMock.mockReset()
})

const ORG = 'org-a'
const issuedInvoice = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv-1', organisation_id: ORG, status: 'ISSUED', total_cents: 13200, ...overrides,
})
const payment = (overrides: Record<string, unknown> = {}) => ({
  id: 'pay-1', organisation_id: ORG, amount_cents: 13200, currency: 'AUD', method: 'BANK_TRANSFER',
  reference: null, provider: null, provider_reference: null, received_at: '2026-09-09T00:00:00.000Z',
  status: 'RECORDED', recorded_by: 'user-1', reversed_at: null, reversed_by: null, reversal_reason: null,
  created_at: '2026-09-09T00:00:00.000Z', updated_at: '2026-09-09T00:00:00.000Z', ...overrides,
})

describe('Phase C5.2 — PAYMENT_METHODS / isValidPaymentMethod', () => {
  it('accepts exactly the approved vocabulary and rejects everything else', async () => {
    const { PAYMENT_METHODS, isValidPaymentMethod } = await import('@/lib/commercial/payments')
    expect(PAYMENT_METHODS).toEqual(['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER'])
    for (const m of PAYMENT_METHODS) expect(isValidPaymentMethod(m)).toBe(true)
    expect(isValidPaymentMethod('STRIPE')).toBe(false)
    expect(isValidPaymentMethod('')).toBe(false)
    expect(isValidPaymentMethod(undefined)).toBe(false)
    expect(isValidPaymentMethod(123)).toBe(false)
  })
})

describe('Phase C5.2 — recordInvoicePayment(): validation before any query', () => {
  it('rejects a non-positive amount without calling getInvoice or sql at all', async () => {
    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(recordInvoicePayment({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', amountCents: 0, method: 'CASH' }))
      .rejects.toThrow(/positive integer/)
    expect(getInvoiceMock).not.toHaveBeenCalled()
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects a non-integer (float) amount', async () => {
    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(recordInvoicePayment({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', amountCents: 100.5, method: 'CASH' }))
      .rejects.toThrow(/positive integer/)
  })

  it('rejects an invalid payment method before any query', async () => {
    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(recordInvoicePayment({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', amountCents: 100, method: 'STRIPE' as never }))
      .rejects.toThrow(/Invalid payment method/)
    expect(getInvoiceMock).not.toHaveBeenCalled()
  })

  it('rejects provider_reference set without provider, matching the DB-level CHECK', async () => {
    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(recordInvoicePayment({
      organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', amountCents: 100, method: 'CASH', providerReference: 'evt_123',
    })).rejects.toThrow(/provider is required/)
    expect(getInvoiceMock).not.toHaveBeenCalled()
  })
})

describe('Phase C5.2 — recordInvoicePayment(): invoice-state gating', () => {
  it('rejects a DRAFT invoice before the atomic statement', async () => {
    getInvoiceMock.mockResolvedValueOnce(issuedInvoice({ status: 'DRAFT' }))
    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(recordInvoicePayment({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', amountCents: 100, method: 'CASH' }))
      .rejects.toThrow(/DRAFT/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects a VOID invoice before the atomic statement', async () => {
    getInvoiceMock.mockResolvedValueOnce(issuedInvoice({ status: 'VOID' }))
    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(recordInvoicePayment({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', amountCents: 100, method: 'CASH' }))
      .rejects.toThrow(/VOID/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects a not-found invoice (or wrong-tenant) before the atomic statement', async () => {
    getInvoiceMock.mockResolvedValueOnce(null)
    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(recordInvoicePayment({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', amountCents: 100, method: 'CASH' }))
      .rejects.toThrow(/not found/)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('Phase C5.2 — recordInvoicePayment(): success path', () => {
  it('inserts payment + allocation atomically, logs the audit event, and returns the derived summary', async () => {
    getInvoiceMock.mockResolvedValueOnce(issuedInvoice())
    sqlMock
      .mockResolvedValueOnce([payment()]) // atomic insert
      .mockResolvedValueOnce([{ paid_cents: 13200 }]) // summary: paid
      .mockResolvedValueOnce([payment()]) // summary: payments list

    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    const { payment: result, summary } = await recordInvoicePayment({
      organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', amountCents: 13200, method: 'BANK_TRANSFER',
    })

    expect(result.id).toBe('pay-1')
    expect(summary.amount_paid_cents).toBe(13200)
    expect(summary.outstanding_balance_cents).toBe(0)
    expect(summary.payment_state).toBe('PAID')
    expect(logPaymentRecordedMock).toHaveBeenCalledTimes(1)
    expect(logPaymentRecordedMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: ORG, paymentId: 'pay-1', invoiceId: 'inv-1' }))
    expect(sqlMock).toHaveBeenCalledTimes(3)
  })

  it('a partial payment derives PARTIALLY_PAID with the correct outstanding balance', async () => {
    getInvoiceMock.mockResolvedValueOnce(issuedInvoice({ total_cents: 20000 }))
    sqlMock
      .mockResolvedValueOnce([payment({ amount_cents: 5000 })])
      .mockResolvedValueOnce([{ paid_cents: 5000 }])
      .mockResolvedValueOnce([payment({ amount_cents: 5000 })])

    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    const { summary } = await recordInvoicePayment({
      organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', amountCents: 5000, method: 'CASH',
    })
    expect(summary.amount_paid_cents).toBe(5000)
    expect(summary.outstanding_balance_cents).toBe(15000)
    expect(summary.payment_state).toBe('PARTIALLY_PAID')
  })

  it('a second payment derives the correct aggregate across both', async () => {
    getInvoiceMock.mockResolvedValueOnce(issuedInvoice({ total_cents: 20000 }))
    sqlMock
      .mockResolvedValueOnce([payment({ amount_cents: 8000 })])
      .mockResolvedValueOnce([{ paid_cents: 13000 }]) // 5000 already recorded + this 8000
      .mockResolvedValueOnce([payment({ amount_cents: 5000 }), payment({ amount_cents: 8000 })])

    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    const { summary } = await recordInvoicePayment({
      organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', amountCents: 8000, method: 'CASH',
    })
    expect(summary.amount_paid_cents).toBe(13000)
    expect(summary.payments).toHaveLength(2)
  })
})

describe('Phase C5.2 — recordInvoicePayment(): rejection after the atomic statement returns zero rows', () => {
  it('classifies as overpayment when the invoice is still ISSUED but the amount exceeds the remaining balance', async () => {
    getInvoiceMock
      .mockResolvedValueOnce(issuedInvoice({ total_cents: 10000 })) // initial precondition read
      .mockResolvedValueOnce(issuedInvoice({ total_cents: 10000 })) // post-failure re-read: still ISSUED
    sqlMock
      .mockResolvedValueOnce([]) // atomic statement: zero rows (overpayment)
      .mockResolvedValueOnce([{ paid_cents: 4000 }]) // remaining = 10000 - 4000 = 6000, requested 9000 > 6000

    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(recordInvoicePayment({
      organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', amountCents: 9000, method: 'CASH',
    })).rejects.toThrow(/exceeds remaining balance/)
    expect(logPaymentRecordedMock).not.toHaveBeenCalled()
  })

  it('classifies as a concurrency conflict when the invoice is no longer ISSUED after the atomic attempt', async () => {
    getInvoiceMock
      .mockResolvedValueOnce(issuedInvoice()) // initial precondition read
      .mockResolvedValueOnce(issuedInvoice({ status: 'VOID' })) // post-failure re-read: no longer ISSUED
    sqlMock.mockResolvedValueOnce([]) // atomic statement: zero rows

    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(recordInvoicePayment({
      organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', amountCents: 100, method: 'CASH',
    })).rejects.toThrow(/concurrently/)
    expect(logPaymentRecordedMock).not.toHaveBeenCalled()
  })

  it('no payment row and no allocation row are ever left behind when the atomic statement rejects (single all-or-nothing statement)', async () => {
    // The atomic statement itself is a single sql`...` call whose CTEs
    // insert into BOTH tables in one round trip — a zero-row result
    // means NEITHER table was written to, by construction of the SQL
    // (ins_payment's own WHERE clause gates whether it inserts at all,
    // and ins_allocation only ever selects FROM ins_payment). This test
    // asserts the call count matches "one atomic attempt", not two
    // separate insert calls that could partially succeed.
    getInvoiceMock.mockResolvedValueOnce(issuedInvoice()).mockResolvedValueOnce(issuedInvoice({ status: 'VOID' }))
    sqlMock.mockResolvedValueOnce([])
    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(recordInvoicePayment({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', amountCents: 100, method: 'CASH' })).rejects.toThrow()
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })
})

describe('Phase C5.2 — getInvoicePaymentSummary(): derivation', () => {
  it('UNPAID when no active allocations exist', async () => {
    sqlMock.mockResolvedValueOnce([{ paid_cents: 0 }]).mockResolvedValueOnce([])
    const { getInvoicePaymentSummary } = await import('@/lib/commercial/payments')
    const summary = await getInvoicePaymentSummary(ORG, 'inv-1', 10000)
    expect(summary.payment_state).toBe('UNPAID')
    expect(summary.outstanding_balance_cents).toBe(10000)
  })

  it('reversed payments are excluded from amount_paid_cents (the SQL aggregate itself filters status = RECORDED)', async () => {
    // This test documents the contract at the JS boundary: the mock
    // simulates what the real WHERE cp.status = 'RECORDED' clause
    // would already have excluded — the reversed payment contributes
    // zero to paid_cents even though it still appears in the returned
    // history list.
    sqlMock
      .mockResolvedValueOnce([{ paid_cents: 0 }])
      .mockResolvedValueOnce([payment({ status: 'REVERSED', reversed_at: '2026-09-09T01:00:00.000Z', reversal_reason: 'test' })])
    const { getInvoicePaymentSummary } = await import('@/lib/commercial/payments')
    const summary = await getInvoicePaymentSummary(ORG, 'inv-1', 13200)
    expect(summary.amount_paid_cents).toBe(0)
    expect(summary.payment_state).toBe('UNPAID')
    expect(summary.payments).toHaveLength(1)
    expect(summary.payments[0].status).toBe('REVERSED')
  })
})

describe('Phase C5.2 — reverseInvoicePayment()', () => {
  it('rejects an empty/whitespace-only reason without any query', async () => {
    const { reverseInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(reverseInvoicePayment({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', paymentId: 'pay-1', reason: '   ' }))
      .rejects.toThrow(/required/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects a payment that does not belong to the given invoice/organisation', async () => {
    sqlMock.mockResolvedValueOnce([]) // belongs check: zero rows
    const { reverseInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(reverseInvoicePayment({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', paymentId: 'pay-1', reason: 'oops' }))
      .rejects.toThrow(/not found/)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('reverses a RECORDED payment and logs the audit event', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'pay-1' }]) // belongs check
      .mockResolvedValueOnce([payment({ status: 'REVERSED', reversed_at: '2026-09-09T02:00:00.000Z', reversed_by: 'u1', reversal_reason: 'oops' })])
    const { reverseInvoicePayment } = await import('@/lib/commercial/payments')
    const result = await reverseInvoicePayment({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', paymentId: 'pay-1', reason: 'oops' })
    expect(result.status).toBe('REVERSED')
    expect(result.reversal_reason).toBe('oops')
    expect(logPaymentReversedMock).toHaveBeenCalledTimes(1)
  })

  it('a repeated reversal (already REVERSED) is rejected, not a duplicate effect — the guarded UPDATE affects zero rows', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'pay-1' }]) // belongs check
      .mockResolvedValueOnce([]) // guarded UPDATE: zero rows, already REVERSED
    const { reverseInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(reverseInvoicePayment({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', paymentId: 'pay-1', reason: 'again' }))
      .rejects.toThrow(/already reversed/)
    expect(logPaymentReversedMock).not.toHaveBeenCalled()
  })
})

describe('Phase C5.2 — tenant isolation', () => {
  it('recordInvoicePayment: a wrong-tenant/missing invoice is rejected before any atomic statement — getInvoice() itself is tenant-scoped', async () => {
    getInvoiceMock.mockResolvedValueOnce(null) // getInvoice(orgId, invoiceId) already returns null for a different org's invoice
    const { recordInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(recordInvoicePayment({ organisationId: 'org-B', userId: 'u1', invoiceId: 'inv-owned-by-org-a', amountCents: 100, method: 'CASH' }))
      .rejects.toThrow(/not found/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('reverseInvoicePayment: cannot reverse a payment belonging to a different organisation — the belongs check is organisation-scoped and returns zero rows', async () => {
    sqlMock.mockResolvedValueOnce([]) // belongs check: cp.organisation_id = 'org-B' excludes an org-A payment
    const { reverseInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(reverseInvoicePayment({ organisationId: 'org-B', userId: 'u1', invoiceId: 'inv-1', paymentId: 'pay-owned-by-org-a', reason: 'x' }))
      .rejects.toThrow(/not found/)
    expect(logPaymentReversedMock).not.toHaveBeenCalled()
    // Only the belongs check ran — the guarded UPDATE is never attempted
    // for a payment that doesn't even belong to this organisation.
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('reverseInvoicePayment: cannot use a real payment id together with a mismatched invoiceId — the belongs check requires BOTH to match', async () => {
    sqlMock.mockResolvedValueOnce([]) // the JOIN's WHERE cpa.invoice_id = 'inv-wrong' excludes this payment's real allocation row
    const { reverseInvoicePayment } = await import('@/lib/commercial/payments')
    await expect(reverseInvoicePayment({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-wrong', paymentId: 'pay-1', reason: 'x' }))
      .rejects.toThrow(/not found/)
  })

  it('getInvoicePaymentSummary: every query is scoped by the given organisationId — the SQL text itself filters cpa.organisation_id, never trusts an unscoped payment/invoice id alone', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/commercial/payments.ts'), 'utf-8')
    // Every read/write query in this file filters by organisation_id —
    // this is a structural, source-level guarantee, not just a
    // per-test-case behavioral spot check.
    const sqlBlocks = source.match(/sql`[\s\S]*?`/g) ?? []
    expect(sqlBlocks.length).toBeGreaterThan(0)
    for (const block of sqlBlocks) {
      expect(block).toMatch(/organisation_id/)
    }
  })
})
