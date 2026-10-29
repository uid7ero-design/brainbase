import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { buildTicketEmail, sendTicketEmail, type TicketEmailData } from '@/lib/events/ticketEmail'
import { buildLifecycleEmail, type LifecycleEmailData } from '@/lib/events/lifecycleEmail'
import { resolveBuyerProduct, parseEveSender, brainbaseBuyerContext, resolveBuyerLinkBase } from '@/lib/events/buyerProduct'
import { sendEmail, BASE_URL } from '@/lib/email'
import { NOTIFICATION_TYPES } from '@/lib/events/notifications'

// Eve Phase 3.2 — product-aware buyer communications (pure/containment half;
// the delivery orchestration is proven against real Postgres in
// eventsProductAwareCommunicationsRealPostgres.test.ts).

const EVE_BASE = 'https://eve-preview.vercel.app'
const EVE_FROM = 'Eve <tickets@mail.eve-preview.dev>'
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const hrefs = (html: string) => Array.from(html.matchAll(/href="([^"]+)"/g)).map(m => m[1])

function eveEnv() {
  vi.stubEnv('EVE_PUBLIC_BASE_URL', EVE_BASE)
  vi.stubEnv('EVE_EMAIL_FROM', EVE_FROM)
}
function eveContext() {
  eveEnv()
  const r = resolveBuyerProduct('EVE')
  if (!r.ok) throw new Error('expected an Eve context')
  return r.context
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

const TICKET: TicketEmailData = {
  eventName: 'Gala', purchaserName: 'Jane', bookingToken: 'w'.repeat(48),
  attendees: [{ name: 'A', ticketToken: 'a'.repeat(48) }, { name: 'B', ticketToken: 'b'.repeat(48) }],
}
const LIFECYCLE: Omit<LifecycleEmailData, 'type'> = {
  orderReference: 'ord-1', purchaserName: 'Jane', eventName: 'Gala',
  eventStartsAt: '2030-01-01T10:00:00Z', eventEndsAt: '2030-01-01T12:00:00Z', eventTimezone: 'Australia/Adelaide',
  venue: null, description: null, orderStatus: 'CONFIRMED', paymentStatus: 'PAID', currency: 'AUD',
  totalCents: 2500, paymentTotalCents: 2500, platformFeeCents: 0, feeMode: null, feeLabel: null,
  refundedCents: 2500, platformFeeRefundedCents: 0, paidAt: '2029-12-01T00:00:00Z', refundedAt: '2029-12-02T00:00:00Z',
  attendees: [{ name: 'A', ticketToken: 'a'.repeat(48), sessionName: null }], bookingToken: 'w'.repeat(48),
  branding: { name: null, logoUrl: null, website: null, accentColor: null, emailFooter: null, supportEmail: null, supportPhone: null } as LifecycleEmailData['branding'],
  organisationName: 'Org A',
}

describe('BRAINBASE orders keep BrainBase communications exactly', () => {
  it('a ticket email with no product === one with the explicit BrainBase context (byte-identical)', () => {
    expect(buildTicketEmail({ ...TICKET, product: brainbaseBuyerContext() })).toEqual(buildTicketEmail(TICKET))
    expect(buildTicketEmail({ ...TICKET, product: null })).toEqual(buildTicketEmail(TICKET))
  })
  it('uses BASE_URL ticket + wallet links, the BrainBase wordmark and legal line', () => {
    const { html } = buildTicketEmail(TICKET)
    expect(hrefs(html)).toContain(`${BASE_URL}/b/${'w'.repeat(48)}/tickets`)
    expect(hrefs(html)).toContain(`${BASE_URL}/t/${'a'.repeat(48)}`)
    expect(html).toContain('BRAINB')
    expect(html).toContain('Brainbase · Adelaide SA Australia')
  })
  it('lifecycle emails with no product === with the explicit BrainBase context', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(buildLifecycleEmail({ ...LIFECYCLE, type, product: brainbaseBuyerContext() })).toEqual(buildLifecycleEmail({ ...LIFECYCLE, type }))
    }
  })
  it('a BRAINBASE (or historical / unknown) row resolves to the default sender with no Eve configuration needed', () => {
    for (const v of ['BRAINBASE', null, undefined, '', 'garbage', 'eve']) {
      const r = resolveBuyerProduct(v)
      expect(r).toEqual({ ok: true, context: brainbaseBuyerContext() })
    }
    expect(brainbaseBuyerContext().from).toBeNull()
  })
})

