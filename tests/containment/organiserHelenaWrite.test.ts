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
  it('a valid token executes exactly once: one atomic CTE combining organiser_item_updates + organiser_activity', async () => {
    const proposal = await propose()
    sqlCalls = [] // reset so we can inspect only the confirm-phase calls
    sqlResultQueue = [[{ id: ITEM_A, board_id: 'board-1' }], [{ id: 'update-1', body: 'Hello team', created_at: '2026-01-01T00:00:00Z' }]]

    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: 'IGNORED', body: 'IGNORED — must not be used',
      confirmationToken: proposal.confirmationToken,
    })

    expect(result).toEqual({
      ok: true, mode: 'executed',
      comment: { id: 'update-1', body: 'Hello team', created_at: '2026-01-01T00:00:00Z' },
    })
    const mutationCalls = sqlCalls.filter(c => /INSERT/i.test(c.text))
    expect(mutationCalls).toHaveLength(1)
    expect(mutationCalls[0].text).toMatch(/INSERT INTO organiser_item_updates/)
    expect(mutationCalls[0].text).toMatch(/INSERT INTO organiser_activity/)
    expect(mutationCalls[0].text).toMatch(/'comment\.created'/)
    expect(mutationCalls[0].text).toMatch(/'source', 'helena'/)
  })

  it('the model\'s CURRENT itemId/body arguments are ignored entirely in confirm mode — only the token\'s embedded values are ever mutated with', async () => {
    const proposal = await propose({ body: 'The ORIGINAL confirmed text' })
    sqlCalls = []
    sqlResultQueue = [[{ id: ITEM_A, board_id: 'board-1' }], [{ id: 'update-1', body: 'The ORIGINAL confirmed text', created_at: 't' }]]

    await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_B, body: 'An ALTERED malicious body the model tried to substitute',
      confirmationToken: proposal.confirmationToken,
    })

    const insertCall = sqlCalls.find(c => /INSERT INTO organiser_item_updates/.test(c.text))!
    expect(insertCall.values).toContain('The ORIGINAL confirmed text')
    expect(insertCall.values).not.toContain('An ALTERED malicious body the model tried to substitute')
    // The lookup itself was scoped to the token's own item id, never ITEM_B.
    const lookupCall = sqlCalls.find(c => /SELECT id, board_id FROM organiser_items/.test(c.text))!
    expect(lookupCall.values).toContain(ITEM_A)
    expect(lookupCall.values).not.toContain(ITEM_B)
  })

  it('a garbage/malformed token string -> invalid_confirmation, zero INSERT calls', async () => {
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello', confirmationToken: 'not-a-real-jwt',
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' })
    expect(sqlCalls.some(c => /INSERT/i.test(c.text))).toBe(false)
  })

  it('a token minted for a DIFFERENT organisationId is rejected when replayed against the current session\'s org — no cross-tenant execution', async () => {
    const proposal = await propose()
    sqlCalls = []
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-DIFFERENT-TENANT', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' })
    expect(sqlCalls.some(c => /INSERT/i.test(c.text))).toBe(false)
  })

  it('a token minted for a DIFFERENT userId is rejected when replayed under a different actor', async () => {
    const proposal = await propose()
    sqlCalls = []
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u2-DIFFERENT-ACTOR', actorName: 'Someone Else',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_confirmation' })
  })

  it('if the target item no longer exists at confirm time (deleted between propose and confirm), execution fails safely with no mutation', async () => {
    const proposal = await propose()
    sqlCalls = []
    sqlResultQueue = [[]] // item lookup at confirm time returns nothing
    const result = await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    expect(result).toEqual({ ok: false, reason: 'item_not_found' })
    expect(sqlCalls.some(c => /INSERT/i.test(c.text))).toBe(false)
  })

  it('the actor written to organiser_item_updates/organiser_activity is the CURRENT trusted session\'s userId/actorName, not anything from the token payload', async () => {
    const proposal = await propose()
    sqlCalls = []
    sqlResultQueue = [[{ id: ITEM_A, board_id: 'board-1' }], [{ id: 'update-1', body: 'Hello team', created_at: 't' }]]
    await proposeOrExecuteOrganiserComment({
      organisationId: 'org-a', userId: 'u1', actorName: 'Manager Mia (current session)',
      itemId: ITEM_A, body: 'hello', confirmationToken: proposal.confirmationToken,
    })
    const insertCall = sqlCalls.find(c => /INSERT INTO organiser_item_updates/.test(c.text))!
    expect(insertCall.values).toContain('Manager Mia (current session)')
  })
})

// ── Raw audit / source-shape invariants ─────────────────────────────────────

describe('source-shape invariants', () => {
  it('reuses the exact atomic CTE INSERT shape the human-facing comment route already uses — no separate/second mutation statement', () => {
    expect(SOURCE).toMatch(/WITH inserted AS \(/)
    expect(SOURCE).toMatch(/activity_row AS \(/)
    expect(SOURCE).toMatch(/before_json, after_json, metadata_json/)
  })

  it('the token purpose/actionType claims provide domain separation — a session JWT could never be mistaken for an action token', () => {
    expect(SOURCE).toMatch(/purpose !== TOKEN_PURPOSE/)
    expect(SOURCE).toMatch(/actionType !== expected\.actionType/)
  })

  it('token expiry is short-lived (minutes, not hours/days)', () => {
    expect(SOURCE).toMatch(/TOKEN_TTL = '2m'/)
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
    expect(sqlCalls.some(c => /INSERT/i.test(c.text))).toBe(false)
  })
})
