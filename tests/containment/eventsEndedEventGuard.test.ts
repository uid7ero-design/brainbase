import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Ended-event registration guard. Once an event's own end (events.ends_at)
// has passed, no new free registration, paid checkout, quote or payment
// retry may proceed — regardless of the ticket types' own sale windows
// (a type with no sale end used to stay bookable forever). Enforced
// server-side at the DATABASE's NOW(), never the client clock; a NULL
// ends_at means "no end" (existing behaviour). The real-Postgres proof
// (eventsEndedEventGuardRealPostgres.test.ts) runs the same paths end to
// end; this file covers the pure rule, the cart loader's precedence, the
// HTTP mapping and the source pins on the locked gates.

const rowsQueue: unknown[][] = []
const sqlMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(() => Promise.resolve(rowsQueue.shift() ?? []))
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const { hasEventEnded } = await import('@/lib/events/saleWindow')
const { loadCartTicketTypes } = await import('@/lib/events/services/cart')
const { freeRegistrationResultResponse } = await import('@/lib/events/freeRegistrationResponse')
const { paidCheckoutResultResponse } = await import('@/lib/events/paidCheckoutResponse')

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8')

beforeEach(() => {
  sqlMock.mockClear()
  rowsQueue.length = 0
})

describe('hasEventEnded — display rule (server clock only)', () => {
  const ENDS = '2026-12-01T12:00:00.000Z'

  it('not started / in progress / ended', () => {
    expect(hasEventEnded(ENDS, new Date('2026-11-30T00:00:00Z'))).toBe(false) // before it starts
    expect(hasEventEnded(ENDS, new Date('2026-12-01T11:59:59.999Z'))).toBe(false) // in progress
    expect(hasEventEnded(ENDS, new Date('2026-12-01T12:00:00.001Z'))).toBe(true) // ended
  })

  it('half-open: the end instant itself is ended (same rule as a sale window end)', () => {
    expect(hasEventEnded(ENDS, new Date(ENDS))).toBe(true)
  })

  it('no end time (null / undefined / unparsable) is never ended', () => {
    expect(hasEventEnded(null, new Date('2099-01-01T00:00:00Z'))).toBe(false)
    expect(hasEventEnded(undefined, new Date('2099-01-01T00:00:00Z'))).toBe(false)
    expect(hasEventEnded('not a date', new Date('2099-01-01T00:00:00Z'))).toBe(false)
  })

  it('timezone / DST: the boundary is the stored instant, whatever offset it was written in', () => {
    // Adelaide DST starts 2026-10-04 02:00 ACST (+09:30) -> 03:00 ACDT (+10:30).
    // An event ending 03:15 ACDT that morning ends at 2026-10-03T16:45Z.
    const endsLocal = '2026-10-04T03:15:00+10:30'
    expect(new Date(endsLocal).toISOString()).toBe('2026-10-03T16:45:00.000Z')
    expect(hasEventEnded(endsLocal, new Date('2026-10-03T16:44:59Z'))).toBe(false)
    expect(hasEventEnded(endsLocal, new Date('2026-10-03T16:45:00Z'))).toBe(true)
    // 01:59 ACST, one minute before the clocks jump, is 16:29Z: still running.
    expect(hasEventEnded(endsLocal, new Date('2026-10-04T01:59:00+09:30'))).toBe(false)
    // DST end (2027-04-04 03:00 ACDT -> 02:00 ACST): an event ending 02:30
    // ACST — the second 02:30 that night — ends at 2027-04-03T17:00Z, an hour
    // after the first 02:30 (ACDT, 16:00Z).
    const endsAfterFallback = '2027-04-04T02:30:00+09:30'
    expect(hasEventEnded(endsAfterFallback, new Date('2027-04-04T02:30:00+10:30'))).toBe(false)
    expect(hasEventEnded(endsAfterFallback, new Date('2027-04-03T17:00:00Z'))).toBe(true)
    // Same instant written in UTC, Adelaide or Kiritimati (+14): same verdict.
    for (const e of ['2026-12-01T12:00:00Z', '2026-12-01T22:30:00+10:30', '2026-12-02T02:00:00+14:00']) {
      expect(hasEventEnded(e, new Date('2026-12-01T11:59:00Z'))).toBe(false)
      expect(hasEventEnded(e, new Date('2026-12-01T12:00:00Z'))).toBe(true)
    }
  })
})

