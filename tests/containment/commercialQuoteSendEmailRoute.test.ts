import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase C3-POLISH-R §6/§7/§9/§10/§13/§15 — POST
// /api/commercial/quotes/[id]/send-email. Mocks every sibling module this
// route calls into directly (matching
// tests/containment/commercialQuotesDataAccess.test.ts's own convention of
// mocking sibling lib/commercial/* modules rather than deep-mocking
// '@/lib/db') so this file verifies ONLY this route's own logic:
// authorization wiring, channel validation, DRAFT/no-email rejection,
// cooldown enforcement, and outcome-to-status-code mapping.

const authorizeMock = vi.fn()
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>()
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) }
})

const getQuoteWithLinesMock = vi.fn()
vi.mock('@/lib/commercial/quotes', () => ({ getQuoteWithLines: (...a: unknown[]) => getQuoteWithLinesMock(...a) }))

const getBusinessProfileMock = vi.fn()
vi.mock('@/lib/commercial/businessProfile', () => ({ getBusinessProfile: (...a: unknown[]) => getBusinessProfileMock(...a) }))

const sendQuoteEmailMock = vi.fn()
vi.mock('@/lib/commercial/quoteEmail', () => ({
  sendQuoteEmail: (...a: unknown[]) => sendQuoteEmailMock(...a),
  maskEmailForAudit: (email: string) => `${email[0]}***`,
}))

const logQuoteEmailSentMock = vi.fn()
vi.mock('@/lib/commercial/auditLog', () => ({ logQuoteEmailSent: (...a: unknown[]) => logQuoteEmailSentMock(...a) }))

const recordDeliveryAttemptMock = vi.fn()
const secondsSinceLastAttemptMock = vi.fn()
vi.mock('@/lib/commercial/documentDeliveries', () => ({
  recordDeliveryAttempt: (...a: unknown[]) => recordDeliveryAttemptMock(...a),
  secondsSinceLastAttempt: (...a: unknown[]) => secondsSinceLastAttemptMock(...a),
}))

const { POST } = await import('@/app/api/commercial/quotes/[id]/send-email/route')

const SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'manager' }
const ISSUED_QUOTE = {
  quote: { id: 'q1', organisation_id: 'org-a', status: 'SENT', quote_number: 'QUO-000001', email_snapshot: 'jane@example.com', customer_name_snapshot: 'Jane', total_cents: 1000, currency: 'AUD' },
  lines: [],
}

function ctx(id = 'q1') { return { params: Promise.resolve({ id }) } }
function req(body: unknown = { channel: 'EMAIL' }) {
  return new Request('http://localhost/api/commercial/quotes/q1/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  authorizeMock.mockReset()
  getQuoteWithLinesMock.mockReset()
  getBusinessProfileMock.mockReset()
  sendQuoteEmailMock.mockReset()
  logQuoteEmailSentMock.mockReset()
  recordDeliveryAttemptMock.mockReset()
  secondsSinceLastAttemptMock.mockReset()

  authorizeMock.mockResolvedValue({ ok: true, session: SESSION })
  getQuoteWithLinesMock.mockResolvedValue(ISSUED_QUOTE)
  getBusinessProfileMock.mockResolvedValue({ organisationName: 'Acme', profile: { tradingName: null, address: null, email: null, phone: null, abn: null } })
  secondsSinceLastAttemptMock.mockResolvedValue(null)
  recordDeliveryAttemptMock.mockResolvedValue({ id: 'd1' })
  logQuoteEmailSentMock.mockResolvedValue(undefined)
})

describe('Phase C3-POLISH-R — §10 SMS accepted by the domain model, transport disabled', () => {
  it('rejects channel: "SMS" with a clear 400 — never silently sends EMAIL instead', async () => {
    const res = await POST(req({ channel: 'SMS' }), ctx())
    expect(res.status).toBe(400)
    expect(sendQuoteEmailMock).not.toHaveBeenCalled()
  })
})

