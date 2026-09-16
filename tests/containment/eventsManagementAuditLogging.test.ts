import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

// Events production-readiness audit — Phase 8: event create/edit/
// publish/unpublish and EventSession/EventTicketType management
// previously had NO audit coverage at all (check-in/refund/cancellation
// already did — see lib/events/auditLog.ts). This file proves the new
// coverage lands real rows in audit_logs (the SAME generic table every
// other Events audit entry already uses — ADR-0003), not a parallel
// system. `@/lib/events/auditLog` is deliberately NOT mocked here: the
// real insertAuditLog() runs against the mocked @/lib/db client, and
// tests assert on the actual INSERT INTO audit_logs statement's bound
// values — proving genuine audit rows, not just that a function was
// called (matching this repo's own "do not over-mock away the
// behaviour being tested" convention).

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}
function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: vi.fn().mockResolvedValue({ key: 'events', config: {} }) }
})

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function sessionAs(role: string, organisationId = 'org-a', userId = 'staff-1') { return { userId, organisationId, role } }
function jsonReq(url: string, method: string, body?: unknown) {
  return asNextRequest(new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined }))
}

// Finds every INSERT INTO audit_logs call issued during a test and
// decodes its bound values into a plain object — [1]=id [2]=organisation_id
// [3]=user_id [4]=action [5]=resource_type [6]=resource_id [7]=before_state
// (JSON string or null) [8]=after_state (JSON string or null), matching
// insertAuditLog()'s own fixed column/value order in lib/events/auditLog.ts.
function auditInserts(): { organisationId: unknown; userId: unknown; action: unknown; resourceType: unknown; resourceId: unknown; before: unknown; after: unknown }[] {
  return (sqlMock.mock.calls as unknown as unknown[][])
    .filter(c => (c[0] as TemplateStringsArray).join(' ').includes('INSERT INTO audit_logs'))
    .map(c => ({
      organisationId: c[2], userId: c[3], action: c[4], resourceType: c[5], resourceId: c[6],
      before: c[7] ? JSON.parse(c[7] as string) : null,
      after: c[8] ? JSON.parse(c[8] as string) : null,
    }))
}

const eventsRoute = await import('@/app/api/events/route')
const eventIdRoute = await import('@/app/api/events/[id]/route')
const sessionsRoute = await import('@/app/api/events/[id]/sessions/route')
const sessionIdRoute = await import('@/app/api/events/[id]/sessions/[sessionId]/route')
const ticketTypesRoute = await import('@/app/api/events/[id]/ticket-types/route')
const ticketTypeIdRoute = await import('@/app/api/events/[id]/ticket-types/[ticketTypeId]/route')

const EVENT_CTX = { params: Promise.resolve({ id: 'event-1' }) }
const SESSION_CTX = { params: Promise.resolve({ id: 'event-1', sessionId: 'sess-1' }) }
const TICKET_TYPE_CTX = { params: Promise.resolve({ id: 'event-1', ticketTypeId: 'tt-1' }) }

beforeEach(() => {
  requireSessionMock.mockReset()
  sqlMock.mockClear()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
})

const EVENT_ROW = {
  id: 'event-1', name: 'Spring Formal', slug: 'spring-formal', description: null, venue: 'Hall',
  artwork_url: null, status: 'DRAFT', starts_at: '2026-12-01T10:00:00.000Z', ends_at: '2026-12-01T12:00:00.000Z',
  timezone: 'Australia/Adelaide',
}
const SESSION_ROW = { id: 'sess-1', name: 'Morning session', starts_at: '2026-12-01T09:00:00.000Z', ends_at: '2026-12-01T10:00:00.000Z', capacity: 50 }
const TICKET_TYPE_ROW = { id: 'tt-1', name: 'General Admission', description: null, price_cents: 2500, capacity: 100, active: true, sort_order: 0 }

// ─── 1. Event created ────────────────────────────────────────────────

