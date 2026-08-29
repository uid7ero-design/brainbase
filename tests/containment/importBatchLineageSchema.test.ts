import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Data Hub 5A.2C — canonical ingestion lineage schema contract.
//
// IMPORTANT — what this file proves vs. what it does NOT prove:
// These are static source-text assertions against the Prisma schema and
// the migration file. They lock in the intended shape so a future edit
// can't silently drift from what was reviewed — they do NOT prove the
// migration's runtime behavior against a real PostgreSQL catalog.
//
// The migration's actual behavior (constraint enforcement, drift
// rejection, idempotent re-run) is proven separately, repeatably, by
// scripts/tests/verify-import-batches-migration.sh against disposable
// Docker postgres:16 containers — 11 normal-path scenarios and 15
// adversarial drift scenarios (see that file's own scenario list). Run
// it with `bash scripts/tests/verify-import-batches-migration.sh`.
//
// This file exists in its current (5A.2C-R3) form because two prior
// review rounds (5A.2C-R1, then Codex's R2 pass) each found a real
// PostgreSQL regression that the *previous* version of this static
// suite did not catch:
//   - R1's assert_*() helpers returned a boolean that a bare `PERFORM`
//     caller silently discarded — a fully-absent required CHECK/FK on a
//     pre-existing table caused no error and no creation.
//   - R2 additionally found the composite FK's match type was never
//     validated, so changing it to MATCH FULL (semantically incompatible
//     with legacy rows that have exactly one NULL FK column) passed.
// R3 replaced the two-branch assert_*/PERFORM design with a single set
// of void-returning pg_temp.ensure_*() helpers that create-if-absent or
// validate-and-RAISE-if-present, with no discardable boolean and no
// separate "new table" vs "pre-existing table" code path. The tests
// below protect that redesign specifically, in addition to the original
// shape assertions.

const SCHEMA = fs.readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf-8')
const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../../scripts/create-import-batches.sql'), 'utf-8')
const HARNESS_PATH = path.resolve(__dirname, '../../scripts/tests/verify-import-batches-migration.sh')

const ENSURE_HELPERS = [
  'ensure_column',
  'ensure_check',
  'ensure_unique_constraint',
  'ensure_primary_key',
  'ensure_fk',
  'ensure_unique_index',
]

