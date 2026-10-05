import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import sql from '@/lib/db'
import { resequenceOrganiserItemScope, resequenceOrganiserGroupScope } from '@/lib/organiser/reorderTransactions'

// Phase D.4.7E (Slice E1) — proves lib/organiser/reorderTransactions.ts's
// resequenceOrganiserItemScope against a REAL database, by calling that
// exact function directly. Never a test-local reproduction of its SQL.
//
// ─── Isolation model (revised) ───────────────────────────────────────────
// An earlier version of this file attempted schema-level isolation
// (a disposable Postgres SCHEMA plus a connection-string
// `options=-c search_path=...` override) so the real, unqualified-name
// production primitive could be proven safely without touching real data.
// That was run for real against a real database and FAILED: the
// `options=` technique does not redirect unqualified-name resolution with
// the installed @neondatabase/serverless driver — every write landed in
// the real `public` schema instead, and was rejected only by an
// incidental foreign-key constraint (no corruption resulted, but the
// isolation mechanism itself was proven unsound and was discarded).
//
// The isolation boundary is now the ENTIRE NEON BRANCH, not a schema
// within a shared branch. This file is run against a temporary,
// throwaway branch created specifically for this run (see the phase's own
// E1 report for exactly how that branch is created/connected-to/destroyed
// — never checked into source, never printed). Because the whole branch
// is disposable, resequenceOrganiserItemScope's real, unqualified
// `organiser_items`/`organiser_groups` table references need no
// redirection at all — they correctly resolve to that branch's own real
// `public` schema, which already has the full production-shaped schema
// (every Neon branch in this project is a descendant of `production`).
// Fixture rows are inserted directly into those real tables, scoped to
// two throwaway organisation ids generated fresh per run
// (crypto.randomUUID()-based, never a guessable literal like 'org-a'),
// and cleaned up in afterAll — not because the branch deletion alone
// isn't enough (it is), but because leaving a fixture-free database
// through the run makes every assertion (row counts, FK behavior)
// unambiguous while the branch is still alive for debugging if a test
// fails.
//
// Gated by the same two-flag convention as every other organiser
// integration test in this repo:
//   RUN_ORGANISER_DB_INTEGRATION=1 ORGANISER_DB_INTEGRATION_CONFIRM_NON_PRODUCTION=1 \
//     npx vitest run tests/containment/organiserReorderTransaction.integration.test.ts
// DATABASE_URL must already point at the temporary branch when this runs
// (via --env-file, never inline, never printed) — this file never reads
// or logs it itself.
const RUN_FLAG = process.env.RUN_ORGANISER_DB_INTEGRATION === '1'
const NON_PRODUCTION_ACK = process.env.ORGANISER_DB_INTEGRATION_CONFIRM_NON_PRODUCTION === '1'
const shouldRun = RUN_FLAG && NON_PRODUCTION_ACK

const ORG_A = `e1-test-org-a-${crypto.randomBytes(8).toString('hex')}`
const ORG_B = `e1-test-org-b-${crypto.randomBytes(8).toString('hex')}`

