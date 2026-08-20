import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Stable env configuration for the whole file. resolveEmailConfig() reads
// process.env fresh on every call (see lib/emailConfig.ts), so these never
// need to be toggled between the route-level tests below — which
// organisation each route resolves against (LD Tennis vs. not) is what
// varies per test, not the env vars themselves. The one exception is the
// dedicated "pure resolver" describe block, which snapshots/restores env
// vars locally to test edge cases (missing vars, LD_TENNIS_ORG_ID unset)
// without disturbing this file-wide configuration.
process.env.LD_TENNIS_ORG_ID = 'ld-tennis-org-id'
process.env.LD_TENNIS_EMAIL_FROM = 'LD Tennis Coaching <hello@ldtennis.com.au>'
process.env.LD_TENNIS_MAIL_TO = 'bookings@ldtennis.com.au'
process.env.EMAIL_FROM = 'Brainbase <noreply@brainbase.app>'
process.env.MAIL_TO = 'hello@hlna.com.au'

const BRAINBASE_ORG_ID = 'brainbase-admin-org-id'
const OTHER_ORG_ID = 'some-other-tenant-org-id'

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

const requireRoleMock = vi.fn()
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}))

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
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

const { resolveEmailConfig } = await import('@/lib/emailConfig')
const { POST: leadPOST } = await import('@/app/api/lead/route')
const { POST: requestDemoPOST } = await import('@/app/api/request-demo/route')
const { PATCH: leadsIdPATCH } = await import('@/app/api/leads/[id]/route')
const { POST: pipelineMessagesPOST } = await import('@/app/api/admin/pipeline/[id]/messages/route')

function jsonRequest(url: string, body: unknown): NextRequest {
  return asNextRequest(new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  requireRoleMock.mockReset()
  sqlMock.mockReset()
  alertCreateMock.mockReset().mockResolvedValue({})
  sendMock.mockReset().mockResolvedValue({ data: { id: 'email-1' }, error: null })
  getResendClientMock.mockClear()
})

describe('resolveEmailConfig — pure resolver logic', () => {
  const SNAPSHOT_KEYS = ['LD_TENNIS_ORG_ID', 'LD_TENNIS_EMAIL_FROM', 'LD_TENNIS_MAIL_TO', 'EMAIL_FROM', 'MAIL_TO'] as const
  let snapshot: Record<string, string | undefined>

  beforeEach(() => {
    snapshot = Object.fromEntries(SNAPSHOT_KEYS.map(k => [k, process.env[k]]))
  })
  afterEach(() => {
    for (const k of SNAPSHOT_KEYS) {
      if (snapshot[k] === undefined) delete process.env[k]
      else process.env[k] = snapshot[k]
    }
  })

  it('LD Tennis org id with both LD-Tennis vars configured resolves to them', () => {
    expect(resolveEmailConfig('ld-tennis-org-id')).toEqual({
      from: 'LD Tennis Coaching <hello@ldtennis.com.au>',
      to: 'bookings@ldtennis.com.au',
    })
  })

  it('any other org id — including null/undefined — resolves to the generic config, never the LD Tennis one', () => {
    expect(resolveEmailConfig(OTHER_ORG_ID)).toEqual({ from: 'Brainbase <noreply@brainbase.app>', to: 'hello@hlna.com.au' })
    expect(resolveEmailConfig(null)).toEqual({ from: 'Brainbase <noreply@brainbase.app>', to: 'hello@hlna.com.au' })
    expect(resolveEmailConfig(undefined)).toEqual({ from: 'Brainbase <noreply@brainbase.app>', to: 'hello@hlna.com.au' })
  })

  it('missing LD_TENNIS_EMAIL_FROM/LD_TENNIS_MAIL_TO safely falls back to the generic config, even for the LD Tennis org id', () => {
    delete process.env.LD_TENNIS_EMAIL_FROM
    delete process.env.LD_TENNIS_MAIL_TO
    expect(resolveEmailConfig('ld-tennis-org-id')).toEqual({ from: 'Brainbase <noreply@brainbase.app>', to: 'hello@hlna.com.au' })
  })

  it('if LD_TENNIS_ORG_ID itself is not configured, no organisation id can ever resolve to the LD Tennis config', () => {
    delete process.env.LD_TENNIS_ORG_ID
    expect(resolveEmailConfig('ld-tennis-org-id')).toEqual({ from: 'Brainbase <noreply@brainbase.app>', to: 'hello@hlna.com.au' })
  })

  it('with no env configured at all, falls back to safe hardcoded defaults — never onboarding@resend.dev', () => {
    for (const k of SNAPSHOT_KEYS) delete process.env[k]
    const result = resolveEmailConfig('anything')
    expect(result.from).not.toContain('onboarding@resend.dev')
    expect(result).toEqual({ from: 'Brainbase <noreply@brainbase.app>', to: 'hello@hlna.com.au' })
  })

  it('one organisation can never inherit another organisation\'s dedicated config — the branch is an exact LD_TENNIS_ORG_ID match only', () => {
    // Even though LD Tennis vars ARE configured, a different org id must
    // never see them — proves no partial/fuzzy matching, no leakage.
    const other = resolveEmailConfig(OTHER_ORG_ID)
    expect(other.from).not.toBe(process.env.LD_TENNIS_EMAIL_FROM)
    expect(other.to).not.toBe(process.env.LD_TENNIS_MAIL_TO)
  })
})