function blockScope(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf(endMarker, start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function helperBody(helper: string): string {
  return blockScope(MIGRATION, `CREATE OR REPLACE FUNCTION pg_temp.${helper}(`, '$fn$;')
}

describe('ImportBatch — Prisma model shape', () => {
  const block = blockScope(SCHEMA, 'model ImportBatch {', '@@map("import_batches")')

  it('exists with the expected minimum fields', () => {
    for (const field of [
      'organisation_id', 'uploaded_by', 'original_filename', 'content_type',
      'size_bytes', 'sha256', 'storage_provider', 'storage_key', 'storage_etag',
      'status', 'idempotency_key', 'expected_sha256', 'created_at', 'updated_at',
      'deleted_at', 'storage_deletion_status', 'storage_deleted_at',
    ]) {
      expect(block).toContain(field)
    }
  })

  it('does NOT persist a Blob URL/downloadUrl — storage_key is the sole authoritative locator', () => {
    expect(block.toLowerCase()).not.toMatch(/blob[_a-z]*url/)
    expect(block.toLowerCase()).not.toContain('downloadurl')
    expect(block).not.toContain('download_url')
  })

  it('sha256 is NOT globally unique — only storage_key and the tenant-scoped idempotency pair are', () => {
    expect(block).not.toMatch(/@@unique\(\[sha256\]\)/)
    expect(block).not.toMatch(/sha256\s+String\??\s+@unique/)
  })

  it('sha256 is nullable — the authoritative hash is not known at batch creation under the direct-to-Blob protocol', () => {
    const sha256Line = block.split('\n').find(l => /^\s*sha256\s/.test(l))
    expect(sha256Line).toBeDefined()
    expect(sha256Line).toMatch(/sha256\s+String\?/)
  })

  it('storage_key is unique (immutable, server-generated locator)', () => {
    expect(block).toMatch(/storage_key\s+String\s+@unique/)
  })

  it('has the composite (id, organisation_id) uniqueness required by canonical Upload\'s composite tenant FK', () => {
    expect(block).toContain('@@unique([id, organisation_id])')
  })

  it('has tenant-scoped idempotency uniqueness, not a bare unique on the key alone', () => {
    expect(block).toContain('@@unique([organisation_id, idempotency_key])')
    expect(block).not.toMatch(/idempotency_key\s+String\?\s+@unique/)
  })

  it('organisation relation has no onDelete override on the Prisma side (Postgres default NO ACTION) — deliberately not Cascade', () => {
    const orgRelationLine = block.split('\n').find(l => /organisation\s+Organisation\s+@relation/.test(l))
    expect(orgRelationLine).toBeDefined()
    expect(orgRelationLine).not.toContain('onDelete')
  })

  it('uploader relation is nullable with onDelete: SetNull', () => {
    expect(block).toMatch(/uploader\s+User\?\s+@relation\(fields: \[uploaded_by\], references: \[id\], onDelete: SetNull\)/)
  })
})

describe('Upload — additive canonical worksheet-lineage fields', () => {
  const block = blockScope(SCHEMA, 'model Upload {', '@@map("uploads")')

  it('adds all 12 canonical fields', () => {
    for (const field of [
      'import_batch_id', 'worksheet_index', 'worksheet_name', 'worksheet_visibility',
      'worksheet_is_empty', 'lineage_kind', 'canonical_status', 'last_attempt_at',
      'attempt_count', 'last_failure_code', 'last_failure_message', 'last_failure_retryable',
    ]) {
      expect(block).toContain(field)
    }
  })

  it('every canonical field except lineage_kind/attempt_count is nullable — zero backfill required for legacy rows', () => {
    const nullableFields = [
      'import_batch_id', 'worksheet_index', 'worksheet_name', 'worksheet_visibility',
      'worksheet_is_empty', 'canonical_status', 'last_attempt_at',
      'last_failure_code', 'last_failure_message', 'last_failure_retryable',
    ]
    for (const field of nullableFields) {
      const line = block.split('\n').find(l => new RegExp(`^\\s*${field}\\s`).test(l))
      expect(line, `${field} should be declared on Upload`).toBeDefined()
      expect(line).toMatch(/\?/)
    }
  })

  it('lineage_kind is NOT NULL with a safe default — never ambiguous', () => {
    expect(block).toMatch(/lineage_kind\s+String\s+@default\("LEGACY"\)/)
  })

  it('attempt_count is NOT NULL with a safe default', () => {
    expect(block).toMatch(/attempt_count\s+Int\s+@default\(0\)/)
  })

  it('the seven existing legacy domain relations remain intact, untouched', () => {
    for (const relation of [
      'debtor_accounts    DebtorAccount[]',
      'evidence_records   EvidenceRecord[]',
      'hlna_insights      HlnaInsight[]',
      'illegal_dumping    IllegalDumping[]',
      'metrics            Metric[]',
      'missed_collections MissedCollection[]',
      'service_requests   ServiceRequest[]',
    ]) {
      expect(block).toContain(relation)
    }
  })

  it('has the composite tenant FK to ImportBatch, referencing the (id, organisation_id) pair', () => {
    expect(block).toMatch(
      /import_batch\s+ImportBatch\?\s+@relation\(fields: \[import_batch_id, organisation_id\], references: \[id, organisation_id\]\)/
    )
  })

  it('has worksheet-identity uniqueness on (import_batch_id, worksheet_index)', () => {
    expect(block).toContain('@@unique([import_batch_id, worksheet_index])')
  })
})

describe('scripts/create-import-batches.sql — ensure_* drift-safety design (5A.2C-R3)', () => {
  it('defines all six ensure_* helpers, void-returning, and no assert_*/boolean-returning helper remains', () => {
    for (const helper of ENSURE_HELPERS) {
      expect(MIGRATION).toContain(`CREATE OR REPLACE FUNCTION pg_temp.${helper}(`)
      expect(helperBody(helper)).toMatch(/RETURNS void LANGUAGE plpgsql/)
    }
    // R1's discardable-boolean design must be fully gone, not merely
    // renamed — a reintroduced assert_* helper or a PERFORM of one would
    // resurrect the exact silent-absence bug this redesign fixed.
    expect(MIGRATION).not.toMatch(/CREATE (OR REPLACE )?FUNCTION pg_temp\.assert_/)
    expect(MIGRATION).not.toMatch(/\bPERFORM\s+(pg_temp\.)?assert_/i)
    expect(MIGRATION).not.toMatch(/RETURNS\s+boolean/i)
  })

  it('every ensure_* call site is a SELECT statement, not a PERFORM — leaves no discardable result a caller could ignore', () => {
    const callLines = MIGRATION
      .split('\n')
      .filter(l => /pg_temp\.ensure_(column|check|unique_constraint|primary_key|fk|unique_index)\(/.test(l))
      .filter(l => !l.trim().startsWith('CREATE') && !l.trim().startsWith('DROP'))
    expect(callLines.length).toBeGreaterThanOrEqual(30)
    for (const line of callLines) {
      expect(line.trim()).toMatch(/^SELECT pg_temp\.ensure_/)
    }
    expect(MIGRATION).not.toMatch(/\bPERFORM\s+pg_temp\.ensure_/)
  })

  it('does not branch into a separate "new table" vs "pre-existing table" code path — a single ensure_* sequence runs unconditionally either way', () => {
    expect(MIGRATION).not.toMatch(/IF\s+to_regclass\('public\.import_batches'\)\s+IS NULL THEN/)
    expect(MIGRATION).not.toMatch(/\bELSE\b[\s\S]*assert_column/)
  })

  it('ensure_fk validates confmatchtype and rejects anything but MATCH SIMPLE (\'s\') — MATCH FULL would reject legacy rows with exactly one NULL FK column', () => {
    const body = helperBody('ensure_fk')
    expect(body).toContain('confmatchtype')
    expect(body).toMatch(/confmatchtype\s+IS DISTINCT FROM\s+'s'/)
    expect(body).toMatch(/RAISE EXCEPTION/)
  })

  it('ensure_fk rejects a NOT VALID foreign key (convalidated = false) — structurally identical to a real one but never confirmed against pre-existing rows', () => {
    const body = helperBody('ensure_fk')
    expect(body).toContain('convalidated')
    expect(body).toMatch(/IF NOT r\.convalidated THEN\s*\n\s*RAISE EXCEPTION/)
  })

  it('ensure_primary_key validates structurally via pg_constraint/pg_attribute, not by constraint name', () => {
    const body = helperBody('ensure_primary_key')
    expect(body).toContain("contype = 'p'")
    expect(body).toContain('conkey')
    expect(body).toContain('pg_attribute')
    expect(body).toMatch(/RAISE EXCEPTION/)
  })

  it('import_batches PRIMARY KEY on (id) is established/validated via ensure_primary_key', () => {
    expect(MIGRATION).toMatch(/SELECT pg_temp\.ensure_primary_key\('import_batches',\s*ARRAY\['id'\],/)
  })

  it('validates the required defaults: status, lineage_kind, attempt_count, created_at, updated_at', () => {
    // Exact per-column default-contract coverage (including the
    // p_check_default flag) is asserted exhaustively by the dedicated
    // "explicit default contracts (5A.2C-R4)" describe block below —
    // this test just locks in that these five specific defaults remain
    // wired through ensure_column's current signature.
    expect(MIGRATION).toContain(
      "ensure_column('import_batches', 'status', 'text', false, true, '''AWAITING_UPLOAD''::text',"
    )
    expect(MIGRATION).toContain(
      "ensure_column('uploads', 'lineage_kind', 'text', false, true, '''LEGACY''::text',"
    )
    expect(MIGRATION).toContain(
      "ensure_column('uploads', 'attempt_count', 'integer', false, true, '0',"
    )
    expect(MIGRATION).toContain(
      "ensure_column('import_batches', 'created_at', 'timestamp with time zone', false, true, 'now()',"
    )
    expect(MIGRATION).toContain(
      "ensure_column('import_batches', 'updated_at', 'timestamp with time zone', false, true, 'now()',"
    )
  })

  it('exhaustively covers every ImportBatch column from the current Prisma model via ensure_column — not a stale hardcoded subset', () => {
    const block = blockScope(SCHEMA, 'model ImportBatch {', '@@map("import_batches")')
    const columns = block
      .split('\n')
      .map(l => l.trim())
      .filter(l => /^[a-z_][a-zA-Z0-9_]*\s+(String|Int|Boolean|DateTime)\??\s/.test(l) || /^[a-z_][a-zA-Z0-9_]*\s+(String|Int|Boolean|DateTime)\??$/.test(l))
      .map(l => l.split(/\s+/)[0])
    // Sanity floor: guards against the regex above silently matching
    // nothing (which would make the loop below vacuously pass).
    expect(columns.length).toBeGreaterThanOrEqual(17)
    for (const column of columns) {
      expect(MIGRATION, `ensure_column(...) call missing for import_batches.${column}`).toContain(
        `ensure_column('import_batches', '${column}'`
      )
    }
  })

  it('exhaustively covers all 12 additive Upload columns via ensure_column', () => {
    const additiveColumns = [
      'import_batch_id', 'worksheet_index', 'worksheet_name', 'worksheet_visibility',
      'worksheet_is_empty', 'lineage_kind', 'canonical_status', 'last_attempt_at',
      'attempt_count', 'last_failure_code', 'last_failure_message', 'last_failure_retryable',
    ]
    for (const column of additiveColumns) {
      expect(MIGRATION, `ensure_column(...) call missing for uploads.${column}`).toContain(
        `ensure_column('uploads', '${column}'`
      )
    }
  })

  it('establishes/validates every required import_batches and uploads CHECK constraint via ensure_check', () => {
    for (const conname of [
      'import_batches_content_type_check',
      'import_batches_size_bytes_check',
      'import_batches_sha256_check',
      'import_batches_status_check',
      'import_batches_expected_sha256_check',
      'import_batches_storage_deletion_status_check',
      'import_batches_ready_requires_sha256',
    ]) {
      expect(MIGRATION).toContain(`ensure_check('import_batches', '${conname}'`)
    }
    for (const conname of [
      'uploads_worksheet_visibility_check',
      'uploads_lineage_kind_check',
      'uploads_canonical_status_check',
      'uploads_worksheet_index_nonneg_check',
      'uploads_attempt_count_nonneg_check',
      'uploads_lineage_coherence_check',
    ]) {
      expect(MIGRATION).toContain(`ensure_check('uploads', '${conname}'`)
    }
  })

  it('establishes/validates every required unique invariant via ensure_unique_constraint / ensure_unique_index', () => {
    expect(MIGRATION).toContain("ensure_unique_constraint('import_batches', 'import_batches_id_organisation_id_key'")
    expect(MIGRATION).toContain("ensure_unique_constraint('import_batches', 'import_batches_storage_key_key'")
    expect(MIGRATION).toContain("ensure_unique_constraint('import_batches', 'import_batches_organisation_id_idempotency_key_key'")
    expect(MIGRATION).toContain("ensure_unique_index('uploads', 'uploads_import_batch_worksheet_key'")
  })

  it('establishes/validates both import_batches foreign keys and the composite uploads tenant FK via ensure_fk', () => {
    expect(MIGRATION).toContain("ensure_fk('import_batches', 'import_batches_organisation_id_fkey'")
    expect(MIGRATION).toContain("ensure_fk('import_batches', 'import_batches_uploaded_by_fkey'")
    expect(MIGRATION).toContain("ensure_fk('uploads', 'uploads_import_batch_org_fkey'")
  })

  it('READY status requires a non-NULL sha256 — the one truthful state invariant', () => {
    expect(MIGRATION).toContain('import_batches_ready_requires_sha256')
    expect(MIGRATION).toMatch(/CHECK \(status <> 'READY' OR sha256 IS NOT NULL\)/)
  })

  it('enforces LEGACY/DATA_HUB coherence: LEGACY rows carry no canonical identity, DATA_HUB rows carry all of it', () => {
    const coherenceBlock = blockScope(MIGRATION, 'uploads_lineage_coherence_check', ');')
    expect(coherenceBlock).toContain("lineage_kind = ''LEGACY''")
    expect(coherenceBlock).toContain('import_batch_id IS NULL')
    expect(coherenceBlock).toContain('worksheet_index IS NULL')
    expect(coherenceBlock).toContain('canonical_status IS NULL')
    expect(coherenceBlock).toContain("lineage_kind = ''DATA_HUB''")
    expect(coherenceBlock).toContain('import_batch_id IS NOT NULL')
    expect(coherenceBlock).toContain('worksheet_index IS NOT NULL')
    expect(coherenceBlock).toContain('canonical_status IS NOT NULL')
  })

  it('schema-qualifies every critical DDL target as public.<table> — never relies on search_path', () => {
    const criticalTargets = [
      'CREATE TABLE IF NOT EXISTS public.import_batches',
      'ALTER TABLE public.import_batches ADD COLUMN id TEXT NOT NULL',
      'ALTER TABLE public.import_batches ADD PRIMARY KEY (id)',
      'REFERENCES public.organisations (id)',
      'REFERENCES public.users (id) ON DELETE SET NULL',
      'REFERENCES public.import_batches (id, organisation_id)',
      'CREATE INDEX IF NOT EXISTS idx_import_batches_org_created ON public.import_batches',
      'CREATE INDEX IF NOT EXISTS idx_import_batches_status      ON public.import_batches',
      'ALTER TABLE public.uploads ADD COLUMN import_batch_id TEXT',
      'CREATE INDEX IF NOT EXISTS idx_uploads_import_batch ON public.uploads',
      'CREATE UNIQUE INDEX uploads_import_batch_worksheet_key ON public.uploads',
    ]
    for (const target of criticalTargets) {
      expect(MIGRATION, `expected schema-qualified DDL target: ${target}`).toContain(target)
    }
  })

  it('never issues an unqualified ALTER/CREATE TABLE, CREATE INDEX, or REFERENCES against import_batches/uploads/organisations/users outside the pg_temp helper bodies', () => {
    // Strip the six helper function bodies first — their catalog lookups
    // legitimately use nspname = 'public' as a string literal (not a
    // schema-qualified SQL identifier), which would otherwise be an
    // unrelated false positive for this check.
    let activeOnly = MIGRATION
    for (const helper of ENSURE_HELPERS) {
      const start = activeOnly.indexOf(`CREATE OR REPLACE FUNCTION pg_temp.${helper}(`)
      const end = activeOnly.indexOf('$fn$;', start) + '$fn$;'.length
      activeOnly = activeOnly.slice(0, start) + activeOnly.slice(end)
    }
    activeOnly = activeOnly.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

    expect(activeOnly).not.toMatch(/\bALTER TABLE (import_batches|uploads)\b/)
    expect(activeOnly).not.toMatch(/\bCREATE TABLE(?: IF NOT EXISTS)? (import_batches|uploads)\b/)
    expect(activeOnly).not.toMatch(/\bCREATE (?:UNIQUE )?INDEX[^\n]*? ON (import_batches|uploads)\b/)
    expect(activeOnly).not.toMatch(/REFERENCES (organisations|users|import_batches)\s*\(/)
  })

  it('validation helper functions live in pg_temp (session-scoped) and are explicitly dropped at the end — no permanent migration-framework objects persist', () => {
    expect(MIGRATION).toMatch(/CREATE (OR REPLACE )?FUNCTION pg_temp\./)
    expect(MIGRATION).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\./)
    for (const helper of ENSURE_HELPERS) {
      expect(MIGRATION).toContain(`DROP FUNCTION IF EXISTS pg_temp.${helper}`)
    }
  })

  it('does not touch/drop/rewrite any existing constraint or column, and performs no backfill UPDATE', () => {
    // Rollback section (commented reference only) is exempt from this check.
    const activeSql = MIGRATION.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(activeSql).not.toMatch(/^\s*DROP\s+(COLUMN|TABLE)\s/im)
    expect(activeSql).not.toMatch(/^\s*UPDATE\s/im)
  })
})

// Data Hub 5A.2C-R4 — explicit default-contract remediation.
//
// WHY THIS BLOCK EXISTS: Codex's R3 push-gate review found that
// ensure_column's single p_expected_default parameter was ambiguous —
// NULL meant both "don't check the default" and (for every genuinely
// no-default column) "must have no default," so an unexpected database
// default silently survived migration re-application. Two concrete
// exploits were reproduced and confirmed live against a disposable
// Postgres container before this fix: import_batches.sha256 acquiring
// DEFAULT repeat('0', 64) (fabricating an authoritative hash for every
// new row), and uploads.import_batch_id acquiring DEFAULT 'bogus-batch'
// (silently attaching legacy uploads to a batch that was never
// intended). ensure_column now takes p_check_default (boolean) and
// p_expected_default (text) as independent parameters — NULL can only
// ever mean "this column must have no database default," never "skip
// validation." Every 5A.2C-owned column below passes p_check_default =
// true.
describe('scripts/create-import-batches.sql — explicit default contracts (5A.2C-R4)', () => {
  it('ensure_column separates "should the default be checked?" from "what should it be?" — NULL can no longer mean both "skip validation" and "must be NULL"', () => {
    const body = helperBody('ensure_column')
    expect(body).toContain('p_check_default boolean')
    expect(body).toContain('p_expected_default text')
    expect(body).toMatch(/IF p_check_default THEN/)
    // The old ambiguous single-parameter gate must be fully gone — it is
    // exactly how Codex's R3 push-gate findings slipped past R3's own
    // test suite (an unexpected default on sha256/import_batch_id was
    // never checked at all, because NULL was read as "skip").
    expect(body).not.toMatch(/IF p_expected_default IS NOT NULL THEN/)
  })

  type DefaultContract = { table: string; column: string; type: string; nullable: boolean; expectedDefault: string }

  // The explicit, per-column default contract required by 5A.2C-R4.
  // expectedDefault is the exact literal SQL source text passed as
  // p_expected_default at the real call site: the string `NULL` means
  // "must have NO database default"; otherwise it's the exact quoted
  // canonical default text Postgres reports back (verified empirically
  // against a live catalog, not guessed). Every column from the current
  // Prisma model must appear in one of these two lists — the
  // exhaustiveness tests below fail loudly if the model ever adds a
  // column without a matching entry here.
  const IMPORT_BATCH_DEFAULT_CONTRACTS: DefaultContract[] = [
    { table: 'import_batches', column: 'id', type: 'text', nullable: false, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'organisation_id', type: 'text', nullable: false, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'uploaded_by', type: 'text', nullable: true, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'original_filename', type: 'text', nullable: false, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'content_type', type: 'text', nullable: false, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'size_bytes', type: 'integer', nullable: false, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'sha256', type: 'text', nullable: true, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'storage_provider', type: 'text', nullable: false, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'storage_key', type: 'text', nullable: false, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'storage_etag', type: 'text', nullable: true, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'status', type: 'text', nullable: false, expectedDefault: "'''AWAITING_UPLOAD''::text'" },
    { table: 'import_batches', column: 'idempotency_key', type: 'text', nullable: true, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'expected_sha256', type: 'text', nullable: true, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'created_at', type: 'timestamp with time zone', nullable: false, expectedDefault: "'now()'" },
    { table: 'import_batches', column: 'updated_at', type: 'timestamp with time zone', nullable: false, expectedDefault: "'now()'" },
    { table: 'import_batches', column: 'deleted_at', type: 'timestamp with time zone', nullable: true, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'storage_deletion_status', type: 'text', nullable: true, expectedDefault: 'NULL' },
    { table: 'import_batches', column: 'storage_deleted_at', type: 'timestamp with time zone', nullable: true, expectedDefault: 'NULL' },
  ]

  const UPLOAD_DEFAULT_CONTRACTS: DefaultContract[] = [
    { table: 'uploads', column: 'import_batch_id', type: 'text', nullable: true, expectedDefault: 'NULL' },
    { table: 'uploads', column: 'worksheet_index', type: 'integer', nullable: true, expectedDefault: 'NULL' },
    { table: 'uploads', column: 'worksheet_name', type: 'text', nullable: true, expectedDefault: 'NULL' },
    { table: 'uploads', column: 'worksheet_visibility', type: 'text', nullable: true, expectedDefault: 'NULL' },
    { table: 'uploads', column: 'worksheet_is_empty', type: 'boolean', nullable: true, expectedDefault: 'NULL' },
    { table: 'uploads', column: 'lineage_kind', type: 'text', nullable: false, expectedDefault: "'''LEGACY''::text'" },
    { table: 'uploads', column: 'canonical_status', type: 'text', nullable: true, expectedDefault: 'NULL' },
    { table: 'uploads', column: 'last_attempt_at', type: 'timestamp with time zone', nullable: true, expectedDefault: 'NULL' },
    { table: 'uploads', column: 'attempt_count', type: 'integer', nullable: false, expectedDefault: "'0'" },
    { table: 'uploads', column: 'last_failure_code', type: 'text', nullable: true, expectedDefault: 'NULL' },
    { table: 'uploads', column: 'last_failure_message', type: 'text', nullable: true, expectedDefault: 'NULL' },
    { table: 'uploads', column: 'last_failure_retryable', type: 'boolean', nullable: true, expectedDefault: 'NULL' },
  ]

  function expectedCallSubstring(c: DefaultContract): string {
    return `ensure_column('${c.table}', '${c.column}', '${c.type}', ${c.nullable}, true, ${c.expectedDefault},`
  }

  it('every ImportBatch column from the current Prisma model has an explicit default-contract entry — not silently skipped', () => {
    const block = blockScope(SCHEMA, 'model ImportBatch {', '@@map("import_batches")')
    const columns = block
      .split('\n')
      .map(l => l.trim())
      .filter(l => /^[a-z_][a-zA-Z0-9_]*\s+(String|Int|Boolean|DateTime)\??\s/.test(l) || /^[a-z_][a-zA-Z0-9_]*\s+(String|Int|Boolean|DateTime)\??$/.test(l))
      .map(l => l.split(/\s+/)[0])
    expect(columns.length).toBeGreaterThanOrEqual(17)
    const contractedColumns = new Set(IMPORT_BATCH_DEFAULT_CONTRACTS.map(c => c.column))
    for (const column of columns) {
      expect(contractedColumns.has(column), `no explicit default contract for import_batches.${column}`).toBe(true)
    }
  })

  it('every additive Upload column has an explicit default-contract entry', () => {
    const additiveColumns = [
      'import_batch_id', 'worksheet_index', 'worksheet_name', 'worksheet_visibility',
      'worksheet_is_empty', 'lineage_kind', 'canonical_status', 'last_attempt_at',
      'attempt_count', 'last_failure_code', 'last_failure_message', 'last_failure_retryable',
    ]
    const contractedColumns = new Set(UPLOAD_DEFAULT_CONTRACTS.map(c => c.column))
    for (const column of additiveColumns) {
      expect(contractedColumns.has(column), `no explicit default contract for uploads.${column}`).toBe(true)
    }
  })

  it('the migration enforces exactly the classified default contract for every ImportBatch column, with default checking explicitly switched on', () => {
    for (const contract of IMPORT_BATCH_DEFAULT_CONTRACTS) {
      const expected = expectedCallSubstring(contract)
      expect(MIGRATION, `expected call fragment: ${expected}`).toContain(expected)
    }
  })

  it('the migration enforces exactly the classified default contract for every additive Upload column, with default checking explicitly switched on', () => {
    for (const contract of UPLOAD_DEFAULT_CONTRACTS) {
      const expected = expectedCallSubstring(contract)
      expect(MIGRATION, `expected call fragment: ${expected}`).toContain(expected)
    }
  })

  it('sha256 is explicitly protected as NO DATABASE DEFAULT — the exact Codex R3 push-gate finding (fabricated authoritative hash)', () => {
    expect(MIGRATION).toContain("ensure_column('import_batches', 'sha256', 'text', true, true, NULL,")
  })

  it('import_batch_id is explicitly protected as NO DATABASE DEFAULT — the exact Codex R3 push-gate finding (fabricated tenant/batch linkage)', () => {
    expect(MIGRATION).toContain("ensure_column('uploads', 'import_batch_id', 'text', true, true, NULL,")
  })

  it('status has its exact required default explicitly protected', () => {
    expect(MIGRATION).toContain("ensure_column('import_batches', 'status', 'text', false, true, '''AWAITING_UPLOAD''::text',")
  })

  it('lineage_kind has its exact required default explicitly protected', () => {
    expect(MIGRATION).toContain("ensure_column('uploads', 'lineage_kind', 'text', false, true, '''LEGACY''::text',")
  })

  it('attempt_count has its exact required default explicitly protected', () => {
    expect(MIGRATION).toContain("ensure_column('uploads', 'attempt_count', 'integer', false, true, '0',")
  })

  it('every ensure_column call site explicitly switches on default checking (p_check_default = true right after the nullability argument)', () => {
    const callLines = MIGRATION.split('\n').filter(l => /^SELECT pg_temp\.ensure_column\(/.test(l.trim()))
    expect(callLines.length).toBe(IMPORT_BATCH_DEFAULT_CONTRACTS.length + UPLOAD_DEFAULT_CONTRACTS.length)
    for (const line of callLines) {
      expect(line, `expected ", true," immediately after the nullability argument in: ${line}`).toMatch(/(true|false),\s*true,/)
    }
  })

  it('the DROP FUNCTION signature for ensure_column matches its updated 7-argument shape', () => {
    expect(MIGRATION).toContain('DROP FUNCTION IF EXISTS pg_temp.ensure_column(text, text, text, boolean, boolean, text, text);')
  })
})

describe('scripts/tests/verify-import-batches-migration.sh — default-contract drift scenarios (5A.2C-R4)', () => {
  it('covers unexpected-default drift across every required category: authoritative data, tenant/identity linkage, non-authoritative metadata, state, application-generated identity, and a representative nullable-metadata field', () => {
    const harness = fs.readFileSync(HARNESS_PATH, 'utf-8')
    for (const marker of [
      "sha256 SET DEFAULT repeat",
      "import_batch_id SET DEFAULT 'bogus-batch'",
      "expected_sha256 SET DEFAULT repeat",
      "canonical_status SET DEFAULT 'AWAITING_CONFIRMATION'",
      'gen_random_uuid()::text',
      "storage_etag SET DEFAULT 'unexpected-etag'",
    ]) {
      expect(harness, `expected harness to reference: ${marker}`).toContain(marker)
    }
  })

  it('covers missing-required-default and wrong-required-default drift for status, lineage_kind, and attempt_count', () => {
    const harness = fs.readFileSync(HARNESS_PATH, 'utf-8')
    for (const marker of [
      'status DROP DEFAULT',
      'lineage_kind DROP DEFAULT',
      'attempt_count DROP DEFAULT',
      "status SET DEFAULT 'FAILED'",
    ]) {
      expect(harness, `expected harness to reference: ${marker}`).toContain(marker)
    }
  })
})

describe('scripts/tests/verify-import-batches-migration.sh — repeatable behavioral harness (5A.2C-R3)', () => {
  it('exists as a standalone, Docker-only script requiring no npm dependency or local psql client', () => {
    expect(fs.existsSync(HARNESS_PATH)).toBe(true)
    const harness = fs.readFileSync(HARNESS_PATH, 'utf-8')
    expect(harness).toMatch(/docker (run|exec)/)
    expect(harness).toMatch(/command -v docker/)
    // Always cleans up its own disposable container, even on failure.
    expect(harness).toMatch(/trap\s+cleanup\s+EXIT/)
  })

  it('is referenced from the migration file so a future reviewer finds it without searching', () => {
    expect(MIGRATION).toContain('verify-import-batches-migration.sh')
  })
})
