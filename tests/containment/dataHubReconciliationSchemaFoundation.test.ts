import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { execSync, spawnSync } from 'child_process'

// Data Hub 6.1A — Reconciliation Persistence FOUNDATION schema contract.
//
// WHAT THIS FILE PROVES vs. WHAT IT DOES NOT:
// The "static shape" describe blocks below are source-text containment
// assertions against prisma/schema.prisma and
// scripts/create-datahub-reconciliation.sql — they lock in the intended
// shape so a future edit can't silently drift from what was reviewed,
// mirroring the established convention in
// tests/containment/importBatchLineageSchema.test.ts (5A.2C) and
// tests/containment/dataHubSourceMappingSchema.test.ts (5B.1). They do
// NOT prove the migration's runtime behavior against a real PostgreSQL
// catalog.
//
// The final describe block ("real disposable-Postgres proof — P1-P12")
// DOES prove runtime behavior: it starts a disposable postgres:16-alpine
// Docker container, applies the real scripts/create-import-batches.sql
// (5A.2C) then scripts/create-datahub-source-mappings.sql (5B.1) to get
// a representative pre-6.1A schema, then applies THIS phase's real
// scripts/create-datahub-reconciliation.sql and issues genuine SQL
// through `docker exec ... psql`, asserting on the real success/failure
// of each statement. This is folded into this single test file (rather
// than a separate scripts/tests/*.sh harness, unlike every prior Data
// Hub migration phase) because Phase 6.1A's own narrow implementation
// authorization permits exactly ONE new test file for this slice — see
// this migration's own header comment. If Docker is unavailable, the
// whole block is skipped with a console notice (never silently treated
// as passing) — every other describe block below still runs and does
// not depend on Docker.

const SCHEMA = fs.readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf-8')
const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../../scripts/create-datahub-reconciliation.sql'), 'utf-8')
const REPO_ROOT = path.resolve(__dirname, '../..')

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

// Resolves a local ref that diffs cleanly against origin/main's content,
// memoized for the whole file. A plain local dev checkout already has
// `origin/main` available and this resolves instantly. A CI checkout
// (actions/checkout@v4 defaults to a shallow, single-ref clone) has no
// local `origin/main` ref at all — `git diff origin/main` there fails
// with "fatal: bad revision 'origin/main'", not a real diff difference.
// Explicitly fetching main (shallow, `--depth=1`) makes this resolve
// identically in both environments without depending on any CI-specific
// env var (GITHUB_BASE_REF etc.) or requiring a change to the pre-
// existing, out-of-scope .github/workflows/ci.yml checkout step.
let baseRef: string | null = null
function resolveBaseRef(): string {
  if (baseRef) return baseRef
  try {
    execSync('git rev-parse --verify origin/main', { cwd: REPO_ROOT, stdio: 'ignore' })
    baseRef = 'origin/main'
    return baseRef
  } catch {
    // fall through to explicit fetch
  }
  execSync('git fetch origin main --depth=1 -q', { cwd: REPO_ROOT })
  baseRef = 'FETCH_HEAD'
  return baseRef
}

// ═══════════════════════════════════════════════════════════════════
// T1-T3 — SourceRecordIdentity Prisma model shape
// ═══════════════════════════════════════════════════════════════════

describe('SourceRecordIdentity — Prisma model shape', () => {
  const block = blockScope(SCHEMA, 'model SourceRecordIdentity {', '@@map("source_record_identities")')

  it('T1. exists with the exact minimum required fields', () => {
    for (const field of [
      'id', 'organisation_id', 'source_system_id', 'domain_kind',
      'source_external_id', 'created_at', 'updated_at',
    ]) {
      expect(block).toContain(field)
    }
  })

  it('T2. identity uniqueness is on the exact 4-tuple (organisation_id, source_system_id, domain_kind, source_external_id)', () => {
    expect(block).toContain('@@unique([organisation_id, source_system_id, domain_kind, source_external_id])')
  })

  it('T3. has a composite (id, organisation_id) uniqueness enabling tenant-safe composite FKs from dependents', () => {
    expect(block).toContain('@@unique([id, organisation_id])')
  })

  it('T3b. source_system_id/organisation_id are plain scalar columns (deliberately no Prisma @relation navigation to SourceSystem, to avoid forcing a reverse-relation field onto SourceSystem\'s own model body — see the field\'s doc comment); the real tenant-safe composite FK is enforced at the database level by the migration script instead', () => {
    expect(block).not.toMatch(/SourceSystem\s+@relation/)
    expect(block.toLowerCase()).toContain('database level')
  })

  it('T27. domain_kind is a plain String, not a Postgres enum — mirrors Upload.lineage_kind\'s own established precedent (a discriminator expected to grow, avoiding future ALTER TYPE migrations)', () => {
    const line = block.split('\n').find(l => /^\s*domain_kind\s/.test(l))
    expect(line).toBeDefined()
    expect(line).toMatch(/domain_kind\s+String(\s|$)/)
  })

  it('T23. no field is Ticket#-specific or otherwise domain-coupled — source_external_id is generic (doc comments may still cite Ticket # only as an illustrative example)', () => {
    const fieldLines = block.split('\n').filter(l => /^\s*[a-z_][a-zA-Z0-9_]*\s+(String|Int|Boolean|DateTime)\??(\s|$)/.test(l))
    expect(fieldLines.length).toBeGreaterThanOrEqual(5)
    for (const line of fieldLines) {
      expect(line.toLowerCase(), `field declaration must not be Ticket-specific: ${line}`).not.toContain('ticket')
    }
  })

  it('does not duplicate ImportBatch/Upload/MappingVersion/SHA-specific concepts — this is a source-owned business identity, not an ingestion-lineage identity', () => {
    expect(block).not.toContain('import_batch_id')
    expect(block).not.toContain('upload_id')
    expect(block).not.toContain('mapping_version_id')
    expect(block).not.toContain('sha256')
  })
})

