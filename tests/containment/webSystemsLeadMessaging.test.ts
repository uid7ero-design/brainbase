import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Same generic + LD Tennis env shape used throughout this session's other
// email-config tests, so this route is proven to resolve the generic
// BrainBase branch even when LD Tennis's dedicated config is fully
// configured in the environment.
process.env.LD_TENNIS_ORG_ID = 'ld-tennis-org-id'
process.env.LD_TENNIS_EMAIL_FROM = 'LD Tennis Coaching <hello@ldtennis.com.au>'
process.env.LD_TENNIS_MAIL_TO = 'bookings@ldtennis.com.au'
process.env.EMAIL_FROM = 'Brainbase <noreply@brainbase.app>'
process.env.MAIL_TO = 'hello@hlna.com.au'

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

const getAuthSessionMock = vi.fn()
vi.mock('@/lib/authSession', () => ({
  getAuthSession: (...args: unknown[]) => getAuthSessionMock(...args),
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
  created_by: 'admin-user-1', created_at: '2026-08-22T00:00:00.000Z',
}

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('')
  sqlCalls.push({ text, values })

  if (text.includes('FROM web_service_leads')) {
    return Promise.resolve(leadRow ? [leadRow] : [])
  }
  if (text.includes('INSERT INTO web_lead_messages')) {
    if (insertShouldFail) return Promise.reject(new Error('insert failed'))
    return Promise.resolve([MESSAGE_ROW])
  }
  if (text.includes('FROM web_lead_messages')) {
    return Promise.resolve([MESSAGE_ROW])
  }
  return Promise.resolve([])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const { GET, POST } = await import('@/app/api/web-services/leads/[id]/messages/route')

beforeEach(() => {
  sqlCalls = []
  leadRow = null
  insertShouldFail = false
  sqlMock.mockClear()
  getAuthSessionMock.mockReset()
  sendMock.mockReset().mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null })
  getResendClientMock.mockClear()
})

function postRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/web-services/leads/lead-1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}
function getRequest(): NextRequest {
  return asNextRequest(new Request('http://localhost/api/web-services/leads/lead-1/messages'))
}
function params(id = 'lead-1') {
  return { params: Promise.resolve({ id }) }
}
function callsMatching(pattern: string): SqlCall[] {
  return sqlCalls.filter(c => c.text.includes(pattern))
}

const VALID_LEAD = { id: 'lead-1', full_name: 'Jamie Client', email: 'jamie@example.com' }
const VALID_BODY = { subject: 'Following up', body: 'Hi Jamie, checking in about your Web Systems enquiry.' }

function asSuperAdmin() {
  getAuthSessionMock.mockResolvedValue({ userId: 'admin-user-1', organisationId: 'brainbase-hq-org-id', role: 'super_admin', name: 'Founder', email: 'founder@thebrainbase.com.au' })
}
function asAdmin() {
  getAuthSessionMock.mockResolvedValue({ userId: 'admin-user-2', organisationId: 'brainbase-hq-org-id', role: 'admin', name: 'Admin', email: 'admin@thebrainbase.com.au' })
}
function asViewer() {
  getAuthSessionMock.mockResolvedValue({ userId: 'viewer-user-1', organisationId: 'brainbase-hq-org-id', role: 'viewer', name: 'Viewer', email: 'viewer@thebrainbase.com.au' })
}
function unauthenticated() {
  getAuthSessionMock.mockRejectedValue(new Error('Unauthorized'))
}

// ── AUTH ─────────────────────────────────────────────────────────────────

describe('Auth — GET', () => {
  it('unauthenticated GET is denied (401)', async () => {
    unauthenticated()
    const res = await GET(getRequest(), params())
    expect(res.status).toBe(401)
  })
  it('admin role is denied (403) — super_admin only', async () => {
    asAdmin()
    const res = await GET(getRequest(), params())
    expect(res.status).toBe(403)
  })
  it('viewer role is denied (403)', async () => {
    asViewer()
    const res = await GET(getRequest(), params())
    expect(res.status).toBe(403)
  })
  it('super_admin is allowed', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    const res = await GET(getRequest(), params())
    expect(res.status).toBe(200)
  })
})

describe('Auth — POST', () => {
  it('unauthenticated POST is denied (401)', async () => {
    unauthenticated()
    const res = await POST(postRequest(VALID_BODY), params())
    expect(res.status).toBe(401)
    expect(sendMock).not.toHaveBeenCalled()
  })
  it('admin role is denied (403) — super_admin only', async () => {
    asAdmin()
    const res = await POST(postRequest(VALID_BODY), params())
    expect(res.status).toBe(403)
    expect(sendMock).not.toHaveBeenCalled()
  })
  it('viewer role is denied (403)', async () => {
    asViewer()
    const res = await POST(postRequest(VALID_BODY), params())
    expect(res.status).toBe(403)
    expect(sendMock).not.toHaveBeenCalled()
  })
  it('super_admin is allowed', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    const res = await POST(postRequest(VALID_BODY), params())
    expect(res.status).toBe(201)
  })
})

