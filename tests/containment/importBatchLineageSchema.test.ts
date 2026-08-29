import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Data Hub 5A.2C — canonical ingestion lineage schema contract. Static
// source-text assertions against the Prisma schema and the migration
// file; the actual constraints/FKs/idempotency behavior was validated
// separately against a disposable Postgres container (applied twice,
// proving idempotency, plus 15 behavioral proofs — see the 5A.2C report).
// This suite locks in the intended shape so a future edit can't silently
// drift from what was validated.

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
    expect(block).not.toMatch(/sha256\s+String\s+@unique/)
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
  it('creates import_batches idempotently (IF NOT EXISTS)', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS import_batches')
  })

  it('uses TEXT ids with no database-side default, matching uploads.id\'s Prisma-managed convention — not create-implementations.sql\'s raw-SQL gen_random_uuid()::text convention', () => {
    expect(MIGRATION).toMatch(/id\s+TEXT\s+PRIMARY KEY,/)
    expect(MIGRATION).not.toMatch(/import_batches[\s\S]{0,200}gen_random_uuid\(\)/)
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

  it('sha256 is NOT unique and is NOT declared as globally unique anywhere in the migration', () => {
    expect(MIGRATION).not.toMatch(/sha256\s+TEXT\s+NOT NULL\s+UNIQUE/)
    expect(MIGRATION).not.toMatch(/UNIQUE\s*\(\s*sha256\s*\)/)
  })

  it('expected_sha256 is named distinctly from sha256 and documented as non-authoritative', () => {
    expect(MIGRATION).toContain('expected_sha256')
    expect(MIGRATION).toMatch(/NON-authoritative/)
  })

  it('has tenant-scoped idempotency uniqueness: UNIQUE (organisation_id, idempotency_key)', () => {
    expect(MIGRATION).toContain('UNIQUE (organisation_id, idempotency_key)')
  })

  it('has the composite tenant invariant: UNIQUE (id, organisation_id) on import_batches, and a guarded composite FK from uploads', () => {
    expect(MIGRATION).toContain('UNIQUE (id, organisation_id)')
    expect(MIGRATION).toMatch(/FOREIGN KEY \(import_batch_id, organisation_id\)\s*\n\s*REFERENCES import_batches \(id, organisation_id\)/)
  })

  it('guards the composite FK with an existence check — Postgres has no ADD CONSTRAINT IF NOT EXISTS', () => {
    const fkBlock = blockScope(MIGRATION, 'DO $$', "conname = 'uploads_import_batch_org_fkey'")
    expect(fkBlock).toContain('IF NOT EXISTS')
    expect(MIGRATION).toContain("conname = 'uploads_import_batch_org_fkey'")
  })

  it('has worksheet-identity uniqueness via a natively-idempotent unique index, not a bare ADD CONSTRAINT', () => {
    expect(MIGRATION).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uploads_import_batch_worksheet_key')
    expect(MIGRATION).toContain('ON uploads (import_batch_id, worksheet_index)')
  })

  it('canonical_status excludes IMPORTING — no durable in-progress state', () => {
    const canonicalBlock = blockScope(MIGRATION, "canonical_status TEXT\n  CHECK", '));')
    expect(canonicalBlock).toContain('AWAITING_CONFIRMATION')
    expect(canonicalBlock).toContain('INELIGIBLE')
    expect(canonicalBlock).toContain('SKIPPED')
    expect(canonicalBlock).toContain('IMPORTED')
    expect(canonicalBlock).not.toContain('IMPORTING')
  })

  it('lineage_kind is NOT NULL with a safe default and a closed CHECK vocabulary', () => {
    expect(MIGRATION).toMatch(/lineage_kind TEXT NOT NULL DEFAULT 'LEGACY'/)
    expect(MIGRATION).toContain("CHECK (lineage_kind IN ('LEGACY', 'DATA_HUB'))")
  })

  it('has tombstone/delete-support fields: deleted_at, storage_deletion_status, storage_deleted_at', () => {
    expect(MIGRATION).toContain('deleted_at              TIMESTAMPTZ')
    expect(MIGRATION).toContain('storage_deletion_status TEXT')
    expect(MIGRATION).toContain('storage_deleted_at      TIMESTAMPTZ')
  })

  it('every uploads column is added via ADD COLUMN IF NOT EXISTS — idempotent, additive only', () => {
    const alterLines = MIGRATION.split('\n').filter(l => l.includes('ALTER TABLE uploads ADD COLUMN'))
    expect(alterLines.length).toBeGreaterThanOrEqual(11)
    for (const line of alterLines) {
      expect(line).toContain('ADD COLUMN IF NOT EXISTS')
    }
  })

  it('does not touch/drop/rewrite any existing constraint or column, and performs no backfill UPDATE', () => {
    expect(MIGRATION).not.toMatch(/DROP\s+(COLUMN|CONSTRAINT|TABLE)(?!\s+IF EXISTS)/i)
    // Rollback section (commented reference only) is exempt from this check.
    const activeSql = MIGRATION.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(activeSql).not.toMatch(/^\s*UPDATE\s/im)
  })
})
