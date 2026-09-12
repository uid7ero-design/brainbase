import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.6I — lib/organiser/helenaWrite.ts: the FIRST Helena Organiser
// write/action capability. Covers the dedicated stricter write-authorization
// boundary (authorizeHelenaOrganiserWrite, 'manager' floor — distinct from
// and never weakening authorizeHelenaOrganiserRead's 'viewer' floor), the
// propose/confirm+execute token contract (sign, verify, one mutation only
// when a valid token embeds exactly the fields being executed), tenant/
// actor safety, and that the underlying INSERT reuses the exact same atomic
// writable-CTE shape as the human-facing comment route. Only the two things
// this module ultimately touches (the sql client and authorizeOrganiserRequest)
// are mocked — same established pattern as organiserHelenaRead.test.ts and
// organiserHelenaToolsExecution.test.ts.
//
// Phase D.4.6K — updated for the durable-ledger redesign: confirm+execute is
// now ONE sql call (not two: item-lookup then insert), returning a single
// {item_found, was_consumed, comment_id, comment_body, comment_created_at}
// row that proposeOrExecuteOrganiserComment interprets into exactly one of
// item_not_found / already_used_confirmation / executed. New tests below
// cover jti presence/shape, the already-used outcome, and that a malformed
// jti is rejected — the real concurrent-replay proof against actual
// Postgres lives in scripts/tests/organiserConfirmationReplay.integration
// .test.ts (see scripts/tests/verify-organiser-confirmation-replay.sh),
// since a mock cannot prove a real UNIQUE-constraint race.

type SqlCall = { text: string; values: unknown[] }
let sqlCalls: SqlCall[] = []
let sqlResultQueue: unknown[][] = []
let sqlResult: unknown[] = []
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  sqlCalls.push({ text: strings.join('§'), values })
  if (sqlResultQueue.length > 0) return Promise.resolve(sqlResultQueue.shift())
  return Promise.resolve(sqlResult)
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const authorizeOrganiserRequestMock = vi.fn()
vi.mock('@/lib/organiser/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/organiser/authorize')>()
  return { ...actual, authorizeOrganiserRequest: (...args: unknown[]) => authorizeOrganiserRequestMock(...args) }
})

const { authorizeHelenaOrganiserWrite, proposeOrExecuteOrganiserComment, proposeOrExecuteOrganiserStatusChange, proposeOrExecuteOrganiserGroupMove } = await import('@/lib/organiser/helenaWrite')

const SESSION_MANAGER = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Manager Mia' }
const SESSION_VIEWER = { userId: 'u1', organisationId: 'org-a', role: 'viewer', name: 'Viewer Vic' }
const SESSION_ADMIN = { userId: 'u1', organisationId: 'org-a', role: 'admin', name: 'Admin Ana' }
const ITEM_A = '33333333-3333-3333-3333-333333333333'
const ITEM_B = '44444444-4444-4444-4444-444444444444'
const JTI_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

// A confirm-mode sql call returns exactly one row of this shape.
function executedRow(overrides: Partial<{ item_found: number; was_consumed: number; comment_id: string | null; comment_body: string | null; comment_created_at: string | null }> = {}) {
  return [{
    item_found: 1, was_consumed: 1,
    comment_id: 'update-1', comment_body: 'Hello team', comment_created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }]
}

beforeEach(() => {
  sqlMock.mockReset()
  sqlCalls = []
  sqlResult = []
  sqlResultQueue = []
  authorizeOrganiserRequestMock.mockReset()
  authorizeOrganiserRequestMock.mockResolvedValue({ ok: true, session: SESSION_MANAGER })
})

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../lib/organiser/helenaWrite.ts'), 'utf8')

// ── Write authorization boundary ────────────────────────────────────────────

describe('authorizeHelenaOrganiserWrite', () => {
  it('calls authorizeOrganiserRequest with the manager floor, not viewer', async () => {
    await authorizeHelenaOrganiserWrite()
    expect(authorizeOrganiserRequestMock).toHaveBeenCalledWith('manager')
  })

  it('manager role -> ok:true with organisationId/userId/actorName from the session', async () => {
    authorizeOrganiserRequestMock.mockResolvedValueOnce({ ok: true, session: SESSION_MANAGER })
    const result = await authorizeHelenaOrganiserWrite()
    expect(result).toEqual({ ok: true, organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia' })
  })

  it('admin role -> ok:true (roleGte is inclusive upward)', async () => {
    authorizeOrganiserRequestMock.mockResolvedValueOnce({ ok: true, session: SESSION_ADMIN })
    const result = await authorizeHelenaOrganiserWrite()
    expect(result.ok).toBe(true)
  })

  it('viewer role -> ok:false — the human comment route\'s own \'viewer\' floor is deliberately NOT sufficient for Helena writes', async () => {
    authorizeOrganiserRequestMock.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 403 }) })
    const result = await authorizeHelenaOrganiserWrite()
    expect(result).toEqual({ ok: false })
  })

  it('does not weaken or call authorizeHelenaOrganiserRead — this module never imports it (comments may legitimately name it while explaining the distinction)', () => {
    const codeOnly = SOURCE.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(codeOnly).not.toMatch(/authorizeHelenaOrganiserRead/)
  })
})

// ── PROPOSE mode ─────────────────────────────────────────────────────────────

