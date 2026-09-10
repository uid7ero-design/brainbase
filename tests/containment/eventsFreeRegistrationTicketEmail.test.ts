import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

// Phase 3E.2 — wires AUTOMATIC initial ticket-email delivery for NEW
// successful FREE registrations only. This file proves the REGISTER
// ROUTE's own integration with the 3E.1 foundation:
//   - the newly-created order's INSERT (both the session-bound and
//     non-session-bound branches) writes ticket_email_status='pending'
//     in the SAME atomic statement that creates the order — never a
//     separate UPDATE, never a broad/historical write
//   - attemptAutomaticTicketEmail() is invoked exactly once, strictly
//     AFTER the capacity transaction has committed, with the exact
//     newly-created order id
//   - its outcome (success, ordinary failure, or even an unexpected
//     thrown error) NEVER changes the registration's own HTTP status
//     or response body
//   - it is NEVER invoked when no order was actually created (capacity
//     conflict / transaction failure)
//
// attemptAutomaticTicketEmail's OWN internal orchestration logic (claim
// -> read -> send -> mark sent/failed -> audit) is tested separately in
// tests/containment/eventsTicketEmailDelivery.test.ts, which already
// owns the SQL-mocking infrastructure for the 3E.1 primitives it calls
// — this file only proves the CALLER (the register route) integrates
// with it correctly.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))

let transactionFinalResult: unknown[] = [{ id: 'attendee-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }]
const transactionMock = vi.fn(async () => [[], [], [], [], transactionFinalResult])
;(sqlMock as unknown as { transaction: typeof transactionMock }).transaction = transactionMock

vi.mock('@/lib/db', () => ({ default: sqlMock }))

const checkCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, checkCapability: (...args: unknown[]) => checkCapabilityMock(...args) }
})

const checkRateLimitMock = vi.fn()
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}))

// Mocked so this file can assert exact invocation behaviour (call
// count, argument, timing, and that its outcome never leaks into the
// response) without needing to also drive the 3E.1 claim/send
// internals through this route's own sql mock.
const attemptAutomaticTicketEmailMock = vi.fn()
vi.mock('@/lib/events/ticketEmailDelivery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/ticketEmailDelivery')>()
  return { ...actual, attemptAutomaticTicketEmail: (...args: unknown[]) => attemptAutomaticTicketEmailMock(...args) }
})

const syncEventOrderContactMock = vi.fn()
const recordEventBookingActivityMock = vi.fn()
vi.mock('@/lib/crm/eventSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crm/eventSync')>()
  return {
    ...actual,
    syncEventOrderContact: (...args: unknown[]) => syncEventOrderContactMock(...args),
    recordEventBookingActivity: (...args: unknown[]) => recordEventBookingActivityMock(...args),
  }
})

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

function resolveTransaction(finalResult: unknown[]) {
  transactionFinalResult = finalResult
  transactionMock.mockImplementationOnce(async () => [[], [], [], [], finalResult])
}

function rejectTransaction(err: Error) {
  transactionMock.mockRejectedValueOnce(err)
}

const registerRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/register/route')

const ORG_ROW = [{ id: 'org-a' }]
const PUBLISHED_EVENT_ROW = [{
  id: 'event-1', organisation_id: 'org-a', name: 'Graduation', slug: 'graduation',
  description: null, venue: 'Hall', starts_at: new Date('2026-12-01T10:00:00Z'),
  ends_at: new Date('2026-12-01T12:00:00Z'), timezone: 'Australia/Adelaide',
}]
const FREE_ACTIVE_TICKET_TYPE_ROW = [{ id: 'tt-1', active: true, price_cents: 0 }]

const SINGLE_BODY = {
  ticket_type_id: 'tt-1',
  quantity: 1,
  purchaser_name: 'Jane Purchaser',
  purchaser_email: 'jane@example.com',
  attendees: [{ name: 'Attendee One' }],
}

const MULTI_BODY = {
  ticket_type_id: 'tt-1',
  quantity: 2,
  purchaser_name: 'Jane Purchaser',
  purchaser_email: 'jane@example.com',
  attendees: [{ name: 'Attendee One' }, { name: 'Attendee Two' }],
}

function req(body: unknown) {
  return asNextRequest(new Request('http://localhost/api/public/events/ld-tennis/graduation/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}

const CTX = { params: Promise.resolve({ organisationSlug: 'ld-tennis', eventSlug: 'graduation' }) }

beforeEach(() => {
  sqlMock.mockClear()
  transactionMock.mockClear()
  checkCapabilityMock.mockReset()
  checkRateLimitMock.mockReset()
  attemptAutomaticTicketEmailMock.mockReset()
  syncEventOrderContactMock.mockReset()
  recordEventBookingActivityMock.mockReset()
  responseQueue = []
  callCount = 0
  transactionFinalResult = [{ id: 'attendee-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }]
  transactionMock.mockImplementation(async () => [[], [], [], [], transactionFinalResult])
  checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'events', config: {} } })
  checkRateLimitMock.mockReturnValue(true)
  syncEventOrderContactMock.mockResolvedValue(undefined)
  recordEventBookingActivityMock.mockResolvedValue(undefined)
  attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'not_claimed' })
})

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const ROUTE_SOURCE = stripComments(fs.readFileSync(
  path.join(process.cwd(), 'app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts'),
  'utf-8',
))
const STRIPE_SOURCE = fs.readFileSync(path.join(process.cwd(), 'lib/events/stripe.ts'), 'utf-8')
const RESEND_ROUTE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts'),
  'utf-8',
)

