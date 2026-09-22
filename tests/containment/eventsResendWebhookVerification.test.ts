import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// lib/events/resendWebhook.ts — the pure signature-verification wrapper
// around resend@'s own genuine Svix/HMAC-SHA256 webhooks.verify()
// (confirmed by reading the installed package's compiled source; see
// this file's own header comment). The real `resend` package is mocked
// here so this test controls exactly what verify() does, without a real
// network call or a real secret.

const verifyMock = vi.fn()
class FakeResend {
  webhooks = { verify: (...args: unknown[]) => verifyMock(...args) }
}
vi.mock('resend', () => ({ Resend: FakeResend }))

const webhook = await import('@/lib/events/resendWebhook')

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  verifyMock.mockReset()
  process.env.RESEND_API_KEY = 'test-key'
  process.env.RESEND_WEBHOOK_SECRET = 'whsec_test'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('isResendWebhookConfigured', () => {
  it('true when both RESEND_API_KEY and RESEND_WEBHOOK_SECRET are set', () => {
    expect(webhook.isResendWebhookConfigured()).toBe(true)
  })

  it('false when RESEND_WEBHOOK_SECRET is absent', () => {
    delete process.env.RESEND_WEBHOOK_SECRET
    expect(webhook.isResendWebhookConfigured()).toBe(false)
  })

  it('false when RESEND_API_KEY is absent', () => {
    delete process.env.RESEND_API_KEY
    expect(webhook.isResendWebhookConfigured()).toBe(false)
  })
})

describe('verifyResendWebhookEvent', () => {
  const headers = { id: 'evt-1', timestamp: '1700000000', signature: 'v1,abc' }

  it('returns the verified event on success', () => {
    const fakeEvent = { type: 'email.delivered', created_at: 'now', data: { email_id: 'msg-1' } }
    verifyMock.mockReturnValue(fakeEvent)
    expect(webhook.verifyResendWebhookEvent('{}', headers)).toBe(fakeEvent)
  })

  it('passes payload, headers, and webhookSecret through to the SDK unchanged', () => {
    verifyMock.mockReturnValue({})
    webhook.verifyResendWebhookEvent('raw-body-text', headers)
    expect(verifyMock).toHaveBeenCalledWith({ payload: 'raw-body-text', headers, webhookSecret: 'whsec_test' })
  })

  it('wraps ANY thrown verification error into ResendWebhookSignatureError — fail closed uniformly, matching this repo\'s "fail closed on invalid signature" requirement regardless of the specific SDK-internal error shape', () => {
    verifyMock.mockImplementation(() => { throw new Error('No matching signature found') })
    expect(() => webhook.verifyResendWebhookEvent('{}', headers)).toThrow(webhook.ResendWebhookSignatureError)
  })

  it('never throws the raw SDK error type directly — always re-wrapped', () => {
    class SomeSdkError extends Error {}
    verifyMock.mockImplementation(() => { throw new SomeSdkError('boom') })
    let caught: unknown
    try {
      webhook.verifyResendWebhookEvent('{}', headers)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(webhook.ResendWebhookSignatureError)
    expect(caught).not.toBeInstanceOf(SomeSdkError)
  })
})