describe('proposeOrExecuteOrganiserComment — propose mode (no confirmationToken)', () => {
  it('valid item + body -> proposed, with a confirmation token, and NO insert/mutation sql', async () => {
    sqlResult = [{ id: ITEM_A, name: 'My Item' }]
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: '  Hello team  ',
    })
    expect(result.ok).toBe(true)
    if (result.ok && result.mode === 'proposed') {
      expect(result.proposal).toEqual({ item_id: ITEM_A, item_name: 'My Item', body: 'Hello team' })
      expect(typeof result.confirmationToken).toBe('string')
      expect(result.confirmationToken.length).toBeGreaterThan(10)
    } else {
      throw new Error('expected proposed mode')
    }
    expect(sqlCalls.every(c => !/INSERT/i.test(c.text))).toBe(true)
  })

  it('malformed item_id -> invalid_item_id, zero sql calls at all', async () => {
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: 'not-a-uuid', body: 'hello',
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_item_id' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('item not found (wrong tenant or nonexistent) -> item_not_found', async () => {
    sqlResult = []
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello',
    })
    expect(result).toEqual({ ok: false, reason: 'item_not_found' })
  })

  it('empty/whitespace-only body -> invalid_body, before any sql is even issued', async () => {
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: '   ',
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_body' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('oversized body (>2000 chars) -> invalid_body', async () => {
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'a'.repeat(2001),
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_body' })
  })

  it('a body at exactly the 2000 char boundary is accepted', async () => {
    sqlResult = [{ id: ITEM_A, name: 'My Item' }]
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'a'.repeat(2000),
    })
    expect(result.ok).toBe(true)
  })

  it('D.4.6K: every proposal mints a fresh, well-formed jti (decode the signed token to check, without ever printing it in a report)', async () => {
    sqlResult = [{ id: ITEM_A, name: 'My Item' }]
    const r1 = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, body: 'one',
    })
    sqlResult = [{ id: ITEM_A, name: 'My Item' }]
    const r2 = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, body: 'one',
    })
    if (!r1.ok || r1.mode !== 'proposed' || !r2.ok || r2.mode !== 'proposed') throw new Error('expected two proposals')
    // Decode (not verify) the JWT payload locally just to inspect jti shape —
    // this is a base64url decode of the middle segment, not a forged/altered
    // token being submitted anywhere.
    const decode = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'))
    const p1 = decode(r1.confirmationToken)
    const p2 = decode(r2.confirmationToken)
    expect(typeof p1.jti).toBe('string')
    expect(p1.jti).toMatch(JTI_RE)
    expect(typeof p2.jti).toBe('string')
    expect(p2.jti).toMatch(JTI_RE)
    // Same item/body, but two independent proposals get two independent jtis.
    expect(p1.jti).not.toBe(p2.jti)
  })
})

// ── CONFIRM + EXECUTE mode ───────────────────────────────────────────────────

async function propose(overrides: Partial<{ organisationId: string; userId: string; actorName: string; itemId: string; body: string }> = {}) {
  sqlResult = [{ id: overrides.itemId ?? ITEM_A, name: 'My Item' }]
  const result = await proposeOrExecuteOrganiserComment({
    organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
    itemId: ITEM_A, body: 'Hello team',
    ...overrides,
  })
  if (!result.ok || result.mode !== 'proposed') throw new Error('propose() helper expected a proposal')
  return result
}

describe('proposeOrExecuteOrganiserComment — confirm+execute mode (confirmationToken present)', () => {
  it('a valid token executes exactly once: ONE atomic statement combining the ledger consume + organiser_item_updates + organiser_activity', async () => {
    const proposal = await propose()
    sqlCalls = [] // reset so we can inspect only the confirm-phase call
    sqlResultQueue = [executedRow()]

    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: 'IGNORED', body: 'IGNORED — must not be used',
      confirmationToken: proposal.confirmationToken,
    })

    expect(result).toEqual({
      ok: true, mode: 'executed',
      comment: { id: 'update-1', body: 'Hello team', created_at: '2026-01-01T00:00:00Z' },
    })
    // Exactly one sql call in confirm mode — the whole thing is one statement.
    expect(sqlCalls).toHaveLength(1)
    expect(sqlCalls[0].text).toMatch(/INSERT INTO organiser_action_confirmations/)
    expect(sqlCalls[0].text).toMatch(/ON CONFLICT \(jti\) DO NOTHING/)
    expect(sqlCalls[0].text).toMatch(/INSERT INTO organiser_item_updates/)
    expect(sqlCalls[0].text).toMatch(/INSERT INTO organiser_activity/)
    expect(sqlCalls[0].text).toMatch(/'comment\.created'/)
    expect(sqlCalls[0].text).toMatch(/'source', 'helena'/)
  })

  it('the model\'s CURRENT itemId/body arguments are ignored entirely in confirm mode — only the token\'s embedded values are ever mutated with', async () => {
    const proposal = await propose({ body: 'The ORIGINAL confirmed text' })
    sqlCalls = []
    sqlResultQueue = [executedRow({ comment_body: 'The ORIGINAL confirmed text' })]

    await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_B, body: 'An ALTERED malicious body the model tried to substitute',
      confirmationToken: proposal.confirmationToken,
    })

    const call = sqlCalls[0]
    expect(call.values).toContain('The ORIGINAL confirmed text')
    expect(call.values).not.toContain('An ALTERED malicious body the model tried to substitute')
    // The lookup itself was scoped to the token's own item id, never ITEM_B.
    expect(call.values).toContain(ITEM_A)
    expect(call.values).not.toContain(ITEM_B)
  })

  it('a garbage/malformed token string -> invalid_confirmation, zero sql calls', async () => {
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello', confirmationToken: 'not-a-real-jwt',
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('a token minted for a DIFFERENT organisationId is rejected when replayed against the current session\'s org — no cross-tenant execution, zero sql calls', async () => {
    const proposal = await propose()
    sqlCalls = []
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-DIFFERENT-TENANT', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('a token minted for a DIFFERENT userId is rejected when replayed under a different actor, zero sql calls', async () => {
    const proposal = await propose()
    sqlCalls = []
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u2-DIFFERENT-ACTOR', actorName: 'Someone Else',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('if the target item no longer exists at confirm time (deleted between propose and confirm), execution fails safely with no mutation and the token is reported unconsumed', async () => {
    const proposal = await propose()
    sqlCalls = []
    sqlResultQueue = [executedRow({ item_found: 0, was_consumed: 0, comment_id: null, comment_body: null, comment_created_at: null })]
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'item_not_found' })
    // Still exactly one sql call (the atomic statement itself ran) — but its
    // own internal WHERE EXISTS(target_item) gate meant nothing was consumed
    // or inserted; we only assert on the interpreted result here since the
    // "nothing written" guarantee is what the atomic statement's own WHERE
    // clauses (not a second guard statement) are responsible for.
    expect(sqlCalls).toHaveLength(1)
  })

  it('D.4.6K: a token already present in the ledger (was_consumed=0 but item_found=1) -> already_used_confirmation, not item_not_found and not success', async () => {
    const proposal = await propose()
    sqlCalls = []
    sqlResultQueue = [executedRow({ item_found: 1, was_consumed: 0, comment_id: null, comment_body: null, comment_created_at: null })]
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'already_used_confirmation' })
  })

  it('D.4.6K: replaying the exact same confirmationToken a second time (fresh call, same token) is rejected as already_used_confirmation — proves the caller cannot just retry a successful token for a second mutation', async () => {
    const proposal = await propose()
    sqlCalls = []

    // First confirm: ledger consume succeeds.
    sqlResultQueue = [executedRow()]
    const first = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    expect(first.ok).toBe(true)

    // Second confirm with the SAME token: the mock now simulates the ledger
    // already holding this jti (was_consumed=0), exactly what a real
    // ON CONFLICT (jti) DO NOTHING would return on replay.
    sqlResultQueue = [executedRow({ was_consumed: 0, comment_id: null, comment_body: null, comment_created_at: null })]
    const second = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    expect(second).toEqual({ ok: false, reason: 'already_used_confirmation' })
  })

  it('D.4.6K: the jti is passed to the ledger INSERT exactly as decoded from the token — never re-derived, never blank', async () => {
    const proposal = await propose()
    sqlCalls = []
    sqlResultQueue = [executedRow()]
    await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    const decode = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'))
    const { jti } = decode(proposal.confirmationToken)
    expect(sqlCalls[0].values).toContain(jti)
  })

  it('the actor written to organiser_item_updates/organiser_activity is the CURRENT trusted session\'s userId/actorName, not anything from the token payload', async () => {
    const proposal = await propose()
    sqlCalls = []
    sqlResultQueue = [executedRow()]
    await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia (current session)',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    expect(sqlCalls[0].values).toContain('Manager Mia (current session)')
  })

  // Phase D.4.6L — result-accuracy: a genuinely expired token must be
  // distinguishable from a tampered/malformed one, so the caller can
  // narrate "please ask again" instead of a bare generic failure. This
  // does NOT relax the actual security check — an expired token is still
  // rejected outright by jose's own jwtVerify(); only the label attached
  // to that rejection changes.
  it('D.4.6L: an expired token -> expired_confirmation, distinct from invalid_confirmation, zero sql calls', async () => {
    vi.useFakeTimers()
    try {
      const proposal = await propose()
      sqlCalls = []
      vi.advanceTimersByTime(3 * 60 * 1000) // past the 2-minute TTL
      const result = await proposeOrExecuteOrganiserComment({
        organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
        itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
      })
      expect(result).toEqual({ ok: false, reason: 'expired_confirmation' })
      expect(sqlCalls).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('D.4.6L: a well-formed but unexpired token with a tampered signature still reports invalid_confirmation (never expired_confirmation)', async () => {
    const proposal = await propose()
    sqlCalls = []
    const tampered = proposal.confirmationToken.slice(0, -4) + 'AAAA'
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello', confirmationToken: tampered,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' })
    expect(sqlCalls).toHaveLength(0)
  })
})

