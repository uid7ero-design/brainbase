import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase 7 — "Resend ticket email". Pure template tests: buildTicketEmail()
// takes only server-derived domain data (event name, purchaser name,
// attendee name + existing ticket token pairs) and returns a subject +
// HTML string, with no network/DB touched — no mocking is needed to
// exercise it directly. A separate file (eventsTicketEmailSend.test.ts)
// covers sendTicketEmail()'s provider-result semantics; a third
// (eventsTicketEmailResendRoute.test.ts) covers the route itself.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

process.env.NEXT_PUBLIC_APP_URL = 'https://www.thebrainbase.com.au'

const { buildTicketEmail } = await import('@/lib/events/ticketEmail')

describe('buildTicketEmail — single attendee', () => {
  const email = buildTicketEmail({
    eventName: 'Spring Gala',
    purchaserName: 'Jane Doe',
    attendees: [{ name: 'Jane Doe', ticketToken: 'a'.repeat(64) }],
  })

  it('subject names the event, singular wording for one attendee', () => {
    expect(email.subject).toBe('Your ticket for Spring Gala')
  })

  it('includes exactly one ticket URL built from the existing token', () => {
    const matches = email.html.match(/https:\/\/www\.thebrainbase\.com\.au\/t\/[a-f0-9]{64}/g) ?? []
    expect(matches).toHaveLength(1)
    expect(matches[0]).toBe(`https://www.thebrainbase.com.au/t/${'a'.repeat(64)}`)
  })

  it('includes the BrainBase email layout shell', () => {
    expect(email.html).toContain('BRAINB')
    expect(email.html).toContain('<!DOCTYPE html>')
  })

  it('includes the purchaser and attendee name', () => {
    expect(email.html).toContain('Jane Doe')
  })
})

describe('buildTicketEmail — multiple attendees', () => {
  const email = buildTicketEmail({
    eventName: 'Spring Gala',
    purchaserName: 'Jane Doe',
    attendees: [
      { name: 'Jane Doe', ticketToken: 'a'.repeat(64) },
      { name: 'Bob Smith', ticketToken: 'b'.repeat(64) },
    ],
  })

  it('subject uses plural wording for multiple attendees', () => {
    expect(email.subject).toBe('Your tickets for Spring Gala')
  })

  it('includes one ticket URL per attendee, each with the correct existing token', () => {
    expect(email.html).toContain(`https://www.thebrainbase.com.au/t/${'a'.repeat(64)}`)
    expect(email.html).toContain(`https://www.thebrainbase.com.au/t/${'b'.repeat(64)}`)
    const matches = email.html.match(/\/t\/[a-f0-9]{64}/g) ?? []
    expect(matches).toHaveLength(2)
  })

  it('includes both attendee names', () => {
    expect(email.html).toContain('Jane Doe')
    expect(email.html).toContain('Bob Smith')
  })
})

describe('buildTicketEmail — escaping', () => {
  const email = buildTicketEmail({
    eventName: '<b>Gala</b> & Friends',
    purchaserName: '<script>alert(1)</script>',
    attendees: [{ name: 'A & B <Co>', ticketToken: 'c'.repeat(64) }],
  })

  it('escapes the event name', () => {
    expect(email.html).not.toContain('<b>Gala</b>')
    expect(email.html).toContain('&lt;b&gt;Gala&lt;/b&gt; &amp; Friends')
  })

  it('escapes the purchaser name', () => {
    expect(email.html).not.toContain('<script>alert(1)</script>')
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes attendee names', () => {
    expect(email.html).not.toContain('A & B <Co>')
    expect(email.html).toContain('A &amp; B &lt;Co&gt;')
  })
})

describe('buildTicketEmail — exclusions (privacy)', () => {
  const email = buildTicketEmail({
    eventName: 'Spring Gala',
    purchaserName: 'Jane Doe',
    attendees: [{ name: 'Jane Doe', ticketToken: 'd'.repeat(64) }],
  })

  it('never includes the raw ticket token separately from its link', () => {
    // The token appears exactly once, inside the /t/<token> URL — never
    // printed on its own elsewhere in the email body.
    const bareTokenOccurrences = (email.html.match(new RegExp('d'.repeat(64), 'g')) ?? []).length
    expect(bareTokenOccurrences).toBe(1)
  })

  it('contains no registration-answer, note, or internal-metadata vocabulary', () => {
    const forbidden = ['stripe', 'crm_contact', 'event_registration_responses', 'event_order_notes', 'payment_intent', 'organisation_id']
    const lower = email.html.toLowerCase()
    for (const word of forbidden) expect(lower).not.toContain(word)
  })
})

describe('lib/events/ticketEmail.ts — source-level privacy guarantees (§12)', () => {
  const src = read('lib/events/ticketEmail.ts')
  // Comments legitimately NAME the excluded categories (e.g. "never
  // Stripe ids", "the existing token (lib/events/ticketToken.ts)") to
  // document what this file deliberately stays away from — the
  // guarantee that matters is about the CODE, so these checks strip
  // comments first (matching the established pattern in
  // eventsPhase3Ticketing.test.ts and eventsDropdownConsistency.test.ts).
  const code = stripComments(src)

  it('never references event_registration_responses', () => {
    expect(code).not.toContain('event_registration_responses')
  })

  it('never references event_order_notes', () => {
    expect(code).not.toContain('event_order_notes')
  })

  it('never imports from or calls generateTicketToken', () => {
    expect(code).not.toContain("from '@/lib/events/ticketToken'")
    expect(code).not.toContain('generateTicketToken(')
  })

  it('never imports Stripe or references a Stripe id field', () => {
    expect(code.toLowerCase()).not.toContain('stripe')
  })
})