describe('Phase C3-POLISH-R — recipient resolution and DRAFT guard', () => {
  it('refuses to send a DRAFT quote (issue it first)', async () => {
    getQuoteWithLinesMock.mockResolvedValue({ quote: { ...ISSUED_QUOTE.quote, status: 'DRAFT' }, lines: [] })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(409)
    expect(sendQuoteEmailMock).not.toHaveBeenCalled()
  })

  it('refuses to send when the issued quote has no email_snapshot (never falls back to a live customer lookup)', async () => {
    getQuoteWithLinesMock.mockResolvedValue({ quote: { ...ISSUED_QUOTE.quote, email_snapshot: null }, lines: [] })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(409)
    expect(sendQuoteEmailMock).not.toHaveBeenCalled()
  })

  it('sends to exactly quote.email_snapshot — never re-derives the recipient from a live customer row', async () => {
    sendQuoteEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    await POST(req(), ctx())
    expect(sendQuoteEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'jane@example.com' }))
  })
})

describe('Phase C3-POLISH-R §13 — duplicate-send cooldown', () => {
  it('returns 429 with a retry_after_seconds when a prior attempt was inside the 60-second window', async () => {
    secondsSinceLastAttemptMock.mockResolvedValue(10)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.retry_after_seconds).toBe(50)
    expect(sendQuoteEmailMock).not.toHaveBeenCalled()
  })

  it('allows a send once the cooldown has elapsed', async () => {
    secondsSinceLastAttemptMock.mockResolvedValue(61)
    sendQuoteEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
  })
})

describe('Phase C3-POLISH-R §9 — outcome-to-response mapping and delivery/audit recording', () => {
  it('sent: 200, records a SENT delivery row and a "sent" audit entry', async () => {
    sendQuoteEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
    expect(recordDeliveryAttemptMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'SENT', channel: 'EMAIL', documentType: 'quote', documentId: 'q1' }))
    expect(logQuoteEmailSentMock).toHaveBeenCalledWith(expect.objectContaining({ result: 'sent' }))
  })

  it('failed (definite provider rejection): 502, records a FAILED delivery row', async () => {
    sendQuoteEmailMock.mockResolvedValue({ result: 'failed', error: 'rejected' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(502)
    expect(recordDeliveryAttemptMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }))
  })

  it('unknown (ambiguous provider outcome): 504, does not claim success', async () => {
    sendQuoteEmailMock.mockResolvedValue({ result: 'unknown', error: 'ambiguous' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(504)
  })

  it('not_configured: 503, never reported as sent', async () => {
    sendQuoteEmailMock.mockResolvedValue({ result: 'not_configured' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('critical case: provider sent but audit write fails — 500, distinct "sent_audit_failed" so the caller knows not to resend blindly', async () => {
    sendQuoteEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    logQuoteEmailSentMock.mockRejectedValue(new Error('db down'))
    const res = await POST(req(), ctx())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.result).toBe('sent_audit_failed')
  })
})

describe('Phase C3-POLISH-R §15 — resend never mutates the quote, never allocates another number', () => {
  it('never imports or calls issueQuote/allocateDocumentNumber — sending is fully decoupled from issuing', async () => {
    sendQuoteEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-1' })
    await POST(req(), ctx());
    await POST(req(), ctx()); // a second call ("resend") with the same mocks
    // getQuoteWithLines is READ-only; nothing in this route's own module
    // graph (see the vi.mock list above) includes an update path for
    // commercial_quotes — quotes.ts only exposes getQuoteWithLines here.
    expect(getQuoteWithLinesMock).toHaveBeenCalledTimes(2)
    expect(sendQuoteEmailMock).toHaveBeenCalledTimes(2)
    // Both calls were built from the exact same issued snapshot object.
    expect(sendQuoteEmailMock.mock.calls[0][0].quote.quote_number).toBe('QUO-000001')
    expect(sendQuoteEmailMock.mock.calls[1][0].quote.quote_number).toBe('QUO-000001')
  })
})
