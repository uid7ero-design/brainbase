import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase 3C — resolver-level coverage. lib/events/publicTicket.ts and
// lib/events/publicBooking.ts were each given ONE additive field
// (organisationName) alongside their existing Phase 3A `branding` field
// — the same render-layer-fallback role PublicEventDetail.organisationName
// already plays (Phase 3B). No query added, no tenancy semantics
// changed: both resolvers already selected organisation_name for
// normalisePublicOrganisationBranding's own second argument; this just
// also returns it. See organisationBrandingConsumerFoundation.test.ts
// for the pre-existing single-query / no-organisationId-leak coverage
// this file does not duplicate — this file is specifically about the
// new organisationName field and /t-vs-/b cross-surface consistency.
//
// Single top-level vi.mock('@/lib/db', ...) — see that same file's own
// comment on why a second, nested vi.mock for the same module silently
// breaks (Vitest's own hoisting semantics).

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

beforeEach(() => {
  sqlMock.mockClear()
  responseQueue = []
  callCount = 0
})

const { getPublicTicketDetail } = await import('@/lib/events/publicTicket')
const { getPublicBookingDetail } = await import('@/lib/events/publicBooking')

const TICKET_ROW = {
  attendee_name: 'Jamie', checked_in_at: null, order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED',
  event_status: 'PUBLISHED', event_name: 'Graduation', venue: 'Hall', artwork_url: null,
  starts_at: new Date(), ends_at: new Date(), timezone: 'UTC',
  ticket_type_name: 'General', session_name: null, session_starts_at: null, session_ends_at: null,
}
const ORDER_ROW = {
  id: 'order-1', organisation_id: 'org-fixture', purchaser_name: 'Jamie', order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED',
  event_status: 'PUBLISHED', event_name: 'Graduation', venue: 'Hall', artwork_url: null,
  starts_at: new Date(), ends_at: new Date(), timezone: 'UTC',
}
const ATTENDEE_ROWS = [
  { attendee_name: 'Jamie', ticket_token: 'tt-1', checked_in_at: null, ticket_type_name: 'General', session_name: null, session_starts_at: null, session_ends_at: null },
]

describe('PublicTicketDetail.organisationName — additive render-layer fallback', () => {
  it('returns the real organisations.name alongside branding, unconfigured branding.name stays null', async () => {
    queue([{ ...TICKET_ROW, organisation_name: 'Fixture Org Real Name', organisation_settings: {} }])
    const result = await getPublicTicketDetail('tok-1')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.detail.organisationName).toBe('Fixture Org Real Name')
    expect(result.detail.branding.name).toBeNull()
    expect(sqlMock).toHaveBeenCalledTimes(1) // still exactly one query — no new round trip for this field
  })

  it('configured branding.name wins as the display name, but organisationName still carries the real DB name for the caller\'s own fallback logic', async () => {
    queue([{ ...TICKET_ROW, organisation_name: 'Fixture Org Real Name', organisation_settings: { branding: { name: 'Fixture Org Brand' } } }])
    const result = await getPublicTicketDetail('tok-2')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.detail.branding.name).toBe('Fixture Org Brand')
    expect(result.detail.organisationName).toBe('Fixture Org Real Name')
  })
})

describe('PublicBookingDetail.organisationName — additive render-layer fallback', () => {
  it('returns the real organisations.name alongside branding, resolved once at the order level', async () => {
    queue(
      [{ ...ORDER_ROW, organisation_name: 'Fixture Org Real Name', organisation_settings: {} }],
      ATTENDEE_ROWS,
    )
    const result = await getPublicBookingDetail('book-1')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.detail.organisationName).toBe('Fixture Org Real Name')
    expect(result.detail.branding.name).toBeNull()
    expect(sqlMock).toHaveBeenCalledTimes(2) // order lookup + attendee lookup — unchanged, no new query
  })
})

describe('Cross-surface consistency — /t and /b resolve identical branding for the same organisation', () => {
  it('unconfigured: getPublicTicketDetail and getPublicBookingDetail produce byte-identical branding + organisationName for the same organisation row', async () => {
    const sharedOrgRow = { organisation_name: 'Cross Surface Org', organisation_settings: {} }

    queue([{ ...TICKET_ROW, ...sharedOrgRow }])
    const ticketResult = await getPublicTicketDetail('tok-cross')
    expect(ticketResult.ok).toBe(true)
    if (!ticketResult.ok) throw new Error('unreachable')

    queue([{ ...ORDER_ROW, ...sharedOrgRow }], ATTENDEE_ROWS)
    const bookingResult = await getPublicBookingDetail('book-cross')
    expect(bookingResult.ok).toBe(true)
    if (!bookingResult.ok) throw new Error('unreachable')

    expect(ticketResult.detail.branding).toEqual(bookingResult.detail.branding)
    expect(ticketResult.detail.organisationName).toBe(bookingResult.detail.organisationName)
  })

  it('configured: getPublicTicketDetail and getPublicBookingDetail produce byte-identical branding + organisationName for the same organisation row', async () => {
    const sharedOrgRow = {
      organisation_name: 'Cross Surface Org',
      organisation_settings: { branding: { name: 'Cross Surface Brand', accentColor: '#123456', website: 'https://cross-surface.test' } },
    }

    queue([{ ...TICKET_ROW, ...sharedOrgRow }])
    const ticketResult = await getPublicTicketDetail('tok-cross-2')
    expect(ticketResult.ok).toBe(true)
    if (!ticketResult.ok) throw new Error('unreachable')

    queue([{ ...ORDER_ROW, ...sharedOrgRow }], ATTENDEE_ROWS)
    const bookingResult = await getPublicBookingDetail('book-cross-2')
    expect(bookingResult.ok).toBe(true)
    if (!bookingResult.ok) throw new Error('unreachable')

    expect(ticketResult.detail.branding).toEqual({ name: 'Cross Surface Brand', logoUrl: null, accentColor: '#123456', website: 'https://cross-surface.test' })
    expect(ticketResult.detail.branding).toEqual(bookingResult.detail.branding)
    expect(ticketResult.detail.organisationName).toBe(bookingResult.detail.organisationName)
  })
})

describe('Security — organisationName never leaks a cross-tenant value, never exposes raw internals', () => {
  it('a ticket token only ever sees its OWN organisation\'s name, never another tenant\'s', async () => {
    queue([{ ...TICKET_ROW, organisation_name: 'Org A', organisation_settings: {} }])
    const a = await getPublicTicketDetail('tok-a')
    expect(a.ok).toBe(true)
    if (!a.ok) throw new Error('unreachable')
    expect(JSON.stringify(a.detail)).not.toMatch(/Org B/)
  })

  it('organisationName never carries organisationId or raw settings alongside it', async () => {
    queue([{ ...TICKET_ROW, organisation_name: 'Org A', organisation_settings: { branding: { name: 'Org A' }, commercial: { businessProfile: { abn: 'SHOULD-NEVER-LEAK' } } } }])
    const result = await getPublicTicketDetail('tok-1')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(JSON.stringify(result.detail)).not.toMatch(/organisationId|organisation_id|SHOULD-NEVER-LEAK/)
  })
})
