import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Data Hub 6.2D3A — source-schema + worksheet mapping profile FOUNDATION.
// Static containment on prisma/schema.prisma and
// scripts/create-datahub-source-schema-profiles.sql, same convention as
// tests/containment/dataHubSourceMappingSchema.test.ts (5B.1). These
// assertions lock in the reviewed SHAPE and the D3A boundary (schema only;
// XLSX mapping/confirm/import still disabled; no runtime consumer). Real
// PostgreSQL enforcement (tenant isolation, lineage coherence, allowlists,
// active-pointer integrity, zero backfill, idempotent rerun, fail-loud
// drift) is proven separately against genuine Postgres by
// scripts/tests/verify-datahub-source-schema-profiles.sh.

const REPO_ROOT = path.resolve(__dirname, '../..')

function readSource(relPath: string): string {
  // Normalize CRLF (Windows checkouts) so line-anchored assertions are stable.
  return fs.readFileSync(path.resolve(REPO_ROOT, relPath), 'utf-8').replace(/\r\n/g, '\n')
}

const SQL = readSource('scripts/create-datahub-source-schema-profiles.sql')
const ACTIVE_SQL = SQL.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
// The DDL proper, excluding the pg_temp helper definitions (whose RAISE
// messages legitimately mention e.g. 'MATCH FULL' / 'NOT VALID').
const DDL_SQL = ACTIVE_SQL.slice(ACTIVE_SQL.indexOf('CREATE TABLE IF NOT EXISTS public.dataset_types ();'))
const SCHEMA = readSource('prisma/schema.prisma')
const HARNESS = readSource('scripts/tests/verify-datahub-source-schema-profiles.sh')

function modelBody(name: string): string {
  const start = SCHEMA.indexOf(`model ${name} {`)
  expect(start, `model ${name} not found`).toBeGreaterThan(-1)
  const end = SCHEMA.indexOf('\n}', start)
  return SCHEMA.slice(start, end)
}

// Model body with // comments removed.
function modelCode(name: string): string {
  return modelBody(name).split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
}

// The doc-comment block immediately preceding a model.
function modelDoc(name: string): string {
  const start = SCHEMA.indexOf(`model ${name} {`)
  return SCHEMA.slice(SCHEMA.lastIndexOf('\n}\n', start), start)
}

// Scalar field names only (excludes relation fields, comments, @@ lines).
function scalarFields(name: string): string[] {
  return modelBody(name)
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^[a-z_][a-z0-9_]*\s+(String|Int|Boolean|DateTime|Json)\??(\s|$)/.test(l))
    .map(l => l.split(/\s+/)[0])
}

const NEW_MODELS: Record<string, { table: string; fields: string[] }> = {
  DatasetType: {
    table: 'dataset_types',
    fields: ['id', 'organisation_id', 'source_system_id', 'name', 'description', 'active', 'created_by', 'created_at', 'updated_at'],
  },
  SourceSchemaVersion: {
    table: 'source_schema_versions',
    fields: ['id', 'organisation_id', 'dataset_type_id', 'version_number', 'label', 'status', 'created_by', 'created_at', 'activated_at'],
  },
  SourceSchemaWorksheet: {
    table: 'source_schema_worksheets',
    fields: ['id', 'organisation_id', 'source_schema_version_id', 'logical_key', 'expected_name', 'ordinal_hint', 'presence', 'role', 'created_at'],
  },
  SourceSchemaColumn: {
    table: 'source_schema_columns',
    fields: ['id', 'organisation_id', 'source_schema_worksheet_id', 'ordinal', 'source_header', 'logical_field_key', 'presence', 'declared_type', 'sensitivity_class', 'created_at'],
  },
  WorksheetMappingProfile: {
    table: 'worksheet_mapping_profiles',
    fields: ['id', 'organisation_id', 'source_schema_worksheet_id', 'name', 'active', 'active_profile_version_id', 'created_by', 'created_at', 'updated_at'],
  },
  WorksheetMappingProfileVersion: {
    table: 'worksheet_mapping_profile_versions',
    fields: ['id', 'organisation_id', 'worksheet_mapping_profile_id', 'version_number', 'disposition', 'profile_document', 'created_by', 'created_at'],
  },
}
const NEW_TABLES = Object.values(NEW_MODELS).map(m => m.table)