// ── Phase D.4.6L — ledger retention / cleanup ───────────────────────────────

describe('pruneExpiredConfirmationsBestEffort', () => {
  it('issues a single bounded, index-supported DELETE keyed on expires_at with a 1-day safety margin', async () => {
    const { pruneExpiredConfirmationsBestEffort } = await import('@/lib/organiser/helenaWrite')
    await pruneExpiredConfirmationsBestEffort()
    expect(sqlCalls).toHaveLength(1)
    const text = sqlCalls[0].text
    expect(text).toMatch(/DELETE FROM organiser_action_confirmations/)
    expect(text).toMatch(/expires_at < NOW\(\) - INTERVAL '1 day'/)
    expect(text).toMatch(/LIMIT/)
  })

  it('a cleanup failure is swallowed — never thrown to the caller', async () => {
    const { pruneExpiredConfirmationsBestEffort } = await import('@/lib/organiser/helenaWrite')
    sqlMock.mockImplementationOnce(() => Promise.reject(new Error('connection terminated unexpectedly')))
    await expect(pruneExpiredConfirmationsBestEffort()).resolves.toBeUndefined()
  })

  it('cleanup runs on a valid propose call but a cleanup failure does not block the proposal from succeeding', async () => {
    sqlMock.mockImplementationOnce(() => Promise.reject(new Error('cleanup boom')))
    sqlResultQueue = [[{ id: ITEM_A, name: 'Item A' }]]
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello',
    })
    expect(result.ok).toBe(true)
    expect((result as { mode: string }).mode).toBe('proposed')
  })

  it('cleanup never runs before invalid-input validation — zero sql calls for a malformed item_id', async () => {
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: 'not-a-uuid', body: 'hello',
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_item_id' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('cleanup is never invoked from the confirm+execute path — only from propose, decoupled from the atomic mutation statement', async () => {
    const proposal = await propose()
    sqlCalls = []
    sqlResultQueue = [executedRow()]
    await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    // Exactly the one atomic CTE statement — no separate DELETE alongside it.
    expect(sqlCalls).toHaveLength(1)
    expect(sqlCalls[0].text).not.toMatch(/DELETE/)
  })
})

// ── Raw audit / source-shape invariants ─────────────────────────────────────

