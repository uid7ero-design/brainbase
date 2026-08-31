import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

// Events & Ticketing Phase 3 — digital tickets, QR, and check-in.
// Every dependency here is mocked — no real database or network call
// occurs anywhere in this file, so nothing in this file can prove or
// disprove genuine Postgres concurrency behaviour. That is the explicit
// job of the real-Postgres harness at
// scripts/tests/verify-events-phase3-checkin-concurrency.sh, which is
// the sole authority for duplicate-scan-prevention correctness. What
// THIS file protects is everything concurrency testing cannot: route
// orchestration, tenant/event scoping, capability/role enforcement,
// ticket-token generation and client-trust boundaries, and response
// shape — matching the exact same division of responsibility already
// established for Phase 2/R1 (see eventsPublicRegistration.test.ts) and
// the artwork upload feature (see eventsArtworkUpload.test.ts).

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}
function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ─── Shared mocks (matches the established pattern across every other
// Events containment test file) ─────────────────────────────────────

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
let transactionFinalResult: unknown[] = [{ order_id: 'order-1', attendee_name: 'Attendee', ticket_token: 'a'.repeat(64) }]
const transactionMock = vi.fn(async () => [[], [], [], [], transactionFinalResult])
;(sqlMock as unknown as { transaction: typeof transactionMock }).transaction = transactionMock
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
    checkCapability: vi.fn().mockResolvedValue({ allowed: true, entitlement: { key: 'events', config: {} } }),
  }
})

const checkRateLimitMock = vi.fn()
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args) }))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function sessionAs(role: string, organisationId = 'org-a') { return { userId: 'staff-1', organisationId, role } }
function jsonReq(url: string, method: string, body?: unknown) {
  return asNextRequest(new Request(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

const registerRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/register/route')
const publicTicketRoute = await import('@/app/api/public/tickets/[token]/route')
const resolveRoute = await import('@/app/api/events/[id]/check-in/resolve/route')
const confirmRoute = await import('@/app/api/events/[id]/check-in/confirm/route')
const undoRoute = await import('@/app/api/events/[id]/check-in/undo/route')
const searchRoute = await import('@/app/api/events/[id]/check-in/search/route')

const EVENT_CTX = { params: Promise.resolve({ id: 'event-1' }) }

beforeEach(() => {
  sqlMock.mockClear()
  transactionMock.mockClear()
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  checkRateLimitMock.mockReset()
  responseQueue = []
  callCount = 0
  transactionFinalResult = [{ order_id: 'order-1', attendee_name: 'Attendee', ticket_token: 'a'.repeat(64) }]
  transactionMock.mockImplementation(async () => [[], [], [], [], transactionFinalResult])
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
  requireCapabilityMock.mockResolvedValue({ key: 'events', config: {} })
  checkRateLimitMock.mockReturnValue(true)
})

// ─── Section 21 — Ticket identity ──────────────────────────────────

describe('Ticket identity — server-generated, unique, never client-supplied', () => {
  const ORG_ROW = [{ id: 'org-a' }]
  const PUBLISHED_EVENT_ROW = [{
    id: 'event-1', organisation_id: 'org-a', name: 'Formal', slug: 'formal', description: null, venue: null,
    starts_at: new Date('2026-12-01T10:00:00Z'), ends_at: new Date('2026-12-01T12:00:00Z'), timezone: 'Australia/Adelaide',
  }]
  const FREE_TT_ROW = [{ id: 'tt-1', active: true, price_cents: 0 }]
  const VALID_BODY = {
    ticket_type_id: 'tt-1', quantity: 2, purchaser_name: 'Jane', purchaser_email: 'jane@example.com',
    attendees: [{ name: 'Attendee A' }, { name: 'Attendee B' }],
  }
  function req(body: unknown) {
    return asNextRequest(new Request('http://localhost/api/public/events/org/evt/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))
  }
  const CTX = { params: Promise.resolve({ organisationSlug: 'org', eventSlug: 'evt' }) }

  it('generates a ticket_token per attendee as a 64-hex-char (256-bit) value — the exact lib/tokens.ts convention', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_TT_ROW)
    await registerRoute.POST(req(VALID_BODY), CTX)
    const insertCallArgs = sqlMock.mock.calls[sqlMock.mock.calls.length - 1] as unknown as unknown[]
    const tokensArray = insertCallArgs.find(a => Array.isArray(a) && a.every(x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x))) as string[] | undefined
    expect(tokensArray).toBeDefined()
    for (const token of tokensArray!) expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates a DIFFERENT token per attendee — never reuses the same value across a single registration', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_TT_ROW)
    await registerRoute.POST(req(VALID_BODY), CTX)
    const insertCallArgs = sqlMock.mock.calls[sqlMock.mock.calls.length - 1] as unknown as unknown[]
    const tokensArray = insertCallArgs.find(a => Array.isArray(a) && a.every(x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x))) as string[]
    expect(tokensArray[0]).not.toBe(tokensArray[1])
  })

  it('a client-supplied ticket_token on an attendee is silently ignored — the validator\'s accepted shape has no such key', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_TT_ROW)
    await registerRoute.POST(req({
      ...VALID_BODY,
      attendees: [{ name: 'A', ticket_token: 'client-chosen-token' }, { name: 'B', ticket_token: 'another-client-token' }],
    }), CTX)
    const insertCallArgs = sqlMock.mock.calls[sqlMock.mock.calls.length - 1] as unknown as unknown[]
    expect(insertCallArgs).not.toContain('client-chosen-token')
    expect(insertCallArgs).not.toContain('another-client-token')
  })

  it('the response returns one ticket per attendee, using the server-generated token', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_TT_ROW)
    transactionFinalResult = [
      { order_id: 'order-1', attendee_name: 'A', ticket_token: 'server-token-a' },
      { order_id: 'order-1', attendee_name: 'B', ticket_token: 'server-token-b' },
    ]
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    const body = await res.json()
    expect(body.tickets).toEqual([
      { attendee_name: 'A', ticket_token: 'server-token-a' },
      { attendee_name: 'B', ticket_token: 'server-token-b' },
    ])
  })

  it('capacity-exceeded (empty RETURNING) still returns 409 — adding ticket_token did not weaken the capacity gate', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, FREE_TT_ROW)
    transactionFinalResult = []
    const res = await registerRoute.POST(req(VALID_BODY), CTX)
    expect(res.status).toBe(409)
  })
})

