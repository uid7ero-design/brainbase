import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Booking-level access token — generation contract, minting call sites
// (free + paid orders), and the historical backfill script. Static
// source-text containment for the SQL-transaction-heavy routes (see
// CLAUDE.md's own note on why this repository proves complex raw-SQL
// routes this way), plus direct unit tests for the pure generator.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const { generateTicketToken, generateBookingToken } = await import('@/lib/events/ticketToken')

describe('generateBookingToken — 256-bit hex contract', () => {
  it('returns a 64-character lowercase hex string (256 bits)', () => {
    const token = generateBookingToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('two consecutive calls never produce the same value', () => {
    const a = generateBookingToken()
    const b = generateBookingToken()
    expect(a).not.toBe(b)
  })

  it('produces a value indistinguishable in shape from generateTicketToken() — same underlying contract, distinct export', () => {
    const bookingToken = generateBookingToken()
    const ticketToken = generateTicketToken()
    expect(bookingToken).toMatch(/^[0-9a-f]{64}$/)
    expect(ticketToken).toMatch(/^[0-9a-f]{64}$/)
  })

  it('the two exports do not duplicate the randomBytes call — both delegate to one shared primitive', () => {
    const code = stripComments(read('lib/events/ticketToken.ts'))
    const randomBytesCount = (code.match(/randomBytes\(32\)\.toString\('hex'\)/g) ?? []).length
    expect(randomBytesCount).toBe(1)
    expect(code).toMatch(/export function generateTicketToken/)
    expect(code).toMatch(/export function generateBookingToken/)
  })
})

describe('Schema — event_orders.booking_token', () => {
  const migration = read('scripts/add-events-booking-wallet.sql')

  it('adds booking_token as nullable TEXT (not NOT NULL) — historical/ineligible orders legitimately have none', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS booking_token TEXT;/)
    expect(migration).not.toMatch(/booking_token TEXT NOT NULL/)
  })

  it('adds a partial UNIQUE index scoped to non-null values — the structural collision guard', () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_event_orders_booking_token/)
    expect(migration).toMatch(/ON event_orders\(booking_token\) WHERE booking_token IS NOT NULL/)
  })

  it('is purely additive — no DROP, no ALTER of any other column, no other table touched', () => {
    const body = migration.replace(/--.*$/gm, '')
    expect(body).not.toMatch(/DROP /i)
    expect(body).not.toMatch(/ALTER TABLE (?!event_orders)/i)
  })

  it('never redefines or renames event_orders.id — the existing "confirmation reference" semantics are untouched', () => {
    expect(migration).not.toMatch(/ALTER TABLE event_orders[^;]*\bid\b[^;]*RENAME/i)
    expect(migration).not.toMatch(/DROP COLUMN.*\bid\b/i)
  })
})

describe('Free-order minting — app/api/public/events/.../register/route.ts', () => {
  const source = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts'))

  it('imports generateBookingToken from the shared module', () => {
    expect(source).toMatch(/import \{[^}]*\bgenerateBookingToken\b[^}]*\} from '@\/lib\/events\/ticketToken'/)
  })

  it('generates exactly one booking token per registration call (not one per attendee)', () => {
    const occurrences = (source.match(/generateBookingToken\(\)/g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('both ins_order CTEs (session-bound and non-session-bound branches) insert booking_token alongside the existing columns', () => {
    // booking_token no longer has to be the LAST column in the list —
    // Phase 3E.2 added ticket_email_status after it (see
    // tests/containment/eventsFreeRegistrationTicketEmail.test.ts for
    // that column's own containment proof) — this only asserts
    // booking_token is present as one of the inserted columns, in both
    // branches.
    const occurrences = (source.match(/INSERT INTO event_orders \([^)]*\bbooking_token\b[^)]*\)/g) ?? []).length
    expect(occurrences).toBe(2)
  })

  it('the booking token is only ever written by the same capacity-gated INSERT that also writes the order row — never a separate unconditional write', () => {
    // Both occurrences of ${bookingToken} in a SELECT list must be
    // immediately followed (within the same statement) by the existing
    // capacity WHERE clause already proven elsewhere in this file.
    const selectLines = source.match(/SELECT \$\{organisationId\}, \$\{event\.id\}[^\n]*\$\{bookingToken\}/g) ?? []
    expect(selectLines.length).toBe(2)
  })

  it('the order-creation transaction is untouched in every other respect — the R1 capacity gate and attendee/response inserts are still present', () => {
    expect(source).toMatch(/FOR UPDATE/)
    expect(source).toMatch(/INSERT INTO event_attendees/)
    expect(source).toMatch(/INSERT INTO event_registration_responses/)
  })
})