// ═══════════════════════════════════════════════════════════════════
// T4-T6 — IllegalDumping's new reconciliation-identity link
// ═══════════════════════════════════════════════════════════════════

describe('IllegalDumping — additive reconciliation-identity link', () => {
  const block = blockScope(SCHEMA, 'model IllegalDumping {', '@@map("illegal_dumping")')

  it('T4. source_record_identity_id is nullable — zero backfill for every existing/legacy row', () => {
    const line = block.split('\n').find(l => /^\s*source_record_identity_id\s/.test(l))
    expect(line).toBeDefined()
    expect(line).toMatch(/source_record_identity_id\s+String\?/)
  })

  it('T5. source_record_identity_id is unique — at most one current IllegalDumping row per identity', () => {
    const line = block.split('\n').find(l => /^\s*source_record_identity_id\s/.test(l))
    expect(line).toMatch(/@unique/)
  })

  it('T6. has a tenant-safe composite FK to SourceRecordIdentity via (source_record_identity_id, organisation_id)', () => {
    expect(block).toMatch(
      /source_record_identity\s+SourceRecordIdentity\?\s+@relation\(fields: \[source_record_identity_id, organisation_id\], references: \[id, organisation_id\]\)/
    )
  })

  it('the existing seven+ legacy fields/relations remain untouched (organisation_id, upload_id still present)', () => {
    expect(block).toContain('organisation_id')
    expect(block).toContain('upload_id')
  })
})

// ═══════════════════════════════════════════════════════════════════
// T7-T17 — SourceRecordObservation Prisma model shape
// ═══════════════════════════════════════════════════════════════════

describe('SourceRecordObservation — Prisma model shape', () => {
  // Starts at the doc comment immediately preceding the model (not the
  // `model SourceRecordObservation {` line itself) so the T16 immutability
  // documentation, which is written just above the model declaration
  // (matching this schema's own established convention of documenting a
  // model's overall design rationale directly above it, e.g.
  // MappingVersion's own precedent), is included in scope.
  const block = blockScope(SCHEMA, '// Immutable observation history', '@@map("source_record_observations")')

  it('T7. exists with the exact minimum required fields', () => {
    for (const field of [
      'id', 'organisation_id', 'source_record_identity_id', 'import_batch_id',
      'upload_id', 'mapping_version_id', 'observed_at', 'canonical_hash',
      'hash_version', 'outcome', 'created_at',
    ]) {
      expect(block).toContain(field)
    }
  })

  it('T8. has a tenant-safe composite FK to SourceRecordIdentity', () => {
    expect(block).toMatch(
      /source_identity\s+SourceRecordIdentity\s+@relation\(fields: \[source_record_identity_id, organisation_id\], references: \[id, organisation_id\]\)/
    )
  })

  it('T9. has a tenant-safe composite FK to ImportBatch', () => {
    expect(block).toMatch(
      /import_batch\s+ImportBatch\s+@relation\(fields: \[import_batch_id, organisation_id\], references: \[id, organisation_id\]\)/
    )
  })

  it('T10. has a tenant-safe composite FK to Upload', () => {
    expect(block).toMatch(
      /upload\s+Upload\s+@relation\(fields: \[upload_id, organisation_id\], references: \[id, organisation_id\]\)/
    )
  })

  it('T11/T12. mapping_version_id is nullable — mirrors Upload.mapping_version_id\'s own established nullable precedent exactly. Deliberately no Prisma @relation navigation to MappingVersion (same reasoning as SourceRecordIdentity.source_system_id — avoids forcing a reverse-relation field onto MappingVersion\'s own model body); the tenant-safe composite FK is still enforced at the database level by the migration script', () => {
    const line = block.split('\n').find(l => /^\s*mapping_version_id\s/.test(l))
    expect(line).toBeDefined()
    expect(line).toMatch(/mapping_version_id\s+String\?/)
    expect(block).not.toMatch(/MappingVersion\?\s+@relation/)
    expect(block.toLowerCase()).toContain('database level')
  })

  it('T13. canonical_hash is a required (non-nullable) field, documented as a SHA-256 digest', () => {
    const line = block.split('\n').find(l => /^\s*canonical_hash\s/.test(l))
    expect(line).toBeDefined()
    expect(line).toMatch(/canonical_hash\s+String(\s|$)/)
    expect(block.toLowerCase()).toContain('sha-256')
  })

  it('T14. hash_version is a required Int defaulting to 1', () => {
    expect(block).toMatch(/hash_version\s+Int\s+@default\(1\)/)
  })

  it('T15. change_summary is nullable Json, documented as bounded and never raw rows/Notes/PII', () => {
    const line = block.split('\n').find(l => /^\s*change_summary\s/.test(l))
    expect(line).toBeDefined()
    expect(line).toMatch(/change_summary\s+Json\?/)
    expect(block).not.toMatch(/change_summary[\s\S]{0,20}notes/i)
  })

  it('T24. carries no field named/shaped as a raw payload or Notes copy (doc comments may still cite "Notes"/PII only to explain what is deliberately excluded)', () => {
    const fieldLines = block.split('\n').filter(l => /^\s*[a-z_][a-zA-Z0-9_]*\s+(String|Int|Boolean|DateTime|Json)\??(\s|$)/.test(l))
    expect(fieldLines.length).toBeGreaterThanOrEqual(5)
    for (const line of fieldLines) {
      expect(line.toLowerCase(), `field declaration must not be a raw-payload/Notes field: ${line}`).not.toMatch(/\braw_payload\b|\braw_row\b|\bnotes\b/)
    }
  })

  it('T16. documents that immutability is enforced by process convention only (mirrors MappingVersion\'s own established precedent) — no update/delete service exists in this slice', () => {
    expect(block.toLowerCase()).toMatch(/immutab/)
    expect(block.toLowerCase()).toContain('process')
  })

  it('T17. has indexes on (organisation_id, source_record_identity_id) and (upload_id)', () => {
    expect(block).toContain('@@index([organisation_id, source_record_identity_id])')
    expect(block).toContain('@@index([upload_id])')
  })

  it('T23. no Ticket#-specific naming anywhere in this model', () => {
    expect(block.toLowerCase()).not.toContain('ticket')
  })
})

