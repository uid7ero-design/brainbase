import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

const LD_TENNIS_ORG = 'ld-tennis-org-id'
const OTHER_ORG = 'some-other-org-id'

process.env.LD_TENNIS_ORG_ID = LD_TENNIS_ORG
process.env.LD_TENNIS_EMAIL_FROM = 'LD Tennis Coaching <hello@ldtennis.com.au>'
process.env.LD_TENNIS_MAIL_TO = 'bookings@ldtennis.com.au'
process.env.EMAIL_FROM = 'Brainbase <noreply@brainbase.app>'
process.env.MAIL_TO = 'hello@hlna.com.au'

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

const requireRoleMock = vi.fn()
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}))

const sendMock = vi.fn()
const getResendClientMock = vi.fn(() => ({ emails: { send: (...args: unknown[]) => sendMock(...args) } }))
vi.mock('@/lib/resendClient', () => ({
  getResendClient: () => getResendClientMock(),
}))

type SqlCall = { text: string; values: unknown[] }
let sqlCalls: SqlCall[] = []
let leadRow: Record<string, unknown> | null = null
let insertShouldFail = false

const MESSAGE_ROW = {
  id: 'msg-1', direction: 'outbound', subject: 'Subj', body: 'Body',
  from_address: 'from@x.com', to_address: 'to@x.com', resend_message_id: 'resend-1',
  created_by: 'u1', created_at: '2026-08-22T00:00:00.000Z',
}

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('')
  sqlCalls.push({ text, values })

  if (text.includes('FROM tennis_leads')) {
    return Promise.resolve(leadRow ? [leadRow] : [])
  }
  if (text.includes('INSERT INTO tennis_lead_messages')) {
    if (insertShouldFail) return Promise.reject(new Error('insert failed'))
    return Promise.resolve([MESSAGE_ROW])
  }
  if (text.includes('FROM tennis_lead_messages')) {
    return Promise.resolve([MESSAGE_ROW])
  }
  return Promise.resolve([])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const { GET, POST } = await import('@/app/api/leads/[id]/messages/route')

beforeEach(() => {
  sqlCalls = []
  leadRow = null
  insertShouldFail = false
  sqlMock.mockClear()
  requireRoleMock.mockReset()
  sendMock.mockReset().mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null })
  getResendClientMock.mockClear()
})

function postRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/leads/lead-1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}
function getRequest(): NextRequest {
  return asNextRequest(new Request('http://localhost/api/leads/lead-1/messages'))
}
function params(id = 'lead-1') {
  return { params: Promise.resolve({ id }) }
}
function callsMatching(pattern: string): SqlCall[] {
  return sqlCalls.filter(c => c.text.includes(pattern))
}

const VALID_LEAD = { id: 'lead-1', name: 'Jamie Client', email: 'jamie@example.com' }
const VALID_BODY = { subject: 'Update', body: 'Hi Jamie, just checking in about your enquiry.' }

function asLdTennisManager() {
  requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: LD_TENNIS_ORG, role: 'manager', name: 'Luke' })
}

describe('POST /api/leads/[id]/messages — happy path', () => {
  it('an LD Tennis manager can message a lead in their own organisation', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }

    const res = await POST(postRequest(VALID_BODY), params())
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.message.id).toBe('msg-1')

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(callsMatching('INSERT INTO tennis_lead_messages')).toHaveLength(1)
  })
})

