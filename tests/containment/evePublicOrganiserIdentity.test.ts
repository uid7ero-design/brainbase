import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { LifecycleEmailData } from '@/lib/events/lifecycleEmail'

// Eve public organiser identity (v1): Eve buyer surfaces show only the
// organisation's configured public display name (settings.branding.name) —
// never organisations.name. With none configured: no organiser line, and
// "the event organiser" in wording. BrainBase / LD Tennis behaviour unchanged.

process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'
process.env.EVE_PUBLIC_BASE_URL = 'https://eve.example'

vi.mock('@/lib/db', () => ({
  default: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join('?').includes('INSERT INTO ticketing_rate_limits')) return [{ count: 1, key: values[0] }]
    return []
  },
}))
const publicSvc = { getPublicEventDetail: vi.fn(), getPublicTicketDetail: vi.fn(), getPublicBookingDetail: vi.fn(), generateTicketQrSvg: vi.fn() }
vi.mock('@/lib/events/publicEventDetail', () => ({ getPublicEventDetail: (...a: unknown[]) => publicSvc.getPublicEventDetail(...a) }))
vi.mock('@/lib/events/publicTicket', () => ({ getPublicTicketDetail: (...a: unknown[]) => publicSvc.getPublicTicketDetail(...a) }))
vi.mock('@/lib/events/publicBooking', () => ({ getPublicBookingDetail: (...a: unknown[]) => publicSvc.getPublicBookingDetail(...a) }))
vi.mock('@/lib/events/qr', async orig => ({ ...(await orig<object>()), generateTicketQrSvg: (...a: unknown[]) => publicSvc.generateTicketQrSvg(...a) }))

const pub = await import('@/lib/ticketing/publicApi')
const { buildLifecycleEmail } = await import('@/lib/events/lifecycleEmail')
const { buildTicketEmail } = await import('@/lib/events/ticketEmail')
const { resolveBuyerProduct, brainbaseBuyerContext } = await import('@/lib/events/buyerProduct')
const { normalisePublicOrganisationBranding } = await import('@/lib/organisations/branding')
const { NOTIFICATION_TYPES } = await import('@/lib/events/notifications')

const INTERNAL = 'Brainbase Internal Pty Ltd'
const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }
const gated = () => new Request('http://bb.test/x', { headers: { ...GATE, 'x-ticketing-client-ip': '198.51.100.20' } })
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const branding = (name: string | null) => ({ name, logoUrl: null, accentColor: null, website: null })

beforeEach(() => { for (const f of Object.values(publicSvc)) f.mockReset() })
afterEach(() => { vi.unstubAllEnvs() })

