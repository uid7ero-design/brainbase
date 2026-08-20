import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Proves the exact mechanism archiveSessionAtomically() relies on:
// neon's sql.transaction() genuinely rolls back the WHOLE batch —
// including otherwise-valid earlier statements — when any one statement
// in it fails. A mocked sql client can only prove archiveSessionAtomically
// propagates a rejected transaction() call (see the sibling non-
// integration test); it cannot prove the underlying transaction()
// primitive itself is really atomic at the database level, which is the
// entire premise this round's hardening depends on.
//
// Deliberately does not import/exercise lib/tennisSchedule.ts's real
// functions against a live schema: those hardcode unqualified table
// names (sessions, bookings, ...) that resolve via the connection's
// default search_path, and neon's stateless HTTP client does not persist
// a session-scoped SET search_path across separate calls — safely
// redirecting the app's own hardcoded queries at a disposable schema
// would require search_path tricks with real risk of touching
// Production's real `sessions`/`bookings` tables if done incorrectly.
// Instead this proves the transaction() primitive itself, generically,
// against its own fully isolated throwaway schema/tables — never any
// real table, created and dropped entirely within this test.
//
// Isolated, disposable schema. Opt-in only, same convention as
// tests/containment/tennisSessionPlayerCount.integration.test.ts:
//   RUN_TENNIS_DB_INTEGRATION=1 npx vitest run tests/containment/tennisSessionArchiveAtomicity.integration.test.ts
const shouldRun = process.env.RUN_TENNIS_DB_INTEGRATION === '1'

describe.skipIf(!shouldRun)('sql.transaction() atomicity — real database integration', () => {
  let sql: import('@neondatabase/serverless').NeonQueryFunction<false, false>
  const SCHEMA = `tennis_txn_atomicity_test_${Date.now()}`

  beforeAll(async () => {
    const { neon } = await import('@neondatabase/serverless')
    sql = neon(process.env.DATABASE_URL!)

    await sql.query(`CREATE SCHEMA "${SCHEMA}"`)
    await sql.query(`CREATE TABLE "${SCHEMA}".widget (id text PRIMARY KEY, status text NOT NULL)`)
    await sql.query(`INSERT INTO "${SCHEMA}".widget (id, status) VALUES ('w1', 'active')`)
  })

  afterAll(async () => {
    await sql.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  })

  it('a fully successful transaction commits every statement in the batch together', async () => {
    await sql.transaction(txn => [
      txn.query(`UPDATE "${SCHEMA}".widget SET status = $1 WHERE id = $2`, ['archived', 'w1']),
      txn.query(`INSERT INTO "${SCHEMA}".widget (id, status) VALUES ($1, $2)`, ['w2', 'active']),
    ])
    const rows = await sql.query(`SELECT id, status FROM "${SCHEMA}".widget ORDER BY id`) as unknown as { id: string; status: string }[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ id: 'w1', status: 'archived' })
    expect(rows[1]).toEqual({ id: 'w2', status: 'active' })
  })

  it('a failing statement anywhere in the batch rejects the whole transaction() call', async () => {
    await expect(
      sql.transaction(txn => [
        txn.query(`UPDATE "${SCHEMA}".widget SET status = $1 WHERE id = $2`, ['should-not-stick', 'w2']),
        // Duplicate primary key — w2 already exists from the previous test.
        txn.query(`INSERT INTO "${SCHEMA}".widget (id, status) VALUES ($1, $2)`, ['w2', 'duplicate-pk-will-fail']),
      ]),
    ).rejects.toThrow()
  })

  it('the whole failed batch rolled back — including the otherwise-valid first statement, not just the one that actually failed', async () => {
    const rows = await sql.query(`SELECT status FROM "${SCHEMA}".widget WHERE id = $1`, ['w2']) as unknown as { status: string }[]
    // Still "active" from the first test, NOT "should-not-stick" — proving
    // this isn't "each statement commits independently, then the last one
    // happens to fail" but genuine all-or-nothing rollback.
    expect(rows[0].status).toBe('active')
  })
})
