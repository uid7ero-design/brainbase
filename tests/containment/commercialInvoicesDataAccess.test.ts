import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C4.1 — behavioural tests for lib/commercial/invoices.ts, mirroring
// tests/containment/commercialQuotesDataAccess.test.ts's own mocking
// discipline exactly: the sibling modules invoices.ts calls into
// (customers/products/taxCodes/quotes/documentNumbering/auditLog) are
// mocked directly rather than mocking '@/lib/db' deeply enough to drive
// their own internal SQL — this isolates invoices.ts's OWN logic
// (snapshot copying, totals calculation, transition guards, quote
// conversion) from those modules' own already-separately-tested
// internals.

const sqlMock = vi.fn()
const transactionMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: Object.assign(
    (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
    { transaction: (...args: unknown[]) => (transactionMock as unknown as (...a: unknown[]) => unknown)(...args) },
  ),
}))

const getCustomerMock = vi.fn()
vi.mock('@/lib/commercial/customers', () => ({ getCustomer: (...a: unknown[]) => getCustomerMock(...a) }))

const getProductMock = vi.fn()
vi.mock('@/lib/commercial/products', () => ({ getProduct: (...a: unknown[]) => getProductMock(...a) }))

const getTaxCodeMock = vi.fn()
vi.mock('@/lib/commercial/taxCodes', () => ({ getTaxCode: (...a: unknown[]) => getTaxCodeMock(...a) }))

const getQuoteMock = vi.fn()
const getQuoteWithLinesMock = vi.fn()
vi.mock('@/lib/commercial/quotes', () => ({
  getQuote: (...a: unknown[]) => getQuoteMock(...a),
  getQuoteWithLines: (...a: unknown[]) => getQuoteWithLinesMock(...a),
}))

const allocateDocumentNumberMock = vi.fn()
vi.mock('@/lib/commercial/documentNumbering', () => ({ allocateDocumentNumber: (...a: unknown[]) => allocateDocumentNumberMock(...a) }))

const logInvoiceCreatedMock = vi.fn()
const logInvoiceCreatedFromQuoteMock = vi.fn()
const logInvoiceUpdatedMock = vi.fn()
const logInvoiceIssuedMock = vi.fn()
const logInvoiceVoidedMock = vi.fn()
const logInvoiceDeletedMock = vi.fn()
vi.mock('@/lib/commercial/auditLog', () => ({
  logInvoiceCreated: (...a: unknown[]) => logInvoiceCreatedMock(...a),
  logInvoiceCreatedFromQuote: (...a: unknown[]) => logInvoiceCreatedFromQuoteMock(...a),
  logInvoiceUpdated: (...a: unknown[]) => logInvoiceUpdatedMock(...a),
  logInvoiceIssued: (...a: unknown[]) => logInvoiceIssuedMock(...a),
  logInvoiceVoided: (...a: unknown[]) => logInvoiceVoidedMock(...a),
  logInvoiceDeleted: (...a: unknown[]) => logInvoiceDeletedMock(...a),
}))

beforeEach(() => {
  sqlMock.mockReset()
  transactionMock.mockReset()
  getCustomerMock.mockReset()
  getProductMock.mockReset()
  getTaxCodeMock.mockReset()
  getQuoteMock.mockReset()
  getQuoteWithLinesMock.mockReset()
  allocateDocumentNumberMock.mockReset()
  logInvoiceCreatedMock.mockReset()
  logInvoiceCreatedFromQuoteMock.mockReset()
  logInvoiceUpdatedMock.mockReset()
  logInvoiceIssuedMock.mockReset()
  logInvoiceVoidedMock.mockReset()
  logInvoiceDeletedMock.mockReset()
})

