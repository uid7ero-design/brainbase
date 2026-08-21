import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// tennis_leads (LD Tennis → Leads) is the sole canonical home for a website
// enquiry. A prior change additively mirrored each enquiry into
// client_pipeline (LD Tennis → Requests) so it would surface alongside
// session bookings — Production UX testing found Requests is the wrong
// conceptual destination for sales leads (it's for founder/client request
// threads and communication), so that mirror was removed. This file proves
// tennis_leads/contacts/alert/email are all still intact, and that nothing
// from a website enquiry is written to client_pipeline any more.

process.env.LD_TENNIS_ORG_ID = 'ld-tennis-org-id'
process.env.LD_TENNIS_EMAIL_FROM = 'LD Tennis Coaching <hello@ldtennis.com.au>'
process.env.LD_TENNIS_MAIL_TO = 'bookings@ldtennis.com.au'
process.env.EMAIL_FROM = 'Brainbase <noreply@brainbase.app>'
process.env.MAIL_TO = 'hello@hlna.com.au'

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

const rateLimitMock = vi.fn<(...args: unknown[]) => boolean>(() => true)
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: (...args: unknown[]) => rateLimitMock(...args),
}))

const alertCreateMock = vi.fn().mockResolvedValue({})
vi.mock('@/lib/prisma', () => ({
  prisma: { alert: { create: (...args: unknown[]) => alertCreateMock(...args) } },
}))

const sendMock = vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null })
const getResendClientMock = vi.fn(() => ({ emails: { send: (...args: unknown[]) => sendMock(...args) } }))
vi.mock('@/lib/resendClient', () => ({
  getResendClient: () => getResendClientMock(),
}))

type SqlCall = { text: string; values: unknown[] }
let sqlCalls: SqlCall[] = []
let tennisLeadsInsertShouldFail = false

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('')
  sqlCalls.push({ text, values })

  if (text.includes('INSERT INTO tennis_leads')) {
    if (tennisLeadsInsertShouldFail) return Promise.reject(new Error('tennis_leads insert failed'))
    return Promise.resolve([])
  }
  if (text.includes('INSERT INTO contacts')) {
    return Promise.resolve([])
  }
  return Promise.resolve([])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const { POST } = await import('@/app/api/lead/route')

beforeEach(() => {
  sqlCalls = []
  tennisLeadsInsertShouldFail = false
  sqlMock.mockClear()
  rateLimitMock.mockReset().mockReturnValue(true)
  alertCreateMock.mockReset().mockResolvedValue({})
  sendMock.mockReset().mockResolvedValue({ data: { id: 'email-1' }, error: null })
  getResendClientMock.mockClear()
})

function jsonRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

const VALID_BODY = {
  name: 'Jamie Client', email: 'jamie@example.com', phone: '0400000000',
  sessionType: 'Private lesson', message: 'Keen to start Saturdays',
}

function callsMatching(pattern: string): SqlCall[] {
  return sqlCalls.filter(c => c.text.includes(pattern))
}

describe('POST /api/lead — canonical lead behaviour is fully preserved', () => {
  it('still inserts into tennis_leads with the submitted fields', async () => {
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(200)

    const calls = callsMatching('INSERT INTO tennis_leads')
    expect(calls).toHaveLength(1)
    expect(calls[0].values).toEqual([
      'ld-tennis-org-id', 'Jamie Client', 'jamie@example.com', '0400000000', 'Private lesson', 'Keen to start Saturdays',
    ])
  })

  it('still attempts a contacts upsert', async () => {
    await POST(jsonRequest(VALID_BODY))
    const calls = callsMatching('INSERT INTO contacts')
    expect(calls).toHaveLength(1)
    expect(calls[0].text).toContain('ON CONFLICT (organisation_id, email) DO NOTHING')
  })

  it('still creates (attempts) the existing Founder OS alert, scoped to LD Tennis', async () => {
    await POST(jsonRequest(VALID_BODY))
    expect(alertCreateMock).toHaveBeenCalledTimes(1)
    const data = alertCreateMock.mock.calls[0][0].data
    expect(data.rule_key).toBe('new_tennis_lead')
    expect(data.organisation_id).toBe('ld-tennis-org-id')
  })

  it('an alert-create failure is logged and swallowed — never fails the request', async () => {
    alertCreateMock.mockRejectedValueOnce(new Error('alert create failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, message: 'Booking request sent successfully.' })

    errorSpy.mockRestore()
  })

  it('still sends the LD Tennis email notification, and the request succeeds with its existing response shape', async () => {
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, message: 'Booking request sent successfully.' })

    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0] as { from: string; to: string; replyTo: string }
    expect(call.from).toBe('LD Tennis Coaching <hello@ldtennis.com.au>')
    expect(call.to).toBe('bookings@ldtennis.com.au')
    expect(call.replyTo).toBe('jamie@example.com')
  })

  it('a failed tennis_leads insert is logged and swallowed — contacts, alert, and email still proceed (pre-existing behaviour, unchanged)', async () => {
    tennisLeadsInsertShouldFail = true
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(jsonRequest(VALID_BODY))

    expect(res.status).toBe(200)
    expect(callsMatching('INSERT INTO contacts')).toHaveLength(1)
    expect(alertCreateMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledTimes(1)

    vi.restoreAllMocks()
  })
})