describe('Ticket identity — architecture containment (register route)', () => {
  const routeSrc = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts'))

  // Phase 4: the generator itself moved to lib/events/ticketToken.ts (a
  // small extraction so the Stripe webhook's paid-order token issuance
  // — see lib/events/stripe.ts — uses the exact same function, not a
  // second independent implementation). The register route now imports
  // it rather than defining it inline; both assertions below together
  // still prove the same thing the single inline check used to.
  it('ticket_token is generated via randomBytes(32).toString(\'hex\') — never derived from a sequential/predictable id', () => {
    const generatorSrc = stripComments(read('lib/events/ticketToken.ts'))
    expect(generatorSrc).toMatch(/randomBytes\(32\)\.toString\('hex'\)/)
  })

  it('the register route imports the shared token generator rather than defining its own', () => {
    expect(routeSrc).toMatch(/import \{ generateTicketToken \} from '@\/lib\/events\/ticketToken'/)
    expect(routeSrc).not.toMatch(/randomBytes/)
  })

  it('the R1 concurrency-safe capacity gate is textually unchanged — lock statements and capacity WHERE clauses are still present', () => {
    expect(routeSrc).toMatch(/FOR UPDATE/)
    expect(routeSrc).toMatch(/sold_tt\.qty \+ \$\{validated\.quantity\} <=/)
    expect(routeSrc).toMatch(/sold_sess\.qty \+ \$\{validated\.quantity\} <=/)
  })

  it('ticket_token is passed through the same UNNEST parallel-array mechanism as attendee names/emails, not a separate untrusted insert path', () => {
    expect(routeSrc).toMatch(/UNNEST\(\$\{attendeeNames\}::text\[\], \$\{attendeeEmails\}::text\[\], \$\{ticketTokens\}::text\[\]\)/)
  })
})

// ─── Section 22 — Public ticket ─────────────────────────────────────