describe('source-shape invariants', () => {
  it('reuses one atomic CTE combining the ledger consume, organiser_item_updates, and organiser_activity — no separate/second mutation statement', () => {
    expect(SOURCE).toMatch(/WITH target_item AS \(/)
    expect(SOURCE).toMatch(/consumed AS \(/)
    expect(SOURCE).toMatch(/inserted AS \(/)
    expect(SOURCE).toMatch(/activity_row AS \(/)
    expect(SOURCE).toMatch(/before_json, after_json, metadata_json/)
  })

  it('the ledger insert uses ON CONFLICT (jti) DO NOTHING — never a SELECT-then-INSERT replay check', () => {
    const codeOnly = SOURCE.replace(/\/\/.*$/gm, '')
    expect(codeOnly).toMatch(/ON CONFLICT \(jti\) DO NOTHING/)
  })

  it('the token purpose/actionType claims provide domain separation — a session JWT could never be mistaken for an action token', () => {
    expect(SOURCE).toMatch(/purpose !== TOKEN_PURPOSE/)
    expect(SOURCE).toMatch(/actionType !== expected\.actionType/)
  })

  it('token expiry is short-lived (minutes, not hours/days)', () => {
    expect(SOURCE).toMatch(/TOKEN_TTL = '2m'/)
  })

  it('D.4.6K: jti is validated for shape (malformed jti rejected) before ever being trusted', () => {
    const codeOnly = SOURCE.replace(/\/\/.*$/gm, '')
    expect(codeOnly).toMatch(/UUID_RE\.test\(p\.jti\)/)
  })

  it('D.4.6K: the raw confirmation token itself is never written to the ledger — only jti/org/user/action_type/item_id/expires_at columns appear in the INSERT column list', () => {
    const insertMatch = SOURCE.match(/INSERT INTO organiser_action_confirmations \(([^)]*)\)/)
    expect(insertMatch).not.toBeNull()
    const columns = insertMatch![1]
    expect(columns).not.toMatch(/token/i)
    expect(columns).not.toMatch(/body/i)
    expect(columns).not.toMatch(/secret/i)
  })
})

// ── Mutation check: prove the org/user match guard is load-bearing ─────────

describe('mutation check: cross-tenant token guard', () => {
  it('removing the organisationId/userId match check would let a cross-tenant replay succeed — this test fails if that guard is disabled', async () => {
    // This test intentionally re-derives the same scenario as the earlier
    // cross-tenant test above using a fresh proposal, and is the one
    // explicitly verified via real mutation (see D.4.6I report): with
    // verifyActionToken's organisationId/userId comparison temporarily
    // replaced with `true`, this exact assertion was confirmed to fail
    // (result.ok became true and an INSERT was issued) before being restored.
    const proposal = await propose()
    sqlCalls = []
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-b-attacker-tenant', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    expect(result.ok).toBe(false)
    expect(sqlCalls).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Phase D.4.6N — proposeOrExecuteOrganiserStatusChange: Helena's SECOND
// Organiser write action. Same established testing philosophy as the
// comment-action suite above: real integration through the actual function,
// only sql/authorizeOrganiserRequest mocked.
// ═══════════════════════════════════════════════════════════════════════════

function executedStatusChangeRow(overrides: Partial<{ item_found: number; was_consumed: number; updated_id: string | null; item_name: string | null; new_status: string | null }> = {}) {
  return [{
    item_found: 1, was_consumed: 1,
    updated_id: 'row-1', item_name: 'My Item', new_status: 'Done',
    ...overrides,
  }]
}

async function proposeStatusChange(overrides: Partial<{ organisationId: string; userId: string; actorName: string; itemId: string; desiredStatus: string }> = {}) {
  sqlResult = [{ id: overrides.itemId ?? ITEM_A, name: 'My Item', status: 'Not Started' }]
  const result = await proposeOrExecuteOrganiserStatusChange({
    organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
    itemId: ITEM_A, desiredStatus: 'Done',
    ...overrides,
  })
  if (!result.ok || result.mode !== 'proposed') throw new Error('proposeStatusChange() helper expected a proposal')
  return result
}

describe('proposeOrExecuteOrganiserStatusChange — propose mode (no confirmationToken)', () => {
  beforeEach(() => {
    authorizeOrganiserRequestMock.mockResolvedValue({ ok: true, session: SESSION_MANAGER })
  })

  it('valid item + valid new status -> proposal carrying current AND desired status, zero mutation', async () => {
    sqlResult = [{ id: ITEM_A, name: 'My Item', status: 'Not Started' }]
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
    })
    expect(result.ok).toBe(true)
    if (result.ok && result.mode === 'proposed') {
      expect(result.proposal).toEqual({ item_id: ITEM_A, item_name: 'My Item', current_status: 'Not Started', desired_status: 'Done' })
      expect(result.confirmationToken).toBeTruthy()
    } else {
      throw new Error('expected proposed')
    }
    expect(sqlCalls.some(c => /UPDATE|INSERT/i.test(c.text))).toBe(false)
  })

  it('malformed item_id -> invalid_item_id, zero sql calls', async () => {
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: 'not-a-uuid', desiredStatus: 'Done',
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_item_id' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('an unrecognised status string -> invalid_status, zero sql calls (never silently coerced to a real status)', async () => {
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Completed',
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_status' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('requested status already equals current status -> noop_same_status, zero mutation, no token minted', async () => {
    sqlResult = [{ id: ITEM_A, name: 'My Item', status: 'Done' }]
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
    })
    expect(result).toEqual({ ok: false, reason: 'noop_same_status' })
    expect(sqlCalls.some(c => /UPDATE|INSERT/i.test(c.text))).toBe(false)
  })

  it('wrong-tenant item (well-formed UUID, no matching row) -> item_not_found', async () => {
    sqlResult = []
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
    })
    expect(result).toEqual({ ok: false, reason: 'item_not_found' })
  })

  it('the minted token embeds expectedCurrentStatus as the TRUE current status read from the DB, never the model-supplied desiredStatus twice', async () => {
    sqlResult = [{ id: ITEM_A, name: 'My Item', status: 'Stuck' }]
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
    })
    if (!result.ok || result.mode !== 'proposed') throw new Error('expected proposed')
    const decode = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'))
    const payload = decode(result.confirmationToken)
    expect(payload.expectedCurrentStatus).toBe('Stuck')
    expect(payload.desiredStatus).toBe('Done')
    expect(typeof payload.jti).toBe('string')
  })

  it('model cannot supply organisationId/userId/jti — proposal always uses the trusted caller-supplied values, jti is server-minted', async () => {
    sqlResult = [{ id: ITEM_A, name: 'My Item', status: 'Not Started' }]
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
    })
    if (!result.ok || result.mode !== 'proposed') throw new Error('expected proposed')
    const decode = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'))
    const payload = decode(result.confirmationToken)
    expect(payload.organisationId).toBe('org-a')
    expect(payload.userId).toBe('u1')
    expect(JTI_RE.test(payload.jti)).toBe(true)
  })
})

