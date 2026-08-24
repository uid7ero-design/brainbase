import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'

// Modular Platform Foundation Phase F.7A — proves the repaired
// scripts/crm-migrate.mjs DDL actually succeeds against a real Postgres
// instance with representative TEXT (cuid-style) organisations/users
// parent tables, the same shape as this platform's real schema. The
// sibling non-integration test (crmMigrationSchema.test.ts) can only
// prove the SQL text looks right; it cannot prove PostgreSQL will
// actually accept a foreign key from a UUID column to a TEXT column
// (it won't) or from a TEXT column to a TEXT column (it will) — that is
// exactly the defect this phase repairs, so this is the test that
// matters most. Isolated, disposable schema — created and dropped in
// this script, never touches any real table. Opt-in only, same
// convention as tests/containment/tennisSessionPlayerCount.integration.test.ts:
//   RUN_CRM_DB_INTEGRATION=1 npx vitest run tests/containment/crmMigrationSchema.integration.test.ts
const shouldRun = process.env.RUN_CRM_DB_INTEGRATION === '1'

const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/crm-migrate.mjs')
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf-8')
const STATEMENTS = [...SCRIPT_SOURCE.matchAll(/await sql\.query\(`([\s\S]*?)`\)/g)].map(m => m[1])

describe.skipIf(!shouldRun)('scripts/crm-migrate.mjs DDL — real database integration', () => {
  let sql: import('@neondatabase/serverless').NeonQueryFunction<false, false>
  const SCHEMA = `crm_migrate_test_${Date.now()}`

  beforeAll(async () => {
    const { neon } = await import('@neondatabase/serverless')
    sql = neon(process.env.DATABASE_URL!)

    await sql.query(`CREATE SCHEMA "${SCHEMA}"`)
    await sql.query(`SET search_path TO "${SCHEMA}"`)

    // Representative parent tables, matching the real platform contract
    // (organisations.id / users.id are TEXT cuid-style ids, not UUID —
    // see prisma/schema.prisma). Deliberately seeded with non-UUID-
    // shaped opaque TEXT ids to prove the fix isn't merely tolerant of
    // UUID-shaped strings stored as TEXT.
    await sql.query(`CREATE TABLE organisations (id TEXT PRIMARY KEY)`)
    await sql.query(`CREATE TABLE users (id TEXT PRIMARY KEY)`)
    await sql.query(`INSERT INTO organisations (id) VALUES ('clx7q9k2e0000abcdorg1')`)
    await sql.query(`INSERT INTO users (id) VALUES ('clx7q9k2e0001abcduser1')`)

    // Execute every statement from the real, repaired migration source
    // in order (4 CREATE TABLEs, then 8 CREATE INDEXes), unmodified,
    // against this disposable schema via search_path.
    for (const stmt of STATEMENTS) {
      await sql.query(stmt)
    }
  })

  afterAll(async () => {
    await sql.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  })

  it('all four CRM tables were created (the migration did not throw)', async () => {
    const rows = await sql.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'crm_%' ORDER BY table_name`,
      [SCHEMA],
    )
    expect((rows as { table_name: string }[]).map(r => r.table_name)).toEqual([
      'crm_activities',
      'crm_companies',
      'crm_contacts',
      'crm_deals',
    ])
  })

  it('crm_companies.organisation_id is TEXT and accepts a real opaque cuid-style organisation id via its FK', async () => {
    const rows = await sql.query(
      `INSERT INTO crm_companies (organisation_id, name) VALUES ('clx7q9k2e0000abcdorg1', 'Acme') RETURNING id, organisation_id`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].organisation_id).toBe('clx7q9k2e0000abcdorg1')
  })

  it('crm_companies.organisation_id FK rejects an organisation id that does not exist (constraint is real, not decorative)', async () => {
    await expect(
      sql.query(`INSERT INTO crm_companies (organisation_id, name) VALUES ('does-not-exist', 'Bogus')`),
    ).rejects.toThrow()
  })

  it('crm_companies.created_by accepts a real opaque TEXT user id via its FK', async () => {
    const rows = await sql.query(
      `INSERT INTO crm_companies (organisation_id, name, created_by) VALUES ('clx7q9k2e0000abcdorg1', 'Beta', 'clx7q9k2e0001abcduser1') RETURNING created_by`,
    )
    expect(rows[0].created_by).toBe('clx7q9k2e0001abcduser1')
  })

  it('crm_deals.assigned_to accepts a real opaque TEXT user id via its FK', async () => {
    const rows = await sql.query(
      `INSERT INTO crm_deals (organisation_id, title, assigned_to) VALUES ('clx7q9k2e0000abcdorg1', 'Deal 1', 'clx7q9k2e0001abcduser1') RETURNING assigned_to`,
    )
    expect(rows[0].assigned_to).toBe('clx7q9k2e0001abcduser1')
  })

  it('CRM-internal UUID relationships still work (crm_contacts.company_id -> crm_companies.id)', async () => {
    const [company] = await sql.query(
      `INSERT INTO crm_companies (organisation_id, name) VALUES ('clx7q9k2e0000abcdorg1', 'Gamma') RETURNING id`,
    )
    const [contact] = await sql.query(
      `INSERT INTO crm_contacts (organisation_id, company_id, first_name, last_name) VALUES ('clx7q9k2e0000abcdorg1', $1, 'Jane', 'Doe') RETURNING company_id`,
      [company.id],
    )
    expect(contact.company_id).toBe(company.id)
  })

  it('all 8 expected indexes exist', async () => {
    const rows = await sql.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname LIKE 'idx_crm_%' ORDER BY indexname`,
      [SCHEMA],
    )
    expect((rows as { indexname: string }[]).map(r => r.indexname)).toEqual([
      'idx_crm_activities_con',
      'idx_crm_activities_deal',
      'idx_crm_activities_org',
      'idx_crm_companies_org',
      'idx_crm_contacts_co',
      'idx_crm_contacts_org',
      'idx_crm_deals_org',
      'idx_crm_deals_stage',
    ])
  })

  it('rerunning the full migration script is idempotent (IF NOT EXISTS holds)', async () => {
    for (const stmt of STATEMENTS) {
      await sql.query(stmt)
    }
    const rows = await sql.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'crm_%'`,
      [SCHEMA],
    )
    expect(rows).toHaveLength(4)
  })
})
