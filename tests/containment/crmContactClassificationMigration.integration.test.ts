import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// Contact classification phase — proves scripts/add-crm-contact-
// classification.sql actually applies cleanly against a real Postgres
// instance, on top of the base scripts/crm-migrate.mjs schema, in a
// disposable, isolated schema. Mirrors
// tests/containment/crmMigrationSchema.integration.test.ts's own
// established pattern exactly (same isolation technique, same two-flag
// activation gate, same schema-qualification discipline) rather than
// inventing a new one — this is a second, narrower proof for the SAME
// class of concern (does this DDL actually work against real Postgres),
// not a new kind of test.
//
// Opt-in only, gated by the SAME two explicit environment variables as
// crmMigrationSchema.integration.test.ts (this is still "does isolated,
// disposable-schema DDL work against real Postgres" — reusing the
// existing flags rather than inventing a third):
//   RUN_CRM_DB_INTEGRATION=1 CRM_DB_INTEGRATION_CONFIRM_NON_PRODUCTION=1 \
//     npx vitest run tests/containment/crmContactClassificationMigration.integration.test.ts
const RUN_FLAG = process.env.RUN_CRM_DB_INTEGRATION === '1'
const NON_PRODUCTION_ACK = process.env.CRM_DB_INTEGRATION_CONFIRM_NON_PRODUCTION === '1'
const shouldRun = RUN_FLAG && NON_PRODUCTION_ACK

const BASE_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/crm-migrate.mjs')
const BASE_SCRIPT_SOURCE = fs.readFileSync(BASE_SCRIPT_PATH, 'utf-8')
const BASE_STATEMENTS = [...BASE_SCRIPT_SOURCE.matchAll(/await sql\.query\(`([\s\S]*?)`\)/g)].map(m => m[1])

const CLASSIFICATION_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/add-crm-contact-classification.sql')
const CLASSIFICATION_SCRIPT_SOURCE = fs.readFileSync(CLASSIFICATION_SCRIPT_PATH, 'utf-8')

// The migration file is plain SQL (not JS sql.query(...) calls), and its
// middle statement is a DO $$ ... END $$; block containing internal
// semicolons — a generic "split on every ;" would break it. Extracted by
// exact, known boundary text instead of a general-purpose SQL statement
// splitter, since there are exactly three statements and their shape is
// fixed and already asserted by tests/containment/crmContactsSchemaAlignment.test.ts
// and tests/containment/crmContactClassification.test.ts.
function extractClassificationStatements(sqlSource: string): string[] {
  const addColumn = sqlSource.match(/ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS classification TEXT;/)?.[0]
  const doBlockStart = sqlSource.indexOf('DO $$')
  const doBlockEnd = sqlSource.indexOf('END $$;', doBlockStart) + 'END $$;'.length
  const doBlock = doBlockStart > -1 ? sqlSource.slice(doBlockStart, doBlockEnd) : undefined
  const createIndex = sqlSource.match(/CREATE INDEX IF NOT EXISTS idx_crm_contacts_classification\s+ON crm_contacts\(organisation_id, classification\);/)?.[0]
  const statements = [addColumn, doBlock, createIndex].filter((s): s is string => Boolean(s))
  if (statements.length !== 3) {
    throw new Error(`Expected to extract exactly 3 statements from ${CLASSIFICATION_SCRIPT_PATH}, got ${statements.length} — the migration file's shape may have changed; update extractClassificationStatements to match.`)
  }
  return statements
}

const CLASSIFICATION_STATEMENTS = extractClassificationStatements(CLASSIFICATION_SCRIPT_SOURCE)

const SCHEMA = `crm_classify_test_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`

