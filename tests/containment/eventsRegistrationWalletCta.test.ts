import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

// Tiny isolated fix — the free-registration confirmation screen can now
// show a "View all tickets" booking-wallet CTA for a genuinely
// multi-attendee order. The booking_token was already minted and
// persisted inside the SAME existing registration transaction (see
// eventsPublicRegistration.test.ts's own "transaction structure"
// coverage, untouched by this change) — this file only proves the
// value is now also returned in the API response, threaded into
// PublicEventClient's confirmation state, and rendered as a CTA only
// when tickets.length > 1 AND a booking token is actually present.
// Mirrors eventsPublicRegistration.test.ts's own mocking pattern
// exactly (same file, same route) — see that file's own header comment
// for why sql.transaction() needs its own separate mock.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))

let transactionFinalResult: unknown[] = [{ order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }]
const transactionMock = vi.fn(async () => [[], [], [], [], transactionFinalResult])
;(sqlMock as unknown as { transaction: typeof transactionMock }).transaction = transactionMock

vi.mock('@/lib/db', () => ({ default: sqlMock }))

const checkCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, checkCapability: (...args: unknown[]) => checkCapabilityMock(...args) }
})

const checkRateLimitMock = vi.fn()
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args) }))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function resolveTransaction(finalResult: unknown[]) {
  transactionFinalResult = finalResult
  transactionMock.mockImplementationOnce(async () => [[], [], [], [], finalResult])
}

const registerRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/register/route')

const ORG_ROW = [{ id: 'org-a' }]
const PUBLISHED_EVENT_ROW = [{
  id: 'event-1', organisation_id: 'org-a', name: 'Graduation', slug: 'graduation',
  description: null, venue: 'Hall', starts_at: new Date('2026-12-01T10:00:00Z'),
  ends_at: new Date('2026-12-01T12:00:00Z'), timezone: 'Australia/Adelaide',
}]
const FREE_ACTIVE_TICKET_TYPE_ROW = [{ id: 'tt-1', active: true, price_cents: 0 }]

function req(body: unknown) {
  return asNextRequest(new Request('http://localhost/api/public/events/ld-tennis/graduation/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}
const CTX = { params: Promise.resolve({ organisationSlug: 'ld-tennis', eventSlug: 'graduation' }) }

const SINGLE_BODY = {
  ticket_type_id: 'tt-1', quantity: 1, purchaser_name: 'Jane Purchaser', purchaser_email: 'jane@example.com',
  attendees: [{ name: 'Attendee One' }],
}
const MULTI_BODY = {
  ticket_type_id: 'tt-1', quantity: 2, purchaser_name: 'Jane Purchaser', purchaser_email: 'jane@example.com',
  attendees: [{ name: 'Attendee One' }, { name: 'Attendee Two' }],
}

beforeEach(() => {
  sqlMock.mockClear()
  transactionMock.mockClear()
  checkCapabilityMock.mockReset()
  checkRateLimitMock.mockReset()
  responseQueue = []
  callCount = 0
  transactionFinalResult = [{ order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }]
  transactionMock.mockImplementation(async () => [[], [], [], [], transactionFinalResult])
  checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'events', config: {} } })
  checkRateLimitMock.mockReturnValue(true)
})

const TOKEN_HEX_64 = /^[a-f0-9]{64}$/

describe('Public registration API — booking_token in the success response', () => {
  it('a single-attendee registration still returns a booking_token (the token was always minted — only newly RETURNED)', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.booking_token).toMatch(TOKEN_HEX_64)
  })

  it('a multi-attendee registration returns a booking_token', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([
      { order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) },
      { order_id: 'order-1', attendee_name: 'Attendee Two', ticket_token: 'b'.repeat(64) },
    ])
    const res = await registerRoute.POST(req(MULTI_BODY), CTX)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.booking_token).toMatch(TOKEN_HEX_64)
  })

  it('the returned booking_token is the EXACT value bound into the order-insert statement — never a second, independently generated token', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    const body = await res.json()

    const calls = sqlMock.mock.calls as unknown as unknown[][]
    const insertCall = calls.find(call => (call[0] as TemplateStringsArray).join(' ').includes('INSERT INTO event_orders'))!
    const insertArgs = insertCall.slice(1)
    expect(insertArgs).toContain(body.booking_token)
  })

  it('existing confirmation_reference/quantity/tickets fields are unchanged', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    const body = await res.json()
    expect(body.confirmation_reference).toBe('order-1')
    expect(body.quantity).toBe(1)
    expect(body.tickets).toEqual([{ attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
  })

  it('no generateBookingToken/generateTicketToken call was added beyond what the route already made — source-level containment', () => {
    const code = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts'))
    const occurrences = (code.match(/generateBookingToken\(\)/g) ?? []).length
    expect(occurrences).toBe(1) // the one, pre-existing call — this fix reuses its result, never adds a second call
  })

  it('never exposes organisationId, raw settings, or purchaser email in the response', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_ACTIVE_TICKET_TYPE_ROW)
    resolveTransaction([{ order_id: 'order-1', attendee_name: 'Attendee One', ticket_token: 'a'.repeat(64) }])
    const res = await registerRoute.POST(req(SINGLE_BODY), CTX)
    const body = await res.json()
    const json = JSON.stringify(body)
    expect(json).not.toMatch(/organisationId|organisation_id|settings|jane@example\.com/)
  })
})

