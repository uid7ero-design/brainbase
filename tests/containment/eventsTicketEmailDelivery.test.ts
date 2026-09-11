import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase 3E.1 — durable, lease-based foundation for AUTOMATIC initial
// ticket-email delivery (lib/events/ticketEmailDelivery.ts). This file
// is FOUNDATION-ONLY: nothing it tests is wired to any route, cron,
// webhook, or UI in this phase — see the "NO AUTO SEND" describe block
// at the bottom, which proves exactly that from the real source files.
//
// Mocking strategy mirrors this repo's own established pattern (see
// tests/containment/eventsPublicRegistration.test.ts's own header
// comment): a single top-level `sql` mock that ignores its arguments
// and resolves whatever is queued next, used for FUNCTIONAL/behavioural
// assertions (does claimTicketEmailDelivery return null on zero rows,
// does markTicketEmailSent return true on one row, etc.) — this cannot
// prove real Postgres concurrency/interval-arithmetic behaviour, only
// that this module's own functions correctly interpret whatever the
// database returns. The actual SQL SHAPE (WHERE-clause conditions,
// exact constants, absence of forbidden branches) is instead proven via
// static source-text containment against the real .ts file, matching
// this repo's dominant testing discipline for exactly this reason.

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: sqlMock }))

// Phase 3E.2 — attemptAutomaticTicketEmail's own dependencies, mocked
// so this file can prove its orchestration logic (claim -> read -> send
// -> mark -> audit) without ever making a real network call. No live
// email is sent anywhere in this file.
const sendTicketEmailMock = vi.fn()
vi.mock('@/lib/events/ticketEmail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/ticketEmail')>()
  return { ...actual, sendTicketEmail: (...args: unknown[]) => sendTicketEmailMock(...args) }
})

const logAutomaticTicketEmailSentMock = vi.fn()
const logAutomaticTicketEmailFailedMock = vi.fn()
vi.mock('@/lib/events/auditLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/auditLog')>()
  return {
    ...actual,
    logAutomaticTicketEmailSent: (...args: unknown[]) => logAutomaticTicketEmailSentMock(...args),
    logAutomaticTicketEmailFailed: (...args: unknown[]) => logAutomaticTicketEmailFailedMock(...args),
  }
})

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

beforeEach(() => {
  sqlMock.mockClear()
  queue()
  sendTicketEmailMock.mockReset()
  logAutomaticTicketEmailSentMock.mockReset().mockResolvedValue(undefined)
  logAutomaticTicketEmailFailedMock.mockReset().mockResolvedValue(undefined)
})

const delivery = await import('@/lib/events/ticketEmailDelivery')

// Normalizes CRLF -> LF on every source file read below. Git's own
// autocrlf checkout behaviour can hand this file CRLF line endings
// depending on the worktree/environment it was checked out into
// (confirmed: identical content, differing only by line-ending style,
// between a freshly-edited file and the same file after a fresh `git
// worktree add` checkout) — several containment checks below embed a
// literal `\n` inside a multi-line search string, which silently stops
// matching against `\r\n` content. Normalizing once here, rather than
// making every individual search CRLF-tolerant, fixes this for the
// whole file at the source.
function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const SOURCE = stripComments(readSource('lib/events/ticketEmailDelivery.ts'))
const RAW_SOURCE = readSource('lib/events/ticketEmailDelivery.ts')
const MIGRATION_SOURCE = readSource('scripts/add-events-ticket-email-delivery.sql')
const RESEND_ROUTE_SOURCE = readSource('app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts')
const REGISTER_ROUTE_SOURCE = readSource('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts')
const STRIPE_SOURCE = readSource('lib/events/stripe.ts')

// Isolates the claim query's own WHERE clause text (between "UPDATE
// event_orders" for the claim function and its matching "RETURNING id,
// ticket_email_claim_id" — the claim's own distinctive RETURNING list,
// unique among this file's three UPDATE statements) — block-scoping the
// search first, per this repo's own established idiom for avoiding
// whole-file false positives, rather than searching the entire file.
function claimQueryText(): string {
  const start = SOURCE.indexOf('UPDATE event_orders')
  const end = SOURCE.indexOf('RETURNING id, ticket_email_claim_id, ticket_email_attempt_count')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return SOURCE.slice(start, end)
}

function markSentQueryText(): string {
  const start = SOURCE.indexOf("ticket_email_status = 'sent'")
  const end = SOURCE.indexOf('RETURNING id', start)
  expect(start).toBeGreaterThan(-1)
  return SOURCE.slice(start, end)
}

function markFailedQueryText(): string {
  const start = SOURCE.indexOf("ticket_email_status = 'failed',\n      ticket_email_claimed_at = NULL,\n      ticket_email_claim_id = NULL,\n      ticket_email_last_error")
  const end = SOURCE.indexOf('RETURNING id', start)
  expect(start).toBeGreaterThan(-1)
  return SOURCE.slice(start, end)
}

function sweepQueryText(): string {
  const start = SOURCE.indexOf('Lease expired after maximum attempts')
  expect(start).toBeGreaterThan(-1)
  return SOURCE.slice(Math.max(0, start - 400), start + 400)
}

