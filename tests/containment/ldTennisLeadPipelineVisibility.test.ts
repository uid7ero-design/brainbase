import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Same env shape as ldTennisEmailConfig.test.ts, so the email-notification
// tail of this route is proven to still resolve LD Tennis's dedicated
// config, and so a generic (non-LD-Tennis) org id is available to prove no
// client-supplied value can hijack pipeline ownership.
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
let pipelineInsertShouldFail = false

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('')
  sqlCalls.push({ text, values })

  if (text.includes('INSERT INTO tennis_leads')) {
    if (tennisLeadsInsertShouldFail) return Promise.reject(new Error('tennis_leads insert failed'))
    return Promise.resolve([{ id: 'lead-uuid-1' }])
  }
  if (text.includes('INSERT INTO contacts')) {
    return Promise.resolve([])
  }
  if (text.includes('INSERT INTO client_pipeline')) {
    if (pipelineInsertShouldFail) return Promise.reject(new Error('client_pipeline insert failed'))
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
  pipelineInsertShouldFail = false
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

describe('POST /api/lead — canonical tennis_leads write is preserved', () => {
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

  it('still creates a Founder OS alert', async () => {
    await POST(jsonRequest(VALID_BODY))
    expect(alertCreateMock).toHaveBeenCalledTimes(1)
    expect(alertCreateMock.mock.calls[0][0].data.rule_key).toBe('new_tennis_lead')
  })

  it('still sends the email notification via LD Tennis config, and the request succeeds', async () => {
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, message: 'Booking request sent successfully.' })

    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0] as { from: string; to: string }
    expect(call.from).toBe('LD Tennis Coaching <hello@ldtennis.com.au>')
    expect(call.to).toBe('bookings@ldtennis.com.au')
  })
})

describe('POST /api/lead — new client_pipeline visibility row', () => {
  it('creates exactly one client_pipeline row per request (no duplicates)', async () => {
    await POST(jsonRequest(VALID_BODY))
    const calls = callsMatching('INSERT INTO client_pipeline')
    expect(calls).toHaveLength(1)
  })

  it('the pipeline row uses the same server-side LD Tennis organisation id', async () => {
    await POST(jsonRequest(VALID_BODY))
    const [call] = callsMatching('INSERT INTO client_pipeline')
    // organisation_id is the first interpolated value in the insert
    expect(call.values[0]).toBe('ld-tennis-org-id')
  })

  it('type/status/priority are request/new/medium — inserted as fixed SQL literals, not caller-influenced values', async () => {
    await POST(jsonRequest(VALID_BODY))
    const [call] = callsMatching('INSERT INTO client_pipeline')
    // 'request'/'new'/'medium' are literal text in the query, not
    // ${}-interpolated — so they never appear in the captured `values`
    // array; assert on the query text instead. No submitted_by_name column:
    // client_pipeline's production schema has no such column (its only
    // submitter-linking column is submitted_by, a users.id FK) — see
    // app/api/admin/pipeline/route.ts's `u.name AS submitted_by_name` JOIN
    // alias, which is where that name actually comes from when it's a real
    // authenticated user, not raw insertable text.
    expect(call.text).toContain('(organisation_id, type, title, description, status, priority)')
    expect(call.text).not.toContain('submitted_by_name')
    expect(call.text).toMatch(/'request'/)
    expect(call.text).toMatch(/'new'/)
    expect(call.text).toMatch(/'medium'/)
  })

  it('the title identifies it as a website enquiry, including the lead name', async () => {
    await POST(jsonRequest(VALID_BODY))
    const [call] = callsMatching('INSERT INTO client_pipeline')
    // values order (only the ${}-interpolated ones): organisation_id, title, description
    expect(call.values[1]).toBe('Website Enquiry — Jamie Client')
  })

  it('the description represents session type, email, phone, and message', async () => {
    await POST(jsonRequest(VALID_BODY))
    const [call] = callsMatching('INSERT INTO client_pipeline')
    const description = call.values[2] as string
    expect(description).toContain('Private lesson')
    expect(description).toContain('jamie@example.com')
    expect(description).toContain('0400000000')
    expect(description).toContain('Keen to start Saturdays')
  })

  it('omits absent optional fields cleanly rather than inserting empty/undefined placeholders', async () => {
    await POST(jsonRequest({ name: 'Minimal Client', email: 'minimal@example.com' }))
    const [call] = callsMatching('INSERT INTO client_pipeline')
    const description = call.values[2] as string
    expect(description).not.toContain('undefined')
    expect(description).not.toContain('null')
    expect(description).toContain('minimal@example.com')
  })

  it('no client-supplied organisation id can alter pipeline ownership', async () => {
    await POST(jsonRequest({ ...VALID_BODY, organisation_id: 'attacker-org-id', organisationId: 'attacker-org-id' }))
    const [call] = callsMatching('INSERT INTO client_pipeline')
    expect(call.values[0]).toBe('ld-tennis-org-id')
    expect(call.values[0]).not.toBe('attacker-org-id')
  })
})

