import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'

// Phase D.4.6F — proves the same-organisation/same-board relationship
// invariant and multi-hop parent-cycle prevention added to
// PATCH /api/organiser/items/[itemId] actually hold against real
// PostgreSQL: real foreign keys, a real recursive CTE, real EXISTS
// subqueries, and real atomicity — none of which a mocked `sql` client
// (see tests/containment/organiserItemActivity.test.ts's own header) can
// prove by construction.
//
// Deliberately does NOT invoke the real Next.js route handler. The route
// (like every other item route in this file family) uses unqualified
// table names that resolve via the connection's default search_path, and
// neon's stateless HTTP client does not persist a session-scoped SET
// search_path across separate, individually-awaited calls — the exact
// same constraint tests/containment/tennisSessionArchiveAtomicity
// .integration.test.ts and tests/containment/crmMigrationSchema
// .integration.test.ts already document and work around. Following their
// established resolution: this file reproduces the route's validated-PATCH
// CTE query verbatim in STRUCTURE (same CTE names, same predicates, same
// cycle-detection algorithm) but schema-qualifies every table reference
// and uses positional ($1, $2, ...) parameters instead of the route's
// tagged-template style, so each test can run it as one independent,
// fully-qualified statement with no reliance on search_path persisting
// between calls. app/api/organiser/items/[itemId]/route.ts remains the
// only place the real, production query text lives — if that query's
// validation logic ever changes, QUERY (below) must be updated to match,
// and tests/containment/organiserItemActivity.test.ts's structural
// assertions on the real route file are what keep the two from silently
// drifting apart between real-Postgres proof and production source.
//
// Isolated, disposable schema. Opt-in only, gated by TWO independent,
// explicit environment variables (mirroring
// RUN_CRM_DB_INTEGRATION/CRM_DB_INTEGRATION_CONFIRM_NON_PRODUCTION) so
// that neither DATABASE_URL merely existing, nor one flag alone, can
// activate database-changing setup:
//   RUN_ORGANISER_DB_INTEGRATION=1 ORGANISER_DB_INTEGRATION_CONFIRM_NON_PRODUCTION=1 \
//     npx vitest run tests/containment/organiserItemRelationshipIntegrity.integration.test.ts
const RUN_FLAG = process.env.RUN_ORGANISER_DB_INTEGRATION === '1'
const NON_PRODUCTION_ACK = process.env.ORGANISER_DB_INTEGRATION_CONFIRM_NON_PRODUCTION === '1'
const shouldRun = RUN_FLAG && NON_PRODUCTION_ACK

// Unique per run: millisecond timestamp + 8 random hex bytes, built only
// from Date.now()/crypto.randomBytes — never from external/user input, so
// cleanup can never be redirected. [a-z0-9_] only, well under Postgres's
// 63-byte identifier limit.
const SCHEMA = `organiser_rel_test_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`
const T = (name: string) => `"${SCHEMA}".${name}`