describe('SCHEDULING — ticket_email_status is written only in the order-creation INSERT', () => {
  it('both INSERT INTO event_orders branches include ticket_email_status and bind it to the literal \'pending\'', () => {
    const occurrences = ROUTE_SOURCE.match(/INSERT INTO event_orders \([^)]*ticket_email_status\)/g) ?? []
    expect(occurrences.length).toBe(2)
    const selectOccurrences = ROUTE_SOURCE.match(/'CONFIRMED', 0, \$\{bookingToken\}, 'pending'/g) ?? []
    expect(selectOccurrences.length).toBe(2)
  })

  it('MANDATORY historical safety — no broad UPDATE event_orders SET ticket_email_status exists anywhere in this route', () => {
    expect(ROUTE_SOURCE).not.toMatch(/UPDATE\s+event_orders\s+SET[^;]*ticket_email_status/i)
  })

  it('the literal \'pending\' appears ONLY inside the two INSERT column-value lists — not as a standalone assignment', () => {
    const pendingOccurrences = (ROUTE_SOURCE.match(/'pending'/g) ?? []).length
    expect(pendingOccurrences).toBe(2)
  })

  it('a valid single-attendee free registration succeeds with 201', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ id: 'attendee-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    expect(res.status).toBe(201)
  })

  it('a valid multi-attendee free registration succeeds with 201', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([
      { id: 'a1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) },
      { id: 'a2', order_id: 'order-1', attendee_name: 'Attendee Two', ticket_token: 'b'.repeat(64) },
    ])
    const res = await registerRoute.POST(req(MULTI_BODY), CTX)
    expect(res.status).toBe(201)
  })
})

describe('ORCHESTRATION INVOCATION — attemptAutomaticTicketEmail', () => {
  it('is invoked exactly once for a successful registration', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ id: 'attendee-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    await registerRoute.POST(req(SINGLE_BODY), CTX)
    expect(attemptAutomaticTicketEmailMock).toHaveBeenCalledTimes(1)
  })

  it('is invoked with the exact newly-created order id', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ id: 'attendee-1', order_id: 'order-xyz', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    await registerRoute.POST(req(SINGLE_BODY), CTX)
    expect(attemptAutomaticTicketEmailMock).toHaveBeenCalledWith('order-xyz')
  })

  it('the call site is textually AFTER the transaction/CRM handling and BEFORE the response is built — never before commit', () => {
    const transactionIdx = ROUTE_SOURCE.indexOf('transactionResults[transactionResults.length - 1]')
    const crmIdx = ROUTE_SOURCE.indexOf('recordEventBookingActivity(')
    const attemptIdx = ROUTE_SOURCE.indexOf('attemptAutomaticTicketEmail(orderId)')
    const responseIdx = ROUTE_SOURCE.indexOf('confirmation_reference: orderId')
    expect(transactionIdx).toBeGreaterThan(-1)
    expect(crmIdx).toBeGreaterThan(transactionIdx)
    expect(attemptIdx).toBeGreaterThan(crmIdx)
    expect(responseIdx).toBeGreaterThan(attemptIdx)
  })

  it('the call is awaited and wrapped in its own try/catch in the route (defense in depth)', () => {
    const attemptIdx = ROUTE_SOURCE.indexOf('attemptAutomaticTicketEmail(orderId)')
    const surrounding = ROUTE_SOURCE.slice(Math.max(0, attemptIdx - 60), attemptIdx + 'attemptAutomaticTicketEmail(orderId)'.length + 5)
    expect(surrounding).toContain('try {')
    expect(surrounding).toContain('await attemptAutomaticTicketEmail(orderId)')
  })

  it('registration still returns 201 when attemptAutomaticTicketEmail resolves "sent"', async () => {
    attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'sent', providerMessageId: 'msg-1' })
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ id: 'attendee-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    expect(res.status).toBe(201)
  })

  it('registration still returns 201 when attemptAutomaticTicketEmail resolves "failed"', async () => {
    attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'failed', reason: 'provider_rejected' })
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ id: 'attendee-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    expect(res.status).toBe(201)
  })

  // Phase 3E.2 remediation — the Resend fetch() call now has a bounded
  // provider timeout (lib/email.ts); a timeout surfaces all the way up
  // through sendTicketEmail() -> attemptAutomaticTicketEmail() as an
  // ordinary { outcome: 'failed', reason: 'ambiguous_outcome' } (see
  // eventsTicketEmailSend.test.ts and eventsTicketEmailDelivery.test.ts
  // for that mapping's own proof) — this test proves the REGISTER
  // ROUTE's own response is completely unaffected by that specific
  // outcome, the same way it already is for every other outcome above.
  it('registration still returns 201 when attemptAutomaticTicketEmail resolves "failed" with reason ambiguous_outcome (the timeout case)', async () => {
    attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'failed', reason: 'ambiguous_outcome' })
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ id: 'attendee-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.confirmation_reference).toBe('order-1')
  })

  it('registration still returns 201 when attemptAutomaticTicketEmail resolves "not_claimed"', async () => {
    attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'not_claimed' })
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ id: 'attendee-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    expect(res.status).toBe(201)
  })

  it('registration still returns 201 even when attemptAutomaticTicketEmail unexpectedly REJECTS (proves the route-level try/catch actually protects the response)', async () => {
    attemptAutomaticTicketEmailMock.mockRejectedValue(new Error('unexpected internal failure'))
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ id: 'attendee-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    expect(res.status).toBe(201)
  })

  it('the response body is unaffected by attemptAutomaticTicketEmail\'s outcome — same shape whether sent, failed, or rejected', async () => {
    for (const mockBehavior of [
      () => attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'sent', providerMessageId: 'msg-1' }),
      () => attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'failed', reason: 'provider_rejected' }),
      () => attemptAutomaticTicketEmailMock.mockRejectedValue(new Error('boom')),
    ]) {
      mockBehavior()
      queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
      resolveTransaction([{ id: 'attendee-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
      const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
      const body = await res.json()
      expect(body).toEqual({
        confirmation_reference: 'order-1',
        quantity: 1,
        tickets: [{ attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }],
        booking_token: expect.any(String),
      })
    }
  })

  it('no internal delivery-state field (ticket_email_status/claim_id/outcome) is ever exposed in the response body', async () => {
    attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'sent', providerMessageId: 'msg-1' })
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ id: 'attendee-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    const bodyText = JSON.stringify(await res.json())
    expect(bodyText).not.toMatch(/ticket_email_status|claim_id|outcome|provider_message_id|pending|sending/i)
  })
})

