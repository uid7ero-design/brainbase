import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildTicketEmail, type TicketEmailData } from '@/lib/events/ticketEmail'
import { buildLifecycleEmail, type LifecycleEmailData } from '@/lib/events/lifecycleEmail'
import { resolveBuyerProduct, eveFooterLinks } from '@/lib/events/buyerProduct'
import { NOTIFICATION_TYPES } from '@/lib/events/notifications'

// Eve launch-compliance slice: legal/support links and the bearer-link notice
// in Eve emails (BrainBase output unchanged), and the CRM disclosure
// boundary (purchaser contact only, no marketing consent, no answers).

const EVE_BASE = 'https://eveevents.com.au'
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')
const hrefs = (html: string) => Array.from(html.matchAll(/href="([^"]+)"/g)).map(m => m[1])

function eveContext(support: string | null = 'support@eveevents.com.au') {
  vi.stubEnv('EVE_PUBLIC_BASE_URL', EVE_BASE)
  vi.stubEnv('EVE_EMAIL_FROM', 'Eve <tickets@eve-mail.thebrainbase.com.au>')
  vi.stubEnv('EVE_SUPPORT_EMAIL', support ?? '')
  const r = resolveBuyerProduct('EVE')
  if (!r.ok) throw new Error('expected Eve context')
  return r.context
}
afterEach(() => vi.unstubAllEnvs())

const TICKET: TicketEmailData = {
  eventName: 'Gala', purchaserName: 'Jane', bookingToken: 'w'.repeat(48),
  attendees: [{ name: 'A', ticketToken: 'a'.repeat(48) }, { name: 'B', ticketToken: 'b'.repeat(48) }],
}
const LIFE: Omit<LifecycleEmailData, 'type'> = {
  orderReference: 'ord-1', purchaserName: 'Jane', eventName: 'Gala',
  eventStartsAt: '2030-01-01T10:00:00Z', eventEndsAt: '2030-01-01T12:00:00Z', eventTimezone: 'Australia/Adelaide',
  venue: null, description: null, orderStatus: 'CONFIRMED', paymentStatus: 'PAID', currency: 'AUD',
  totalCents: 2500, paymentTotalCents: 2500, platformFeeCents: 0, feeMode: null, feeLabel: null,
  refundedCents: null, platformFeeRefundedCents: null, paidAt: null, refundedAt: null,
  attendees: [{ name: 'A', ticketToken: 'a'.repeat(48), sessionName: null }], bookingToken: 'w'.repeat(48),
  branding: { name: null, logoUrl: null, website: null, accentColor: null, emailFooter: null, supportEmail: null, supportPhone: null } as LifecycleEmailData['branding'],
  organisationName: 'Org A',
}

describe('Eve emails carry legal + support links and the bearer-link notice', () => {
  it('ticket email footer links Terms, Privacy, Refunds & cancellations (Eve origin) and Support', () => {
    const html = buildTicketEmail({ ...TICKET, product: eveContext() }).html
    const links = hrefs(html)
    expect(links).toEqual(expect.arrayContaining([`${EVE_BASE}/terms`, `${EVE_BASE}/privacy`, `${EVE_BASE}/refunds`, 'mailto:support@eveevents.com.au']))
    for (const label of ['Terms', 'Privacy', 'Refunds &amp; cancellations', 'Support']) expect(html).toContain(`>${label}</a>`)
  })

  it('ticket email states that anyone with the link can access the ticket', () => {
    expect(buildTicketEmail({ ...TICKET, product: eveContext() }).html).toMatch(/Anyone with these links can access these tickets\. Keep them private\./)
    expect(buildTicketEmail({ ...TICKET, attendees: [TICKET.attendees[0]], product: eveContext() }).html).toMatch(/Anyone with this link can access this ticket\. Keep it private\./)
  })

  it('every lifecycle email has the legal links (html + text); the reminder also carries the bearer notice', () => {
    const ctx = eveContext()
    for (const type of NOTIFICATION_TYPES) {
      const e = buildLifecycleEmail({ ...LIFE, type, product: ctx })
      expect(hrefs(e.html)).toEqual(expect.arrayContaining([`${EVE_BASE}/terms`, `${EVE_BASE}/privacy`, `${EVE_BASE}/refunds`]))
      expect(e.text).toContain(`Refunds & cancellations: ${EVE_BASE}/refunds`)
    }
    const reminder = buildLifecycleEmail({ ...LIFE, type: 'EVENT_REMINDER', product: ctx })
    expect(reminder.html).toContain('Anyone with these links can access your tickets. Keep them private.')
    expect(reminder.text).toContain('Anyone with these links can access your tickets. Keep them private.')
    expect(buildLifecycleEmail({ ...LIFE, type: 'ORDER_CANCELLED', product: ctx }).html).not.toContain('Anyone with these links')
  })

  it('the Support link is omitted (never a placeholder address) when no real support address is configured', () => {
    for (const bad of [undefined, 'support@eve.invalid', 'not an address']) {
      const links = eveFooterLinks(EVE_BASE, bad)
      expect(links.map(l => l.label)).toEqual(['Terms', 'Privacy', 'Refunds & cancellations'])
    }
    expect(JSON.stringify(buildTicketEmail({ ...TICKET, product: eveContext(null) }).html)).not.toContain('mailto:')
  })

  it('BrainBase emails are unchanged: no legal links, no bearer notice', () => {
    const t = buildTicketEmail(TICKET).html
    expect(t).not.toMatch(/Anyone with (this|these)|\/terms|\/privacy|\/refunds/)
    for (const type of NOTIFICATION_TYPES) {
      const e = buildLifecycleEmail({ ...LIFE, type })
      expect(e.html + e.text).not.toMatch(/Anyone with these|\/terms|\/privacy|\/refunds/)
    }
  })

  it('no marketing language or tracking in Eve emails', () => {
    const html = buildTicketEmail({ ...TICKET, product: eveContext() }).html + buildLifecycleEmail({ ...LIFE, type: 'EVENT_REMINDER', product: eveContext() }).html
    expect(html).not.toMatch(/unsubscribe|newsletter|special offer|<img[^>]*(pixel|track)|utm_/i)
  })
})