describe('POST /api/leads/[id]/messages — tenant safety', () => {
  it('requires authentication', async () => {
    requireRoleMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await POST(postRequest(VALID_BODY), params())
    expect(res.status).toBe(401)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('a lead id that does not belong to the caller\'s organisation returns 404 and never sends an email', async () => {
    asLdTennisManager()
    leadRow = null // org-scoped WHERE clause finds nothing

    const res = await POST(postRequest(VALID_BODY), params('someone-elses-lead'))
    expect(res.status).toBe(404)
    expect(sendMock).not.toHaveBeenCalled()
    expect(callsMatching('INSERT INTO tennis_lead_messages')).toHaveLength(0)
  })

  it('a request-body organisation id is ignored — the lead lookup is always scoped by session.organisationId', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }

    await POST(postRequest({ ...VALID_BODY, organisation_id: 'attacker-org-id', organisationId: 'attacker-org-id' }), params())

    const [leadCall] = callsMatching('FROM tennis_leads')
    expect(leadCall.values).toContain(LD_TENNIS_ORG)
    expect(leadCall.values).not.toContain('attacker-org-id')
  })

  it('a request-body recipient cannot redirect the email — "to" is always the canonical lead email', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }

    await POST(postRequest({ ...VALID_BODY, to: 'attacker@evil.com', email: 'attacker@evil.com', recipient: 'attacker@evil.com' }), params())

    const call = sendMock.mock.calls[0][0] as { to: string }
    expect(call.to).toBe('jamie@example.com')
    expect(call.to).not.toBe('attacker@evil.com')
  })

  it('a request-body sender cannot spoof the From address', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }

    await POST(postRequest({ ...VALID_BODY, from: 'attacker@evil.com', sender: 'attacker@evil.com' }), params())

    const call = sendMock.mock.calls[0][0] as { from: string }
    expect(call.from).toBe('LD Tennis Coaching <hello@ldtennis.com.au>')
    expect(call.from).not.toBe('attacker@evil.com')
  })

  it('uses LD Tennis\'s dedicated email config (From + Reply-To) for an LD Tennis session', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }

    await POST(postRequest(VALID_BODY), params())

    const call = sendMock.mock.calls[0][0] as { from: string; to: string; replyTo: string }
    expect(call.from).toBe('LD Tennis Coaching <hello@ldtennis.com.au>')
    expect(call.replyTo).toBe('bookings@ldtennis.com.au')
  })

  it('does not leak the generic BrainBase email config into an LD Tennis send, and vice versa', async () => {
    // LD Tennis session -> LD Tennis config, never generic
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest(VALID_BODY), params())
    let call = sendMock.mock.calls[0][0] as { from: string; replyTo: string }
    expect(call.from).not.toBe('Brainbase <noreply@brainbase.app>')
    expect(call.replyTo).not.toBe('hello@hlna.com.au')

    // A non-LD-Tennis org session -> generic config, never LD Tennis's
    sendMock.mockClear()
    requireRoleMock.mockResolvedValue({ userId: 'u2', organisationId: OTHER_ORG, role: 'manager', name: 'Someone' })
    leadRow = { ...VALID_LEAD, id: 'lead-2' }
    await POST(postRequest(VALID_BODY), params('lead-2'))
    call = sendMock.mock.calls[0][0] as { from: string; replyTo: string }
    expect(call.from).toBe('Brainbase <noreply@brainbase.app>')
    expect(call.replyTo).toBe('hello@hlna.com.au')
    expect(call.from).not.toBe('LD Tennis Coaching <hello@ldtennis.com.au>')
  })
})

describe('POST /api/leads/[id]/messages — send/history atomicity', () => {
  it('creates exactly one history row per request (no duplicates)', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest(VALID_BODY), params())
    expect(callsMatching('INSERT INTO tennis_lead_messages')).toHaveLength(1)
  })

  it('a failed Resend send does not create a "sent" history record, and is reported as an error', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }
    sendMock.mockResolvedValue({ data: null, error: { message: 'invalid_from' } })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(postRequest(VALID_BODY), params())
    const json = await res.json()

    expect(res.status).toBe(502)
    expect(json.success).toBeUndefined()
    expect(callsMatching('INSERT INTO tennis_lead_messages')).toHaveLength(0)

    errorSpy.mockRestore()
  })

  it('a Resend send that throws is also treated as a failed send — no history row created', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }
    sendMock.mockRejectedValue(new Error('network error'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(postRequest(VALID_BODY), params())
    expect(res.status).toBe(502)
    expect(callsMatching('INSERT INTO tennis_lead_messages')).toHaveLength(0)

    vi.restoreAllMocks()
  })

  it('a DB history-insert failure AFTER a successful Resend send is reported as a warning, never as a failed send', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }
    insertShouldFail = true
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(postRequest(VALID_BODY), params())
    const json = await res.json()

    // 2xx, success:true — the email really did go out; never claim it failed
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.warning).toBeTruthy()
    expect(json.error).toBeUndefined()

    vi.restoreAllMocks()
  })
})

describe('POST /api/leads/[id]/messages — validation', () => {
  it('rejects an empty subject', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }
    const res = await POST(postRequest({ subject: '  ', body: 'hello' }), params())
    expect(res.status).toBe(400)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('rejects an empty body', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }
    const res = await POST(postRequest({ subject: 'hi', body: '' }), params())
    expect(res.status).toBe(400)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('length-limits an oversized subject and body rather than rejecting outright', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest({ subject: 'x'.repeat(500), body: 'y'.repeat(10000) }), params())
    const [call] = callsMatching('INSERT INTO tennis_lead_messages')
    const subjectValue = call.values.find(v => typeof v === 'string' && (v as string).startsWith('x')) as string
    const bodyValue = call.values.find(v => typeof v === 'string' && (v as string).startsWith('y')) as string
    expect(subjectValue.length).toBeLessThanOrEqual(200)
    expect(bodyValue.length).toBeLessThanOrEqual(5000)
  })
})

