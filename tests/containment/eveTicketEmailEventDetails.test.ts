import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { buildTicketEmail, sendTicketEmail, type TicketEmailData, type TicketEmailEventDetails } from '@/lib/events/ticketEmail'
import { resolveBuyerProduct } from '@/lib/events/buyerProduct'
import { receiptFromOrderRow, RECEIPT_FORBIDDEN_TERMS } from '@/lib/events/receipt'

// Eve ticket email: the event's date, time (in the event's own stored
// timezone) and venue. Eve only — BrainBase ticket emails are unchanged.

const EVE_BASE = 'https://eve-preview.vercel.app'
const EVE_FROM = 'Eve <tickets@mail.eve-preview.dev>'
const EVE_SUPPORT = 'support@eve-preview.dev'
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

function eveContext() {
  vi.stubEnv('EVE_PUBLIC_BASE_URL', EVE_BASE)
  vi.stubEnv('EVE_EMAIL_FROM', EVE_FROM)
  vi.stubEnv('EVE_SUPPORT_EMAIL', EVE_SUPPORT)
  const r = resolveBuyerProduct('EVE')
  if (!r.ok) throw new Error('expected an Eve context')
  return r.context
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

// Riverlights Music & Arts Festival 2027, as configured in Production.
const RIVERLIGHTS: TicketEmailEventDetails = {
  startsAt: '2027-03-20T01:30:00.000Z',
  endsAt: '2027-03-20T12:30:00.000Z',
  timezone: 'Australia/Adelaide',
  venue: 'Bonython Park, Port Road, Adelaide SA 5000',
}

const TICKET: TicketEmailData = {
  eventName: 'Riverlights Music & Arts Festival 2027',
  purchaserName: 'Sam Buyer',
  attendees: [{ name: 'Sam Buyer', ticketToken: 'a'.repeat(48) }],
  event: RIVERLIGHTS,
}

function details(html: string): string {
  const m = html.match(/<div style="margin:0 0 24px;padding:14px 16px;background:#f7f7f7[^"]*">([\s\S]*?)<\/div>\s*<div style="margin:0 0 18px/)
  return m ? m[1] : ''
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('Eve ticket email: event details', () => {
  it('Riverlights (free): date, time with zone and venue, between the greeting and the ticket links', () => {
    const { html } = buildTicketEmail({ ...TICKET, product: eveContext() })
    const block = text(details(html))
    expect(block).toBe('Saturday, 20 March 2027 12:00 pm – 11:00 pm ACDT Bonython Park, Port Road, Adelaide SA 5000')
    expect(html.indexOf('Saturday, 20 March 2027')).toBeGreaterThan(html.indexOf('Hi Sam Buyer'))
    expect(html.indexOf('Saturday, 20 March 2027')).toBeLessThan(html.indexOf(`${EVE_BASE}/t/`))
  })

  it('Adelaide winter event shows ACST', () => {
    const { html } = buildTicketEmail({ ...TICKET, product: eveContext(), event: { ...RIVERLIGHTS, startsAt: '2027-07-10T09:30:00Z', endsAt: '2027-07-10T12:00:00Z' } })
    expect(text(details(html))).toContain('Saturday, 10 July 2027 7:00 pm – 9:30 pm ACST')
  })

  it('overnight event: Starts and Ends lines with both dates', () => {
    const { html } = buildTicketEmail({ ...TICKET, product: eveContext(), event: { ...RIVERLIGHTS, startsAt: '2027-03-20T11:30:00Z', endsAt: '2027-03-20T15:30:00Z' } })
    const block = text(details(html))
    expect(block).toContain('Starts Saturday, 20 March 2027, 10:00 pm ACDT')
    expect(block).toContain('Ends Sunday, 21 March 2027, 2:00 am ACDT')
  })

  it('no end time: start time only', () => {
    const { html } = buildTicketEmail({ ...TICKET, product: eveContext(), event: { ...RIVERLIGHTS, endsAt: null } })
    expect(text(details(html))).toBe('Saturday, 20 March 2027 12:00 pm ACDT Bonython Park, Port Road, Adelaide SA 5000')
  })

  it('no venue (null or blank): the venue line is omitted cleanly', () => {
    for (const venue of [null, '', '   ']) {
      const { html } = buildTicketEmail({ ...TICKET, product: eveContext(), event: { ...RIVERLIGHTS, venue } })
      const block = details(html)
      expect(text(block)).toBe('Saturday, 20 March 2027 12:00 pm – 11:00 pm ACDT')
      expect(block.match(/<div /g)).toHaveLength(2)
    }
  })

  it('venue text is escaped', () => {
    const { html } = buildTicketEmail({ ...TICKET, product: eveContext(), event: { ...RIVERLIGHTS, venue: 'Hall <b>A</b> & Co' } })
    expect(details(html)).toContain('Hall &lt;b&gt;A&lt;/b&gt; &amp; Co')
  })

  it('paid Eve booking: event details and the payment summary both render; no tax wording', () => {
    const receipt = receiptFromOrderRow({
      id: 'order-1', payment_status: 'PAID', event_name: TICKET.eventName, organisation_name: 'Brainbase', currency: 'AUD',
      total_cents: 8900, discount_cents: 0, platform_fee_cents: 0, fee_mode: null, payment_total_cents: 8900,
      paid_at: '2027-02-01T00:00:00Z', event_timezone: 'Australia/Adelaide',
      receipt_lines: [{ description: 'General Admission', quantity: 1, unit_price_cents: 8900, discount_cents: 0 }],
    })
    expect(receipt).not.toBeNull()
    const { html } = buildTicketEmail({ ...TICKET, product: eveContext(), receipt })
    expect(text(details(html))).toContain('Saturday, 20 March 2027 12:00 pm – 11:00 pm ACDT')
    expect(html).toContain('$89.00')
    for (const term of RECEIPT_FORBIDDEN_TERMS) expect(html).not.toContain(term)
  })

  it('no GST / Tax Invoice / ABN wording on a free Eve email either', () => {
    const { html, subject } = buildTicketEmail({ ...TICKET, product: eveContext() })
    for (const term of ['GST', 'Tax Invoice', 'tax invoice', 'ABN']) {
      expect(html).not.toContain(term)
      expect(subject).not.toContain(term)
    }
  })

  it('subject is unchanged', () => {
    expect(buildTicketEmail({ ...TICKET, product: eveContext() }).subject).toBe('Your ticket for Riverlights Music & Arts Festival 2027')
  })

  it('no event data: the Eve email renders exactly as before (no empty block)', () => {
    const ctx = eveContext()
    const without = buildTicketEmail({ ...TICKET, event: undefined, product: ctx }).html
    expect(details(without)).toBe('')
    expect(without).not.toContain('background:#f7f7f7')
  })
})

describe('BrainBase / LD Tennis isolation', () => {
  const ldTennisBranding = { name: 'LD Tennis', logoUrl: null, website: 'https://ldtennis.example', accentColor: '#0a7d32', emailFooter: 'LD Tennis Academy' }

  it('a BrainBase ticket email is byte-identical with or without event data', () => {
    const withEvent = buildTicketEmail(TICKET)
    const without = buildTicketEmail({ ...TICKET, event: undefined })
    expect(withEvent).toEqual(without)
    expect(withEvent.html).not.toContain('Saturday, 20 March 2027')
  })

  it('an organisation-branded (LD Tennis) BrainBase email gains no Eve branding and no details block', () => {
    const withEvent = buildTicketEmail({ ...TICKET, branding: ldTennisBranding })
    const without = buildTicketEmail({ ...TICKET, event: undefined, branding: ldTennisBranding })
    expect(withEvent).toEqual(without)
    expect(withEvent.html).toContain('LD Tennis')
    expect(withEvent.html).not.toContain(EVE_BASE)
    expect(withEvent.html).not.toMatch(/>\s*EVE\s*</)
  })
})

describe('sender unchanged', () => {
  function captureResend() {
    const bodies: Record<string, unknown>[] = []
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ id: 'msg' }), { status: 200 })
    }))
    return bodies
  }

  it('Eve: From is the Eve sender and Reply-To the Eve support address; BrainBase: default sender, no Reply-To', async () => {
    const ctx = eveContext()
    const bodies = captureResend()
    await sendTicketEmail('a@b.test', { ...TICKET, product: ctx })
    await sendTicketEmail('a@b.test', TICKET)
    expect(bodies[0].from).toBe(EVE_FROM)
    expect(bodies[0].reply_to).toBe(EVE_SUPPORT)
    expect(String(bodies[0].html)).toContain('Saturday, 20 March 2027')
    expect(bodies[1].from).toBe(process.env.EMAIL_FROM ?? 'Brainbase <noreply@brainbase.app>')
    expect('reply_to' in bodies[1]).toBe(false)
    expect(String(bodies[1].html)).not.toContain('Saturday, 20 March 2027')
  })
})

describe('wiring', () => {
  it('both ticket-email senders read starts_at, ends_at, timezone and venue from the order\'s own event and pass them on', () => {
    for (const f of ['lib/events/ticketEmailDelivery.ts', 'app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts']) {
      const src = read(f)
      expect(src, f).toContain('e.starts_at AS event_starts_at, e.ends_at AS event_ends_at, e.venue AS event_venue')
      expect(src, f).toMatch(/event: \{ startsAt: \w+\.event_starts_at, endsAt: \w+\.event_ends_at, timezone: \w+\.event_timezone, venue: \w+\.event_venue \}/)
    }
    expect(read('lib/events/ticketEmailDelivery.ts')).toContain('event: order.event,')
  })

  it('the details block is gated on the Eve surface inside the template', () => {
    expect(read('lib/events/ticketEmail.ts')).toContain("product.surface === 'EVE' && data.event ? renderEventDetailsHtml(data.event) : ''")
  })

  it('nothing writes event data from this path (read-only SELECTs)', () => {
    for (const f of ['lib/events/ticketEmail.ts', 'packages/ticketing/src/eventSchedule.ts']) {
      expect(read(f), f).not.toMatch(/UPDATE events|INSERT INTO events/)
    }
  })
})