// ── Prisma: exact models / fields / relations ─────────────────────────
describe('6.2D3A — Prisma models', () => {
  it('every new model exists with EXACTLY the reviewed scalar fields and @@map table name', () => {
    for (const [model, { table, fields }] of Object.entries(NEW_MODELS)) {
      expect(scalarFields(model), `${model} scalar fields`).toEqual(fields)
      expect(modelBody(model)).toContain(`@@map("${table}")`)
    }
  })

  it('status/presence/role/declared_type/sensitivity_class/disposition are plain String (SQL CHECK allowlists), not Prisma enums', () => {
    expect(modelBody('SourceSchemaVersion')).toMatch(/\n\s*status\s+String\s+@default\("DRAFT"\)/)
    expect(modelBody('SourceSchemaWorksheet')).toMatch(/\n\s*presence\s+String\n/)
    expect(modelBody('SourceSchemaWorksheet')).toMatch(/\n\s*role\s+String\n/)
    expect(modelBody('SourceSchemaColumn')).toMatch(/\n\s*declared_type\s+String\n/)
    expect(modelBody('SourceSchemaColumn')).toMatch(/\n\s*sensitivity_class\s+String\n/)
    expect(modelBody('WorksheetMappingProfileVersion')).toMatch(/\n\s*disposition\s+String\n/)
    expect(modelBody('WorksheetMappingProfileVersion')).toMatch(/\n\s*profile_document\s+Json\n/)
  })

  it('nullability matches the SQL: ordinal_hint / logical_field_key / activated_at / active_profile_version_id / description / created_by nullable; sensitivity_class required with no default', () => {
    expect(modelBody('SourceSchemaWorksheet')).toMatch(/\n\s*ordinal_hint\s+Int\?/)
    expect(modelBody('SourceSchemaColumn')).toMatch(/\n\s*logical_field_key\s+String\?/)
    expect(modelBody('SourceSchemaColumn')).toMatch(/\n\s*ordinal\s+Int\n/)
    expect(modelBody('SourceSchemaVersion')).toMatch(/\n\s*activated_at\s+DateTime\?/)
    expect(modelBody('WorksheetMappingProfile')).toMatch(/\n\s*active_profile_version_id\s+String\?/)
    expect(modelBody('DatasetType')).toMatch(/\n\s*description\s+String\?/)
    expect(modelBody('SourceSchemaColumn')).not.toMatch(/sensitivity_class\s+String\s+@default/)
  })

  it('every parent/child relation is a composite tenant-scoped relation', () => {
    expect(modelBody('DatasetType')).toMatch(/source_system\s+SourceSystem\s+@relation\(fields: \[source_system_id, organisation_id\], references: \[id, organisation_id\]\)/)
    expect(modelBody('SourceSchemaVersion')).toMatch(/dataset_type\s+DatasetType\s+@relation\(fields: \[dataset_type_id, organisation_id\], references: \[id, organisation_id\]\)/)
    expect(modelBody('SourceSchemaWorksheet')).toMatch(/schema_version\s+SourceSchemaVersion\s+@relation\(fields: \[source_schema_version_id, organisation_id\], references: \[id, organisation_id\]\)/)
    expect(modelBody('SourceSchemaColumn')).toMatch(/worksheet\s+SourceSchemaWorksheet\s+@relation\(fields: \[source_schema_worksheet_id, organisation_id\], references: \[id, organisation_id\]\)/)
    expect(modelBody('WorksheetMappingProfile')).toMatch(/worksheet\s+SourceSchemaWorksheet\s+@relation\(fields: \[source_schema_worksheet_id, organisation_id\], references: \[id, organisation_id\]\)/)
    expect(modelBody('WorksheetMappingProfileVersion')).toMatch(/profile\s+WorksheetMappingProfile\s+@relation\("WorksheetMappingProfileVersions", fields: \[worksheet_mapping_profile_id, organisation_id\], references: \[id, organisation_id\]\)/)
  })

  it('the active profile pointer is the three-column composite relation (same profile + same tenant), with its Prisma one-to-one unique', () => {
    const body = modelBody('WorksheetMappingProfile')
    expect(body).toMatch(/active_version\s+WorksheetMappingProfileVersion\?\s+@relation\("WorksheetMappingProfileActiveVersion", fields: \[active_profile_version_id, id, organisation_id\], references: \[id, worksheet_mapping_profile_id, organisation_id\]\)/)
    expect(body).toContain('@@unique([active_profile_version_id, id, organisation_id])')
    expect(modelBody('WorksheetMappingProfileVersion')).toContain('@@unique([id, worksheet_mapping_profile_id, organisation_id])')
    expect(modelBody('WorksheetMappingProfileVersion')).toMatch(/active_for_profile\s+WorksheetMappingProfile\?\s+@relation\("WorksheetMappingProfileActiveVersion"\)/)
  })

  it('composite uniques required by the tenant FKs and lineage FKs exist; name uniqueness is never global', () => {
    for (const model of Object.keys(NEW_MODELS)) {
      expect(modelBody(model), model).toContain('@@unique([id, organisation_id])')
    }
    expect(modelBody('DatasetType')).toContain('@@unique([id, source_system_id, organisation_id])')
    expect(modelBody('DatasetType')).toContain('@@unique([source_system_id, name])')
    expect(modelBody('SourceSchemaVersion')).toContain('@@unique([id, dataset_type_id, organisation_id])')
    expect(modelBody('SourceSchemaVersion')).toContain('@@unique([dataset_type_id, version_number])')
    expect(modelBody('SourceSchemaWorksheet')).toContain('@@unique([source_schema_version_id, logical_key])')
    expect(modelBody('SourceSchemaWorksheet')).toContain('@@unique([source_schema_version_id, expected_name])')
    expect(modelBody('SourceSchemaColumn')).toContain('@@unique([source_schema_worksheet_id, ordinal])')
    expect(modelBody('WorksheetMappingProfile')).toContain('@@unique([source_schema_worksheet_id, name])')
    expect(modelBody('WorksheetMappingProfileVersion')).toContain('@@unique([worksheet_mapping_profile_id, version_number])')
    for (const model of Object.keys(NEW_MODELS)) {
      expect(modelBody(model), `${model} must not have a global unique name`).not.toMatch(/\n\s*name\s+String\s+@unique/)
    }
  })

  it('source_header and logical_field_key are deliberately NOT unique per sheet (documented decision)', () => {
    const body = modelBody('SourceSchemaColumn')
    expect(body).not.toMatch(/@@unique\(\[source_schema_worksheet_id, source_header\]\)/)
    expect(body).not.toMatch(/@@unique\(\[source_schema_worksheet_id, logical_field_key\]\)/)
    expect(modelDoc('SourceSchemaColumn')).toMatch(/DELIBERATELY not unique per sheet/)
  })

  it('creator relations are SetNull with distinct relation names, and reverse relations exist on Organisation/User/SourceSystem', () => {
    const creators: Record<string, string> = {
      DatasetType: 'DatasetTypeCreatedBy',
      SourceSchemaVersion: 'SourceSchemaVersionCreatedBy',
      WorksheetMappingProfile: 'WorksheetMappingProfileCreatedBy',
      WorksheetMappingProfileVersion: 'WorksheetMappingProfileVersionCreatedBy',
    }
    const user = modelBody('User')
    for (const [model, rel] of Object.entries(creators)) {
      expect(modelBody(model)).toContain(`@relation("${rel}", fields: [created_by], references: [id], onDelete: SetNull)`)
      expect(user).toContain(`@relation("${rel}")`)
    }
    const org = modelBody('Organisation')
    for (const model of Object.keys(NEW_MODELS)) {
      expect(org).toMatch(new RegExp(`\\s${model}\\[\\]`))
    }
    expect(modelBody('SourceSystem')).toMatch(/dataset_types\s+DatasetType\[\]/)
  })

  it('no new relation uses onDelete: Cascade (historical lineage is never cascaded away)', () => {
    for (const model of Object.keys(NEW_MODELS)) {
      expect(modelBody(model), model).not.toMatch(/onDelete:\s*Cascade/)
    }
  })
})

