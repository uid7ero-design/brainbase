import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Data Hub 5A.2C — canonical ingestion lineage schema contract.
//
// IMPORTANT — what this file proves vs. what it does NOT prove:
// These are static source-text assertions against the Prisma schema and
// the migration file. They lock in the intended shape so a future edit
// can't silently drift from what was reviewed — they do NOT prove the
// migration's runtime behavior. In particular, "the migration text
// contains an IF NOT EXISTS guard" is NOT equivalent to "the migration
// is safe against schema drift" — a same-named-but-differently-defined
// pre-existing object can satisfy a name-only guard while enforcing
// nothing (this was independently reproduced during 5A.2C review as a
// real bypass: a non-unique same-named index, and an unrelated FK with
// the same name, both passed a bare "IF NOT EXISTS"/name check).
//
// The actual constraints/FKs/idempotency/drift-rejection behavior was
// validated separately against disposable PostgreSQL 16 containers,
// destroyed after use: the clean-path migration applied twice
// (idempotent), 20 behavioral invariant proofs, and 8 adversarial drift
// scenarios (same-name FK on another table; wrong-definition same-name
// FK on the intended table; non-unique same-name worksheet index;
// wrong-columns same-name worksheet index; under-scoped idempotency
// constraint; wrong-type pre-existing uploads column; wrong-shape
// pre-existing import_batches table; weakened same-name CHECK) — all of
// which the remediated migration correctly rejects with a RAISE
// EXCEPTION rather than silently accepting. See the 5A.2C-R1
// remediation report for exact commands/output.

const SCHEMA = fs.readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf-8')
const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../../scripts/create-import-batches.sql'), 'utf-8')