describe('PublicEventClient — confirmation state and wallet CTA (source-level containment)', () => {
  const src = read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx')
  const code = stripComments(src)

  it('confirmation state type gains an optional bookingToken field, preserving every existing field', () => {
    const stateDeclStart = code.indexOf('const [confirmation, setConfirmation] = useState<{')
    const stateDeclEnd = code.indexOf('>(null);', stateDeclStart)
    const stateDecl = code.slice(stateDeclStart, stateDeclEnd)
    expect(stateDecl).toMatch(/reference: string/)
    expect(stateDecl).toMatch(/quantity: number/)
    expect(stateDecl).toMatch(/tickets: \{ attendee_name: string; ticket_token: string \}\[\]/)
    expect(stateDecl).toMatch(/bookingToken\?: string/)
  })

  it('setConfirmation maps the response\'s snake_case booking_token onto the camelCase bookingToken state field', () => {
    expect(code).toMatch(/bookingToken: body\.booking_token \?\? undefined/)
  })

  it('the wallet CTA is gated on BOTH tickets.length > 1 AND bookingToken being present', () => {
    const gateIndex = code.indexOf('confirmation.tickets.length > 1 && confirmation.bookingToken')
    expect(gateIndex).toBeGreaterThan(-1)
  })

  it('the wallet CTA links to exactly /b/${bookingToken}/tickets', () => {
    expect(code).toMatch(/href=\{`\/b\/\$\{confirmation\.bookingToken\}\/tickets`\}/)
  })

  it('the booking token is never rendered as visible text — only used inside the href attribute', () => {
    const ctaStart = code.indexOf('confirmation.tickets.length > 1 && confirmation.bookingToken')
    const ctaEnd = code.indexOf(')}', ctaStart)
    const ctaBlock = code.slice(ctaStart, ctaEnd)
    // The only occurrence of bookingToken in this block must be inside
    // the href template literal, never as standalone rendered text
    // (e.g. {confirmation.bookingToken} on its own).
    const occurrences = (ctaBlock.match(/confirmation\.bookingToken/g) ?? []).length
    expect(occurrences).toBe(2) // the && gate, and the href interpolation — nowhere else
    expect(ctaBlock).not.toMatch(/>\s*\{confirmation\.bookingToken\}\s*</)
  })

  it('the wallet CTA does not render any QR/canvas element — no duplicate QR on the confirmation screen', () => {
    const ctaStart = code.indexOf('confirmation.tickets.length > 1 && confirmation.bookingToken')
    const ctaEnd = code.indexOf(')}', ctaStart)
    const ctaBlock = code.slice(ctaStart, ctaEnd)
    expect(ctaBlock).not.toMatch(/qrSvg|QRCode|<svg/i)
  })

  it('individual ticket links are still rendered independently of the wallet CTA (tickets.length > 0, not > 1)', () => {
    expect(code).toContain('confirmation.tickets.length > 0 && (')
  })

  // Phase 3E.2 — automatic initial ticket-email delivery shipped for
  // free registrations, so "No email has been sent" is no longer true
  // and was deliberately replaced (see
  // tests/containment/eventsFreeRegistrationTicketEmail.test.ts and
  // lib/events/ticketEmailDelivery.ts for the delivery side; this test
  // now proves the CONFIRMATION SCREEN's copy is the new, still-honest
  // best-effort wording — never a delivery guarantee, and still
  // pointing the purchaser at the saved link(s) as the fallback).
  it('the confirmation copy truthfully describes best-effort automatic email delivery — never a delivery guarantee', () => {
    expect(code).not.toContain('No email has been sent')
    expect(code).toMatch(/We.{1,10}ll also send your ticket details by email/)
    expect(code).toMatch(/in case it (doesn|does not).{1,10}t arrive/)
  })

  it('the copy no longer over-specifically says "ticket link(s)" only — generalised to "the link(s)" now that a wallet link may also be the thing saved, without implying email delivery exists', () => {
    // Phase 3E.2 remediation — a literal {' '} was inserted between the
    // singular/plural ternary and "above" (a live rendering bug: JSX
    // trims the leading space of a text segment that immediately
    // follows a `{expression}` on the same line, confirmed by directly
    // inspecting the rendered DOM's text nodes on Preview — the fix is
    // the standard React {' '} idiom, which forces a literal space
    // regardless of JSX's own whitespace-collapsing behaviour).
    expect(code).toMatch(/save the link\{confirmation\.tickets\.length === 1 \? '' : 's'\}\{' '\}above/)
    expect(code).not.toMatch(/save your ticket link/)
  })
})

describe('Strict scope — this fix touches only the two expected source files', () => {
  it('lib/events/ticketEmail.ts is untouched (no booking-wallet-CTA-shaped changes)', () => {
    const code = stripComments(read('lib/events/ticketEmail.ts'))
    expect(code).not.toMatch(/View all tickets.*confirmation|confirmation.*View all tickets/)
  })

  it('components/events/TicketCard.tsx is untouched', () => {
    const code = stripComments(read('components/events/TicketCard.tsx'))
    expect(code).not.toMatch(/confirmation_reference|PublicEventClient/)
  })
})
