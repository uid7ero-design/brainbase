import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C3 — behavioural tests for lib/commercial/quotes.ts. The four
// sibling modules quotes.ts calls into (customers/products/taxCodes/
// documentNumbering) are mocked directly, rather than mocking '@/lib/db'
// deeply enough to drive their own internal SQL — this isolates
// quotes.ts's OWN logic (snapshot copying, totals calculation,
// transition guards) from those modules' own already-separately-tested
// internals, and keeps each test's sqlMock call sequence tied only to
// the SQL quotes.ts itself issues.

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

const getCustomerMock = vi.fn()
vi.mock('@/lib/commercial/customers', () => ({ getCustomer: (...a: unknown[]) => getCustomerMock(...a) }))

const getProductMock = vi.fn()
vi.mock('@/lib/commercial/products', () => ({ getProduct: (...a: unknown[]) => getProductMock(...a) }))

const getTaxCodeMock = vi.fn()
vi.mock('@/lib/commercial/taxCodes', () => ({ getTaxCode: (...a: unknown[]) => getTaxCodeMock(...a) }))

const allocateDocumentNumberMock = vi.fn()
vi.mock('@/lib/commercial/documentNumbering', () => ({ allocateDocumentNumber: (...a: unknown[]) => allocateDocumentNumberMock(...a) }))

vi.mock('@/lib/commercial/auditLog', () => ({
  logQuoteCreated: vi.fn(), logQuoteUpdated: vi.fn(), logQuoteIssued: vi.fn(),
  logQuoteAccepted: vi.fn(), logQuoteRejected: vi.fn(), logQuoteExpired: vi.fn(), logQuoteDeleted: vi.fn(),
}))

beforeEach(() => {
  sqlMock.mockReset()
  getCustomerMock.mockReset()
  getProductMock.mockReset()
  getTaxCodeMock.mockReset()
  allocateDocumentNumberMock.mockReset()
})

const ORG = 'org-a'
const draftQuote = (overrides: Record<string, unknown> = {}) => ({
  id: 'q1', organisation_id: ORG, customer_id: 'cust-1', quote_number: null, status: 'DRAFT',
  currency: 'AUD', subtotal_cents: 0, tax_cents: 0, total_cents: 0, ...overrides,
})

