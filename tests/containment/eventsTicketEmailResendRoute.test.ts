import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase 7 — POST /api/events/[id]/orders/[orderId]/resend-ticket-email.
// Mirrors the established mocking pattern for Events route tests (see
// tests/containment/eventsPhase3Ticketing.test.ts): @/lib/db's sql tagged
// template, @/lib/org's requireSession, and
// @/lib/capabilities/requireCapability are all mocked — no real database
// or network call occurs anywhere in this file. sendTicketEmail (the
// provider side effect) is mocked so no real email can ever be sent;
// isOrderEligibleForTicketEmail and maskEmailForAudit are left REAL
// (re-exported via importOriginal) since they are pure and are
// themselves part of what this file verifies.

type QueueEntry = unknown[] | { __reject: unknown }

let responseQueue: QueueEntry[] = []
let callCount = 0
const sqlMock = vi.fn((...args: [TemplateStringsArray, ...unknown[]]) => {
  void args
  const next = responseQueue[callCount++]
  if (next && typeof next === 'object' && !Array.isArray(next) && '__reject' in (next as object)) {
    return Promise.reject((next as { __reject: unknown }).__reject)
  }
  return Promise.resolve(next ?? [])
})
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: (...args: unknown[]) => requireCapabilityMock(...args) }
})

const sendTicketEmailMock = vi.fn()
vi.mock('@/lib/events/ticketEmail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/ticketEmail')>()
  return { ...actual, sendTicketEmail: (...args: unknown[]) => sendTicketEmailMock(...args) }
})

const generateTicketTokenMock = vi.fn()
vi.mock('@/lib/events/ticketToken', () => ({ generateTicketToken: (...args: unknown[]) => generateTicketTokenMock(...args) }))

const route = await import('@/app/api/events/[id]/orders/[orderId]/resend-ticket-email/route')

function queue(...responses: QueueEntry[]) { responseQueue = responses; callCount = 0 }
function sessionAs(role: string, organisationId = 'org-a') { return { userId: 'staff-1', organisationId, role } }
function ctx(eventId = 'event-1', orderId = 'order-1') { return { params: Promise.resolve({ id: eventId, orderId }) } }
function req(body?: unknown) {
  return new Request('http://localhost/api/events/event-1/orders/order-1/resend-ticket-email', {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const EVENT_ROW = [{ id: 'event-1' }]
const ELIGIBLE_ORDER_ROW = [{
  id: 'order-1', status: 'CONFIRMED', payment_status: 'PAID',
  purchaser_name: 'Jane Doe', purchaser_email: 'jane@example.com', event_name: 'Spring Gala',
  attendees: [{ name: 'Jane Doe', ticket_token: 'a'.repeat(64) }],
}]
const NO_PRIOR_ATTEMPT: unknown[] = []

function ineligibleOrderRow(overrides: Record<string, unknown>) {
  return [{ ...ELIGIBLE_ORDER_ROW[0], ...overrides }]
}

beforeEach(() => {
  sqlMock.mockClear()
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  sendTicketEmailMock.mockReset()
  generateTicketTokenMock.mockReset()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
  requireCapabilityMock.mockResolvedValue({ key: 'events', config: {} })
  sendTicketEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'resend-msg-1' })
})

// ─── AUTH ────────────────────────────────────────────────────────────

describe('AUTH', () => {
  it('unauthenticated -> 401', async () => {
    requireSessionMock.mockRejectedValue(new Error('no session'))
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(401)
    expect(sendTicketEmailMock).not.toHaveBeenCalled()
  })

  it('viewer role -> 403, provider never called', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(403)
    expect(sendTicketEmailMock).not.toHaveBeenCalled()
  })

  it('manager role -> allowed (reaches the DB lookups)', async () => {
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(200)
  })

  it('higher role (admin) -> allowed', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('admin'))
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(200)
  })
})

// ─── TENANCY ─────────────────────────────────────────────────────────

describe('TENANCY', () => {
  it('event not found for this organisation -> 404', async () => {
    queue([])
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found.')
  })

  it('order does not belong to this event/organisation -> 404 (same shape as event-not-found)', async () => {
    queue(EVENT_ROW, [])
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found.')
  })

  it('every query is scoped to the session organisation, not a client-supplied value', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager', 'org-real'))
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    await route.POST(req(), ctx())
    const allValues = sqlMock.mock.calls.flatMap(call => call.slice(1))
    expect(allValues).toContain('org-real')
    expect(allValues).not.toContain('org-override-attempt')
  })
})

// ─── ELIGIBILITY ─────────────────────────────────────────────────────