describe('EVE orders use Eve identity and Eve buyer URLs', () => {
  it('ticket email: Eve ticket link, Eve wallet link, Eve wordmark; no BrainBase link, wordmark or legal line', () => {
    const { html } = buildTicketEmail({ ...TICKET, product: eveContext() })
    const links = hrefs(html)
    expect(links).toContain(`${EVE_BASE}/b/${'w'.repeat(48)}/tickets`)
    expect(links).toContain(`${EVE_BASE}/t/${'a'.repeat(48)}`)
    expect(links).toContain(`${EVE_BASE}/t/${'b'.repeat(48)}`)
    expect(links.some(l => l.startsWith(BASE_URL))).toBe(false)
    expect(html).not.toMatch(/brainb|adelaide/i)
    expect(html).toMatch(/>\s*EVE\s*</)
  })
  it('lifecycle emails (cancelled / refunded / event cancelled / reminder) carry Eve identity', () => {
    const ctx = eveContext()
    for (const type of NOTIFICATION_TYPES) {
      const e = buildLifecycleEmail({ ...LIFECYCLE, type, product: ctx })
      expect(e.html).not.toMatch(/brainb|adelaide/i)
      expect(e.html).toMatch(/>\s*EVE\s*</)
      expect(e.text).not.toContain(BASE_URL)
    }
    const reminder = buildLifecycleEmail({ ...LIFECYCLE, type: 'EVENT_REMINDER', product: ctx })
    expect(hrefs(reminder.html)).toContain(`${EVE_BASE}/b/${'w'.repeat(48)}/tickets`)
    expect(reminder.text).toContain(`${EVE_BASE}/b/${'w'.repeat(48)}/tickets`)
    // No wallet token: individual Eve ticket links.
    const single = buildLifecycleEmail({ ...LIFECYCLE, bookingToken: null, type: 'EVENT_REMINDER', product: ctx })
    expect(hrefs(single.html)).toContain(`${EVE_BASE}/t/${'a'.repeat(48)}`)
  })
  it('makes no charity / NFP / social-purpose claim and no legal-entity or address claim', () => {
    const ctx = eveContext()
    const all = [
      buildTicketEmail({ ...TICKET, product: ctx }).html,
      ...NOTIFICATION_TYPES.flatMap(type => { const e = buildLifecycleEmail({ ...LIFECYCLE, type, product: ctx }); return [e.html, e.text] }),
    ].join('\n')
    expect(all).not.toMatch(/charit|not[- ]for[- ]profit|nfp|non-?profit|social (enterprise|purpose)|ABN|Pty|Ltd/i)
  })
})

describe('failure behaviour — an Eve order is never emailed as BrainBase', () => {
  it('missing, malformed or insecure (production) Eve link base => EVE_LINK_BASE_UNAVAILABLE', () => {
    vi.stubEnv('EVE_EMAIL_FROM', EVE_FROM)
    for (const v of ['', 'not a url', 'ftp://eve.test', 'https://u:p@eve.test', 'https://eve.test/?x=1']) {
      vi.stubEnv('EVE_PUBLIC_BASE_URL', v)
      expect(resolveBuyerProduct('EVE')).toMatchObject({ ok: false, code: 'EVE_LINK_BASE_UNAVAILABLE' })
    }
    vi.stubEnv('EVE_PUBLIC_BASE_URL', undefined as unknown as string)
    expect(resolveBuyerProduct('EVE')).toMatchObject({ ok: false, code: 'EVE_LINK_BASE_UNAVAILABLE' })
    expect(resolveBuyerLinkBase('EVE')).toBeNull()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('EVE_PUBLIC_BASE_URL', 'http://eve.test')
    expect(resolveBuyerProduct('EVE')).toMatchObject({ ok: false, code: 'EVE_LINK_BASE_UNAVAILABLE' })
  })
  it('links ok but sender missing / placeholder / claiming to be BrainBase => EVE_SENDER_UNCONFIGURED (links and sender are separate gates)', () => {
    vi.stubEnv('EVE_PUBLIC_BASE_URL', EVE_BASE)
    for (const v of ['', 'Eve <no-reply@eve.invalid>', 'eve@example.test', 'Brainbase <tickets@mail.eve-preview.dev>', 'bare', 'a@b\nBcc: x@y.com']) {
      vi.stubEnv('EVE_EMAIL_FROM', v)
      expect(resolveBuyerProduct('EVE')).toMatchObject({ ok: false, code: 'EVE_SENDER_UNCONFIGURED' })
    }
    expect(resolveBuyerLinkBase('EVE')).toBe(EVE_BASE)
  })
  it('parseEveSender accepts a plain or display-name address on a real domain', () => {
    expect(parseEveSender('tickets@mail.eve-preview.dev')).toBe('tickets@mail.eve-preview.dev')
    expect(parseEveSender(EVE_FROM)).toBe(EVE_FROM)
    expect(parseEveSender('"Eve Tickets" <t@mail.eve-preview.dev>')).toBe('"Eve Tickets" <t@mail.eve-preview.dev>')
    expect(parseEveSender(undefined)).toBeNull()
  })
  it('a failed resolution carries no BrainBase fallback context', () => {
    vi.stubEnv('EVE_PUBLIC_BASE_URL', '')
    const r = resolveBuyerProduct('EVE')
    expect(r.ok).toBe(false)
    expect(r).not.toHaveProperty('context')
  })
})