function blockScope(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf(endMarker, start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
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

  it('sha256 is nullable — the authoritative hash is not known at batch creation under the direct-to-Blob protocol (5A.2C-R1 fix)', () => {
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

describe('scripts/create-import-batches.sql — migration content', () => {
  it('creates import_batches only if truly absent (to_regclass probe), not a bare CREATE TABLE IF NOT EXISTS', () => {
    expect(MIGRATION).toContain("to_regclass('public.import_batches') IS NULL")
    expect(MIGRATION).not.toContain('CREATE TABLE IF NOT EXISTS import_batches')
  })

  it('uses TEXT ids with no database-side default, matching uploads.id\'s Prisma-managed convention — not create-implementations.sql\'s raw-SQL gen_random_uuid()::text convention', () => {
    expect(MIGRATION).toMatch(/id\s+TEXT\s+PRIMARY KEY,/)
    expect(MIGRATION).not.toMatch(/import_batches[\s\S]{0,400}gen_random_uuid\(\)/)
  })

  it('organisation_id has NO ON DELETE clause on its FK line — deliberately NO ACTION, not CASCADE (tombstone-first Blob deletion)', () => {
    const orgFkLine = MIGRATION.split('\n').find(l => /organisation_id\s+TEXT\s+NOT NULL REFERENCES organisations\(id\)/.test(l))
    expect(orgFkLine).toBeDefined()
    expect(orgFkLine).not.toContain('ON DELETE')
  })

  it('uploaded_by references users(id) ON DELETE SET NULL', () => {
    expect(MIGRATION).toMatch(/uploaded_by\s+TEXT\s+REFERENCES users\(id\) ON DELETE SET NULL/)
  })

  it('content_type is CHECK-constrained to exactly the 3 supported 5A.1 formats', () => {
    expect(MIGRATION).toContain("CHECK (content_type IN ('csv', 'xls', 'xlsx'))")
  })

  it('size_bytes has a non-negative CHECK', () => {
    expect(MIGRATION).toMatch(/size_bytes\s+INTEGER\s+NOT NULL CHECK \(size_bytes >= 0\)/)
  })

  it('sha256 is nullable and has NO NOT NULL constraint anywhere in the create-path (5A.2C-R1 fix)', () => {
    const createBlock = blockScope(MIGRATION, 'CREATE TABLE import_batches (', 'CONSTRAINT import_batches_ready_requires_sha256')
    expect(createBlock).toMatch(/sha256\s+TEXT\s+CHECK/)
    expect(createBlock).not.toMatch(/sha256\s+TEXT\s+NOT NULL/)
  })

  it('READY status requires a non-NULL sha256 — the one truthful state invariant (5A.2C-R1 fix)', () => {
    expect(MIGRATION).toContain('import_batches_ready_requires_sha256')
    expect(MIGRATION).toMatch(/CHECK \(status <> 'READY' OR sha256 IS NOT NULL\)/)
  })

  it('sha256 is NOT declared as globally unique anywhere in the migration', () => {
    expect(MIGRATION).not.toMatch(/sha256\s+TEXT\s+.*UNIQUE/)
    expect(MIGRATION).not.toMatch(/UNIQUE\s*\(\s*sha256\s*\)/)
  })

  it('expected_sha256 is named distinctly from sha256 and documented as non-authoritative', () => {
    expect(MIGRATION).toContain('expected_sha256')
    expect(MIGRATION).toMatch(/NON-authoritative/)
  })

  it('status is CHECK-constrained to physical-file/storage/inspection lifecycle values ONLY — no worksheet aggregate outcome (COMPLETE/PARTIALLY_COMPLETE) leaks into batch status', () => {
    const statusBlock = blockScope(MIGRATION, "status                  TEXT        NOT NULL DEFAULT 'AWAITING_UPLOAD'", ')')
    expect(statusBlock).toContain('AWAITING_UPLOAD')
    expect(statusBlock).toContain('PROCESSING')
    expect(statusBlock).toContain('READY')
    expect(statusBlock).toContain('FAILED')
    expect(statusBlock).toContain('DELETION_PENDING')
    expect(statusBlock).not.toContain('COMPLETE')
    expect(statusBlock).not.toContain('PARTIALLY_COMPLETE')
  })

  it('has tenant-scoped idempotency uniqueness: UNIQUE (organisation_id, idempotency_key)', () => {
    expect(MIGRATION).toContain('UNIQUE (organisation_id, idempotency_key)')
  })

  it('has the composite tenant invariant: UNIQUE (id, organisation_id) on import_batches, and a structurally-validated composite FK from uploads', () => {
    expect(MIGRATION).toContain('UNIQUE (id, organisation_id)')
    expect(MIGRATION).toMatch(/FOREIGN KEY \(import_batch_id, organisation_id\)\s*\n\s*REFERENCES import_batches \(id, organisation_id\)/)
  })

  it('validates the composite FK structurally (assert_fk: table/columns/reference/delete-rule), not a bare name-only guard — the exact bypass previously reproduced', () => {
    expect(MIGRATION).toContain("pg_temp.assert_fk('uploads', 'uploads_import_batch_org_fkey'")
    // The helper itself must check referenced table, ordered source/ref columns, and delete rule — not conname alone.
    const helperBlock = blockScope(MIGRATION, 'CREATE OR REPLACE FUNCTION pg_temp.assert_fk(', '$fn$;')
    expect(helperBlock).toContain('confrelid')
    expect(helperBlock).toContain('conkey')
    expect(helperBlock).toContain('confkey')
    expect(helperBlock).toContain('confdeltype')
    expect(helperBlock).toContain('RAISE EXCEPTION')
  })

  it('has worksheet-identity uniqueness via a structurally-validated unique index (uniqueness, columns, no partial predicate) — not a bare CREATE UNIQUE INDEX IF NOT EXISTS', () => {
    expect(MIGRATION).toContain("pg_temp.assert_unique_index('uploads', 'uploads_import_batch_worksheet_key'")
    const helperBlock = blockScope(MIGRATION, 'CREATE OR REPLACE FUNCTION pg_temp.assert_unique_index(', '$fn$;')
    // Must actually ENFORCE uniqueness (a RAISE tied to indisunique), not
    // merely select the column into a record and never check it —
    // string presence of "indisunique" alone is not sufficient proof.
    expect(helperBlock).toMatch(/IF NOT r\.indisunique THEN\s*\n\s*RAISE EXCEPTION/)
    expect(helperBlock).toContain('indpred')
    expect(helperBlock).toContain('indexprs')
    expect(helperBlock).toContain('RAISE EXCEPTION')
  })

  it('canonical_status excludes IMPORTING — no durable in-progress state', () => {
    const canonicalBlock = blockScope(MIGRATION, "'uploads_canonical_status_check'", 'IN (')
    expect(MIGRATION).toContain('AWAITING_CONFIRMATION')
    expect(MIGRATION).toContain('INELIGIBLE')
    expect(MIGRATION).toContain('SKIPPED')
    const statusVocabBlock = blockScope(MIGRATION, "canonical_status IN (", ')')
    expect(statusVocabBlock).toContain('IMPORTED')
    expect(statusVocabBlock).not.toContain('IMPORTING')
    expect(canonicalBlock).toBeDefined()
  })

  it('lineage_kind is NOT NULL with a safe default and a closed CHECK vocabulary', () => {
    expect(MIGRATION).toMatch(/lineage_kind TEXT NOT NULL DEFAULT 'LEGACY'/)
    expect(MIGRATION).toContain("lineage_kind IN ('LEGACY', 'DATA_HUB')")
  })

  it('has non-negative CHECKs for worksheet_index and attempt_count on uploads (5A.2C-R1 fix)', () => {
    expect(MIGRATION).toContain('uploads_worksheet_index_nonneg_check')
    expect(MIGRATION).toMatch(/CHECK \(worksheet_index IS NULL OR worksheet_index >= 0\)/)
    expect(MIGRATION).toContain('uploads_attempt_count_nonneg_check')
    expect(MIGRATION).toMatch(/CHECK \(attempt_count >= 0\)/)
  })

  it('enforces LEGACY/DATA_HUB coherence: LEGACY rows carry no canonical identity, DATA_HUB rows carry all of it (5A.2C-R1 fix)', () => {
    expect(MIGRATION).toContain('uploads_lineage_coherence_check')
    const coherenceBlock = blockScope(MIGRATION, 'uploads_lineage_coherence_check', 'END $$;')
    expect(coherenceBlock).toContain("lineage_kind = 'LEGACY'")
    expect(coherenceBlock).toContain('import_batch_id IS NULL')
    expect(coherenceBlock).toContain('worksheet_index IS NULL')
    expect(coherenceBlock).toContain('canonical_status IS NULL')
    expect(coherenceBlock).toContain("lineage_kind = 'DATA_HUB'")
    expect(coherenceBlock).toContain('import_batch_id IS NOT NULL')
    expect(coherenceBlock).toContain('worksheet_index IS NOT NULL')
    expect(coherenceBlock).toContain('canonical_status IS NOT NULL')
    // Deliberately NOT required for DATA_HUB rows — descriptive metadata,
    // not identity (name), or not architecturally mandatory for every row
    // (visibility/emptiness).
    expect(coherenceBlock).not.toContain('worksheet_name IS NOT NULL')
    expect(coherenceBlock).not.toContain('worksheet_visibility IS NOT NULL')
    expect(coherenceBlock).not.toContain('worksheet_is_empty IS NOT NULL')
  })

  it('has tombstone/delete-support fields: deleted_at, storage_deletion_status, storage_deleted_at', () => {
    expect(MIGRATION).toContain('deleted_at              TIMESTAMPTZ')
    expect(MIGRATION).toContain('storage_deletion_status TEXT')
    expect(MIGRATION).toContain('storage_deleted_at      TIMESTAMPTZ')
  })

  it('validates every critical import_batches column via assert_column when the table already exists — not a silent CREATE TABLE IF NOT EXISTS no-op', () => {
    const validateBranch = blockScope(MIGRATION, 'ELSE', 'END IF;\nEND $$;\n\nCREATE INDEX IF NOT EXISTS idx_import_batches_org_created')
    for (const column of [
      'id', 'organisation_id', 'uploaded_by', 'original_filename', 'content_type',
      'size_bytes', 'sha256', 'storage_provider', 'storage_key', 'status',
      'idempotency_key', 'expected_sha256', 'deleted_at', 'storage_deletion_status',
      'storage_deleted_at',
    ]) {
      expect(validateBranch).toContain(`assert_column('import_batches', '${column}'`)
    }
  })

  it('validates every critical uploads column via assert_column even when the column already exists — ADD COLUMN IF NOT EXISTS alone is insufficient', () => {
    for (const column of [
      'import_batch_id', 'worksheet_index', 'worksheet_name', 'worksheet_visibility',
      'worksheet_is_empty', 'lineage_kind', 'canonical_status', 'last_attempt_at',
      'attempt_count', 'last_failure_code', 'last_failure_message', 'last_failure_retryable',
    ]) {
      expect(MIGRATION).toContain(`assert_column('uploads', '${column}'`)
    }
  })

  it('every uploads column addition is gated by an explicit existence probe, not a bare ADD COLUMN IF NOT EXISTS relied on alone', () => {
    const addColumnLines = MIGRATION.split('\n').filter(l => /^\s*ALTER TABLE uploads ADD COLUMN \w/.test(l))
    expect(addColumnLines.length).toBeGreaterThanOrEqual(11)
    // Each such ALTER TABLE line must be preceded by its own existence check.
    for (const line of addColumnLines) {
      const idx = MIGRATION.indexOf(line)
      const preceding = MIGRATION.slice(Math.max(0, idx - 300), idx)
      expect(preceding).toMatch(/NOT EXISTS \(SELECT 1 FROM information_schema\.columns/)
    }
  })

  it('validation helper functions live in pg_temp (session-scoped) and are explicitly dropped at the end — no permanent migration-framework objects persist', () => {
    expect(MIGRATION).toMatch(/CREATE (OR REPLACE )?FUNCTION pg_temp\./)
    expect(MIGRATION).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\./)
    expect(MIGRATION).toContain('DROP FUNCTION IF EXISTS pg_temp.assert_column')
    expect(MIGRATION).toContain('DROP FUNCTION IF EXISTS pg_temp.assert_check')
    expect(MIGRATION).toContain('DROP FUNCTION IF EXISTS pg_temp.assert_fk')
    expect(MIGRATION).toContain('DROP FUNCTION IF EXISTS pg_temp.assert_unique_index')
  })

  it('does not touch/drop/rewrite any existing constraint or column, and performs no backfill UPDATE', () => {
    // Rollback section (commented reference only) is exempt from this check.
    const activeSql = MIGRATION.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(activeSql).not.toMatch(/^\s*DROP\s+(COLUMN|TABLE)\s/im)
    expect(activeSql).not.toMatch(/^\s*UPDATE\s/im)
  })
})
