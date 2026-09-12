import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase 3E.2R — lib/events/ticketEmailRecovery.ts's own composition
// logic (findTicketEmailRecoveryCandidateOrderIds / runTicketEmailRecovery).
// Mocking strategy mirrors tests/containment/eventsTicketEmailDelivery
// .test.ts's own established pattern exactly: a queued `sql` mock for
// candidate-discovery-shaped functional assertions, plus static
// source-text containment for the exact SQL shape (NULL exclusion,
// candidate class conditions) and for cross-module containment proofs
// (no Stripe import, no paid scheduling). No real DB, no real email is
// ever touched by this file.

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: sqlMock }))

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

const attemptAutomaticTicketEmailMock = vi.fn()
const sweepStaleExhaustedTicketEmailLeasesMock = vi.fn()
vi.mock('@/lib/events/ticketEmailDelivery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/ticketEmailDelivery')>()
  return {
    ...actual,
    attemptAutomaticTicketEmail: (...args: unknown[]) => attemptAutomaticTicketEmailMock(...args),
    sweepStaleExhaustedTicketEmailLeases: (...args: unknown[]) => sweepStaleExhaustedTicketEmailLeasesMock(...args),
  }
})

beforeEach(() => {
  sqlMock.mockClear()
  queue()
  attemptAutomaticTicketEmailMock.mockReset()
  sweepStaleExhaustedTicketEmailLeasesMock.mockReset().mockResolvedValue(0)
})

const recovery = await import('@/lib/events/ticketEmailRecovery')

const SOURCE = stripComments(readSource('lib/events/ticketEmailRecovery.ts'))
const RAW_SOURCE = readSource('lib/events/ticketEmailRecovery.ts')
const STRIPE_SOURCE = readSource('lib/events/stripe.ts')
// Comment-stripped variant — Phase 3E.3 added real (approved) code to
// stripe.ts referencing ticket_email_status, and its own explanatory
// comments legitimately name this file ("lib/events/ticketEmailRecovery.ts")
// when describing why the recovery cron, not the webhook, owns delivery.
// The contract this file's own "paid containment" tests care about is
// CODE coupling (an import or a call), never a comment mentioning a
// filename — checked against stripped source so a prose reference can
// never produce a false positive.
const STRIPE_SOURCE_STRIPPED = stripComments(STRIPE_SOURCE)

describe('constants', () => {
  it('RECOVERY_BATCH_SIZE is 20', () => {
    expect(recovery.RECOVERY_BATCH_SIZE).toBe(20)
  })
})

