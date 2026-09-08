import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C4.3B — behavioural tests for lib/commercial/invoiceEmail.ts,
// mirroring tests/containment/commercialQuoteEmail.test.ts's own
// established convention exactly: mock lib/email.ts's sendEmail() (the
// real network call point) and lib/commercial/invoicePdf.ts's
// buildInvoicePdf() (no real jsPDF/asset-loading work in a unit test of
// the email layer) and node:fs/promises (the brand-mark PNG loader
// never touches a real file here).

const sendEmailMock = vi.fn()
vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email')>()
  return { ...actual, sendEmail: (...args: unknown[]) => sendEmailMock(...args) }
})

const buildInvoicePdfMock = vi.fn()
vi.mock('@/lib/commercial/invoicePdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/invoicePdf')>()
  return { ...actual, buildInvoicePdf: (...args: unknown[]) => buildInvoicePdfMock(...args) }
})

vi.mock('node:fs/promises', () => ({ default: { readFile: vi.fn().mockResolvedValue(Buffer.from('fake-png-bytes')) } }))

const { buildInvoiceEmail, sendInvoiceEmail } = await import('@/lib/commercial/invoiceEmail')

const INVOICE = {
  invoice_number: 'INV-000123', status: 'ISSUED', currency: 'AUD',
  issue_date: '2026-09-01', due_date: '2026-09-15', notes: null, terms: null,
  subtotal_cents: 100000, tax_cents: 10000, total_cents: 110000,
  customer_name_snapshot: 'Jane Doe', billing_address_snapshot: '1 Test St',
  email_snapshot: 'jane@example.com', phone_snapshot: null, tax_identifier_snapshot: null,
  void_reason: null, source_quote_number: null,
}
const LINES = [{ description_snapshot: 'Consulting', sku_snapshot: null, unit_snapshot: null, quantity: 1, unit_price_cents: 100000, tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00', line_total_cents: 110000 }]
const SUPPLIER = { displayName: 'Acme Pty Ltd', address: null, email: 'hello@acme.com', phone: '08 1234 5678', abn: null }

beforeEach(() => {
  sendEmailMock.mockReset()
  buildInvoicePdfMock.mockReset()
  buildInvoicePdfMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
})

describe('Phase C4.3B — buildInvoiceEmail() content', () => {
  it('subject is "Invoice {invoice_number} from {business_name}"', () => {
    const { subject } = buildInvoiceEmail({
      invoiceNumber: 'INV-000123', customerName: 'Jane', totalCents: 110000, currency: 'AUD',
      dueDate: '2026-09-15', businessDisplayName: 'Acme Pty Ltd', businessEmail: null, businessPhone: null,
    })
    expect(subject).toBe('Invoice INV-000123 from Acme Pty Ltd')
  })

  it('body includes a customer greeting, invoice number, total, and due date — no raw ISO date', () => {
    const { html } = buildInvoiceEmail({
      invoiceNumber: 'INV-000123', customerName: 'Jane Doe', totalCents: 110000, currency: 'AUD',
      dueDate: '2026-09-15', businessDisplayName: 'Acme Pty Ltd', businessEmail: 'hello@acme.com', businessPhone: '08 1234 5678',
    })
    expect(html).toContain('Jane Doe')
    expect(html).toContain('INV-000123')
    expect(html).toContain('$1,100.00')
    expect(html).toContain('15 Sep 2026')
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(html).toContain('08 1234 5678')
  })

  it('omits the "Due date" row entirely when there is no due date, rather than printing a placeholder', () => {
    const { html } = buildInvoiceEmail({
      invoiceNumber: 'INV-000123', customerName: 'Jane', totalCents: 110000, currency: 'AUD',
      dueDate: null, businessDisplayName: 'Acme', businessEmail: null, businessPhone: null,
    })
    expect(html).not.toContain('Due date')
  })

  it('uses the shared canonical brand shell — never a reconstructed BRΛINBΛSE wordmark, never a bare Greek lambda', () => {
    const { html } = buildInvoiceEmail({
      invoiceNumber: 'INV-000123', customerName: 'Jane', totalCents: 110000, currency: 'AUD',
      dueDate: null, businessDisplayName: 'Acme', businessEmail: null, businessPhone: null,
    })
    expect(html).not.toMatch(/Λ|&#923;|&Lambda;/)
    expect(html).toContain('/Brand/brainbase-horizontal-color-284.png')
    expect(html).toContain('alt="BrainBase"')
    expect(html).toContain('via BrainBase Commercial')
  })
})

describe('Phase C4.3B — sendInvoiceEmail(): provider outcomes', () => {
  it('sent: returns result "sent" with the provider message id, and attaches the built PDF', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: 'resend-msg-1' })
    const result = await sendInvoiceEmail({ to: 'jane@example.com', invoice: INVOICE, lines: LINES, supplier: SUPPLIER })
    expect(result).toEqual({ result: 'sent', providerMessageId: 'resend-msg-1' })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const arg = sendEmailMock.mock.calls[0][0] as { to: string; attachments?: { filename: string }[] }
    expect(arg.to).toBe('jane@example.com')
    expect(arg.attachments?.[0]?.filename).toBe('INV-000123.pdf')
  })

  it('not_configured: RESEND_API_KEY absent — reported distinctly, never as "sent"', async () => {
    sendEmailMock.mockResolvedValue({ status: 'not_configured', id: null })
    const result = await sendInvoiceEmail({ to: 'jane@example.com', invoice: INVOICE, lines: LINES, supplier: SUPPLIER })
    expect(result).toEqual({ result: 'not_configured' })
  })

  it('failed: sendEmail() throws its definite rejection error', async () => {
    sendEmailMock.mockRejectedValue(new Error('Email send failed'))
    const result = await sendInvoiceEmail({ to: 'jane@example.com', invoice: INVOICE, lines: LINES, supplier: SUPPLIER })
    expect(result).toEqual({ result: 'failed', error: 'The email provider rejected the request.' })
  })

  it('unknown: sendEmail() throws an ambiguous error (e.g. network timeout)', async () => {
    sendEmailMock.mockRejectedValue(new Error('socket hang up'))
    const result = await sendInvoiceEmail({ to: 'jane@example.com', invoice: INVOICE, lines: LINES, supplier: SUPPLIER })
    expect(result.result).toBe('unknown')
  })

  it('refuses to send (fails closed) if the invoice is not ISSUED — defensive guard even though the route never calls this for DRAFT/VOID', async () => {
    const draftResult = await sendInvoiceEmail({ to: 'jane@example.com', invoice: { ...INVOICE, status: 'DRAFT' }, lines: LINES, supplier: SUPPLIER })
    expect(draftResult.result).toBe('failed')
    const voidResult = await sendInvoiceEmail({ to: 'jane@example.com', invoice: { ...INVOICE, status: 'VOID' }, lines: LINES, supplier: SUPPLIER })
    expect(voidResult.result).toBe('failed')
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('a resend uses the invoice object exactly as passed in (its issued snapshot) — never re-derives customer/product fields itself, never mutates status/number/totals', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: null })
    await sendInvoiceEmail({ to: 'jane@example.com', invoice: INVOICE, lines: LINES, supplier: SUPPLIER })
    expect(buildInvoicePdfMock).toHaveBeenCalledWith(expect.objectContaining({ invoice: INVOICE, lines: LINES }))
  })

  it('renders the source quote reference into the attached PDF build call when present', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: null })
    const withQuote = { ...INVOICE, source_quote_number: 'QUO-000042' }
    await sendInvoiceEmail({ to: 'jane@example.com', invoice: withQuote, lines: LINES, supplier: SUPPLIER })
    expect(buildInvoicePdfMock).toHaveBeenCalledWith(expect.objectContaining({ invoice: expect.objectContaining({ source_quote_number: 'QUO-000042' }) }))
  })
})

