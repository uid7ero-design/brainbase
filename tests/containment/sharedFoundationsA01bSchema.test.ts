import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

// BrainBase A0.1B — static containment tests for the shared platform
// identity foundation migration. Behavioral database guarantees are proven
// separately by scripts/tests/verify-shared-foundations-a01b-migration.sh
// against real disposable PostgreSQL 16.

const MIGRATION = 'scripts/create-shared-foundations-a01b.sql'

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf8')
}

function stripLineComments(sql: string): string {
  return sql.replace(/--.*$/gm, '')
}

function tableBody(source: string, tableName: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS ${tableName} (`
  const start = source.indexOf(marker)
  expect(start, `expected ${marker}`).toBeGreaterThanOrEqual(0)

  // All four A0.1B tables are followed by an index/comment section and use
  // ordinary CREATE TABLE (...) syntax with no nested ); token in strings.
  const end = source.indexOf('\n);', start)
  expect(end, `expected closing ); for ${tableName}`).toBeGreaterThan(start)
  return source.slice(start, end + 3)
}

const raw = readSource(MIGRATION)
const source = stripLineComments(raw)

const externalOrganisations = tableBody(source, 'external_organisations')
const externalOrganisationRoles = tableBody(source, 'external_organisation_roles')
const assets = tableBody(source, 'assets')
const locations = tableBody(source, 'locations')

describe('A0.1B — migration boundary', () => {
  it('creates exactly the four frozen shared-platform tables', () => {
    const tables = [...source.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)/gi)]
      .map(match => match[1])
      .sort()

    expect(tables).toEqual([
      'assets',
      'external_organisation_roles',
      'external_organisations',
      'locations',
    ])
  })

  it('creates no assurance_* workflow table', () => {
    expect(source).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+assurance_/i)
  })

  it('does not alter existing tables or perform data-changing/destructive SQL', () => {
    expect(source).not.toMatch(/\bALTER\s+TABLE\b/i)
    expect(source).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(source).not.toMatch(/\bUPDATE\s+[a-z_]/i)
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(source).not.toMatch(/\bTRUNCATE\b/i)
    expect(source).not.toMatch(/\bDROP\s+(TABLE|INDEX|CONSTRAINT|COLUMN)\b/i)
  })

  it('introduces no trigger, rule, function, procedure, grant, or revoke', () => {
    expect(source).not.toMatch(/\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i)
    expect(source).not.toMatch(/\bCREATE\s+(OR\s+REPLACE\s+)?RULE\b/i)
    expect(source).not.toMatch(/\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i)
    expect(source).not.toMatch(/\bCREATE\s+(OR\s+REPLACE\s+)?PROCEDURE\b/i)
    expect(source).not.toMatch(/\bGRANT\b/i)
    expect(source).not.toMatch(/\bREVOKE\b/i)
  })

  it('uses IF NOT EXISTS on every CREATE TABLE and CREATE INDEX', () => {
    expect(source.match(/CREATE TABLE(?! IF NOT EXISTS)/gi) ?? []).toHaveLength(0)
    expect(source.match(/CREATE (?:UNIQUE )?INDEX(?! IF NOT EXISTS)/gi) ?? []).toHaveLength(0)
  })

  it('preflights organisations, users, organiser_items, gen_random_uuid and the exact A0.1A anchor', () => {
    expect(source).toContain("to_regclass('public.organisations')")
    expect(source).toContain("to_regclass('public.users')")
    expect(source).toContain("to_regclass('public.organiser_items')")
    expect(source).toContain("to_regprocedure('gen_random_uuid()')")
    expect(source).toMatch(/conname = 'organiser_items_organisation_id_id_key'/)
    expect(source).toContain("UNIQUE (organisation_id, id)")
  })
})

describe('A0.1B — external_organisations', () => {
  it('has a tenant anchor, tenant-scoped reference key, and explicit parent FKs', () => {
    expect(externalOrganisations).toMatch(/CONSTRAINT external_organisations_organisation_id_fkey\s+FOREIGN KEY \(organisation_id\)\s+REFERENCES organisations\(id\)/)
    expect(externalOrganisations).toMatch(/CONSTRAINT external_organisations_created_by_fkey\s+FOREIGN KEY \(created_by\)\s+REFERENCES users\(id\)/)
    expect(externalOrganisations).toMatch(/CONSTRAINT external_organisations_organisation_id_id_key\s+UNIQUE \(organisation_id, id\)/)
    expect(externalOrganisations).toMatch(/CONSTRAINT external_organisations_org_reference_key\s+UNIQUE \(organisation_id, reference\)/)
  })

  it('does not collapse multi-role identity into one organisation type column', () => {
    expect(externalOrganisations).not.toMatch(/external_organisation_type|organisation_type|contractor_type/i)
  })

  it('locks the lifecycle vocabulary and rejects blank identity values', () => {
    expect(externalOrganisations).toMatch(/status IN \('ACTIVE', 'INACTIVE', 'ARCHIVED'\)/)
    expect(externalOrganisations).toMatch(/CHECK \(btrim\(reference\) <> ''\)/)
    expect(externalOrganisations).toMatch(/CHECK \(btrim\(name\) <> ''\)/)
    expect(externalOrganisations).toMatch(/business_identifier IS NULL OR btrim\(business_identifier\) <> ''/)
  })

  it('keeps business_identifier non-unique', () => {
    expect(externalOrganisations).not.toMatch(/UNIQUE \([^)]*business_identifier/)
  })
})

describe('A0.1B — external_organisation_roles', () => {
  it('tenant-safely references the canonical external organisation', () => {
    expect(externalOrganisationRoles).toMatch(
      /CONSTRAINT external_organisation_roles_org_external_org_fkey\s+FOREIGN KEY \(organisation_id, external_organisation_id\)\s+REFERENCES external_organisations \(organisation_id, id\)/
    )
  })

  it('permits many roles per organisation but only one durable row per role assignment', () => {
    expect(externalOrganisationRoles).toMatch(
      /UNIQUE \(organisation_id, external_organisation_id, role\)/
    )
  })

  it('contains the complete frozen A0.1B role vocabulary', () => {
    for (const role of [
      'CONTRACTOR',
      'SUBCONTRACTOR',
      'SUPPLIER',
      'SERVICE_PROVIDER',
      'CONSULTANT',
      'CUSTOMER',
      'PARTNER',
      'INSURER',
      'OTHER',
    ]) {
      expect(externalOrganisationRoles).toContain(`'${role}'`)
    }
  })
})

describe('A0.1B — assets', () => {
  it('is identity-only and tenant-anchored', () => {
    expect(assets).toMatch(/UNIQUE \(organisation_id, id\)/)
    expect(assets).toMatch(/UNIQUE \(organisation_id, asset_reference\)/)
    expect(assets).not.toMatch(/maintenance|depreciation|odometer|service_due|inspection_history|purchase_price/i)
  })

  it('locks asset type and status vocabulary', () => {
    for (const type of [
      'VEHICLE', 'PLANT', 'EQUIPMENT', 'FACILITY', 'BUILDING',
      'INFRASTRUCTURE', 'DEVICE', 'OTHER',
    ]) {
      expect(assets).toContain(`'${type}'`)
    }
    expect(assets).toMatch(/status IN \('ACTIVE', 'INACTIVE', 'RETIRED', 'ARCHIVED'\)/)
  })

  it('keeps external_identifier non-unique', () => {
    expect(assets).not.toMatch(/UNIQUE \([^)]*external_identifier/)
  })
})

describe('A0.1B — locations', () => {
  it('is tenant-anchored and uses a tenant-scoped reference', () => {
    expect(locations).toMatch(/UNIQUE \(organisation_id, id\)/)
    expect(locations).toMatch(/UNIQUE \(organisation_id, location_reference\)/)
  })

  it('uses NUMERIC(9,6) coordinate pairs with valid ranges', () => {
    expect(locations).toMatch(/latitude\s+NUMERIC\(9,6\)/)
    expect(locations).toMatch(/longitude\s+NUMERIC\(9,6\)/)
    expect(locations).toMatch(/latitude BETWEEN -90 AND 90/)
    expect(locations).toMatch(/longitude BETWEEN -180 AND 180/)
    expect(locations).toMatch(/latitude IS NULL AND longitude IS NULL[\s\S]*latitude IS NOT NULL AND longitude IS NOT NULL/)
  })

  it('requires a two-letter uppercase country code when supplied', () => {
    expect(locations).toMatch(/country_code ~ '\^\[A-Z\]\{2\}\$'/)
  })

  it('does not introduce PostGIS/spatial behavior in this identity phase', () => {
    expect(source).not.toMatch(/CREATE EXTENSION[^;]*postgis/i)
    expect(locations).not.toMatch(/geometry|geography|ST_/i)
    expect(source).not.toMatch(/USING\s+GIST/i)
  })
})

describe('A0.1B — required indexes', () => {
  it('has the frozen external-organisation indexes', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_external_organisations_org_status\s+ON external_organisations \(organisation_id, status\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_external_organisations_org_name\s+ON external_organisations \(organisation_id, name\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_external_organisations_org_business_identifier\s+ON external_organisations \(organisation_id, business_identifier\)\s+WHERE business_identifier IS NOT NULL/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_external_organisation_roles_org_role_active\s+ON external_organisation_roles \(organisation_id, role, active\)/)
  })

  it('has the frozen asset and location indexes', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_assets_org_type_status\s+ON assets \(organisation_id, asset_type, status\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_assets_org_name\s+ON assets \(organisation_id, name\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_assets_org_external_identifier\s+ON assets \(organisation_id, external_identifier\)\s+WHERE external_identifier IS NOT NULL/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_locations_org_type_status\s+ON locations \(organisation_id, location_type, status\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_locations_org_name\s+ON locations \(organisation_id, name\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_locations_org_suburb\s+ON locations \(organisation_id, suburb\)\s+WHERE suburb IS NOT NULL/)
  })
})

describe('A0.1B — fail-loud drift protection', () => {
  it('post-checks all four table column shapes', () => {
    for (const table of [
      'external_organisations',
      'external_organisation_roles',
      'assets',
      'locations',
    ]) {
      expect(source).toContain(`A0.1B schema drift: ${table} column shape`)
    }
  })

  it('post-checks tenant anchors and important composite FK/reference keys', () => {
    expect(source).toContain('external_organisations tenant anchor')
    expect(source).toContain('external_organisation_roles tenant anchor')
    expect(source).toContain('external_organisation_roles tenant FK')
    expect(source).toContain('assets tenant anchor')
    expect(source).toContain('locations tenant anchor')
  })

  it('post-checks every required explicit index name', () => {
    for (const indexName of [
      'idx_external_organisations_org_status',
      'idx_external_organisations_org_name',
      'idx_external_organisations_org_business_identifier',
      'idx_external_organisation_roles_org_role_active',
      'idx_assets_org_type_status',
      'idx_assets_org_name',
      'idx_assets_org_external_identifier',
      'idx_locations_org_type_status',
      'idx_locations_org_name',
      'idx_locations_org_suburb',
    ]) {
      expect(source).toContain(indexName)
    }
  })
})