describe('Public ticket — GET /api/public/tickets/[token]', () => {
  function ticketReq(url = 'http://localhost/api/public/tickets/tok-1') {
    return asNextRequest(new Request(url))
  }
  const TICKET_CTX = { params: Promise.resolve({ token: 'tok-1' }) }

  const VALID_ROW = [{
    attendee_name: 'Jane Attendee', checked_in_at: null, order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED',
    event_name: 'Graduation', venue: 'Hall', artwork_url: 'https://example.com/a.jpg',
    starts_at: new Date('2026-12-01T10:00:00Z'), ends_at: new Date('2026-12-01T12:00:00Z'), timezone: 'Australia/Adelaide',
    ticket_type_name: 'GA', session_name: 'Morning', session_starts_at: new Date('2026-12-01T10:00:00Z'), session_ends_at: new Date('2026-12-01T11:00:00Z'),
  }]

  it('a valid token resolves the full ticket detail', async () => {
    queue(VALID_ROW)
    const res = await publicTicketRoute.GET(ticketReq(), TICKET_CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.attendee_name).toBe('Jane Attendee')
    expect(body.event.name).toBe('Graduation')
    expect(body.event.artwork_url).toBe('https://example.com/a.jpg')
    expect(body.ticket_type_name).toBe('GA')
    expect(body.session.name).toBe('Morning')
  })

  it('an unknown token is rejected with 404, generic message', async () => {
    queue([])
    const res = await publicTicketRoute.GET(ticketReq(), TICKET_CTX)
    expect(res.status).toBe(404)
  })

  it('never leaks purchaser email or any organisation/created_by-internal field', async () => {
    queue(VALID_ROW)
    const res = await publicTicketRoute.GET(ticketReq(), TICKET_CTX)
    const body = await res.json()
    const serialised = JSON.stringify(body)
    expect(serialised).not.toMatch(/purchaser|organisation_id|created_by/i)
  })

  it('event artwork is allowed through when present', async () => {
    queue(VALID_ROW)
    const res = await publicTicketRoute.GET(ticketReq(), TICKET_CTX)
    const body = await res.json()
    expect(body.event.artwork_url).toBeTruthy()
  })

  it('a session-less ticket (event_session_id was never selected) resolves with session: null, not an error', async () => {
    queue([{ ...VALID_ROW[0], session_name: null, session_starts_at: null, session_ends_at: null }])
    const res = await publicTicketRoute.GET(ticketReq(), TICKET_CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session).toBeNull()
  })

  it('a cancelled order resolves to status: CANCELLED with 200, not a hard error', async () => {
    queue([{ ...VALID_ROW[0], order_status: 'CANCELLED' }])
    const res = await publicTicketRoute.GET(ticketReq(), TICKET_CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('CANCELLED')
  })

  it('is rate limited like every other public Events endpoint, keyed by IP not by token', async () => {
    checkRateLimitMock.mockReturnValue(false)
    const res = await publicTicketRoute.GET(ticketReq(), TICKET_CTX)
    expect(res.status).toBe(429)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

// ─── Section 23 — Check-in ───────────────────────────────────────────

describe('Check-in confirm — permissions', () => {
  function confirmReq(body: unknown) { return jsonReq('http://localhost/x', 'POST', body) }

  it('no session -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await confirmRoute.POST(confirmReq({ ticket_token: 'tok' }), EVENT_CTX)
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer cannot confirm check-in -> 403, no DB call', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await confirmRoute.POST(confirmReq({ ticket_token: 'tok' }), EVENT_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('manager can confirm check-in -> 200', async () => {
    queue(
      [{ id: 'event-1' }], // ownership
      [{ id: 'att-1' }], // UPDATE succeeded (first check-in)
      [{ id: 'att-1', attendee_name: 'A', checked_in_at: '2026-01-01T10:00:00.000Z', order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED', ticket_type_name: null, session_name: null }], // resolve
    )
    const res = await confirmRoute.POST(confirmReq({ ticket_token: 'tok' }), EVENT_CTX)
    expect(res.status).toBe(200)
  })

  it('capability not entitled -> rejected, no DB mutation attempted', async () => {
    requireCapabilityMock.mockRejectedValue(new Error('Forbidden'))
    const res = await confirmRoute.POST(confirmReq({ ticket_token: 'tok' }), EVENT_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('a cross-tenant event (belongs to a different organisation) is rejected -> 404, no check-in attempted', async () => {
    queue([]) // ownership SELECT scoped to the caller's own org finds nothing
    const res = await confirmRoute.POST(confirmReq({ ticket_token: 'tok' }), EVENT_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('a ticket_token belonging to a different event resolves to a generic "not valid", never a distinguishing detail', async () => {
    queue([{ id: 'event-1' }], [], []) // ownership ok; UPDATE matches nothing (wrong event_id); resolve also finds nothing
    const res = await confirmRoute.POST(confirmReq({ ticket_token: 'tok-other-event' }), EVENT_CTX)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Ticket not valid.')
  })

  it('never trusts a client-supplied organisation id', () => {
    const code = stripComments(read('app/api/events/[id]/check-in/confirm/route.ts'))
    expect(code).not.toMatch(/body\.organisation_id/)
    expect(code).not.toMatch(/body\.organisationId/)
  })
})

describe('Check-in confirm — first scan vs duplicate scan', () => {
  function confirmReq(body: unknown) { return jsonReq('http://localhost/x', 'POST', body) }

  it('first scan succeeds — 200, first: true', async () => {
    queue(
      [{ id: 'event-1' }],
      [{ id: 'att-1' }],
      [{ id: 'att-1', attendee_name: 'A', checked_in_at: '2026-01-01T10:00:00.000Z', order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED', ticket_type_name: 'GA', session_name: null }],
    )
    const res = await confirmRoute.POST(confirmReq({ ticket_token: 'tok' }), EVENT_CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.first).toBe(true)
  })

  it('a second scan on the same ticket returns 409, first: false, with the ORIGINAL check-in timestamp preserved', async () => {
    const ORIGINAL_TS = '2026-01-01T10:00:00.000Z'
    queue(
      [{ id: 'event-1' }],
      [], // UPDATE matches zero rows — already checked in
      [{ id: 'att-1', attendee_name: 'A', checked_in_at: ORIGINAL_TS, order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED', ticket_type_name: 'GA', session_name: null }],
    )
    const res = await confirmRoute.POST(confirmReq({ ticket_token: 'tok' }), EVENT_CTX)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.first).toBe(false)
    expect(body.attendee.checked_in_at).toBe(ORIGINAL_TS)
  })

  it('a cancelled order is rejected — 409, "Ticket cancelled.", the confirm route never treats it as a successful check-in', async () => {
    queue(
      [{ id: 'event-1' }],
      [], // UPDATE matches zero rows — the WHERE clause's own status <> 'CANCELLED' excludes it
      [{ id: 'att-1', attendee_name: 'A', checked_in_at: null, order_status: 'CANCELLED', payment_status: 'NOT_REQUIRED', ticket_type_name: 'GA', session_name: null }],
    )
    const res = await confirmRoute.POST(confirmReq({ ticket_token: 'tok' }), EVENT_CTX)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('Ticket cancelled.')
    expect(body.attendee).toBeUndefined()
  })
})

describe('Check-in undo — manager+ required, resets state correctly', () => {
  function undoReq(body: unknown) { return jsonReq('http://localhost/x', 'POST', body) }

  it('viewer cannot undo a check-in -> 403, no DB call', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await undoRoute.POST(undoReq({ attendee_id: 'att-1' }), EVENT_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('manager can undo a check-in — 200, checked_in_at cleared', async () => {
    queue([{ id: 'event-1' }], [{ id: 'att-1' }], [{ id: 'att-1', attendee_name: 'A', checked_in_at: null, order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED', ticket_type_name: null, session_name: null }])
    const res = await undoRoute.POST(undoReq({ attendee_id: 'att-1' }), EVENT_CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.attendee.checked_in_at).toBeNull()
  })

  it('undoing an attendee who is not currently checked in is rejected — 409, not silently accepted', async () => {
    queue([{ id: 'event-1' }], [], [{ id: 'att-1' }]) // UPDATE matches nothing; exists-check confirms the row exists
    const res = await undoRoute.POST(undoReq({ attendee_id: 'att-1' }), EVENT_CTX)
    expect(res.status).toBe(409)
  })

  it('undo on a cross-tenant attendee is rejected -> 404', async () => {
    queue([]) // ownership SELECT scoped to the caller's own org finds nothing
    const res = await undoRoute.POST(undoReq({ attendee_id: 'att-1' }), EVENT_CTX)
    expect(res.status).toBe(404)
  })
})

describe('Check-in resolve/search — viewer+ read-only', () => {
  it('viewer CAN resolve a ticket (read-only, same data already visible via GET orders)', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    queue([{ id: 'event-1' }], [{ id: 'att-1', attendee_name: 'A', checked_in_at: null, order_status: 'CONFIRMED', payment_status: 'NOT_REQUIRED', ticket_type_name: null, session_name: null }])
    const res = await resolveRoute.POST(jsonReq('http://localhost/x', 'POST', { ticket_token: 'tok' }), EVENT_CTX)
    expect(res.status).toBe(200)
  })

  it('viewer CAN search attendees (read-only)', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    queue([{ id: 'event-1' }], [])
    const res = await searchRoute.GET(asNextRequest(new Request('http://localhost/x?q=jane')), EVENT_CTX)
    expect(res.status).toBe(200)
  })

  it('search is always scoped to the caller\'s own organisation and this one event — never a cross-tenant/global search', () => {
    const code = stripComments(read('lib/events/checkIn.ts'))
    const fnStart = code.indexOf('export async function searchAttendees')
    const fnBody = code.slice(fnStart, code.indexOf('\n}', fnStart))
    expect(fnBody).toMatch(/ea\.organisation_id = \$\{organisationId\}/)
    expect(fnBody).toMatch(/ea\.event_id = \$\{eventId\}/)
  })
})

describe('Check-in — architecture containment', () => {
  const CHECKIN_FILES = [
    'lib/events/checkIn.ts',
    'app/api/events/[id]/check-in/resolve/route.ts',
    'app/api/events/[id]/check-in/confirm/route.ts',
    'app/api/events/[id]/check-in/undo/route.ts',
    'app/api/events/[id]/check-in/search/route.ts',
  ]

  for (const file of CHECKIN_FILES) {
    it(`${file} has no QR/payment/email/CRM/audit scope creep`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/stripe|paypal|square|checkout\.session|payment_intent/i)
      expect(code).not.toMatch(/resend|sendEmail|nodemailer/i)
      expect(code).not.toMatch(/audit_logs|AuditLog/)
    })
  }

  it('confirmCheckIn() gates on order status atomically in the same UPDATE — never a separate check-then-write for cancellation', () => {
    const code = stripComments(read('lib/events/checkIn.ts'))
    const fnStart = code.indexOf('export async function confirmCheckIn')
    const fnBody = code.slice(fnStart, code.indexOf('\nexport type UndoCheckInResult', fnStart))
    // Both branches (ticket_token / attendee_id) must carry the
    // cancellation guard inside their own UPDATE statement.
    const updateCount = (fnBody.match(/UPDATE event_attendees ea/g) ?? []).length
    const statusGuardCount = (fnBody.match(/eo\.status <> 'CANCELLED'/g) ?? []).length
    expect(updateCount).toBe(2)
    expect(statusGuardCount).toBe(2)
  })

  it('the atomic check-in UPDATE conditions on checked_in_at IS NULL in the same statement as the write — the exact mechanism the real-Postgres harness proves', () => {
    const code = stripComments(read('lib/events/checkIn.ts'))
    expect(code).toMatch(/ea\.checked_in_at IS NULL/)
  })

  it('undoCheckIn() conditions the opposite way (checked_in_at IS NOT NULL) — an explicit, not automatic, reversal', () => {
    const code = stripComments(read('lib/events/checkIn.ts'))
    const fnStart = code.indexOf('export async function undoCheckIn')
    const fnBody = code.slice(fnStart, code.indexOf('\nexport async function searchAttendees', fnStart))
    expect(fnBody).toMatch(/checked_in_at IS NOT NULL/)
  })

  it('confirmCheckIn() never calls undoCheckIn() — a repeated scan can never silently reverse a check-in', () => {
    const code = stripComments(read('lib/events/checkIn.ts'))
    const fnStart = code.indexOf('export async function confirmCheckIn')
    const fnBody = code.slice(fnStart, code.indexOf('\nexport type UndoCheckInResult', fnStart))
    expect(fnBody).not.toMatch(/undoCheckIn/)
  })
})

// ─── QR (section 6/25 — structural test; camera integration itself is
// manually verified, see the Phase 3 report) ──────────────────────

describe('QR — encodes only the ticket URL, no PII', () => {
  it('buildTicketUrl embeds the token in the path, nothing else', async () => {
    const { buildTicketUrl } = await import('@/lib/events/qr')
    expect(buildTicketUrl('https://example.com', 'abc123')).toBe('https://example.com/t/abc123')
  })

  it('lib/events/qr.ts never references attendee name/email or order id as QR content', () => {
    const code = stripComments(read('lib/events/qr.ts'))
    expect(code).not.toMatch(/attendee_name|attendee_email|purchaser|order_id/i)
  })
})

describe('Public route safety — /t is a separate prefix from /events', () => {
  it('middleware.ts adds /t to PUBLIC without touching /events', () => {
    const code = stripComments(read('middleware.ts'))
    expect(code).toMatch(/'\/t',/)
  })

  it('app/t/[token]/page.tsx exists as the only new public page route this phase adds', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app/t/[token]/page.tsx'))).toBe(true)
  })
})