// ── Prisma: ImportBatch nullable lineage ──────────────────────────────
describe('6.2D3A — ImportBatch lineage (Prisma)', () => {
  const body = modelBody('ImportBatch')

  it('dataset_type_id and source_schema_version_id are nullable', () => {
    expect(body).toMatch(/\n\s*dataset_type_id\s+String\?\n/)
    expect(body).toMatch(/\n\s*source_schema_version_id\s+String\?\n/)
  })

  it('dataset_type relation is (dataset_type_id, source_system_id, organisation_id) -> DatasetType(id, source_system_id, organisation_id)', () => {
    expect(body).toMatch(/dataset_type\s+DatasetType\?\s+@relation\(fields: \[dataset_type_id, source_system_id, organisation_id\], references: \[id, source_system_id, organisation_id\]\)/)
  })

  it('source_schema_version relation is (source_schema_version_id, dataset_type_id, organisation_id) -> SourceSchemaVersion(id, dataset_type_id, organisation_id)', () => {
    expect(body).toMatch(/source_schema_version\s+SourceSchemaVersion\?\s+@relation\(fields: \[source_schema_version_id, dataset_type_id, organisation_id\], references: \[id, dataset_type_id, organisation_id\]\)/)
  })

  it('the pre-existing 5B.1 source_system lineage relation is unchanged', () => {
    expect(body).toMatch(/\n\s*source_system_id\s+String\?\n/)
    expect(body).toMatch(/source_system SourceSystem\? @relation\(fields: \[source_system_id, organisation_id\], references: \[id, organisation_id\]\)/)
  })
})