describe('CLAIM FAILURE / TRANSACTION FAILURE — no provider call before or without commit', () => {
  it('claim-not-claimed outcome: registration still succeeds, no crash', async () => {
    attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'not_claimed' })
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ id: 'attendee-1', order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    expect(res.status).toBe(201)
    expect(attemptAutomaticTicketEmailMock).toHaveBeenCalledTimes(1)
  })

  it('capacity conflict (empty RETURNING, no order created) -> 409, attemptAutomaticTicketEmail is NEVER called', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([])
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    expect(res.status).toBe(409)
    expect(attemptAutomaticTicketEmailMock).not.toHaveBeenCalled()
  })

  it('transaction failure (thrown error, no order created) -> 500, attemptAutomaticTicketEmail is NEVER called', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    rejectTransaction(new Error('connection reset'))
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    expect(res.status).toBe(500)
    expect(attemptAutomaticTicketEmailMock).not.toHaveBeenCalled()
  })

  it('the provider is never called before commit — attemptAutomaticTicketEmail call site is textually AFTER the empty-RETURNING 409 early return', () => {
    const earlyReturnIdx = ROUTE_SOURCE.indexOf("status: 409")
    const attemptIdx = ROUTE_SOURCE.indexOf('attemptAutomaticTicketEmail(orderId)')
    expect(earlyReturnIdx).toBeGreaterThan(-1)
    expect(attemptIdx).toBeGreaterThan(earlyReturnIdx)
  })
})

describe('PAID CONTAINMENT — lib/events/stripe.ts is completely untouched by 3E.2', () => {
  it('stripe.ts contains zero reference to ticketEmailDelivery/attemptAutomaticTicketEmail', () => {
    expect(STRIPE_SOURCE).not.toMatch(/ticketEmailDelivery|attemptAutomaticTicketEmail/)
  })

  it('stripe.ts still contains no ticket_email_ column reference beyond what 3E.1 already proved absent (paid scheduling remains unwired)', () => {
    expect(STRIPE_SOURCE).not.toMatch(/ticket_email_status\s*=\s*'pending'/)
  })
})

describe('MANUAL RESEND — untouched by 3E.2', () => {
  it('the manual resend route still does not reference attemptAutomaticTicketEmail or ticketEmailDelivery', () => {
    expect(RESEND_ROUTE_SOURCE).not.toMatch(/ticketEmailDelivery|attemptAutomaticTicketEmail/)
  })

  it('the manual resend route still does not pass an idempotencyKey', () => {
    expect(RESEND_ROUTE_SOURCE).not.toMatch(/idempotencyKey/)
  })
})