describe('proposeOrExecuteOrganiserStatusChange — confirm+execute mode (confirmationToken present)', () => {
  beforeEach(() => {
    authorizeOrganiserRequestMock.mockResolvedValue({ ok: true, session: SESSION_MANAGER })
  })

  it('a valid token executes exactly once: ONE atomic statement, status changes, exactly one activity row implied by the single INSERT', async () => {
    const proposal = await proposeStatusChange()
    sqlCalls = []
    sqlResultQueue = [executedStatusChangeRow()]
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result.ok).toBe(true)
    if (result.ok && result.mode === 'executed') {
      expect(result.item).toEqual({ id: 'row-1', name: 'My Item', previous_status: 'Not Started', new_status: 'Done' })
    } else {
      throw new Error('expected executed')
    }
    expect(sqlCalls).toHaveLength(1)
    expect(sqlCalls[0].text).toMatch(/WITH target_item AS MATERIALIZED/)
    expect(sqlCalls[0].text).toMatch(/FOR UPDATE/)
    expect(sqlCalls[0].text).toMatch(/ON CONFLICT \(jti\) DO NOTHING/)
    expect(sqlCalls[0].text).toMatch(/UPDATE organiser_items/)
    expect(sqlCalls[0].text).toMatch(/INSERT INTO organiser_activity/)
    expect(sqlCalls[0].text).toMatch(/'item\.updated'/)
  })

  it('altered item_id/desiredStatus in the SAME confirming call are ignored — only the originally-proposed transition is ever applied', async () => {
    const proposal = await proposeStatusChange()
    sqlCalls = []
    sqlResultQueue = [executedStatusChangeRow()]
    await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_B, desiredStatus: 'Stuck',
      confirmationToken: proposal.confirmationToken,
    })
    const updateCall = sqlCalls.find(c => /UPDATE organiser_items/.test(c.text))!
    expect(updateCall.values).toContain('Done')
    expect(updateCall.values).not.toContain('Stuck')
    expect(updateCall.values).toContain(ITEM_A)
    expect(updateCall.values).not.toContain(ITEM_B)
  })

  it('a bogus/tampered confirmationToken -> invalid_confirmation, zero sql calls', async () => {
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
      confirmationToken: 'not-a-real-token',
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('a token minted for a DIFFERENT organisationId is rejected — no cross-tenant execution, zero sql calls', async () => {
    const proposal = await proposeStatusChange()
    sqlCalls = []
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-DIFFERENT-TENANT', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('a token minted for a DIFFERENT userId is rejected — zero sql calls', async () => {
    const proposal = await proposeStatusChange()
    sqlCalls = []
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u2-DIFFERENT-ACTOR', actorName: 'Someone Else', itemId: ITEM_A, desiredStatus: 'Done',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('expired token -> expired_confirmation, distinct from invalid_confirmation, zero sql calls', async () => {
    vi.useFakeTimers()
    try {
      const proposal = await proposeStatusChange()
      sqlCalls = []
      vi.advanceTimersByTime(3 * 60 * 1000)
      const result = await proposeOrExecuteOrganiserStatusChange({
        organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
        confirmationToken: proposal.confirmationToken,
      })
      expect(result).toEqual({ ok: false, reason: 'expired_confirmation' })
      expect(sqlCalls).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('target item no longer exists at confirm time -> item_not_found, token left unburned', async () => {
    const proposal = await proposeStatusChange()
    sqlCalls = []
    sqlResultQueue = [executedStatusChangeRow({ item_found: 0, was_consumed: 0, updated_id: null, item_name: null, new_status: null })]
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'item_not_found' })
    expect(sqlCalls).toHaveLength(1)
  })

  it('D.4.6N: a token already present in the ledger (was_consumed=0, item_found=1) -> already_used_confirmation', async () => {
    const proposal = await proposeStatusChange()
    sqlCalls = []
    sqlResultQueue = [executedStatusChangeRow({ item_found: 1, was_consumed: 0, updated_id: null, item_name: null, new_status: null })]
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'already_used_confirmation' })
  })

  it('D.4.6N CRITICAL: item_found=1, was_consumed=1, but the UPDATE matched zero rows (stale status) -> stale_item_state — the jti was still burned', async () => {
    const proposal = await proposeStatusChange()
    sqlCalls = []
    // Simulates the exact scenario: another actor changed the item's status
    // between propose and confirm, so the atomic UPDATE's own
    // `target_item.status = expectedCurrentStatus` guard matched zero rows
    // even though the ledger consume succeeded (item existed).
    sqlResultQueue = [executedStatusChangeRow({ item_found: 1, was_consumed: 1, updated_id: null, item_name: null, new_status: null })]
    const result = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'stale_item_state' })
  })

  it('D.4.6N: replaying the exact same confirmationToken a second time (fresh call, same token) is rejected as already_used_confirmation', async () => {
    const proposal = await proposeStatusChange()
    sqlCalls = []
    sqlResultQueue = [executedStatusChangeRow()]
    const first = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
      confirmationToken: proposal.confirmationToken,
    })
    expect(first.ok).toBe(true)

    sqlResultQueue = [executedStatusChangeRow({ was_consumed: 0, updated_id: null, item_name: null, new_status: null })]
    const second = await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
      confirmationToken: proposal.confirmationToken,
    })
    expect(second).toEqual({ ok: false, reason: 'already_used_confirmation' })
  })

  it('the jti is passed to the ledger INSERT exactly as decoded from the token, with action_type change_status', async () => {
    const proposal = await proposeStatusChange()
    sqlCalls = []
    sqlResultQueue = [executedStatusChangeRow()]
    await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, desiredStatus: 'Done',
      confirmationToken: proposal.confirmationToken,
    })
    const decode = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'))
    const { jti } = decode(proposal.confirmationToken)
    expect(sqlCalls[0].values).toContain(jti)
    // 'change_status' is embedded as a literal in the SQL text (matching
    // the comment action's own 'post_comment' literal), never a bound
    // parameter — checked against the query text, not the values array.
    expect(sqlCalls[0].text).toMatch(/'change_status'/)
  })

  it('the actor written to organiser_activity is the CURRENT trusted session, not anything from the token payload', async () => {
    const proposal = await proposeStatusChange()
    sqlCalls = []
    sqlResultQueue = [executedStatusChangeRow()]
    await proposeOrExecuteOrganiserStatusChange({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia (current session)', itemId: ITEM_A, desiredStatus: 'Done',
      confirmationToken: proposal.confirmationToken,
    })
    expect(sqlCalls[0].values).toContain('Manager Mia (current session)')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Phase D.4.6O — proposeOrExecuteOrganiserGroupMove: Helena's THIRD Organiser
// write action. Same established testing philosophy as the two suites above.
// PROPOSE mode makes THREE sequential sql calls in order (prune, item
// lookup, destination-group lookup) — sqlResultQueue entries below are
// always supplied in that exact order.
// ═══════════════════════════════════════════════════════════════════════════

const GROUP_SOURCE = '11111111-1111-1111-1111-111111111111'
const GROUP_DEST = '22222222-2222-2222-2222-222222222222'
const BOARD_A = '55555555-5555-5555-5555-555555555555'

function executedGroupMoveRow(overrides: Partial<{ item_found: number; was_consumed: number; dest_exists: boolean; dest_same_board: boolean; updated_id: string | null; item_name: string | null }> = {}) {
  return [{
    item_found: 1, was_consumed: 1, dest_exists: true, dest_same_board: true,
    updated_id: 'row-1', item_name: 'My Item',
    ...overrides,
  }]
}

async function proposeGroupMove(overrides: Partial<{ organisationId: string; userId: string; actorName: string; itemId: string; destinationGroupName: string }> = {}, opts: { itemGroupId?: string | null; destRows?: { id: string; name: string }[] } = {}) {
  sqlResultQueue = [
    [], // prune (ignored)
    [{ id: overrides.itemId ?? ITEM_A, name: 'My Item', board_id: BOARD_A, group_id: opts.itemGroupId === undefined ? GROUP_SOURCE : opts.itemGroupId, source_group_name: (opts.itemGroupId === undefined ? GROUP_SOURCE : opts.itemGroupId) === null ? null : 'Test' }],
    opts.destRows ?? [{ id: GROUP_DEST, name: 'Backlog' }],
  ]
  const result = await proposeOrExecuteOrganiserGroupMove({
    organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
    itemId: ITEM_A, destinationGroupName: 'Backlog',
    ...overrides,
  })
  if (!result.ok || result.mode !== 'proposed') throw new Error('proposeGroupMove() helper expected a proposal')
  return result
}

describe('proposeOrExecuteOrganiserGroupMove — propose mode (no confirmationToken)', () => {
  beforeEach(() => {
    authorizeOrganiserRequestMock.mockResolvedValue({ ok: true, session: SESSION_MANAGER })
  })

  it('valid item + valid same-board destination -> proposal carrying source AND destination group, zero mutation', async () => {
    const result = await proposeGroupMove()
    expect(result.proposal).toEqual({
      item_id: ITEM_A, item_name: 'My Item',
      source_group_id: GROUP_SOURCE, source_group_name: 'Test',
      destination_group_id: GROUP_DEST, destination_group_name: 'Backlog',
    })
    expect(result.confirmationToken).toBeTruthy()
    expect(sqlCalls.some(c => /UPDATE|INSERT/i.test(c.text))).toBe(false)
  })

  it('item currently ungrouped (group_id null) -> proposal carries source_group_id/name as null, not a crash', async () => {
    const result = await proposeGroupMove({}, { itemGroupId: null })
    expect(result.proposal.source_group_id).toBeNull()
    expect(result.proposal.source_group_name).toBeNull()
  })

  it('malformed item_id -> invalid_item_id, zero sql calls', async () => {
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: 'not-a-uuid', destinationGroupName: 'Backlog',
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_item_id' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('empty destination name -> destination_not_found, zero sql calls', async () => {
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: '   ',
    })
    expect(result).toEqual({ ok: false, reason: 'destination_not_found' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('item not found (wrong tenant / missing) -> item_not_found', async () => {
    sqlResultQueue = [[], []]
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
    })
    expect(result).toEqual({ ok: false, reason: 'item_not_found' })
  })

  it('no group with that name on the item\'s board -> destination_not_found (never guesses another board\'s same-named group — the lookup is board-scoped)', async () => {
    sqlResultQueue = [
      [],
      [{ id: ITEM_A, name: 'My Item', board_id: BOARD_A, group_id: GROUP_SOURCE, source_group_name: 'Test' }],
      [],
    ]
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Nonexistent',
    })
    expect(result).toEqual({ ok: false, reason: 'destination_not_found' })
  })

  it('more than one group shares the destination name on this board -> ambiguous_destination, never guessed', async () => {
    sqlResultQueue = [
      [],
      [{ id: ITEM_A, name: 'My Item', board_id: BOARD_A, group_id: GROUP_SOURCE, source_group_name: 'Test' }],
      [{ id: GROUP_DEST, name: 'Backlog' }, { id: 'group-dup', name: 'Backlog' }],
    ]
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
    })
    expect(result).toEqual({ ok: false, reason: 'ambiguous_destination' })
  })

  it('destination group equals the item\'s current group -> noop_same_group, zero mutation, no token minted', async () => {
    sqlResultQueue = [
      [],
      [{ id: ITEM_A, name: 'My Item', board_id: BOARD_A, group_id: GROUP_DEST, source_group_name: 'Backlog' }],
      [{ id: GROUP_DEST, name: 'Backlog' }],
    ]
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
    })
    expect(result).toEqual({ ok: false, reason: 'noop_same_group' })
    expect(sqlCalls.some(c => /UPDATE|INSERT/i.test(c.text))).toBe(false)
  })

  it('destination name matching is case-insensitive EXACT — never a substring/wildcard match', async () => {
    await proposeGroupMove({ destinationGroupName: 'BACKLOG' })
    const destCall = sqlCalls[2]
    expect(destCall.text).toMatch(/LOWER\(name\) = LOWER\(/)
    expect(destCall.text).not.toMatch(/ILIKE|LIKE/)
  })

  it('the minted token embeds expectedSourceGroupId/destinationGroupId as the TRUE server-resolved ids, never the model-supplied name twice', async () => {
    const proposal = await proposeGroupMove()
    const decode = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'))
    const payload = decode(proposal.confirmationToken)
    expect(payload.expectedSourceGroupId).toBe(GROUP_SOURCE)
    expect(payload.destinationGroupId).toBe(GROUP_DEST)
    expect(payload.boardId).toBe(BOARD_A)
    expect(typeof payload.jti).toBe('string')
  })

  it('model cannot supply organisationId/userId/jti/boardId/sourceGroupId — proposal always uses trusted/server-resolved values, jti is server-minted', async () => {
    const proposal = await proposeGroupMove()
    const decode = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'))
    const payload = decode(proposal.confirmationToken)
    expect(payload.organisationId).toBe('org-a')
    expect(payload.userId).toBe('u1')
    expect(JTI_RE.test(payload.jti)).toBe(true)
  })
})