describe('findTicketEmailRecoveryCandidateOrderIds — SQL shape (static)', () => {
  function candidateQueryBody(): string {
    const start = SOURCE.indexOf('export async function findTicketEmailRecoveryCandidateOrderIds')
    expect(start, 'expected to find findTicketEmailRecoveryCandidateOrderIds').toBeGreaterThanOrEqual(0)
    const end = SOURCE.indexOf('\n}', start)
    return SOURCE.slice(start, end)
  }

  it('MANDATORY — never selects ticket_email_status IS NULL; every branch tests an explicit non-NULL value', () => {
    const body = candidateQueryBody()
    expect(body).not.toMatch(/ticket_email_status\s+IS\s+NULL/i)
    expect(body).toMatch(/ticket_email_status\s*=\s*'pending'/)
    expect(body).toMatch(/ticket_email_status\s*=\s*'failed'/)
    expect(body).toMatch(/ticket_email_status\s*=\s*'sending'/)
  })

  it('failed branch requires next_attempt_at <= NOW() and attempt_count < MAX_ATTEMPTS — never "IS NULL OR" (the exact 3E.1 regression class)', () => {
    const body = candidateQueryBody()
    expect(body).not.toMatch(/next_attempt_at\s+IS\s+NULL\s+OR/i)
    expect(body).toMatch(/ticket_email_attempt_count\s*<\s*\$\{MAX_ATTEMPTS\}/)
    expect(body).toMatch(/ticket_email_next_attempt_at\s*<=\s*NOW\(\)/)
  })

  it('sending branch requires a stale lease (claimed_at older than LEASE_TIMEOUT_MINUTES) and attempt_count < MAX_ATTEMPTS', () => {
    const body = candidateQueryBody()
    expect(body).toMatch(/ticket_email_claimed_at\s*<\s*NOW\(\)\s*-\s*make_interval\(mins\s*=>\s*\$\{LEASE_TIMEOUT_MINUTES\}\)/)
  })

  it('selects only id — no purchaser email, tokens, branding, or claim id', () => {
    const body = candidateQueryBody()
    expect(body).toMatch(/SELECT id FROM event_orders/)
    expect(body).not.toMatch(/purchaser_email|ticket_token|booking_token|organisation_settings|ticket_email_claim_id/)
  })

  it('is bounded by a LIMIT and never uses OFFSET', () => {
    const body = candidateQueryBody()
    expect(body).toMatch(/LIMIT\s*\$\{limit\}/)
    expect(body).not.toMatch(/OFFSET/i)
  })

  it('functional: maps returned rows to a plain string[] of ids', async () => {
    queue([{ id: 'order-1' }, { id: 'order-2' }])
    const ids = await recovery.findTicketEmailRecoveryCandidateOrderIds()
    expect(ids).toEqual(['order-1', 'order-2'])
  })

  it('functional: an empty result set returns an empty array', async () => {
    queue([])
    const ids = await recovery.findTicketEmailRecoveryCandidateOrderIds()
    expect(ids).toEqual([])
  })

  it('functional: honours an explicit limit argument passed through to the query', async () => {
    queue([{ id: 'order-1' }])
    await recovery.findTicketEmailRecoveryCandidateOrderIds(5)
    const callArgs = sqlMock.mock.calls[0] as unknown[]
    // Tagged-template call — the interpolated `limit` value is one of
    // the substitution arguments passed to the mocked sql tag function.
    expect(callArgs.flat(Infinity)).toContain(5)
  })
})

describe('runTicketEmailRecovery — sequencing', () => {
  it('calls sweepStaleExhaustedTicketEmailLeases BEFORE candidate discovery — sweep runs, then the candidate SELECT, then per-candidate attempts', async () => {
    queue([])
    await recovery.runTicketEmailRecovery()
    // vitest's own invocationCallOrder is a single global counter shared
    // across every mock — comparing the two mocks' first invocation
    // order proves sequencing without needing to override sqlMock's
    // implementation (which would otherwise leak into later tests, since
    // beforeEach only mockClear()s it, not mockReset()s it).
    const sweepOrder = sweepStaleExhaustedTicketEmailLeasesMock.mock.invocationCallOrder[0]
    const selectOrder = sqlMock.mock.invocationCallOrder[0]
    expect(sweepOrder).toBeLessThan(selectOrder)
  })

  it('passes the sweep a bounded limit (RECOVERY_BATCH_SIZE), never unbounded', async () => {
    queue([])
    await recovery.runTicketEmailRecovery()
    expect(sweepStaleExhaustedTicketEmailLeasesMock).toHaveBeenCalledWith(recovery.RECOVERY_BATCH_SIZE)
  })

  it('reports stale_exhausted_swept from the sweep\'s own return value, unmodified', async () => {
    sweepStaleExhaustedTicketEmailLeasesMock.mockResolvedValue(7)
    queue([])
    const summary = await recovery.runTicketEmailRecovery()
    expect(summary.stale_exhausted_swept).toBe(7)
  })
})