describe('POST /api/leads/[id]/messages — PII safety', () => {
  it('a Resend failure is logged without the message subject/body content', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }
    sendMock.mockResolvedValue({ data: null, error: { message: 'bounced' } })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const secretBody = 'this is the confidential message body content'
    await POST(postRequest({ subject: 'Secret Subject', body: secretBody }), params())

    const loggedAnyPii = errorSpy.mock.calls.some(args =>
      args.some(a => typeof a === 'string' && (a.includes(secretBody) || a.includes('Secret Subject'))),
    )
    expect(loggedAnyPii).toBe(false)

    errorSpy.mockRestore()
  })

  it('a DB-insert failure after a successful send is logged without the message body content', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }
    insertShouldFail = true
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const secretBody = 'another confidential message body'
    await POST(postRequest({ subject: 'Subj', body: secretBody }), params())

    const loggedAnyPii = errorSpy.mock.calls.some(args =>
      args.some(a => typeof a === 'string' && a.includes(secretBody)),
    )
    expect(loggedAnyPii).toBe(false)

    errorSpy.mockRestore()
  })
})

describe('GET /api/leads/[id]/messages', () => {
  it('requires authentication', async () => {
    requireRoleMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await GET(getRequest(), params())
    expect(res.status).toBe(401)
  })

  it('returns 404 for a lead outside the caller\'s organisation', async () => {
    asLdTennisManager()
    leadRow = null
    const res = await GET(getRequest(), params())
    expect(res.status).toBe(404)
  })

  it('returns the message history and marks inbound capture as not implemented', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }
    const res = await GET(getRequest(), params())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.messages).toHaveLength(1)
    expect(json.messages[0].direction).toBe('outbound')
    expect(json.inboundCaptured).toBe(false)
  })

  it('orders history oldest-first, matching the existing pipeline message-thread convention', async () => {
    asLdTennisManager()
    leadRow = { ...VALID_LEAD }
    await GET(getRequest(), params())
    const [call] = callsMatching('FROM tennis_lead_messages')
    expect(call.text).toContain('ORDER BY m.created_at ASC')
  })
})

describe('Scope boundaries — this feature does not touch what it was told not to', () => {
  it('the new route never queries or writes client_pipeline, bookings, pipeline_messages, or contact_journal', () => {
    // Scoped to actual SQL usage, not a blanket string ban — the route's
    // own comments legitimately name pipeline_messages when explaining the
    // (purely visual) convention its ORDER BY mirrors.
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/leads/[id]/messages/route.ts'), 'utf-8')
    expect(source).not.toMatch(/(FROM|INTO|UPDATE)\s+client_pipeline/)
    expect(source).not.toMatch(/(FROM|INTO|UPDATE)\s+bookings/)
    expect(source).not.toMatch(/(FROM|INTO|UPDATE)\s+pipeline_messages/)
    expect(source).not.toMatch(/(FROM|INTO|UPDATE)\s+contact_journal/)
  })

  it('the migration script creates its own table and never touches client_pipeline/pipeline_messages', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/create-tennis-lead-messages.sql'), 'utf-8')
    expect(source).toContain('CREATE TABLE IF NOT EXISTS tennis_lead_messages')
    expect(source).not.toMatch(/ALTER TABLE client_pipeline/)
    expect(source).not.toMatch(/ALTER TABLE pipeline_messages/)
    expect(source).not.toMatch(/CREATE TABLE IF NOT EXISTS client_pipeline/)
  })

  it('shared email helpers (lib/email.ts, lib/resendClient.ts, lib/emailConfig.ts) are untouched', () => {
    const email = fs.readFileSync(path.resolve(__dirname, '../../lib/email.ts'), 'utf-8')
    const resendClient = fs.readFileSync(path.resolve(__dirname, '../../lib/resendClient.ts'), 'utf-8')
    const emailConfig = fs.readFileSync(path.resolve(__dirname, '../../lib/emailConfig.ts'), 'utf-8')
    expect(email).toContain('export async function sendEmail(')
    expect(resendClient).toContain('export function getResendClient(')
    expect(emailConfig).toContain('export function resolveEmailConfig(')
  })

  it('app/api/lead/route.ts, app/api/tennis/book/route.ts, and the Squad conversion route are unaffected', () => {
    const lead = fs.readFileSync(path.resolve(__dirname, '../../app/api/lead/route.ts'), 'utf-8')
    const book = fs.readFileSync(path.resolve(__dirname, '../../app/api/tennis/book/route.ts'), 'utf-8')
    const convert = fs.readFileSync(path.resolve(__dirname, '../../app/api/leads/[id]/convert/route.ts'), 'utf-8')
    expect(lead).not.toContain('tennis_lead_messages')
    expect(book).not.toContain('tennis_lead_messages')
    expect(convert).not.toContain('tennis_lead_messages')
  })
})
