import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { sendTicketEmail, type TicketEmailData } from '@/lib/events/ticketEmail'
import { resolveBuyerProduct, brainbaseBuyerContext, validEveSupportEmail, eveFooterLinks } from '@/lib/events/buyerProduct'
import { sendEmail } from '@/lib/email'

// Eve sender + Reply-To. BrainBase stays the one delivery layer; Reply-To is an
// optional field only Eve's validated context ever sets.

const EVE_BASE = 'https://eveevents.com.au'
const EVE_FROM = 'Eve <tickets@mail.eveevents.com.au>'
const EVE_SUPPORT = 'support@eveevents.com.au'
const DEFAULT_FROM = process.env.EMAIL_FROM ?? 'Brainbase <noreply@brainbase.app>'
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

const TICKET: TicketEmailData = {
  eventName: 'Gala', purchaserName: 'Jane', bookingToken: 'w'.repeat(48),
  attendees: [{ name: 'A', ticketToken: 'a'.repeat(48) }],
}

// support: undefined = the default address; null = EVE_SUPPORT_EMAIL unset.
function eveContext(support: string | null | undefined = EVE_SUPPORT) {
  vi.stubEnv('EVE_PUBLIC_BASE_URL', EVE_BASE)
  vi.stubEnv('EVE_EMAIL_FROM', EVE_FROM)
  if (support === null) vi.stubEnv('EVE_SUPPORT_EMAIL', undefined as unknown as string)
  else vi.stubEnv('EVE_SUPPORT_EMAIL', support)
  const r = resolveBuyerProduct('EVE')
  if (!r.ok) throw new Error('expected an Eve context')
  return r.context
}

function captureResend() {
  const bodies: Record<string, unknown>[] = []
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ id: 'msg' }), { status: 200 })
  }))
  return bodies
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Eve buyer email: From and Reply-To', () => {
  it('uses the Eve From address and Reply-To from EVE_SUPPORT_EMAIL', async () => {
    const bodies = captureResend()
    await sendTicketEmail('buyer@example.org', { ...TICKET, product: eveContext() })
    expect(bodies).toHaveLength(1)
    expect(bodies[0].from).toBe(EVE_FROM)
    expect(bodies[0].reply_to).toBe(EVE_SUPPORT)
  })
  it('the Reply-To is read from the configured value, not hard-coded', async () => {
    const bodies = captureResend()
    await sendTicketEmail('buyer@example.org', { ...TICKET, product: eveContext('help@eve-example.net') })
    expect(bodies[0].reply_to).toBe('help@eve-example.net')
  })
  it('the resolved Eve context carries replyTo alongside from', () => {
    const ctx = eveContext()
    expect(ctx.from).toBe(EVE_FROM)
    expect(ctx.replyTo).toBe(EVE_SUPPORT)
  })
})

describe('missing or malformed Eve support config never leaks a BrainBase Reply-To', () => {
  const bad: (string | null)[] = [null, '', '   ', 'not-an-address', 'a@b', 'x y@eveevents.com.au', 'Eve <support@eveevents.com.au>', 'support@eve.invalid', 'support@example.test']
  it('resolves to a null replyTo and still sends from Eve, with no reply_to field', async () => {
    for (const v of bad) {
      const ctx = eveContext(v)
      expect(ctx.replyTo, String(v)).toBeNull()
      expect(ctx.from).toBe(EVE_FROM)
    }
    const bodies = captureResend()
    await sendTicketEmail('buyer@example.org', { ...TICKET, product: eveContext(null) })
    expect(bodies[0].from).toBe(EVE_FROM)
    expect(bodies[0]).not.toHaveProperty('reply_to')
    expect(JSON.stringify(bodies[0])).not.toMatch(/brainbase/i)
  })
  it('the footer Support link and the Reply-To follow the same rule', () => {
    for (const v of [...bad, EVE_SUPPORT]) {
      const hasLink = eveFooterLinks(EVE_BASE, v ?? undefined).some(l => l.label === 'Support')
      expect(hasLink, String(v)).toBe(validEveSupportEmail(v ?? undefined) !== null)
    }
  })
  it('no EVE_SUPPORT_EMAIL fallback to EMAIL_FROM, MAIL_TO or any BrainBase address in the resolver', () => {
    const src = read('lib/events/buyerProduct.ts').split('\n').filter(l => !l.trim().startsWith('//')).join(' ')
    expect(src).not.toMatch(/EMAIL_FROM(?!\b)|process\.env\.EMAIL_FROM|MAIL_TO|noreply@brainbase|brainbase\.app/)
  })
})

describe('BrainBase and default email behaviour is unchanged', () => {
  it('the BrainBase context has no replyTo', () => {
    expect(brainbaseBuyerContext().replyTo).toBeNull()
    expect(resolveBuyerProduct('BRAINBASE')).toMatchObject({ ok: true, context: { replyTo: null, from: null } })
    expect(resolveBuyerProduct(undefined)).toMatchObject({ ok: true, context: { replyTo: null, from: null } })
  })
  it('a default sendEmail call carries no reply_to and the default From', async () => {
    const bodies = captureResend()
    await sendEmail({ to: 'a@b.test', subject: 's', html: '<p>x</p>' })
    expect(bodies[0].from).toBe(DEFAULT_FROM)
    expect(bodies[0]).not.toHaveProperty('reply_to')
  })
  it('a BrainBase order email carries no reply_to even when EVE_SUPPORT_EMAIL is set in the environment', async () => {
    vi.stubEnv('EVE_SUPPORT_EMAIL', EVE_SUPPORT)
    const bodies = captureResend()
    await sendTicketEmail('buyer@example.org', TICKET)
    await sendTicketEmail('buyer@example.org', { ...TICKET, product: brainbaseBuyerContext() })
    expect(bodies).toHaveLength(2)
    for (const b of bodies) {
      expect(b.from).toBe(DEFAULT_FROM)
      expect(b).not.toHaveProperty('reply_to')
    }
  })
  it('sendEmail only sends reply_to when the caller passes replyTo', async () => {
    const bodies = captureResend()
    await sendEmail({ to: 'a@b.test', subject: 's', html: '<p>x</p>', from: EVE_FROM })
    await sendEmail({ to: 'a@b.test', subject: 's', html: '<p>x</p>', from: EVE_FROM, replyTo: EVE_SUPPORT })
    expect(bodies[0]).not.toHaveProperty('reply_to')
    expect(bodies[1].reply_to).toBe(EVE_SUPPORT)
  })
  it('LD Tennis mail does not go through sendEmail replyTo: the only replyTo callers are the two Eve-aware send sites', () => {
    expect(read('lib/emailConfig.ts')).not.toMatch(/replyTo|reply_to/)
    const hits = ['lib/events/ticketEmail.ts', 'lib/events/notificationDelivery.ts']
    for (const f of hits) expect(read(f), f).toMatch(/product\??\.replyTo/)
  })
})