describe('constants', () => {
  it('LEASE_TIMEOUT_MINUTES is 10', () => {
    expect(delivery.LEASE_TIMEOUT_MINUTES).toBe(10)
  })
  it('MAX_ATTEMPTS is 3', () => {
    expect(delivery.MAX_ATTEMPTS).toBe(3)
  })
  it('RETRY_BACKOFF_MINUTES is {1: 5, 2: 30} — no entry for attempt 3 (terminal)', () => {
    expect(delivery.RETRY_BACKOFF_MINUTES).toEqual({ 1: 5, 2: 30 })
  })
  it('constants are plain code, not environment variables', () => {
    expect(RAW_SOURCE).not.toMatch(/process\.env\.\w*LEASE/)
    expect(RAW_SOURCE).not.toMatch(/process\.env\.\w*MAX_ATTEMPTS/)
    expect(RAW_SOURCE).not.toMatch(/process\.env\.\w*BACKOFF/)
  })
})

describe('buildInitialTicketEmailIdempotencyKey', () => {
  it('produces event-ticket-email-initial:<orderId>', () => {
    expect(delivery.buildInitialTicketEmailIdempotencyKey('order-1')).toBe('event-ticket-email-initial:order-1')
  })

  it('the same order id always produces the exact same key (deterministic, stable)', () => {
    const a = delivery.buildInitialTicketEmailIdempotencyKey('order-abc')
    const b = delivery.buildInitialTicketEmailIdempotencyKey('order-abc')
    expect(a).toBe(b)
  })

  it('a different order id produces a different key', () => {
    expect(delivery.buildInitialTicketEmailIdempotencyKey('order-1'))
      .not.toBe(delivery.buildInitialTicketEmailIdempotencyKey('order-2'))
  })

  it('contains nothing but the fixed prefix and the exact orderId supplied', () => {
    const key = delivery.buildInitialTicketEmailIdempotencyKey('ORDER-XYZ-123')
    expect(key).toBe('event-ticket-email-initial:ORDER-XYZ-123')
  })

  it('the function signature takes ONLY an orderId — structurally cannot embed a token/claimId/timestamp', () => {
    // A single-parameter pure function whose body is a template literal
    // referencing only that parameter cannot smuggle in anything else.
    const fnSource = SOURCE.slice(
      SOURCE.indexOf('export function buildInitialTicketEmailIdempotencyKey'),
      SOURCE.indexOf('}', SOURCE.indexOf('export function buildInitialTicketEmailIdempotencyKey')) + 1,
    )
    expect(fnSource).toMatch(/buildInitialTicketEmailIdempotencyKey\(orderId: string\)/)
    expect(fnSource).not.toMatch(/ticketToken|bookingToken|claimId|attemptCount|Date\.now|new Date/)
  })
})