describe('proposeOrExecuteOrganiserGroupMove — confirm+execute mode (confirmationToken present)', () => {
  beforeEach(() => {
    authorizeOrganiserRequestMock.mockResolvedValue({ ok: true, session: SESSION_MANAGER })
  })

  it('a valid token executes exactly once: ONE atomic statement, group changes, exactly one activity row implied by the single INSERT', async () => {
    const proposal = await proposeGroupMove()
    sqlCalls = []
    sqlResultQueue = [executedGroupMoveRow()]
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result.ok).toBe(true)
    if (result.ok && result.mode === 'executed') {
      expect(result.item).toEqual({ id: 'row-1', name: 'My Item', previous_group_name: 'Test', new_group_name: 'Backlog' })
    } else {
      throw new Error('expected executed')
    }
    expect(sqlCalls).toHaveLength(1)
    expect(sqlCalls[0].text).toMatch(/WITH target_item AS MATERIALIZED/)
    expect(sqlCalls[0].text).toMatch(/FOR UPDATE/)
    expect(sqlCalls[0].text).toMatch(/ON CONFLICT \(jti\) DO NOTHING/)
    expect(sqlCalls[0].text).toMatch(/UPDATE organiser_items/)
    expect(sqlCalls[0].text).toMatch(/INSERT INTO organiser_activity/)
    expect(sqlCalls[0].text).toMatch(/'item\.moved'/)
  })

  it('altered item_id/destination in the SAME confirming call are ignored — only the originally-proposed transition is ever applied', async () => {
    const proposal = await proposeGroupMove()
    sqlCalls = []
    sqlResultQueue = [executedGroupMoveRow()]
    await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_B, destinationGroupName: 'Some Other Group',
      confirmationToken: proposal.confirmationToken,
    })
    const updateCall = sqlCalls.find(c => /UPDATE organiser_items/.test(c.text))!
    expect(updateCall.values).toContain(GROUP_DEST)
    expect(updateCall.values).toContain(ITEM_A)
    expect(updateCall.values).not.toContain(ITEM_B)
  })

  it('a bogus/tampered confirmationToken -> invalid_confirmation, zero sql calls', async () => {
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: 'not-a-real-token',
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('a token minted for a DIFFERENT organisationId is rejected — no cross-tenant execution, zero sql calls', async () => {
    const proposal = await proposeGroupMove()
    sqlCalls = []
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-DIFFERENT-TENANT', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('a token minted for a DIFFERENT userId is rejected — zero sql calls', async () => {
    const proposal = await proposeGroupMove()
    sqlCalls = []
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u2-DIFFERENT-ACTOR', actorName: 'Someone Else', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' })
    expect(sqlCalls).toHaveLength(0)
  })

  it('expired token -> expired_confirmation, distinct from invalid_confirmation, zero sql calls', async () => {
    vi.useFakeTimers()
    try {
      const proposal = await proposeGroupMove()
      sqlCalls = []
      vi.advanceTimersByTime(3 * 60 * 1000)
      const result = await proposeOrExecuteOrganiserGroupMove({
        organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
        confirmationToken: proposal.confirmationToken,
      })
      expect(result).toEqual({ ok: false, reason: 'expired_confirmation' })
      expect(sqlCalls).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('target item no longer exists at confirm time -> item_not_found, token left unburned', async () => {
    const proposal = await proposeGroupMove()
    sqlCalls = []
    sqlResultQueue = [executedGroupMoveRow({ item_found: 0, was_consumed: 0, dest_exists: false, dest_same_board: false, updated_id: null, item_name: null })]
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'item_not_found' })
    expect(sqlCalls).toHaveLength(1)
  })

  it('a token already present in the ledger (was_consumed=0, item_found=1) -> already_used_confirmation', async () => {
    const proposal = await proposeGroupMove()
    sqlCalls = []
    sqlResultQueue = [executedGroupMoveRow({ item_found: 1, was_consumed: 0, updated_id: null, item_name: null })]
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'already_used_confirmation' })
  })

  it('D.4.6O CRITICAL: item_found=1, was_consumed=1, dest valid, but the UPDATE matched zero rows (stale location) -> stale_item_location — the jti was still burned', async () => {
    const proposal = await proposeGroupMove()
    sqlCalls = []
    // Simulates the exact scenario: another actor moved the item to a
    // DIFFERENT group between propose and confirm, so the atomic UPDATE's
    // own `target_item.group_id IS NOT DISTINCT FROM expectedSourceGroupId`
    // guard matched zero rows even though the ledger consume succeeded.
    sqlResultQueue = [executedGroupMoveRow({ item_found: 1, was_consumed: 1, dest_exists: true, dest_same_board: true, updated_id: null, item_name: null })]
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'stale_item_location' })
  })

  it('D.4.6O: destination group deleted before confirm (dest_exists=false) -> destination_not_found — the jti was still burned', async () => {
    const proposal = await proposeGroupMove()
    sqlCalls = []
    sqlResultQueue = [executedGroupMoveRow({ item_found: 1, was_consumed: 1, dest_exists: false, dest_same_board: false, updated_id: null, item_name: null })]
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'destination_not_found' })
  })

  it('D.4.6O: destination group moved to another board before confirm (dest_exists=true, dest_same_board=false) -> invalid_destination — the jti was still burned, never a board move', async () => {
    const proposal = await proposeGroupMove()
    sqlCalls = []
    sqlResultQueue = [executedGroupMoveRow({ item_found: 1, was_consumed: 1, dest_exists: true, dest_same_board: false, updated_id: null, item_name: null })]
    const result = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_destination' })
  })

  it('D.4.6O: replaying the exact same confirmationToken a second time (fresh call, same token) is rejected as already_used_confirmation', async () => {
    const proposal = await proposeGroupMove()
    sqlCalls = []
    sqlResultQueue = [executedGroupMoveRow()]
    const first = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: proposal.confirmationToken,
    })
    expect(first.ok).toBe(true)

    sqlResultQueue = [executedGroupMoveRow({ was_consumed: 0, updated_id: null, item_name: null })]
    const second = await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: proposal.confirmationToken,
    })
    expect(second).toEqual({ ok: false, reason: 'already_used_confirmation' })
  })

  it('the jti is passed to the ledger INSERT exactly as decoded from the token, with action_type move_group', async () => {
    const proposal = await proposeGroupMove()
    sqlCalls = []
    sqlResultQueue = [executedGroupMoveRow()]
    await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: proposal.confirmationToken,
    })
    const decode = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'))
    const { jti } = decode(proposal.confirmationToken)
    expect(sqlCalls[0].values).toContain(jti)
    expect(sqlCalls[0].text).toMatch(/'move_group'/)
  })

  it('the actor written to organiser_activity is the CURRENT trusted session, not anything from the token payload', async () => {
    const proposal = await proposeGroupMove()
    sqlCalls = []
    sqlResultQueue = [executedGroupMoveRow()]
    await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia (current session)', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: proposal.confirmationToken,
    })
    expect(sqlCalls[0].values).toContain('Manager Mia (current session)')
  })

  it('position is never read, computed, or written by this action — no position column appears in the UPDATE', async () => {
    const proposal = await proposeGroupMove()
    sqlCalls = []
    sqlResultQueue = [executedGroupMoveRow()]
    await proposeOrExecuteOrganiserGroupMove({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia', itemId: ITEM_A, destinationGroupName: 'Backlog',
      confirmationToken: proposal.confirmationToken,
    })
    const updateCall = sqlCalls.find(c => /UPDATE organiser_items/.test(c.text))!
    expect(updateCall.text).not.toMatch(/position/)
  })
})