describe('loadCartTicketTypes — EVENT_ENDED at the database clock, before every ticket-type rule', () => {
  const items = [{ ticket_type_id: 'tt-a', quantity: 1 }]
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'tt-a', active: true, price_cents: 0, currency: 'AUD', name: 'Free',
    sale_started: true, sale_ended: false, requires_access_code: false, fee_policy: null, event_ended: false, ...over,
  })

  it('the ended flag is computed by the database in the same tenant-scoped query (NOW(), correlated to this event)', async () => {
    rowsQueue.push([row()])
    await loadCartTicketTypes('org-a', 'event-1', items)
    const text = (sqlMock.mock.calls[0][0] as unknown as TemplateStringsArray).join('?')
    expect(text).toMatch(/\(SELECT e\.ends_at IS NOT NULL AND e\.ends_at <= NOW\(\) FROM events e WHERE e\.id = event_ticket_types\.event_id AND e\.organisation_id = event_ticket_types\.organisation_id\) AS event_ended/)
    expect(text).toMatch(/WHERE organisation_id = \? AND event_id = \? AND id = ANY/)
  })

  it('event ended -> EVENT_ENDED, even when the ticket type has no sale window at all', async () => {
    rowsQueue.push([row({ event_ended: true })])
    expect(await loadCartTicketTypes('org-a', 'event-1', items)).toEqual({ ok: false, code: 'EVENT_ENDED' })
  })

  it('event ended wins over every ticket-type verdict (inactive, not started, sale ended, access required)', async () => {
    for (const over of [{ active: false }, { sale_started: false }, { sale_ended: true }, { requires_access_code: true }]) {
      rowsQueue.push([row({ event_ended: true, ...over })])
      expect(await loadCartTicketTypes('org-a', 'event-1', items)).toEqual({ ok: false, code: 'EVENT_ENDED' })
    }
  })

  it('sale windows still apply exactly as before while the event has not ended', async () => {
    rowsQueue.push([row({ sale_ended: true })])
    expect(await loadCartTicketTypes('org-a', 'event-1', items)).toEqual({ ok: false, code: 'SALE_ENDED' })
    rowsQueue.push([row({ sale_started: false })])
    expect(await loadCartTicketTypes('org-a', 'event-1', items)).toEqual({ ok: false, code: 'SALE_NOT_STARTED' })
    rowsQueue.push([row()])
    expect((await loadCartTicketTypes('org-a', 'event-1', items)).ok).toBe(true)
  })

  it('a row without the column (older fixture/caller) reads as not ended — no end time preserves existing behaviour', async () => {
    const legacy: Record<string, unknown> = row()
    delete legacy.event_ended
    rowsQueue.push([legacy])
    expect((await loadCartTicketTypes('org-a', 'event-1', items)).ok).toBe(true)
  })
})

describe('HTTP mapping — neutral 409, nothing reserved', () => {
  it('free registration and paid checkout both answer 409 "This event has ended."', async () => {
    for (const res of [freeRegistrationResultResponse({ ok: false, code: 'EVENT_ENDED' }), paidCheckoutResultResponse({ ok: false, code: 'EVENT_ENDED' })]) {
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'This event has ended.' })
    }
  })

  it('the quote route reports it as a cart error with the same wording', () => {
    expect(read('app/api/public/events/[organisationSlug]/[eventSlug]/quote/route.ts')).toContain("EVENT_ENDED: 'This event has ended.',")
  })

  it('the organiser retry route maps it to 409 too', () => {
    expect(read('app/api/events/[id]/orders/[orderId]/retry/route.ts')).toMatch(/case 'EVENT_ENDED':\s*\n\s*return NextResponse\.json\(\{ error: 'This event has ended\.' \}, \{ status: 409 \}\);/)
  })
})

describe('source pins — the locked reservation gates and retry re-check at the database clock', () => {
  const GATE = /NOT EXISTS \(\s*\n\s*SELECT 1 FROM events ev\s*\n\s*WHERE ev\.id = tt\.event_id AND ev\.organisation_id = tt\.organisation_id\s*\n\s*AND ev\.ends_at IS NOT NULL AND ev\.ends_at <= NOW\(\)\s*\n\s*\)\s*\n\s*AND tt\.active/

  it('free registration and paid checkout gates both carry the ended clause inside the purchasable expression', () => {
    for (const f of ['lib/events/services/freeRegistration.ts', 'lib/events/services/paidCheckout.ts']) {
      expect(read(f)).toMatch(GATE)
    }
  })

  it('both services load the cart (and so hit EVENT_ENDED) before any order INSERT or Stripe call', () => {
    for (const f of ['lib/events/services/freeRegistration.ts', 'lib/events/services/paidCheckout.ts']) {
      const src = read(f)
      const cart = src.indexOf('await loadCartTicketTypes(')
      expect(cart).toBeGreaterThan(-1)
      expect(cart).toBeLessThan(src.indexOf('sql.transaction(['))
      const stripe = src.indexOf('createCheckoutSession(')
      if (stripe > -1) expect(cart).toBeLessThan(stripe)
    }
  })

  it('retry refuses an ended event straight after the cancelled check, before locks or Stripe', () => {
    const src = read('lib/events/services/retryCheckout.ts')
    expect(src).toMatch(/\(e\.ends_at IS NOT NULL AND e\.ends_at <= NOW\(\)\) AS ended/)
    const ended = src.indexOf("return { ok: false, code: 'EVENT_ENDED' }")
    expect(ended).toBeGreaterThan(src.indexOf("return { ok: false, code: 'EVENT_CANCELLED' }"))
    expect(ended).toBeLessThan(src.indexOf('sql.transaction(['))
    expect(ended).toBeLessThan(src.indexOf('await createCheckoutSession('))
  })

  it('the public detail exposes the server verdict, computed with the server clock', () => {
    expect(read('lib/events/publicEventDetail.ts')).toContain('has_ended: hasEventEnded(event.ends_at),')
  })
})