// ═══════════════════════════════════════════════════════════════════
// T18 — persisted outcome enum truthfulness (the core design decision)
// ═══════════════════════════════════════════════════════════════════

describe('SourceRecordObservationOutcome — persisted-outcome truthfulness (T18)', () => {
  const block = blockScope(SCHEMA, 'enum SourceRecordObservationOutcome {', '}')

  it('T18. contains EXACTLY the truthful subset {NEW, UNCHANGED, CHANGED} — never the full 5-value planner vocabulary', () => {
    expect(block).toContain('NEW')
    expect(block).toContain('UNCHANGED')
    expect(block).toContain('CHANGED')
    expect(block).not.toContain('INVALID')
    expect(block).not.toContain('CONFLICT')
  })

  it('T18b. documents WHY INVALID/CONFLICT are excluded — neither can ever reach a committed write under the existing all-or-nothing Confirm architecture', () => {
    const fullBlock = blockScope(SCHEMA, '// Data Hub 6.1A', 'enum SourceRecordObservationOutcome {')
    expect(fullBlock.toLowerCase()).toMatch(/invalid/)
    expect(fullBlock.toLowerCase()).toMatch(/conflict/)
    expect(fullBlock.toLowerCase()).toMatch(/all-or-nothing|impossible state|never.*reach.*committed/)
  })

  it('the enum contains exactly 3 values — no accidental extra value slipped in', () => {
    const values = block
      .split('\n')
      .map(l => l.trim())
      .filter(l => /^[A-Z_]+$/.test(l))
    expect(values.sort()).toEqual(['CHANGED', 'NEW', 'UNCHANGED'])
  })
})

// ═══════════════════════════════════════════════════════════════════
// Upload — additive tenant-safety unique constraint (required by
// SourceRecordObservation's own composite FK)
// ═══════════════════════════════════════════════════════════════════

describe('Upload — additive (id, organisation_id) uniqueness (T26)', () => {
  const block = blockScope(SCHEMA, 'model Upload {', '@@map("uploads")')

  it('T26. adds @@unique([id, organisation_id]) purely additively — the existing @id/other constraints remain untouched', () => {
    expect(block).toContain('@@unique([id, organisation_id])')
    expect(block).toMatch(/id\s+String\s+@id/)
  })

  it('has the new reverse relation to SourceRecordObservation', () => {
    expect(block).toContain('SourceRecordObservation[]')
  })
})

// ═══════════════════════════════════════════════════════════════════
// scripts/create-datahub-reconciliation.sql — migration structure
// ═══════════════════════════════════════════════════════════════════

