import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase 7 §8, hardened pre-push — sendTicketEmail()'s provider-result
// semantics. Mocks lib/email.ts's sendEmail() — the actual network call
// point — so no real email can ever be sent by this file. Distinguishes:
//   Case A (failed):         sendEmail() throws its own 'Email send
//                             failed' Error (a definite non-ok response
//                             from Resend).
//   Case B (sent):            sendEmail() resolves { status: 'sent', id }
//                             — Resend genuinely returned a 2xx.
//   Case C (unknown):        sendEmail() throws anything else (e.g. a
//                             network timeout/connection reset) — an
//                             ambiguous outcome.
//   not_configured:          sendEmail() resolves { status:
//                             'not_configured', id: null } — RESEND_API_KEY
//                             is absent, nothing was sent anywhere. This
//                             MUST NOT be reported as 'sent' — see the
//                             pre-push audit that introduced this case.

const sendEmailMock = vi.fn()
vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email')>()
  return { ...actual, sendEmail: (...args: unknown[]) => sendEmailMock(...args) }
})

const { sendTicketEmail } = await import('@/lib/events/ticketEmail')

const DATA = { eventName: 'Spring Gala', purchaserName: 'Jane Doe', attendees: [{ name: 'Jane Doe', ticketToken: 'a'.repeat(64) }] }

beforeEach(() => {
  sendEmailMock.mockReset()
})

describe('sendTicketEmail — Case B: provider accepts', () => {
  it('returns result "sent" with the provider message id when available', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: 'resend-msg-123' })
    const result = await sendTicketEmail('jane@example.com', DATA)
    expect(result).toEqual({ result: 'sent', providerMessageId: 'resend-msg-123' })
  })

  it('returns result "sent" with a null provider message id when Resend accepted but gave no id', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: null })
    const result = await sendTicketEmail('jane@example.com', DATA)
    expect(result).toEqual({ result: 'sent', providerMessageId: null })
  })

  it('calls the provider with the given recipient and a non-empty subject/html', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: null })
    await sendTicketEmail('jane@example.com', DATA)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const arg = sendEmailMock.mock.calls[0][0] as { to: string; subject: string; html: string }
    expect(arg.to).toBe('jane@example.com')
    expect(arg.subject.length).toBeGreaterThan(0)
    expect(arg.html.length).toBeGreaterThan(0)
  })
})

describe('sendTicketEmail — not_configured: RESEND_API_KEY absent (dev/Preview fallback)', () => {
  it('returns result "not_configured", never "sent", when sendEmail resolves the dev-fallback shape', async () => {
    sendEmailMock.mockResolvedValue({ status: 'not_configured', id: null })
    const result = await sendTicketEmail('jane@example.com', DATA)
    expect(result).toEqual({ result: 'not_configured' })
  })

  it('never fabricates a providerMessageId for a not_configured result', async () => {
    sendEmailMock.mockResolvedValue({ status: 'not_configured', id: null })
    const result = await sendTicketEmail('jane@example.com', DATA)
    expect(result).not.toHaveProperty('providerMessageId')
  })
})

describe('sendTicketEmail — Case A: provider definitely rejects', () => {
  it('returns result "failed" when sendEmail throws its own "Email send failed" error', async () => {
    sendEmailMock.mockRejectedValue(new Error('Email send failed'))
    const result = await sendTicketEmail('jane@example.com', DATA)
    expect(result.result).toBe('failed')
  })
})

describe('sendTicketEmail — Phase 3E.1: idempotency payload mismatch', () => {
  it('returns result "failed" with idempotencyPayloadMismatch: true when sendEmail throws EmailSendError with providerErrorCode "invalid_idempotent_request"', async () => {
    const { EmailSendError } = await import('@/lib/email')
    sendEmailMock.mockRejectedValue(new EmailSendError(409, 'invalid_idempotent_request'))
    const result = await sendTicketEmail('jane@example.com', DATA, { idempotencyKey: 'event-ticket-email-initial:order-1' })
    expect(result.result).toBe('failed')
    expect((result as { idempotencyPayloadMismatch?: true }).idempotencyPayloadMismatch).toBe(true)
  })

  it('a plain "Email send failed" Error classifies as ordinary "failed", with idempotencyPayloadMismatch unset', async () => {
    sendEmailMock.mockRejectedValue(new Error('Email send failed'))
    const result = await sendTicketEmail('jane@example.com', DATA, { idempotencyKey: 'event-ticket-email-initial:order-1' })
    expect(result.result).toBe('failed')
    expect((result as { idempotencyPayloadMismatch?: true }).idempotencyPayloadMismatch).toBeUndefined()
  })

  it('an EmailSendError with a DIFFERENT provider error code still classifies as ordinary "failed", with idempotencyPayloadMismatch unset', async () => {
    const { EmailSendError } = await import('@/lib/email')
    sendEmailMock.mockRejectedValue(new EmailSendError(429, 'rate_limit_exceeded'))
    const result = await sendTicketEmail('jane@example.com', DATA, { idempotencyKey: 'event-ticket-email-initial:order-1' })
    expect(result.result).toBe('failed')
    expect((result as { idempotencyPayloadMismatch?: true }).idempotencyPayloadMismatch).toBeUndefined()
  })

  it('the EXISTING manual resend route\'s own result-narrowing (not_configured/failed/unknown, else success) still compiles and behaves correctly against this widened type', async () => {
    const { EmailSendError } = await import('@/lib/email')
    sendEmailMock.mockRejectedValue(new EmailSendError(409, 'invalid_idempotent_request'))
    const result = await sendTicketEmail('jane@example.com', DATA, { idempotencyKey: 'event-ticket-email-initial:order-1' })
    // Mirrors the resend route's own narrowing shape: this result must
    // be caught by the SAME 'failed' branch that route already checks
    // — never silently fall through as a false "sent".
    expect(result.result === 'not_configured' || result.result === 'failed' || result.result === 'unknown').toBe(true)
    expect(result.result).not.toBe('sent')
  })

  it('passes the idempotencyKey through to sendEmail unchanged', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: null })
    await sendTicketEmail('jane@example.com', DATA, { idempotencyKey: 'event-ticket-email-initial:order-1' })
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'event-ticket-email-initial:order-1' }),
    )
  })

  it('the EXISTING manual-resend call shape (no third argument) sends idempotencyKey as undefined — unaffected', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: null })
    await sendTicketEmail('jane@example.com', DATA)
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: undefined }))
  })
})

describe('sendTicketEmail — Case C: ambiguous/unknown outcome', () => {
  it('returns result "unknown" for a network-level exception', async () => {
    sendEmailMock.mockRejectedValue(new TypeError('fetch failed'))
    const result = await sendTicketEmail('jane@example.com', DATA)
    expect(result.result).toBe('unknown')
  })

  it('returns result "unknown" for a non-Error thrown value', async () => {
    sendEmailMock.mockRejectedValue('connection reset')
    const result = await sendTicketEmail('jane@example.com', DATA)
    expect(result.result).toBe('unknown')
  })
})

describe('sendTicketEmail — no automatic retry', () => {
  it('calls the provider exactly once per invocation, regardless of outcome', async () => {
    sendEmailMock.mockRejectedValue(new TypeError('fetch failed'))
    await sendTicketEmail('jane@example.com', DATA)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })
})