// The validated-PATCH query, schema-qualified, positional-parameter form.
// Structurally identical to app/api/organiser/items/[itemId]/route.ts's
// own statement: same CTE names/order (old -> ancestors -> would_cycle ->
// validation -> updated), same predicates, same cycle-safe recursive CTE
// (UNION ALL + visited-array guard, never bare UNION — see that route's
// own comment for why bare UNION is not cycle-safe once a `visited` array
// is part of each row). Field list trimmed to what this suite actually
// exercises (group_id/parent_item_id/name) — the full field set
// (status/priority/owner/etc.) is proven separately by the mocked
// containment suite; this file exists only to prove the relationship
// invariant and atomicity against real Postgres.
function patchQuery() {
  return `
    WITH RECURSIVE old AS MATERIALIZED (
      SELECT id, board_id, group_id, parent_item_id, name
      FROM ${T('organiser_items')}
      WHERE id = $1 AND organisation_id = $2
      FOR UPDATE
    ),
    ancestors AS (
      SELECT id, parent_item_id, ARRAY[id] AS visited
      FROM ${T('organiser_items')}
      WHERE id = $3 AND organisation_id = $2
      UNION ALL
      SELECT gi.id, gi.parent_item_id, a.visited || gi.id
      FROM ${T('organiser_items')} gi
      JOIN ancestors a ON gi.id = a.parent_item_id
      WHERE gi.organisation_id = $2
        AND NOT gi.id = ANY(a.visited)
        AND array_length(a.visited, 1) < 500
    ),
    would_cycle AS (
      SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = $1) AS cycle
    ),
    validation AS (
      SELECT
        (
          NOT $4 OR $5::uuid IS NULL OR EXISTS (
            SELECT 1 FROM ${T('organiser_groups')} g
            WHERE g.id = $5::uuid AND g.organisation_id = $2 AND g.board_id = old.board_id
          )
        ) AS group_valid,
        (
          NOT $6 OR $3::uuid IS NULL OR (
            EXISTS (
              SELECT 1 FROM ${T('organiser_items')} p
              WHERE p.id = $3::uuid AND p.organisation_id = $2 AND p.board_id = old.board_id
            )
            AND $3::uuid IS DISTINCT FROM $1::uuid
            AND NOT (SELECT cycle FROM would_cycle)
          )
        ) AS parent_valid
      FROM old
    ),
    updated AS (
      UPDATE ${T('organiser_items')} i SET
        group_id       = CASE WHEN $4 THEN $5::uuid ELSE old.group_id END,
        parent_item_id = CASE WHEN $6 THEN $3::uuid ELSE old.parent_item_id END,
        name           = COALESCE($7, old.name),
        updated_at     = NOW()
      FROM old, validation
      WHERE i.id = old.id AND validation.group_valid AND validation.parent_valid
      RETURNING i.id, i.board_id, i.group_id, i.parent_item_id, i.name
    ),
    activity_row AS (
      INSERT INTO ${T('organiser_activity')} (
        organisation_id, board_id, item_id, actor_user_id, actor_name,
        event_type, entity_type, entity_id, before_json, after_json
      )
      SELECT
        $2, updated.board_id, updated.id, $8, 'Test Actor',
        CASE WHEN old.group_id IS DISTINCT FROM updated.group_id OR old.parent_item_id IS DISTINCT FROM updated.parent_item_id
          THEN 'item.moved' ELSE 'item.updated' END,
        'item', updated.id::text,
        jsonb_build_object('name', old.name), jsonb_build_object('name', updated.name)
      FROM old, updated
      WHERE old.name IS DISTINCT FROM updated.name
         OR old.group_id IS DISTINCT FROM updated.group_id
         OR old.parent_item_id IS DISTINCT FROM updated.parent_item_id
      RETURNING id
    )
    SELECT validation.group_valid, validation.parent_valid, updated.*
    FROM old
    JOIN validation ON true
    LEFT JOIN updated ON true
  `
}

type PatchArgs = {
  itemId: string
  organisationId: string
  groupId?: string | null
  parentItemId?: string | null
  name?: string | null
}