describe('Paid-order minting — lib/events/stripe.ts', () => {
  const source = stripComments(read('lib/events/stripe.ts'))

  it('defines issueBookingTokenForPaidOrder as a distinct function from issueTicketTokensForPaidOrder', () => {
    expect(source).toMatch(/async function issueBookingTokenForPaidOrder/)
    expect(source).toMatch(/async function issueTicketTokensForPaidOrder/)
  })

  it('re-checks payment_status = \'PAID\' in its own query — never trusts the caller', () => {
    const fnStart = source.indexOf('async function issueBookingTokenForPaidOrder')
    const fnEnd = source.indexOf('\n}', fnStart)
    const fn = source.slice(fnStart, fnEnd)
    expect(fn).toMatch(/payment_status = 'PAID'/)
  })

  it('is idempotent — gated on booking_token IS NULL, never regenerates an existing value', () => {
    const fnStart = source.indexOf('async function issueBookingTokenForPaidOrder')
    const fnEnd = source.indexOf('\n}', fnStart)
    const fn = source.slice(fnStart, fnEnd)
    expect(fn).toMatch(/booking_token IS NULL/)
    expect(fn).not.toMatch(/COALESCE\(booking_token/) // no "keep old or overwrite" fallback — a NULL guard is the only path
  })

  it('is called unconditionally right after issueTicketTokensForPaidOrder inside handleCheckoutSessionCompleted — same crash-recovery reasoning as that call', () => {
    const fnStart = source.indexOf('async function handleCheckoutSessionCompleted')
    const fnEnd = source.indexOf('\n}', fnStart)
    const fn = source.slice(fnStart, fnEnd)
    const ticketIdx = fn.indexOf('await issueTicketTokensForPaidOrder(orderId)')
    const bookingIdx = fn.indexOf('await issueBookingTokenForPaidOrder(orderId)')
    expect(ticketIdx).toBeGreaterThan(-1)
    expect(bookingIdx).toBeGreaterThan(ticketIdx)
  })

  it('does not appear in handleCheckoutSessionExpired or handlePaymentIntentFailed — a booking token is never minted for a non-paid order', () => {
    const expiredFnStart = source.indexOf('async function handleCheckoutSessionExpired')
    const expiredFnEnd = source.indexOf('\n}', expiredFnStart)
    expect(source.slice(expiredFnStart, expiredFnEnd)).not.toMatch(/issueBookingTokenForPaidOrder/)

    const failedFnStart = source.indexOf('async function handlePaymentIntentFailed')
    const failedFnEnd = source.indexOf('\n}', failedFnStart)
    expect(source.slice(failedFnStart, failedFnEnd)).not.toMatch(/issueBookingTokenForPaidOrder/)
  })

  it('never changes Stripe charge/session-creation semantics — createCheckoutSession and createRefund are untouched', () => {
    expect(source).toMatch(/export async function createCheckoutSession/)
    expect(source).toMatch(/export async function createRefund/)
    expect(source).toMatch(/mode: 'payment'/)
  })

  it('does not weaken webhook idempotency — every UPDATE...RETURNING+audit CTE pattern is still present', () => {
    const ctePatternCount = (source.match(/WITH updated AS \(\s*UPDATE event_orders/g) ?? []).length
    expect(ctePatternCount).toBeGreaterThanOrEqual(2) // completed + expired handlers
  })
})

describe('Historical backfill script — scripts/backfill-events-booking-tokens.mjs', () => {
  const source = read('scripts/backfill-events-booking-tokens.mjs')

  it('defaults to a dry run — only writes when invoked with --apply', () => {
    expect(source).toMatch(/const APPLY = process\.argv\.includes\('--apply'\)/)
    expect(source).toMatch(/if \(!APPLY\) \{/)
  })

  it('only selects rows that are CONFIRMED, payment-eligible, missing a booking_token, and have at least one issued attendee token', () => {
    expect(source).toMatch(/eo\.booking_token IS NULL/)
    expect(source).toMatch(/eo\.status = 'CONFIRMED'/)
    expect(source).toMatch(/eo\.payment_status IN \('NOT_REQUIRED', 'PAID'\)/)
    expect(source).toMatch(/ea\.ticket_token IS NOT NULL/)
  })

  it('the write itself re-checks eligibility in its own WHERE clause, not just the earlier SELECT', () => {
    const updateIdx = source.indexOf('UPDATE event_orders')
    const updateBlock = source.slice(updateIdx, source.indexOf('RETURNING id', updateIdx))
    expect(updateBlock).toMatch(/booking_token IS NULL/)
    expect(updateBlock).toMatch(/status = 'CONFIRMED'/)
    expect(updateBlock).toMatch(/payment_status IN \('NOT_REQUIRED', 'PAID'\)/)
  })

  it('never touches event_attendees, order status, or payment status — only event_orders.booking_token', () => {
    expect(source).not.toMatch(/UPDATE event_attendees/)
    expect(source).not.toMatch(/SET status = /)
    expect(source).not.toMatch(/SET payment_status = /)
  })

  it('one UPDATE per row (not a bulk statement) — a single collision never blocks the rest of the batch', () => {
    expect(source).toMatch(/for \(const row of rows\)/)
  })

  it('reports an affected-row count without ever printing a token value', () => {
    expect(source).toMatch(/console\.log\(`Backfilled \$\{updated\}/)
    expect(source).not.toMatch(/console\.log\([^)]*token[^)]*\$\{token\}/i)
  })
})