describe('runTicketEmailRecovery — atomic claim remains the sole authority (no bypass)', () => {
  it('never imports/calls claimTicketEmailDelivery, readClaimedOrderForDelivery, markTicketEmailSent, or markTicketEmailFailed directly — only attemptAutomaticTicketEmail and sweepStaleExhaustedTicketEmailLeases', () => {
    expect(SOURCE).not.toMatch(/claimTicketEmailDelivery|readClaimedOrderForDelivery|markTicketEmailSent|markTicketEmailFailed/)
    expect(SOURCE).toMatch(/attemptAutomaticTicketEmail/)
    expect(SOURCE).toMatch(/sweepStaleExhaustedTicketEmailLeases/)
  })

  it('never imports sendTicketEmail or lib/email — sends only ever happen inside attemptAutomaticTicketEmail', () => {
    expect(SOURCE).not.toMatch(/sendTicketEmail|from ['"]@\/lib\/email['"]/)
  })

  it('for each candidate id, calls attemptAutomaticTicketEmail exactly once with that id', async () => {
    queue([{ id: 'order-a' }, { id: 'order-b' }])
    attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'not_claimed' })
    await recovery.runTicketEmailRecovery()
    expect(attemptAutomaticTicketEmailMock).toHaveBeenCalledTimes(2)
    expect(attemptAutomaticTicketEmailMock).toHaveBeenNthCalledWith(1, 'order-a')
    expect(attemptAutomaticTicketEmailMock).toHaveBeenNthCalledWith(2, 'order-b')
  })

  it('a candidate that comes back not_claimed (raced by another worker) is tallied as not_claimed, with no error and no assumption of a send', async () => {
    queue([{ id: 'order-a' }])
    attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'not_claimed' })
    const summary = await recovery.runTicketEmailRecovery()
    expect(summary.not_claimed).toBe(1)
    expect(summary.claimed).toBe(0)
    expect(summary.sent).toBe(0)
  })
})

describe('runTicketEmailRecovery — result tally', () => {
  it('sent outcome: claimed and sent both increment', async () => {
    queue([{ id: 'order-a' }])
    attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'sent', providerMessageId: 'msg-1' })
    const summary = await recovery.runTicketEmailRecovery()
    expect(summary.claimed).toBe(1)
    expect(summary.sent).toBe(1)
    expect(summary.retryable_failed).toBe(0)
    expect(summary.terminal_failed).toBe(0)
  })

  it('failed + terminal:false outcome: claimed and retryable_failed both increment', async () => {
    queue([{ id: 'order-a' }])
    attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'failed', reason: 'provider_rejected', terminal: false })
    const summary = await recovery.runTicketEmailRecovery()
    expect(summary.claimed).toBe(1)
    expect(summary.retryable_failed).toBe(1)
    expect(summary.terminal_failed).toBe(0)
    expect(summary.sent).toBe(0)
  })

  it('failed + terminal:true outcome: claimed and terminal_failed both increment, never retryable_failed', async () => {
    queue([{ id: 'order-a' }])
    attemptAutomaticTicketEmailMock.mockResolvedValue({ outcome: 'failed', reason: 'idempotency_payload_mismatch', terminal: true })
    const summary = await recovery.runTicketEmailRecovery()
    expect(summary.claimed).toBe(1)
    expect(summary.terminal_failed).toBe(1)
    expect(summary.retryable_failed).toBe(0)
  })

  it('considered equals the number of candidates returned by discovery, regardless of outcome mix', async () => {
    queue([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    attemptAutomaticTicketEmailMock
      .mockResolvedValueOnce({ outcome: 'sent', providerMessageId: null })
      .mockResolvedValueOnce({ outcome: 'not_claimed' })
      .mockResolvedValueOnce({ outcome: 'failed', reason: 'ambiguous_outcome', terminal: false })
    const summary = await recovery.runTicketEmailRecovery()
    expect(summary.considered).toBe(3)
    expect(summary.sent).toBe(1)
    expect(summary.not_claimed).toBe(1)
    expect(summary.retryable_failed).toBe(1)
  })

  it('reports a numeric duration_ms >= 0', async () => {
    queue([])
    const summary = await recovery.runTicketEmailRecovery()
    expect(typeof summary.duration_ms).toBe('number')
    expect(summary.duration_ms).toBeGreaterThanOrEqual(0)
  })
})

