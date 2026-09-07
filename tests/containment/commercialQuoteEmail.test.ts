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

// Phase C3-FINAL-POLISH — the second half of the branding fix the
// C3-COMMERCIAL-BRAND-RENDERING phase left open: the PDF attachment now
// uses the real canonical Hybrid Orbit lockup image, but the email BODY
// itself still reconstructed "BRΛINBΛSE" as literal HTML text with a
// Unicode Greek lambda, in two places (the shared lib/email.ts
// emailLayout() header, and this file's own footer sentence). Fixed by
// giving Commercial quote email its own small, self-contained layout
// (commercialEmailLayout(), not exported — internal to this file) that
// embeds the same canonical raster asset as a real <img>, rather than
// touching the shared emailLayout() every unrelated email type
// (verification, password reset, lead notification, ticket email)
// still uses unchanged.
const HTML_ENTITY_LAMBDA_PATTERN = /Λ|&#923;|&Lambda;/

describe('Phase C3-FINAL-POLISH — A. no reconstructed BRΛINBΛSE wordmark text', () => {
  it('the email HTML never contains the literal Greek lambda character (or its numeric/named entity form) anywhere', () => {
    const { html } = buildQuoteEmail({
      quoteNumber: 'QUO-000123', customerName: 'Jane Doe', totalCents: 33000, currency: 'AUD',
      expiryDate: '2026-10-07', businessDisplayName: 'Acme Pty Ltd', businessEmail: 'hello@acme.com', businessPhone: '08 1234 5678',
    })
    expect(html).not.toMatch(HTML_ENTITY_LAMBDA_PATTERN)
    expect(html).not.toContain('BRΛINBΛSE')
    expect(html).not.toContain('BRAINBΛSE')
  })
})

describe('Phase C3-FINAL-POLISH — B. canonical brand asset is used', () => {
  it('the header references the canonical rasterized lockup asset, not an invented or deprecated one', () => {
    const { html } = buildQuoteEmail({
      quoteNumber: 'QUO-000123', customerName: 'Jane', totalCents: 33000, currency: 'AUD',
      expiryDate: null, businessDisplayName: 'Acme', businessEmail: null, businessPhone: null,
    })
    expect(html).toContain('/Brand/brainbase-horizontal-color-284.png')
    expect(html).not.toContain('brainbase-logo-dark.svg')
    expect(html).not.toContain('brainbase-logo-light.svg')
    expect(html).not.toContain('brainbase-icon.svg')
  })

  it('uses an absolute same-origin URL (BASE_URL), never a third-party image host', () => {
    const { html } = buildQuoteEmail({
      quoteNumber: 'QUO-000123', customerName: 'Jane', totalCents: 33000, currency: 'AUD',
      expiryDate: null, businessDisplayName: 'Acme', businessEmail: null, businessPhone: null,
    })
    const imgSrcMatch = html.match(/<img[^>]+src="([^"]+)"/)
    expect(imgSrcMatch).not.toBeNull()
    const src = imgSrcMatch![1]
    // Must be same-origin (starts with the configured BASE_URL, which in
    // this test environment resolves to the default http://localhost:3000
    // — never a bare protocol-relative or arbitrary external domain).
    expect(src.startsWith('http://localhost:3000/') || src.startsWith(process.env.NEXT_PUBLIC_APP_URL ?? '')).toBe(true)
    expect(src).not.toMatch(/^https?:\/\/(?!localhost)(?!127\.0\.0\.1)/)
  })

  it('the logo image preserves the canonical asset\'s exact aspect ratio (1600:284)', () => {
    const { html } = buildQuoteEmail({
      quoteNumber: 'QUO-000123', customerName: 'Jane', totalCents: 33000, currency: 'AUD',
      expiryDate: null, businessDisplayName: 'Acme', businessEmail: null, businessPhone: null,
    })
    const widthMatch = html.match(/<img[^>]+width="(\d+)"/)
    const heightMatch = html.match(/<img[^>]+height="(\d+)"/)
    expect(widthMatch).not.toBeNull()
    expect(heightMatch).not.toBeNull()
    const width = Number(widthMatch![1])
    const height = Number(heightMatch![1])
    const expectedHeight = Math.round((width * 284) / 1600)
    expect(height).toBe(expectedHeight)
  })
})

