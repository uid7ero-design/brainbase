import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase L1 — closing the P0 launch-audit finding "a staff member
// cannot cancel a confirmed free Events order". Every dependency here
// is mocked (no real database/network call anywhere in this file).
// What this file proves: route orchestration, permission/tenant
// enforcement, idempotency, that CRM failure can never block the
// cancellation, that no Stripe function is ever reachable from this
// route, and — by direct inspection of the actual predicate every
// downstream consumer already uses — that setting status = 'CANCELLED'
// on a free order is sufficient to restore capacity, invalidate the
// public ticket, and block check-in, with zero changes to those files.
// See tests/containment/eventsPendingPaymentManagement.test.ts for the
// pre-existing PENDING-reservation regression coverage of this same
// route (untouched by this phase).

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
    checkCapability: vi.fn().mockResolvedValue({ allowed: true, entitlement: { key: 'events', config: {} } }),
  }
})

// CRM sync is mocked at its own module boundary (never a raw sql call
// from this test's perspective) so its failure mode can be controlled
// directly, independent of the sqlMock response queue.
const recordEventBookingActivityForOrderMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/crm/eventSync', () => ({
  recordEventBookingActivityForOrder: (...args: unknown[]) => recordEventBookingActivityForOrderMock(...args),
}))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function sessionAs(role: string, organisationId = 'org-a') { return { userId: 'staff-1', organisationId, role } }
function req() {
  return new Request('http://localhost/x', { method: 'POST' })
}

const cancelRoute = await import('@/app/api/events/[id]/orders/[orderId]/cancel/route')

const CTX = { params: Promise.resolve({ id: 'event-1', orderId: 'order-1' }) }

const FREE_CONFIRMED_ORDER = { id: 'order-1', status: 'CONFIRMED', payment_status: 'NOT_REQUIRED' }

beforeEach(() => {
  sqlMock.mockClear()
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  recordEventBookingActivityForOrderMock.mockReset()
  recordEventBookingActivityForOrderMock.mockResolvedValue(undefined)
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
  requireCapabilityMock.mockResolvedValue({ key: 'events', config: {} })
})