describe('CRM disclosure boundary (buyer contact only; no marketing consent; no answers)', () => {
  const sync = read('lib/crm/eventSync.ts')

  it('the contact insert writes exactly name, email, phone, a fixed note and the classification', () => {
    const inserts = [...sync.matchAll(/INSERT INTO crm_contacts \(([^)]*)\)/g)].map(m => m[1].replace(/\s+/g, ' ').trim())
    expect(inserts.length).toBeGreaterThanOrEqual(2)
    for (const cols of inserts) expect(cols).toBe('organisation_id, first_name, last_name, email, phone, notes, classification')
  })

  it('no marketing / consent / subscription / opt-in field is written or inferred', () => {
    const code = sync.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/marketing|consent|opt_?in|opt_?out|subscri|newsletter|unsubscribe|spam/i)
    expect(read('lib/crm/classification.ts')).not.toMatch(/marketing|consent|opt_?in/i)
  })

  it('the Eve free and paid paths pass only the purchaser name, email and phone to the CRM hook', () => {
    const src = read('lib/ticketing/publicApi.ts').replace(/\r?\n/g, '\n')
    for (const hook of ['syncEventOrderContact({']) {
      let idx = src.indexOf(hook)
      let seen = 0
      while (idx !== -1) {
        const block = src.slice(idx, src.indexOf('});', idx) + 3)
        expect(block).toContain('purchaserName: validated.purchaser_name')
        expect(block).toContain('purchaserEmail: validated.purchaser_email')
        expect(block).toContain('purchaserPhone: validated.purchaser_phone')
        expect(block).not.toMatch(/attendees|responses|answers|accept_terms/)
        seen += 1
        idx = src.indexOf(hook, idx + 1)
      }
      expect(seen).toBeGreaterThanOrEqual(2)
    }
  })

  it('registration answers are never written to CRM (no response table is referenced)', () => {
    expect(sync).not.toMatch(/event_registration_responses|event_registration_questions|answer_json/)
  })
})

// ─── Schema gate: acceptance snapshot + EVENT_UPDATED ──────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) { if (!['node_modules', '.next'].includes(e.name)) walk(rel, out) } else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel)
  }
  return out
}

// The lib/ + app/ tree is walked and read ONCE and shared by every test in this
// block: re-reading ~1000 files per test timed out (5s) when the full suite ran
// in parallel on a loaded machine.
let CORPUS: Map<string, string> | null = null
const corpus = (): Map<string, string> => (CORPUS ??= new Map([...walk('lib'), ...walk('app')].map(f => [f, read(f)] as [string, string])))
const SLOW = 60_000