describe('Phase C4.3B — rendering failures are caught and reported structurally, never thrown, never leak internals', () => {
  it('a PDF-build failure returns {result:"failed"} and never calls the email provider', async () => {
    buildInvoicePdfMock.mockRejectedValue(new Error('jsPDF exploded'))
    const result = await sendInvoiceEmail({ to: 'jane@example.com', invoice: INVOICE, lines: LINES, supplier: SUPPLIER })
    expect(result).toEqual({ result: 'failed', error: 'The invoice document could not be prepared for sending.' })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('never leaks the underlying error message/stack, a file path, or connection details into the returned error string', async () => {
    buildInvoicePdfMock.mockRejectedValue(new Error('/etc/secret/path leaked here, postgresql://user:pass@host/db, plus a raw stack trace'))
    const result = await sendInvoiceEmail({ to: 'jane@example.com', invoice: INVOICE, lines: LINES, supplier: SUPPLIER })
    expect(result.result).toBe('failed')
    const message = (result as { error: string }).error
    expect(message).not.toContain('/etc/secret/path')
    expect(message).not.toContain('postgresql://')
  })

  it('a genuine provider failure is classified distinctly from a rendering failure, and rendering succeeding never masks a real provider outcome', async () => {
    buildInvoicePdfMock.mockResolvedValue(new Uint8Array([1, 2, 3])) // rendering succeeds
    sendEmailMock.mockRejectedValue(new Error('Email send failed')) // provider genuinely rejects
    const result = await sendInvoiceEmail({ to: 'jane@example.com', invoice: INVOICE, lines: LINES, supplier: SUPPLIER })
    expect(result).toEqual({ result: 'failed', error: 'The email provider rejected the request.' })
    expect(sendEmailMock).toHaveBeenCalledTimes(1) // proves rendering succeeded and the provider was actually reached
  })
})