describe('scripts/create-datahub-reconciliation.sql — ensure_* drift-safety design', () => {
  it('defines all six ensure_* helpers plus the new ensure_enum_type helper, all void-returning', () => {
    for (const helper of [...ENSURE_HELPERS, 'ensure_enum_type']) {
      expect(MIGRATION).toContain(`CREATE OR REPLACE FUNCTION pg_temp.${helper}(`)
    }
  })

  it('every ensure_* call site is a SELECT statement, not a PERFORM', () => {
    const callLines = MIGRATION
      .split('\n')
      .filter(l => /pg_temp\.ensure_(column|check|unique_constraint|primary_key|fk|unique_index|enum_type)\(/.test(l))
      .filter(l => !l.trim().startsWith('CREATE') && !l.trim().startsWith('DROP'))
    expect(callLines.length).toBeGreaterThanOrEqual(20)
    for (const line of callLines) {
      expect(line.trim()).toMatch(/^SELECT pg_temp\.ensure_/)
    }
    expect(MIGRATION).not.toMatch(/\bPERFORM\s+pg_temp\.ensure_/)
  })

  it('T20. ensure_fk validates MATCH SIMPLE and rejects NOT VALID — same drift-safety design as every prior Data Hub migration', () => {
    const body = blockScope(MIGRATION, 'CREATE OR REPLACE FUNCTION pg_temp.ensure_fk(', '$fn$;')
    expect(body).toMatch(/confmatchtype\s+IS DISTINCT FROM\s+'s'/)
    expect(body).toContain('convalidated')
  })

  it('T2/T3b. establishes source_record_identities uniqueness and its composite SourceSystem FK via ensure_unique_constraint/ensure_fk', () => {
    expect(MIGRATION).toContain("ensure_unique_constraint('source_record_identities', 'source_record_identities_org_source_domain_external_key'")
    expect(MIGRATION).toContain("ensure_unique_constraint('source_record_identities', 'source_record_identities_id_organisation_id_key'")
    expect(MIGRATION).toContain("ensure_fk('source_record_identities', 'source_record_identities_source_system_org_fkey'")
    expect(MIGRATION).toContain(
      "ARRAY['source_system_id', 'organisation_id'], 'source_systems', ARRAY['id', 'organisation_id']"
    )
  })

  it('T6. establishes illegal_dumping\'s new column, its uniqueness, and its composite FK to source_record_identities', () => {
    expect(MIGRATION).toContain("ensure_column('illegal_dumping', 'source_record_identity_id', 'text', true, true, NULL,")
    expect(MIGRATION).toContain("ensure_unique_index('illegal_dumping', 'illegal_dumping_source_record_identity_id_key'")
    expect(MIGRATION).toContain("ensure_fk('illegal_dumping', 'illegal_dumping_source_record_identity_org_fkey'")
  })

  it('T8-T11. establishes every source_record_observations composite tenant FK', () => {
    expect(MIGRATION).toContain("ensure_fk('source_record_observations', 'source_record_observations_identity_org_fkey'")
    expect(MIGRATION).toContain("ensure_fk('source_record_observations', 'source_record_observations_import_batch_org_fkey'")
    expect(MIGRATION).toContain("ensure_fk('source_record_observations', 'source_record_observations_upload_org_fkey'")
    expect(MIGRATION).toContain("ensure_fk('source_record_observations', 'source_record_observations_mapping_version_org_fkey'")
  })

  it('T18/T13. establishes the outcome enum with exactly {NEW, UNCHANGED, CHANGED} and the canonical_hash bounded CHECK', () => {
    expect(MIGRATION).toContain("ensure_enum_type('source_record_observation_outcome',")
    expect(MIGRATION).toContain("ARRAY['NEW', 'UNCHANGED', 'CHANGED']")
    expect(MIGRATION).toContain('source_record_observations_hash_bounded_check')
    // Literal SQL source text: a single-quoted regex literal inside an
    // already-single-quoted p_create_sql string is escaped as a doubled
    // single quote (''...''), not a single quote.
    expect(MIGRATION).toMatch(/canonical_hash\s*~\s*''\^\[0-9a-f\]\{64\}\$''/)
  })

  it('T26. establishes uploads\' new (id, organisation_id) uniqueness required by the composite upload FK', () => {
    expect(MIGRATION).toContain("ensure_unique_constraint('uploads', 'uploads_id_organisation_id_key'")
  })

  it('T19/T28. contains ZERO UPDATE/DELETE statements anywhere — genuinely zero-backfill, unlike 5A.2G.0\'s one narrowly-scoped exception', () => {
    const activeSql = MIGRATION.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(activeSql).not.toMatch(/^\s*UPDATE\s/im)
    expect(activeSql).not.toMatch(/^\s*DELETE\s+FROM\s/im)
    expect(activeSql).not.toMatch(/^\s*DROP\s+(COLUMN|TABLE)\s/im)
  })

  it('T23. contains no Ticket#-specific naming anywhere in the migration', () => {
    const activeSql = MIGRATION.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(activeSql.toLowerCase()).not.toContain('ticket')
  })

  it('schema-qualifies every critical DDL target as public.<table>', () => {
    for (const target of [
      'CREATE TABLE IF NOT EXISTS public.source_record_identities',
      'CREATE TABLE IF NOT EXISTS public.source_record_observations',
      'REFERENCES public.organisations (id)',
      'REFERENCES public.source_systems (id, organisation_id)',
      'REFERENCES public.source_record_identities (id, organisation_id)',
      'REFERENCES public.import_batches (id, organisation_id)',
      'REFERENCES public.uploads (id, organisation_id)',
      'REFERENCES public.mapping_versions (id, organisation_id)',
    ]) {
      expect(MIGRATION, `expected schema-qualified DDL target: ${target}`).toContain(target)
    }
  })

  it('includes a commented-out manual rollback block in reverse-dependency order', () => {
    expect(MIGRATION).toContain('-- Rollback (manual, NOT executed')
    expect(MIGRATION).toContain('DROP TABLE IF EXISTS public.source_record_observations')
    expect(MIGRATION).toContain('DROP TABLE IF EXISTS public.source_record_identities')
    expect(MIGRATION).toContain('DROP TYPE IF EXISTS public.source_record_observation_outcome')
    // Reverse-dependency ordering: illegal_dumping's FK/column must be
    // rolled back before source_record_identities itself is dropped.
    const illegalDumpingDropIdx = MIGRATION.indexOf('DROP COLUMN IF EXISTS source_record_identity_id')
    const identitiesDropIdx = MIGRATION.indexOf('DROP TABLE IF EXISTS public.source_record_identities')
    expect(illegalDumpingDropIdx).toBeGreaterThan(-1)
    expect(identitiesDropIdx).toBeGreaterThan(illegalDumpingDropIdx)
  })
})

// ═══════════════════════════════════════════════════════════════════
// T21/T22/T25 — zero runtime wiring, zero protected-file drift
// ═══════════════════════════════════════════════════════════════════

describe('Zero runtime reconciliation wiring (T21/T22/T25)', () => {
  // 6.1B — corrected three pre-existing path bugs (discovered during 6.1B's
  // own planning discovery, disclosed to the user as pre-existing test-
  // maintenance debt, not new runtime scope): these three entries were
  // missing the importBatch/ or sourceMapping/ directory segment their real
  // files live under, so `fs.existsSync` silently short-circuited every
  // check below to a no-op PASS for all three, since 6.1A shipped. Only
  // illegalDumpingMapper.ts's path is corrected here (it's the one file in
  // this list 6.1B actually changes, and T22 below needs to genuinely
  // observe that to be retargeted honestly rather than silently no-op).
  // mappingExecution.ts/mappingDocument.ts's own path bugs are untouched —
  // out of scope for 6.1B, since neither file's content changes in this
  // phase — and should be reported to whoever owns 6.1A test maintenance.
  const PROTECTED_FILES = [
    'lib/data-hub/importBatch/confirmWorksheet.ts',
    'lib/data-hub/importBatch/failureTaxonomy.ts',
    'lib/data-hub/importBatch/previewWorksheet.ts',
    'lib/data-hub/importBatch/selectWorksheetMapping.ts',
    'lib/data-hub/mappingExecution.ts',
    'lib/data-hub/mappingDocument.ts',
    'lib/data-hub/importBatch/illegalDumpingMapper.ts',
    'modules/dumping/index.ts',
  ]

  it('T21. no protected Data Hub runtime file references SourceRecordIdentity/SourceRecordObservation/source_record_identity_id', () => {
    for (const relPath of PROTECTED_FILES) {
      const fullPath = path.resolve(REPO_ROOT, relPath)
      if (!fs.existsSync(fullPath)) continue
      const source = fs.readFileSync(fullPath, 'utf-8')
      expect(source, `${relPath} must not reference SourceRecordIdentity`).not.toContain('SourceRecordIdentity')
      expect(source, `${relPath} must not reference SourceRecordObservation`).not.toContain('SourceRecordObservation')
      expect(source, `${relPath} must not reference source_record_identity_id`).not.toContain('source_record_identity_id')
    }
  })

  // T25 RETARGETED (6.1B) — confirmWorksheet.ts is now intentionally,
  // authorizedly changed by Phase 6.1B (source_external_id plumbing +
  // duplicate-identity pre-transaction validation; Checkpoint 2 of the
  // same phase additionally wires the reconciliation transaction sequence
  // and supersedes the 6.0C1 coarse guard). A byte-identity requirement
  // against origin/main is retired for exactly this reason — mirroring
  // this file's own established convention just below (the removed
  // "Diff containment" block) for retiring a check whose premise a later,
  // authorized change has legitimately outgrown, rather than silently
  // leaving a check that would now incorrectly fail on approved work.
  it('T25 (superseded by 6.1B). confirmWorksheet.ts intentionally diverges from origin/main as of Phase 6.1B (source_external_id plumbing, duplicate-identity validation, and reconciliation wiring) — this test now only documents that a diff exists, not its absence', () => {
    const guardFile = 'lib/data-hub/importBatch/confirmWorksheet.ts'
    const fullPath = path.resolve(REPO_ROOT, guardFile)
    if (!fs.existsSync(fullPath)) return
    const diff = execSync(`git diff ${resolveBaseRef()} -- "${guardFile}"`, { cwd: REPO_ROOT, encoding: 'utf-8' })
    expect(diff.trim().length, `expected a real, authorized 6.1B diff to ${guardFile} vs origin/main`).toBeGreaterThan(0)
  })

  // T22 RETARGETED (6.1B) — illegalDumpingMapper.ts is now intentionally,
  // authorizedly changed (source_external_id required-field extraction and
  // the MappedIllegalDumpingRecord wrapper return shape). Same rationale
  // as T25 above.
  it('T22 (superseded by 6.1B). illegalDumpingMapper.ts intentionally diverges from origin/main as of Phase 6.1B (source_external_id extraction, MappedIllegalDumpingRecord wrapper shape) — this test now only documents that a diff exists, not its absence', () => {
    const mapperFile = 'lib/data-hub/importBatch/illegalDumpingMapper.ts'
    const fullPath = path.resolve(REPO_ROOT, mapperFile)
    if (!fs.existsSync(fullPath)) return
    const diff = execSync(`git diff ${resolveBaseRef()} -- "${mapperFile}"`, { cwd: REPO_ROOT, encoding: 'utf-8' })
    expect(diff.trim().length, `expected a real, authorized 6.1B diff to ${mapperFile} vs origin/main`).toBeGreaterThan(0)
  })

  it('the legacy /data writer (modules/dumping/index.ts) is byte-identical to origin/main — 6.1B does not touch this file', () => {
    const legacyFile = 'modules/dumping/index.ts'
    const fullPath = path.resolve(REPO_ROOT, legacyFile)
    if (!fs.existsSync(fullPath)) return
    const diff = execSync(`git diff ${resolveBaseRef()} -- "${legacyFile}"`, { cwd: REPO_ROOT, encoding: 'utf-8' })
    expect(diff.trim(), `expected zero diff to ${legacyFile} vs origin/main`).toBe('')
  })
})

// Removed (post-merge cleanup): a "Diff containment — only authorized
// files changed vs. origin/main" block used to live here, asserting
// that `git diff --name-only origin/main` contained only this PR's
// (6.1A's) own three historical files. That assertion was valid ONLY
// while this PR was itself under review — resolveBaseRef() resolves to
// whatever origin/main IS at test-run time, so once this PR merged,
// origin/main itself absorbed those three files, and the SAME test
// would then compare against ANY LATER PR's own (necessarily
// different) changed files, which can never match this PR's own
// hardcoded historical allowlist. It was conflating "diff against a
// moving target ref" with "this PR's specific historical changeset" —
// true only during this one PR's own active review window, not an
// evergreen production invariant. Removed outright rather than
// replaced, per the same repo convention T25/T22/the legacy-/data-
// writer test above already use correctly: a "byte-identical to
// origin/main" check scoped to one SPECIFIC named file remains a valid,
// permanent guard (and all three of those are kept, unchanged); a check
// of the REPO'S WHOLE diff against a single historical PR's own file
// list is not.

// ═══════════════════════════════════════════════════════════════════
// Real disposable-Postgres proof — P1-P12
// ═══════════════════════════════════════════════════════════════════

function dockerAvailable(): boolean {
  try {
    execSync('docker version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const HAS_DOCKER = dockerAvailable()
const CONTAINER = `datahub-61a-reconciliation-vitest-${process.pid}`

function psqlExec(sql: string): { ok: boolean; output: string } {
  const result = spawnSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'testdb', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf-8' }
  )
  return { ok: result.status === 0, output: (result.stdout || '') + (result.stderr || '') }
}

function applyFile(filePath: string): { ok: boolean; output: string } {
  const sql = fs.readFileSync(filePath, 'utf-8')
  return psqlExec(sql)
}

describe.runIf(HAS_DOCKER)('real disposable-Postgres proof — P1-P12', () => {
  beforeAll(async () => {
    execSync(`docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb postgres:16-alpine`, { stdio: 'ignore' })
    let ready = false
    for (let i = 0; i < 30; i++) {
      const r = spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-U', 'postgres'])
      if (r.status === 0) { ready = true; break }
      await new Promise(r2 => setTimeout(r2, 1000))
    }
    if (!ready) throw new Error('postgres container did not become ready within 30s')

    const bootstrap = `
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
CREATE TYPE "SchemaType" AS ENUM ('MISSED_COLLECTIONS','ILLEGAL_DUMPING','DEBTORS','SERVICE_REQUESTS','BIN_MAINTENANCE','WASTE_METRICS','FINANCIAL','GENERIC','UNKNOWN');
CREATE TYPE "Module" AS ENUM ('WASTE','DUMPING','FORECASTING','MISSED_COLLECTIONS','DEBTORS','BIN_MAINTENANCE','CONTRACTS','OPERATIONS');
CREATE TYPE "UploadStatus" AS ENUM ('PENDING','DETECTING','VALIDATING','PREVIEW_READY','IMPORTING','COMPLETE','FAILED');
CREATE TABLE uploads (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, original_name TEXT NOT NULL, stored_path TEXT NOT NULL, mimetype TEXT NOT NULL, size_bytes INTEGER NOT NULL, schema_type "SchemaType" NOT NULL DEFAULT 'UNKNOWN', module "Module", status "UploadStatus" NOT NULL DEFAULT 'PENDING', row_count INTEGER, column_count INTEGER, columns_detected JSONB NOT NULL DEFAULT '[]', field_mappings JSONB NOT NULL DEFAULT '{}', validation_errors JSONB NOT NULL DEFAULT '[]', preview_rows JSONB NOT NULL DEFAULT '[]', metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP NOT NULL DEFAULT now());
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TABLE illegal_dumping (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, upload_id TEXT REFERENCES uploads(id), report_date TIMESTAMP NOT NULL, location TEXT NOT NULL, suburb TEXT, zone TEXT, waste_type TEXT NOT NULL, volume_estimate TEXT, severity "Severity" NOT NULL DEFAULT 'MEDIUM', status "IncidentStatus" NOT NULL DEFAULT 'OPEN', crew_assigned TEXT, resolution_date TIMESTAMP, cost_estimate DOUBLE PRECISION, notes TEXT, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP NOT NULL DEFAULT now());
CREATE INDEX ON illegal_dumping (organisation_id);
INSERT INTO organisations (id, name, slug) VALUES ('org-a','Org A','org-a'), ('org-b','Org B','org-b');
INSERT INTO users (id, organisation_id, username, name) VALUES ('user-a','org-a','user-a','User A'), ('user-b','org-b','user-b','User B');
`
    const b = psqlExec(bootstrap)
    if (!b.ok) throw new Error('bootstrap failed: ' + b.output)

    const base1 = applyFile(path.resolve(REPO_ROOT, 'scripts/create-import-batches.sql'))
    if (!base1.ok) throw new Error('base migration create-import-batches.sql failed: ' + base1.output)
    const base2 = applyFile(path.resolve(REPO_ROOT, 'scripts/create-datahub-source-mappings.sql'))
    if (!base2.ok) throw new Error('base migration create-datahub-source-mappings.sql failed: ' + base2.output)

    const seed = `
INSERT INTO illegal_dumping (id, organisation_id, report_date, location, waste_type) VALUES ('id-legacy-1','org-a', now(), '123 Main St', 'Furniture');
INSERT INTO illegal_dumping (id, organisation_id, report_date, location, waste_type) VALUES ('id-legacy-2','org-a', now(), '456 Main St', 'Tyres');
INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-a1','org-a','Org A System 1');
INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-b1','org-b','Org B System 1');
INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key) VALUES ('batch-a1','org-a','user-a','a.xlsx','xlsx',100,'vercel-blob','k-a1');
INSERT INTO uploads (id, organisation_id, user_id, original_name, stored_path, mimetype, size_bytes, import_batch_id, worksheet_index, lineage_kind, canonical_status) VALUES ('upload-a1','org-a','user-a','a.xlsx','k-a1','text/csv',100,'batch-a1',0,'DATA_HUB','AWAITING_CONFIRMATION');
INSERT INTO source_mappings (id, organisation_id, source_system_id, name) VALUES ('sm-a1','org-a','ss-a1','Mapping A1');
INSERT INTO mapping_versions (id, organisation_id, source_mapping_id, version_number, mapping_document) VALUES ('mv-a1-v1','org-a','sm-a1',1,'{}');
`
    const s = psqlExec(seed)
    if (!s.ok) throw new Error('seed failed: ' + s.output)
  }, 120_000)

  afterAll(() => {
    spawnSync('docker', ['rm', '-f', CONTAINER])
  })

  it('P1. clean migration applies on top of the real pre-existing 5A.2C+5B.1 schema and a populated illegal_dumping table', () => {
    const r = applyFile(path.resolve(REPO_ROOT, 'scripts/create-datahub-reconciliation.sql'))
    expect(r.ok, r.output).toBe(true)
  })

  it('P1b. second migration application succeeds (idempotent)', () => {
    const r = applyFile(path.resolve(REPO_ROOT, 'scripts/create-datahub-reconciliation.sql'))
    expect(r.ok, r.output).toBe(true)
  })

  it('P2. pre-existing-style IllegalDumping insert with NO source_record_identity_id still succeeds unchanged', () => {
    const r = psqlExec("INSERT INTO illegal_dumping (id, organisation_id, report_date, location, waste_type) VALUES ('id-legacy-3','org-a', now(), '789 Main St', 'Green Waste');")
    expect(r.ok, r.output).toBe(true)
  })

  it('P3. first SourceRecordIdentity for (org-a, ss-a1, ILLEGAL_DUMPING, TICKET-1) succeeds', () => {
    const r = psqlExec("INSERT INTO source_record_identities (id, organisation_id, source_system_id, domain_kind, source_external_id) VALUES ('sri-1','org-a','ss-a1','ILLEGAL_DUMPING','TICKET-1');")
    expect(r.ok, r.output).toBe(true)
  })

  it('P4. duplicate (org-a, ss-a1, ILLEGAL_DUMPING, TICKET-1) is rejected — the core identity uniqueness invariant', () => {
    const r = psqlExec("INSERT INTO source_record_identities (id, organisation_id, source_system_id, domain_kind, source_external_id) VALUES ('sri-1-dup','org-a','ss-a1','ILLEGAL_DUMPING','TICKET-1');")
    expect(r.ok, 'expected rejection but insert succeeded').toBe(false)
  })

  it('P5a. same external_id under a DIFFERENT SourceSystem succeeds', () => {
    psqlExec("INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-a2','org-a','Org A System 2');")
    const r = psqlExec("INSERT INTO source_record_identities (id, organisation_id, source_system_id, domain_kind, source_external_id) VALUES ('sri-2','org-a','ss-a2','ILLEGAL_DUMPING','TICKET-1');")
    expect(r.ok, r.output).toBe(true)
  })

  it('P5b. same external_id under a DIFFERENT domain_kind succeeds', () => {
    const r = psqlExec("INSERT INTO source_record_identities (id, organisation_id, source_system_id, domain_kind, source_external_id) VALUES ('sri-3','org-a','ss-a1','SOME_OTHER_DOMAIN','TICKET-1');")
    expect(r.ok, r.output).toBe(true)
  })

  it('P5c. same external_id under a DIFFERENT organisation succeeds', () => {
    const r = psqlExec("INSERT INTO source_record_identities (id, organisation_id, source_system_id, domain_kind, source_external_id) VALUES ('sri-4','org-b','ss-b1','ILLEGAL_DUMPING','TICKET-1');")
    expect(r.ok, r.output).toBe(true)
  })

  it('P6. cross-tenant SourceRecordIdentity->SourceSystem is rejected', () => {
    const r = psqlExec("INSERT INTO source_record_identities (id, organisation_id, source_system_id, domain_kind, source_external_id) VALUES ('sri-cross','org-b','ss-a1','ILLEGAL_DUMPING','TICKET-CROSS');")
    expect(r.ok, 'expected rejection but insert succeeded').toBe(false)
  })

  it('P7. empty source_external_id is rejected by the bounded-length CHECK', () => {
    const r = psqlExec("INSERT INTO source_record_identities (id, organisation_id, source_system_id, domain_kind, source_external_id) VALUES ('sri-empty','org-a','ss-a1','ILLEGAL_DUMPING','');")
    expect(r.ok, 'expected rejection but insert succeeded').toBe(false)
  })

  it('P8. linking an IllegalDumping row to its SourceRecordIdentity succeeds', () => {
    const r = psqlExec("UPDATE illegal_dumping SET source_record_identity_id = 'sri-1' WHERE id = 'id-legacy-1';")
    expect(r.ok, r.output).toBe(true)
  })

  it('P9. a SECOND IllegalDumping row cannot link to the same SourceRecordIdentity', () => {
    const r = psqlExec("UPDATE illegal_dumping SET source_record_identity_id = 'sri-1' WHERE id = 'id-legacy-2';")
    expect(r.ok, 'expected rejection but update succeeded').toBe(false)
  })

  it('P10. cross-tenant IllegalDumping->SourceRecordIdentity linkage is rejected', () => {
    const r = psqlExec("UPDATE illegal_dumping SET source_record_identity_id = 'sri-4' WHERE id = 'id-legacy-2';")
    expect(r.ok, 'expected rejection but update succeeded').toBe(false)
  })

  it('P11a. a valid SourceRecordObservation with full lineage succeeds', () => {
    const r = psqlExec("INSERT INTO source_record_observations (id, organisation_id, source_record_identity_id, import_batch_id, upload_id, mapping_version_id, canonical_hash, outcome) VALUES ('sro-1','org-a','sri-1','batch-a1','upload-a1','mv-a1-v1', repeat('a',64), 'NEW');")
    expect(r.ok, r.output).toBe(true)
  })

  it('P11b. a valid SourceRecordObservation with a NULL mapping_version_id succeeds', () => {
    const r = psqlExec("INSERT INTO source_record_observations (id, organisation_id, source_record_identity_id, import_batch_id, upload_id, canonical_hash, outcome) VALUES ('sro-2','org-a','sri-1','batch-a1','upload-a1', repeat('b',64), 'UNCHANGED');")
    expect(r.ok, r.output).toBe(true)
  })

  it('P11c. an outcome value outside the persisted enum (INVALID) is rejected at the type level', () => {
    const r = psqlExec("INSERT INTO source_record_observations (id, organisation_id, source_record_identity_id, import_batch_id, upload_id, canonical_hash, outcome) VALUES ('sro-bad-outcome','org-a','sri-1','batch-a1','upload-a1', repeat('c',64), 'INVALID');")
    expect(r.ok, 'expected rejection but insert succeeded').toBe(false)
  })

  it('P11d. a malformed canonical_hash is rejected by the bounded CHECK', () => {
    const r = psqlExec("INSERT INTO source_record_observations (id, organisation_id, source_record_identity_id, import_batch_id, upload_id, canonical_hash, outcome) VALUES ('sro-bad-hash','org-a','sri-1','batch-a1','upload-a1', 'not-a-hash', 'NEW');")
    expect(r.ok, 'expected rejection but insert succeeded').toBe(false)
  })

  it('P12a. cross-tenant Observation->SourceRecordIdentity lineage is rejected', () => {
    const r = psqlExec("INSERT INTO source_record_observations (id, organisation_id, source_record_identity_id, import_batch_id, upload_id, canonical_hash, outcome) VALUES ('sro-cross-1','org-b','sri-1','batch-a1','upload-a1', repeat('d',64), 'NEW');")
    expect(r.ok, 'expected rejection but insert succeeded').toBe(false)
  })

  it('P12b. cross-tenant/nonexistent Observation->ImportBatch lineage is rejected', () => {
    const r = psqlExec("INSERT INTO source_record_observations (id, organisation_id, source_record_identity_id, import_batch_id, upload_id, canonical_hash, outcome) VALUES ('sro-cross-2','org-a','sri-1','batch-does-not-exist','upload-a1', repeat('e',64), 'NEW');")
    expect(r.ok, 'expected rejection but insert succeeded').toBe(false)
  })

  it('P12c. cross-tenant Observation->Upload lineage is rejected', () => {
    psqlExec("INSERT INTO uploads (id, organisation_id, user_id, original_name, stored_path, mimetype, size_bytes) VALUES ('upload-b1','org-b','user-b','b.xlsx','k-b1','text/csv',10);")
    const r = psqlExec("INSERT INTO source_record_observations (id, organisation_id, source_record_identity_id, import_batch_id, upload_id, canonical_hash, outcome) VALUES ('sro-cross-3','org-a','sri-1','batch-a1','upload-b1', repeat('f',64), 'NEW');")
    expect(r.ok, 'expected rejection but insert succeeded').toBe(false)
  })

  it('P12d. cross-tenant Observation->MappingVersion lineage is rejected', () => {
    psqlExec("INSERT INTO source_systems (id, organisation_id, name) VALUES ('ss-b2','org-b','Org B System 2'); INSERT INTO source_mappings (id, organisation_id, source_system_id, name) VALUES ('sm-b1','org-b','ss-b2','Mapping B1'); INSERT INTO mapping_versions (id, organisation_id, source_mapping_id, version_number, mapping_document) VALUES ('mv-b1-v1','org-b','sm-b1',1,'{}');")
    const r = psqlExec("INSERT INTO source_record_observations (id, organisation_id, source_record_identity_id, import_batch_id, upload_id, mapping_version_id, canonical_hash, outcome) VALUES ('sro-cross-4','org-a','sri-1','batch-a1','upload-a1','mv-b1-v1', repeat('9',64), 'NEW');")
    expect(r.ok, 'expected rejection but insert succeeded').toBe(false)
  })

  it('P12e. organisation deletion is blocked while SourceRecordIdentity rows exist', () => {
    const r = psqlExec("DELETE FROM organisations WHERE id = 'org-a';")
    expect(r.ok, 'expected rejection but delete succeeded').toBe(false)
  })
})

if (!HAS_DOCKER) {
  describe('real disposable-Postgres proof — P1-P12', () => {
    it.skip('SKIPPED: Docker is not available in this environment — the P1-P12 real-Postgres proof could not run', () => {})
  })
}