describe('sender: BrainBase stays the delivery layer', () => {
  function captureResend() {
    const bodies: Record<string, unknown>[] = []
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ id: 'msg' }), { status: 200 })
    }))
    return bodies
  }
  it('the same Resend endpoint and key; From is the Eve sender only when the caller passes it, never a Reply-To', async () => {
    const bodies = captureResend()
    await sendEmail({ to: 'a@b.test', subject: 's', html: '<p>x</p>' })
    await sendEmail({ to: 'a@b.test', subject: 's', html: '<p>x</p>', from: EVE_FROM })
    expect(bodies[0].from).toBe(process.env.EMAIL_FROM ?? 'Brainbase <noreply@brainbase.app>')
    expect(bodies[1].from).toBe(EVE_FROM)
    expect(bodies.every(b => !('reply_to' in b))).toBe(true)
  })
  it('sendTicketEmail sends an Eve order from the Eve sender and a default order from the default sender', async () => {
    const bodies = captureResend()
    await sendTicketEmail('a@b.test', { ...TICKET, product: eveContext() })
    await sendTicketEmail('a@b.test', TICKET)
    expect(bodies[0].from).toBe(EVE_FROM)
    expect(bodies[1].from).toBe(process.env.EMAIL_FROM ?? 'Brainbase <noreply@brainbase.app>')
  })
})

describe('identity authority — source containment', () => {
  it('buyerProduct.ts resolves only from the row value: no request, header, Origin or Stripe metadata', () => {
    const src = read('lib/events/buyerProduct.ts').split(/\n/).filter(l => !l.trim().startsWith('//')).join(' ')
    expect(src).not.toMatch(/headers\(|Origin|origin|x-forwarded|NextRequest|req\.|request\.|metadata|searchParams/)
    expect(src).toContain('productSurfaceFromRow(rowSurface)')
  })
  it('every buyer-email send site resolves identity from the committed order row, passes it to the template and fails closed', () => {
    const sites: [string, string][] = [
      ['lib/events/ticketEmailDelivery.ts', 'resolveBuyerProduct(order.productSurface)'],
      ['lib/events/notificationDelivery.ts', 'resolveBuyerProduct(claimed.productSurface)'],
      ['app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts', 'resolveBuyerProduct(order.product_surface)'],
    ]
    for (const [file, call] of sites) {
      const src = read(file)
      expect(src, file).toContain(call)
      expect(src, file).toMatch(/product_surface|productSurface/)
      expect(src, file).toMatch(/!buyer\.ok/)
      expect(src, file).toMatch(/product: buyer\.context|product: buyer\.context|buyer\.context/)
    }
  })
  it('the order read selects eo.product_surface in all three send paths', () => {
    for (const f of ['lib/events/ticketEmailDelivery.ts', 'lib/events/notificationDelivery.ts', 'app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts']) {
      expect(read(f), f).toContain('eo.product_surface')
    }
  })
  it('the resend route reads no product from the request (empty body by design)', () => {
    const src = read('app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts')
    expect(src).not.toMatch(/req\.json|request\.json|searchParams|formData|headers\(/)
  })
  it('the webhook still reads only metadata.event_order_id (Stripe metadata is never an identity source)', () => {
    const src = read('lib/events/stripe.ts')
    const reads = src.match(/metadata\??\.\w+/g) ?? []
    expect(new Set(reads)).toEqual(new Set(['metadata?.event_order_id']))
  })
  it('the templates no longer read the BrainBase BASE_URL directly (links come from the order product context)', () => {
    expect(read('lib/events/ticketEmail.ts')).not.toMatch(/\bBASE_URL\b.*(buildTicketUrl|buildBookingWalletUrl)\(/)
    const life = read('lib/events/lifecycleEmail.ts')
    expect(life).not.toContain("BASE_URL }")
    expect(life).not.toMatch(/\$\{BASE_URL\}/)
  })
  it('the other emails in lib/email.ts are untouched: no product argument on verification / reset / lead emails', () => {
    const src = read('lib/email.ts')
    expect(src).not.toMatch(/verificationEmail\([^)]*product/)
    expect(src).toContain('export function emailLayout(body: string, org?: EmailOrgPresentation | null, product?: EmailProductPresentation | null)')
  })
})