describe.skipIf(!shouldRun)('Organiser item relationship validation — real database integration', () => {
  let sql: import('@neondatabase/serverless').NeonQueryFunction<false, false>

  async function patch(args: PatchArgs) {
    const hasGroup = Object.prototype.hasOwnProperty.call(args, 'groupId')
    const hasParent = Object.prototype.hasOwnProperty.call(args, 'parentItemId')
    const rows = (await sql.query(patchQuery(), [
      args.itemId,
      args.organisationId,
      hasParent ? (args.parentItemId ?? null) : null,
      hasGroup,
      hasGroup ? (args.groupId ?? null) : null,
      hasParent,
      args.name ?? null,
      'actor-1',
    ])) as { group_valid: boolean; parent_valid: boolean; id: string | null; group_id: string | null; parent_item_id: string | null; name: string | null }[]
    return rows[0]
  }

  beforeAll(async () => {
    const { neon } = await import('@neondatabase/serverless')
    sql = neon(process.env.DATABASE_URL!)

    await sql.transaction([
      sql.query(`CREATE SCHEMA "${SCHEMA}"`),
      sql.query(`CREATE TABLE ${T('organisations')} (id TEXT PRIMARY KEY)`),
      sql.query(`CREATE TABLE ${T('users')} (id TEXT PRIMARY KEY)`),
      sql.query(`
        CREATE TABLE ${T('organiser_boards')} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organisation_id TEXT NOT NULL REFERENCES ${T('organisations')}(id),
          name TEXT NOT NULL
        )
      `),
      sql.query(`
        CREATE TABLE ${T('organiser_groups')} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          board_id UUID NOT NULL REFERENCES ${T('organiser_boards')}(id) ON DELETE CASCADE,
          organisation_id TEXT NOT NULL REFERENCES ${T('organisations')}(id),
          name TEXT NOT NULL
        )
      `),
      sql.query(`
        CREATE TABLE ${T('organiser_items')} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          board_id UUID NOT NULL REFERENCES ${T('organiser_boards')}(id) ON DELETE CASCADE,
          organisation_id TEXT NOT NULL REFERENCES ${T('organisations')}(id),
          group_id UUID REFERENCES ${T('organiser_groups')}(id) ON DELETE SET NULL,
          parent_item_id UUID REFERENCES ${T('organiser_items')}(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `),
      sql.query(`
        CREATE TABLE ${T('organiser_activity')} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organisation_id TEXT NOT NULL REFERENCES ${T('organisations')}(id),
          board_id UUID NOT NULL,
          item_id UUID,
          actor_user_id TEXT REFERENCES ${T('users')}(id) ON DELETE SET NULL,
          actor_name TEXT NOT NULL,
          event_type TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          before_json JSONB,
          after_json JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `),
    ])

    // Fixture topology:
    //   Org A / Board A1: groups gA1a, gA1b; items iA1_root -> iA1_mid -> iA1_leaf (a real chain), iA1_other
    //   Org A / Board A2: group gA2, item iA2
    //   Org B / Board B1: group gB1, item iB1
    await sql.transaction([
      sql.query(`INSERT INTO ${T('organisations')} (id) VALUES ($1), ($2)`, ['org-a', 'org-b']),
      sql.query(`INSERT INTO ${T('users')} (id) VALUES ($1)`, ['actor-1']),
      sql.query(`INSERT INTO ${T('organiser_boards')} (id, organisation_id, name) VALUES
        ('11111111-1111-1111-1111-111111111a1a', 'org-a', 'A1'),
        ('11111111-1111-1111-1111-111111111a2a', 'org-a', 'A2'),
        ('11111111-1111-1111-1111-111111111b1b', 'org-b', 'B1')`),
      sql.query(`INSERT INTO ${T('organiser_groups')} (id, board_id, organisation_id, name) VALUES
        ('22222222-2222-2222-2222-222222221a1a', '11111111-1111-1111-1111-111111111a1a', 'org-a', 'gA1a'),
        ('22222222-2222-2222-2222-222222221a1b', '11111111-1111-1111-1111-111111111a1a', 'org-a', 'gA1b'),
        ('22222222-2222-2222-2222-222222221a2a', '11111111-1111-1111-1111-111111111a2a', 'org-a', 'gA2'),
        ('22222222-2222-2222-2222-222222221b1b', '11111111-1111-1111-1111-111111111b1b', 'org-b', 'gB1')`),
      sql.query(`INSERT INTO ${T('organiser_items')} (id, board_id, organisation_id, group_id, name) VALUES
        ('33333333-3333-3333-3333-333333331a1r', '11111111-1111-1111-1111-111111111a1a', 'org-a', '22222222-2222-2222-2222-222222221a1a', 'iA1_root'),
        ('33333333-3333-3333-3333-333333331a1o', '11111111-1111-1111-1111-111111111a1a', 'org-a', '22222222-2222-2222-2222-222222221a1a', 'iA1_other'),
        ('33333333-3333-3333-3333-333333331a2a', '11111111-1111-1111-1111-111111111a2a', 'org-a', '22222222-2222-2222-2222-222222221a2a', 'iA2'),
        ('33333333-3333-3333-3333-333333331b1b', '11111111-1111-1111-1111-111111111b1b', 'org-b', '22222222-2222-2222-2222-222222221b1b', 'iB1')`),
    ])

    // iA1_mid -> parent iA1_root, iA1_leaf -> parent iA1_mid (a real 3-node chain: root <- mid <- leaf)
    await sql.query(
      `INSERT INTO ${T('organiser_items')} (id, board_id, organisation_id, group_id, parent_item_id, name) VALUES
        ('33333333-3333-3333-3333-333333331a1m', '11111111-1111-1111-1111-111111111a1a', 'org-a', '22222222-2222-2222-2222-222222221a1a', '33333333-3333-3333-3333-333333331a1r', 'iA1_mid'),
        ('33333333-3333-3333-3333-333333331a1l', '11111111-1111-1111-1111-111111111a1a', 'org-a', '22222222-2222-2222-2222-222222221a1a', '33333333-3333-3333-3333-333333331a1m', 'iA1_leaf')`,
    )
  })

  afterAll(async () => {
    // Targets only this run's own uniquely generated schema — never
    // "public", never any application table — safe even if beforeAll
    // failed partway and nothing was actually created.
    await sql.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  })

  const ORG_A = 'org-a'
  const BOARD_A1_GROUP_A = '22222222-2222-2222-2222-222222221a1a'
  const BOARD_A1_GROUP_B = '22222222-2222-2222-2222-222222221a1b'
  const BOARD_A2_GROUP = '22222222-2222-2222-2222-222222221a2a'
  const BOARD_B1_GROUP = '22222222-2222-2222-2222-222222221b1b'
  const A1_ROOT = '33333333-3333-3333-3333-333333331a1r'
  const A1_MID = '33333333-3333-3333-3333-333333331a1m'
  const A1_LEAF = '33333333-3333-3333-3333-333333331a1l'
  const A1_OTHER = '33333333-3333-3333-3333-333333331a1o'
  const A2_ITEM = '33333333-3333-3333-3333-333333331a2a'
  const B1_ITEM = '33333333-3333-3333-3333-333333331b1b'

  describe('tenant/board isolation for group_id', () => {
    it('rejects a group from a DIFFERENT board in the SAME organisation', async () => {
      const row = await patch({ itemId: A1_OTHER, organisationId: ORG_A, groupId: BOARD_A2_GROUP })
      expect(row.group_valid).toBe(false)
      expect(row.id).toBeNull()
    })

    it('rejects a group from a DIFFERENT organisation entirely', async () => {
      const row = await patch({ itemId: A1_OTHER, organisationId: ORG_A, groupId: BOARD_B1_GROUP })
      expect(row.group_valid).toBe(false)
      expect(row.id).toBeNull()
    })

    it('rejects a nonexistent group id', async () => {
      const row = await patch({ itemId: A1_OTHER, organisationId: ORG_A, groupId: '99999999-9999-9999-9999-999999999999' })
      expect(row.group_valid).toBe(false)
    })

    it('accepts a group in the SAME board and organisation', async () => {
      const row = await patch({ itemId: A1_OTHER, organisationId: ORG_A, groupId: BOARD_A1_GROUP_B })
      expect(row.group_valid).toBe(true)
      expect(row.group_id).toBe(BOARD_A1_GROUP_B)
      // Move it back so later tests see the original fixture state.
      await patch({ itemId: A1_OTHER, organisationId: ORG_A, groupId: BOARD_A1_GROUP_A })
    })

    it('accepts null (clearing the group)', async () => {
      const row = await patch({ itemId: A1_OTHER, organisationId: ORG_A, groupId: null })
      expect(row.group_valid).toBe(true)
      expect(row.group_id).toBeNull()
      await patch({ itemId: A1_OTHER, organisationId: ORG_A, groupId: BOARD_A1_GROUP_A })
    })
  })

  describe('tenant/board isolation for parent_item_id', () => {
    it('rejects a parent item from a DIFFERENT board in the SAME organisation', async () => {
      const row = await patch({ itemId: A1_OTHER, organisationId: ORG_A, parentItemId: A2_ITEM })
      expect(row.parent_valid).toBe(false)
    })

    it('rejects a parent item from a DIFFERENT organisation entirely', async () => {
      const row = await patch({ itemId: A1_OTHER, organisationId: ORG_A, parentItemId: B1_ITEM })
      expect(row.parent_valid).toBe(false)
    })

    it('rejects a nonexistent parent item id', async () => {
      const row = await patch({ itemId: A1_OTHER, organisationId: ORG_A, parentItemId: '99999999-9999-9999-9999-999999999999' })
      expect(row.parent_valid).toBe(false)
    })

    it('accepts a parent item in the SAME board and organisation (no cycle)', async () => {
      const row = await patch({ itemId: A1_OTHER, organisationId: ORG_A, parentItemId: A1_ROOT })
      expect(row.parent_valid).toBe(true)
      expect(row.parent_item_id).toBe(A1_ROOT)
      await patch({ itemId: A1_OTHER, organisationId: ORG_A, parentItemId: null })
    })

    it('accepts null (clearing the parent)', async () => {
      const row = await patch({ itemId: A1_LEAF, organisationId: ORG_A, parentItemId: null })
      expect(row.parent_valid).toBe(true)
      expect(row.parent_item_id).toBeNull()
      await patch({ itemId: A1_LEAF, organisationId: ORG_A, parentItemId: A1_MID })
    })
  })

  describe('multi-hop cycle prevention', () => {
    it('rejects direct self-parent', async () => {
      const row = await patch({ itemId: A1_ROOT, organisationId: ORG_A, parentItemId: A1_ROOT })
      expect(row.parent_valid).toBe(false)
    })

    it('rejects a 2-node cycle (root currently has no parent; making root the parent of its own parent-to-be creates one)', async () => {
      // A1_MID's parent is A1_ROOT. Attempting to set A1_ROOT's parent to
      // A1_MID would close a 2-node loop: root -> mid -> root.
      const row = await patch({ itemId: A1_ROOT, organisationId: ORG_A, parentItemId: A1_MID })
      expect(row.parent_valid).toBe(false)
    })

    it('rejects a 3-node cycle (root <- mid <- leaf; setting root\'s parent to leaf closes it)', async () => {
      const row = await patch({ itemId: A1_ROOT, organisationId: ORG_A, parentItemId: A1_LEAF })
      expect(row.parent_valid).toBe(false)
    })

    it('rejects a longer chain cycle (4 nodes: root <- mid <- leaf <- other; setting root\'s parent to other closes it)', async () => {
      // Extend the chain by one more hop: other -> leaf (temporarily), then
      // attempt root -> other, which would close root<-mid<-leaf<-other<-root.
      const extend = await patch({ itemId: A1_OTHER, organisationId: ORG_A, parentItemId: A1_LEAF })
      expect(extend.parent_valid).toBe(true)

      const row = await patch({ itemId: A1_ROOT, organisationId: ORG_A, parentItemId: A1_OTHER })
      expect(row.parent_valid).toBe(false)

      // Restore: detach A1_OTHER again so it doesn't affect other tests.
      await patch({ itemId: A1_OTHER, organisationId: ORG_A, parentItemId: null })
    })

    it('allows two independent items to share the same valid parent (not a cycle just because they converge)', async () => {
      const row1 = await patch({ itemId: A1_OTHER, organisationId: ORG_A, parentItemId: A1_LEAF })
      expect(row1.parent_valid).toBe(true)
      await patch({ itemId: A1_OTHER, organisationId: ORG_A, parentItemId: null })
    })
  })

  describe('atomicity — rejected relationship writes touch nothing', () => {
    it('a rejected group_id leaves the item completely unchanged and inserts zero activity rows', async () => {
      const before = await sql.query(`SELECT name, group_id FROM ${T('organiser_items')} WHERE id = $1`, [A1_OTHER])
      const activityCountBefore = await sql.query(`SELECT COUNT(*)::int AS n FROM ${T('organiser_activity')} WHERE item_id = $1`, [A1_OTHER])

      const row = await patch({ itemId: A1_OTHER, organisationId: ORG_A, groupId: BOARD_B1_GROUP, name: 'should-not-apply' })
      expect(row.group_valid).toBe(false)
      expect(row.id).toBeNull()

      const after = await sql.query(`SELECT name, group_id FROM ${T('organiser_items')} WHERE id = $1`, [A1_OTHER])
      expect(after).toEqual(before)

      const activityCountAfter = await sql.query(`SELECT COUNT(*)::int AS n FROM ${T('organiser_activity')} WHERE item_id = $1`, [A1_OTHER])
      expect((activityCountAfter as { n: number }[])[0].n).toBe((activityCountBefore as { n: number }[])[0].n)
    })

    it('a rejected parent_item_id (cycle) leaves the item completely unchanged and inserts zero activity rows', async () => {
      const activityCountBefore = await sql.query(`SELECT COUNT(*)::int AS n FROM ${T('organiser_activity')} WHERE item_id = $1`, [A1_ROOT])

      const row = await patch({ itemId: A1_ROOT, organisationId: ORG_A, parentItemId: A1_LEAF, name: 'should-not-apply-either' })
      expect(row.parent_valid).toBe(false)

      const afterName = await sql.query(`SELECT name FROM ${T('organiser_items')} WHERE id = $1`, [A1_ROOT])
      expect((afterName as { name: string }[])[0].name).toBe('iA1_root')

      const activityCountAfter = await sql.query(`SELECT COUNT(*)::int AS n FROM ${T('organiser_activity')} WHERE item_id = $1`, [A1_ROOT])
      expect((activityCountAfter as { n: number }[])[0].n).toBe((activityCountBefore as { n: number }[])[0].n)
    })

    it('a VALID write commits the mutation AND the activity row together (both present)', async () => {
      const row = await patch({ itemId: A1_OTHER, organisationId: ORG_A, groupId: BOARD_A1_GROUP_B })
      expect(row.group_valid).toBe(true)

      const item = await sql.query(`SELECT group_id FROM ${T('organiser_items')} WHERE id = $1`, [A1_OTHER])
      expect((item as { group_id: string }[])[0].group_id).toBe(BOARD_A1_GROUP_B)

      const activity = await sql.query(
        `SELECT event_type FROM ${T('organiser_activity')} WHERE item_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [A1_OTHER],
      )
      expect((activity as { event_type: string }[])[0].event_type).toBe('item.moved')

      await patch({ itemId: A1_OTHER, organisationId: ORG_A, groupId: BOARD_A1_GROUP_A })
    })
  })
})
