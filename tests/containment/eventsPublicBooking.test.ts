import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Booking-level multi-ticket wallet — public resolver
// (lib/events/publicBooking.ts). Same containment discipline as
// tests/containment/eventsPhase3Ticketing.test.ts's own "Public ticket"
// section: every DB call is mocked, proving route orchestration/
// allow-list/tenant-scoping behaviour, not real Postgres semantics.

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

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

beforeEach(() => {
  sqlMock.mockClear()
  responseQueue = []
  callCount = 0
})

const { getPublicBookingDetail } = await import('@/lib/events/publicBooking')

const ORDER_ROW = {
  id: 'order-1', organisation_id: 'org-a', purchaser_name: 'Jane Doe',
  order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED', event_status: 'PUBLISHED',
  event_name: 'Spring Gala', venue: 'Hall', artwork_url: 'https://example.com/a.jpg',
  starts_at: new Date('2026-12-01T10:00:00Z'), ends_at: new Date('2026-12-01T12:00:00Z'), timezone: 'Australia/Adelaide',
}
function attendeeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    attendee_name: 'Attendee A', ticket_token: 'a'.repeat(64), checked_in_at: null,
    ticket_type_name: 'GA', session_name: null, session_starts_at: null, session_ends_at: null,
    ...overrides,
  }
}

describe('getPublicBookingDetail — unknown/invalid token', () => {
  it('an unknown booking token resolves to { ok: false } — no distinguishing detail', async () => {
    queue([])
    const result = await getPublicBookingDetail('not-a-real-token')
    expect(result.ok).toBe(false)
  })

  it('an empty/non-string token never reaches the database', async () => {
    const result = await getPublicBookingDetail('')
    expect(result.ok).toBe(false)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('getPublicBookingDetail — public field allow-list', () => {
  it('a valid booking token resolves the full booking detail', async () => {
    queue([ORDER_ROW], [attendeeRow()])
    const result = await getPublicBookingDetail('tok')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.purchaser_name).toBe('Jane Doe')
    expect(result.detail.event.name).toBe('Spring Gala')
    expect(result.detail.tickets).toHaveLength(1)
    expect(result.detail.tickets[0].attendee_name).toBe('Attendee A')
    expect(result.detail.tickets[0].ticket_token).toBe('a'.repeat(64))
  })

  it('never leaks organisation_id, order_id, order_item_id, attendee_id, purchaser email/phone, created_by, booking_token, Stripe ids, or CRM ids', async () => {
    queue([ORDER_ROW], [attendeeRow()])
    const result = await getPublicBookingDetail('tok')
    const serialised = JSON.stringify(result)
    expect(serialised).not.toMatch(/organisation_id|order_id|order_item_id|attendee_id|created_by/i)
    expect(serialised).not.toMatch(/purchaser_email|purchaser_phone/i)
    expect(serialised).not.toMatch(/booking_token/i)
    expect(serialised).not.toMatch(/stripe|crm/i)
  })

  it('never leaks registration answers or internal staff notes shapes', async () => {
    queue([ORDER_ROW], [attendeeRow()])
    const result = await getPublicBookingDetail('tok')
    const serialised = JSON.stringify(result)
    expect(serialised).not.toMatch(/answer|note/i)
  })
})

describe('getPublicBookingDetail — multi-ticket behaviour', () => {
  it('1 attendee', async () => {
    queue([ORDER_ROW], [attendeeRow({ attendee_name: 'Solo' })])
    const result = await getPublicBookingDetail('tok')
    expect(result.ok && result.detail.tickets).toHaveLength(1)
  })

  it('2 attendees, each with a distinct token', async () => {
    queue([ORDER_ROW], [
      attendeeRow({ attendee_name: 'A', ticket_token: 'a'.repeat(64) }),
      attendeeRow({ attendee_name: 'B', ticket_token: 'b'.repeat(64) }),
    ])
    const result = await getPublicBookingDetail('tok')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.tickets).toHaveLength(2)
    const tokens = result.detail.tickets.map(t => t.ticket_token)
    expect(new Set(tokens).size).toBe(2)
  })

  it('10+ attendees', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => attendeeRow({ attendee_name: `Attendee ${i}`, ticket_token: i.toString().padStart(64, '0') }))
    queue([ORDER_ROW], rows)
    const result = await getPublicBookingDetail('tok')
    expect(result.ok && result.detail.tickets).toHaveLength(12)
  })

  it('mixed ticket types across attendees', async () => {
    queue([ORDER_ROW], [
      attendeeRow({ attendee_name: 'A', ticket_token: 'a'.repeat(64), ticket_type_name: 'GA' }),
      attendeeRow({ attendee_name: 'B', ticket_token: 'b'.repeat(64), ticket_type_name: 'VIP' }),
    ])
    const result = await getPublicBookingDetail('tok')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.tickets.map(t => t.ticket_type_name)).toEqual(['GA', 'VIP'])
  })

  it('mixed sessions across attendees', async () => {
    queue([ORDER_ROW], [
      attendeeRow({ attendee_name: 'A', ticket_token: 'a'.repeat(64), session_name: 'Morning', session_starts_at: new Date('2026-12-01T09:00:00Z'), session_ends_at: new Date('2026-12-01T10:00:00Z') }),
      attendeeRow({ attendee_name: 'B', ticket_token: 'b'.repeat(64), session_name: 'Evening', session_starts_at: new Date('2026-12-01T18:00:00Z'), session_ends_at: new Date('2026-12-01T19:00:00Z') }),
    ])
    const result = await getPublicBookingDetail('tok')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.tickets[0].session?.name).toBe('Morning')
    expect(result.detail.tickets[1].session?.name).toBe('Evening')
  })

  it('an attendee row with no ticket_token yet is excluded from the returned tickets array', async () => {
    queue([ORDER_ROW], [
      attendeeRow({ attendee_name: 'Has token', ticket_token: 'a'.repeat(64) }),
      attendeeRow({ attendee_name: 'No token yet', ticket_token: null }),
    ])
    const result = await getPublicBookingDetail('tok')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.tickets).toHaveLength(1)
    expect(result.detail.tickets[0].attendee_name).toBe('Has token')
  })
})

