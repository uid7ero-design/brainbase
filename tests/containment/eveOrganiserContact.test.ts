import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { LifecycleEmailData } from '@/lib/events/lifecycleEmail'

// Eve organiser contact v1: Eve buyers may see ONLY the organiser's public
// display name, branding.publicEmail and branding.website. The private
// branding.email / phone / address / ABN / footer / sender name and the
// internal organisations.name never reach an Eve public response or a
// rendered Eve surface, and there is no fallback to any of them. BrainBase /
// LD Tennis pages and emails are unchanged.
//
// The gateway tests below run the REAL public readers (event, ticket, booking)
// over a mocked database holding an organisation whose settings carry every
// private field, so a leak anywhere between the row and the JSON would show.

process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'
process.env.EVE_PUBLIC_BASE_URL = 'https://eve.example'

const INTERNAL = 'Internal Holdings Pty Ltd'
const PRIVATE = {
  email: 'private-ops@internal.example',
  phone: '08 8123 4567',
  address: '99 Secret Street, Adelaide SA 5000',
  abn: '51 824 753 556',
  emailFooter: 'Private footer text',
  emailSenderName: 'Private Sender Name',
}
const PRIVATE_VALUES = [INTERNAL, ...Object.values(PRIVATE)]

let orgSettings: unknown = {}
const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const q = strings.join('?')
  if (q.includes('INSERT INTO ticketing_rate_limits')) return [{ count: 1, key: values[0] }]
  // Eve-enabled organisation (Eve organiser allow-list): these tests are about
  // what an Eve response carries, so the organisation must be on Eve.
  if (q.includes('FROM organisations WHERE slug')) return [{ id: 'org-a', name: INTERNAL, settings: { ...(orgSettings as object), events: { eveEnabled: true } } }]
  if (/FROM events\b/.test(q) && q.includes("status = 'PUBLISHED'")) {
    return [{ id: 'ev-1', organisation_id: 'org-a', name: 'Gala', slug: 'gala', description: null, venue: 'Hall', artwork_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', timezone: 'Australia/Adelaide', eve_questions_enabled: false }]
  }
  if (q.includes('WHERE ea.ticket_token')) {
    return [{ attendee_name: 'Al', checked_in_at: null, order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED', event_status: 'PUBLISHED', event_name: 'Gala', venue: 'Hall', artwork_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', timezone: 'Australia/Adelaide', ticket_type_name: 'GA', session_name: null, session_starts_at: null, session_ends_at: null, organisation_name: INTERNAL, organisation_settings: orgSettings }]
  }
  if (q.includes('WHERE eo.booking_token')) {
    return [{ id: 'ord-1', organisation_id: 'org-a', purchaser_name: 'Sam', order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED', event_status: 'PUBLISHED', event_name: 'Gala', venue: 'Hall', artwork_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', timezone: 'Australia/Adelaide', organisation_name: INTERNAL, organisation_settings: orgSettings }]
  }
  return []
})
vi.mock('@/lib/db', () => ({ default: (...a: Parameters<typeof db>) => db(...a) }))
vi.mock('@/lib/capabilities/requireCapability', async orig => ({ ...(await orig<object>()), checkCapability: async () => ({ allowed: true }) }))
vi.mock('@/lib/events/qr', async orig => ({ ...(await orig<object>()), generateTicketQrSvg: async () => '<svg/>' }))

const pub = await import('@/lib/ticketing/publicApi')
const bbEventRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/route')
const { getPublicBookingDetail } = await import('@/lib/events/publicBooking')
const { buildLifecycleEmail } = await import('@/lib/events/lifecycleEmail')
const { buildTicketEmail } = await import('@/lib/events/ticketEmail')
const { resolveBuyerProduct, brainbaseBuyerContext } = await import('@/lib/events/buyerProduct')
const brandingMod = await import('@/lib/organisations/branding')
const { brandingView } = await import('@/lib/events/organiserSettings')
const { NOTIFICATION_TYPES } = await import('@/lib/events/notifications')

const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }
const gated = () => new Request('http://bb.test/x', { headers: { ...GATE, 'x-ticketing-client-ip': '198.51.100.20' } })
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const settings = (b: Record<string, unknown>) => ({ branding: { ...PRIVATE, ...b }, commercial: { businessProfile: { tradingName: 'Commercial Secret' } } })

function expectNoPrivate(raw: string, label: string) {
  for (const v of [...PRIVATE_VALUES, 'Commercial Secret']) expect(raw, `${label}: ${v}`).not.toContain(v)
  for (const k of ['publicEmail', 'supportEmail', 'supportPhone', 'emailFooter', 'emailSenderName', '"abn"', '"address"', '"phone"', 'organisationName', 'organisation_id', 'organisationId']) {
    expect(raw, `${label}: key ${k}`).not.toContain(k)
  }
}

