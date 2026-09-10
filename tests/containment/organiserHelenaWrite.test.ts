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

const { authorizeHelenaOrganiserWrite, proposeOrExecuteOrganiserComment } = await import('@/lib/organiser/helenaWrite')

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