describe('legal acceptance snapshot — write-once, server-side only', () => {
  it('no application SQL ever UPDATEs the acceptance columns (retry, webhook and refund cannot alter them)', () => {
    for (const [f, src] of corpus()) {
      for (const m of src.matchAll(/UPDATE\s+event_orders[\s\S]*?(?:WHERE|RETURNING|`)/g)) {
        expect(m[0], `${f} must not update acceptance columns`).not.toMatch(/terms_accepted_at|terms_version|refunds_version/)
      }
    }
  }, SLOW)

  it('only paidCheckout writes the columns, in the order INSERT, with the DB clock', () => {
    const writers = [...corpus()].filter(([, src]) => /terms_accepted_at/.test(src)).map(([f]) => f)
    expect(writers).toEqual(['lib/events/services/paidCheckout.ts'])
    const src = read('lib/events/services/paidCheckout.ts')
    expect(src).toMatch(/CASE WHEN \$\{legalAcceptance != null\}::boolean THEN NOW\(\) ELSE NULL END/)
    expect(src).not.toMatch(/terms_accepted_at\s*=/)
  }, SLOW)

  it('only the Eve S2S checkout passes legalAcceptance; BrainBase public routes never do', () => {
    const callers = [...corpus()].filter(([f, src]) => /legalAcceptance/.test(src) && f !== 'lib/events/services/paidCheckout.ts').map(([f]) => f)
    expect(callers).toEqual(['lib/ticketing/publicApi.ts'])
    expect(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts')).not.toMatch(/legalAcceptance|accept_terms/)
  }, SLOW)

  it('Eve renders the same version constant that the server stamps', () => {
    expect(read('apps/eve/config/legal.ts')).toMatch(/LEGAL_DOCUMENT_VERSION = EVE_LEGAL_DOCUMENT_VERSION/)
  })
})

describe('EVENT_UPDATED — source contracts', () => {
  const noComments = (t: string) => t.split(/\r?\n/).filter(l => !l.trim().startsWith('//')).join(' ')
  const route = read('app/api/events/[id]/route.ts')

  it('the change version is the committed updated_at (strictly increasing), not a hash of the new values', () => {
    expect(route).toMatch(/FOR UPDATE/)
    expect(route).toMatch(/GREATEST\(clock_timestamp\(\), prev\.updated_at \+ interval '1 microsecond'\)/)
    expect(route).toMatch(/floor\(extract\(epoch FROM e\.updated_at\) \* 1000000\)::bigint::text AS __change_version/)
    expect(route).not.toMatch(/sha256|createHash|digest\(/i)
    expect(read('lib/events/notifications.ts')).not.toMatch(/sha256|createHash|digest\(/i)
  })

  it('only starts_at / ends_at / venue are material, and only PUBLISHED -> PUBLISHED notifies', () => {
    const block = noComments(route.slice(route.indexOf('Material event-change notice')))
    expect(block).toMatch(/__prev_status === 'PUBLISHED' && updated\.status === 'PUBLISHED'/)
    expect(block).toMatch(/beforeSnap\.starts_at !== afterSnap\.starts_at \|\| beforeSnap\.ends_at !== afterSnap\.ends_at \|\| beforeSnap\.venue !== afterSnap\.venue/)
    expect(block).not.toMatch(/description|artwork|name !==|reminder_enabled/)
  })

  it('internal change columns never reach the response; sending is bounded and best-effort', () => {
    expect(route).toMatch(/const \{ __prev_starts_at, __prev_ends_at, __prev_venue, __prev_status, __change_version, __changed_at, \.\.\.updated \}/)
    expect(route).toMatch(/scheduledIds\.slice\(0, EVENT_UPDATED_INLINE_SEND_LIMIT\)/)
    expect(route).toMatch(/event-updated notifications failed after the event was updated/)
  })

  it('the payload carries only before/after/change_version (no purchaser, token or config fields)', () => {
    const n = read('lib/events/notifications.ts')
    const type = noComments(n.slice(n.indexOf('export type EventUpdatedSnapshot'), n.indexOf('export function buildEventUpdatedIdempotencyKey')))
    expect(type).not.toMatch(/email|name|token|secret|phone|order/i)
  })

  it('EVENT_UPDATED is in the shared vocabulary and the migration, and the migration is not wired into any automatic runner', () => {
    expect(NOTIFICATION_TYPES).toContain('EVENT_UPDATED')
    expect(read('scripts/add-events-notification-event-updated.sql')).toMatch(/'EVENT_UPDATED'/)
    for (const f of ['package.json', 'vercel.json']) {
      expect(read(f)).not.toMatch(/add-events-notification-event-updated|add-events-order-legal-acceptance/)
    }
  })
})
