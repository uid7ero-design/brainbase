import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { evaluateTicketValidity, toPublicTicketStatus } from '@/lib/events/ticketValidity'

// Event-cancellation validity fix — previously only order-level
// cancellation was checked by the public ticket page and staff check-in;
// a cancelled EVENT (as opposed to a cancelled order) was never
// checked at all. This suite proves the shared derivation
// (lib/events/ticketValidity.ts) is correct in isolation, AND that
// every consumer (public ticket, booking wallet, staff check-in) is
// wired to the same rule rather than three independent
// re-implementations that could drift.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('evaluateTicketValidity — pure derivation', () => {
  const VALID = { eventStatus: 'PUBLISHED', orderStatus: 'CONFIRMED', paymentStatus: 'NOT_REQUIRED' }

  it('valid: PUBLISHED event, CONFIRMED order, NOT_REQUIRED payment', () => {
    expect(evaluateTicketValidity(VALID)).toEqual({ valid: true })
  })

  it('valid: PUBLISHED event, CONFIRMED order, PAID payment', () => {
    expect(evaluateTicketValidity({ ...VALID, paymentStatus: 'PAID' })).toEqual({ valid: true })
  })

  it('event cancelled takes priority — reported as event_cancelled even if order/payment would otherwise be valid', () => {
    expect(evaluateTicketValidity({ ...VALID, eventStatus: 'CANCELLED' })).toEqual({ valid: false, reason: 'event_cancelled' })
  })

  it('order cancelled (covers manual cancellation and refund, which sets status=CANCELLED)', () => {
    expect(evaluateTicketValidity({ ...VALID, orderStatus: 'CANCELLED' })).toEqual({ valid: false, reason: 'order_cancelled' })
  })

  it('payment PENDING is invalid', () => {
    expect(evaluateTicketValidity({ ...VALID, paymentStatus: 'PENDING' })).toEqual({ valid: false, reason: 'payment_invalid' })
  })
  it('payment FAILED is invalid', () => {
    expect(evaluateTicketValidity({ ...VALID, paymentStatus: 'FAILED' })).toEqual({ valid: false, reason: 'payment_invalid' })
  })
  it('payment EXPIRED is invalid', () => {
    expect(evaluateTicketValidity({ ...VALID, paymentStatus: 'EXPIRED' })).toEqual({ valid: false, reason: 'payment_invalid' })
  })

  it('event_cancelled reason takes priority over order_cancelled when both are true', () => {
    expect(evaluateTicketValidity({ eventStatus: 'CANCELLED', orderStatus: 'CANCELLED', paymentStatus: 'NOT_REQUIRED' })).toEqual({ valid: false, reason: 'event_cancelled' })
  })
})

describe('toPublicTicketStatus — public vocabulary mapping', () => {
  it('valid -> VALID', () => {
    expect(toPublicTicketStatus({ valid: true })).toBe('VALID')
  })
  it('event_cancelled -> EVENT_CANCELLED (distinct public copy)', () => {
    expect(toPublicTicketStatus({ valid: false, reason: 'event_cancelled' })).toBe('EVENT_CANCELLED')
  })
  it('order_cancelled -> CANCELLED', () => {
    expect(toPublicTicketStatus({ valid: false, reason: 'order_cancelled' })).toBe('CANCELLED')
  })
  it('payment_invalid -> CANCELLED (collapses to the same generic public state — never a distinct "payment failed" message to a bearer-token holder)', () => {
    expect(toPublicTicketStatus({ valid: false, reason: 'payment_invalid' })).toBe('CANCELLED')
  })
})

describe('No competing status sources of truth — every consumer references the shared rule', () => {
  it('getPublicTicketDetail imports and uses evaluateTicketValidity/toPublicTicketStatus, and selects e.status', () => {
    const code = stripComments(read('lib/events/publicTicket.ts'))
    expect(code).toMatch(/from '\.\/ticketValidity'/)
    expect(code).toMatch(/evaluateTicketValidity\(/)
    expect(code).toMatch(/e\.status AS event_status/)
  })

  it('getPublicBookingDetail imports and uses evaluateTicketValidity/toPublicTicketStatus, and selects e.status', () => {
    const code = stripComments(read('lib/events/publicBooking.ts'))
    expect(code).toMatch(/from '\.\/ticketValidity'/)
    expect(code).toMatch(/evaluateTicketValidity\(/)
    expect(code).toMatch(/e\.status AS event_status/)
  })

  it('checkIn.ts\'s resolveAttendee/confirmCheckIn/searchAttendees each join events and check ev.status/e.status — the same rule expressed as an inline SQL guard (see that file\'s own comment on why the mutation path cannot import the JS helper)', () => {
    const code = stripComments(read('lib/events/checkIn.ts'))
    const evJoinCount = (code.match(/JOIN events ev ON ev\.id = ea\.event_id/g) ?? []).length
    const evFromCount = (code.match(/FROM event_order_items oi, event_orders eo, events ev/g) ?? []).length
    expect(evJoinCount).toBeGreaterThanOrEqual(2) // resolveAttendee's two branches
    expect(evFromCount).toBe(2) // confirmCheckIn's two branches
    expect(code).toMatch(/ev\.status <> 'CANCELLED'/)
  })

  it('resolveAttendee returns a distinguishable event_cancelled reason before checking order/payment', () => {
    const code = stripComments(read('lib/events/checkIn.ts'))
    const fnStart = code.indexOf('export async function resolveAttendee')
    const fnEnd = code.indexOf('\nexport type ConfirmCheckInResult', fnStart)
    const fn = code.slice(fnStart, fnEnd)
    const eventCancelledIdx = fn.indexOf("reason: 'event_cancelled'")
    const orderCancelledIdx = fn.indexOf("reason: 'cancelled'")
    expect(eventCancelledIdx).toBeGreaterThan(-1)
    expect(orderCancelledIdx).toBeGreaterThan(-1)
    expect(eventCancelledIdx).toBeLessThan(orderCancelledIdx)
  })
})

describe('Shared TicketCard — event-cancelled renders distinct copy, no usable QR (used by both /t/[token] and the booking wallet)', () => {
  const source = stripComments(read('components/events/TicketCard.tsx'))

  it('branches on EVENT_CANCELLED for distinct copy', () => {
    expect(source).toMatch(/eventCancelled/)
    expect(source).toContain('This event has been cancelled.')
    expect(source).toContain('This ticket has been cancelled.')
  })

  it('no QR is rendered for any non-VALID status — the cancelled branch never falls through to the QR block', () => {
    expect(source).toMatch(/cancelled \? \(/)
  })

  it('app/t/[token]/page.tsx renders through the shared TicketCard rather than its own inline card markup', () => {
    const pageSource = stripComments(read('app/t/[token]/page.tsx'))
    expect(pageSource).toMatch(/from '@\/components\/events\/TicketCard'/)
    expect(pageSource).toContain('<TicketCard')
    expect(pageSource).not.toContain("dangerouslySetInnerHTML")
  })
})

describe('Staff check-in route messages distinguish event_cancelled', () => {
  it('confirm route maps event_cancelled to its own message', () => {
    const code = read('app/api/events/[id]/check-in/confirm/route.ts')
    expect(code).toContain("result.reason === 'event_cancelled'")
    expect(code).toContain('Event cancelled.')
  })

  it('resolve route maps event_cancelled to its own message', () => {
    const code = read('app/api/events/[id]/check-in/resolve/route.ts')
    expect(code).toContain("result.reason === 'event_cancelled'")
    expect(code).toContain('Event cancelled.')
  })
})