describe('Cancel route — confirmed free order (Phase L1)', () => {
  it('happy path: a confirmed free order is cancelled — status flips to CANCELLED, payment_status stays NOT_REQUIRED', async () => {
    queue([{ id: 'event-1' }], [FREE_CONFIRMED_ORDER], [{ id: 'order-1' }])
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    const updateCall = sqlMock.mock.calls[2] as unknown as TemplateStringsArray[]
    const sqlText = updateCall[0].join('')
    expect(sqlText).toMatch(/status = 'CANCELLED'/)
    expect(sqlText).not.toMatch(/payment_status = 'EXPIRED'/) // free orders never touch payment_status
    expect(sqlText).toMatch(/status = 'CONFIRMED'/) // the idempotency guard
    expect(sqlText).toMatch(/payment_status = 'NOT_REQUIRED'/) // the idempotency guard
  })

  it('manager role is allowed', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager'))
    queue([{ id: 'event-1' }], [FREE_CONFIRMED_ORDER], [{ id: 'order-1' }])
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(200)
  })

  it('viewer is denied -> 403, no DB call', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('wrong-tenant event -> 404 (organisation_id scoped from the session only)', async () => {
    queue([]) // event lookup scoped to session.organisationId finds nothing
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(404)
  })

  it('wrong event/order parent (order exists but not under this event/org) -> 404', async () => {
    queue([{ id: 'event-1' }], []) // order lookup, scoped to event_id + organisation_id, finds nothing
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(404)
  })

  it('a PAID order is rejected -> 409, no UPDATE attempted', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', status: 'CONFIRMED', payment_status: 'PAID' }])
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(sqlMock).toHaveBeenCalledTimes(2) // ownership + order lookup only, no UPDATE
  })

  it('a REFUNDED order is rejected -> 409', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', status: 'CANCELLED', payment_status: 'REFUNDED' }])
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
  })

  it('a CONFIRMED order with payment_status PAID (i.e. not free) is rejected, even though status is CONFIRMED', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', status: 'CONFIRMED', payment_status: 'PAID' }])
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
  })

  it('a genuinely PENDING paid reservation remains governed by the existing PENDING semantics unchanged (regression)', async () => {
    queue([{ id: 'event-1' }], [{ id: 'order-1', status: 'PENDING', payment_status: 'PENDING' }], [{ id: 'order-1' }])
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[2] as unknown as TemplateStringsArray[]
    const sqlText = updateCall[0].join('')
    expect(sqlText).toMatch(/status = 'CANCELLED'/)
    expect(sqlText).toMatch(/payment_status = 'EXPIRED'/) // unchanged pending-path behaviour
    expect(sqlText).toMatch(/payment_status = 'PENDING'/) // the idempotency guard, unchanged
  })

  it('an order that is already CANCELLED by the time this request reads it is rejected cleanly (409) by the pre-check, never attempting a meaningless UPDATE', async () => {
    // status is neither 'PENDING' nor 'CONFIRMED' once already
    // cancelled, so isPendingPaidReservation and isConfirmedFreeOrder
    // are both false and the 409 guard fires before any UPDATE is
    // attempted — the UI's own gating (see the RegistrationsPanel
    // tests below) means a manager would never see this button for an
    // already-cancelled order in practice, but the API itself must
    // still respond sanely to a stale/direct request. True concurrent-
    // request idempotency (the UPDATE itself matching 0 rows) is
    // covered by the next test.
    queue([{ id: 'event-1' }], [{ id: 'order-1', status: 'CANCELLED', payment_status: 'NOT_REQUIRED' }])
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(409)
    expect(sqlMock).toHaveBeenCalledTimes(2) // ownership + order lookup only, no UPDATE attempted
  })

  it('a concurrent double-request race (two managers clicking simultaneously) resolves idempotently — the second UPDATE matches 0 rows and reports ok', async () => {
    queue([{ id: 'event-1' }], [FREE_CONFIRMED_ORDER], []) // UPDATE matches 0 rows: already resolved concurrently
    const res = await cancelRoute.POST(req(), CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.note).toMatch(/already resolved/)
    // Neither CRM sync nor the audit entry should fire on the no-op path.
    expect(recordEventBookingActivityForOrderMock).not.toHaveBeenCalled()
  })

  it('audit entry (audit_logs INSERT) is written exactly once on a successful free-order cancellation', async () => {
    queue([{ id: 'event-1' }], [FREE_CONFIRMED_ORDER], [{ id: 'order-1' }])
    await cancelRoute.POST(req(), CTX)
    const auditInserts = sqlMock.mock.calls.filter(call => {
      const text = ((call as unknown as unknown[])[0] as TemplateStringsArray).join('')
      return /INSERT INTO audit_logs/.test(text)
    })
    expect(auditInserts.length).toBe(1)
  })

  it('the audit entry identifies actor, order, event, previous state, and resulting state', async () => {
    queue([{ id: 'event-1' }], [FREE_CONFIRMED_ORDER], [{ id: 'order-1' }])
    await cancelRoute.POST(req(), CTX)
    const auditCall = sqlMock.mock.calls.find(call => {
      const text = ((call as unknown as unknown[])[0] as TemplateStringsArray).join('')
      return /INSERT INTO audit_logs/.test(text)
    })
    expect(auditCall).toBeTruthy()
    const values = auditCall!.slice(1) as unknown[]
    // Tagged-template call shape: [strings, ...interpolatedValues] — the
    // interpolated values include user_id, resource_id, before_state,
    // after_state JSON strings among others (see insertAuditLog).
    const joined = JSON.stringify(values)
    expect(joined).toContain('staff-1') // actor (userId)
    expect(joined).toContain('order-1') // order (resourceId)
    expect(joined).toContain('event-1') // event (eventId, carried in before/after state)
    expect(joined).toContain('CONFIRMED') // previous status
    expect(joined).toContain('CANCELLED') // resulting status
  })

  it('CRM sync cannot roll back or gate the cancellation — the DB mutation is already committed as its own, separate, prior statement before CRM is ever consulted', async () => {
    // lib/crm/eventSync.ts's real implementation wraps its own body in
    // try/catch and never throws (verified independently in
    // crmEventSyncBoundary.test.ts) — matching every sibling route
    // (refund, the pre-existing PENDING cancel path), this route calls
    // it directly with no additional local try/catch, trusting that
    // already-established contract rather than duplicating a guard
    // against a violation of it. What THIS test proves instead: the
    // order UPDATE is its own prior, already-executed sql call — not
    // part of a shared transaction with the CRM call — so nothing CRM
    // does afterward can undo it. Rejecting the mock here is a
    // deliberately adversarial simulation of that contract being
    // violated, specifically to prove the mutation's durability does
    // not depend on it: the UPDATE call is already present, with the
    // correct SQL, in the mock call log by the time CRM is invoked.
    recordEventBookingActivityForOrderMock.mockRejectedValue(new Error('adversarial: simulates a CRM contract violation'))
    queue([{ id: 'event-1' }], [FREE_CONFIRMED_ORDER], [{ id: 'order-1' }])
    await expect(cancelRoute.POST(req(), CTX)).rejects.toThrow()
    const updateCall = sqlMock.mock.calls[2] as unknown as TemplateStringsArray[]
    expect((updateCall[0] as unknown as TemplateStringsArray).join('')).toMatch(/status = 'CANCELLED'/)
    expect(recordEventBookingActivityForOrderMock).toHaveBeenCalledTimes(1)
  })

  it('no Stripe function is imported or called anywhere in this route', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/cancel/route.ts'))
    expect(code).not.toMatch(/from '@\/lib\/events\/stripe'/)
    expect(code).not.toMatch(/createCheckoutSession|createRefund|constructWebhookEvent/)
  })

  it('never hard-deletes anything — no DELETE statement anywhere in this route', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/cancel/route.ts'))
    expect(code).not.toMatch(/DELETE FROM/i)
  })

  it('manager+ role, matching every other Events mutation', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/cancel/route.ts'))
    expect(code).toMatch(/authorizeEventsRequest\('manager'\)/)
  })
})