describe('POST /api/lead — no longer touches client_pipeline (Requests)', () => {
  it('issues no client_pipeline INSERT for a normal successful submission', async () => {
    await POST(jsonRequest(VALID_BODY))
    expect(sqlCalls.some(c => c.text.includes('client_pipeline'))).toBe(false)
  })

  it('issues no client_pipeline INSERT even when tennis_leads itself fails', async () => {
    tennisLeadsInsertShouldFail = true
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await POST(jsonRequest(VALID_BODY))
    expect(sqlCalls.some(c => c.text.includes('client_pipeline'))).toBe(false)

    vi.restoreAllMocks()
  })

  it('the only sql statements issued for a successful enquiry are the tennis_leads and contacts inserts — nothing else', async () => {
    await POST(jsonRequest(VALID_BODY))
    const tables = sqlCalls.map(c => {
      const m = c.text.match(/INSERT INTO (\w+)/)
      return m ? m[1] : c.text.slice(0, 30)
    })
    expect(tables).toEqual(['tennis_leads', 'contacts'])
  })
})

describe('Tenant safety — organisation resolution stays server-side', () => {
  it('no client-supplied organisation id can influence the tennis_leads/contacts insert', async () => {
    await POST(jsonRequest({ ...VALID_BODY, organisation_id: 'attacker-org-id', organisationId: 'attacker-org-id' }))
    const [leadCall] = callsMatching('INSERT INTO tennis_leads')
    const [contactCall] = callsMatching('INSERT INTO contacts')
    expect(leadCall.values[0]).toBe('ld-tennis-org-id')
    expect(contactCall.values[0]).toBe('ld-tennis-org-id')
    expect(leadCall.values[0]).not.toBe('attacker-org-id')
  })

  it('the alert is created under the server-side LD Tennis org id, never a client-supplied one', async () => {
    await POST(jsonRequest({ ...VALID_BODY, organisation_id: 'attacker-org-id' }))
    expect(alertCreateMock.mock.calls[0][0].data.organisation_id).toBe('ld-tennis-org-id')
  })
})

describe('app/api/lead/route.ts source no longer inserts into client_pipeline', () => {
  it('the route file contains no client_pipeline INSERT statement', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/lead/route.ts'),
      'utf-8',
    )
    // Scoped to an actual INSERT statement, not a blanket string ban — the
    // route's own explanatory comment legitimately names client_pipeline
    // when documenting why it's no longer written to.
    expect(source).not.toMatch(/INSERT INTO client_pipeline/)
    expect(source).not.toContain('INSERT INTO bookings')
    expect(source).not.toContain('INSERT INTO pipeline_messages')
  })
})

describe('/tennis/book is untouched by this change', () => {
  it('app/api/tennis/book/route.ts still writes client_pipeline, bookings, and pipeline_messages', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/tennis/book/route.ts'),
      'utf-8',
    )
    expect(source).toContain('INSERT INTO client_pipeline (id, organisation_id, type, title, description, status, priority)')
    expect(source).toContain('INSERT INTO bookings (')
    expect(source).toContain('INSERT INTO pipeline_messages')
  })
})