async function eveResponses() {
  const event = await pub.handleTicketingPublicEvent(gated(), { organisationSlug: 'acme', eventSlug: 'gala' })
  const ticket = await pub.handleTicketingTicket(gated(), 'tkn_abcdefghijklmnop')
  const booking = await pub.handleTicketingBooking(gated(), 'bk_abcdefghijklmnop')
  return { event: await event.text(), ticket: await ticket.text(), booking: await booking.text(), statuses: [event.status, ticket.status, booking.status] }
}

beforeEach(() => { orgSettings = {}; db.mockClear() })
afterEach(() => { vi.unstubAllEnvs() })

describe('branding model: publicEmail is a separate, opt-in field', () => {
  it('normalised like the other emails (trimmed, lower-cased, invalid -> null)', () => {
    expect(brandingMod.normaliseOrganisationBranding({ branding: { publicEmail: '  Tickets@Acme.EXAMPLE ' } }, 'X').branding.publicEmail).toBe('tickets@acme.example')
    for (const bad of ['nope', '   ', '', 7, null]) {
      expect(brandingMod.normaliseOrganisationBranding({ branding: { publicEmail: bad } }, 'X').branding.publicEmail).toBeNull()
    }
  })

  it('never falls back to the private email', () => {
    expect(brandingMod.normaliseOrganisationBranding({ branding: { email: 'ops@acme.example' } }, 'X').branding.publicEmail).toBeNull()
    expect(brandingMod.normaliseEveOrganiserContact({ branding: { email: 'ops@acme.example', phone: '0400' } })).toBeNull()
  })

  it('the shared public / ticket-email / lifecycle projections are unchanged (publicEmail is not added to BrainBase surfaces)', () => {
    const raw = settings({ name: 'Acme', publicEmail: 'tickets@acme.example', website: 'https://acme.example' })
    expect(Object.keys(brandingMod.normalisePublicOrganisationBranding(raw, INTERNAL)).sort()).toEqual(['accentColor', 'logoUrl', 'name', 'website'])
    expect(Object.keys(brandingMod.normaliseTicketEmailBranding(raw, INTERNAL)).sort()).toEqual(['accentColor', 'emailFooter', 'logoUrl', 'name', 'website'])
    expect(Object.keys(brandingMod.normaliseLifecycleEmailBranding(raw, INTERNAL)).sort()).toEqual(['accentColor', 'emailFooter', 'logoUrl', 'name', 'supportEmail', 'supportPhone', 'website'])
  })
})

describe('normaliseEveOrganiserContact: explicit two-field allowlist', () => {
  it.each([
    ['nothing configured', {}, null],
    ['only private fields configured', settings({}), null],
    ['public email only', settings({ publicEmail: 'tickets@acme.example' }), { email: 'tickets@acme.example', website: null }],
    ['website only', settings({ website: 'https://acme.example' }), { email: null, website: 'https://acme.example' }],
    ['both', settings({ publicEmail: 'tickets@acme.example', website: 'https://acme.example' }), { email: 'tickets@acme.example', website: 'https://acme.example' }],
    ['whitespace values', settings({ publicEmail: '   ', website: '  ' }), null],
    ['invalid email + unsafe website', settings({ publicEmail: 'not-an-email', website: 'javascript:alert(1)' }), null],
  ])('%s', (_l, raw, expected) => {
    expect(brandingMod.normaliseEveOrganiserContact(raw)).toEqual(expected)
  })

  it('is built field by field from the allowlist, never by serialising or spreading the branding object', () => {
    const src = read('lib/organisations/branding.ts')
    const fn = src.slice(src.indexOf('export function normaliseEveOrganiserContact'))
    expect(fn).toContain('publicOrganiserContact({ publicEmail: branding.publicEmail, website: branding.website })')
    expect(fn).not.toMatch(/\.\.\.branding|JSON\.|delete /)
    expect(read('packages/ticketing/src/publicOrganiser.ts')).toMatch(/return email \|\| website \? \{ email, website \} : null;/)
  })
})