describe('CLAIM', () => {
  it('a pending order is claimed exactly once — a second immediate attempt with no matching row returns null', async () => {
    queue([{ id: 'order-1', ticket_email_claim_id: 'claim-a', ticket_email_attempt_count: 1 }], [])
    const first = await delivery.claimTicketEmailDelivery('order-1')
    expect(first).toEqual({ orderId: 'order-1', claimId: 'claim-a', attemptCount: 1 })

    const second = await delivery.claimTicketEmailDelivery('order-1')
    expect(second).toBeNull()
  })

  // A mock cannot prove real Postgres row-level locking — that is the
  // job of a real-Postgres harness (matching this repo's own precedent,
  // e.g. eventsPublicRegistration.test.ts's identical disclaimer). What
  // this proves is the FUNCTION's own contract: a caller only ever
  // treats a non-empty RETURNING as a win, and an empty RETURNING as a
  // clean loss — never anything in between.
  it('concurrent claim shape: exactly one of two callers can observe a non-null result for the same queued outcome pair', async () => {
    queue([{ id: 'order-1', ticket_email_claim_id: 'claim-a', ticket_email_attempt_count: 1 }], [])
    const [a, b] = await Promise.all([
      delivery.claimTicketEmailDelivery('order-1'),
      delivery.claimTicketEmailDelivery('order-1'),
    ])
    const winners = [a, b].filter(r => r !== null)
    expect(winners.length).toBe(1)
  })

  it('an ineligible order (zero matching rows) is never claimed — returns null', async () => {
    queue([])
    const result = await delivery.claimTicketEmailDelivery('order-ineligible')
    expect(result).toBeNull()
  })

  it('claim query is a single UPDATE ... RETURNING — never a SELECT-then-UPDATE', async () => {
    queue([{ id: 'order-1', ticket_email_claim_id: 'claim-a', ticket_email_attempt_count: 1 }])
    await delivery.claimTicketEmailDelivery('order-1')
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('claim SETs status, claim_id, claimed_at, last_attempt_at, increments attempt_count, and clears next_attempt_at', () => {
    const q = claimQueryText()
    expect(q).toContain("ticket_email_status = 'sending'")
    expect(q).toContain('ticket_email_claim_id =')
    expect(q).toContain('ticket_email_claimed_at = NOW()')
    expect(q).toContain('ticket_email_last_attempt_at = NOW()')
    expect(q).toContain('ticket_email_attempt_count = ticket_email_attempt_count + 1')
    expect(q).toContain('ticket_email_next_attempt_at = NULL')
  })

  it('claim uses crypto.randomUUID() for the new claim id, not claimed_at, as the ownership token', () => {
    expect(SOURCE).toContain('const claimId = crypto.randomUUID();')
  })

  it('claim rechecks full eligibility: CONFIRMED status, NOT_REQUIRED/PAID payment, non-empty purchaser_email, an attendee with a ticket_token', () => {
    const q = claimQueryText()
    expect(q).toContain("event_orders.status = 'CONFIRMED'")
    expect(q).toContain("event_orders.payment_status IN ('NOT_REQUIRED', 'PAID')")
    expect(q).toContain('event_orders.purchaser_email IS NOT NULL')
    expect(q).toContain("trim(event_orders.purchaser_email) <> ''")
    expect(q).toContain('ea.ticket_token IS NOT NULL')
  })

  it('NULL is never a claimable branch — the eligible-state OR-list is exactly pending / failed-with-conditions / sending-with-conditions', () => {
    const q = claimQueryText()
    // The three (and only three) claimable branches:
    expect(q).toContain("ticket_email_status = 'pending'")
    expect(q).toContain("ticket_email_status = 'failed'")
    expect(q).toContain("ticket_email_status = 'sending'")
    // The single most important negative assertion in this file: no
    // branch anywhere treats a NULL status as claimable.
    expect(q).not.toMatch(/ticket_email_status\s+IS\s+NULL/i)
    expect(q).not.toContain('ticket_email_status IS NULL')
  })

  it('a CANCELLED order (which refund/cancel always produce) can never satisfy the claim — status check is CONFIRMED-only, no CANCELLED branch', () => {
    const q = claimQueryText()
    expect(q).not.toContain('CANCELLED')
    // Cross-reference: both cancel and refund routes really do always
    // set status = 'CANCELLED' — confirming the claim's CONFIRMED-only
    // condition genuinely excludes both outcomes, not just in theory.
    expect(stripComments(fs.readFileSync(
      path.join(process.cwd(), "app/api/events/[id]/orders/[orderId]/cancel/route.ts"), 'utf-8',
    ))).toContain("status = 'CANCELLED'")
    expect(stripComments(fs.readFileSync(
      path.join(process.cwd(), "app/api/events/[id]/orders/[orderId]/refund/route.ts"), 'utf-8',
    ))).toContain("status = 'CANCELLED'")
  })

  it('claim does not take an organisationId parameter — matches issueTicketTokensForPaidOrder/issueBookingTokenForPaidOrder\'s own sibling convention', () => {
    expect(SOURCE).toContain('export async function claimTicketEmailDelivery(orderId: string)')
  })
})

describe('LEASE', () => {
  it('the failed branch requires attempt_count < MAX_ATTEMPTS and next_attempt_at elapsed', () => {
    const q = claimQueryText()
    expect(q).toContain('ticket_email_attempt_count < ${MAX_ATTEMPTS}'.replace('${MAX_ATTEMPTS}', '${MAX_ATTEMPTS}'))
    expect(q).toMatch(/ticket_email_status = 'failed'[\s\S]*?ticket_email_attempt_count < \$\{MAX_ATTEMPTS\}/)
    expect(q).toContain('ticket_email_next_attempt_at <= NOW()')
  })

  // Regression test — caught during isolated Preview verification. An
  // earlier version of the claim query read
  // "ticket_email_next_attempt_at IS NULL OR ticket_email_next_attempt_at
  // <= NOW()" — in Postgres, "X IS NULL OR ..." evaluates to TRUE when X
  // is NULL, which silently made a TERMINAL failed row (next_attempt_at
  // forced to NULL by an idempotency payload mismatch, while
  // attempt_count was still below MAX_ATTEMPTS) reclaimable and
  // automatically retried — exactly what the payload-stability rule
  // (§13) forbids. The fix: no "IS NULL OR" at all — a bare "<= NOW()"
  // already correctly excludes NULL by itself (NULL <= NOW() is NULL,
  // which WHERE treats as not-true).
  it('REGRESSION: the failed branch does NOT contain "IS NULL OR" — NULL next_attempt_at must never be treated as retry-due', () => {
    const q = claimQueryText()
    const failedBranch = q.slice(
      q.indexOf("ticket_email_status = 'failed'"),
      q.indexOf("OR (\n          ticket_email_status = 'sending'"),
    )
    expect(failedBranch).not.toMatch(/IS\s+NULL\s+OR/i)
    expect(failedBranch).toContain('ticket_email_next_attempt_at <= NOW()')
  })

  it('the stale-sending branch requires claimed_at older than LEASE_TIMEOUT_MINUTES AND attempt_count < MAX_ATTEMPTS (active leases are not reclaimed)', () => {
    const q = claimQueryText()
    expect(q).toMatch(/ticket_email_status = 'sending'[\s\S]*?ticket_email_claimed_at < NOW\(\) - make_interval\(mins => \$\{LEASE_TIMEOUT_MINUTES\}\)[\s\S]*?ticket_email_attempt_count < \$\{MAX_ATTEMPTS\}/)
  })

  it('a stale sending lease at max attempts is NOT reclaimed by the claim query (attempt_count < MAX_ATTEMPTS gates it out)', () => {
    // Structural proof: the sending branch's own attempt_count
    // condition is strictly "<", never "<=" and never absent — so
    // attempt_count === MAX_ATTEMPTS can never satisfy this branch.
    // Slice from the WHERE clause (skipping the SET clause's own
    // unrelated "ticket_email_status = 'sending'," assignment) to the
    // sending branch's own condition block.
    const q = claimQueryText()
    const whereClause = q.slice(q.indexOf('WHERE id ='))
    const sendingBranch = whereClause.slice(whereClause.lastIndexOf("ticket_email_status = 'sending'"))
    expect(sendingBranch).toContain('ticket_email_attempt_count < ${MAX_ATTEMPTS}')
    expect(sendingBranch).not.toContain('<=')
  })

  it('sweepStaleExhaustedTicketEmailLeases sweeps a stale, exhausted "sending" row to terminal "failed"', async () => {
    queue([{ id: 'order-1' }])
    const count = await delivery.sweepStaleExhaustedTicketEmailLeases()
    expect(count).toBe(1)
  })

  it('sweep grants no new claim and does not increment attempt_count', () => {
    const q = sweepQueryText()
    expect(q).not.toContain('attempt_count + 1')
    expect(q).not.toContain("ticket_email_status = 'sending',")
  })

  it('sweep requires attempt_count >= MAX_ATTEMPTS and a stale claimed_at — mirrors the claim query\'s own staleness condition', () => {
    expect(SOURCE).toContain('ticket_email_claimed_at < NOW() - make_interval(mins => ${LEASE_TIMEOUT_MINUTES})\n        AND ticket_email_attempt_count >= ${MAX_ATTEMPTS}')
  })

  it('sweep sets a safe, bounded, generic error — no raw provider data', () => {
    expect(SOURCE).toContain("'Lease expired after maximum attempts; delivery outcome unknown.'")
  })

  it('sweep is bounded-batch (LIMIT) and returns the number of rows swept', async () => {
    expect(SOURCE).toMatch(/LIMIT \$\{limit\}/)
    queue([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    const count = await delivery.sweepStaleExhaustedTicketEmailLeases(3)
    expect(count).toBe(3)
  })
})

describe('OWNERSHIP', () => {
  it('an expired/superseded claim_id cannot complete a newer claim — markTicketEmailSent returns false on zero rows', async () => {
    queue([])
    const ok = await delivery.markTicketEmailSent('order-1', 'stale-claim-id', 'msg-1')
    expect(ok).toBe(false)
  })

  it('an expired/superseded claim_id cannot record a failure either — markTicketEmailFailed returns false on zero rows', async () => {
    queue([])
    const ok = await delivery.markTicketEmailFailed('order-1', 'stale-claim-id', 'provider_rejected', 'rejected')
    expect(ok).toBe(false)
  })

  it('the CURRENT claim can mark sent', async () => {
    queue([{ id: 'order-1' }])
    const ok = await delivery.markTicketEmailSent('order-1', 'current-claim-id', 'msg-1')
    expect(ok).toBe(true)
  })

  it('the CURRENT claim can mark failed', async () => {
    queue([{ id: 'order-1' }])
    const ok = await delivery.markTicketEmailFailed('order-1', 'current-claim-id', 'provider_rejected', 'rejected')
    expect(ok).toBe(true)
  })

  it('success transition is guarded on BOTH status=\'sending\' and an exact claim_id match', () => {
    const q = markSentQueryText()
    expect(q).toContain("ticket_email_status = 'sending'")
    expect(q).toContain('ticket_email_claim_id = ${claimId}')
  })

  it('failure transition is guarded on BOTH status=\'sending\' and an exact claim_id match', () => {
    const q = markFailedQueryText()
    expect(q).toContain("ticket_email_status = 'sending'")
    expect(q).toContain('ticket_email_claim_id = ${claimId}')
  })

  it('success and failure both clear claimed_at and claim_id (lease released)', () => {
    expect(markSentQueryText()).toContain('ticket_email_claimed_at = NULL')
    expect(markSentQueryText()).toContain('ticket_email_claim_id = NULL')
    expect(markFailedQueryText()).toContain('ticket_email_claimed_at = NULL')
    expect(markFailedQueryText()).toContain('ticket_email_claim_id = NULL')
  })
})

describe('RETRY', () => {
  it('attempt_count is incremented ONLY inside the claim — never inside success or failure transitions', () => {
    expect(claimQueryText()).toContain('ticket_email_attempt_count = ticket_email_attempt_count + 1')
    expect(markSentQueryText()).not.toContain('attempt_count + 1')
    expect(markFailedQueryText()).not.toContain('attempt_count + 1')
  })

  it('attempt 1 failure schedules +5 minutes (RETRY_BACKOFF_MINUTES[1])', () => {
    expect(SOURCE).toContain('WHEN ticket_email_attempt_count = 1 THEN NOW() + make_interval(mins => ${RETRY_BACKOFF_MINUTES[1]})')
    expect(delivery.RETRY_BACKOFF_MINUTES[1]).toBe(5)
  })

  it('attempt 2 failure schedules +30 minutes (RETRY_BACKOFF_MINUTES[2])', () => {
    expect(SOURCE).toContain('WHEN ticket_email_attempt_count = 2 THEN NOW() + make_interval(mins => ${RETRY_BACKOFF_MINUTES[2]})')
    expect(delivery.RETRY_BACKOFF_MINUTES[2]).toBe(30)
  })

  it('attempt >= MAX_ATTEMPTS (3) is terminal — next_attempt_at is set to NULL, no further branch', () => {
    expect(SOURCE).toContain('WHEN ticket_email_attempt_count >= ${MAX_ATTEMPTS} THEN NULL')
  })

  it('a retry before next_attempt_at has elapsed is denied by the claim\'s own WHERE clause', () => {
    const q = claimQueryText()
    expect(q).toContain('ticket_email_next_attempt_at <= NOW()')
  })

  it('claiming behaviourally denies a not-yet-due retry: zero matching rows -> null', async () => {
    queue([])
    const result = await delivery.claimTicketEmailDelivery('order-not-due-yet')
    expect(result).toBeNull()
  })

  it('claiming behaviourally allows a now-due retry: a matching row -> a claim', async () => {
    queue([{ id: 'order-1', ticket_email_claim_id: 'claim-b', ticket_email_attempt_count: 2 }])
    const result = await delivery.claimTicketEmailDelivery('order-1')
    expect(result).toEqual({ orderId: 'order-1', claimId: 'claim-b', attemptCount: 2 })
  })
})

describe('IDEMPOTENCY (payload-mismatch handling)', () => {
  it('idempotency_payload_mismatch always forces next_attempt_at to NULL, regardless of attempt_count', () => {
    expect(SOURCE).toContain('WHEN ${forceTerminal} THEN NULL')
    expect(SOURCE).toContain("const forceTerminal = reason === 'idempotency_payload_mismatch';")
  })

  it('the forceTerminal WHEN branch is evaluated BEFORE the attempt-count branches — payload mismatch is never overridden into a scheduled retry', () => {
    const caseStart = SOURCE.indexOf('ticket_email_next_attempt_at = CASE')
    const forceIdx = SOURCE.indexOf('WHEN ${forceTerminal} THEN NULL', caseStart)
    const maxAttemptsIdx = SOURCE.indexOf('WHEN ticket_email_attempt_count >= ${MAX_ATTEMPTS}', caseStart)
    expect(forceIdx).toBeGreaterThan(caseStart)
    expect(forceIdx).toBeLessThan(maxAttemptsIdx)
  })

  it('markTicketEmailFailed never rotates/regenerates the idempotency key — it has no key parameter at all', () => {
    const fnStart = SOURCE.indexOf('export async function markTicketEmailFailed(')
    const fnSignature = SOURCE.slice(fnStart, SOURCE.indexOf(')', fnStart) + 1)
    expect(fnSignature).not.toMatch(/idempotencyKey|IdempotencyKey/)
  })

  it('TicketEmailFailureReason includes idempotency_payload_mismatch as a distinct reason from provider_rejected/ambiguous_outcome', () => {
    expect(SOURCE).toContain("'provider_rejected'")
    expect(SOURCE).toContain("'ambiguous_outcome'")
    expect(SOURCE).toContain("'idempotency_payload_mismatch'")
  })
})

describe('HISTORICAL', () => {
  it('a migrated historical row (ticket_email_status = NULL) is unclaimable — behavioural proof via zero-row mock response', async () => {
    // Under the mock this is indistinguishable from any other
    // zero-row outcome, which is exactly the point: the FUNCTION
    // cannot special-case NULL into claimability even if it wanted to
    // — see the structural "NULL never claimable" test in the CLAIM
    // block above for the actual proof this state is excluded by
    // construction, not by chance.
    queue([])
    const result = await delivery.claimTicketEmailDelivery('legacy-order-null-status')
    expect(result).toBeNull()
  })

  it('the migration script contains NO backfill — zero UPDATE statements anywhere in the file', () => {
    expect(MIGRATION_SOURCE).not.toMatch(/\bUPDATE\s+event_orders\b/i)
  })

  it('the migration is additive only — every DDL statement is ALTER TABLE ADD COLUMN, ADD CONSTRAINT, or CREATE INDEX', () => {
    const ddlLines = MIGRATION_SOURCE
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('--'))
    for (const line of ddlLines) {
      expect(line).toMatch(/^(ALTER TABLE|CREATE INDEX|CREATE TABLE IF NOT EXISTS event_orders\b.*never)?/)
      expect(
        /^ALTER TABLE event_orders (ADD COLUMN IF NOT EXISTS|DROP CONSTRAINT IF EXISTS|ADD CONSTRAINT)/.test(line)
        || /^CREATE INDEX IF NOT EXISTS/.test(line)
        || /^(ON|WHERE|CHECK)/.test(line),
      ).toBe(true)
    }
  })

  it('the migration adds ticket_email_attempt_count as the only NOT NULL column, defaulting to 0', () => {
    expect(MIGRATION_SOURCE).toContain(
      'ADD COLUMN IF NOT EXISTS ticket_email_attempt_count INTEGER NOT NULL DEFAULT 0',
    )
    // Every other ticket_email_* column is nullable (no "NOT NULL" on its own ADD COLUMN line).
    const otherColumnLines = MIGRATION_SOURCE
      .split('\n')
      .filter(l => l.includes('ADD COLUMN IF NOT EXISTS ticket_email_') && !l.includes('attempt_count'))
    for (const line of otherColumnLines) {
      expect(line).not.toContain('NOT NULL')
    }
  })
})

describe('MANUAL RESEND — unaffected, isolated from automatic delivery', () => {
  it('the existing manual resend route does not pass an idempotencyKey', () => {
    expect(RESEND_ROUTE_SOURCE).not.toMatch(/idempotencyKey/)
  })

  it('the existing manual resend route mutates no ticket_email_* automatic-delivery column', () => {
    expect(stripComments(RESEND_ROUTE_SOURCE)).not.toMatch(/ticket_email_(status|claimed_at|claim_id|attempt_count|last_attempt_at|next_attempt_at|sent_at|provider_message_id|last_error)/)
  })

  it('the existing manual resend action name (event_order.ticket_email_resent) is untouched by this phase\'s own module', () => {
    expect(SOURCE).not.toContain('ticket_email_resent')
  })

  it('this phase recommends event_order.ticket_email_sent / event_order.ticket_email_failed as SEPARATE audit actions — never reusing the manual resend action name', () => {
    // This module itself does not write audit rows (no route/executor
    // wiring in this phase) — this test guards the NAMESPACE choice
    // itself never collides with the manual resend action, should a
    // later phase add audit writes here.
    expect(SOURCE).not.toContain("'event_order.ticket_email_resent'")
  })
})

describe('NO AUTO SEND (paid) / NO CRON — Phase 3E.2 boundary', () => {
  // Phase 3E.2 legitimately wires the FREE public registration route to
  // this module (via attemptAutomaticTicketEmail, scheduling
  // ticket_email_status='pending' in the same INSERT that creates a new
  // order) — that route is therefore DELIBERATELY no longer "untouched"
  // by this module, and the exact shape of that wiring (scope, timing,
  // failure-isolation) is proven by
  // tests/containment/eventsFreeRegistrationTicketEmail.test.ts
  // instead, not here. What remains true, and is proven below: the PAID
  // (Stripe) flow is still completely untouched (3E.3 remains a later,
  // separately-approved phase), and there is still no cron/recovery
  // executor anywhere in this phase.

  it('the Stripe checkout-completed handler is completely untouched by this module — paid automatic delivery (3E.3) remains unimplemented', () => {
    expect(STRIPE_SOURCE).not.toMatch(/ticket_email_|ticketEmailDelivery/)
  })

  it('no cron or recovery route exists anywhere plausible in this phase', () => {
    const candidatePaths = [
      'app/api/events/recover-ticket-emails/route.ts',
      'app/api/cron/ticket-emails/route.ts',
      'app/api/events/ticket-email-recovery/route.ts',
      'app/api/internal/ticket-email-recovery/route.ts',
    ]
    for (const p of candidatePaths) {
      expect(fs.existsSync(path.join(process.cwd(), p))).toBe(false)
    }
  })

  it('no vercel.json cron entry references ticket-email delivery', () => {
    const vercelJsonPath = path.join(process.cwd(), 'vercel.json')
    if (fs.existsSync(vercelJsonPath)) {
      const content = fs.readFileSync(vercelJsonPath, 'utf-8')
      expect(content).not.toMatch(/ticket-email|ticketEmail/i)
    }
  })

  it('this module never self-invokes claim/sweep at import time or via any internal scheduler', () => {
    expect(SOURCE).not.toMatch(/setInterval|setTimeout/)
  })

  it('claimTicketEmailDelivery is called from exactly ONE real call site: attemptAutomaticTicketEmail\'s own orchestration (plus its own declaration)', () => {
    const claimCallSites = (SOURCE.match(/claimTicketEmailDelivery\(/g) ?? []).length
    // 1 = the function's own declaration/signature, 1 = the real call
    // inside attemptAutomaticTicketEmail. No other call site exists in
    // this file.
    expect(claimCallSites).toBe(2)
  })

  it('sweepStaleExhaustedTicketEmailLeases is STILL never called anywhere in this module — test-invocable only, no recovery executor exists yet (§15)', () => {
    const sweepCallSites = (SOURCE.match(/sweepStaleExhaustedTicketEmailLeases\(/g) ?? []).length
    expect(sweepCallSites).toBe(1) // the function's own declaration only
  })

  it('attemptAutomaticTicketEmail is the ONLY function in this module with a real external caller — the free-registration route imports exactly this one export from this module', () => {
    expect(REGISTER_ROUTE_SOURCE).toMatch(/import\s*\{\s*attemptAutomaticTicketEmail\s*\}\s*from\s*'@\/lib\/events\/ticketEmailDelivery'/)
    // No OTHER primitive (claimTicketEmailDelivery, markTicketEmailSent,
    // markTicketEmailFailed, sweepStaleExhaustedTicketEmailLeases,
    // readClaimedOrderForDelivery) is imported directly by the route —
    // it only ever goes through the orchestration wrapper.
    expect(REGISTER_ROUTE_SOURCE).not.toMatch(/claimTicketEmailDelivery|markTicketEmailSent|markTicketEmailFailed|sweepStaleExhaustedTicketEmailLeases|readClaimedOrderForDelivery/)
  })
})

describe('claim return shape', () => {
  it('claim RETURNING is minimal (id, claim_id, attempt_count) — attendee/booking data is a separate trusted read', () => {
    expect(SOURCE).toContain('RETURNING id, ticket_email_claim_id, ticket_email_attempt_count')
  })

  it('readClaimedOrderForDelivery is guarded on the exact claim_id — cannot read a superseded claim\'s data', async () => {
    queue([])
    const result = await delivery.readClaimedOrderForDelivery('order-1', 'stale-claim')
    expect(result).toBeNull()
  })

  it('readClaimedOrderForDelivery returns attendee/booking-token data for the current claim', async () => {
    queue([{
      id: 'order-1', organisation_id: 'org-1', purchaser_name: 'Jane Doe', purchaser_email: 'jane@example.com',
      booking_token: 'a'.repeat(64), event_name: 'Spring Gala',
      attendees: [{ name: 'Jane Doe', ticket_token: 'b'.repeat(64) }],
    }])
    const result = await delivery.readClaimedOrderForDelivery('order-1', 'current-claim')
    expect(result).toEqual({
      id: 'order-1', organisationId: 'org-1', purchaserName: 'Jane Doe', purchaserEmail: 'jane@example.com',
      eventName: 'Spring Gala', bookingToken: 'a'.repeat(64),
      attendees: [{ name: 'Jane Doe', ticketToken: 'b'.repeat(64) }],
    })
  })

  it('this internal read is never exposed through a client-facing route (no import of this function anywhere under app/api/public)', () => {
    const publicApiDir = path.join(process.cwd(), 'app/api/public')
    function scan(dir: string): boolean {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (scan(full)) return true
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          if (fs.readFileSync(full, 'utf-8').includes('readClaimedOrderForDelivery')) return true
        }
      }
      return false
    }
    expect(scan(publicApiDir)).toBe(false)
  })
})

describe('last_error bounding', () => {
  it('truncates to 300 characters before writing', async () => {
    queue([{ id: 'order-1' }])
    const longError = 'x'.repeat(1000)
    await delivery.markTicketEmailFailed('order-1', 'claim-1', 'provider_rejected', longError)
    const call = sqlMock.mock.calls[0] as unknown as unknown[]
    const boundedValue = call.find(v => typeof v === 'string' && (v as string).startsWith('xxx'))
    expect((boundedValue as string).length).toBe(300)
  })

  it('the migration\'s CHECK constraint backstops at 500 characters', () => {
    expect(MIGRATION_SOURCE).toContain('char_length(ticket_email_last_error) <= 500')
  })
})

describe('attemptAutomaticTicketEmail — orchestration (Phase 3E.2)', () => {
  const CLAIM_ROW = [{ id: 'order-1', ticket_email_claim_id: 'claim-a', ticket_email_attempt_count: 1 }]
  const READ_ROW = [{
    id: 'order-1', organisation_id: 'org-1', purchaser_name: 'Jane Doe', purchaser_email: 'jane@example.com',
    booking_token: 'a'.repeat(64), event_name: 'Spring Gala',
    organisation_name: 'Acme School', organisation_settings: null,
    attendees: [{ name: 'Jane Doe', ticket_token: 'b'.repeat(64) }],
  }]
  const MULTI_READ_ROW = [{
    id: 'order-1', organisation_id: 'org-1', purchaser_name: 'Jane Doe', purchaser_email: 'jane@example.com',
    booking_token: 'a'.repeat(64), event_name: 'Spring Gala',
    organisation_name: 'Acme School', organisation_settings: null,
    attendees: [
      { name: 'Jane Doe', ticket_token: 'b'.repeat(64) },
      { name: 'John Doe', ticket_token: 'c'.repeat(64) },
    ],
  }]

  it('not_claimed: claim returns zero rows -> outcome not_claimed, sendTicketEmail never called', async () => {
    queue([])
    const result = await delivery.attemptAutomaticTicketEmail('order-1')
    expect(result).toEqual({ outcome: 'not_claimed' })
    expect(sendTicketEmailMock).not.toHaveBeenCalled()
  })

  it('sent: claims, reads, sends, marks sent, and writes the automatic-sent audit', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: 'msg-123' })
    queue(CLAIM_ROW, READ_ROW, [{ id: 'order-1' }])
    const result = await delivery.attemptAutomaticTicketEmail('order-1')
    expect(result).toEqual({ outcome: 'sent', providerMessageId: 'msg-123' })
    expect(logAutomaticTicketEmailSentMock).toHaveBeenCalledWith(expect.objectContaining({
      organisationId: 'org-1', orderId: 'order-1', attemptCount: 1, providerMessageId: 'msg-123',
    }))
    expect(logAutomaticTicketEmailFailedMock).not.toHaveBeenCalled()
  })

  it('sent: uses the deterministic idempotency key for this exact order', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: null })
    queue(CLAIM_ROW, READ_ROW, [{ id: 'order-1' }])
    await delivery.attemptAutomaticTicketEmail('order-1')
    expect(sendTicketEmailMock).toHaveBeenCalledWith(
      'jane@example.com',
      expect.anything(),
      { idempotencyKey: delivery.buildInitialTicketEmailIdempotencyKey('order-1') },
    )
  })

  it('multi-attendee: booking_token and BOTH attendees (with their existing tokens) are passed through unchanged — no new token minting', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: null })
    queue(CLAIM_ROW, MULTI_READ_ROW, [{ id: 'order-1' }])
    await delivery.attemptAutomaticTicketEmail('order-1')
    const [, data] = sendTicketEmailMock.mock.calls[0] as [string, { bookingToken: string | null; attendees: { name: string; ticketToken: string }[] }]
    expect(data.bookingToken).toBe('a'.repeat(64))
    expect(data.attendees).toEqual([
      { name: 'Jane Doe', ticketToken: 'b'.repeat(64) },
      { name: 'John Doe', ticketToken: 'c'.repeat(64) },
    ])
  })

  it('failed (ordinary provider rejection): marks failed with reason provider_rejected, non-terminal audit', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'failed', error: 'The email provider rejected the request.' })
    queue(CLAIM_ROW, READ_ROW, [{ id: 'order-1' }])
    const result = await delivery.attemptAutomaticTicketEmail('order-1')
    expect(result).toEqual({ outcome: 'failed', reason: 'provider_rejected' })
    expect(logAutomaticTicketEmailFailedMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'provider_rejected', terminal: false }))
  })

  it('failed (unknown/ambiguous outcome): reason ambiguous_outcome, non-terminal', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'unknown', error: 'The email provider did not return a definite result.' })
    queue(CLAIM_ROW, READ_ROW, [{ id: 'order-1' }])
    const result = await delivery.attemptAutomaticTicketEmail('order-1')
    expect(result).toEqual({ outcome: 'failed', reason: 'ambiguous_outcome' })
    expect(logAutomaticTicketEmailFailedMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ambiguous_outcome', terminal: false }))
  })

  // Phase 3E.2 remediation — a bounded provider timeout in lib/email.ts
  // surfaces through sendTicketEmail() as result 'unknown' (see
  // eventsTicketEmailSend.test.ts's own dedicated proof of that
  // mapping) — this proves the ORCHESTRATION layer treats that outcome
  // exactly like any other ambiguous result: a normal, bounded,
  // retryable failure, never terminal, and never a reason to rotate the
  // idempotency key.
  it('a provider timeout (surfaced as result "unknown") records a normal retryable failure — same treatment as any other ambiguous outcome', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'unknown', error: 'The email provider did not return a definite result.' })
    queue(CLAIM_ROW, READ_ROW, [{ id: 'order-1' }])
    const result = await delivery.attemptAutomaticTicketEmail('order-1')
    expect(result).toEqual({ outcome: 'failed', reason: 'ambiguous_outcome' })
    expect(logAutomaticTicketEmailFailedMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ambiguous_outcome', terminal: false }))
  })

  it('a provider timeout does not change the deterministic idempotency key used for this order', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'unknown', error: 'timeout' })
    queue(CLAIM_ROW, READ_ROW, [{ id: 'order-1' }])
    await delivery.attemptAutomaticTicketEmail('order-1')
    expect(sendTicketEmailMock).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      { idempotencyKey: delivery.buildInitialTicketEmailIdempotencyKey('order-1') },
    )
  })

  it('failed (provider not configured): reason not_configured, non-terminal (retryable — configuration may become available later)', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'not_configured' })
    queue(CLAIM_ROW, READ_ROW, [{ id: 'order-1' }])
    const result = await delivery.attemptAutomaticTicketEmail('order-1')
    expect(result).toEqual({ outcome: 'failed', reason: 'not_configured' })
    expect(logAutomaticTicketEmailFailedMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'not_configured', terminal: false }))
  })

  it('failed (idempotency payload mismatch): reason idempotency_payload_mismatch, TERMINAL audit', async () => {
    sendTicketEmailMock.mockResolvedValue({
      result: 'failed', error: 'The email provider reported this request no longer matches a previous attempt.', idempotencyPayloadMismatch: true,
    })
    queue(CLAIM_ROW, READ_ROW, [{ id: 'order-1' }])
    const result = await delivery.attemptAutomaticTicketEmail('order-1')
    expect(result).toEqual({ outcome: 'failed', reason: 'idempotency_payload_mismatch' })
    expect(logAutomaticTicketEmailFailedMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'idempotency_payload_mismatch', terminal: true }))
  })

  it('post-claim read comes back empty (structurally shouldn\'t happen): marks failed ambiguous_outcome, sendTicketEmail never called', async () => {
    queue(CLAIM_ROW, [])
    const result = await delivery.attemptAutomaticTicketEmail('order-1')
    expect(result).toEqual({ outcome: 'failed', reason: 'ambiguous_outcome' })
    expect(sendTicketEmailMock).not.toHaveBeenCalled()
  })

  it('an unexpected thrown error after a successful claim is caught, attempts best-effort cleanup, and never propagates', async () => {
    sendTicketEmailMock.mockRejectedValue(new Error('totally unexpected'))
    queue(CLAIM_ROW, READ_ROW, [{ id: 'order-1' }])
    const result = await delivery.attemptAutomaticTicketEmail('order-1')
    expect(result).toEqual({ outcome: 'failed', reason: 'ambiguous_outcome' })
  })

  it('never throws — every code path resolves', async () => {
    queue([])
    await expect(delivery.attemptAutomaticTicketEmail('order-1')).resolves.not.toThrow()
  })

  it('no real network call is ever made — sendTicketEmail is fully mocked in this file', async () => {
    sendTicketEmailMock.mockResolvedValue({ result: 'sent', providerMessageId: null })
    queue(CLAIM_ROW, READ_ROW, [{ id: 'order-1' }])
    await delivery.attemptAutomaticTicketEmail('order-1')
    expect(sendTicketEmailMock).toHaveBeenCalledTimes(1)
  })
})