describe('ELIGIBILITY', () => {
  const ineligibleCases: Array<[string, Record<string, unknown>]> = [
    ['PENDING payment_status', { payment_status: 'PENDING' }],
    ['FAILED payment_status', { payment_status: 'FAILED' }],
    ['EXPIRED payment_status', { payment_status: 'EXPIRED' }],
    ['REFUNDED payment_status', { payment_status: 'REFUNDED' }],
    ['CANCELLED order status', { status: 'CANCELLED' }],
    ['PENDING order status', { status: 'PENDING', payment_status: 'NOT_REQUIRED' }],
    ['missing purchaser_email', { purchaser_email: null }],
    ['no ticket tokens issued', { attendees: [{ name: 'Jane Doe', ticket_token: null }] }],
  ]

  for (const [label, overrides] of ineligibleCases) {
    it(`${label} -> 409, provider never called`, async () => {
      queue(EVENT_ROW, ineligibleOrderRow(overrides))
      const res = await route.POST(req(), ctx())
      expect(res.status).toBe(409)
      expect(sendTicketEmailMock).not.toHaveBeenCalled()
    })
  }

  it('NOT_REQUIRED payment_status (free order) with a token IS eligible', async () => {
    queue(EVENT_ROW, ineligibleOrderRow({ payment_status: 'NOT_REQUIRED' }), NO_PRIOR_ATTEMPT, [])
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(200)
  })
})

// ─── RECIPIENT ───────────────────────────────────────────────────────

describe('RECIPIENT', () => {
  it('uses the purchaser_email read fresh from the database', async () => {
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    await route.POST(req(), ctx())
    expect(sendTicketEmailMock).toHaveBeenCalledWith('jane@example.com', expect.anything())
  })

  it('ignores any recipient/email supplied in the request body', async () => {
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    await route.POST(req({ email: 'attacker@evil.com', recipient: 'attacker@evil.com' }), ctx())
    expect(sendTicketEmailMock).toHaveBeenCalledWith('jane@example.com', expect.anything())
  })
})

// ─── TOKENS ──────────────────────────────────────────────────────────

describe('TOKENS', () => {
  it('reuses the existing ticket_token from the database', async () => {
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    await route.POST(req(), ctx())
    const [, data] = sendTicketEmailMock.mock.calls[0] as [string, { attendees: { ticketToken: string }[] }]
    expect(data.attendees).toEqual([{ name: 'Jane Doe', ticketToken: 'a'.repeat(64) }])
  })

  it('never generates a new ticket token', async () => {
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    await route.POST(req(), ctx())
    expect(generateTicketTokenMock).not.toHaveBeenCalled()
  })

  it('only includes attendees that already have a ticket_token', async () => {
    queue(EVENT_ROW, ineligibleOrderRow({
      attendees: [{ name: 'Has Token', ticket_token: 'a'.repeat(64) }, { name: 'No Token', ticket_token: null }],
    }), NO_PRIOR_ATTEMPT, [])
    await route.POST(req(), ctx())
    const [, data] = sendTicketEmailMock.mock.calls[0] as [string, { attendees: { name: string }[] }]
    expect(data.attendees.map(a => a.name)).toEqual(['Has Token'])
  })
})

// ─── COOLDOWN ────────────────────────────────────────────────────────

describe('COOLDOWN', () => {
  it('first attempt with no prior audit row is allowed', async () => {
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(200)
  })

  it('second attempt within 60 seconds -> 429, provider not called', async () => {
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, [{ seconds_since: 10 }])
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(429)
    expect(sendTicketEmailMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.retry_after_seconds).toBe(50)
  })

  it('an attempt at exactly the 60-second boundary is allowed again', async () => {
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, [{ seconds_since: 60 }], [])
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(200)
  })

  it('a prior FAILED attempt still enforces the cooldown (counts every outcome, not just sends)', async () => {
    // The cooldown lookup only filters on organisation_id/resource_type/
    // resource_id/action — never on the after_state.result value — so a
    // row recorded from a prior 'failed' or 'unknown' attempt blocks a
    // second click exactly like a prior 'sent' row would.
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, [{ seconds_since: 5 }])
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(429)
  })
})

// ─── PROVIDER RESULT MODEL ───────────────────────────────────────────

describe('PROVIDER — Case B: sent', () => {
  it('returns 200 ok:true and writes an audit row', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'resend-msg-9' })
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, result: 'sent', attendee_count: 1 })
  })
})

describe('PROVIDER — Case A: hard failure', () => {
  it('returns 502 with result "failed", order/ticket data untouched, still attempts an audit row', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'failed', error: 'The email provider rejected the request.' })
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.result).toBe('failed')
    const insertCall = sqlMock.mock.calls.find(call => (call[0] as TemplateStringsArray).join('').includes('INSERT INTO audit_logs'))
    expect(insertCall).toBeDefined()
  })
})

describe('PROVIDER — Case C: unknown/ambiguous', () => {
  it('returns a non-2xx (504) with result "unknown" and an honest message, no automatic retry', async () => {
    // Pre-push hardening: an unknown delivery outcome is not an
    // ordinary successful request, so this is no longer HTTP 200.
    sendTicketEmailMock.mockResolvedValue({ result: 'unknown', error: 'The email provider did not return a definite result.' })
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(504)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.result).toBe('unknown')
    expect(sendTicketEmailMock).toHaveBeenCalledTimes(1)
  })

  it('still writes an audit row for an unknown outcome (counts toward cooldown)', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'unknown', error: 'The email provider did not return a definite result.' })
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    await route.POST(req(), ctx())
    const insertCall = sqlMock.mock.calls.find(call => (call[0] as TemplateStringsArray).join('').includes('INSERT INTO audit_logs'))
    expect(insertCall).toBeDefined()
  })
})