describe('Eve public gateway responses (real readers): organiser_contact and no private leaks', () => {
  it('no public contact configured: organiser_contact is null on event and booking; no private value anywhere', async () => {
    orgSettings = settings({})
    const r = await eveResponses()
    expect(r.statuses).toEqual([200, 200, 200])
    expect(JSON.parse(r.event).organiser_contact).toBeNull()
    expect(JSON.parse(r.booking).organiser_contact).toBeNull()
    for (const [k, raw] of Object.entries({ event: r.event, ticket: r.ticket, booking: r.booking })) expectNoPrivate(raw, k)
  })

  it.each([
    ['public email only', { publicEmail: 'Tickets@Acme.example' }, { email: 'tickets@acme.example', website: null }],
    ['website only', { website: 'https://acme.example' }, { email: null, website: 'https://acme.example' }],
    ['both', { publicEmail: 'tickets@acme.example', website: 'https://acme.example' }, { email: 'tickets@acme.example', website: 'https://acme.example' }],
  ])('%s: exact shape { email, website }; private fields and internal name never present', async (_l, b, expected) => {
    orgSettings = settings({ name: 'Acme Presents', ...b })
    const r = await eveResponses()
    for (const raw of [r.event, r.booking]) {
      const body = JSON.parse(raw)
      expect(body.organiser_contact).toEqual(expected)
      expect(Object.keys(body.organiser_contact).sort()).toEqual(['email', 'website'])
      expect(body.organiser_name).toBe('Acme Presents')
    }
    for (const [k, raw] of Object.entries({ event: r.event, ticket: r.ticket, booking: r.booking })) expectNoPrivate(raw, k)
  })

  it('the /t door ticket response carries no organiser_contact (not a v1 surface)', async () => {
    orgSettings = settings({ publicEmail: 'tickets@acme.example', website: 'https://acme.example' })
    const r = await eveResponses()
    expect(JSON.parse(r.ticket)).not.toHaveProperty('organiser_contact')
    expect(r.ticket).not.toContain('tickets@acme.example')
  })

  it('tenant isolation: the contact comes from the organisation the token / slug resolved to, never from request input', async () => {
    orgSettings = settings({ publicEmail: 'tickets@acme.example' })
    const req = new Request('http://bb.test/x?organisationId=org-b&publicEmail=evil@x.example', { headers: { ...GATE, 'x-ticketing-client-ip': '198.51.100.20' } })
    const raw = await (await pub.handleTicketingPublicEvent(req, { organisationSlug: 'acme', eventSlug: 'gala' })).text()
    expect(JSON.parse(raw).organiser_contact).toEqual({ email: 'tickets@acme.example', website: null })
    expect(raw).not.toContain('evil@x.example')
    const bookingSql = db.mock.calls.map(c => (c[0] as TemplateStringsArray).join('?'))
    expect(bookingSql.some(q => q.includes('FROM organisations WHERE slug'))).toBe(true)
  })
})