describe('event.created audit', () => {
  it('a successful event create writes a matching audit_logs row for the correct organisation/resource', async () => {
    queue([EVENT_ROW])
    const res = await eventsRoute.POST(jsonReq('http://localhost/api/events', 'POST', {
      name: 'Spring Formal', slug: 'spring-formal', starts_at: EVENT_ROW.starts_at, ends_at: EVENT_ROW.ends_at, timezone: 'Australia/Adelaide',
    }))
    expect(res.status).toBe(201)
    const inserts = auditInserts()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].action).toBe('event.created')
    expect(inserts[0].resourceType).toBe('event')
    expect(inserts[0].resourceId).toBe('event-1')
    expect(inserts[0].organisationId).toBe('org-a')
    expect(inserts[0].userId).toBe('staff-1')
    expect(inserts[0].before).toBeNull()
    expect(inserts[0].after).toMatchObject({ name: 'Spring Formal', slug: 'spring-formal', status: 'DRAFT' })
  })
})

// ─── 2/3. Event updated / publish / unpublish distinguishable ─────────

describe('event.updated / event.published / event.unpublished audit', () => {
  it('an ordinary field edit (no status change) writes event.updated with only the changed field in before/after', async () => {
    queue([EVENT_ROW], [{ ...EVENT_ROW, name: 'Spring Formal (Updated)' }])
    const res = await eventIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Spring Formal (Updated)' }), EVENT_CTX)
    expect(res.status).toBe(200)
    const inserts = auditInserts()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].action).toBe('event.updated')
    expect(inserts[0].resourceType).toBe('event')
    expect(inserts[0].resourceId).toBe('event-1')
    expect(inserts[0].organisationId).toBe('org-a')
    expect(inserts[0].before).toEqual({ name: 'Spring Formal' })
    expect(inserts[0].after).toEqual({ name: 'Spring Formal (Updated)' })
  })

  it('DRAFT -> PUBLISHED writes event.published, not event.updated', async () => {
    queue([EVENT_ROW], [{ ...EVENT_ROW, status: 'PUBLISHED' }])
    const res = await eventIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'PUBLISHED' }), EVENT_CTX)
    expect(res.status).toBe(200)
    const inserts = auditInserts()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].action).toBe('event.published')
    expect(inserts[0].before).toEqual({ status: 'DRAFT' })
    expect(inserts[0].after).toEqual({ status: 'PUBLISHED' })
  })

  it('PUBLISHED -> DRAFT writes event.unpublished, not event.updated — publish/unpublish are distinguishable actions', async () => {
    const publishedRow = { ...EVENT_ROW, status: 'PUBLISHED' }
    queue([publishedRow], [{ ...publishedRow, status: 'DRAFT' }])
    const res = await eventIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'DRAFT' }), EVENT_CTX)
    expect(res.status).toBe(200)
    const inserts = auditInserts()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].action).toBe('event.unpublished')
    expect(inserts[0].before).toEqual({ status: 'PUBLISHED' })
    expect(inserts[0].after).toEqual({ status: 'DRAFT' })
  })

  it('PUBLISHED -> CANCELLED (a status change that is NOT a publish/unpublish edge) still writes event.updated, correctly carrying the status change', async () => {
    const publishedRow = { ...EVENT_ROW, status: 'PUBLISHED' }
    queue([publishedRow], [{ ...publishedRow, status: 'CANCELLED' }])
    const res = await eventIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'CANCELLED' }), EVENT_CTX)
    expect(res.status).toBe(200)
    const inserts = auditInserts()
    expect(inserts[0].action).toBe('event.updated')
    expect(inserts[0].after).toEqual({ status: 'CANCELLED' })
  })

  it('a PATCH that changes nothing in the safe field list writes no audit row at all (no content-free no-op entries)', async () => {
    queue([EVENT_ROW], [{ ...EVENT_ROW }])
    const res = await eventIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: EVENT_ROW.name }), EVENT_CTX)
    expect(res.status).toBe(200)
    expect(auditInserts()).toHaveLength(0)
  })
})