describe('source-shape invariants — group move', () => {
  it('reuses one atomic CTE combining the ledger consume, the item group_id UPDATE, and organiser_activity — no separate/second mutation statement', () => {
    expect(SOURCE).toMatch(/WITH target_item AS MATERIALIZED \(/)
    expect(SOURCE).toMatch(/UPDATE organiser_items i\s*\n\s*SET group_id = \$\{verified\.destinationGroupId\}/)
    expect(SOURCE).toMatch(/target_item\.group_id IS NOT DISTINCT FROM \$\{verified\.expectedSourceGroupId\}/)
  })

  it('reuses the EXISTING item.moved activity event type — no new event vocabulary introduced', () => {
    const idx = SOURCE.indexOf('proposeOrExecuteOrganiserGroupMove')
    const region = SOURCE.slice(idx, idx + 8000)
    expect(region).toMatch(/'item\.moved'/)
    expect(region).not.toMatch(/'item\.group_changed'/)
    expect(region).not.toMatch(/'group\.item_moved'/)
  })

  it('the group_id widening reuses the SAME organisation-scoped board-boundary check as the human PATCH route (g.board_id = target_item.board_id) — never trusts a bare FK', () => {
    expect(SOURCE).toMatch(/g\.board_id = target_item\.board_id/)
  })

  it('destination is re-validated INSIDE the confirm-time atomic statement — never trusted merely because it passed at propose time', () => {
    const idx = SOURCE.indexOf('proposeOrExecuteOrganiserGroupMove')
    const region = SOURCE.slice(idx, idx + 8000)
    expect(region).toMatch(/dest_check/)
    expect(region).toMatch(/dest_exists/)
    expect(region).toMatch(/dest_same_board/)
  })

  it('the ledger consume for group move is gated ONLY on the item existing, never on source/destination validity (stale-confirmation-consumption asymmetry)', () => {
    const idx = SOURCE.indexOf('proposeOrExecuteOrganiserGroupMove')
    const region = SOURCE.slice(idx, idx + 8000)
    const consumedIdx = region.indexOf('consumed AS (')
    const consumedBlock = region.slice(consumedIdx, region.indexOf('updated AS (', consumedIdx))
    expect(consumedBlock).toMatch(/WHERE EXISTS \(SELECT 1 FROM target_item\)/)
    expect(consumedBlock).not.toMatch(/dest_check/)
  })
})

describe('source-shape invariants — status change', () => {
  it('reuses one atomic CTE combining the ledger consume, the item status UPDATE, and organiser_activity — no separate/second mutation statement', () => {
    expect(SOURCE).toMatch(/WITH target_item AS MATERIALIZED \(/)
    expect(SOURCE).toMatch(/UPDATE organiser_items i\s*\n\s*SET status = \$\{verified\.desiredStatus\}/)
    expect(SOURCE).toMatch(/target_item\.status = \$\{verified\.expectedCurrentStatus\}/)
  })

  it('reuses the EXISTING item.updated activity event type — no new event vocabulary introduced', () => {
    const idx = SOURCE.indexOf('proposeOrExecuteOrganiserStatusChange')
    const region = SOURCE.slice(idx, idx + 8000)
    expect(region).toMatch(/'item\.updated'/)
    expect(region).not.toMatch(/'item\.status_changed'/)
    expect(region).not.toMatch(/'status\.changed'/)
  })

  it('the status change and group move action_type widenings reuse the SAME ledger table and ON CONFLICT (jti) mechanism as the comment action — no second/third ledger table', () => {
    const codeOnly = SOURCE.replace(/\/\/.*$/gm, '')
    const matches = [...codeOnly.matchAll(/ON CONFLICT \(jti\) DO NOTHING/g)]
    expect(matches.length).toBe(3) // one per action's own atomic statement
    expect(codeOnly).not.toMatch(/CREATE TABLE|organiser_action_confirmations_v2|organiser_status_confirmations|organiser_group_move_confirmations/)
  })

  it('the canonical status list is exactly the 4 proven values from app/organiser/page.tsx\'s STATUS_OPTIONS — never invented', () => {
    expect(SOURCE).toMatch(/ORGANISER_ITEM_STATUS_OPTIONS = \['Not Started', 'Working on it', 'Stuck', 'Done'\]/)
  })

  it('no generic update/create/move/delete item capability exists anywhere in this file', () => {
    expect(SOURCE).not.toMatch(/\bupdateOrganiserItem\b|\bcreateOrganiserItem\b|\bmoveOrganiserItem\b|\bdeleteOrganiserItem\b/)
    expect(SOURCE).not.toMatch(/field:\s*string.*value:\s*unknown|patch:\s*Record/)
  })
})