describe('LD Tennis homepage enquiry (POST /api/lead) uses LD Tennis sender/recipient', () => {
  it('sends from LD_TENNIS_EMAIL_FROM, to LD_TENNIS_MAIL_TO, replyTo the submitted customer email', async () => {
    sqlMock.mockResolvedValue([])
    const res = await leadPOST(jsonRequest('http://localhost/api/lead', {
      name: 'Jamie Client', email: 'jamie@example.com', phone: '0400000000',
    }))
    expect(res.status).toBe(200)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.from).toBe('LD Tennis Coaching <hello@ldtennis.com.au>')
    expect(call.to).toBe('bookings@ldtennis.com.au')
    expect(call.replyTo).toBe('jamie@example.com')
    expect(call.from).not.toBe('onboarding@resend.dev')
  })
})

describe('BrainBase demo request (POST /api/request-demo) does NOT use LD Tennis sender/recipient', () => {
  it('resolves the generic EMAIL_FROM/MAIL_TO even though LD Tennis vars are configured in this environment', async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join('')
      if (text.includes('SELECT organisation_id FROM users')) return Promise.resolve([{ organisation_id: BRAINBASE_ORG_ID }])
      return Promise.resolve([])
    })

    const res = await requestDemoPOST(jsonRequest('http://localhost/api/request-demo', {
      name: 'Founder Prospect', email: 'prospect@example.com', business_name: 'Acme Co',
    }))
    expect(res.status).toBe(200)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.from).toBe('Brainbase <noreply@brainbase.app>')
    expect(call.to).toBe('hello@hlna.com.au')
    expect(call.replyTo).toBe('prospect@example.com')
    // The critical negative assertions — never LD Tennis's dedicated config.
    expect(call.from).not.toBe('LD Tennis Coaching <hello@ldtennis.com.au>')
    expect(call.to).not.toBe('bookings@ldtennis.com.au')
    expect(call.from).not.toBe('onboarding@resend.dev')
  })
})

describe('LD Tennis customer notification (PATCH /api/leads/[id], notify: true)', () => {
  const params = Promise.resolve({ id: 'lead-1' })

  it('replyTo resolves to the LD Tennis business inbox (LD_TENNIS_MAIL_TO), sender is LD_TENNIS_EMAIL_FROM, recipient is the lead\'s own email', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'ld-tennis-org-id', role: 'manager', name: 'Luke' })
    sqlMock.mockResolvedValue([{ id: 'lead-1', status: 'contacted', name: 'Client', email: 'client@example.com', notes: null, client_token: null }])

    const req = asNextRequest(new Request('http://localhost/api/leads/lead-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'contacted', notify: true }),
    }))
    const res = await leadsIdPATCH(req, { params })
    expect(res.status).toBe(200)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.to).toBe('client@example.com')
    expect(call.from).toBe('LD Tennis Coaching <hello@ldtennis.com.au>')
    expect(call.replyTo).toBe('bookings@ldtennis.com.au')
    expect(call.from).not.toBe('onboarding@resend.dev')
  })

  it('a non-LD-Tennis organisation notifying its own lead gets the generic config, not LD Tennis\'s', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u2', organisationId: OTHER_ORG_ID, role: 'manager', name: 'Someone' })
    sqlMock.mockResolvedValue([{ id: 'lead-2', status: 'contacted', name: 'Other Client', email: 'other@example.com', notes: null, client_token: null }])

    const req = asNextRequest(new Request('http://localhost/api/leads/lead-2', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'contacted', notify: true }),
    }))
    const res = await leadsIdPATCH(req, { params: Promise.resolve({ id: 'lead-2' }) })
    expect(res.status).toBe(200)
    const call = sendMock.mock.calls[0][0]
    expect(call.from).toBe('Brainbase <noreply@brainbase.app>')
    expect(call.replyTo).toBe('hello@hlna.com.au')
    expect(call.from).not.toBe('LD Tennis Coaching <hello@ldtennis.com.au>')
    expect(call.replyTo).not.toBe('bookings@ldtennis.com.au')
  })
})