describe('Phase C3-FINAL-POLISH — C. useful alt text', () => {
  it('the logo image has alt="BrainBase"', () => {
    const { html } = buildQuoteEmail({
      quoteNumber: 'QUO-000123', customerName: 'Jane', totalCents: 33000, currency: 'AUD',
      expiryDate: null, businessDisplayName: 'Acme', businessEmail: null, businessPhone: null,
    })
    expect(html).toContain('alt="BrainBase"')
  })
})

describe('Phase C3-FINAL-POLISH — D. ordinary body/footer copy uses plain readable "BrainBase"', () => {
  it('the footer sentence reads "via BrainBase Commercial", not the old reconstructed wordmark', () => {
    const { html } = buildQuoteEmail({
      quoteNumber: 'QUO-000123', customerName: 'Jane', totalCents: 33000, currency: 'AUD',
      expiryDate: null, businessDisplayName: 'Acme', businessEmail: 'hello@acme.com', businessPhone: null,
    })
    expect(html).toContain('via BrainBase Commercial')
  })

  it('the dark surface behind the light-on-dark wordmark is preserved (same header cell background as before)', () => {
    const { html } = buildQuoteEmail({
      quoteNumber: 'QUO-000123', customerName: 'Jane', totalCents: 33000, currency: 'AUD',
      expiryDate: null, businessDisplayName: 'Acme', businessEmail: null, businessPhone: null,
    })
    expect(html).toContain('background:#08090C')
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

// Phase C3-EMAIL-FIX — the bug the controlled production email smoke
// test caught: buildQuotePdf()/buildQuoteEmail() used to run OUTSIDE
// any try/catch in sendQuoteEmail(), so a rendering exception (e.g. the
// real Date-vs-string bug, or any future template bug) propagated
// uncaught out of this function, out of the API route (which has no
// try/catch of its own around `await sendQuoteEmail(...)`), surfacing
// as an unhandled 500 instead of the established structured result.
describe('Phase C3-EMAIL-FIX §4 — J/K/L. rendering failures are caught and reported structurally, never thrown', () => {
  it('J. a PDF-build failure returns {result:"failed"} and never calls the email provider', async () => {
    buildQuotePdfMock.mockRejectedValue(new Error('jsPDF exploded'))
    const result = await sendQuoteEmail({ to: 'jane@example.com', quote: QUOTE, lines: LINES, supplier: SUPPLIER })
    expect(result).toEqual({ result: 'failed', error: 'The quote document could not be prepared for sending.' })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('J. never leaks the underlying error message/stack into the returned error string', async () => {
    buildQuotePdfMock.mockRejectedValue(new Error('/etc/secret/path leaked here, plus a raw stack trace'))
    const result = await sendQuoteEmail({ to: 'jane@example.com', quote: QUOTE, lines: LINES, supplier: SUPPLIER })
    expect(result.result).toBe('failed')
    expect((result as { error: string }).error).not.toContain('/etc/secret/path')
  })

  it('K. an email-template rendering failure (e.g. a non-string field breaking HTML escaping) also returns {result:"failed"}, not a thrown exception', async () => {
    buildQuotePdfMock.mockResolvedValue(new Uint8Array([1, 2, 3])) // PDF build succeeds
    // A malformed snapshot field (wrong type at runtime, despite the
    // TS contract) breaks escHtml()'s .replace() call inside
    // buildQuoteEmail() specifically — isolates the failure to the
    // template step, not the PDF step.
    const badQuote = { ...QUOTE, customer_name_snapshot: 12345 as unknown as string }
    const result = await sendQuoteEmail({ to: 'jane@example.com', quote: badQuote, lines: LINES, supplier: SUPPLIER })
    expect(result.result).toBe('failed')
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('L. a genuine provider failure is still classified distinctly from a rendering failure (both return "failed", but for different reasons, and rendering never masks a real provider outcome)', async () => {
    buildQuotePdfMock.mockResolvedValue(new Uint8Array([1, 2, 3])) // rendering succeeds this time
    sendEmailMock.mockRejectedValue(new Error('Email send failed')) // provider genuinely rejects
    const result = await sendQuoteEmail({ to: 'jane@example.com', quote: QUOTE, lines: LINES, supplier: SUPPLIER })
    expect(result).toEqual({ result: 'failed', error: 'The email provider rejected the request.' })
    expect(sendEmailMock).toHaveBeenCalledTimes(1) // proves rendering succeeded and the provider was actually reached
  })
})

describe('Phase C3-POLISH-R — maskEmailForAudit()', () => {
  it('masks everything before @ except the first character', () => {
    expect(maskEmailForAudit('jane@example.com')).toBe('j***@example.com')
  })
})