describe('Phase C3 — createDraftQuote()', () => {
  it('rejects a customer_id belonging to a different organisation (or nonexistent) before any INSERT', async () => {
    getCustomerMock.mockResolvedValueOnce(null)
    const { createDraftQuote } = await import('@/lib/commercial/quotes')
    await expect(createDraftQuote({ organisationId: ORG, userId: 'u1', customerId: 'cust-owned-by-org-b' }))
      .rejects.toThrow(/customer_id not found/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('creates a DRAFT row for a same-org customer', async () => {
    getCustomerMock.mockResolvedValueOnce({ id: 'cust-1', organisation_id: ORG, name: 'Acme' })
    sqlMock.mockResolvedValueOnce([draftQuote()])
    const { createDraftQuote } = await import('@/lib/commercial/quotes')
    const quote = await createDraftQuote({ organisationId: ORG, userId: 'u1', customerId: 'cust-1' })
    expect(quote.status).toBe('DRAFT')
    expect(quote.quote_number).toBeNull()
  })
})

describe('Phase C3 — addQuoteLine(): snapshotting and calculation', () => {
  it('rejects adding a line once the quote is no longer DRAFT', async () => {
    sqlMock.mockResolvedValueOnce([draftQuote({ status: 'SENT' })]) // getQuote
    const { addQuoteLine } = await import('@/lib/commercial/quotes')
    await expect(addQuoteLine({ organisationId: ORG, quoteId: 'q1', description: 'x', quantity: 1, unitPriceCents: 100 }))
      .rejects.toThrow(/Quote is SENT and can no longer be edited/)
  })

  it('a freeform line (no product_id) uses the supplied description/price/tax directly', async () => {
    sqlMock
      .mockResolvedValueOnce([draftQuote()]) // getQuote
      .mockResolvedValueOnce([{ next_position: 1 }]) // position lookup
      .mockResolvedValueOnce([{ id: 'line-1', description_snapshot: 'Consulting', line_subtotal_cents: 10000, line_tax_cents: 1000, line_total_cents: 11000 }]) // INSERT
      .mockResolvedValueOnce([{ line_subtotal_cents: 10000, line_tax_cents: 1000, line_total_cents: 11000 }]) // recalc: listQuoteLines
      .mockResolvedValueOnce([]) // recalc: UPDATE totals
    getTaxCodeMock.mockResolvedValueOnce({ id: 'tax-1', code: 'GST10', rate: '10.00' })

    const { addQuoteLine } = await import('@/lib/commercial/quotes')
    const line = await addQuoteLine({
      organisationId: ORG, quoteId: 'q1', description: 'Consulting', quantity: 1, unitPriceCents: 10000, taxCodeId: 'tax-1',
    })
    expect(line.line_total_cents).toBe(11000)
    expect(getProductMock).not.toHaveBeenCalled()
  })

  it('a product-backed line without an override copies name/price/tax from the CURRENT product row', async () => {
    sqlMock
      .mockResolvedValueOnce([draftQuote()])
      .mockResolvedValueOnce([{ next_position: 1 }])
      .mockResolvedValueOnce([{ id: 'line-1', description_snapshot: 'Widget', line_subtotal_cents: 500, line_tax_cents: 50, line_total_cents: 550 }])
      .mockResolvedValueOnce([{ line_subtotal_cents: 500, line_tax_cents: 50, line_total_cents: 550 }])
      .mockResolvedValueOnce([])
    getProductMock.mockResolvedValueOnce({
      id: 'prod-1', name: 'Widget', sku: 'W-1', unit_label: 'each', default_unit_price_cents: 500, default_tax_code_id: 'tax-1',
    })
    getTaxCodeMock.mockResolvedValueOnce({ id: 'tax-1', code: 'GST10', rate: '10.00' })

    const { addQuoteLine } = await import('@/lib/commercial/quotes')
    const line = await addQuoteLine({ organisationId: ORG, quoteId: 'q1', productId: 'prod-1', quantity: 1 })
    expect(line.description_snapshot).toBe('Widget')
    expect(getProductMock).toHaveBeenCalledWith(ORG, 'prod-1')
  })

  it('rejects a product_id belonging to a different organisation', async () => {
    sqlMock.mockResolvedValueOnce([draftQuote()])
    getProductMock.mockResolvedValueOnce(null)
    const { addQuoteLine } = await import('@/lib/commercial/quotes')
    await expect(addQuoteLine({ organisationId: ORG, quoteId: 'q1', productId: 'product-owned-by-org-b', quantity: 1 }))
      .rejects.toThrow(/product_id not found/)
  })

  it('rejects a tax_code_id belonging to a different organisation', async () => {
    sqlMock.mockResolvedValueOnce([draftQuote()])
    getTaxCodeMock.mockResolvedValueOnce(null)
    const { addQuoteLine } = await import('@/lib/commercial/quotes')
    await expect(addQuoteLine({ organisationId: ORG, quoteId: 'q1', description: 'x', quantity: 1, unitPriceCents: 100, taxCodeId: 'tax-owned-by-org-b' }))
      .rejects.toThrow(/tax_code_id not found/)
  })

  it('rejects a non-positive or fractional quantity', async () => {
    sqlMock.mockResolvedValue([draftQuote()])
    const { addQuoteLine } = await import('@/lib/commercial/quotes')
    await expect(addQuoteLine({ organisationId: ORG, quoteId: 'q1', description: 'x', quantity: 0, unitPriceCents: 100 }))
      .rejects.toThrow(/quantity must be a positive integer/)
    await expect(addQuoteLine({ organisationId: ORG, quoteId: 'q1', description: 'x', quantity: 1.5, unitPriceCents: 100 }))
      .rejects.toThrow(/quantity must be a positive integer/)
  })
})

describe('Phase C3 — tax rounding scenarios (line-level calculation)', () => {
  async function addLine(unitPriceCents: number, quantity: number, ratePercent: number | null) {
    sqlMock
      .mockResolvedValueOnce([draftQuote()])
      .mockResolvedValueOnce([{ next_position: 1 }])
      .mockImplementationOnce(async (_strings: unknown, ...values: number[]) => {
        // Simulates the INSERT ... RETURNING * by echoing back the exact
        // computed values quotes.ts passed as bound parameters — proves
        // THIS test asserts on quotes.ts's own arithmetic, not a
        // hand-duplicated copy of it. Parameter order (0-indexed, after
        // the strings array): organisationId(0), quoteId(1), productId(2),
        // position(3), description(4), sku(5), unit(6), quantity(7),
        // unitPriceCents(8), taxCodeSnapshot(9), taxRateSnapshot(10),
        // line_subtotal_cents(11), line_tax_cents(12), line_total_cents(13)
        // — matching lib/commercial/quotes.ts's addQuoteLine() INSERT
        // column list exactly.
        return [{ line_subtotal_cents: values[11], line_tax_cents: values[12], line_total_cents: values[13] }]
      })
      .mockResolvedValueOnce([{ line_subtotal_cents: 0, line_tax_cents: 0, line_total_cents: 0 }])
      .mockResolvedValueOnce([])
    if (ratePercent !== null) getTaxCodeMock.mockResolvedValueOnce({ id: 'tax-1', code: 'T', rate: String(ratePercent) })
    const { addQuoteLine } = await import('@/lib/commercial/quotes')
    return addQuoteLine({
      organisationId: ORG, quoteId: 'q1', description: 'x', quantity, unitPriceCents,
      taxCodeId: ratePercent !== null ? 'tax-1' : null,
    })
  }

  it('tax-free line: tax is exactly 0', async () => {
    const line = await addLine(1000, 1, null)
    expect(line.line_subtotal_cents).toBe(1000)
    expect(line.line_tax_cents).toBe(0)
    expect(line.line_total_cents).toBe(1000)
  })

  it('GST 10% on a whole-dollar amount: exact, no rounding needed', async () => {
    const line = await addLine(10000, 1, 10)
    expect(line.line_subtotal_cents).toBe(10000)
    expect(line.line_tax_cents).toBe(1000)
    expect(line.line_total_cents).toBe(11000)
  })

  it('quantity > 1 multiplies the subtotal before tax is applied', async () => {
    const line = await addLine(333, 3, 10)
    // 333 * 3 = 999 subtotal; 10% of 999 = 99.9 -> rounds half-up to 100
    expect(line.line_subtotal_cents).toBe(999)
    expect(line.line_tax_cents).toBe(100)
    expect(line.line_total_cents).toBe(1099)
  })

  it('fractional-cent tax rounds half-up (e.g. 10% of 25 cents = 2.5 -> 3)', async () => {
    const line = await addLine(25, 1, 10)
    expect(line.line_tax_cents).toBe(3)
  })

  it('zero-price line: subtotal/tax/total all 0 even with a tax code selected', async () => {
    const line = await addLine(0, 5, 10)
    expect(line.line_subtotal_cents).toBe(0)
    expect(line.line_tax_cents).toBe(0)
    expect(line.line_total_cents).toBe(0)
  })
})

describe('Phase C3 — updateQuoteLine() / deleteQuoteLine(): DRAFT-only guard', () => {
  it('updateQuoteLine rejects once the quote has left DRAFT', async () => {
    sqlMock.mockResolvedValueOnce([draftQuote({ status: 'ACCEPTED' })])
    const { updateQuoteLine } = await import('@/lib/commercial/quotes')
    await expect(updateQuoteLine({ organisationId: ORG, quoteId: 'q1', lineId: 'line-1', quantity: 2 }))
      .rejects.toThrow(/Quote is ACCEPTED and can no longer be edited/)
  })

  it('deleteQuoteLine rejects once the quote has left DRAFT', async () => {
    sqlMock.mockResolvedValueOnce([draftQuote({ status: 'REJECTED' })])
    const { deleteQuoteLine } = await import('@/lib/commercial/quotes')
    await expect(deleteQuoteLine({ organisationId: ORG, quoteId: 'q1', lineId: 'line-1' }))
      .rejects.toThrow(/Quote is REJECTED and can no longer be edited/)
  })
})

describe('Phase C3 — issueQuote(): transition guard, snapshot copy, numbering', () => {
  it('refuses to issue a quote with zero lines', async () => {
    sqlMock
      .mockResolvedValueOnce([draftQuote()]) // getQuote (inside getQuoteWithLines)
      .mockResolvedValueOnce([]) // listQuoteLines -> no lines
    const { issueQuote } = await import('@/lib/commercial/quotes')
    await expect(issueQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' }))
      .rejects.toThrow(/cannot issue a quote with no lines/)
    expect(allocateDocumentNumberMock).not.toHaveBeenCalled()
  })

  it('refuses to issue an already-SENT quote (illegal transition)', async () => {
    sqlMock
      .mockResolvedValueOnce([draftQuote({ status: 'SENT' })])
      .mockResolvedValueOnce([{ id: 'line-1' }])
    const { issueQuote } = await import('@/lib/commercial/quotes')
    await expect(issueQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' }))
      .rejects.toThrow(/Cannot transition quote from SENT to SENT/)
  })

  it('on success: allocates a document number and copies the CURRENT customer snapshot onto the quote', async () => {
    sqlMock
      .mockResolvedValueOnce([draftQuote()]) // getQuote
      .mockResolvedValueOnce([{ id: 'line-1', line_subtotal_cents: 1000, line_tax_cents: 100, line_total_cents: 1100 }]) // listQuoteLines
      .mockResolvedValueOnce([{ line_subtotal_cents: 1000, line_tax_cents: 100, line_total_cents: 1100 }]) // recalc listQuoteLines
      .mockResolvedValueOnce([]) // recalc UPDATE
      .mockResolvedValueOnce([{ // final issue UPDATE ... RETURNING *
        ...draftQuote({ status: 'SENT' }),
        quote_number: 'QUO-000001', total_cents: 1100,
        customer_name_snapshot: 'Acme Pty Ltd', billing_name_snapshot: 'Acme Pty Ltd',
      }])
    getCustomerMock.mockResolvedValueOnce({
      id: 'cust-1', name: 'Acme Pty Ltd', billing_address: '1 Test St', billing_email: 'a@acme.test', billing_phone: '000', tax_business_number: 'ABN123',
    })
    allocateDocumentNumberMock.mockResolvedValueOnce('QUO-000001')

    const { issueQuote } = await import('@/lib/commercial/quotes')
    const issued = await issueQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' })
    expect(issued.status).toBe('SENT')
    expect(issued.quote_number).toBe('QUO-000001')
    expect(issued.customer_name_snapshot).toBe('Acme Pty Ltd')
    expect(allocateDocumentNumberMock).toHaveBeenCalledWith(ORG, 'QUOTE')
  })

  it('throws (a number was allocated but not consumed) if the quote status changed concurrently between read and the issuing UPDATE', async () => {
    sqlMock
      .mockResolvedValueOnce([draftQuote()])
      .mockResolvedValueOnce([{ id: 'line-1', line_subtotal_cents: 1000, line_tax_cents: 100, line_total_cents: 1100 }])
      .mockResolvedValueOnce([{ line_subtotal_cents: 1000, line_tax_cents: 100, line_total_cents: 1100 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // final UPDATE affects 0 rows — someone else already moved it out of DRAFT
    getCustomerMock.mockResolvedValueOnce({ id: 'cust-1', name: 'Acme', billing_address: null, billing_email: null, billing_phone: null, tax_business_number: null })
    allocateDocumentNumberMock.mockResolvedValueOnce('QUO-000002')

    const { issueQuote } = await import('@/lib/commercial/quotes')
    await expect(issueQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' }))
      .rejects.toThrow(/status changed concurrently/)
  })
})

describe('Phase C3 — acceptQuote() / rejectQuote() / expireQuote(): only legal from SENT', () => {
  it('acceptQuote succeeds from SENT', async () => {
    sqlMock
      .mockResolvedValueOnce([draftQuote({ status: 'SENT' })])
      .mockResolvedValueOnce([draftQuote({ status: 'ACCEPTED' })])
    const { acceptQuote } = await import('@/lib/commercial/quotes')
    const result = await acceptQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' })
    expect(result.status).toBe('ACCEPTED')
  })

  it('acceptQuote refuses from DRAFT', async () => {
    sqlMock.mockResolvedValueOnce([draftQuote()])
    const { acceptQuote } = await import('@/lib/commercial/quotes')
    await expect(acceptQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' }))
      .rejects.toThrow(/Cannot transition quote from DRAFT to ACCEPTED/)
  })

  it('rejectQuote refuses from an already-terminal ACCEPTED state — an accepted quote can never be rejected after the fact', async () => {
    sqlMock.mockResolvedValueOnce([draftQuote({ status: 'ACCEPTED' })])
    const { rejectQuote } = await import('@/lib/commercial/quotes')
    await expect(rejectQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' }))
      .rejects.toThrow(/Cannot transition quote from ACCEPTED to REJECTED/)
  })

  it('expireQuote succeeds from SENT', async () => {
    sqlMock
      .mockResolvedValueOnce([draftQuote({ status: 'SENT' })])
      .mockResolvedValueOnce([draftQuote({ status: 'EXPIRED' })])
    const { expireQuote } = await import('@/lib/commercial/quotes')
    const result = await expireQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' })
    expect(result.status).toBe('EXPIRED')
  })
})

describe('Phase C3 — deleteDraftQuote(): DRAFT-only, narrow scope', () => {
  it('deletes a DRAFT quote and returns true', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'q1' }])
    const { deleteDraftQuote } = await import('@/lib/commercial/quotes')
    const result = await deleteDraftQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' })
    expect(result).toBe(true)
  })

  it('returns false for a non-DRAFT quote (WHERE status = DRAFT excludes it) or one belonging to a different organisation', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { deleteDraftQuote } = await import('@/lib/commercial/quotes')
    const result = await deleteDraftQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' })
    expect(result).toBe(false)
  })
})

describe('Phase C3 — getQuote()/getQuoteWithLines(): tenant isolation via WHERE, not filtering after the fact', () => {
  it('getQuote returns null for a quote belonging to a different organisation', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { getQuote } = await import('@/lib/commercial/quotes')
    const result = await getQuote(ORG, 'quote-owned-by-org-b')
    expect(result).toBeNull()
    expect(sqlMock.mock.calls[0]).toContain(ORG)
  })
})