describe('Founder pipeline reply (POST /api/admin/pipeline/[id]/messages) resolves per the pipeline entry\'s own organisation', () => {
  it('an LD Tennis pipeline entry (e.g. a /tennis/book booking) gets LD Tennis sender/replyTo', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'admin1', organisationId: 'any-caller-org', role: 'super_admin', name: 'Founder' })
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join('')
      if (text.includes('SELECT id, organisation_id, title, founder_note')) {
        return Promise.resolve([{ id: 'pl-1', organisation_id: 'ld-tennis-org-id', title: 'Session booking', founder_note: 'customer@example.com' }])
      }
      if (text.includes('INSERT INTO pipeline_messages')) return Promise.resolve([{ id: 'm1', author_type: 'founder', body: 'Hi', created_at: '2026-08-20' }])
      return Promise.resolve([])
    })

    const res = await pipelineMessagesPOST(jsonRequest('http://localhost/api/admin/pipeline/pl-1/messages', { body: 'See you Sunday!' }), { params: Promise.resolve({ id: 'pl-1' }) })
    expect(res.status).toBe(201)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.to).toBe('customer@example.com')
    expect(call.from).toBe('LD Tennis Coaching <hello@ldtennis.com.au>')
    expect(call.replyTo).toBe('bookings@ldtennis.com.au')
  })

  it('a BrainBase pipeline entry (e.g. a demo request) gets the generic sender/replyTo, not LD Tennis\'s', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'admin1', organisationId: 'any-caller-org', role: 'super_admin', name: 'Founder' })
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join('')
      if (text.includes('SELECT id, organisation_id, title, founder_note')) {
        return Promise.resolve([{ id: 'pl-2', organisation_id: BRAINBASE_ORG_ID, title: 'Demo Request', founder_note: 'prospect@example.com' }])
      }
      if (text.includes('INSERT INTO pipeline_messages')) return Promise.resolve([{ id: 'm2', author_type: 'founder', body: 'Thanks', created_at: '2026-08-20' }])
      return Promise.resolve([])
    })

    const res = await pipelineMessagesPOST(jsonRequest('http://localhost/api/admin/pipeline/pl-2/messages', { body: 'Thanks for reaching out' }), { params: Promise.resolve({ id: 'pl-2' }) })
    expect(res.status).toBe(201)
    const call = sendMock.mock.calls[0][0]
    expect(call.from).toBe('Brainbase <noreply@brainbase.app>')
    expect(call.replyTo).toBe('hello@hlna.com.au')
    expect(call.from).not.toBe('LD Tennis Coaching <hello@ldtennis.com.au>')
  })
})

describe('cross-cutting: no route source hardcodes the onboarding@resend.dev sandbox sender any more', () => {
  const ROUTE_FILES = [
    'app/api/lead/route.ts',
    'app/api/request-demo/route.ts',
    'app/api/leads/[id]/route.ts',
    'app/api/admin/pipeline/[id]/messages/route.ts',
  ]
  for (const rel of ROUTE_FILES) {
    it(`${rel} no longer contains the literal 'onboarding@resend.dev' and imports resolveEmailConfig`, () => {
      const source = fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf-8')
      expect(source).not.toContain('onboarding@resend.dev')
      expect(source).toContain("from '@/lib/emailConfig'")
      expect(source).toContain('resolveEmailConfig(')
    })
  }
})