// ── LEAD SAFETY ──────────────────────────────────────────────────────────

describe('Lead safety', () => {
  it('a nonexistent lead returns 404 on GET, no message query attempted', async () => {
    asSuperAdmin()
    leadRow = null
    const res = await GET(getRequest(), params())
    expect(res.status).toBe(404)
    expect(callsMatching('FROM web_lead_messages')).toHaveLength(0)
  })

  it('a nonexistent lead returns 404 on POST, no email attempted', async () => {
    asSuperAdmin()
    leadRow = null
    const res = await POST(postRequest(VALID_BODY), params())
    expect(res.status).toBe(404)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('recipient is always the canonical web_service_leads.email', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest(VALID_BODY), params())
    const call = sendMock.mock.calls[0][0] as { to: string }
    expect(call.to).toBe('jamie@example.com')
  })

  it('client cannot override the recipient', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest({ ...VALID_BODY, to: 'attacker@evil.com', email: 'attacker@evil.com', recipient: 'attacker@evil.com' }), params())
    const call = sendMock.mock.calls[0][0] as { to: string }
    expect(call.to).toBe('jamie@example.com')
    expect(call.to).not.toBe('attacker@evil.com')
  })

  it('client cannot override the sender/from address', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest({ ...VALID_BODY, from: 'attacker@evil.com', sender: 'attacker@evil.com' }), params())
    const call = sendMock.mock.calls[0][0] as { from: string }
    expect(call.from).toBe('Brainbase <noreply@brainbase.app>')
    expect(call.from).not.toBe('attacker@evil.com')
  })

  it('client cannot override organisation_id — the route never reads it, and resolveEmailConfig(null) is always used', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest({ ...VALID_BODY, organisation_id: 'ld-tennis-org-id', organisationId: 'ld-tennis-org-id' }), params())
    const call = sendMock.mock.calls[0][0] as { from: string; replyTo: string }
    // If organisation_id leaked through to resolveEmailConfig, this would
    // resolve to LD Tennis's config instead — it must not.
    expect(call.from).toBe('Brainbase <noreply@brainbase.app>')
    expect(call.replyTo).toBe('hello@hlna.com.au')
  })

  it('client cannot override lead_id — the inserted row always uses the URL path id', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest({ ...VALID_BODY, lead_id: 'attacker-lead-id' }), params('lead-1'))
    const [call] = callsMatching('INSERT INTO web_lead_messages')
    expect(call.values[0]).toBe('lead-1')
    expect(call.values[0]).not.toBe('attacker-lead-id')
  })

  it('client cannot override direction — always the literal \'outbound\'', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest({ ...VALID_BODY, direction: 'inbound' }), params())
    const [call] = callsMatching('INSERT INTO web_lead_messages')
    expect(call.text).toMatch(/'outbound'/)
    expect(call.values).not.toContain('inbound')
  })

  it('client cannot override created_by — always the authenticated session userId', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest({ ...VALID_BODY, created_by: 'attacker-user-id' }), params())
    const [call] = callsMatching('INSERT INTO web_lead_messages')
    expect(call.values).toContain('admin-user-1')
    expect(call.values).not.toContain('attacker-user-id')
  })
})

// ── EMAIL CONFIG ─────────────────────────────────────────────────────────

describe('Email config', () => {
  it('uses the generic BrainBase sender', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest(VALID_BODY), params())
    const call = sendMock.mock.calls[0][0] as { from: string }
    expect(call.from).toBe('Brainbase <noreply@brainbase.app>')
  })

  it('uses the generic BrainBase reply-to', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest(VALID_BODY), params())
    const call = sendMock.mock.calls[0][0] as { replyTo: string }
    expect(call.replyTo).toBe('hello@hlna.com.au')
  })

  it('LD Tennis sender/config never leaks into this route, even though it is fully configured in this environment', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest(VALID_BODY), params())
    const call = sendMock.mock.calls[0][0] as { from: string; replyTo: string }
    expect(call.from).not.toBe('LD Tennis Coaching <hello@ldtennis.com.au>')
    expect(call.replyTo).not.toBe('bookings@ldtennis.com.au')
  })
})

// ── VALIDATION ───────────────────────────────────────────────────────────

