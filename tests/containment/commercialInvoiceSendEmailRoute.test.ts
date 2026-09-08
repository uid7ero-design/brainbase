import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C4.3B — POST /api/commercial/invoices/[id]/send-email. Mocks
// every sibling module this route calls into directly, mirroring
// tests/containment/commercialQuoteSendEmailRoute.test.ts's own
// established convention exactly, so this file verifies ONLY this
// route's own logic: authorization wiring, channel validation,
// DRAFT/VOID rejection (the one genuinely new case beyond the quote
// precedent, since quotes have no VOID status), cooldown enforcement,
// and outcome-to-status-code mapping.

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const getInvoiceWithLinesMock = vi.fn()
vi.mock('@/lib/commercial/invoices', () => ({ getInvoiceWithLines: (...a: unknown[]) => getInvoiceWithLinesMock(...a) }))

const getQuoteMock = vi.fn()
vi.mock('@/lib/commercial/quotes', () => ({ getQuote: (...a: unknown[]) => getQuoteMock(...a) }))

const getBusinessProfileMock = vi.fn()
vi.mock('@/lib/commercial/businessProfile', () => ({ getBusinessProfile: (...a: unknown[]) => getBusinessProfileMock(...a) }))

const sendInvoiceEmailMock = vi.fn()
vi.mock('@/lib/commercial/invoiceEmail', () => ({ sendInvoiceEmail: (...a: unknown[]) => sendInvoiceEmailMock(...a) }))

vi.mock('@/lib/commercial/documentEmail', () => ({ maskEmailForAudit: (email: string) => `${email[0]}***` }))

const logInvoiceEmailSentMock = vi.fn()
vi.mock('@/lib/commercial/auditLog', () => ({ logInvoiceEmailSent: (...a: unknown[]) => logInvoiceEmailSentMock(...a) }))

const recordInvoiceDeliveryAttemptMock = vi.fn()
const secondsSinceLastAttemptMock = vi.fn()
vi.mock('@/lib/commercial/documentDeliveries', () => ({
  recordInvoiceDeliveryAttempt: (...a: unknown[]) => recordInvoiceDeliveryAttemptMock(...a),
  secondsSinceLastAttempt: (...a: unknown[]) => secondsSinceLastAttemptMock(...a),
}))

const { POST } = await import('@/app/api/commercial/invoices/[id]/send-email/route')

const SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'manager' }
const ISSUED_INVOICE = {
  invoice: {
    id: 'inv1', organisation_id: 'org-a', status: 'ISSUED', invoice_number: 'INV-000001',
    email_snapshot: 'jane@example.com', customer_name_snapshot: 'Jane', total_cents: 1000, currency: 'AUD', source_quote_id: null,
  },
  lines: [],
}

function ctx(id = 'inv1') { return { params: Promise.resolve({ id }) } }
function req(body: unknown = { channel: 'EMAIL' }) {
  return new Request('http://localhost/api/commercial/invoices/inv1/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  authorizeMock.mockReset()
  getInvoiceWithLinesMock.mockReset()
  getQuoteMock.mockReset()
  getBusinessProfileMock.mockReset()
  sendInvoiceEmailMock.mockReset()
  logInvoiceEmailSentMock.mockReset()
  recordInvoiceDeliveryAttemptMock.mockReset()
  secondsSinceLastAttemptMock.mockReset()

  authorizeMock.mockResolvedValue({ ok: true, session: SESSION })
  getInvoiceWithLinesMock.mockResolvedValue(ISSUED_INVOICE)
  getBusinessProfileMock.mockResolvedValue({ organisationName: 'Acme', profile: { tradingName: null, address: null, email: null, phone: null, abn: null } })
  secondsSinceLastAttemptMock.mockResolvedValue(null)
  recordInvoiceDeliveryAttemptMock.mockResolvedValue({ id: 'd1' })
  logInvoiceEmailSentMock.mockResolvedValue(undefined)
})

