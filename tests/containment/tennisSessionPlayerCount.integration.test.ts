import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Proves the fixed session-level enrolled_count query against real
// Postgres COUNT(DISTINCT ...) semantics, using the exact mixed-roster
// scenario from the production bug report: capacity 8, six generated
// instances, Player A weekly (6 rows), Player B weekly (6 rows), Player C
// once (1 row) — 13 total booking rows, but 3 unique players. A mocked
// sql() can only prove the query text looks right (see the sibling
// non-integration test); it cannot prove COUNT(DISTINCT COALESCE(...))
// actually produces 3 here rather than 13, which is the entire point of
// the fix. Isolated, disposable schema — created and dropped in this
// script, never touches any real table. Opt-in only, same convention as
// tests/containment/tennisRecurrence.integration.test.ts:
//   RUN_TENNIS_DB_INTEGRATION=1 npx vitest run tests/containment/tennisSessionPlayerCount.integration.test.ts
const shouldRun = process.env.RUN_TENNIS_DB_INTEGRATION === '1'

describe.skipIf(!shouldRun)('session-level player count — real database integration', () => {
  let sql: import('@neondatabase/serverless').NeonQueryFunction<false, false>
  const SCHEMA = `tennis_playercount_test_${Date.now()}`

  beforeAll(async () => {
    const { neon } = await import('@neondatabase/serverless')
    sql = neon(process.env.DATABASE_URL!)

    await sql.query(`CREATE SCHEMA "${SCHEMA}"`)
    await sql.query(`
      CREATE TABLE "${SCHEMA}".bookings (
        id text PRIMARY KEY, organisation_id text NOT NULL, session_id text, session_instance_id text,
        client_name text NOT NULL, status text NOT NULL DEFAULT 'confirmed', recurring_group_id text
      )
    `)

    const instances = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6']
    let n = 0
    const insert = (session_instance_id: string, client_name: string, recurring_group_id: string | null) =>
      sql.query(
        `INSERT INTO "${SCHEMA}".bookings (id, organisation_id, session_id, session_instance_id, client_name, status, recurring_group_id) VALUES ($1, 'org-1', 'sess-1', $2, $3, 'confirmed', $4)`,
        [`b${++n}`, session_instance_id, client_name, recurring_group_id],
      )

    // Player A: weekly, propagated into all 6.
    for (const inst of instances) await insert(inst, 'Player A', 'group-a')
    // Player B: weekly, propagated into all 6.
    for (const inst of instances) await insert(inst, 'Player B', 'group-b')
    // Player C: once, only on the first date.
    await insert('i1', 'Player C', null)
  })

  afterAll(async () => {
    await sql.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  })

  it('13 total booking rows exist (sanity check on the seed data itself)', async () => {
    const rows = await sql.query(`SELECT COUNT(*)::int AS cnt FROM "${SCHEMA}".bookings WHERE session_id = 'sess-1' AND status != 'cancelled'`)
    expect(rows[0].cnt).toBe(13)
  })

  it('the fixed query returns 3 unique players, not 13 booking rows', async () => {
    const rows = await sql.query(
      `SELECT COUNT(DISTINCT COALESCE(recurring_group_id, id))::int AS cnt FROM "${SCHEMA}".bookings WHERE session_id = 'sess-1' AND status != 'cancelled'`,
    )
    expect(rows[0].cnt).toBe(3)
  })

  it('the old (buggy) query would have returned 13 — direct proof of the regression this fixes', async () => {
    const rows = await sql.query(`SELECT COUNT(*)::int AS cnt FROM "${SCHEMA}".bookings WHERE session_id = 'sess-1' AND status != 'cancelled'`)
    expect(rows[0].cnt).toBe(13)
    expect(rows[0].cnt).not.toBe(3)
  })

  it('each individual instance still shows correct per-date occupancy (normal dates 2, drop-in date 3)', async () => {
    const normalDate = await sql.query(`SELECT COUNT(*)::int AS cnt FROM "${SCHEMA}".bookings WHERE session_instance_id = 'i2' AND status != 'cancelled'`)
    expect(normalDate[0].cnt).toBe(2) // Player A + Player B only
    const dropInDate = await sql.query(`SELECT COUNT(*)::int AS cnt FROM "${SCHEMA}".bookings WHERE session_instance_id = 'i1' AND status != 'cancelled'`)
    expect(dropInDate[0].cnt).toBe(3) // Player A + Player B + Player C
  })
})