describe('Validation', () => {
  it('rejects an empty subject', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    const res = await POST(postRequest({ subject: '   ', body: 'hello' }), params())
    expect(res.status).toBe(400)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('rejects a subject over 200 characters', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    const res = await POST(postRequest({ subject: 'x'.repeat(201), body: 'hello' }), params())
    expect(res.status).toBe(400)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('accepts a subject of exactly 200 characters', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    const res = await POST(postRequest({ subject: 'x'.repeat(200), body: 'hello' }), params())
    expect(res.status).toBe(201)
  })

  it('rejects an empty body', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    const res = await POST(postRequest({ subject: 'hi', body: '   ' }), params())
    expect(res.status).toBe(400)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('rejects a body over 5000 characters', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    const res = await POST(postRequest({ subject: 'hi', body: 'y'.repeat(5001) }), params())
    expect(res.status).toBe(400)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('accepts a body of exactly 5000 characters', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    const res = await POST(postRequest({ subject: 'hi', body: 'y'.repeat(5000) }), params())
    expect(res.status).toBe(201)
  })
})

// ── SEND / PERSIST ───────────────────────────────────────────────────────

describe('Send/persist contract', () => {
  it('a successful send inserts exactly one row', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest(VALID_BODY), params())
    expect(callsMatching('INSERT INTO web_lead_messages')).toHaveLength(1)
  })

  it('the persisted recipient/from match the actual server-controlled values', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest(VALID_BODY), params())
    const [call] = callsMatching('INSERT INTO web_lead_messages')
    // values order: lead_id, subject, body, from, to, resendMessageId, created_by
    expect(call.values).toContain('jamie@example.com')
    expect(call.values).toContain('Brainbase <noreply@brainbase.app>')
  })

  it('the provider (Resend) message id is persisted', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    sendMock.mockResolvedValue({ data: { id: 'resend-abc-999' }, error: null })
    await POST(postRequest(VALID_BODY), params())
    const [call] = callsMatching('INSERT INTO web_lead_messages')
    expect(call.values).toContain('resend-abc-999')
  })

  it('created_by is the authenticated user', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await POST(postRequest(VALID_BODY), params())
    const [call] = callsMatching('INSERT INTO web_lead_messages')
    expect(call.values).toContain('admin-user-1')
  })

  it('a Resend rejection results in no INSERT and a controlled error', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    sendMock.mockResolvedValue({ data: null, error: { message: 'invalid_from' } })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(postRequest(VALID_BODY), params())

    expect(res.status).toBe(502)
    expect(callsMatching('INSERT INTO web_lead_messages')).toHaveLength(0)
    errorSpy.mockRestore()
  })

  it('a Resend throw results in no INSERT and a controlled error', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    sendMock.mockRejectedValue(new Error('network error'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(postRequest(VALID_BODY), params())

    expect(res.status).toBe(502)
    expect(callsMatching('INSERT INTO web_lead_messages')).toHaveLength(0)
    vi.restoreAllMocks()
  })

  it('a DB INSERT failure after a successful Resend send returns success + warning, never a false failure', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    insertShouldFail = true
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(postRequest(VALID_BODY), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.warning).toBeTruthy()
    expect(json.error).toBeUndefined()
    vi.restoreAllMocks()
  })

  it('no automatic second send is attempted after a DB INSERT failure', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    insertShouldFail = true
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await POST(postRequest(VALID_BODY), params())

    expect(sendMock).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('subject/body never appear in error logs on a Resend failure', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    sendMock.mockResolvedValue({ data: null, error: { message: 'bounced' } })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const secretBody = 'this is the confidential message body content'
    await POST(postRequest({ subject: 'Secret Subject', body: secretBody }), params())

    const leaked = errorSpy.mock.calls.some(args =>
      args.some(a => typeof a === 'string' && (a.includes(secretBody) || a.includes('Secret Subject'))),
    )
    expect(leaked).toBe(false)
    errorSpy.mockRestore()
  })

  it('subject/body never appear in error logs on a DB INSERT failure after a successful send', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    insertShouldFail = true
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const secretBody = 'another confidential message body'
    await POST(postRequest({ subject: 'Subj', body: secretBody }), params())

    const leaked = errorSpy.mock.calls.some(args =>
      args.some(a => typeof a === 'string' && a.includes(secretBody)),
    )
    expect(leaked).toBe(false)
    errorSpy.mockRestore()
  })
})

// ── GET ──────────────────────────────────────────────────────────────────