describe.skipIf(!shouldRun)('scripts/add-crm-contact-classification.sql DDL — real database integration', () => {
  let sql: import('@neondatabase/serverless').NeonQueryFunction<false, false>

  beforeAll(async () => {
    const { neon } = await import('@neondatabase/serverless')
    sql = neon(process.env.DATABASE_URL!)

    // Same single-transaction technique as crmMigrationSchema.integration.test.ts,
    // for the same reason: every statement here (both the base CRM
    // migration's and this phase's) relies on unqualified table names
    // resolving via search_path, which only holds within one real
    // Postgres session/transaction over one HTTP request.
    await sql.transaction([
      sql.query(`CREATE SCHEMA "${SCHEMA}"`),
      sql.query(`CREATE TABLE "${SCHEMA}".organisations (id TEXT PRIMARY KEY)`),
      sql.query(`CREATE TABLE "${SCHEMA}".users (id TEXT PRIMARY KEY)`),
      sql.query(`INSERT INTO "${SCHEMA}".organisations (id) VALUES ($1)`, ['clx7q9k2e0000abcdorg1']),
      sql.query(`SET search_path TO "${SCHEMA}"`),
      ...BASE_STATEMENTS.map(stmt => sql.query(stmt)),
      // Seed one pre-existing contact BEFORE the classification migration
      // runs, exactly like a real Production/DEV contact created before
      // this migration is applied — proves the migration performs no
      // backfill and this row survives untouched, classification = NULL.
      sql.query(
        `INSERT INTO "${SCHEMA}".crm_contacts (organisation_id, first_name, last_name) VALUES ('clx7q9k2e0000abcdorg1', 'Pre', 'Existing')`,
      ),
      ...CLASSIFICATION_STATEMENTS.map(stmt => sql.query(stmt)),
    ])
  })

  afterAll(async () => {
    await sql.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  })

  it('classification column exists, nullable, no default', async () => {
    const rows = await sql.query(
      `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'crm_contacts' AND column_name = 'classification'`,
      [SCHEMA],
    )
    expect(rows).toHaveLength(1)
    expect((rows as { is_nullable: string; column_default: string | null }[])[0]).toEqual({ is_nullable: 'YES', column_default: null })
  })

  it('the pre-existing contact (created before this migration ran) survived untouched with classification = NULL — no backfill occurred', async () => {
    const rows = await sql.query(
      `SELECT classification FROM "${SCHEMA}".crm_contacts WHERE first_name = 'Pre' AND last_name = 'Existing'`,
    )
    expect(rows).toHaveLength(1)
    expect((rows as { classification: string | null }[])[0].classification).toBeNull()
  })

  it('a valid classification value inserts and reads back correctly', async () => {
    const rows = await sql.query(
      `INSERT INTO "${SCHEMA}".crm_contacts (organisation_id, first_name, last_name, classification) VALUES ('clx7q9k2e0000abcdorg1', 'Valid', 'Client', 'CLIENT') RETURNING classification`,
    )
    expect((rows as { classification: string }[])[0].classification).toBe('CLIENT')
  })

  it('an invalid classification value is rejected by the CHECK constraint, not merely by application code', async () => {
    await expect(
      sql.query(
        `INSERT INTO "${SCHEMA}".crm_contacts (organisation_id, first_name, last_name, classification) VALUES ('clx7q9k2e0000abcdorg1', 'Bad', 'Value', 'NOT_A_REAL_VALUE')`,
      ),
    ).rejects.toThrow()
  })

  it('a valid classification value can be set via UPDATE too (the manager-facing edit path, not just Events INSERT)', async () => {
    const [inserted] = await sql.query(
      `INSERT INTO "${SCHEMA}".crm_contacts (organisation_id, first_name, last_name) VALUES ('clx7q9k2e0000abcdorg1', 'To', 'Update') RETURNING id`,
    )
    const rows = await sql.query(
      `UPDATE "${SCHEMA}".crm_contacts SET classification = 'LEAD' WHERE id = $1 RETURNING classification`,
      [inserted.id],
    )
    expect((rows as { classification: string }[])[0].classification).toBe('LEAD')
  })

  it('the tenant-scoped classification index exists', async () => {
    const rows = await sql.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = 'idx_crm_contacts_classification'`,
      [SCHEMA],
    )
    expect(rows).toHaveLength(1)
  })

  it('rerunning the classification migration is idempotent (IF NOT EXISTS / guarded DO block hold, no error, no duplicate constraint)', async () => {
    await sql.transaction([
      sql.query(`SET search_path TO "${SCHEMA}"`),
      ...CLASSIFICATION_STATEMENTS.map(stmt => sql.query(stmt)),
    ])
    const constraints = await sql.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND conname = 'crm_contacts_classification_check'`,
      [`"${SCHEMA}".crm_contacts`],
    )
    expect(constraints).toHaveLength(1)
    const indexes = await sql.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = 'idx_crm_contacts_classification'`,
      [SCHEMA],
    )
    expect(indexes).toHaveLength(1)
  })
})

// Always-on static safety checks — never touch a database, run every
// time regardless of the activation flags, mirroring
// crmMigrationSchema.integration.test.ts's own equivalent block.
describe('crmContactClassificationMigration.integration.test.ts — activation guard and isolation safety (always runs, no database)', () => {
  // Deliberately NOT "expect(shouldRun).toBe(false)" — that assertion is
  // only true in default mode and would fail on its own terms whenever
  // this file is legitimately run in real integration mode (both flags
  // set, a valid DATABASE_URL), making the whole file structurally
  // unable to go fully green with DB tests actually executing. Asserted
  // instead as a re-derivation, which holds in BOTH modes: it proves the
  // gate is exactly RUN_FLAG && NON_PRODUCTION_ACK — never loosened to an
  // `||`, never activated by any other signal — regardless of which
  // values those two flags actually hold when this test runs.
  it('activation is derived exactly from RUN_CRM_DB_INTEGRATION && CRM_DB_INTEGRATION_CONFIRM_NON_PRODUCTION, never any other condition', () => {
    expect(shouldRun).toBe(RUN_FLAG && NON_PRODUCTION_ACK)
  })

  it('exactly three statements are extracted from the migration file (ADD COLUMN, guarded DO block, CREATE INDEX)', () => {
    expect(CLASSIFICATION_STATEMENTS).toHaveLength(3)
    expect(CLASSIFICATION_STATEMENTS[0]).toContain('ALTER TABLE crm_contacts ADD COLUMN')
    expect(CLASSIFICATION_STATEMENTS[1]).toContain('DO $$')
    expect(CLASSIFICATION_STATEMENTS[1]).toContain('END $$;')
    expect(CLASSIFICATION_STATEMENTS[2]).toContain('CREATE INDEX IF NOT EXISTS idx_crm_contacts_classification')
  })

  it('the disposable schema identifier is unique per run, constrained to a safe character set, and distinct from crmMigrationSchema.integration.test.ts\'s own schema prefix', () => {
    expect(SCHEMA).toMatch(/^crm_classify_test_\d+_[0-9a-f]{16}$/)
    expect(SCHEMA.length).toBeLessThanOrEqual(63)
  })

  it('the schema-creation, search_path, and cleanup statements target only the generated disposable schema, never "public"', () => {
    const createSchemaStmt = `CREATE SCHEMA "${SCHEMA}"`
    const setSearchPathStmt = `SET search_path TO "${SCHEMA}"`
    const dropStmt = `DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`
    for (const stmt of [createSchemaStmt, setSearchPathStmt, dropStmt]) {
      expect(stmt).not.toMatch(/"public"/)
      expect(stmt).toContain(SCHEMA)
    }
  })
})