// ── SQL: tables, columns, alignment ───────────────────────────────────
describe('6.2D3A — migration SQL shape', () => {
  it('every new table is bootstrapped via CREATE TABLE IF NOT EXISTS public.<t> () and every Prisma field has an exact ensure_column call', () => {
    for (const { table, fields } of Object.values(NEW_MODELS)) {
      expect(ACTIVE_SQL).toContain(`CREATE TABLE IF NOT EXISTS public.${table} ();`)
      for (const field of fields) {
        expect(ACTIVE_SQL, `${table}.${field}`).toMatch(new RegExp(`ensure_column\\('${table}', '${field}',`))
      }
    }
  })

  it('creates no table other than the six new ones', () => {
    const created = [...ACTIVE_SQL.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map(m => m[1]).sort()
    expect(created).toEqual([...NEW_TABLES].sort())
    expect(ACTIVE_SQL.match(/^CREATE TABLE (?!IF NOT EXISTS)/gm) ?? []).toHaveLength(0)
  })

  it('every DDL target is schema-qualified public.<table>', () => {
    const alters = ACTIVE_SQL.match(/ALTER TABLE \S+/g) ?? []
    expect(alters.length).toBeGreaterThan(0)
    for (const a of alters) expect(a).toMatch(/^ALTER TABLE public\./)
    const refs = ACTIVE_SQL.match(/REFERENCES \S+/g) ?? []
    for (const r of refs) expect(r).toMatch(/^REFERENCES public\./)
    const idx = ACTIVE_SQL.match(/CREATE INDEX \w+ ON \S+/g) ?? []
    expect(idx.length).toBeGreaterThan(0)
    for (const i of idx) expect(i).toMatch(/ON public\./)
  })

  it('every constraint/index name stays within Postgres\'s 63-byte identifier limit (a truncated name would break exact-name rerun)', () => {
    const names = [...ACTIVE_SQL.matchAll(/ADD CONSTRAINT (\w+)|CREATE INDEX (\w+)/g)].map(m => m[1] ?? m[2])
    expect(names.length).toBeGreaterThan(30)
    for (const n of names) expect(n.length, n).toBeLessThanOrEqual(63)
  })

  it('status/presence/role/declared_type/sensitivity_class/disposition CHECK allowlists are exact', () => {
    expect(ACTIVE_SQL).toContain(`CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'))`)
    expect(ACTIVE_SQL).toContain(`source_schema_worksheets_presence_check CHECK (presence IN ('REQUIRED', 'OPTIONAL'))`)
    expect(ACTIVE_SQL).toContain(`CHECK (role IN ('DATA', 'METADATA', 'SUMMARY'))`)
    expect(ACTIVE_SQL).toContain(`source_schema_columns_presence_check CHECK (presence IN ('REQUIRED', 'OPTIONAL'))`)
    expect(ACTIVE_SQL).toContain(`CHECK (declared_type IN ('STRING', 'DATE_TIME', 'DATE', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'UNKNOWN'))`)
    expect(ACTIVE_SQL).toContain(`CHECK (sensitivity_class IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'PERSONALLY_IDENTIFIABLE', 'HIGHLY_SENSITIVE'))`)
    expect(ACTIVE_SQL).toContain(`CHECK (disposition IN ('STAGING_DATASET', 'METADATA', 'RECONCILIATION_SUMMARY', 'IGNORE'))`)
    expect(ACTIVE_SQL).toContain('source_schema_versions_version_number_check CHECK (version_number >= 1)')
    expect(ACTIVE_SQL).toContain('worksheet_mapping_profile_versions_version_number_check CHECK (version_number >= 1)')
    expect(ACTIVE_SQL).toContain('source_schema_worksheets_ordinal_hint_check CHECK (ordinal_hint >= 0)')
    expect(ACTIVE_SQL).toContain('source_schema_columns_ordinal_check CHECK (ordinal >= 0)')
    expect(ACTIVE_SQL).toContain(`CHECK (jsonb_typeof(profile_document) = 'object')`)
  })

  it('sensitivity_class is NOT NULL with no default (never silently classified)', () => {
    expect(ACTIVE_SQL).toMatch(/ensure_column\('source_schema_columns', 'sensitivity_class', 'text', false, true, NULL,/)
    expect(ACTIVE_SQL).toContain('ADD COLUMN sensitivity_class TEXT NOT NULL\')')
  })

  it('does NOT reuse the HR-only field tier vocabulary (internal/confidential/restricted) as a Data Hub class', () => {
    expect(ACTIVE_SQL).not.toMatch(/'RESTRICTED'|'restricted'/)
  })

  it('every composite tenant FK references the exact matching unique shape, in column order', () => {
    const fks: Array<[string, string, string]> = [
      ['dataset_types_source_system_org_fkey', '(source_system_id, organisation_id)', 'public.source_systems (id, organisation_id)'],
      ['source_schema_versions_dataset_type_org_fkey', '(dataset_type_id, organisation_id)', 'public.dataset_types (id, organisation_id)'],
      ['source_schema_worksheets_version_org_fkey', '(source_schema_version_id, organisation_id)', 'public.source_schema_versions (id, organisation_id)'],
      ['source_schema_columns_worksheet_org_fkey', '(source_schema_worksheet_id, organisation_id)', 'public.source_schema_worksheets (id, organisation_id)'],
      ['worksheet_mapping_profiles_worksheet_org_fkey', '(source_schema_worksheet_id, organisation_id)', 'public.source_schema_worksheets (id, organisation_id)'],
      ['worksheet_mapping_profile_versions_profile_org_fkey', '(worksheet_mapping_profile_id, organisation_id)', 'public.worksheet_mapping_profiles (id, organisation_id)'],
      ['worksheet_mapping_profiles_active_version_fkey', '(active_profile_version_id, id, organisation_id)', 'public.worksheet_mapping_profile_versions (id, worksheet_mapping_profile_id, organisation_id)'],
      ['import_batches_dataset_type_fkey', '(dataset_type_id, source_system_id, organisation_id)', 'public.dataset_types (id, source_system_id, organisation_id)'],
      ['import_batches_source_schema_version_fkey', '(source_schema_version_id, dataset_type_id, organisation_id)', 'public.source_schema_versions (id, dataset_type_id, organisation_id)'],
    ]
    const uniques: Record<string, string> = {
      'public.source_systems (id, organisation_id)': '', // pre-existing 5B.1 source_systems_id_organisation_id_key
      'public.dataset_types (id, organisation_id)': 'dataset_types_id_organisation_id_key UNIQUE (id, organisation_id)',
      'public.source_schema_versions (id, organisation_id)': 'source_schema_versions_id_organisation_id_key UNIQUE (id, organisation_id)',
      'public.source_schema_worksheets (id, organisation_id)': 'source_schema_worksheets_id_organisation_id_key UNIQUE (id, organisation_id)',
      'public.worksheet_mapping_profiles (id, organisation_id)': 'worksheet_mapping_profiles_id_organisation_id_key UNIQUE (id, organisation_id)',
      'public.worksheet_mapping_profile_versions (id, worksheet_mapping_profile_id, organisation_id)': 'worksheet_mapping_profile_versions_id_profile_org_key UNIQUE (id, worksheet_mapping_profile_id, organisation_id)',
      'public.dataset_types (id, source_system_id, organisation_id)': 'dataset_types_id_source_system_id_organisation_id_key UNIQUE (id, source_system_id, organisation_id)',
      'public.source_schema_versions (id, dataset_type_id, organisation_id)': 'source_schema_versions_id_dataset_type_org_key UNIQUE (id, dataset_type_id, organisation_id)',
    }
    for (const [name, local, ref] of fks) {
      expect(ACTIVE_SQL, name).toContain(`ADD CONSTRAINT ${name} FOREIGN KEY ${local} REFERENCES ${ref}'`)
      const u = uniques[ref]
      expect(u, `no unique registered for ${ref}`).toBeDefined()
      if (u) expect(ACTIVE_SQL, `unique backing ${name}`).toContain(`ADD CONSTRAINT ${u}'`)
    }
    expect(readSource('scripts/create-datahub-source-mappings.sql')).toContain('ADD CONSTRAINT source_systems_id_organisation_id_key UNIQUE (id, organisation_id)')
  })

  it('lineage/tenant FKs are NO ACTION (\'a\'); actor FKs are SET NULL (\'n\'); nothing CASCADEs', () => {
    const noAction = [
      'dataset_types_organisation_id_fkey', 'dataset_types_source_system_org_fkey',
      'source_schema_versions_organisation_id_fkey', 'source_schema_versions_dataset_type_org_fkey',
      'source_schema_worksheets_organisation_id_fkey', 'source_schema_worksheets_version_org_fkey',
      'source_schema_columns_organisation_id_fkey', 'source_schema_columns_worksheet_org_fkey',
      'worksheet_mapping_profiles_organisation_id_fkey', 'worksheet_mapping_profiles_worksheet_org_fkey', 'worksheet_mapping_profiles_active_version_fkey',
      'worksheet_mapping_profile_versions_organisation_id_fkey', 'worksheet_mapping_profile_versions_profile_org_fkey',
      'import_batches_dataset_type_fkey', 'import_batches_source_schema_version_fkey',
    ]
    for (const c of noAction) {
      expect(ACTIVE_SQL, c).toMatch(new RegExp(`ensure_fk\\([^;]*?'${c}'[^;]*?'a', 'a'`, 's'))
    }
    for (const t of ['dataset_types', 'source_schema_versions', 'worksheet_mapping_profiles', 'worksheet_mapping_profile_versions']) {
      expect(ACTIVE_SQL, t).toMatch(new RegExp(`ensure_fk\\([^;]*?'${t}_created_by_fkey'[^;]*?'n', 'a'`, 's'))
      expect(ACTIVE_SQL).toContain(`ADD CONSTRAINT ${t}_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL'`)
    }
    expect(ACTIVE_SQL).not.toMatch(/CASCADE/i)
  })

  it('every new plain index goes through the exact-definition ensure_index helper', () => {
    expect(ACTIVE_SQL).toMatch(/CREATE OR REPLACE FUNCTION pg_temp\.ensure_index\(/)
    expect(ACTIVE_SQL).toMatch(/pg_get_indexdef\(i\.indexrelid\)/)
    expect(ACTIVE_SQL).not.toMatch(/CREATE INDEX IF NOT EXISTS/)
    const created = ACTIVE_SQL.match(/'CREATE INDEX \w+ ON public\.\w+ \(/g) ?? []
    const expected = ACTIVE_SQL.match(/'CREATE INDEX \w+ ON public\.\w+ USING btree \(/g) ?? []
    expect(created.length).toBe(12)
    expect(expected.length).toBe(12)
  })
})

// ── SQL: ordering (cycle-safe) ────────────────────────────────────────
describe('6.2D3A — migration ordering', () => {
  const pos = (s: string) => {
    const i = ACTIVE_SQL.indexOf(s)
    expect(i, s).toBeGreaterThan(-1)
    return i
  }

  it('tables are created parent-first', () => {
    const order = NEW_TABLES.map(t => pos(`CREATE TABLE IF NOT EXISTS public.${t} ();`))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('the active-version FK is added only AFTER the versions table and its backing unique exist', () => {
    const fk = pos('ADD CONSTRAINT worksheet_mapping_profiles_active_version_fkey')
    expect(fk).toBeGreaterThan(pos('CREATE TABLE IF NOT EXISTS public.worksheet_mapping_profile_versions ();'))
    expect(fk).toBeGreaterThan(pos('ADD CONSTRAINT worksheet_mapping_profile_versions_id_profile_org_key'))
    expect(fk).toBeGreaterThan(pos('ADD CONSTRAINT worksheet_mapping_profiles_active_pv_id_org_key'))
  })

  it('import_batches lineage is added last: columns, then implication CHECKs, then FKs', () => {
    const col1 = pos(`ALTER TABLE public.import_batches ADD COLUMN dataset_type_id TEXT'`)
    const col2 = pos(`ALTER TABLE public.import_batches ADD COLUMN source_schema_version_id TEXT'`)
    const chk = pos('ADD CONSTRAINT import_batches_schema_version_requires_dataset_type_check')
    const fk = pos('ADD CONSTRAINT import_batches_dataset_type_fkey')
    expect(col1).toBeGreaterThan(pos('ADD CONSTRAINT worksheet_mapping_profiles_active_version_fkey'))
    expect(col2).toBeGreaterThan(col1)
    expect(chk).toBeGreaterThan(col2)
    expect(fk).toBeGreaterThan(chk)
    expect(fk).toBeGreaterThan(pos('ADD CONSTRAINT dataset_types_id_source_system_id_organisation_id_key'))
    expect(pos('ADD CONSTRAINT import_batches_source_schema_version_fkey')).toBeGreaterThan(pos('ADD CONSTRAINT source_schema_versions_id_dataset_type_org_key'))
  })
})

// ── SQL: ImportBatch lineage coherence + additive-only boundary ───────
describe('6.2D3A — ImportBatch lineage coherence and additive-only boundary', () => {
  it('both lineage columns are added nullable, with no default and no NOT NULL (zero backfill)', () => {
    expect(ACTIVE_SQL).toMatch(/ensure_column\('import_batches', 'dataset_type_id', 'text', true, true, NULL,/)
    expect(ACTIVE_SQL).toMatch(/ensure_column\('import_batches', 'source_schema_version_id', 'text', true, true, NULL,/)
    expect(ACTIVE_SQL).toContain(`ALTER TABLE public.import_batches ADD COLUMN dataset_type_id TEXT'`)
    expect(ACTIVE_SQL).toContain(`ALTER TABLE public.import_batches ADD COLUMN source_schema_version_id TEXT'`)
    expect(ACTIVE_SQL).not.toMatch(/import_batches ADD COLUMN (dataset_type_id|source_schema_version_id) TEXT (NOT NULL|DEFAULT)/)
  })

  it('the two MATCH SIMPLE implication CHECKs are present, exact', () => {
    expect(ACTIVE_SQL).toContain('ADD CONSTRAINT import_batches_dataset_type_requires_source_system_check CHECK (dataset_type_id IS NULL OR source_system_id IS NOT NULL)')
    expect(ACTIVE_SQL).toContain('ADD CONSTRAINT import_batches_schema_version_requires_dataset_type_check CHECK (source_schema_version_id IS NULL OR dataset_type_id IS NOT NULL)')
    // ensure_fk's own drift check still requires MATCH SIMPLE; the CHECKs,
    // not MATCH FULL, are what close the NULL-skip hole.
    expect(DDL_SQL).not.toMatch(/MATCH FULL/i)
  })

  it('ALTERs on import_batches are exactly the two columns, two CHECKs and two FKs', () => {
    const alters = ACTIVE_SQL.match(/ALTER TABLE public\.import_batches [^']*/g) ?? []
    expect(alters.map(a => a.replace(/^ALTER TABLE public\.import_batches /, '').split(' ').slice(0, 3).join(' ')).sort()).toEqual([
      'ADD COLUMN dataset_type_id',
      'ADD COLUMN source_schema_version_id',
      'ADD CONSTRAINT import_batches_dataset_type_fkey',
      'ADD CONSTRAINT import_batches_dataset_type_requires_source_system_check',
      'ADD CONSTRAINT import_batches_schema_version_requires_dataset_type_check',
      'ADD CONSTRAINT import_batches_source_schema_version_fkey',
    ])
  })

  it('never ALTERs any other pre-existing table (source_systems, source_mappings, mapping_versions, uploads, …)', () => {
    const touched = new Set([...ACTIVE_SQL.matchAll(/ALTER TABLE public\.(\w+)/g)].map(m => m[1]))
    for (const t of touched) expect([...NEW_TABLES, 'import_batches'], t).toContain(t)
  })

  it('contains no UPDATE / DELETE / INSERT / DROP / TRUNCATE / ALTER COLUMN / RENAME outside comments', () => {
    expect(ACTIVE_SQL).not.toMatch(/\bUPDATE\s+(public\.)?\w+\s+SET\b/i)
    expect(ACTIVE_SQL).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(ACTIVE_SQL).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(ACTIVE_SQL).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)\b/i)
    expect(ACTIVE_SQL).not.toMatch(/\bTRUNCATE\b/i)
    expect(ACTIVE_SQL).not.toMatch(/\bALTER\s+COLUMN\b/i)
    expect(ACTIVE_SQL).not.toMatch(/\bRENAME\b/i)
    expect(DDL_SQL).not.toMatch(/NOT VALID/i)
  })

  it('every ADD COLUMN / ADD CONSTRAINT is routed through an ensure_*() helper (never a bare top-level statement)', () => {
    expect(ACTIVE_SQL.match(/^ALTER TABLE public\.\w+ ADD (COLUMN|CONSTRAINT)/gm) ?? []).toHaveLength(0)
    expect(ACTIVE_SQL.match(/^CREATE INDEX/gm) ?? []).toHaveLength(0)
  })

  it('the rollback block is comment-only and truthfully warns it is only safe before meaningful references exist', () => {
    const rollback = SQL.slice(SQL.indexOf('-- Rollback (manual, NOT executed'))
    for (const line of rollback.split('\n').filter(l => l.trim())) expect(line.trim().startsWith('--'), line).toBe(true)
    expect(rollback).toMatch(/only safe BEFORE any meaningful reference\s*\n--\s*exists/)
    expect(rollback).toContain('DROP CONSTRAINT IF EXISTS worksheet_mapping_profiles_active_version_fkey')
    // FKs pointing INTO a table are dropped before that table is dropped.
    expect(rollback.indexOf('import_batches_source_schema_version_fkey')).toBeLessThan(rollback.indexOf('DROP TABLE IF EXISTS public.source_schema_versions'))
    expect(rollback.indexOf('import_batches_dataset_type_fkey')).toBeLessThan(rollback.indexOf('DROP TABLE IF EXISTS public.dataset_types'))
  })
})

// ── Separation from the existing Illegal-Dumping mapping model ────────
describe('6.2D3A — mapping profile is separate from SourceMapping/MappingVersion', () => {
  it('no new model references SourceMapping/MappingVersion/mapping_document', () => {
    for (const model of Object.keys(NEW_MODELS)) {
      expect(modelCode(model), model).not.toMatch(/\bSourceMapping\b|\bMappingVersion\b|mapping_document|mapping_version_id|source_mapping_id/)
    }
  })

  it('the migration never references source_mappings/mapping_versions/uploads in active SQL', () => {
    expect(ACTIVE_SQL).not.toMatch(/\bsource_mappings\b|\bmapping_versions\b|\bmapping_document\b|public\.uploads\b/)
  })

  it('SourceMapping and MappingVersion keep exactly their 5B.1 scalar fields and gain no new relation', () => {
    expect(scalarFields('SourceMapping')).toEqual(['id', 'organisation_id', 'source_system_id', 'name', 'active', 'active_mapping_version_id', 'created_by', 'created_at', 'updated_at'])
    expect(scalarFields('MappingVersion')).toEqual(['id', 'organisation_id', 'source_mapping_id', 'version_number', 'mapping_document', 'created_by', 'created_at'])
    for (const model of ['SourceMapping', 'MappingVersion']) {
      expect(modelCode(model)).not.toMatch(/DatasetType|SourceSchema|WorksheetMappingProfile/)
    }
  })

  it('the Illegal Dumping MappingDocument / canonical-target contract is untouched', () => {
    const doc = readSource('lib/data-hub/sourceMapping/mappingDocument.ts')
    expect(doc).toContain('export const CANONICAL_TARGET_FIELDS: readonly string[] = ILLEGAL_DUMPING_KNOWN_HEADERS;')
    expect(doc).toMatch(/export interface MappingDocument \{\n\s*fields: Record<string, string>;\n\}/)
    expect(doc).not.toMatch(/profile|DatasetType|SourceSchema|disposition/i)
  })
})

// ── Runtime boundary: nothing consumes the new schema; XLSX stays disabled ──
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('6.2D3A — no runtime consumer; XLSX mapping/confirm/import remain disabled', () => {
  const runtimeFiles = ['app', 'lib', 'modules', 'components']
    .map(d => path.join(REPO_ROOT, d))
    .filter(d => fs.existsSync(d))
    .flatMap(d => walk(d))

  it('no app/lib/modules/components source references the new Prisma delegates, tables or lineage columns (no API/service/admin UI in D3A)', () => {
    expect(runtimeFiles.length).toBeGreaterThan(50)
    const forbidden = /\.(datasetType|sourceSchemaVersion|sourceSchemaWorksheet|sourceSchemaColumn|worksheetMappingProfile|worksheetMappingProfileVersion)\b|\b(dataset_types|source_schema_versions|source_schema_worksheets|source_schema_columns|worksheet_mapping_profiles|worksheet_mapping_profile_versions|dataset_type_id|source_schema_version_id|active_profile_version_id|profile_document)\b|\b(DatasetType|SourceSchemaVersion|SourceSchemaWorksheet|SourceSchemaColumn|WorksheetMappingProfile|WorksheetMappingProfileVersion)\b/
    const offenders = runtimeFiles.filter(f => forbidden.test(fs.readFileSync(f, 'utf-8'))).map(f => path.relative(REPO_ROOT, f))
    expect(offenders).toEqual([])
  })

  it('confirmWorksheet / selectWorksheetMapping / previewXlsxWorksheet import nothing new', () => {
    for (const rel of [
      'lib/data-hub/importBatch/confirmWorksheet.ts',
      'lib/data-hub/importBatch/selectWorksheetMapping.ts',
      'lib/data-hub/importBatch/previewXlsxWorksheet.ts',
      'lib/data-hub/importBatch/previewDataHubWorksheet.ts',
    ]) {
      const src = readSource(rel)
      expect(src, rel).not.toMatch(/profile|DatasetType|dataset_type|SourceSchema|source_schema/i)
    }
  })

  it('selectWorksheetMapping keeps its CSV-only format gate (XLSX mapping selection disabled)', () => {
    const src = readSource('lib/data-hub/importBatch/selectWorksheetMapping.ts')
    expect(src).toMatch(/if \(batch\.content_type !== "csv"\) \{\s*\n\s*return fail\("UNSUPPORTED_FORMAT"\);/)
  })

  it('confirmWorksheet keeps its CSV-only format gate (XLSX confirmation/import disabled)', () => {
    const src = readSource('lib/data-hub/importBatch/confirmWorksheet.ts')
    expect(src).toMatch(/if \(batch\.content_type !== "csv"\) \{\s*\n\s*return fail\("UNSUPPORTED_FORMAT"\);/)
    expect(src).not.toMatch(/^import[^;]*(workbookParser|["']xlsx["'])/m)
  })

  it('reporting_period_required is untouched: SourceSystem field unchanged, confirm gate intact, migration never mentions it', () => {
    expect(modelBody('SourceSystem')).toMatch(/\n\s*reporting_period_required Boolean @default\(false\)/)
    const confirm = readSource('lib/data-hub/importBatch/confirmWorksheet.ts')
    expect(confirm).toContain('reporting_period_required === true')
    expect(confirm).toContain('return fail("REPORTING_PERIOD_REQUIRED");')
    expect(SQL).not.toMatch(/reporting_period/i)
  })

  it('the migration never reads a workbook or mentions a specific council/source', () => {
    expect(SQL).not.toMatch(/onkaparinga|technologyone|\.xlsx\b/i)
  })
})

// ── The behavioral proof exists and covers the required cases ─────────
describe('6.2D3A — disposable Postgres harness coverage', () => {
  it('uses a disposable postgres:16-alpine container and applies the real prerequisite scripts', () => {
    expect(HARNESS).toContain('postgres:16-alpine')
    expect(HARNESS).toContain('scripts/create-import-batches.sql')
    expect(HARNESS).toContain('scripts/create-datahub-source-mappings.sql')
    expect(HARNESS).toContain('trap cleanup EXIT')
    // ('vercel-blob' legitimately appears as a seeded storage_provider value.)
    expect(HARNESS).not.toMatch(/DATABASE_URL|neon\.tech|vercel\.app|vercel env|psql -h/i)
  })

  it('covers idempotent rerun, zero backfill, lineage coherence, active-pointer integrity and drift detection', () => {
    for (const marker of [
      'second application succeeds (idempotent rerun',
      'every pre-existing ImportBatch survives with BOTH new lineage columns NULL',
      'ImportBatch dataset_type with NULL source_system rejected',
      'ImportBatch dataset_type from the WRONG source system',
      'ImportBatch schema_version with NULL dataset_type rejected',
      'ImportBatch schema_version from the WRONG dataset_type',
      'valid coherent source -> dataset -> schema chain accepted',
      "active pointer to ANOTHER profile's version",
      "active pointer to ANOTHER tenant's (and profile's) version",
      'hard-deleting a DatasetType referenced ONLY by ImportBatch lineage',
      'hard-deleting a SourceSchemaVersion referenced ONLY by ImportBatch lineage',
      'index definition drift is detected',
      'partial-predicate index drift is detected',
      'index sort-order drift is detected',
      'lineage FK ON DELETE drift (CASCADE) is detected',
      'UNIQUE constraint shape drift is detected',
      'weakened lineage implication CHECK is detected',
      'the commented rollback statements execute cleanly',
    ]) {
      expect(HARNESS, marker).toContain(marker)
    }
  })
})