describe('GET — message history', () => {
  it('returns only the requested lead\'s messages', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await GET(getRequest(), params('lead-1'))
    const [call] = callsMatching('FROM web_lead_messages')
    expect(call.text).toContain('WHERE m.lead_id = ')
    expect(call.values).toContain('lead-1')
  })

  it('orders history oldest-first', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await GET(getRequest(), params())
    const [call] = callsMatching('FROM web_lead_messages')
    expect(call.text).toContain('ORDER BY m.created_at ASC')
  })

  it('joins users to represent sender_name', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    await GET(getRequest(), params())
    const [call] = callsMatching('FROM web_lead_messages')
    expect(call.text).toContain('LEFT JOIN users')
    expect(call.text).toContain('sender_name')
  })

  it('reports inboundCaptured: false', async () => {
    asSuperAdmin()
    leadRow = { ...VALID_LEAD }
    const res = await GET(getRequest(), params())
    const json = await res.json()
    expect(json.inboundCaptured).toBe(false)
  })
})

// ── UI / SCOPE CONTAINMENT ───────────────────────────────────────────────

describe('UI wiring', () => {
  it('LeadMessages is imported and rendered inside the Web Systems drawer', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/admin/web-services/page.tsx'), 'utf-8')
    expect(source).toContain("import LeadMessages from './LeadMessages'")
    expect(source).toContain('<LeadMessages leadId={lead.id} leadEmail={lead.email} />')
  })

  it('all 10 kanban stages remain intact', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/admin/web-services/page.tsx'), 'utf-8')
    const statusMatches = source.match(/status: '(new|discovery|qualified|proposal_sent|proposal_approved|onboarding|in_deployment|active_client|paused|lost)'/g) ?? []
    expect(statusMatches).toHaveLength(10)
  })

  it('existing Founder alert behaviour (rule_key) remains intact', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/web-services/lead/route.ts'), 'utf-8')
    expect(source).toContain('brainbase_web_services_lead')
  })

  it('existing Business Type field and mailto:/tel: contact links remain intact', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/admin/web-services/page.tsx'), 'utf-8')
    expect(source).toContain('Business Type')
    expect(source).toMatch(/href=\{`mailto:\$\{lead\.email\}`\}/)
    expect(source).toMatch(/href=\{`tel:\$\{lead\.phone\}`\}/)
  })
})

describe('Scope boundaries', () => {
  it('the new route never references LD Tennis, client_pipeline, or tennis_lead_messages', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/web-services/leads/[id]/messages/route.ts'), 'utf-8')
    expect(source).not.toContain('process.env.LD_TENNIS_ORG_ID')
    expect(source).not.toMatch(/(FROM|INTO|UPDATE)\s+client_pipeline/)
    expect(source).not.toMatch(/(FROM|INTO|UPDATE)\s+tennis_lead_messages/)
    expect(source).not.toMatch(/(FROM|INTO|UPDATE)\s+tennis_leads/)
  })

  it('the migration script only creates web_lead_messages, never touches client_pipeline or tennis_lead_messages', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/create-web-service-lead-messages.sql'), 'utf-8')
    expect(source).toContain('CREATE TABLE IF NOT EXISTS web_lead_messages')
    expect(source).not.toMatch(/ALTER TABLE client_pipeline/)
    expect(source).not.toMatch(/ALTER TABLE tennis_lead_messages/)
    expect(source).not.toMatch(/CREATE TABLE IF NOT EXISTS client_pipeline/)
    expect(source).not.toMatch(/CREATE TABLE IF NOT EXISTS tennis_lead_messages/)
  })

  it('LD Tennis lead messaging route and page are unaffected', () => {
    const ldTennisRoute = fs.readFileSync(path.resolve(__dirname, '../../app/api/leads/[id]/messages/route.ts'), 'utf-8')
    const ldTennisPage = fs.readFileSync(path.resolve(__dirname, '../../app/dashboard/leads/[id]/page.tsx'), 'utf-8')
    expect(ldTennisRoute).not.toContain('web_service_leads')
    expect(ldTennisRoute).not.toContain('web_lead_messages')
    expect(ldTennisPage).not.toContain('web_service_leads')
  })

  it('app/api/lead/route.ts, app/api/leads/[id]/route.ts, and app/api/tennis/book/route.ts are unaffected', () => {
    const lead = fs.readFileSync(path.resolve(__dirname, '../../app/api/lead/route.ts'), 'utf-8')
    const leadsId = fs.readFileSync(path.resolve(__dirname, '../../app/api/leads/[id]/route.ts'), 'utf-8')
    const book = fs.readFileSync(path.resolve(__dirname, '../../app/api/tennis/book/route.ts'), 'utf-8')
    expect(lead).not.toContain('web_lead_messages')
    expect(leadsId).not.toContain('web_lead_messages')
    expect(book).not.toContain('web_lead_messages')
  })

  it('the Add to Squad conversion route is unaffected', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/leads/[id]/convert/route.ts'), 'utf-8')
    expect(source).not.toContain('web_lead_messages')
    expect(source).not.toContain('web_service_leads')
  })
})
