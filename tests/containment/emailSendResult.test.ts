import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Pre-push hardening (Phase 7 follow-up) — lib/email.ts's sendEmail()
// had never been unit-tested directly against its own fetch() call;
// every existing test (webServicesLeadEmailConfig.test.ts, this
// feature's own eventsTicketEmailSend.test.ts) mocks sendEmail() itself
// rather than exercising its real fetch-handling logic. This file
// stubs global fetch instead, proving the ACTUAL implementation:
//   A. RESEND_API_KEY missing -> { status: 'not_configured', id: null },
//      no network call at all.
//   B. Resend 2xx -> { status: 'sent', id }.
//   C. Resend non-2xx -> throws Error('Email send failed').
//   D. fetch() itself rejects (network/timeout) -> the rejection
//      propagates unchanged (sendEmail does not catch it).
//   E. Resend 2xx with an unparseable/empty body -> { status: 'sent', id: null }.
//
// No real network call is made anywhere in this file — fetch is fully
// stubbed.

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env = { ...originalEnv }
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...originalEnv }
})

describe('sendEmail — A. RESEND_API_KEY missing', () => {
  it('returns { status: "not_configured", id: null } and makes no network call', async () => {
    delete process.env.RESEND_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { sendEmail } = await import('@/lib/email')

    const result = await sendEmail({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' })

    expect(result).toEqual({ status: 'not_configured', id: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws when the key is missing — this is a normal, expected dev/Preview state', async () => {
    delete process.env.RESEND_API_KEY
    vi.stubGlobal('fetch', vi.fn())
    const { sendEmail } = await import('@/lib/email')
    await expect(sendEmail({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' })).resolves.not.toThrow()
  })
})

describe('sendEmail — B. provider HTTP 2xx accepted', () => {
  it('returns { status: "sent", id } from the parsed response body', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'resend-msg-abc' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { sendEmail } = await import('@/lib/email')

    const result = await sendEmail({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' })

    expect(result).toEqual({ status: 'sent', id: 'resend-msg-abc' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST' }))
  })
})

describe('sendEmail — E. malformed/unexpected provider response', () => {
  it('a 2xx response with an unparseable body still reports "sent", with id: null (not a failure)', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected end of JSON input') },
    })
    vi.stubGlobal('fetch', fetchMock)
    const { sendEmail } = await import('@/lib/email')

    const result = await sendEmail({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' })
    expect(result).toEqual({ status: 'sent', id: null })
  })

  it('a 2xx response whose body has no "id" field reports "sent" with id: null', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const { sendEmail } = await import('@/lib/email')

    const result = await sendEmail({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' })
    expect(result).toEqual({ status: 'sent', id: null })
  })
})

describe('sendEmail — C. provider HTTP non-2xx rejection', () => {
  const nonOkStatuses = [400, 401, 403, 429, 500]

  for (const status of nonOkStatuses) {
    it(`HTTP ${status} throws Error('Email send failed') — never reported as sent`, async () => {
      process.env.RESEND_API_KEY = 'test-key'
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status, text: async () => 'provider error body' })
      vi.stubGlobal('fetch', fetchMock)
      const { sendEmail } = await import('@/lib/email')

      await expect(sendEmail({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' })).rejects.toThrow('Email send failed')
    })
  }

  it('a 4xx/5xx response is never mistaken for "sent" merely because fetch() resolved', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })
    vi.stubGlobal('fetch', fetchMock)
    const { sendEmail } = await import('@/lib/email')

    let threw = false
    try {
      await sendEmail({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})

describe('sendEmail — D. fetch/network exception', () => {
  it('a network-level exception (fetch() itself rejects) propagates unchanged, not swallowed', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)
    const { sendEmail } = await import('@/lib/email')

    await expect(sendEmail({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' })).rejects.toThrow('fetch failed')
  })

  it('an abort/timeout-style exception also propagates unchanged', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    const fetchMock = vi.fn().mockRejectedValue(abortError)
    vi.stubGlobal('fetch', fetchMock)
    const { sendEmail } = await import('@/lib/email')

    await expect(sendEmail({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' })).rejects.toThrow('aborted')
  })
})