describe('Eve public ticketing responses never carry organisations.name', () => {
  const EVENT_DETAIL = (b: ReturnType<typeof branding>) => ({
    event: { name: 'E', slug: 'e' }, sessions: [], ticket_types: [], session_inventory: [], has_promotions: false,
    questions: [], branding: b, organisationName: INTERNAL,
  })
  const TICKET_DETAIL = (b: ReturnType<typeof branding>) => ({ attendee_name: 'Al', status: 'VALID', checked_in_at: null, event: { name: 'E' }, branding: b, organisationName: INTERNAL })
  const BOOKING_DETAIL = (b: ReturnType<typeof branding>) => ({ purchaser_name: 'Sam', event: { name: 'E' }, tickets: [], branding: b, organisationName: INTERNAL })

  async function all(b: ReturnType<typeof branding>) {
    publicSvc.getPublicEventDetail.mockResolvedValue({ ok: true, detail: EVENT_DETAIL(b), eveQuestionsEnabled: false })
    publicSvc.getPublicTicketDetail.mockResolvedValue({ ok: true, detail: TICKET_DETAIL(b) })
    publicSvc.getPublicBookingDetail.mockResolvedValue({ ok: true, detail: BOOKING_DETAIL(b) })
    publicSvc.generateTicketQrSvg.mockResolvedValue('<svg/>')
    const responses = [
      await pub.handleTicketingPublicEvent(gated(), { organisationSlug: 'brainbase', eventSlug: 'e' }),
      await pub.handleTicketingTicket(gated(), 'tkn_abcdefghijklmnop'),
      await pub.handleTicketingBooking(gated(), 'bk_abcdefghijklmnop'),
    ]
    return Promise.all(responses.map(async r => ({ status: r.status, raw: await r.text() })))
  }

  it('no display name: organiser_name is null and the internal name is absent from the raw JSON (event, ticket, booking)', async () => {
    for (const r of await all(branding(null))) {
      expect(r.status).toBe(200)
      expect(r.raw).not.toContain(INTERNAL)
      expect(r.raw).not.toContain('organisationName')
      expect(JSON.parse(r.raw).organiser_name).toBeNull()
    }
  })

  it('configured display name: returned as organiser_name (trimmed); still no internal name', async () => {
    for (const r of await all(branding('  Riverlights Collective '))) {
      expect(r.raw).not.toContain(INTERNAL)
      expect(JSON.parse(r.raw).organiser_name).toBe('Riverlights Collective')
    }
  })

  it('the public branding allowlist is unchanged (no email / phone / footer leaks)', () => {
    const b = normalisePublicOrganisationBranding({ branding: { name: 'X', email: 'ops@x.test', phone: '0400 000 000', emailFooter: 'f', website: 'https://x.test' } }, INTERNAL)
    expect(Object.keys(b).sort()).toEqual(['accentColor', 'logoUrl', 'name', 'website'])
  })

  it('only the Eve-facing handlers strip the name; the shared readers BrainBase pages use are not modified', () => {
    const src = read('lib/ticketing/publicApi.ts')
    expect(src.match(/withPublicOrganiser\(/g)).toHaveLength(3) // event, ticket, booking
    for (const f of ['lib/events/publicEventDetail.ts', 'lib/events/publicTicket.ts', 'lib/events/publicBooking.ts']) {
      expect(read(f), f).toMatch(/organisationName/)
    }
  })
})

function eveContext() {
  vi.stubEnv('EVE_PUBLIC_BASE_URL', 'https://eve-preview.vercel.app')
  vi.stubEnv('EVE_EMAIL_FROM', 'Eve <tickets@mail.eve-preview.dev>')
  vi.stubEnv('EVE_SUPPORT_EMAIL', 'support@eve-preview.dev')
  const r = resolveBuyerProduct('EVE')
  if (!r.ok) throw new Error('expected an Eve context')
  return r.context
}

const LIFE: Omit<LifecycleEmailData, 'type'> = {
  orderReference: 'ord-1', purchaserName: 'Sam', eventName: 'Gala',
  eventStartsAt: '2030-01-01T10:00:00Z', eventEndsAt: '2030-01-01T12:00:00Z', eventTimezone: 'Australia/Adelaide',
  venue: null, description: null, orderStatus: 'CONFIRMED', paymentStatus: 'PAID', currency: 'AUD',
  totalCents: 2500, paymentTotalCents: 2500, platformFeeCents: 0, feeMode: null, feeLabel: null,
  refundedCents: 2500, platformFeeRefundedCents: 0, paidAt: '2029-12-01T00:00:00Z', refundedAt: '2029-12-02T00:00:00Z',
  attendees: [{ name: 'A', ticketToken: 'a'.repeat(48), sessionName: null }], bookingToken: 'w'.repeat(48),
  branding: { name: null, logoUrl: null, website: null, accentColor: null, emailFooter: null, supportEmail: null, supportPhone: null },
  organisationName: INTERNAL,
  change: { before: { starts_at: '2029-12-25T10:00:00Z', ends_at: '2029-12-25T12:00:00Z', venue: null }, after: { starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', venue: null }, change_version: 'v1' },
}

describe('Eve lifecycle emails', () => {
  it('no display name: "the event organiser", never the internal name, in every lifecycle type', () => {
    const ctx = eveContext()
    for (const type of NOTIFICATION_TYPES) {
      const e = buildLifecycleEmail({ ...LIFE, type, product: ctx })
      expect(e.html + e.text + e.subject, type).not.toContain(INTERNAL)
      expect(e.text, type).toContain('Questions about this order? Contact the event organiser.')
    }
    expect(buildLifecycleEmail({ ...LIFE, type: 'EVENT_CANCELLED', product: ctx }).text).toContain('The event organiser has cancelled Gala.')
    expect(buildLifecycleEmail({ ...LIFE, type: 'EVENT_UPDATED', product: ctx }).text).toContain('The event organiser has changed the date, time or venue of Gala.')
  })

  it('configured display name is used (trimmed)', () => {
    const ctx = eveContext()
    const b = { ...LIFE.branding, name: '  Riverlights Collective ' }
    const cancelled = buildLifecycleEmail({ ...LIFE, type: 'EVENT_CANCELLED', branding: b, product: ctx })
    expect(cancelled.text).toContain('Riverlights Collective has cancelled Gala.')
    expect(cancelled.text).toContain('Contact Riverlights Collective.')
    expect(cancelled.html + cancelled.text).not.toContain(INTERNAL)
  })

  it('configured organiser contact details are still shown (unchanged behaviour)', () => {
    const b = { ...LIFE.branding, supportEmail: 'help@riverlights.test' }
    expect(buildLifecycleEmail({ ...LIFE, type: 'ORDER_REFUNDED', branding: b, product: eveContext() }).text)
      .toContain('Contact the event organiser — help@riverlights.test.')
  })

  it('Eve ticket email keeps its no-fallback behaviour: no display name, no internal name', () => {
    const { html } = buildTicketEmail({ eventName: 'Gala', purchaserName: 'Sam', attendees: [{ name: 'A', ticketToken: 'a'.repeat(48) }], product: eveContext(), branding: null })
    expect(html).not.toContain(INTERNAL)
  })
})

describe('BrainBase / LD Tennis unchanged', () => {
  it('BrainBase lifecycle emails still fall back to the organisation name (no product, or explicit BrainBase)', () => {
    for (const product of [undefined, brainbaseBuyerContext()]) {
      const e = buildLifecycleEmail({ ...LIFE, type: 'EVENT_CANCELLED', product })
      expect(e.text).toContain(`${INTERNAL} has cancelled Gala.`)
      expect(e.text).toContain(`Contact ${INTERNAL}.`)
      expect(e.text).not.toContain('the event organiser')
    }
  })

  it('LD Tennis branding name is used exactly as before', () => {
    const b = { ...LIFE.branding, name: 'LD Tennis' }
    const e = buildLifecycleEmail({ ...LIFE, type: 'EVENT_UPDATED', branding: b, organisationName: 'LD Tennis' })
    expect(e.text).toContain('LD Tennis has changed the date, time or venue of Gala.')
  })

  it('no payment, Stripe, receipt, invoice or branding-validation code is touched by the helper', () => {
    for (const f of ['lib/events/stripe.ts', 'lib/events/receipt.ts', 'lib/organisations/branding.ts', 'lib/events/services/paidCheckout.ts']) {
      expect(read(f), f).not.toMatch(/publicOrganiser|organiserReference/)
    }
  })
})
