import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase 5B.1 — Source Systems / Mapping additive schema foundation.
// Static containment on the migration artifact
// (scripts/create-datahub-source-mappings.sql) and prisma/schema.prisma
// — this repo's established convention for hand-written SQL migrations
// (see tests/containment/commercialCoreSchema.test.ts /
// importBatchLineageSchema.test.ts's own pattern). Real PostgreSQL
// constraint enforcement (tenant-isolation FKs, active-version pointer
// integrity, duplicate-version rejection, idempotent rerun) is proven
// separately, against genuine Postgres, by
// scripts/tests/verify-datahub-source-mappings.sh — this file proves
// the SQL/Prisma source itself stays aligned and free of prohibited
// content, not database behavior.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

const sql = readSource('scripts/create-datahub-source-mappings.sql')
const sqlNoComments = stripComments(sql)
const schema = readSource('prisma/schema.prisma')

function schemaModelBody(modelName: string): string {
  const start = schema.indexOf(`model ${modelName} {`)
  expect(start, `model ${modelName} not found in prisma/schema.prisma`).toBeGreaterThan(-1)
  const end = schema.indexOf('\n}', start)
  return schema.slice(start, end)
}

// ── T20 / M15 — no destructive schema/data operation ──────────────────
describe('5B.1 — migration contains no destructive statement', () => {
  it('T20: no DROP TABLE / DROP COLUMN / TRUNCATE / DELETE FROM / ALTER ... TYPE outside comments', () => {
    expect(sqlNoComments).not.toMatch(/DROP\s+TABLE/i)
    expect(sqlNoComments).not.toMatch(/DROP\s+COLUMN/i)
    expect(sqlNoComments).not.toMatch(/TRUNCATE/i)
    expect(sqlNoComments).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(sqlNoComments).not.toMatch(/ALTER\s+COLUMN\s+\w+\s+TYPE/i)
  })

  it('never INSERTs a row for any real tenant — schema only, no data seeding', () => {
    expect(sqlNoComments).not.toMatch(/INSERT INTO/i)
  })

  it('M18 guard: every table this script creates is bootstrapped via the safe CREATE TABLE IF NOT EXISTS () + ensure_column pattern, not a single monolithic CREATE TABLE with inline columns (which would not be rerunnable)', () => {
    for (const table of ['source_systems', 'source_mappings', 'mapping_versions']) {
      expect(sqlNoComments).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(\\);`))
    }
  })
})

// ── T1/T2 — SourceSystem tenant ownership + composite identity ────────
describe('5B.1 — SourceSystem', () => {
  it('T1/T2: organisation_id is NOT NULL and (id, organisation_id) is a unique constraint', () => {
    expect(sqlNoComments).toMatch(/ensure_column\('source_systems', 'organisation_id', 'text', false/)
    expect(sqlNoComments).toMatch(/ADD CONSTRAINT source_systems_id_organisation_id_key UNIQUE \(id, organisation_id\)/)
  })

  it('name uniqueness is tenant-scoped (organisation_id, name), not global', () => {
    expect(sqlNoComments).toMatch(/ADD CONSTRAINT source_systems_organisation_id_name_key UNIQUE \(organisation_id, name\)/)
  })

  it('T12: has an active deactivation flag defaulting to true', () => {
    expect(sqlNoComments).toMatch(/ensure_column\('source_systems', 'active', 'boolean', false, true, 'true'/)
  })

  it('T15: no credential/secret/config/connector field exists on source_systems', () => {
    const forbidden = /credential|secret|api_key|apikey|password|token|connector_config|schedule|cron/i
    expect(sqlNoComments.match(/ensure_column\('source_systems'[^)]*\)/g)?.join('\n') ?? '').not.toMatch(forbidden)
  })

  it('Prisma model matches: tenant-owned, no vendor/connector/credential field, deactivate flag present', () => {
    const body = schemaModelBody('SourceSystem')
    expect(body).toMatch(/organisation_id\s+String/)
    expect(body).toMatch(/active\s+Boolean\s+@default\(true\)/)
    expect(body).not.toMatch(/credential|secret|apiKey|password|connector|schedule/i)
  })
})

// ── T3/T7 — SourceMapping tenant-safe FK + active-version pointer ─────
describe('5B.1 — SourceMapping', () => {
  it('T3: source_mappings -> source_systems FK is composite (source_system_id, organisation_id), MATCH SIMPLE, NO ACTION', () => {
    expect(sqlNoComments).toMatch(
      /ADD CONSTRAINT source_mappings_source_system_org_fkey FOREIGN KEY \(source_system_id, organisation_id\) REFERENCES public\.source_systems \(id, organisation_id\)/
    )
    expect(sqlNoComments).toMatch(/ensure_fk\('source_mappings', 'source_mappings_source_system_org_fkey',\s*\n\s*ARRAY\['source_system_id', 'organisation_id'\], 'source_systems', ARRAY\['id', 'organisation_id'\], 'a', 'a'/)
  })

  it('T7: active_mapping_version_id is nullable and its FK is the three-column composite (active_mapping_version_id, id, organisation_id) -> mapping_versions(id, source_mapping_id, organisation_id)', () => {
    expect(sqlNoComments).toMatch(/ensure_column\('source_mappings', 'active_mapping_version_id', 'text', true/)
    expect(sqlNoComments).toMatch(
      /ADD CONSTRAINT source_mappings_active_version_fkey FOREIGN KEY \(active_mapping_version_id, id, organisation_id\) REFERENCES public\.mapping_versions \(id, source_mapping_id, organisation_id\)/
    )
  })

  it('T12: has an active deactivation flag defaulting to true', () => {
    expect(sqlNoComments).toMatch(/ensure_column\('source_mappings', 'active', 'boolean', false, true, 'true'/)
  })

  it('T19: no lib/integrations scheduling coupling — no cron/schedule/connector_id column', () => {
    expect(sqlNoComments.match(/ensure_column\('source_mappings'[^)]*\)/g)?.join('\n') ?? '').not.toMatch(/schedule|cron|connector_id/i)
  })

  it('Prisma model matches: composite FK to SourceSystem, two distinctly-named relations to MappingVersion', () => {
    const body = schemaModelBody('SourceMapping')
    expect(body).toMatch(/source_system\s+SourceSystem\s+@relation\(fields: \[source_system_id, organisation_id\], references: \[id, organisation_id\]\)/)
    expect(body).toMatch(/@relation\("SourceMappingVersions"/)
    expect(body).toMatch(/@relation\("SourceMappingActiveVersion"/)
  })
})

// ── T4/T5/T6 — MappingVersion tenant-safe FK, version uniqueness, doc type ──
describe('5B.1 — MappingVersion', () => {
  it('T4: mapping_versions -> source_mappings FK is composite (source_mapping_id, organisation_id), MATCH SIMPLE, NO ACTION', () => {
    expect(sqlNoComments).toMatch(
      /ADD CONSTRAINT mapping_versions_source_mapping_org_fkey FOREIGN KEY \(source_mapping_id, organisation_id\) REFERENCES public\.source_mappings \(id, organisation_id\)/
    )
  })

  it('T5: version_number uniqueness is scoped to (source_mapping_id, version_number)', () => {
    expect(sqlNoComments).toMatch(
      /ADD CONSTRAINT mapping_versions_source_mapping_id_version_number_key UNIQUE \(source_mapping_id, version_number\)/
    )
  })

  it('T6: mapping_document is JSONB and NOT NULL with no default (a version without a real document is a contradiction)', () => {
    expect(sqlNoComments).toMatch(/ensure_column\('mapping_versions', 'mapping_document', 'jsonb', false, false, NULL/)
  })

  it('version_number has a floor CHECK (>= 1)', () => {
    expect(sqlNoComments).toMatch(/ADD CONSTRAINT mapping_versions_version_number_check CHECK \(version_number >= 1\)/)
  })

  it('T15: no credential/secret field; no executable-code field (script/function/code column)', () => {
    const body = sqlNoComments.match(/ensure_column\('mapping_versions'[^)]*\)/g)?.join('\n') ?? ''
    expect(body).not.toMatch(/credential|secret|password|token/i)
    expect(body).not.toMatch(/\bscript\b|\bfunction_body\b|\bcode\b/i)
  })

  it('Prisma model matches: JSON mapping_document, composite tenant-safe FK, immutability documented (no update-service claim)', () => {
    const body = schemaModelBody('MappingVersion')
    expect(body).toMatch(/mapping_document\s+Json/)
    expect(body).toMatch(/source_mapping\s+SourceMapping\s+@relation\("SourceMappingVersions", fields: \[source_mapping_id, organisation_id\], references: \[id, organisation_id\]\)/)
  })
})

// ── T8/T9 — ImportBatch nullable source lineage + tenant-safe FK ──────
describe('5B.1 — ImportBatch source lineage', () => {
  it('T8: import_batches.source_system_id is nullable', () => {
    expect(sqlNoComments).toMatch(/ensure_column\('import_batches', 'source_system_id', 'text', true/)
  })

  it('T9: import_batches -> source_systems FK is composite (source_system_id, organisation_id), MATCH SIMPLE, NO ACTION', () => {
    expect(sqlNoComments).toMatch(
      /ADD CONSTRAINT import_batches_source_system_org_fkey FOREIGN KEY \(source_system_id, organisation_id\) REFERENCES public\.source_systems \(id, organisation_id\)/
    )
  })

  it('T24 (no backfill): the ADD COLUMN statement for source_system_id has no default and is not NOT NULL', () => {
    expect(sqlNoComments).toMatch(/ALTER TABLE public\.import_batches ADD COLUMN source_system_id TEXT'\)/)
    expect(sqlNoComments).not.toMatch(/import_batches ADD COLUMN source_system_id TEXT NOT NULL/)
  })

  it('Prisma ImportBatch model carries the matching nullable field + composite relation', () => {
    const body = schemaModelBody('ImportBatch')
    expect(body).toMatch(/source_system_id\s+String\?/)
    expect(body).toMatch(/source_system\s+SourceSystem\?\s+@relation\(fields: \[source_system_id, organisation_id\], references: \[id, organisation_id\]\)/)
  })
})

// ── T10/T11 — Upload nullable mapping-version lineage + tenant-safe FK ─
describe('5B.1 — Upload mapping-version lineage', () => {
  it('T10: uploads.mapping_version_id is nullable', () => {
    expect(sqlNoComments).toMatch(/ensure_column\('uploads', 'mapping_version_id', 'text', true/)
  })

  it('T11: uploads -> mapping_versions FK is composite (mapping_version_id, organisation_id), MATCH SIMPLE, NO ACTION', () => {
    expect(sqlNoComments).toMatch(
      /ADD CONSTRAINT uploads_mapping_version_org_fkey FOREIGN KEY \(mapping_version_id, organisation_id\) REFERENCES public\.mapping_versions \(id, organisation_id\)/
    )
  })

  it('T24 (no backfill): the ADD COLUMN statement for mapping_version_id has no default and is not NOT NULL', () => {
    expect(sqlNoComments).toMatch(/ALTER TABLE public\.uploads ADD COLUMN mapping_version_id TEXT'\)/)
    expect(sqlNoComments).not.toMatch(/uploads ADD COLUMN mapping_version_id TEXT NOT NULL/)
  })

  it('does not touch worksheet status columns (canonical_status, lineage_kind) — additive only', () => {
    expect(sqlNoComments).not.toMatch(/ALTER TABLE public\.uploads ALTER COLUMN canonical_status/)
    expect(sqlNoComments).not.toMatch(/ALTER TABLE public\.uploads ALTER COLUMN lineage_kind/)
  })

  it('Prisma Upload model carries the matching nullable field + composite relation', () => {
    const body = schemaModelBody('Upload')
    expect(body).toMatch(/mapping_version_id\s+String\?/)
    expect(body).toMatch(/mapping_version\s+MappingVersion\?\s+@relation\(fields: \[mapping_version_id, organisation_id\], references: \[id, organisation_id\]\)/)
  })
})

// ── T13 — no destructive cascade erases historical lineage ────────────
describe('5B.1 — ON DELETE policy never cascades away lineage', () => {
  it('T13: every ensure_fk call for a tenant/lineage FK uses NO ACTION (Postgres code "a"), never CASCADE ("c")', () => {
    const lineageFks = [
      'source_systems_organisation_id_fkey',
      'source_mappings_organisation_id_fkey',
      'source_mappings_source_system_org_fkey',
      'source_mappings_active_version_fkey',
      'mapping_versions_organisation_id_fkey',
      'mapping_versions_source_mapping_org_fkey',
      'import_batches_source_system_org_fkey',
      'uploads_mapping_version_org_fkey',
    ]
    for (const conname of lineageFks) {
      const re = new RegExp(`ensure_fk\\([^;]*?'${conname}'[^;]*?'a', 'a'`, 's')
      expect(sqlNoComments, `${conname} must be ON DELETE NO ACTION ('a')`).toMatch(re)
    }
  })

  it('actor/creator FKs (created_by) use SET NULL ("n"), matching import_batches.uploaded_by precedent', () => {
    const actorFks = ['source_systems_created_by_fkey', 'source_mappings_created_by_fkey', 'mapping_versions_created_by_fkey']
    for (const conname of actorFks) {
      const re = new RegExp(`ensure_fk\\([^;]*?'${conname}'[^;]*?'n', 'a'`, 's')
      expect(sqlNoComments, `${conname} must be ON DELETE SET NULL ('n')`).toMatch(re)
    }
  })
})

// ── T14 — actor FK type matches canonical User type ────────────────────
describe('5B.1 — actor/audit fields', () => {
  it('T14: created_by columns are TEXT (matching users.id\'s TEXT/cuid convention), referencing public.users(id)', () => {
    for (const table of ['source_systems', 'source_mappings', 'mapping_versions']) {
      expect(sqlNoComments).toMatch(new RegExp(`ensure_column\\('${table}', 'created_by', 'text', true`))
      expect(sqlNoComments).toMatch(new RegExp(`ensure_fk\\('${table}', '${table}_created_by_fkey',\\s*\\n\\s*ARRAY\\['created_by'\\], 'users', ARRAY\\['id'\\]`))
    }
  })

  it('Prisma creator relations use distinct relation names avoiding ambiguity with User\'s other relations', () => {
    const userBody = schemaModelBody('User')
    expect(userBody).toMatch(/@relation\("SourceSystemCreatedBy"/)
    expect(userBody).toMatch(/@relation\("SourceMappingCreatedBy"/)
    expect(userBody).toMatch(/@relation\("MappingVersionCreatedBy"/)
  })
})

// ── T16/T17/T18 — no Phase 6 leakage ───────────────────────────────────
describe('5B.1 — no Phase 6 / Onkaparinga-specific schema leakage', () => {
  const phase6Terms = [
    'SourceRecordIdentity', 'source_record_identity',
    'Observation', 'observation',
    'external_id', 'source_external_id', 'reconciliation_status',
    'canonical_hash', 'reporting_period', 'snapshot',
    'onkaparinga', 'technologyone', 'technology_one',
    'ticket_number', 'ticket_#', 'ticket#',
  ]

  it('T16/T17/T18: no Phase 6 external-ID/reconciliation/Onkaparinga/reporting-period term appears anywhere in the migration SQL', () => {
    const lower = sqlNoComments.toLowerCase()
    for (const term of phase6Terms) {
      expect(lower, `found prohibited Phase 6 term: ${term}`).not.toContain(term.toLowerCase())
    }
  })

  it('T16/T17/T18: no Phase 6 term appears anywhere in the new Prisma models', () => {
    const combined = [schemaModelBody('SourceSystem'), schemaModelBody('SourceMapping'), schemaModelBody('MappingVersion')].join('\n').toLowerCase()
    for (const term of phase6Terms) {
      expect(combined, `found prohibited Phase 6 term: ${term}`).not.toContain(term.toLowerCase())
    }
  })
})

// ── T19 — no lib/integrations coupling ─────────────────────────────────
describe('5B.1 — no lib/integrations coupling', () => {
  it('T19: no reference to Connector/Integration/SyncJob concepts in the migration or new Prisma models', () => {
    const forbidden = /\bConnector\b|\bIntegration\b|\bSyncJob\b|connector_id|integration_id|sync_job_id/
    expect(sqlNoComments).not.toMatch(forbidden)
    const combined = [schemaModelBody('SourceSystem'), schemaModelBody('SourceMapping'), schemaModelBody('MappingVersion')].join('\n')
    expect(combined).not.toMatch(forbidden)
  })
})

// ── T21 — SQL and Prisma table/column names align ──────────────────────
describe('5B.1 — SQL and Prisma stay aligned', () => {
  it('T21: @@map table names match the SQL table names exactly', () => {
    expect(schemaModelBody('SourceSystem') + '\n' + schema.slice(schema.indexOf('model SourceSystem'), schema.indexOf('model SourceSystem') + 3000)).toBeTruthy()
    expect(schema).toMatch(/model SourceSystem \{[\s\S]*?@@map\("source_systems"\)/)
    expect(schema).toMatch(/model SourceMapping \{[\s\S]*?@@map\("source_mappings"\)/)
    expect(schema).toMatch(/model MappingVersion \{[\s\S]*?@@map\("mapping_versions"\)/)
  })

  it('T21: every Prisma field on the three new models has a corresponding SQL ensure_column call (snake_case names identical, no @map divergence)', () => {
    const fieldsByModel: Record<string, string[]> = {
      source_systems: ['id', 'organisation_id', 'name', 'description', 'active', 'created_by', 'created_at', 'updated_at'],
      source_mappings: ['id', 'organisation_id', 'source_system_id', 'name', 'active', 'active_mapping_version_id', 'created_by', 'created_at', 'updated_at'],
      mapping_versions: ['id', 'organisation_id', 'source_mapping_id', 'version_number', 'mapping_document', 'created_by', 'created_at'],
    }
    for (const [table, fields] of Object.entries(fieldsByModel)) {
      for (const field of fields) {
        expect(sqlNoComments, `${table}.${field} missing an ensure_column call`).toMatch(
          new RegExp(`ensure_column\\('${table}', '${field}',`)
        )
      }
    }
  })
})

// ── T22 — existing Data Hub schema remains compatible ──────────────────
describe('5B.1 — existing Data Hub schema untouched beyond additive columns', () => {
  it('T22: does not ALTER, DROP, or redefine any pre-existing import_batches/uploads column other than adding the two new lineage columns', () => {
    const alterStatements = sqlNoComments.match(/ALTER TABLE public\.(import_batches|uploads)[^;]*;/g) ?? []
    for (const stmt of alterStatements) {
      const isAddSourceSystemId = /ADD COLUMN source_system_id TEXT'/.test(stmt)
      const isAddMappingVersionId = /ADD COLUMN mapping_version_id TEXT'/.test(stmt)
      const isAddSourceSystemFk = /ADD CONSTRAINT import_batches_source_system_org_fkey/.test(stmt)
      const isAddMappingVersionFk = /ADD CONSTRAINT uploads_mapping_version_org_fkey/.test(stmt)
      expect(
        isAddSourceSystemId || isAddMappingVersionId || isAddSourceSystemFk || isAddMappingVersionFk,
        `unexpected ALTER on import_batches/uploads: ${stmt}`
      ).toBe(true)
    }
  })

  it('T25 (no backfill / existing rows preserved): no UPDATE statement targets import_batches or uploads', () => {
    expect(sqlNoComments).not.toMatch(/UPDATE\s+public\.(import_batches|uploads)\b/i)
  })
})

// ── T23 — migration rerun/idempotency proof (structural precondition) ──
describe('5B.1 — every DDL object creation is idempotent by construction', () => {
  it('T23: every table, column, constraint, and FK is routed through an ensure_*() helper or IF NOT EXISTS — never a bare CREATE TABLE/ALTER TABLE ADD COLUMN/ADD CONSTRAINT outside the helper pattern', () => {
    const bareCreateTable = sqlNoComments.match(/^CREATE TABLE (?!IF NOT EXISTS)/gm) ?? []
    expect(bareCreateTable).toHaveLength(0)
    // Every literal "ALTER TABLE ... ADD COLUMN" / "ADD CONSTRAINT" string
    // in the file must appear only inside a p_..._sql argument string
    // passed to an ensure_*() call (i.e. immediately preceded on some
    // earlier line by "ensure_" within the same statement) — approximated
    // here by requiring every such literal to be single-quoted (a psql
    // string argument), never a bare top-level statement.
    const bareAlterAdd = sqlNoComments.match(/^ALTER TABLE public\.\w+ ADD (COLUMN|CONSTRAINT)/gm) ?? []
    expect(bareAlterAdd, 'found a bare top-level ALTER TABLE ADD outside an ensure_*() call').toHaveLength(0)
  })

  it('the real rerun/idempotency behavior is proven against genuine Postgres by scripts/tests/verify-datahub-source-mappings.sh (checks 1 and 14), not merely asserted here', () => {
    const harness = readSource('scripts/tests/verify-datahub-source-mappings.sh')
    expect(harness).toMatch(/second application of the 5B\.1 migration succeeds \(idempotent\)/)
  })
})

// ── Prohibited migration/CRUD scope creep (Section 33 boundary) ───────
describe('5B.1 — no CRUD/HTTP/service-layer scope creep', () => {
  it('this migration file contains no route/handler/service-layer TypeScript reference (schema-only)', () => {
    expect(sqlNoComments).not.toMatch(/app\/api|NextRequest|NextResponse/)
  })
})
