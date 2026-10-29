import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { buildLifecycleEmail, LIFECYCLE_EMAIL_FORBIDDEN_TERMS, type LifecycleEmailData } from '@/lib/events/lifecycleEmail'
import { resolveBuyerProduct, brainbaseBuyerContext } from '@/lib/events/buyerProduct'
import { NOTIFICATION_TYPES } from '@/lib/events/notifications'

// Eve lifecycle emails (refund, order cancelled, event cancelled, reminder,
// event changed) show "When" with the shared ticket-email formatter
// (@ticketing/core/eventSchedule). BrainBase / LD Tennis output is unchanged.

const EVE_BASE = 'https://eve-preview.vercel.app'
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

function eveContext() {
  vi.stubEnv('EVE_PUBLIC_BASE_URL', EVE_BASE)
  vi.stubEnv('EVE_EMAIL_FROM', 'Eve <tickets@mail.eve-preview.dev>')
  vi.stubEnv('EVE_SUPPORT_EMAIL', 'support@eve-preview.dev')
  const r = resolveBuyerProduct('EVE')
  if (!r.ok) throw new Error('expected an Eve context')
  return r.context
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

const VENUE = 'Bonython Park, Port Road, Adelaide SA 5000'
const RIVERLIGHTS_WHEN = 'Saturday, 20 March 2027, 12:00 pm – 11:00 pm ACDT'
// Riverlights Music & Arts Festival 2027: 12:00 pm – 11:00 pm ACDT.
const BASE: Omit<LifecycleEmailData, 'type'> = {
  orderReference: 'ord-1', purchaserName: 'Sam', eventName: 'Riverlights Music & Arts Festival 2027',
  eventStartsAt: '2027-03-20T01:30:00.000Z', eventEndsAt: '2027-03-20T12:30:00.000Z', eventTimezone: 'Australia/Adelaide',
  venue: VENUE, description: null, orderStatus: 'CONFIRMED', paymentStatus: 'PAID', currency: 'AUD',
  totalCents: 8900, paymentTotalCents: 8900, platformFeeCents: 0, feeMode: null, feeLabel: null,
  refundedCents: 8900, platformFeeRefundedCents: 0, paidAt: '2027-02-01T00:00:00Z', refundedAt: '2027-02-02T00:00:00Z',
  attendees: [{ name: 'Sam', ticketToken: 'a'.repeat(48), sessionName: null }], bookingToken: 'w'.repeat(48),
  branding: { name: null, logoUrl: null, website: null, accentColor: null, emailFooter: null, supportEmail: null, supportPhone: null },
  organisationName: 'Brainbase',
}
const CHANGE = {
  before: { starts_at: '2027-03-13T01:30:00.000Z', ends_at: '2027-03-13T12:30:00.000Z', venue: VENUE },
  after: { starts_at: BASE.eventStartsAt, ends_at: BASE.eventEndsAt, venue: VENUE },
  change_version: 'v1',
}
const STATIC_TYPES = ['ORDER_CANCELLED', 'ORDER_REFUNDED', 'EVENT_CANCELLED', 'EVENT_REMINDER'] as const

const line = (text: string, label: string) => text.split('\n').find(l => l.startsWith(`${label}: `))?.slice(label.length + 2) ?? null

describe('Eve lifecycle emails: "When" uses the shared event formatter', () => {
  it('Riverlights (Adelaide summer): refund, order cancelled, event cancelled and reminder', () => {
    const ctx = eveContext()
    for (const type of STATIC_TYPES) {
      const e = buildLifecycleEmail({ ...BASE, type, product: ctx })
      expect(line(e.text, 'When'), type).toBe(RIVERLIGHTS_WHEN)
      expect(line(e.text, 'Where'), type).toBe(VENUE)
      expect(e.html, type).toContain(`>${RIVERLIGHTS_WHEN}<`)
      expect(e.text, type).not.toMatch(/ at \d/)
    }
  })

  it('Adelaide winter shows ACST', () => {
    const e = buildLifecycleEmail({ ...BASE, type: 'ORDER_REFUNDED', eventStartsAt: '2027-07-10T09:30:00Z', eventEndsAt: '2027-07-10T12:00:00Z', product: eveContext() })
    expect(line(e.text, 'When')).toBe('Saturday, 10 July 2027, 7:00 pm – 9:30 pm ACST')
  })

  it('DST ends during the event: each end shows its own abbreviation', () => {
    const e = buildLifecycleEmail({ ...BASE, type: 'EVENT_CANCELLED', eventStartsAt: '2027-04-03T14:00:00Z', eventEndsAt: '2027-04-03T17:30:00Z', product: eveContext() })
    expect(line(e.text, 'When')).toBe('Sunday, 4 April 2027, 12:30 am ACDT – 3:00 am ACST')
  })

  it('overnight event: both dates in full', () => {
    const e = buildLifecycleEmail({ ...BASE, type: 'EVENT_REMINDER', eventStartsAt: '2027-03-20T11:30:00Z', eventEndsAt: '2027-03-20T15:30:00Z', product: eveContext() })
    expect(line(e.text, 'When')).toBe('Saturday, 20 March 2027, 10:00 pm ACDT – Sunday, 21 March 2027, 2:00 am ACDT')
  })

  it('no end time (the reader passes an empty string for NULL ends_at): start only, no dangling dash', () => {
    const e = buildLifecycleEmail({ ...BASE, type: 'ORDER_CANCELLED', eventEndsAt: '', product: eveContext() })
    expect(line(e.text, 'When')).toBe('Saturday, 20 March 2027, 12:00 pm ACDT')
  })

  it('missing or blank venue: the Where row is omitted', () => {
    const ctx = eveContext()
    for (const venue of [null, '', '   ']) {
      for (const type of STATIC_TYPES) {
        const e = buildLifecycleEmail({ ...BASE, type, venue, product: ctx })
        expect(line(e.text, 'Where'), `${type} ${JSON.stringify(venue)}`).toBeNull()
        expect(e.html).not.toContain('>Where<')
      }
    }
  })

  it('venue is trimmed and escaped', () => {
    const e = buildLifecycleEmail({ ...BASE, type: 'ORDER_REFUNDED', venue: '  Hall <b>A</b> & Co  ', product: eveContext() })
    expect(line(e.text, 'Where')).toBe('Hall <b>A</b> & Co')
    expect(e.html).toContain('Hall &lt;b&gt;A&lt;/b&gt; &amp; Co')
  })

  it('reminder subject: event start with zone, in the same format', () => {
    const e = buildLifecycleEmail({ ...BASE, type: 'EVENT_REMINDER', product: eveContext() })
    expect(e.subject).toBe('Reminder: Riverlights Music & Arts Festival 2027 — Saturday, 20 March 2027, 12:00 pm ACDT')
  })

  it('other subjects are unchanged', () => {
    const ctx = eveContext()
    expect(buildLifecycleEmail({ ...BASE, type: 'ORDER_REFUNDED', product: ctx }).subject).toBe('Your refund for Riverlights Music & Arts Festival 2027')
    expect(buildLifecycleEmail({ ...BASE, type: 'ORDER_CANCELLED', product: ctx }).subject).toBe('Your order for Riverlights Music & Arts Festival 2027 has been cancelled')
    expect(buildLifecycleEmail({ ...BASE, type: 'EVENT_CANCELLED', product: ctx }).subject).toBe('Riverlights Music & Arts Festival 2027 has been cancelled')
    expect(buildLifecycleEmail({ ...BASE, type: 'EVENT_UPDATED', change: CHANGE, product: ctx }).subject).toBe('Details changed for Riverlights Music & Arts Festival 2027')
  })

  it('event changed: Previously / Now in the shared format; unchanged venue as Where', () => {
    const e = buildLifecycleEmail({ ...BASE, type: 'EVENT_UPDATED', change: CHANGE, product: eveContext() })
    expect(line(e.text, 'Previously')).toBe('Saturday, 13 March 2027, 12:00 pm – 11:00 pm ACDT')
    expect(line(e.text, 'Now')).toBe(RIVERLIGHTS_WHEN)
    expect(line(e.text, 'Where')).toBe(VENUE)
  })

  it('event changed: venue only (When), and a blank unchanged venue is omitted', () => {
    const ctx = eveContext()
    const venueOnly = buildLifecycleEmail({ ...BASE, type: 'EVENT_UPDATED', product: ctx, change: { ...CHANGE, before: { ...CHANGE.after, venue: 'Old Hall' } } })
    expect(line(venueOnly.text, 'When')).toBe(RIVERLIGHTS_WHEN)
    expect(line(venueOnly.text, 'Previous venue')).toBe('Old Hall')
    expect(line(venueOnly.text, 'New venue')).toBe(VENUE)
    const blank = buildLifecycleEmail({ ...BASE, type: 'EVENT_UPDATED', product: ctx, change: { ...CHANGE, before: { ...CHANGE.before, venue: '  ' }, after: { ...CHANGE.after, venue: '  ' } } })
    expect(line(blank.text, 'Where')).toBeNull()
  })

  it('free and paid orders: payment wording is untouched; no tax wording', () => {
    const ctx = eveContext()
    const free = buildLifecycleEmail({ ...BASE, type: 'EVENT_CANCELLED', paymentStatus: 'NOT_REQUIRED', paymentTotalCents: 0, totalCents: 0, product: ctx })
    expect(free.text).toContain('This was a free registration, so no payment was taken.')
    expect(line(free.text, 'When')).toBe(RIVERLIGHTS_WHEN)
    const paid = buildLifecycleEmail({ ...BASE, type: 'EVENT_CANCELLED', product: ctx })
    expect(paid.text).toContain('You paid $89.00 for this order. No refund has been processed for it yet')
    const refund = buildLifecycleEmail({ ...BASE, type: 'ORDER_REFUNDED', paymentStatus: 'REFUNDED', product: ctx })
    expect(line(refund.text, 'Amount paid')).toBe('$89.00 on 1 February 2027')
    expect(line(refund.text, 'Total refunded')).toBe('$89.00 AUD on 2 February 2027')
    for (const type of NOTIFICATION_TYPES) {
      const e = buildLifecycleEmail({ ...BASE, type, change: CHANGE, product: ctx })
      for (const term of LIFECYCLE_EMAIL_FORBIDDEN_TERMS) expect(e.html + e.text + e.subject, `${type}: ${term}`).not.toContain(term)
    }
  })
})

describe('BrainBase / LD Tennis isolation', () => {
  const LEGACY_WHEN = 'Saturday 20 March 2027 at 12:00 pm – Saturday 20 March 2027 at 11:00 pm'
  const ldTennis = { ...BASE.branding, name: 'LD Tennis', website: 'https://ldtennis.example', accentColor: '#0a7d32', emailFooter: 'LD Tennis Academy' }

  it('BrainBase keeps the previous "When" and reminder subject, with no zone abbreviation', () => {
    for (const type of STATIC_TYPES) {
      const e = buildLifecycleEmail({ ...BASE, type })
      expect(line(e.text, 'When'), type).toBe(LEGACY_WHEN)
      expect(e.text, type).not.toContain('ACDT')
    }
    expect(buildLifecycleEmail({ ...BASE, type: 'EVENT_REMINDER' }).subject).toBe('Reminder: Riverlights Music & Arts Festival 2027 — Saturday 20 March 2027 at 12:00 pm')
    const upd = buildLifecycleEmail({ ...BASE, type: 'EVENT_UPDATED', change: CHANGE })
    expect(line(upd.text, 'Now')).toBe(LEGACY_WHEN)
  })

  it('explicit BrainBase context is byte-identical to no context', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(buildLifecycleEmail({ ...BASE, type, change: CHANGE, product: brainbaseBuyerContext() })).toEqual(buildLifecycleEmail({ ...BASE, type, change: CHANGE }))
    }
  })

  it('LD Tennis-branded email keeps its branding, the previous format and gains nothing from Eve', () => {
    for (const type of NOTIFICATION_TYPES) {
      const e = buildLifecycleEmail({ ...BASE, type, change: CHANGE, branding: ldTennis })
      expect(e.html, type).toContain('LD Tennis')
      expect(e.html, type).not.toContain(EVE_BASE)
      expect(e.html + e.text, type).not.toContain('ACDT')
      expect(e.html, type).not.toMatch(/>\s*EVE\s*</)
    }
  })

  it('BrainBase whitespace venue behaviour is unchanged (rendered as before)', () => {
    expect(line(buildLifecycleEmail({ ...BASE, type: 'ORDER_REFUNDED', venue: null }).text, 'Where')).toBeNull()
  })
})

describe('wiring', () => {
  it('the template uses the shared package formatter, gated on the Eve surface', () => {
    const src = read('lib/events/lifecycleEmail.ts')
    expect(src).toContain("import { formatEventScheduleLine } from '@ticketing/core/eventSchedule';")
    expect(src).toContain("return data.product?.surface === 'EVE';")
  })
})