describe('getPublicBookingDetail — status derivation (shared with /t/[token] and check-in)', () => {
  it('valid order + valid event -> every ticket VALID', async () => {
    queue([ORDER_ROW], [attendeeRow()])
    const result = await getPublicBookingDetail('tok')
    expect(result.ok && result.detail.tickets[0].status).toBe('VALID')
  })

  it('cancelled order -> every ticket CANCELLED, regardless of individual checked_in_at', async () => {
    queue([{ ...ORDER_ROW, order_status: 'CANCELLED' }], [attendeeRow(), attendeeRow({ attendee_name: 'B', ticket_token: 'b'.repeat(64) })])
    const result = await getPublicBookingDetail('tok')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.tickets.every(t => t.status === 'CANCELLED')).toBe(true)
  })

  it('refunded order (payment_status REFUNDED, order status CANCELLED) -> CANCELLED, same as manual cancellation', async () => {
    queue([{ ...ORDER_ROW, order_status: 'CANCELLED', payment_status: 'REFUNDED' }], [attendeeRow()])
    const result = await getPublicBookingDetail('tok')
    expect(result.ok && result.detail.tickets[0].status).toBe('CANCELLED')
  })

  it('event cancelled -> every ticket EVENT_CANCELLED, distinct from order-level CANCELLED', async () => {
    queue([{ ...ORDER_ROW, event_status: 'CANCELLED' }], [attendeeRow()])
    const result = await getPublicBookingDetail('tok')
    expect(result.ok && result.detail.tickets[0].status).toBe('EVENT_CANCELLED')
  })

  it('a checked-in attendee in a valid order still reports VALID at the ticket level with checked_in_at set — the wallet never invents an order-level "checked in" status', async () => {
    queue([ORDER_ROW], [attendeeRow({ checked_in_at: new Date('2026-12-01T10:05:00Z') })])
    const result = await getPublicBookingDetail('tok')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.tickets[0].status).toBe('VALID')
    expect(result.detail.tickets[0].checked_in_at).toBeTruthy()
  })
})

describe('getPublicBookingDetail — cross-token isolation', () => {
  it('never queries event_attendees.ticket_token — this function only ever looks up by booking_token (event_orders), never resolves an attendee ticket token', () => {
    const code = stripComments(read('lib/events/publicBooking.ts'))
    expect(code).not.toMatch(/ea\.ticket_token\s*=\s*\$\{/)
    expect(code).toMatch(/eo\.booking_token\s*=\s*\$\{bookingToken\}/)
  })

  it('getPublicTicketDetail (the individual /t/[token] resolver) never accepts or references a booking_token', () => {
    const code = stripComments(read('lib/events/publicTicket.ts'))
    expect(code).not.toMatch(/booking_token/i)
  })
})

describe('Booking wallet — architecture containment', () => {
  const source = stripComments(read('lib/events/publicBooking.ts'))

  it('never uses SELECT * — every query has an explicit column list', () => {
    expect(source).not.toMatch(/SELECT \*/i)
  })

  it('organisation_id used to scope the second (attendee) query comes from the already-resolved order row, never from any external input', () => {
    expect(source).toMatch(/ea\.organisation_id = \$\{order\.organisation_id\}/)
  })
})