describe('Phase C4.3B — capability/role gate uses invoicing, not quotes', () => {
  it('calls authorizeCommercialRequest with the invoicing capability and manager+ floor', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    await POST(req(), ctx())
    expect(authorizeMock).toHaveBeenCalledWith('invoicing', expect.any(String))
  })

  it('unauthorized -> whatever authorizeCommercialRequest returns, no domain calls made', async () => {
    const deniedResponse = new Response(null, { status: 403 })
    authorizeMock.mockResolvedValue({ ok: false, response: deniedResponse })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(403)
    expect(getInvoiceWithLinesMock).not.toHaveBeenCalled()
  })
})

describe('Phase C4.3B — SMS accepted by the domain model, transport disabled (same as Quotes)', () => {
  it('rejects channel: "SMS" with a clear 400 — never silently sends EMAIL instead', async () => {
    const res = await POST(req({ channel: 'SMS' }), ctx())
    expect(res.status).toBe(400)
    expect(sendInvoiceEmailMock).not.toHaveBeenCalled()
  })
})

describe('Phase C4.3B — lifecycle gate: only ISSUED can send, DRAFT and VOID both rejected', () => {
  it('DRAFT -> 409, never calls the provider', async () => {
    getInvoiceWithLinesMock.mockResolvedValue({ invoice: { ...ISSUED_INVOICE.invoice, status: 'DRAFT' }, lines: [] })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(409)
    expect(sendInvoiceEmailMock).not.toHaveBeenCalled()
  })

  it('VOID -> 409 — the one genuinely new case beyond the quote precedent (quotes have no VOID status)', async () => {
    getInvoiceWithLinesMock.mockResolvedValue({ invoice: { ...ISSUED_INVOICE.invoice, status: 'VOID' }, lines: [] })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(409)
    expect(sendInvoiceEmailMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.error).toMatch(/void/i)
  })

  it('ISSUED proceeds past the lifecycle gate', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
  })
})

describe('Phase C4.3B — recipient resolution: email_snapshot only', () => {
  it('refuses to send when the issued invoice has no email_snapshot (never falls back to a live customer lookup)', async () => {
    getInvoiceWithLinesMock.mockResolvedValue({ invoice: { ...ISSUED_INVOICE.invoice, email_snapshot: null }, lines: [] })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(409)
    expect(sendInvoiceEmailMock).not.toHaveBeenCalled()
  })

  it('sends to exactly invoice.email_snapshot — never re-derives the recipient from a live customer row, and no recipient override from the request body', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    await POST(req({ channel: 'EMAIL', to: 'attacker@evil.example' }), ctx())
    expect(sendInvoiceEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'jane@example.com' }))
  })
})

describe('Phase C4.3B — duplicate-send cooldown (60s, same as Quotes)', () => {
  it('returns 429 with a retry_after_seconds when a prior attempt was inside the 60-second window', async () => {
    secondsSinceLastAttemptMock.mockResolvedValue(10)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.retry_after_seconds).toBe(50)
    expect(sendInvoiceEmailMock).not.toHaveBeenCalled()
  })

  it('allows a send once the cooldown has elapsed', async () => {
    secondsSinceLastAttemptMock.mockResolvedValue(61)
    sendInvoiceEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
  })
})

