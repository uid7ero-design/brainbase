import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C3-POLISH-R §6/§7/§9 — behavioural tests for
// lib/commercial/quoteEmail.ts. Mocks lib/email.ts's sendEmail() (the
// actual network call point, matching
// tests/containment/eventsTicketEmailSend.test.ts's own established
// convention for this exact class of test) and lib/commercial/quotePdf.ts's
// buildQuotePdf() (so no real jsPDF/asset-loading work happens in a unit
// test of the email layer) and node:fs/promises (the brand-mark PNG
// loader never touches a real file here).

const sendEmailMock = vi.fn()
vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email')>()
  return { ...actual, sendEmail: (...args: unknown[]) => sendEmailMock(...args) }
})

const buildQuotePdfMock = vi.fn()
vi.mock('@/lib/commercial/quotePdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/quotePdf')>()
  return { ...actual, buildQuotePdf: (...args: unknown[]) => buildQuotePdfMock(...args) }
})

vi.mock('node:fs/promises', () => ({ default: { readFile: vi.fn().mockResolvedValue(Buffer.from('fake-png-bytes')) } }))

const { buildQuoteEmail, sendQuoteEmail, maskEmailForAudit } = await import('@/lib/commercial/quoteEmail')

const QUOTE = {
  quote_number: 'QUO-000123', status: 'SENT', currency: 'AUD',
  issue_date: '2026-09-07', expiry_date: '2026-10-07', notes: null, terms: null,
  subtotal_cents: 30000, tax_cents: 3000, total_cents: 33000,
  customer_name_snapshot: 'Jane Doe', billing_address_snapshot: '1 Test St',
  email_snapshot: 'jane@example.com', phone_snapshot: null, tax_identifier_snapshot: null,
}
const LINES = [{ description_snapshot: 'Consulting', sku_snapshot: null, unit_snapshot: null, quantity: 3, unit_price_cents: 10000, tax_code_snapshot: 'GST', tax_rate_snapshot: '10.00', line_total_cents: 33000 }]
const SUPPLIER = { displayName: 'Acme Pty Ltd', address: null, email: 'hello@acme.com', phone: '08 1234 5678', abn: null }

beforeEach(() => {
  sendEmailMock.mockReset()
  buildQuotePdfMock.mockReset()
  buildQuotePdfMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
})

describe('Phase C3-POLISH-R — buildQuoteEmail() content', () => {
  it('subject is "Quote {quote_number} from {business_name}"', () => {
    const { subject } = buildQuoteEmail({
      quoteNumber: 'QUO-000123', customerName: 'Jane', totalCents: 33000, currency: 'AUD',
      expiryDate: '2026-10-07', businessDisplayName: 'Acme Pty Ltd', businessEmail: null, businessPhone: null,
    })
    expect(subject).toBe('Quote QUO-000123 from Acme Pty Ltd')
  })

  it('body includes a customer greeting, quote number, total, and expiry date — no raw ISO date', () => {
    const { html } = buildQuoteEmail({
      quoteNumber: 'QUO-000123', customerName: 'Jane Doe', totalCents: 33000, currency: 'AUD',
      expiryDate: '2026-10-07', businessDisplayName: 'Acme Pty Ltd', businessEmail: 'hello@acme.com', businessPhone: '08 1234 5678',
    })
    expect(html).toContain('Jane Doe')
    expect(html).toContain('QUO-000123')
    expect(html).toContain('$330.00')
    expect(html).toContain('7 Oct 2026')
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(html).toContain('08 1234 5678')
  })

  it('omits the "Valid until" row entirely when there is no expiry date, rather than printing a placeholder', () => {
    const { html } = buildQuoteEmail({
      quoteNumber: 'QUO-000123', customerName: 'Jane', totalCents: 33000, currency: 'AUD',
      expiryDate: null, businessDisplayName: 'Acme', businessEmail: null, businessPhone: null,
    })
    expect(html).not.toContain('Valid until')
  })
})

describe('Phase C3-POLISH-R — sendQuoteEmail(): provider outcomes', () => {
  it('Case B (sent): returns result "sent" with the provider message id, and attaches the built PDF', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: 'resend-msg-1' })
    const result = await sendQuoteEmail({ to: 'jane@example.com', quote: QUOTE, lines: LINES, supplier: SUPPLIER })
    expect(result).toEqual({ result: 'sent', providerMessageId: 'resend-msg-1' })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const arg = sendEmailMock.mock.calls[0][0] as { to: string; attachments?: { filename: string }[] }
    expect(arg.to).toBe('jane@example.com')
    expect(arg.attachments?.[0]?.filename).toBe('QUO-000123.pdf')
  })

  it('not_configured: RESEND_API_KEY absent — reported distinctly, never as "sent"', async () => {
    sendEmailMock.mockResolvedValue({ status: 'not_configured', id: null })
    const result = await sendQuoteEmail({ to: 'jane@example.com', quote: QUOTE, lines: LINES, supplier: SUPPLIER })
    expect(result).toEqual({ result: 'not_configured' })
  })

  it('Case A (failed): sendEmail() throws its definite rejection error', async () => {
    sendEmailMock.mockRejectedValue(new Error('Email send failed'))
    const result = await sendQuoteEmail({ to: 'jane@example.com', quote: QUOTE, lines: LINES, supplier: SUPPLIER })
    expect(result.result).toBe('failed')
  })

  it('Case C (unknown): sendEmail() throws an ambiguous error (e.g. network timeout)', async () => {
    sendEmailMock.mockRejectedValue(new Error('socket hang up'))
    const result = await sendQuoteEmail({ to: 'jane@example.com', quote: QUOTE, lines: LINES, supplier: SUPPLIER })
    expect(result.result).toBe('unknown')
  })

  it('refuses to send (fails closed) if the quote has not been issued (no quote_number) — defensive guard even though the route never calls this for a DRAFT', async () => {
    const result = await sendQuoteEmail({ to: 'jane@example.com', quote: { ...QUOTE, quote_number: null }, lines: LINES, supplier: SUPPLIER })
    expect(result).toEqual({ result: 'failed', error: 'Quote has not been issued yet.' })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('a resend uses the quote object exactly as passed in (its issued snapshot) — never re-derives customer/product fields itself', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: null })
    await sendQuoteEmail({ to: 'jane@example.com', quote: QUOTE, lines: LINES, supplier: SUPPLIER })
    expect(buildQuotePdfMock).toHaveBeenCalledWith(expect.objectContaining({ quote: QUOTE, lines: LINES }))
  })
})

describe('Phase C3-POLISH-R — maskEmailForAudit()', () => {
  it('masks everything before @ except the first character', () => {
    expect(maskEmailForAudit('jane@example.com')).toBe('j***@example.com')
  })
})