// ─── 4/5/6. EventSession create/update/delete ──────────────────────────

describe('event_session audit', () => {
  it('session create is audited', async () => {
    queue([{ id: 'event-1' }], [SESSION_ROW])
    const res = await sessionsRoute.POST(jsonReq('http://localhost/x', 'POST', {
      name: SESSION_ROW.name, starts_at: SESSION_ROW.starts_at, ends_at: SESSION_ROW.ends_at, capacity: SESSION_ROW.capacity,
    }), EVENT_CTX)
    expect(res.status).toBe(201)
    const inserts = auditInserts()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].action).toBe('event_session.created')
    expect(inserts[0].resourceType).toBe('event_session')
    expect(inserts[0].resourceId).toBe('sess-1')
    expect(inserts[0].after).toMatchObject({ event_id: 'event-1', name: 'Morning session', capacity: 50 })
  })

  it('session update is audited, with only the changed field captured', async () => {
    queue([SESSION_ROW], [{ ...SESSION_ROW, capacity: 75 }])
    const res = await sessionIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { capacity: 75 }), SESSION_CTX)
    expect(res.status).toBe(200)
    const inserts = auditInserts()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].action).toBe('event_session.updated')
    expect(inserts[0].resourceType).toBe('event_session')
    expect(inserts[0].before).toEqual({ event_id: 'event-1', capacity: 50 })
    expect(inserts[0].after).toEqual({ event_id: 'event-1', capacity: 75 })
  })

  it('session delete is audited, capturing pre-delete state (name/starts_at/ends_at/capacity) from the DELETE...RETURNING itself', async () => {
    queue([SESSION_ROW])
    const res = await sessionIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), SESSION_CTX)
    expect(res.status).toBe(200)
    const inserts = auditInserts()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].action).toBe('event_session.deleted')
    expect(inserts[0].resourceType).toBe('event_session')
    expect(inserts[0].resourceId).toBe('sess-1')
    expect(inserts[0].before).toMatchObject({ event_id: 'event-1', name: 'Morning session', capacity: 50 })
    expect(inserts[0].after).toBeNull()
  })
})

// ─── 7/8/9. EventTicketType create/update/delete ───────────────────────

describe('event_ticket_type audit', () => {
  it('ticket type create is audited', async () => {
    queue([{ id: 'event-1' }], [TICKET_TYPE_ROW])
    const res = await ticketTypesRoute.POST(jsonReq('http://localhost/x', 'POST', {
      name: TICKET_TYPE_ROW.name, price_cents: TICKET_TYPE_ROW.price_cents, capacity: TICKET_TYPE_ROW.capacity,
    }), EVENT_CTX)
    expect(res.status).toBe(201)
    const inserts = auditInserts()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].action).toBe('event_ticket_type.created')
    expect(inserts[0].resourceType).toBe('event_ticket_type')
    expect(inserts[0].resourceId).toBe('tt-1')
    expect(inserts[0].after).toMatchObject({ event_id: 'event-1', name: 'General Admission', price_cents: 2500 })
  })

  it('ticket type update is audited, with only the changed field captured', async () => {
    queue([TICKET_TYPE_ROW], [{ ...TICKET_TYPE_ROW, price_cents: 3000 }])
    const res = await ticketTypeIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { price_cents: 3000 }), TICKET_TYPE_CTX)
    expect(res.status).toBe(200)
    const inserts = auditInserts()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].action).toBe('event_ticket_type.updated')
    expect(inserts[0].before).toEqual({ event_id: 'event-1', price_cents: 2500 })
    expect(inserts[0].after).toEqual({ event_id: 'event-1', price_cents: 3000 })
  })

  it('ticket type delete is audited, capturing pre-delete state from the DELETE...RETURNING itself', async () => {
    queue([TICKET_TYPE_ROW])
    const res = await ticketTypeIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), TICKET_TYPE_CTX)
    expect(res.status).toBe(200)
    const inserts = auditInserts()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].action).toBe('event_ticket_type.deleted')
    expect(inserts[0].resourceType).toBe('event_ticket_type')
    expect(inserts[0].resourceId).toBe('tt-1')
    expect(inserts[0].before).toMatchObject({ event_id: 'event-1', name: 'General Admission', price_cents: 2500 })
    expect(inserts[0].after).toBeNull()
  })
})