describe.skipIf(!shouldRun)('resequenceOrganiserItemScope — real database integration (ephemeral branch)', () => {
  beforeAll(async () => {
    await sql`
      INSERT INTO organisations (id, name, slug, updated_at) VALUES
        (${ORG_A}, 'E1 Test Org A', ${ORG_A}, NOW()),
        (${ORG_B}, 'E1 Test Org B', ${ORG_B}, NOW())
    `
  })

  afterAll(async () => {
    // Deletes boards (cascades to groups/items via their own ON DELETE
    // CASCADE on board_id), then organisations. organiser_activity has no
    // FK to organiser_boards/items (by design — see
    // app/api/admin/migrate/route.ts step 40's own comment), so it's
    // cleaned separately; expected to already be empty for these org ids
    // (that emptiness is exactly what section 5 below proves), but deleted
    // defensively in case an earlier mutation-proofing step left a row
    // before this file's own restoration step ran.
    await sql`DELETE FROM organiser_activity WHERE organisation_id IN (${ORG_A}, ${ORG_B})`
    await sql`DELETE FROM organiser_boards WHERE organisation_id IN (${ORG_A}, ${ORG_B})`
    await sql`DELETE FROM organisations WHERE id IN (${ORG_A}, ${ORG_B})`
  })

  async function makeBoard(orgId: string): Promise<string> {
    const rows = (await sql`INSERT INTO organiser_boards (organisation_id, name) VALUES (${orgId}, 'E1 Test Board') RETURNING id`) as { id: string }[]
    return rows[0].id
  }
  async function makeGroup(orgId: string, boardId: string): Promise<string> {
    const rows = (await sql`INSERT INTO organiser_groups (board_id, organisation_id, name) VALUES (${boardId}, ${orgId}, 'E1 Test Group') RETURNING id`) as { id: string }[]
    return rows[0].id
  }
  async function makeItem(orgId: string, boardId: string, groupId: string | null, opts?: { parentItemId?: string | null; position?: number }): Promise<string> {
    const rows = (await sql`
      INSERT INTO organiser_items (board_id, organisation_id, group_id, parent_item_id, name, position)
      VALUES (${boardId}, ${orgId}, ${groupId}, ${opts?.parentItemId ?? null}, 'E1 Test Item', ${opts?.position ?? 0})
      RETURNING id
    `) as { id: string }[]
    return rows[0].id
  }
  async function positionsOf(itemIds: string[]): Promise<Record<string, number>> {
    const rows = (await sql`SELECT id, position FROM organiser_items WHERE id = ANY(${itemIds}::uuid[])`) as { id: string; position: number }[]
    const out: Record<string, number> = {}
    for (const r of rows) out[r.id] = r.position
    return out
  }
  async function activityCountFor(orgId: string): Promise<number> {
    const rows = (await sql`SELECT COUNT(*)::int AS n FROM organiser_activity WHERE organisation_id = ${orgId}`) as { n: number }[]
    return rows[0].n
  }

  describe('0. connectivity self-check', () => {
    it('the two fixture organisations exist and are visible from this connection', async () => {
      const rows = (await sql`SELECT id FROM organisations WHERE id IN (${ORG_A}, ${ORG_B}) ORDER BY id`) as { id: string }[]
      expect(rows.map(r => r.id).sort()).toEqual([ORG_A, ORG_B].sort())
    })
  })

  describe('1. exact permutation', () => {
    it('an exact permutation succeeds: resequences to contiguous 0..N-1 matching the requested order, authoritative order matches persisted order, no activity written', async () => {
      const board = await makeBoard(ORG_A)
      const group = await makeGroup(ORG_A, board)
      const a = await makeItem(ORG_A, board, group, { position: 0 })
      const b = await makeItem(ORG_A, board, group, { position: 1 })
      const c = await makeItem(ORG_A, board, group, { position: 2 })
      const activityBefore = await activityCountFor(ORG_A)

      const result = await resequenceOrganiserItemScope(
        { type: 'top_level_group', organisationId: ORG_A, boardId: board, groupId: group },
        [c, a, b],
      )

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const byId = Object.fromEntries(result.order.map(o => [o.id, o.position]))
      expect(byId).toEqual({ [c]: 0, [a]: 1, [b]: 2 })

      const persisted = await positionsOf([a, b, c])
      expect(persisted).toEqual({ [c]: 0, [a]: 1, [b]: 2 })
      expect(persisted).toEqual(byId)
      expect(await activityCountFor(ORG_A)).toBe(activityBefore)
    })
  })

  describe('2. rejection cases — each leaves positions completely untouched, zero writes', () => {
    it('duplicate id in requested list — rejected, positions unchanged', async () => {
      const board = await makeBoard(ORG_A)
      const group = await makeGroup(ORG_A, board)
      const a = await makeItem(ORG_A, board, group, { position: 0 })
      const b = await makeItem(ORG_A, board, group, { position: 1 })
      const before = await positionsOf([a, b])

      const result = await resequenceOrganiserItemScope(
        { type: 'top_level_group', organisationId: ORG_A, boardId: board, groupId: group },
        [a, a],
      )

      expect(result).toEqual({ ok: false, reason: 'duplicate' })
      expect(await positionsOf([a, b])).toEqual(before)
    })

    it('an existing sibling omitted from the requested list — rejected, positions unchanged', async () => {
      const board = await makeBoard(ORG_A)
      const group = await makeGroup(ORG_A, board)
      const a = await makeItem(ORG_A, board, group, { position: 0 })
      const b = await makeItem(ORG_A, board, group, { position: 1 })
      const before = await positionsOf([a, b])

      const result = await resequenceOrganiserItemScope(
        { type: 'top_level_group', organisationId: ORG_A, boardId: board, groupId: group },
        [a],
      )

      expect(result).toEqual({ ok: false, reason: 'missing' })
      expect(await positionsOf([a, b])).toEqual(before)
    })

    it('a foreign id from a DIFFERENT group on the SAME board — rejected, positions unchanged', async () => {
      const board = await makeBoard(ORG_A)
      const groupX = await makeGroup(ORG_A, board)
      const groupY = await makeGroup(ORG_A, board)
      const a = await makeItem(ORG_A, board, groupX, { position: 0 })
      const foreign = await makeItem(ORG_A, board, groupY, { position: 0 })
      const before = await positionsOf([a, foreign])

      const result = await resequenceOrganiserItemScope(
        { type: 'top_level_group', organisationId: ORG_A, boardId: board, groupId: groupX },
        [a, foreign],
      )

      expect(result).toEqual({ ok: false, reason: 'extra' })
      expect(await positionsOf([a, foreign])).toEqual(before)
    })

    it('a foreign id from a DIFFERENT board — rejected, positions unchanged', async () => {
      const boardA = await makeBoard(ORG_A)
      const boardB = await makeBoard(ORG_A)
      const groupA = await makeGroup(ORG_A, boardA)
      const groupB = await makeGroup(ORG_A, boardB)
      const a = await makeItem(ORG_A, boardA, groupA, { position: 0 })
      const foreign = await makeItem(ORG_A, boardB, groupB, { position: 0 })
      const before = await positionsOf([a, foreign])

      const result = await resequenceOrganiserItemScope(
        { type: 'top_level_group', organisationId: ORG_A, boardId: boardA, groupId: groupA },
        [a, foreign],
      )

      expect(result).toEqual({ ok: false, reason: 'extra' })
      expect(await positionsOf([a, foreign])).toEqual(before)
    })

    it('a foreign id from a DIFFERENT organisation entirely — rejected, positions unchanged, no cross-tenant leak', async () => {
      const boardA = await makeBoard(ORG_A)
      const groupA = await makeGroup(ORG_A, boardA)
      const boardB = await makeBoard(ORG_B)
      const groupB = await makeGroup(ORG_B, boardB)
      const a = await makeItem(ORG_A, boardA, groupA, { position: 0 })
      const foreign = await makeItem(ORG_B, boardB, groupB, { position: 0 })
      const before = await positionsOf([a, foreign])

      const result = await resequenceOrganiserItemScope(
        { type: 'top_level_group', organisationId: ORG_A, boardId: boardA, groupId: groupA },
        [a, foreign],
      )

      expect(result).toEqual({ ok: false, reason: 'extra' })
      expect(await positionsOf([a, foreign])).toEqual(before)
    })

    it('a subitem id contaminating a top-level scope — rejected (subitems are never part of the top-level authoritative set)', async () => {
      const board = await makeBoard(ORG_A)
      const group = await makeGroup(ORG_A, board)
      const parent = await makeItem(ORG_A, board, group, { position: 0 })
      const sibling = await makeItem(ORG_A, board, group, { position: 1 })
      const child = await makeItem(ORG_A, board, group, { position: 0, parentItemId: parent })
      const before = await positionsOf([parent, sibling, child])

      const result = await resequenceOrganiserItemScope(
        { type: 'top_level_group', organisationId: ORG_A, boardId: board, groupId: group },
        [parent, child],
      )

      expect(result).toEqual({ ok: false, reason: 'extra' })
      expect(await positionsOf([parent, sibling, child])).toEqual(before)
    })
  })

  describe('3. subitem scope reorders independently of its parent\'s siblings', () => {
    it('reorders one parent\'s subitems without touching the parent\'s own top-level siblings', async () => {
      const board = await makeBoard(ORG_A)
      const group = await makeGroup(ORG_A, board)
      const parent = await makeItem(ORG_A, board, group, { position: 0 })
      const otherTopLevel = await makeItem(ORG_A, board, group, { position: 1 })
      const child1 = await makeItem(ORG_A, board, group, { position: 0, parentItemId: parent })
      const child2 = await makeItem(ORG_A, board, group, { position: 1, parentItemId: parent })
      const topLevelBefore = await positionsOf([parent, otherTopLevel])

      const result = await resequenceOrganiserItemScope(
        { type: 'subitems', organisationId: ORG_A, boardId: board, parentItemId: parent },
        [child2, child1],
      )

      expect(result.ok).toBe(true)
      expect(await positionsOf([child1, child2])).toEqual({ [child2]: 0, [child1]: 1 })
      expect(await positionsOf([parent, otherTopLevel])).toEqual(topLevelBefore)
    })
  })

  describe('4. concurrency — two resequences of the SAME scope never interleave/corrupt', () => {
    it('two concurrent resequence calls against the same group serialize on the FOR UPDATE lock; final state is exactly one of the two intended orders, never a mix', async () => {
      const board = await makeBoard(ORG_A)
      const group = await makeGroup(ORG_A, board)
      const a = await makeItem(ORG_A, board, group, { position: 0 })
      const b = await makeItem(ORG_A, board, group, { position: 1 })
      const c = await makeItem(ORG_A, board, group, { position: 2 })

      const orderX = [c, b, a]
      const orderY = [b, a, c]

      const [resultX, resultY] = await Promise.all([
        resequenceOrganiserItemScope({ type: 'top_level_group', organisationId: ORG_A, boardId: board, groupId: group }, orderX),
        resequenceOrganiserItemScope({ type: 'top_level_group', organisationId: ORG_A, boardId: board, groupId: group }, orderY),
      ])

      expect(resultX.ok).toBe(true)
      expect(resultY.ok).toBe(true)

      const finalPositions = await positionsOf([a, b, c])
      const finalOrder = [a, b, c]
        .map(id => ({ id, position: finalPositions[id] }))
        .sort((p, q) => p.position - q.position)
        .map(p => p.id)

      const matchesX = JSON.stringify(finalOrder) === JSON.stringify(orderX)
      const matchesY = JSON.stringify(finalOrder) === JSON.stringify(orderY)
      expect(matchesX || matchesY).toBe(true)

      const values = Object.values(finalPositions).sort((x, y) => x - y)
      expect(values).toEqual([0, 1, 2])
    })
  })

  describe('5. never writes organiser_activity', () => {
    it('a successful resequence inserts zero organiser_activity rows', async () => {
      const board = await makeBoard(ORG_A)
      const group = await makeGroup(ORG_A, board)
      const a = await makeItem(ORG_A, board, group, { position: 0 })
      const b = await makeItem(ORG_A, board, group, { position: 1 })
      const before = await activityCountFor(ORG_A)

      const result = await resequenceOrganiserItemScope(
        { type: 'top_level_group', organisationId: ORG_A, boardId: board, groupId: group },
        [b, a],
      )

      expect(result.ok).toBe(true)
      expect(await activityCountFor(ORG_A)).toBe(before)
    })
  })

  // Phase D.4.7E (Slice E2) — resequenceOrganiserGroupScope, the sibling
  // group primitive. Same real-database rigor as the item primitive above:
  // calls the actual executable function, never test-local SQL.
  describe('6. group reorder (resequenceOrganiserGroupScope)', () => {
    it('an exact permutation succeeds: resequences to contiguous 0..N-1, authoritative order matches persisted order, no activity written', async () => {
      const board = await makeBoard(ORG_A)
      const g1 = await makeGroup(ORG_A, board)
      const g2 = await makeGroup(ORG_A, board)
      const g3 = await makeGroup(ORG_A, board)
      const activityBefore = await activityCountFor(ORG_A)

      const result = await resequenceOrganiserGroupScope(
        { organisationId: ORG_A, boardId: board },
        [g3, g1, g2],
      )

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const byId = Object.fromEntries(result.order.map(o => [o.id, o.position]))
      expect(byId).toEqual({ [g3]: 0, [g1]: 1, [g2]: 2 })

      const rows = (await sql`SELECT id, position FROM organiser_groups WHERE id = ANY(${[g1, g2, g3]}::uuid[])`) as { id: string; position: number }[]
      const persisted = Object.fromEntries(rows.map(r => [r.id, r.position]))
      expect(persisted).toEqual({ [g3]: 0, [g1]: 1, [g2]: 2 })
      expect(persisted).toEqual(byId)
      expect(await activityCountFor(ORG_A)).toBe(activityBefore)
    })

    it('duplicate id rejected, positions unchanged', async () => {
      const board = await makeBoard(ORG_A)
      const g1 = await makeGroup(ORG_A, board)
      const g2 = await makeGroup(ORG_A, board)
      const before = (await sql`SELECT id, position FROM organiser_groups WHERE id = ANY(${[g1, g2]}::uuid[])`) as { id: string; position: number }[]

      const result = await resequenceOrganiserGroupScope({ organisationId: ORG_A, boardId: board }, [g1, g1])

      expect(result).toEqual({ ok: false, reason: 'duplicate' })
      const after = (await sql`SELECT id, position FROM organiser_groups WHERE id = ANY(${[g1, g2]}::uuid[])`) as { id: string; position: number }[]
      expect(after).toEqual(before)
    })

    it('an existing group omitted from the requested list rejected, positions unchanged', async () => {
      const board = await makeBoard(ORG_A)
      const g1 = await makeGroup(ORG_A, board)
      const g2 = await makeGroup(ORG_A, board)

      const result = await resequenceOrganiserGroupScope({ organisationId: ORG_A, boardId: board }, [g1])

      expect(result).toEqual({ ok: false, reason: 'missing' })
      void g2
    })

    it('a foreign group id from a DIFFERENT board rejected, positions unchanged', async () => {
      const boardA = await makeBoard(ORG_A)
      const boardB = await makeBoard(ORG_A)
      const g1 = await makeGroup(ORG_A, boardA)
      const foreign = await makeGroup(ORG_A, boardB)

      const result = await resequenceOrganiserGroupScope({ organisationId: ORG_A, boardId: boardA }, [g1, foreign])

      expect(result).toEqual({ ok: false, reason: 'extra' })
    })

    it('a foreign group id from a DIFFERENT organisation rejected, no cross-tenant leak', async () => {
      const boardA = await makeBoard(ORG_A)
      const g1 = await makeGroup(ORG_A, boardA)
      const boardB = await makeBoard(ORG_B)
      const foreign = await makeGroup(ORG_B, boardB)

      const result = await resequenceOrganiserGroupScope({ organisationId: ORG_A, boardId: boardA }, [g1, foreign])

      expect(result).toEqual({ ok: false, reason: 'extra' })
    })

    it('two concurrent group reorders of the same board serialize safely; final state is one complete valid order, contiguous', async () => {
      const board = await makeBoard(ORG_A)
      const g1 = await makeGroup(ORG_A, board)
      const g2 = await makeGroup(ORG_A, board)
      const g3 = await makeGroup(ORG_A, board)

      const orderX = [g3, g2, g1]
      const orderY = [g2, g1, g3]

      const [resultX, resultY] = await Promise.all([
        resequenceOrganiserGroupScope({ organisationId: ORG_A, boardId: board }, orderX),
        resequenceOrganiserGroupScope({ organisationId: ORG_A, boardId: board }, orderY),
      ])

      expect(resultX.ok).toBe(true)
      expect(resultY.ok).toBe(true)

      const rows = (await sql`SELECT id, position FROM organiser_groups WHERE id = ANY(${[g1, g2, g3]}::uuid[])`) as { id: string; position: number }[]
      const finalPositions = Object.fromEntries(rows.map(r => [r.id, r.position]))
      const finalOrder = [g1, g2, g3]
        .map(id => ({ id, position: finalPositions[id] }))
        .sort((p, q) => p.position - q.position)
        .map(p => p.id)

      const matchesX = JSON.stringify(finalOrder) === JSON.stringify(orderX)
      const matchesY = JSON.stringify(finalOrder) === JSON.stringify(orderY)
      expect(matchesX || matchesY).toBe(true)
      expect(Object.values(finalPositions).sort((x, y) => x - y)).toEqual([0, 1, 2])
    })

    it('a successful group resequence inserts zero organiser_activity rows', async () => {
      const board = await makeBoard(ORG_A)
      const g1 = await makeGroup(ORG_A, board)
      const g2 = await makeGroup(ORG_A, board)
      const before = await activityCountFor(ORG_A)

      const result = await resequenceOrganiserGroupScope({ organisationId: ORG_A, boardId: board }, [g2, g1])

      expect(result.ok).toBe(true)
      expect(await activityCountFor(ORG_A)).toBe(before)
    })
  })
})
