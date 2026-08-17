import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Real-database integration test for the recurring-enrolment schema and
// propagation logic — the mocked tests in tennisRecurrence.test.ts prove the
// *application logic* branches correctly, but a mocked `sql()` cannot prove
// the unique index / ON CONFLICT / CHECK constraint actually behave as
// intended against real Postgres, which is exactly the class of gap that
// let the is_recurring and text/uuid production bugs through earlier in
// this project. This test creates an isolated, disposable schema (never
// touching the real `bookings`/`organisations`/etc. tables), applies
// scripts/add-recurring-pause-support.sql against it, exercises the schema
// directly, then drops the schema — leaving zero trace.
//
// Opt-in only: requires a real DATABASE_URL (not the tests/setupEnv.ts
// placeholder) and an explicit RUN_TENNIS_DB_INTEGRATION=1 flag, so it is a
// no-op in normal `npx vitest run` / `npm run build` / CI runs that don't
// have real database credentials available. Run manually with:
//   RUN_TENNIS_DB_INTEGRATION=1 npx vitest run tests/containment/tennisRecurrence.integration.test.ts
const shouldRun = process.env.RUN_TENNIS_DB_INTEGRATION === '1'

describe.skipIf(!shouldRun)('recurring enrolment schema — real database integration', () => {
  let sql: import('@neondatabase/serverless').NeonQueryFunction<false, false>
  const SCHEMA = `tennis_recurrence_test_${Date.now()}`

  beforeAll(async () => {
    const { neon } = await import('@neondatabase/serverless')
    sql = neon(process.env.DATABASE_URL!)

    await sql.query(`CREATE SCHEMA "${SCHEMA}"`)
    await sql.query(`CREATE TABLE "${SCHEMA}".organisations (id text PRIMARY KEY)`)
    await sql.query(`CREATE TABLE "${SCHEMA}".sessions (id text PRIMARY KEY, organisation_id text)`)
    await sql.query(`CREATE TABLE "${SCHEMA}".session_instances (id text PRIMARY KEY, session_id text, date date)`)
    await sql.query(`
      CREATE TABLE "${SCHEMA}".bookings (
        id text PRIMARY KEY, organisation_id text NOT NULL, session_id text, session_instance_id text,
        client_name text NOT NULL, client_email text, status text NOT NULL DEFAULT 'pending_confirmation',
        paid boolean NOT NULL DEFAULT false, attendance_status text, is_recurring boolean NOT NULL DEFAULT false
      )
    `)

    const fs = await import('fs')
    let migrationSql = fs.readFileSync('scripts/add-recurring-pause-support.sql', 'utf8')
    migrationSql = migrationSql
      .replace(/\bALTER TABLE bookings\b/g, `ALTER TABLE "${SCHEMA}".bookings`)
      .replace(/\bON bookings\b/g, `ON "${SCHEMA}".bookings`)
      .replace(/\bREFERENCES organisations\(/g, `REFERENCES "${SCHEMA}".organisations(`)
      .replace(/\bREFERENCES sessions\(/g, `REFERENCES "${SCHEMA}".sessions(`)
      .replace(/\bCREATE TABLE IF NOT EXISTS booking_recurrence_pauses\b/g, `CREATE TABLE IF NOT EXISTS "${SCHEMA}".booking_recurrence_pauses`)
      .replace(/\bON booking_recurrence_pauses\b/g, `ON "${SCHEMA}".booking_recurrence_pauses`)

    const statements = migrationSql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(Boolean)
    for (const stmt of statements) await sql.query(stmt)

    await sql.query(`INSERT INTO "${SCHEMA}".organisations (id) VALUES ('org-1')`)
    await sql.query(`INSERT INTO "${SCHEMA}".sessions (id, organisation_id) VALUES ('sess-1', 'org-1')`)
    await sql.query(`INSERT INTO "${SCHEMA}".session_instances (id, session_id, date) VALUES ('inst-1', 'sess-1', '2026-09-01')`)
  })

  afterAll(async () => {
    await sql.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  })

  it('migration applies cleanly and produces the expected columns/table', async () => {
    const cols = await sql.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'bookings' AND column_name = 'recurring_group_id'`,
      [SCHEMA],
    )
    expect(cols).toHaveLength(1)

    const pauseTable = await sql.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'booking_recurrence_pauses'`,
      [SCHEMA],
    )
    expect(pauseTable).toHaveLength(1)
  })

  it('the unique index prevents two bookings for the same (instance, recurring_group_id)', async () => {
    await sql.query(`INSERT INTO "${SCHEMA}".bookings (id, organisation_id, session_id, session_instance_id, client_name, status, recurring_group_id) VALUES ('dup-1', 'org-1', 'sess-1', 'inst-1', 'Player', 'confirmed', 'dup-group')`)
    let rejected = false
    try {
      await sql.query(`INSERT INTO "${SCHEMA}".bookings (id, organisation_id, session_id, session_instance_id, client_name, status, recurring_group_id) VALUES ('dup-2', 'org-1', 'sess-1', 'inst-1', 'Player', 'confirmed', 'dup-group')`)
    } catch (err) {
      rejected = (err as { code?: string }).code === '23505'
    }
    expect(rejected).toBe(true)
  })

  it('ON CONFLICT DO NOTHING (the exact pattern lib/tennisRecurrence.ts uses) silently no-ops instead of throwing', async () => {
    await sql.query(`INSERT INTO "${SCHEMA}".bookings (id, organisation_id, session_id, session_instance_id, client_name, status, recurring_group_id) VALUES ('conflict-1', 'org-1', 'sess-1', 'inst-1', 'Player', 'confirmed', 'conflict-group')`)
    const result = await sql.query(
      `INSERT INTO "${SCHEMA}".bookings (id, organisation_id, session_id, session_instance_id, client_name, status, recurring_group_id) VALUES ('conflict-2', 'org-1', 'sess-1', 'inst-1', 'Player', 'confirmed', 'conflict-group') ON CONFLICT (session_instance_id, recurring_group_id) WHERE status != 'cancelled' AND recurring_group_id IS NOT NULL DO NOTHING RETURNING id`,
    )
    expect(result).toHaveLength(0)
  })

  it('a cancelled booking does not block a new one for the same (instance, recurring_group_id) — the partial index excludes cancelled rows', async () => {
    await sql.query(`INSERT INTO "${SCHEMA}".bookings (id, organisation_id, session_id, session_instance_id, client_name, status, recurring_group_id) VALUES ('cancelled-1', 'org-1', 'sess-1', 'inst-1', 'Player', 'cancelled', 'resurrect-group')`)
    // Should succeed — the unique index only applies to status != 'cancelled'.
    await expect(
      sql.query(`INSERT INTO "${SCHEMA}".bookings (id, organisation_id, session_id, session_instance_id, client_name, status, recurring_group_id) VALUES ('cancelled-2', 'org-1', 'sess-1', 'inst-1', 'Player', 'confirmed', 'resurrect-group')`),
    ).resolves.toBeDefined()
  })

  it('the CHECK constraint rejects an inverted pause range', async () => {
    let rejected = false
    try {
      await sql.query(`INSERT INTO "${SCHEMA}".booking_recurrence_pauses (organisation_id, recurring_group_id, session_id, pause_from, pause_until) VALUES ('org-1', 'group-1', 'sess-1', '2026-10-11', '2026-09-28')`)
    } catch (err) {
      rejected = (err as { code?: string }).code === '23514'
    }
    expect(rejected).toBe(true)
  })

  it('a valid pause window inserts and is queryable by (organisation_id, recurring_group_id)', async () => {
    await sql.query(`INSERT INTO "${SCHEMA}".booking_recurrence_pauses (organisation_id, recurring_group_id, session_id, pause_from, pause_until, reason) VALUES ('org-1', 'query-group', 'sess-1', '2026-09-28', '2026-10-11', 'School holidays')`)
    const rows = await sql.query(
      `SELECT to_char(pause_from, 'YYYY-MM-DD') AS pause_from, to_char(pause_until, 'YYYY-MM-DD') AS pause_until FROM "${SCHEMA}".booking_recurrence_pauses WHERE organisation_id = $1 AND recurring_group_id = $2`,
      ['org-1', 'query-group'],
    )
    expect(rows).toEqual([{ pause_from: '2026-09-28', pause_until: '2026-10-11' }])
  })
})