// ─── 12/13/14. Tenant + role safety is unweakened by the new audit code ─

describe('audit logging does not weaken existing tenant/role safety', () => {
  it('cross-org PATCH (org A / event owned by org B) still 404s and writes no audit row — audit code never runs when the guard already rejected the request', async () => {
    queue([]) // the ownership SELECT finds nothing
    const res = await eventIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Hijacked' }), EVENT_CTX)
    expect(res.status).toBe(404)
    expect(auditInserts()).toHaveLength(0)
  })

  it('viewer cannot create a ticket type -> 403, no audit row written', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await ticketTypesRoute.POST(jsonReq('http://localhost/x', 'POST', { name: 'GA', price_cents: 0, capacity: 100 }), EVENT_CTX)
    expect(res.status).toBe(403)
    expect(auditInserts()).toHaveLength(0)
  })

  it('ANALYST fails closed on event create (analyst is absent from ROLE_ORDER, so roleGte denies it exactly like any other insufficient role) -> 403, no audit row written', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('analyst'))
    const res = await eventsRoute.POST(jsonReq('http://localhost/api/events', 'POST', {
      name: 'Formal', slug: 'formal', starts_at: EVENT_ROW.starts_at, ends_at: EVENT_ROW.ends_at, timezone: 'Australia/Adelaide',
    }))
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('ANALYST fails closed on session delete -> 403, no audit row written', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('analyst'))
    const res = await sessionIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), SESSION_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('the organisationId every audit row carries is always the authenticated session\'s own — never accepted from request body', async () => {
    queue([EVENT_ROW])
    await eventsRoute.POST(jsonReq('http://localhost/api/events', 'POST', {
      name: 'Formal', slug: 'formal', starts_at: EVENT_ROW.starts_at, ends_at: EVENT_ROW.ends_at, timezone: 'Australia/Adelaide',
      organisation_id: 'org-b', organisationId: 'org-b', // attempted spoof
    }))
    const inserts = auditInserts()
    expect(inserts[0].organisationId).toBe('org-a')
  })
})

// ─── 15. No secret material ever reaches audit_logs ─────────────────────

describe('audit metadata never contains prohibited secret material', () => {
  const source = stripComments(readSource('lib/events/auditLog.ts'))

  it('lib/events/auditLog.ts never references any Stripe/session/cron/provider secret, webhook signature, onboarding URL, or credential', () => {
    expect(source).not.toMatch(/STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|CRON_SECRET|RESEND_API_KEY/)
    expect(source).not.toMatch(/webhook.?signature|stripe-signature/i)
    expect(source).not.toMatch(/onboarding_url|onboardingUrl|account_link|accountLink/i)
    expect(source).not.toMatch(/authorization|Bearer /i)
    expect(source).not.toMatch(/session.?cookie|DATABASE_URL/i)
    expect(source).not.toMatch(/card_number|cvc|payment_method_details/i)
  })

  it('the new Stripe Connect loggers accept only a plain account id string and boolean/status flags as parameters — never a full Stripe object, request, or response', () => {
    const start = source.indexOf('export async function logStripeConnectOnboardingInitiated')
    const end = source.indexOf('\n}', source.indexOf('export async function logStripeConnectStatusRefreshed', start))
    const body = source.slice(start, end)
    expect(body).not.toMatch(/stripe\.|req\.|Request|Response/)
  })

  it('a rejected (unauthenticated) request never reaches the audit code at all', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await eventsRoute.POST(jsonReq('http://localhost/api/events', 'POST', { name: 'Formal' }))
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})