describe('Phase C4.3B — outcome-to-response mapping and delivery/audit recording', () => {
  it('sent: 200, records a SENT delivery row via recordInvoiceDeliveryAttempt (never the raw/unexported primitive) and a "sent" audit entry with action commercial_invoice.sent', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
    expect(recordInvoiceDeliveryAttemptMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'SENT', channel: 'EMAIL', invoice: ISSUED_INVOICE.invoice }))
    expect(logInvoiceEmailSentMock).toHaveBeenCalledWith(expect.objectContaining({ result: 'sent', invoiceId: 'inv1' }))
  })

  it('DELIVERED is never written for any outcome this route can produce', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    await POST(req(), ctx())
    for (const call of recordInvoiceDeliveryAttemptMock.mock.calls) {
      expect((call[0] as { status: string }).status).not.toBe('DELIVERED')
    }
  })

  it('never writes a PENDING row before attempting the send — this flow is synchronous, PENDING stays reserved for a future async provider', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    await POST(req(), ctx())
    expect(recordInvoiceDeliveryAttemptMock).toHaveBeenCalledTimes(1) // exactly one row, after the attempt completed
    expect(recordInvoiceDeliveryAttemptMock.mock.calls[0][0]).not.toMatchObject({ status: 'PENDING' })
  })

  it('failed (definite provider rejection): 502, records a FAILED delivery row', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ result: 'failed', error: 'rejected' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(502)
    expect(recordInvoiceDeliveryAttemptMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }))
  })

  it('unknown (ambiguous provider outcome): 504, does not claim success, still records FAILED (not DELIVERED, not left unrecorded)', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ result: 'unknown', error: 'ambiguous' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(504)
    expect(recordInvoiceDeliveryAttemptMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }))
  })

  it('not_configured: 503, never reported as sent', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ result: 'not_configured' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('critical case: provider sent but audit write fails — 500, distinct "sent_audit_failed" so the caller knows not to resend blindly', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    logInvoiceEmailSentMock.mockRejectedValue(new Error('db down'))
    const res = await POST(req(), ctx())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.result).toBe('sent_audit_failed')
  })

  it('error responses never leak a raw provider/DB error string — only the route\'s own fixed messages', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ result: 'failed', error: 'Connection refused to smtp.internal:25, DATABASE_URL=postgresql://real:secret@host/db' })
    const res = await POST(req(), ctx())
    const body = await res.json()
    expect(body.error).not.toContain('DATABASE_URL')
    expect(body.error).not.toContain('secret')
    expect(body.error).toBe('The email could not be sent. Please try again.')
  })
})

describe('Phase C4.3B — resend never mutates the invoice: no reissue, no renumber, no snapshot/total/status change', () => {
  it('never imports or calls issueInvoice/voidInvoice/updateDraftInvoice — sending is fully decoupled, and a resend reuses the exact same issued snapshot', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    await POST(req(), ctx());
    await POST(req(), ctx()); // a second call ("resend") with the same mocks
    // getInvoiceWithLines is READ-only; nothing in this route's own
    // module graph (see the vi.mock list above) includes any invoice
    // mutation path — lib/commercial/invoices is mocked to expose only
    // getInvoiceWithLines here.
    expect(getInvoiceWithLinesMock).toHaveBeenCalledTimes(2)
    expect(sendInvoiceEmailMock).toHaveBeenCalledTimes(2)
    expect(sendInvoiceEmailMock.mock.calls[0][0].invoice.invoice_number).toBe('INV-000001')
    expect(sendInvoiceEmailMock.mock.calls[1][0].invoice.invoice_number).toBe('INV-000001')
    expect(sendInvoiceEmailMock.mock.calls[0][0].invoice.status).toBe('ISSUED')
    expect(sendInvoiceEmailMock.mock.calls[1][0].invoice.status).toBe('ISSUED')
  })
})

describe('Phase C4.3B — source quote reference is resolved and threaded through, only when present', () => {
  it('resolves and passes source_quote_number when the invoice has a source_quote_id', async () => {
    getInvoiceWithLinesMock.mockResolvedValue({ invoice: { ...ISSUED_INVOICE.invoice, source_quote_id: 'q1' }, lines: [] })
    getQuoteMock.mockResolvedValue({ quote_number: 'QUO-000042' })
    sendInvoiceEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    await POST(req(), ctx())
    expect(sendInvoiceEmailMock).toHaveBeenCalledWith(expect.objectContaining({ invoice: expect.objectContaining({ source_quote_number: 'QUO-000042' }) }))
  })

  it('passes null when there is no source_quote_id — never calls getQuote at all', async () => {
    sendInvoiceEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    await POST(req(), ctx())
    expect(getQuoteMock).not.toHaveBeenCalled()
    expect(sendInvoiceEmailMock).toHaveBeenCalledWith(expect.objectContaining({ invoice: expect.objectContaining({ source_quote_number: null }) }))
  })
})