describe('maskEmailForAudit', () => {
  it('masks the local part after the first character', async () => {
    const { maskEmailForAudit } = await import('@/lib/events/ticketEmail')
    expect(maskEmailForAudit('jane@example.com')).toBe('j***@example.com')
  })

  it('never returns the full email unmasked', async () => {
    const { maskEmailForAudit } = await import('@/lib/events/ticketEmail')
    const email = 'purchaser@brainbase.app'
    expect(maskEmailForAudit(email)).not.toBe(email)
  })
})

// ─── Booking wallet — "View all tickets" CTA ────────────────────────

describe('buildTicketEmail — booking wallet CTA, single attendee', () => {
  it('primary CTA remains "View ticket" (no wallet link) for a single-attendee order, even when a bookingToken is supplied', () => {
    const email = buildTicketEmail({
      eventName: 'Spring Gala', purchaserName: 'Jane Doe',
      attendees: [{ name: 'Jane Doe', ticketToken: 'a'.repeat(64) }],
      bookingToken: 'b'.repeat(64),
    })
    expect(email.html).not.toContain('View all tickets')
    expect(email.html).not.toContain('/b/')
    expect(email.html).toContain('View ticket')
  })
})

describe('buildTicketEmail — booking wallet CTA, multiple attendees with a booking token', () => {
  const email = buildTicketEmail({
    eventName: 'Spring Gala', purchaserName: 'Jane Doe',
    attendees: [
      { name: 'Jane Doe', ticketToken: 'a'.repeat(64) },
      { name: 'Bob Smith', ticketToken: 'b'.repeat(64) },
    ],
    bookingToken: 'c'.repeat(64),
  })

  it('primary CTA is "View all tickets" pointing at /b/<bookingToken>/tickets', () => {
    expect(email.html).toContain('View all tickets')
    expect(email.html).toContain(`https://www.thebrainbase.com.au/b/${'c'.repeat(64)}/tickets`)
  })

  it('individual attendee ticket links are still present beneath the wallet CTA — unchanged count/shape', () => {
    expect(email.html).toContain(`https://www.thebrainbase.com.au/t/${'a'.repeat(64)}`)
    expect(email.html).toContain(`https://www.thebrainbase.com.au/t/${'b'.repeat(64)}`)
    const individualMatches = email.html.match(/\/t\/[a-f0-9]{64}/g) ?? []
    expect(individualMatches).toHaveLength(2)
  })

  it('the wallet CTA link never appears inside the individual-ticket table rows — it is its own separate element', () => {
    const ctaIndex = email.html.indexOf('View all tickets')
    // The individual-ticket rows table specifically (emailLayout()'s
    // own outer layout table, if any, is a separate concern — this
    // locates the exact table buildTicketEmail() itself renders the
    // per-attendee rows into).
    const ticketTableIndex = email.html.indexOf("width:100%;border-collapse:collapse;margin:0 0 8px")
    expect(ctaIndex).toBeGreaterThan(-1)
    expect(ticketTableIndex).toBeGreaterThan(-1)
    expect(ctaIndex).toBeLessThan(ticketTableIndex)
  })
})

describe('buildTicketEmail — booking wallet CTA, multiple attendees WITHOUT a booking token (historical order)', () => {
  it('degrades safely to individual-links-only — no broken/empty wallet link is ever emitted', () => {
    const email = buildTicketEmail({
      eventName: 'Spring Gala', purchaserName: 'Jane Doe',
      attendees: [
        { name: 'Jane Doe', ticketToken: 'a'.repeat(64) },
        { name: 'Bob Smith', ticketToken: 'b'.repeat(64) },
      ],
      bookingToken: null,
    })
    expect(email.html).not.toContain('View all tickets')
    expect(email.html).not.toContain('/b/')
    expect(email.html).toContain(`https://www.thebrainbase.com.au/t/${'a'.repeat(64)}`)
    expect(email.html).toContain(`https://www.thebrainbase.com.au/t/${'b'.repeat(64)}`)
  })

  it('same safe degradation when bookingToken is simply omitted (undefined)', () => {
    const email = buildTicketEmail({
      eventName: 'Spring Gala', purchaserName: 'Jane Doe',
      attendees: [
        { name: 'Jane Doe', ticketToken: 'a'.repeat(64) },
        { name: 'Bob Smith', ticketToken: 'b'.repeat(64) },
      ],
    })
    expect(email.html).not.toContain('View all tickets')
  })
})

describe('Booking wallet URL builder — not co-located with QR-adjacent buildTicketUrl', () => {
  it('lib/events/ticketEmail.ts defines its own buildBookingWalletUrl rather than importing one from lib/events/qr.ts', () => {
    const code = stripComments(read('lib/events/ticketEmail.ts'))
    expect(code).toMatch(/function buildBookingWalletUrl/)
    expect(code).toMatch(/\/b\/\$\{bookingToken\}\/tickets/)
  })

  it('lib/events/qr.ts is never modified to know about booking tokens — QR payload construction is untouched', () => {
    const qrCode = stripComments(read('lib/events/qr.ts'))
    expect(qrCode).not.toMatch(/booking/i)
  })
})

describe('Resend route — reads booking_token, never mints one', () => {
  const routeCode = stripComments(read('app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts'))

  it('selects eo.booking_token in its order query', () => {
    expect(routeCode).toMatch(/eo\.booking_token/)
  })

  it('passes booking_token straight through to sendTicketEmail without calling generateBookingToken', () => {
    expect(routeCode).toMatch(/bookingToken:\s*order\.booking_token/)
    expect(routeCode).not.toMatch(/generateBookingToken/)
  })
})