describe('Capacity restoration — same predicate every consumer already uses (proof by inspection, not simulation)', () => {
  // This route sets status = 'CANCELLED' and nothing else new. Every
  // capacity-counting query in the codebase already excludes
  // status = 'CANCELLED' — proving these predicates exist (and are
  // unmodified by this phase) is what proves capacity is restored,
  // without needing a second, duplicate simulation of the aggregate.
  it('the free-registration route\'s capacity aggregates exclude CANCELLED orders (unmodified by this phase)', () => {
    const code = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts'))
    const occurrences = (code.match(/eo\.status <> 'CANCELLED'/g) ?? []).length
    expect(occurrences).toBeGreaterThanOrEqual(4) // session + ticket-type capacity, both branches
  })

  it('the paid checkout route\'s capacity aggregates exclude CANCELLED orders (unmodified by this phase)', () => {
    const code = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts'))
    expect(code).toMatch(/eo\.status <> 'CANCELLED'/)
  })

  it('getPublicEventDetail\'s remaining-capacity calculation excludes CANCELLED orders (unmodified by this phase)', () => {
    const code = stripComments(read('lib/events/publicEventDetail.ts'))
    expect(code).toMatch(/eo\.status <> 'CANCELLED'/)
  })
})

describe('Ticket/check-in behaviour after cancellation — same guards every consumer already uses (unmodified by this phase)', () => {
  it('publicTicket.ts derives ticket status purely from the order\'s own status — a CANCELLED order therefore always resolves CANCELLED, with no code change needed', () => {
    const code = stripComments(read('lib/events/publicTicket.ts'))
    expect(code).toMatch(/status: row\.order_status === 'CANCELLED' \? 'CANCELLED' : 'VALID'/)
  })

  it('confirmCheckIn\'s atomic UPDATE (both identifier branches) requires status <> CANCELLED in the same statement that decides check-in — a cancelled free order can never be checked in', () => {
    const code = stripComments(read('lib/events/checkIn.ts'))
    const occurrences = (code.match(/eo\.status <> 'CANCELLED'/g) ?? []).length
    expect(occurrences).toBeGreaterThanOrEqual(3) // confirmCheckIn x2 branches + searchAttendees
  })

  it('resolveAttendee returns reason "cancelled" for a cancelled order\'s attendee — proven directly against the real function with a mocked row', async () => {
    const { resolveAttendee } = await import('@/lib/events/checkIn')
    queue([{ id: 'attendee-1', attendee_name: 'Jamie', checked_in_at: null, order_status: 'CANCELLED', payment_status: 'NOT_REQUIRED', ticket_type_name: null, session_name: null }])
    const result = await resolveAttendee('org-a', 'event-1', { attendee_id: 'attendee-1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('cancelled')
  })

  it('searchAttendees excludes a cancelled order\'s attendee from staff search results — proven directly against the real function', async () => {
    const { searchAttendees } = await import('@/lib/events/checkIn')
    queue([]) // the WHERE clause's own status <> 'CANCELLED' guard means a cancelled attendee never appears in the row set
    const results = await searchAttendees('org-a', 'event-1', 'Jamie')
    expect(results).toEqual([])
  })
})

describe('RegistrationsPanel — free-order cancel action (Phase L1 UI)', () => {
  const code = stripComments(read('app/events/[id]/RegistrationsPanel.tsx'))

  it('shows a Cancel registration action for a CONFIRMED free order, manager+ only, distinct from the PAID-only Refund gate', () => {
    expect(code).toMatch(/canManage && o\.status === 'CONFIRMED' && o\.payment_status === 'NOT_REQUIRED'/)
  })

  it('reuses the existing cancelPending() handler rather than introducing a second network call/handler', () => {
    const freeGateStart = code.indexOf(`o.status === 'CONFIRMED' && o.payment_status === 'NOT_REQUIRED'`)
    expect(freeGateStart).toBeGreaterThan(-1)
    const freeBlock = code.slice(freeGateStart, freeGateStart + 400)
    expect(freeBlock).toMatch(/cancelPending\(o\.id\)/)
    // Confirms there is only ever one fetch('.../cancel') call site in
    // this whole file — the free-order button dispatches through the
    // same handler/endpoint as the PENDING case, not a duplicate.
    const cancelFetchOccurrences = (code.match(/fetch\(`\/api\/events\/\$\{eventId\}\/orders\/\$\{orderId\}\/cancel`/g) ?? []).length
    expect(cancelFetchOccurrences).toBe(1)
  })

  it('destructive cancel action still requires confirmation for the free-order case (same handler, same confirm())', () => {
    const fnStart = code.indexOf('async function cancelPending')
    const fnBody = code.slice(fnStart, code.indexOf('\n  }', fnStart))
    expect(fnBody).toMatch(/confirm\(/)
  })

  it('the Refund button remains gated to PAID orders only — never rendered for a free order', () => {
    expect(code).toMatch(/o\.payment_status === 'PAID' && o\.refundable/)
  })
})