describe('runTicketEmailRecovery — failure isolation', () => {
  it('one candidate throwing unexpectedly does not stop the remaining candidates in the batch', async () => {
    queue([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    attemptAutomaticTicketEmailMock
      .mockResolvedValueOnce({ outcome: 'sent', providerMessageId: null })
      .mockImplementationOnce(() => { throw new Error('unexpected') })
      .mockResolvedValueOnce({ outcome: 'sent', providerMessageId: null })
    const summary = await recovery.runTicketEmailRecovery()
    expect(attemptAutomaticTicketEmailMock).toHaveBeenCalledTimes(3)
    expect(summary.sent).toBe(2)
    expect(summary.not_claimed).toBe(1) // the thrown candidate's safe fallback tally
  })

  it('processes candidates sequentially, not via Promise.all — source never contains Promise.all/Promise.allSettled', () => {
    expect(SOURCE).not.toMatch(/Promise\.all/)
  })

  it('uses a plain for...of loop (matches lib/integrations/syncEngine.ts\'s own established batch-processing convention)', () => {
    expect(SOURCE).toMatch(/for\s*\(\s*const\s+orderId\s+of\s+candidateIds\s*\)/)
  })
})

describe('response/summary shape — no sensitive data', () => {
  it('TicketEmailRecoverySummary carries exactly the 8 documented counters, nothing else', async () => {
    queue([])
    const summary = await recovery.runTicketEmailRecovery()
    expect(Object.keys(summary).sort()).toEqual([
      'claimed', 'considered', 'duration_ms', 'not_claimed', 'retryable_failed',
      'sent', 'stale_exhausted_swept', 'terminal_failed',
    ])
  })

  it('source never interpolates an order id, email, or token into any returned/logged value from this module', () => {
    // This module's own exported summary type/functions never reference
    // these identifiers by name in a way that could leak them outward —
    // the raw candidate ids stay local to the for...of loop and are
    // never placed on the summary object itself (proven by the exact-
    // keys assertion above).
    expect(RAW_SOURCE).not.toMatch(/summary\.\w*(id|email|token)/i)
  })
})

describe('paid containment (mandatory)', () => {
  it('this module never imports lib/events/stripe.ts', () => {
    expect(SOURCE).not.toMatch(/from ['"]@\/lib\/events\/stripe['"]/)
  })

  it('this module contains no UPDATE/INSERT of any kind — it only ever SELECTs candidate ids and calls the existing orchestration for every mutation', () => {
    // The only literal SQL statement in this file is the candidate
    // SELECT (see findTicketEmailRecoveryCandidateOrderIds's own tests
    // above, including its own "= 'pending'" READ condition) — this
    // file must never itself contain a write statement; every state
    // mutation still goes exclusively through claimTicketEmailDelivery/
    // markTicketEmailSent/markTicketEmailFailed inside
    // attemptAutomaticTicketEmail, none of which this file calls
    // directly (see the "atomic claim remains the sole authority"
    // describe block above).
    expect(SOURCE).not.toMatch(/UPDATE\s+event_orders/i)
    expect(SOURCE).not.toMatch(/INSERT\s+INTO\s+event_orders/i)
  })

  // Still-valid contract, kept unchanged in substance (per Phase 3E.3's
  // own review of this file — this assertion is NOT obsolete, only its
  // source variant needed a fix): stripe.ts (now legitimately touched by
  // 3E.3's own narrow scheduling clause) has zero CODE coupling to this
  // recovery module — no import, no call to runTicketEmailRecovery.
  // Recovery remains entirely independent, cron-driven, and generic.
  it('the Stripe checkout/webhook flow never imports or calls this recovery module — no code coupling, even after Phase 3E.3 added its own narrow scheduling clause elsewhere in stripe.ts', () => {
    expect(STRIPE_SOURCE_STRIPPED).not.toMatch(/ticketEmailRecovery|runTicketEmailRecovery/)
  })

  it('this executor is generic — it discovers candidates purely by ticket_email_status, with no order-type/payment-method filter of any kind, so a future paid-scheduling phase can reuse it unchanged', () => {
    expect(SOURCE).not.toMatch(/payment_status|is_paid|order_type/i)
  })
})

describe('server-only boundary', () => {
  it('imports the server-only package as its very first import', () => {
    const firstImportLine = RAW_SOURCE.split('\n').find(l => l.trim().startsWith('import'))
    expect(firstImportLine).toBe("import 'server-only';")
  })
})