describe('POST /api/lead — pipeline insert failure handling', () => {
  it('a failed client_pipeline insert does not remove or fail the canonical tennis_leads write, and the request still succeeds', async () => {
    pipelineInsertShouldFail = true
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(jsonRequest(VALID_BODY))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, message: 'Booking request sent successfully.' })

    // tennis_leads insert already happened (and is not retried/rolled back)
    expect(callsMatching('INSERT INTO tennis_leads')).toHaveLength(1)
    // exactly one pipeline attempt was made — the failure isn't retried into a duplicate
    expect(callsMatching('INSERT INTO client_pipeline')).toHaveLength(1)

    const loggedLeadId = errorSpy.mock.calls.some(args =>
      args.some(a => typeof a === 'string' && a.includes('lead-uuid-1')),
    )
    expect(loggedLeadId).toBe(true)

    errorSpy.mockRestore()
  })

  it('email notification still sends even when the pipeline insert fails', async () => {
    pipelineInsertShouldFail = true
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await POST(jsonRequest(VALID_BODY))

    expect(sendMock).toHaveBeenCalledTimes(1)

    vi.restoreAllMocks()
  })

  it('contacts upsert still happens even when the pipeline insert fails', async () => {
    pipelineInsertShouldFail = true
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await POST(jsonRequest(VALID_BODY))

    expect(callsMatching('INSERT INTO contacts')).toHaveLength(1)

    vi.restoreAllMocks()
  })

  it('when the canonical tennis_leads insert itself fails, no pipeline row is attempted (nothing to link it to)', async () => {
    tennisLeadsInsertShouldFail = true
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(jsonRequest(VALID_BODY))

    expect(res.status).toBe(200)
    expect(callsMatching('INSERT INTO client_pipeline')).toHaveLength(0)
    // pre-existing behaviour, unchanged: contacts + email still proceed
    expect(callsMatching('INSERT INTO contacts')).toHaveLength(1)
    expect(sendMock).toHaveBeenCalledTimes(1)

    vi.restoreAllMocks()
  })
})

describe('app/api/lead/route.ts stays scoped to its own tables', () => {
  it('does not touch the bookings or pipeline_messages tables', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/lead/route.ts'),
      'utf-8',
    )
    expect(source).not.toContain('INSERT INTO bookings')
    expect(source).not.toContain('INSERT INTO pipeline_messages')
  })
})

describe('no writer anywhere in the repo re-introduces the non-existent submitted_by_name column', () => {
  const WRITER_FILES = [
    'app/api/lead/route.ts',
    'app/api/tennis/book/route.ts',
  ]
  for (const rel of WRITER_FILES) {
    it(`${rel}'s INSERT INTO client_pipeline column list never includes submitted_by_name`, () => {
      const source = fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf-8')
      // Scoped to the actual column-list parens after "INSERT INTO
      // client_pipeline" — deliberately not a blanket string ban, since
      // explanatory comments in these files legitimately name the column
      // when documenting why it's absent.
      const columnListMatch = source.match(/INSERT INTO client_pipeline\s*\(([^)]*)\)/)
      expect(columnListMatch).not.toBeNull()
      expect(columnListMatch![1]).not.toContain('submitted_by_name')
    })
  }
})
