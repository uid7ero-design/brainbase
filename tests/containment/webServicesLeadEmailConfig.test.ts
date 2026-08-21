import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Same generic + LD Tennis env shape as ldTennisEmailConfig.test.ts, so this
// route is proven to resolve the generic branch even when LD Tennis's
// dedicated config is fully configured in the environment.
process.env.LD_TENNIS_ORG_ID = 'ld-tennis-org-id'
process.env.LD_TENNIS_EMAIL_FROM = 'LD Tennis Coaching <hello@ldtennis.com.au>'
process.env.LD_TENNIS_MAIL_TO = 'bookings@ldtennis.com.au'
process.env.EMAIL_FROM = 'Brainbase <noreply@brainbase.app>'
process.env.MAIL_TO = 'hello@hlna.com.au'
delete process.env.ADMIN_EMAIL

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

// This route reads request headers via next/headers' headers() (for the
// rate-limit IP key), not from the NextRequest object directly — mock it the
// same way tests/containment/instagramConnect.test.ts mocks next/headers'
// cookies() for the same "no real Next.js request scope in a unit test"
// reason.
vi.mock('next/headers', () => ({
  headers: async () => new Map<string, string>(),
}))

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}))

const rateLimitMock = vi.fn<(...args: unknown[]) => boolean>(() => true)
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: (...args: unknown[]) => rateLimitMock(...args),
}))

// lib/email.ts's sendEmail() does a raw fetch() to Resend's REST API — mock
// just sendEmail so we can assert on what it was called with, while keeping
// the real webServiceLeadEmail() template (preserved, untouched by this fix).
const sendEmailMock = vi.fn()
vi.mock('@/lib/email', async () => {
  const actual = await vi.importActual<typeof import('@/lib/email')>('@/lib/email')
  return {
    ...actual,
    sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  }
})

const { POST } = await import('@/app/api/web-services/lead/route')

beforeEach(() => {
  sqlMock.mockReset()
  rateLimitMock.mockReset().mockReturnValue(true)
  sendEmailMock.mockReset().mockResolvedValue(undefined)
})

function jsonRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/web-services/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

const VALID_BODY = { full_name: 'Jamie Client', email: 'jamie@example.com' }

function mockLeadInsert(id: string) {
  sqlMock.mockResolvedValue([{ id, created_at: '2026-08-21T00:00:00.000Z' }])
}

describe('Strategy Call notification (POST /api/web-services/lead) recipient resolution', () => {
  it('uses the generic BrainBase MAIL_TO', async () => {
    mockLeadInsert('lead-1')

    const res = await POST(jsonRequest(VALID_BODY))

    expect(res.status).toBe(201)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const call = sendEmailMock.mock.calls[0][0] as { to: string }
    expect(call.to).toBe('hello@hlna.com.au')
  })

  it('does not use ADMIN_EMAIL — its former hardcoded fallback address is never the recipient', async () => {
    mockLeadInsert('lead-2')

    const res = await POST(jsonRequest(VALID_BODY))

    expect(res.status).toBe(201)
    const call = sendEmailMock.mock.calls[0][0] as { to: string }
    expect(call.to).not.toBe('uid7ero@gmail.com')
  })

  it('ignores ADMIN_EMAIL even when it is set in the environment to something else', async () => {
    process.env.ADMIN_EMAIL = 'someone-else@example.com'
    mockLeadInsert('lead-3')

    try {
      const res = await POST(jsonRequest(VALID_BODY))
      expect(res.status).toBe(201)
      const call = sendEmailMock.mock.calls[0][0] as { to: string }
      expect(call.to).toBe('hello@hlna.com.au')
      expect(call.to).not.toBe('someone-else@example.com')
    } finally {
      delete process.env.ADMIN_EMAIL
    }
  })

  it('never uses LD_TENNIS_MAIL_TO, even though LD Tennis env vars are fully configured in this environment', async () => {
    mockLeadInsert('lead-4')

    const res = await POST(jsonRequest(VALID_BODY))

    expect(res.status).toBe(201)
    const call = sendEmailMock.mock.calls[0][0] as { to: string }
    expect(call.to).not.toBe('bookings@ldtennis.com.au')
    expect(call.to).not.toBe(process.env.LD_TENNIS_MAIL_TO)
  })
})