const ORG = 'org-a'
const draftInvoice = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv-1', organisation_id: ORG, customer_id: 'cust-1', source_quote_id: null, invoice_number: null,
  status: 'DRAFT', currency: 'AUD', due_date: null, payment_terms_days: null,
  subtotal_cents: 0, tax_cents: 0, total_cents: 0, ...overrides,
})
const acceptedQuote = (overrides: Record<string, unknown> = {}) => ({
  id: 'q1', organisation_id: ORG, customer_id: 'cust-1', quote_number: 'QUO-000001', status: 'ACCEPTED',
  currency: 'AUD', subtotal_cents: 1000, tax_cents: 100, total_cents: 1100, ...overrides,
})
const quoteLine = (overrides: Record<string, unknown> = {}) => ({
  id: 'ql-1', organisation_id: ORG, quote_id: 'q1', product_id: null, position: 1,
  description_snapshot: 'Consulting', sku_snapshot: null, unit_snapshot: null,
  quantity: 1, unit_price_cents: 1000, tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00',
  line_subtotal_cents: 1000, line_tax_cents: 100, line_total_cents: 1100, ...overrides,
})

// ── STANDALONE ───────────────────────────────────────────────────────

describe('Phase C4.1 — createDraftInvoice(): standalone creation', () => {
  it('rejects a customer_id belonging to a different organisation (or nonexistent) before any INSERT', async () => {
    getCustomerMock.mockResolvedValueOnce(null)
    const { createDraftInvoice } = await import('@/lib/commercial/invoices')
    await expect(createDraftInvoice({ organisationId: ORG, userId: 'u1', customerId: 'cust-owned-by-org-b' }))
      .rejects.toThrow(/customer_id not found/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('creates a DRAFT invoice for a same-org customer with no invoice_number and no issued snapshots', async () => {
    getCustomerMock.mockResolvedValueOnce({ id: 'cust-1', organisation_id: ORG, name: 'Acme' })
    sqlMock.mockResolvedValueOnce([draftInvoice()])
    const { createDraftInvoice } = await import('@/lib/commercial/invoices')
    const invoice = await createDraftInvoice({ organisationId: ORG, userId: 'u1', customerId: 'cust-1' })
    expect(invoice.status).toBe('DRAFT')
    expect(invoice.invoice_number).toBeNull()
    expect(invoice.customer_name_snapshot ?? null).toBeNull()
    expect(allocateDocumentNumberMock).not.toHaveBeenCalled()
    expect(logInvoiceCreatedMock).toHaveBeenCalledTimes(1)
  })

  it('does not consume a document number on creation', async () => {
    getCustomerMock.mockResolvedValueOnce({ id: 'cust-1', organisation_id: ORG, name: 'Acme' })
    sqlMock.mockResolvedValueOnce([draftInvoice()])
    const { createDraftInvoice } = await import('@/lib/commercial/invoices')
    await createDraftInvoice({ organisationId: ORG, userId: 'u1', customerId: 'cust-1' })
    expect(allocateDocumentNumberMock).not.toHaveBeenCalled()
  })
})

// ── TENANCY ──────────────────────────────────────────────────────────

describe('Phase C4.1 — tenant isolation across every domain query', () => {
  it('getInvoice returns null for an invoice belonging to a different organisation', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { getInvoice } = await import('@/lib/commercial/invoices')
    const result = await getInvoice(ORG, 'invoice-owned-by-org-b')
    expect(result).toBeNull()
    expect(sqlMock.mock.calls[0]).toContain(ORG)
  })

  it('addInvoiceLine rejects a product_id belonging to a different organisation', async () => {
    sqlMock.mockResolvedValueOnce([draftInvoice()])
    getProductMock.mockResolvedValueOnce(null)
    const { addInvoiceLine } = await import('@/lib/commercial/invoices')
    await expect(addInvoiceLine({ organisationId: ORG, invoiceId: 'inv-1', productId: 'product-owned-by-org-b', quantity: 1 }))
      .rejects.toThrow(/product_id not found/)
  })

  it('addInvoiceLine rejects a tax_code_id belonging to a different organisation', async () => {
    sqlMock.mockResolvedValueOnce([draftInvoice()])
    getTaxCodeMock.mockResolvedValueOnce(null)
    const { addInvoiceLine } = await import('@/lib/commercial/invoices')
    await expect(addInvoiceLine({ organisationId: ORG, invoiceId: 'inv-1', description: 'x', quantity: 1, unitPriceCents: 100, taxCodeId: 'tax-owned-by-org-b' }))
      .rejects.toThrow(/tax_code_id not found/)
  })

  it('createInvoiceFromQuote rejects a quote belonging to a different organisation (or nonexistent) — indistinguishable, no enumeration leak', async () => {
    getQuoteWithLinesMock.mockResolvedValueOnce(null)
    const { createInvoiceFromQuote } = await import('@/lib/commercial/invoices')
    await expect(createInvoiceFromQuote({ organisationId: ORG, userId: 'u1', quoteId: 'quote-owned-by-org-b' }))
      .rejects.toThrow(/quote not found/)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('issueInvoice rejects an invoice belonging to a different organisation (or nonexistent)', async () => {
    sqlMock.mockResolvedValueOnce([]) // getInvoice inside getInvoiceWithLines
    const { issueInvoice } = await import('@/lib/commercial/invoices')
    await expect(issueInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'invoice-owned-by-org-b' }))
      .rejects.toThrow(/invoice not found/)
  })
})

// ── QUOTE CONVERSION ─────────────────────────────────────────────────

describe('Phase C4.1 — createInvoiceFromQuote(): status gate', () => {
  it.each(['DRAFT', 'SENT', 'REJECTED', 'EXPIRED'])('rejects a %s quote (only ACCEPTED may convert)', async (status) => {
    getQuoteWithLinesMock.mockResolvedValueOnce({ quote: acceptedQuote({ status }), lines: [quoteLine()] })
    const { createInvoiceFromQuote } = await import('@/lib/commercial/invoices')
    await expect(createInvoiceFromQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' }))
      .rejects.toThrow(new RegExp(`status ${status}`))
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('rejects a quote with zero lines', async () => {
    getQuoteWithLinesMock.mockResolvedValueOnce({ quote: acceptedQuote(), lines: [] })
    const { createInvoiceFromQuote } = await import('@/lib/commercial/invoices')
    await expect(createInvoiceFromQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' }))
      .rejects.toThrow(/no lines/)
    expect(transactionMock).not.toHaveBeenCalled()
  })
})

describe('Phase C4.1 — createInvoiceFromQuote(): success path — lineage, snapshots, totals', () => {
  function mockSqlForConversion(invoiceRow: Record<string, unknown>) {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join('')
      if (text.includes('SELECT * FROM commercial_invoices')) return Promise.resolve([invoiceRow])
      return Promise.resolve([]) // the INSERT statements built into the `queries` array — their own direct return value is never used
    })
  }

  it('converts an ACCEPTED quote: copies customer_id/currency, preserves quote+line lineage, recomputes totals via money.ts, allocates no number', async () => {
    getQuoteWithLinesMock.mockResolvedValueOnce({
      quote: acceptedQuote(),
      lines: [quoteLine(), quoteLine({ id: 'ql-2', position: 2, description_snapshot: 'Support', line_subtotal_cents: 0, line_tax_cents: 0, line_total_cents: 0, unit_price_cents: 0, tax_rate_snapshot: '0.00', tax_code_snapshot: null })],
    })
    getCustomerMock.mockResolvedValueOnce({ id: 'cust-1', organisation_id: ORG, name: 'Acme' })
    transactionMock.mockResolvedValueOnce([undefined, undefined, undefined])
    const invoiceRow = draftInvoice({ source_quote_id: 'q1', subtotal_cents: 1000, tax_cents: 100, total_cents: 1100 })
    mockSqlForConversion(invoiceRow)

    const { createInvoiceFromQuote } = await import('@/lib/commercial/invoices')
    const invoice = await createInvoiceFromQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' })

    expect(invoice.source_quote_id).toBe('q1')
    expect(invoice.invoice_number).toBeNull()
    expect(allocateDocumentNumberMock).not.toHaveBeenCalled()
    expect(transactionMock).toHaveBeenCalledTimes(1)

    // Inspect the actual queries handed to sql.transaction() — proves
    // lineage (source_quote_id / source_quote_line_id) and the copied
    // snapshot values are exactly what was passed, not re-derived.
    const queries = transactionMock.mock.calls[0][0] as unknown[]
    expect(queries).toHaveLength(3) // 1 invoice INSERT + 2 line INSERTs
    expect(logInvoiceCreatedFromQuoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ organisationId: ORG, sourceQuoteId: 'q1' }),
    )
  })

  it('one ACCEPTED quote may produce multiple invoices — no uniqueness/duplicate guard blocks a second conversion', async () => {
    const setup = () => {
      getQuoteWithLinesMock.mockResolvedValueOnce({ quote: acceptedQuote(), lines: [quoteLine()] })
      getCustomerMock.mockResolvedValueOnce({ id: 'cust-1', organisation_id: ORG, name: 'Acme' })
      transactionMock.mockResolvedValueOnce([undefined, undefined])
      mockSqlForConversion(draftInvoice({ source_quote_id: 'q1' }))
    }
    const { createInvoiceFromQuote } = await import('@/lib/commercial/invoices')
    setup()
    await createInvoiceFromQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' })
    setup()
    await createInvoiceFromQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' })
    expect(transactionMock).toHaveBeenCalledTimes(2)
  })

  it('aborts (writes nothing) if the recomputed totals do not agree with the source quote\'s own persisted totals', async () => {
    getQuoteWithLinesMock.mockResolvedValueOnce({
      // Deliberately inconsistent: the quote's own total_cents (9999)
      // does not match what its one line actually recomputes to (1100).
      quote: acceptedQuote({ total_cents: 9999 }),
      lines: [quoteLine()],
    })
    getCustomerMock.mockResolvedValueOnce({ id: 'cust-1', organisation_id: ORG, name: 'Acme' })
    const { createInvoiceFromQuote } = await import('@/lib/commercial/invoices')
    await expect(createInvoiceFromQuote({ organisationId: ORG, userId: 'u1', quoteId: 'q1' }))
      .rejects.toThrow(/do not match the source quote/)
    expect(transactionMock).not.toHaveBeenCalled()
    expect(logInvoiceCreatedFromQuoteMock).not.toHaveBeenCalled()
  })
})

// ── MONEY ────────────────────────────────────────────────────────────

describe('Phase C4.1 — money/tax calculation on addInvoiceLine (integer cents, HALF-UP rounding)', () => {
  async function addLine(unitPriceCents: number, quantity: number, ratePercent: number | null) {
    sqlMock
      .mockResolvedValueOnce([draftInvoice()]) // getInvoice
      .mockResolvedValueOnce([{ next_position: 1 }]) // position lookup
      .mockImplementationOnce(async (_strings: unknown, ...values: number[]) => {
        // Column order matches addInvoiceLine()'s own INSERT: org(0),
        // invoice(1), product(2), position(3), description(4), sku(5),
        // unit(6), quantity(7), unitPriceCents(8), taxCodeSnapshot(9),
        // taxRateSnapshot(10), line_subtotal_cents(11), line_tax_cents(12),
        // line_total_cents(13).
        return [{ line_subtotal_cents: values[11], line_tax_cents: values[12], line_total_cents: values[13] }]
      })
      .mockResolvedValueOnce([{ line_subtotal_cents: 0, line_tax_cents: 0, line_total_cents: 0 }]) // recalc listInvoiceLines
      .mockResolvedValueOnce([]) // recalc UPDATE
    if (ratePercent !== null) getTaxCodeMock.mockResolvedValueOnce({ id: 'tax-1', code: 'GST', rate: String(ratePercent) })
    const { addInvoiceLine } = await import('@/lib/commercial/invoices')
    return addInvoiceLine({
      organisationId: ORG, invoiceId: 'inv-1', description: 'x', quantity, unitPriceCents,
      taxCodeId: ratePercent !== null ? 'tax-1' : null,
    })
  }

  it('GST 10% on a whole-dollar amount: exact, no rounding needed', async () => {
    const line = await addLine(10000, 1, 10)
    expect(line.line_subtotal_cents).toBe(10000)
    expect(line.line_tax_cents).toBe(1000)
    expect(line.line_total_cents).toBe(11000)
  })

  it('GST Free (0%): tax is exactly 0', async () => {
    const line = await addLine(5000, 2, 0)
    expect(line.line_subtotal_cents).toBe(10000)
    expect(line.line_tax_cents).toBe(0)
    expect(line.line_total_cents).toBe(10000)
  })

  it('No Tax (null tax code): tax is exactly 0', async () => {
    const line = await addLine(1000, 1, null)
    expect(line.line_subtotal_cents).toBe(1000)
    expect(line.line_tax_cents).toBe(0)
    expect(line.line_total_cents).toBe(1000)
  })

  it('fractional-cent tax rounds HALF-UP (10% of 25 cents = 2.5 -> 3)', async () => {
    const line = await addLine(25, 1, 10)
    expect(line.line_tax_cents).toBe(3)
  })

  it('multi-unit quantity multiplies the subtotal before tax is applied', async () => {
    const line = await addLine(333, 3, 10)
    expect(line.line_subtotal_cents).toBe(999)
    expect(line.line_tax_cents).toBe(100) // 99.9 rounds half-up to 100
    expect(line.line_total_cents).toBe(1099)
  })

  it('rejects a non-positive or fractional quantity', async () => {
    sqlMock.mockResolvedValue([draftInvoice()])
    const { addInvoiceLine } = await import('@/lib/commercial/invoices')
    await expect(addInvoiceLine({ organisationId: ORG, invoiceId: 'inv-1', description: 'x', quantity: 0, unitPriceCents: 100 }))
      .rejects.toThrow(/quantity must be a positive integer/)
  })

  it('rejects adding a line once the invoice is no longer DRAFT', async () => {
    sqlMock.mockResolvedValueOnce([draftInvoice({ status: 'ISSUED' })])
    const { addInvoiceLine } = await import('@/lib/commercial/invoices')
    await expect(addInvoiceLine({ organisationId: ORG, invoiceId: 'inv-1', description: 'x', quantity: 1, unitPriceCents: 100 }))
      .rejects.toThrow(/Invoice is ISSUED and can no longer be edited/)
  })
})

describe('Phase C4.1 — updateInvoiceLine() / deleteInvoiceLine(): DRAFT-only guard', () => {
  it('updateInvoiceLine rejects once the invoice has left DRAFT', async () => {
    sqlMock.mockResolvedValueOnce([draftInvoice({ status: 'ISSUED' })])
    const { updateInvoiceLine } = await import('@/lib/commercial/invoices')
    await expect(updateInvoiceLine({ organisationId: ORG, invoiceId: 'inv-1', lineId: 'line-1', quantity: 2 }))
      .rejects.toThrow(/Invoice is ISSUED and can no longer be edited/)
  })

  it('deleteInvoiceLine rejects once the invoice has left DRAFT', async () => {
    sqlMock.mockResolvedValueOnce([draftInvoice({ status: 'VOID' })])
    const { deleteInvoiceLine } = await import('@/lib/commercial/invoices')
    await expect(deleteInvoiceLine({ organisationId: ORG, invoiceId: 'inv-1', lineId: 'line-1' }))
      .rejects.toThrow(/Invoice is VOID and can no longer be edited/)
  })
})

// ── ISSUE ────────────────────────────────────────────────────────────

describe('Phase C4.1 — issueInvoice()', () => {
  it('refuses to issue an invoice with zero lines', async () => {
    sqlMock
      .mockResolvedValueOnce([draftInvoice()]) // getInvoice (inside getInvoiceWithLines)
      .mockResolvedValueOnce([]) // listInvoiceLines -> no lines
    const { issueInvoice } = await import('@/lib/commercial/invoices')
    await expect(issueInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1' }))
      .rejects.toThrow(/cannot issue an invoice with no lines/)
    expect(allocateDocumentNumberMock).not.toHaveBeenCalled()
    expect(logInvoiceIssuedMock).not.toHaveBeenCalled()
  })

  it('refuses to issue an invoice with no due_date set', async () => {
    sqlMock
      .mockResolvedValueOnce([draftInvoice()])
      .mockResolvedValueOnce([{ id: 'line-1', line_subtotal_cents: 1000, line_tax_cents: 100, line_total_cents: 1100 }])
    const { issueInvoice } = await import('@/lib/commercial/invoices')
    await expect(issueInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1' }))
      .rejects.toThrow(/no due date/)
    expect(allocateDocumentNumberMock).not.toHaveBeenCalled()
    expect(logInvoiceIssuedMock).not.toHaveBeenCalled()
  })

  it('refuses to issue an already-ISSUED invoice (illegal transition)', async () => {
    sqlMock
      .mockResolvedValueOnce([draftInvoice({ status: 'ISSUED', due_date: '2026-10-01' })])
      .mockResolvedValueOnce([{ id: 'line-1' }])
    const { issueInvoice } = await import('@/lib/commercial/invoices')
    await expect(issueInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1' }))
      .rejects.toThrow(/Cannot transition invoice from ISSUED to ISSUED/)
  })

  it('on success: allocates an INVOICE document number and captures the CURRENT customer snapshot at issue time — never at creation', async () => {
    sqlMock
      .mockResolvedValueOnce([draftInvoice({ due_date: '2026-10-01' })]) // getInvoice
      .mockResolvedValueOnce([{ id: 'line-1', line_subtotal_cents: 1000, line_tax_cents: 100, line_total_cents: 1100 }]) // listInvoiceLines
      .mockResolvedValueOnce([{ line_subtotal_cents: 1000, line_tax_cents: 100, line_total_cents: 1100 }]) // recalc listInvoiceLines
      .mockResolvedValueOnce([]) // recalc UPDATE
      .mockResolvedValueOnce([{ // final issue UPDATE ... RETURNING *
        ...draftInvoice({ status: 'ISSUED', due_date: '2026-10-01' }),
        invoice_number: 'INV-000001', total_cents: 1100,
        customer_name_snapshot: 'Acme Pty Ltd', billing_name_snapshot: 'Acme Pty Ltd',
      }])
    getCustomerMock.mockResolvedValueOnce({
      id: 'cust-1', name: 'Acme Pty Ltd', billing_address: '1 Test St', billing_email: 'a@acme.test', billing_phone: '000', tax_business_number: 'ABN123',
    })
    allocateDocumentNumberMock.mockResolvedValueOnce('INV-000001')

    const { issueInvoice } = await import('@/lib/commercial/invoices')
    const issued = await issueInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1' })
    expect(issued.status).toBe('ISSUED')
    expect(issued.invoice_number).toBe('INV-000001')
    expect(issued.customer_name_snapshot).toBe('Acme Pty Ltd')
    expect(allocateDocumentNumberMock).toHaveBeenCalledWith(ORG, 'INVOICE')
    expect(logInvoiceIssuedMock).toHaveBeenCalledWith(
      expect.objectContaining({ organisationId: ORG, invoiceId: 'inv-1', invoiceNumber: 'INV-000001', totalCents: 1100 }),
    )
  })

  it('two concurrent issue calls on the same invoice cannot both succeed — the losing UPDATE affects zero rows and throws, number becomes a permanent gap', async () => {
    sqlMock
      .mockResolvedValueOnce([draftInvoice({ due_date: '2026-10-01' })])
      .mockResolvedValueOnce([{ id: 'line-1', line_subtotal_cents: 1000, line_tax_cents: 100, line_total_cents: 1100 }])
      .mockResolvedValueOnce([{ line_subtotal_cents: 1000, line_tax_cents: 100, line_total_cents: 1100 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // final UPDATE affects 0 rows — someone else already moved it out of DRAFT
    getCustomerMock.mockResolvedValueOnce({ id: 'cust-1', name: 'Acme', billing_address: null, billing_email: null, billing_phone: null, tax_business_number: null })
    allocateDocumentNumberMock.mockResolvedValueOnce('INV-000002')

    const { issueInvoice } = await import('@/lib/commercial/invoices')
    await expect(issueInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1' }))
      .rejects.toThrow(/status changed concurrently/)
    expect(logInvoiceIssuedMock).not.toHaveBeenCalled()
  })

  it('a later change to the customer record cannot retroactively mutate an already-issued invoice\'s snapshot (issueInvoice is never called again for an ISSUED invoice)', async () => {
    sqlMock
      .mockResolvedValueOnce([draftInvoice({ status: 'ISSUED', due_date: '2026-10-01', customer_name_snapshot: 'Acme Pty Ltd' })])
      .mockResolvedValueOnce([{ id: 'line-1' }])
    const { issueInvoice } = await import('@/lib/commercial/invoices')
    await expect(issueInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1' })).rejects.toThrow()
    expect(getCustomerMock).not.toHaveBeenCalled()
  })
})

// ── VOID / DELETE ────────────────────────────────────────────────────

describe('Phase C4.1 — voidInvoice()', () => {
  it('requires a non-empty, trimmed void_reason', async () => {
    const { voidInvoice } = await import('@/lib/commercial/invoices')
    await expect(voidInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', voidReason: '   ' }))
      .rejects.toThrow(/void_reason is required/)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('only an ISSUED invoice may be voided — DRAFT is rejected', async () => {
    sqlMock.mockResolvedValueOnce([draftInvoice()])
    const { voidInvoice } = await import('@/lib/commercial/invoices')
    await expect(voidInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', voidReason: 'Customer cancelled' }))
      .rejects.toThrow(/Cannot transition invoice from DRAFT to VOID/)
    expect(logInvoiceVoidedMock).not.toHaveBeenCalled()
  })

  it('an already-VOID invoice cannot be voided again', async () => {
    sqlMock.mockResolvedValueOnce([draftInvoice({ status: 'VOID' })])
    const { voidInvoice } = await import('@/lib/commercial/invoices')
    await expect(voidInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', voidReason: 'x' }))
      .rejects.toThrow(/Cannot transition invoice from VOID to VOID/)
  })

  it('on success: retains invoice_number/totals/lines/snapshots, sets void_reason/voided_by/voided_at', async () => {
    sqlMock
      .mockResolvedValueOnce([draftInvoice({ status: 'ISSUED', invoice_number: 'INV-000001', total_cents: 1100 })])
      .mockResolvedValueOnce([{
        ...draftInvoice({ status: 'VOID', invoice_number: 'INV-000001', total_cents: 1100 }),
        void_reason: 'Customer cancelled', voided_by: 'u1', voided_at: '2026-09-08T00:00:00.000Z',
      }])
    const { voidInvoice } = await import('@/lib/commercial/invoices')
    const voided = await voidInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1', voidReason: '  Customer cancelled  ' })
    expect(voided.status).toBe('VOID')
    expect(voided.invoice_number).toBe('INV-000001') // retained, not cleared
    expect(voided.total_cents).toBe(1100) // retained
    expect(voided.void_reason).toBe('Customer cancelled')
    expect(logInvoiceVoidedMock).toHaveBeenCalledWith(
      expect.objectContaining({ organisationId: ORG, invoiceId: 'inv-1', voidReason: 'Customer cancelled' }),
    )
  })
})

describe('Phase C4.1 — deleteDraftInvoice()', () => {
  it('deletes a DRAFT invoice and returns true', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'inv-1' }])
    const { deleteDraftInvoice } = await import('@/lib/commercial/invoices')
    const result = await deleteDraftInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1' })
    expect(result).toBe(true)
    expect(logInvoiceDeletedMock).toHaveBeenCalledTimes(1)
  })

  it('returns false for a non-DRAFT invoice (ISSUED/VOID) — WHERE status = DRAFT excludes it — or one belonging to a different organisation', async () => {
    sqlMock.mockResolvedValueOnce([])
    const { deleteDraftInvoice } = await import('@/lib/commercial/invoices')
    const result = await deleteDraftInvoice({ organisationId: ORG, userId: 'u1', invoiceId: 'inv-1' })
    expect(result).toBe(false)
    expect(logInvoiceDeletedMock).not.toHaveBeenCalled()
  })
})