describe('BrainBase public surfaces unchanged', () => {
  it('the BrainBase public event API body has no organiser_contact and no publicEmail', async () => {
    orgSettings = settings({ name: 'Acme Presents', publicEmail: 'tickets@acme.example', website: 'https://acme.example' })
    const res = await bbEventRoute.GET(new Request('http://bb.test/x'), { params: Promise.resolve({ organisationSlug: 'acme', eventSlug: 'gala' }) })
    const raw = await res.text()
    expect(res.status).toBe(200)
    expect(raw).not.toContain('organiser_contact')
    expect(raw).not.toContain('tickets@acme.example')
    expect(raw).not.toContain('publicEmail')
    expect(JSON.parse(raw).branding).toEqual({ name: 'Acme Presents', logoUrl: null, accentColor: null, website: 'https://acme.example' })
  })

  it('the BrainBase wallet reads only result.detail, which carries no contact', async () => {
    orgSettings = settings({ publicEmail: 'tickets@acme.example' })
    const result = await getPublicBookingDetail('bk_abcdefghijklmnop')
    expect(result.ok && JSON.stringify(result.detail)).not.toContain('tickets@acme.example')
    for (const f of ['app/b/[bookingToken]/tickets/page.tsx', 'app/e/[organisationSlug]/[eventSlug]/page.tsx', 'app/t/[token]/page.tsx', 'app/api/public/events/[organisationSlug]/[eventSlug]/route.ts']) {
      expect(read(f), f).not.toMatch(/eveOrganiserContact|organiser_contact|publicEmail/)
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

const TICKET_BASE = { eventName: 'Gala', purchaserName: 'Sam', attendees: [{ name: 'A', ticketToken: 'a'.repeat(48) }], bookingToken: null }
const EMAIL_BRANDING = (name: string | null) => ({ name, logoUrl: null, accentColor: null, website: null, emailFooter: null })

describe('Eve ticket email', () => {
  it('no public contact: no organiser contact line', () => {
    const { html } = buildTicketEmail({ ...TICKET_BASE, product: eveContext(), branding: EMAIL_BRANDING(null), organiserContact: null })
    expect(html).not.toContain('Questions about this event?')
    expect(html).not.toContain('data-organiser-contact')
  })

  it('public email and website: one line, neutral name when none is configured; Eve support stays in the footer', () => {
    const { html } = buildTicketEmail({ ...TICKET_BASE, product: eveContext(), branding: EMAIL_BRANDING(null), organiserContact: { email: 'tickets@acme.example', website: 'https://acme.example/' } })
    expect(html).toContain('Questions about this event? Contact <strong>the event organiser</strong>: <a href="mailto:tickets@acme.example" style="color:#555">tickets@acme.example</a> · <a href="https://acme.example/" style="color:#555">acme.example</a>')
    expect(html).toContain('mailto:support@eve-preview.dev')
    expect(html.indexOf('data-organiser-contact')).toBeLessThan(html.indexOf('mailto:support@eve-preview.dev'))
  })

  it('configured display name; email only / website only', () => {
    const ctx = eveContext()
    const emailOnly = buildTicketEmail({ ...TICKET_BASE, product: ctx, branding: EMAIL_BRANDING('Acme Presents'), organiserContact: { email: 'tickets@acme.example', website: null } }).html
    expect(emailOnly).toContain('Contact <strong>Acme Presents</strong>: <a href="mailto:tickets@acme.example"')
    const siteOnly = buildTicketEmail({ ...TICKET_BASE, product: ctx, branding: EMAIL_BRANDING('Acme Presents'), organiserContact: { email: null, website: 'https://acme.example' } }).html
    expect(siteOnly).toContain('Contact <strong>Acme Presents</strong>: <a href="https://acme.example"')
    expect(siteOnly).not.toContain('mailto:null')
  })

  it('HTML is escaped and unsafe values are dropped even if handed in directly', () => {
    const ctx = eveContext()
    const html = buildTicketEmail({ ...TICKET_BASE, product: ctx, branding: EMAIL_BRANDING('<b>Acme & Co</b>'), organiserContact: { email: 'tickets@acme.example', website: 'https://acme.example/?q="><script>x</script>' } }).html
    expect(html).toContain('&lt;b&gt;Acme &amp; Co&lt;/b&gt;')
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
    const unsafe = buildTicketEmail({ ...TICKET_BASE, product: ctx, branding: EMAIL_BRANDING(null), organiserContact: { email: 'bad', website: 'javascript:alert(1)' } }).html
    expect(unsafe).not.toContain('data-organiser-contact')
    expect(unsafe).not.toContain('javascript:')
  })

  it('BrainBase ticket email never shows it (byte-identical with or without a contact)', () => {
    for (const product of [undefined, brainbaseBuyerContext()]) {
      const without = buildTicketEmail({ ...TICKET_BASE, product, branding: EMAIL_BRANDING('LD Tennis') }).html
      const withContact = buildTicketEmail({ ...TICKET_BASE, product, branding: EMAIL_BRANDING('LD Tennis'), organiserContact: { email: 'tickets@acme.example', website: 'https://acme.example' } }).html
      expect(withContact).toBe(without)
    }
  })

  it('both ticket-email senders pass the Eve contact from the same organisation row they already read', () => {
    expect(read('lib/events/ticketEmailDelivery.ts')).toContain('organiserContact: normaliseEveOrganiserContact(order.organisationSettings)')
    expect(read('app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts')).toContain('organiserContact: normaliseEveOrganiserContact(order.organisation_settings)')
  })
})

const LIFE: Omit<LifecycleEmailData, 'type'> = {
  orderReference: 'ord-1', purchaserName: 'Sam', eventName: 'Gala',
  eventStartsAt: '2030-01-01T10:00:00Z', eventEndsAt: '2030-01-01T12:00:00Z', eventTimezone: 'Australia/Adelaide',
  venue: null, description: null, orderStatus: 'CONFIRMED', paymentStatus: 'PAID', currency: 'AUD',
  totalCents: 2500, paymentTotalCents: 2500, platformFeeCents: 0, feeMode: null, feeLabel: null,
  refundedCents: 2500, platformFeeRefundedCents: 0, paidAt: '2029-12-01T00:00:00Z', refundedAt: '2029-12-02T00:00:00Z',
  attendees: [{ name: 'A', ticketToken: 'a'.repeat(48), sessionName: null }], bookingToken: 'w'.repeat(48),
  // Private support contact configured: Eve must never show it.
  branding: { name: null, logoUrl: null, website: null, accentColor: null, emailFooter: null, supportEmail: PRIVATE.email, supportPhone: PRIVATE.phone },
  organisationName: INTERNAL,
  change: { before: { starts_at: '2029-12-25T10:00:00Z', ends_at: '2029-12-25T12:00:00Z', venue: null }, after: { starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', venue: null }, change_version: 'v1' },
}

describe('Eve lifecycle emails (every type)', () => {
  it('no public contact: no contact line, and the private email/phone and internal name never appear', () => {
    const ctx = eveContext()
    for (const type of NOTIFICATION_TYPES) {
      const e = buildLifecycleEmail({ ...LIFE, type, product: ctx, organiserContact: null })
      const all = e.html + e.text + e.subject
      expect(all, type).not.toMatch(/Questions about this (order|event)\?/)
      for (const v of [PRIVATE.email, PRIVATE.phone, INTERNAL]) expect(all, `${type}: ${v}`).not.toContain(v)
      expect(e.html, type).toContain('mailto:support@eve-preview.dev')
    }
  })

  it('public contact: the line shows only the public email and website (html + text)', () => {
    const ctx = eveContext()
    const contact = { email: 'tickets@acme.example', website: 'https://acme.example' }
    for (const type of NOTIFICATION_TYPES) {
      const e = buildLifecycleEmail({ ...LIFE, type, product: ctx, branding: { ...LIFE.branding, name: 'Acme Presents' }, organiserContact: contact })
      expect(e.text, type).toContain('Questions about this event? Contact Acme Presents: tickets@acme.example · https://acme.example')
      expect(e.html, type).toContain('Contact <strong>Acme Presents</strong>: <a href="mailto:tickets@acme.example"')
      for (const v of [PRIVATE.email, PRIVATE.phone, INTERNAL]) expect(e.html + e.text, `${type}: ${v}`).not.toContain(v)
    }
  })

  it('neutral name with no display name configured', () => {
    const e = buildLifecycleEmail({ ...LIFE, type: 'ORDER_REFUNDED', product: eveContext(), organiserContact: { email: null, website: 'https://acme.example' } })
    expect(e.text).toContain('Questions about this event? Contact the event organiser: https://acme.example')
  })

  it('BrainBase / LD Tennis lifecycle emails unchanged: private contact still shown, organiserContact ignored', () => {
    for (const product of [undefined, brainbaseBuyerContext()]) {
      const base = { ...LIFE, type: 'ORDER_REFUNDED' as const, product, branding: { ...LIFE.branding, name: 'LD Tennis' }, organisationName: 'LD Tennis' }
      const without = buildLifecycleEmail(base)
      const withContact = buildLifecycleEmail({ ...base, organiserContact: { email: 'tickets@acme.example', website: 'https://acme.example' } })
      expect(withContact).toEqual(without)
      expect(without.text).toContain(`Questions about this order? Contact LD Tennis — ${PRIVATE.email} · ${PRIVATE.phone}.`)
    }
  })

  it('the lifecycle sender passes the Eve contact from the same organisation row', () => {
    expect(read('lib/events/notificationDelivery.ts')).toContain('organiserContact: normaliseEveOrganiserContact(row.organisation_settings)')
  })
})

describe('Eve organiser settings view (read-only)', () => {
  it('adds public_email; never fills it from the private email', () => {
    expect(brandingView(settings({}), INTERNAL).public_email).toBeNull()
    const v = brandingView(settings({ publicEmail: 'tickets@acme.example' }), INTERNAL)
    expect(v.public_email).toBe('tickets@acme.example')
    expect(v.configured).toBe(true)
    expect(brandingView({ branding: { publicEmail: 'tickets@acme.example' } }, INTERNAL).configured).toBe(true)
  })
})

describe('scope guards', () => {
  it('no Stripe, checkout, receipt, refund, question or retention code is touched', () => {
    for (const f of ['lib/events/stripe.ts', 'lib/events/receipt.ts', 'lib/events/services/paidCheckout.ts', 'lib/events/registrationQuestions.ts']) {
      if (fs.existsSync(path.join(process.cwd(), f))) expect(read(f), f).not.toMatch(/publicEmail|organiserContact|organiser_contact/)
    }
  })

  it('no schema change: publicEmail lives in settings.branding JSON only', () => {
    expect(read('lib/organisations/branding.ts')).toMatch(/publicEmail: normalizeEmail\(r\.publicEmail\)/)
    expect(fs.readdirSync(path.join(process.cwd(), 'scripts')).filter(f => /organiser.?contact|public.?email/i.test(f))).toEqual([])
  })
})