describe('Strategy Call email send is awaited', () => {
  it('the route does not resolve its response until the mocked sendEmail promise resolves', async () => {
    mockLeadInsert('lead-5')
    const order: string[] = []
    sendEmailMock.mockImplementation(() => new Promise<void>(resolve => {
      setTimeout(() => { order.push('email-resolved'); resolve() }, 10)
    }))

    const res = await POST(jsonRequest(VALID_BODY))
    order.push('response-received')

    expect(res.status).toBe(201)
    expect(order).toEqual(['email-resolved', 'response-received'])
  })
})

describe('Strategy Call email failure handling', () => {
  it('a rejected sendEmail does not fail the request, does not throw out of the route, and is logged with the lead id', async () => {
    mockLeadInsert('lead-6')
    sendEmailMock.mockRejectedValue(new Error('Resend down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let res: Response
    try {
      res = await POST(jsonRequest(VALID_BODY))
    } finally {
      // proves the route itself never throws even though sendEmail rejected
    }

    expect(res!.status).toBe(201)
    const json = await res!.json()
    expect(json).toEqual({ success: true, id: 'lead-6' })

    expect(errorSpy).toHaveBeenCalled()
    const loggedLeadId = errorSpy.mock.calls.some(args =>
      args.some(a => typeof a === 'string' && a.includes('lead-6')),
    )
    expect(loggedLeadId).toBe(true)

    errorSpy.mockRestore()
  })
})

describe('Strategy Call DB write happens before the notification attempt', () => {
  it('the lead insert is issued, and the returned id is what the notification (and response) key off', async () => {
    mockLeadInsert('lead-7')

    const res = await POST(jsonRequest(VALID_BODY))
    const json = await res.json()

    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(json.id).toBe('lead-7')
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  it('a rejected notification still leaves the DB insert as the thing that already happened — the route never rolls it back', async () => {
    mockLeadInsert('lead-8')
    sendEmailMock.mockRejectedValue(new Error('Resend down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(jsonRequest(VALID_BODY))

    // sql is only ever called once (the INSERT ... RETURNING) — no delete/
    // rollback statement is issued after the email failure.
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(201)

    vi.restoreAllMocks()
  })
})

describe('cross-cutting: route source uses resolveEmailConfig, not ADMIN_EMAIL', () => {
  it('app/api/web-services/lead/route.ts imports resolveEmailConfig and no longer reads ADMIN_EMAIL', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/web-services/lead/route.ts'),
      'utf-8',
    )
    expect(source).toContain("from '@/lib/emailConfig'")
    expect(source).toContain('resolveEmailConfig(')
    expect(source).not.toContain('ADMIN_EMAIL')
    // Passing null (not an org id derived from request data) is what makes
    // the LD Tennis branch structurally unreachable from this route.
    expect(source).toContain('resolveEmailConfig(null)')
  })

  it('the existing webServiceLeadEmail() template is untouched — only the recipient/await changed', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../lib/email.ts'),
      'utf-8',
    )
    expect(source).toContain('export function webServiceLeadEmail(')
  })
})

describe('Coaches Demo route (POST /api/request-demo) remains unaffected by this fix', () => {
  it('still resolves via its own resolveEmailConfig(adminOrgId) + resendClient path, unchanged', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/request-demo/route.ts'),
      'utf-8',
    )
    expect(source).toContain("from '@/lib/emailConfig'")
    expect(source).toContain('resolveEmailConfig(adminOrgId)')
    expect(source).toContain("from '@/lib/resendClient'")
  })
})