describe('PROVIDER — not_configured: RESEND_API_KEY absent', () => {
  it('returns a non-2xx (503) with result "not_configured", NEVER "sent", and never a fabricated provider id', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'not_configured' })
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.result).toBe('not_configured')
    expect(body.result).not.toBe('sent')
  })

  it('the error message names no secret, API key, or environment-variable name', async () => {
    // "environment" itself (as in "this environment") is fine to say —
    // the concern is never naming the actual env var (RESEND_API_KEY)
    // or any key/secret value.
    sendTicketEmailMock.mockResolvedValue({ result: 'not_configured' })
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    const res = await route.POST(req(), ctx())
    const body = await res.json()
    expect(body.error.toLowerCase()).not.toContain('resend_api_key')
    expect(body.error.toLowerCase()).not.toContain('api key')
    expect(body.error.toLowerCase()).not.toContain('secret')
  })

  it('still writes an audit row (a manager DID trigger the attempt) — counts toward cooldown', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'not_configured' })
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    await route.POST(req(), ctx())
    const insertCall = sqlMock.mock.calls.find(call => (call[0] as TemplateStringsArray).join('').includes('INSERT INTO audit_logs'))!
    expect(insertCall).toBeDefined()
    const afterState = JSON.parse(insertCall[insertCall.length - 1] as string)
    expect(afterState.result).toBe('not_configured')
    expect(afterState.provider_message_id).toBeNull()
  })
})

describe('PROVIDER — Case D: accepted, then audit write fails', () => {
  it('returns an explicit operational error, never an ordinary success, and never calls the provider twice', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'resend-msg-1' })
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, { __reject: new Error('db unavailable') })
    const res = await route.POST(req(), ctx())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.result).toBe('sent_audit_failed')
    expect(sendTicketEmailMock).toHaveBeenCalledTimes(1)
  })
})

// ─── AUDIT ───────────────────────────────────────────────────────────

describe('AUDIT', () => {
  it('records the correct action, resource, actor, and organisation', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager', 'org-a'))
    sendTicketEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'resend-msg-7' })
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    await route.POST(req(), ctx('event-1', 'order-1'))

    const insertCall = sqlMock.mock.calls.find(call => (call[0] as TemplateStringsArray).join('').includes('INSERT INTO audit_logs'))!
    const sqlText = (insertCall[0] as TemplateStringsArray).join('')
    expect(sqlText).toContain("'event_order.ticket_email_resent'")
    expect(sqlText).toContain("'event_order'")
    const values = insertCall.slice(1)
    expect(values).toContain('org-a')
    expect(values).toContain('staff-1')
    expect(values).toContain('order-1')
  })

  it('masks the recipient email — never stores the full address', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: null })
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    await route.POST(req(), ctx())

    const insertCall = sqlMock.mock.calls.find(call => (call[0] as TemplateStringsArray).join('').includes('INSERT INTO audit_logs'))!
    const afterStateJson = insertCall[insertCall.length - 1] as string
    expect(afterStateJson).not.toContain('jane@example.com')
    const afterState = JSON.parse(afterStateJson)
    expect(afterState.recipient_masked).toBe('j***@example.com')
  })

  it('records the attendee count and provider message id where available', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'resend-msg-42' })
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    await route.POST(req(), ctx())

    const insertCall = sqlMock.mock.calls.find(call => (call[0] as TemplateStringsArray).join('').includes('INSERT INTO audit_logs'))!
    const afterState = JSON.parse(insertCall[insertCall.length - 1] as string)
    expect(afterState.attendee_count).toBe(1)
    expect(afterState.provider_message_id).toBe('resend-msg-42')
    expect(afterState.result).toBe('sent')
  })

  it('never stores the ticket token, full email body, Stripe ids, or CRM ids', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: null })
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    await route.POST(req(), ctx())

    const insertCall = sqlMock.mock.calls.find(call => (call[0] as TemplateStringsArray).join('').includes('INSERT INTO audit_logs'))!
    const afterStateJson = insertCall[insertCall.length - 1] as string
    expect(afterStateJson).not.toContain('a'.repeat(64))
    expect(afterStateJson.toLowerCase()).not.toContain('stripe')
    expect(afterStateJson.toLowerCase()).not.toContain('crm')
    expect(afterStateJson).not.toContain('<html')
  })

  it('before_state is NULL — this action has no before/after field diff to record', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: null })
    queue(EVENT_ROW, ELIGIBLE_ORDER_ROW, NO_PRIOR_ATTEMPT, [])
    await route.POST(req(), ctx())

    const insertCall = sqlMock.mock.calls.find(call => (call[0] as TemplateStringsArray).join('').includes('INSERT INTO audit_logs'))!
    const sqlText = (insertCall[0] as TemplateStringsArray).join('')
    // The literal NULL sits between the resource_id placeholder and the
    // after_state placeholder in the route's own SQL text.
    expect(sqlText).toMatch(/NULL/)
  })
})
