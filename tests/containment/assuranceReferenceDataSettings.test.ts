import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  ASSET_TYPES, EXTERNAL_ORGANISATION_ROLES, LOCATION_TYPES, REFERENCE_CONFIG, REFERENCE_KINDS, REFERENCE_STATUSES,
  normaliseReference, parseReferenceInput, referenceConfigForSegment, referenceProblem, referenceValueLabel,
} from '@/lib/referenceData/rules'

// Settings → Reference data — structural guards (this repo's containment-test
// convention). Behaviour is proven against real Postgres in
// scripts/tests/assuranceReferenceDataSettings.integration.test.ts.

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name)
    if (e.isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

const SEGMENTS = [['locations', 'location'], ['assets', 'asset'], ['external-organisations', 'external_organisation']] as const
const ROUTES = SEGMENTS.flatMap(([seg, kind]) => [
  [`app/api/assurance/reference-data/${seg}/route.ts`, 'assurancePost', 'createReferenceRecord', kind],
  [`app/api/assurance/reference-data/${seg}/[id]/route.ts`, 'assurancePostWithId', 'updateReferenceRecord', kind],
  [`app/api/assurance/reference-data/${seg}/[id]/deactivate/route.ts`, 'assurancePostWithId', 'deactivateReferenceRecord', kind],
  [`app/api/assurance/reference-data/${seg}/[id]/reactivate/route.ts`, 'assurancePostWithId', 'reactivateReferenceRecord', kind],
])
const SHARED_A01B = read('scripts/create-shared-foundations-a01b.sql')

describe('rules (pure)', () => {
  it('allowed values mirror the A0.1B CHECK constraints exactly', () => {
    const inList = (constraint: string) => {
      const m = SHARED_A01B.match(new RegExp(`${constraint}\\s+CHECK \\(\\s*\\w+ IN \\(([^)]*)\\)`))
      expect(m, constraint).toBeTruthy()
      return m![1].split(',').map(s => s.trim().replace(/'/g, ''))
    }
    expect([...LOCATION_TYPES]).toEqual(inList('locations_type_check'))
    expect([...ASSET_TYPES]).toEqual(inList('assets_type_check'))
    expect([...EXTERNAL_ORGANISATION_ROLES]).toEqual(inList('external_organisation_roles_role_check'))
    expect([...REFERENCE_STATUSES.location]).toEqual(inList('locations_status_check'))
    expect([...REFERENCE_STATUSES.asset]).toEqual(inList('assets_status_check'))
    expect([...REFERENCE_STATUSES.external_organisation]).toEqual(inList('external_organisations_status_check'))
  })
  it('normalises and validates references', () => {
    expect(normaliseReference('  depot-01 ')).toBe('DEPOT-01')
    expect(normaliseReference(7)).toBe('')
    for (const ok of ['DEPOT-01', 'TRUCK.001', 'A/B_C', '7']) expect(referenceProblem(ok), ok).toBeNull()
    expect(referenceProblem('')).toMatch(/required/)
    expect(referenceProblem('-X')).toMatch(/start with a letter or number/)
    expect(referenceProblem('A B')).toMatch(/start with a letter or number/)
    expect(referenceProblem('X'.repeat(41))).toMatch(/at most 40/)
  })
  it('parses create bodies and returns only supplied keys on update', () => {
    const c = parseReferenceInput('location', { reference: 'd1', name: ' Depot ', locationType: 'DEPOT', countryCode: 'au', suburb: '  ' }, true)
    expect(c).toEqual({ ok: true, values: { reference: 'D1', name: 'Depot', fields: {
      locationType: 'DEPOT', description: null, addressLine1: null, addressLine2: null, suburb: null, state: null, postcode: null, countryCode: 'AU',
    } } })
    const u = parseReferenceInput('asset', { description: 'x' }, false)
    expect(u).toEqual({ ok: true, values: { name: '', fields: { description: 'x' } } })
    const r = parseReferenceInput('external_organisation', { reference: 'X', name: 'X', roles: ['SUPPLIER', 'CONTRACTOR', 'SUPPLIER'] }, true)
    expect(r.ok && r.values.fields.roles).toEqual(['CONTRACTOR', 'SUPPLIER'])
    expect(parseReferenceInput('external_organisation', { reference: 'X', name: 'X', roles: 'SUPPLIER' }, true)).toMatchObject({ ok: false })
    expect(parseReferenceInput('asset', { reference: 'X', name: 'X', assetType: 'VEHICLE', description: 'y'.repeat(1001) }, true)).toMatchObject({ ok: false, error: expect.stringMatching(/1000 characters/) })
  })
  it('labels, segments and terminology', () => {
    expect(referenceValueLabel('WORK_AREA')).toBe('Work area')
    expect(referenceConfigForSegment('external-organisations')?.kind).toBe('external_organisation')
    expect(referenceConfigForSegment('contractors')).toBeNull()
    expect(REFERENCE_KINDS.map(k => REFERENCE_CONFIG[k].plural)).toEqual(['Locations', 'Assets', 'External organisations'])
    expect(REFERENCE_CONFIG.location.emptyMessage).toBe('No locations have been configured for this organisation.')
    expect(REFERENCE_CONFIG.asset.emptyMessage).toBe('No assets are available.')
    expect(REFERENCE_CONFIG.external_organisation.emptyMessage).toBe('No external organisations have been configured.')
  })
  it('rules module is client-safe (zero imports)', () => {
    expect(stripComments(read('lib/referenceData/rules.ts'))).not.toMatch(/^\s*import\s/m)
  })
})

describe('routes and permissions', () => {
  it('every reference-data route is a POST from the administer factory, with no other methods and no posted organisation', () => {
    const found = walk('app/api/assurance/reference-data').filter(f => f.endsWith('route.ts')).sort()
    expect(found).toEqual(ROUTES.map(r => r[0]).sort())
    for (const [file, factory, fn, kind] of ROUTES) {
      const src = stripComments(read(file))
      expect(src, file).toMatch(new RegExp(`export const POST = ${factory}\\('administer', \\([^)]*\\) => ${fn}\\(referenceActor\\(viewer\\), '${kind}'`))
      expect(src, file).not.toMatch(/export (const|async function|function) (GET|PUT|PATCH|DELETE)/)
      expect(src, file).not.toMatch(/organisation_?[iI]d/)
    }
  })
  it('the shared service re-checks the organisation-admin role on every mutation, independent of Assurance roles', () => {
    const src = stripComments(read('lib/referenceData/service.ts'))
    expect(src).toMatch(/export const REFERENCE_DATA_ADMIN_ROLE: Role = 'admin'/)
    for (const fn of ['createReferenceRecord', 'updateReferenceRecord', 'setStatus']) {
      const body = src.slice(src.indexOf(`function ${fn}(`))
      expect(body.slice(0, 400), fn).toMatch(/requireAdmin\(actor, kind\)/)
    }
    expect(src).not.toMatch(/from '@\/lib\/assurance\/(policy|authorize|access)'/)
  })
})

describe('tenant scoping, no delete, sql.unsafe allow-list', () => {
  const src = stripComments(read('lib/referenceData/service.ts'))
  it('no delete path and no hard DELETE statements', () => {
    expect(src).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(src).not.toMatch(/export (async )?function \w*(delete|remove|purge)\w*/i)
    expect(src).not.toMatch(/ON DELETE CASCADE|CASCADE/i)
  })
  it('organisation always comes from the actor, never the body', () => {
    expect(src).not.toMatch(/raw\.organisation/i)
    expect(src).not.toMatch(/raw\[['"]organisation/i)
    // Every statement against a reference table is scoped by organisation_id.
    const statements = [...src.matchAll(/(UPDATE|FROM) \$\{u\(spec\.table\)\}( r)?\b[\s\S]{0,400}?WHERE[^\n]*/g)]
    expect(statements.length).toBeGreaterThanOrEqual(6)
    for (const m of statements) {
      expect(m[0], m[0].slice(0, 80)).toMatch(/organisation_id = \$\{(actor\.organisationId|org)\}/)
    }
  })
  it('sql.unsafe is reached only through the fixed TABLES allow-list', () => {
    expect(src.match(/sql\.unsafe\(/g)).toHaveLength(1)
    expect(src).toMatch(/const u = \(s: string\) => sql\.unsafe\(s\)/)
    const all = src.match(/\bu\(/g)?.length ?? 0
    const allowed = src.match(/\bu\((spec\.(table|referenceColumn|typeColumn|usage)|columnList\(spec\)|recordDef\(spec\)|selectCols\(spec, 'x'\)|alias|gate)\)/g)?.length ?? 0
    expect(all).toBeGreaterThan(10)
    expect(allowed).toBe(all) // every u(...) call takes a TABLES-derived name or an internal alias
    expect(src).toMatch(/const u = \(s: string\) => sql\.unsafe\(s\)/)
  })
  it('every mutation writes its audit row in the same guarded statement, with the established naming', () => {
    expect(src.match(/INSERT INTO audit_logs/g)?.length).toBe(3)
    expect(src).toMatch(/\$\{`\$\{spec\.resourceType\}\.created`\}/)
    expect(src).toMatch(/\$\{`\$\{spec\.resourceType\}\.updated`\}/)
    expect(src).toMatch(/\$\{spec\.resourceType\}\.\$\{activate \? 'reactivated' : 'deactivated'\}/)
    expect(src.match(/FOR UPDATE/g)?.length).toBe(2)
  })
  it('no new tables or migrations: only the existing A0.1B tables are touched', () => {
    expect(src).not.toMatch(/CREATE TABLE|ALTER TABLE/i)
    expect(src).toMatch(/table: 'locations'/)
    expect(src).toMatch(/table: 'assets'/)
    expect(src).toMatch(/table: 'external_organisations'/)
    const all = walk('lib').concat(walk('app')).filter(f => /\.(ts|tsx)$/.test(f)).map(read).join('\n')
    expect(all).not.toMatch(/assurance_(locations|assets|contractors|external_organisations)\b/)
  })
})

describe('Assurance consumption rules', () => {
  const lookups = stripComments(read('lib/assurance/lookups.ts'))
  it('new-record selectors default to ACTIVE only; inactive only via an explicit filter scope', () => {
    for (const fn of ['listLocationOptions', 'listAssetOptions', 'listExternalOrganisationOptions']) {
      expect(lookups).toMatch(new RegExp(`${fn}\\(organisationId: string, opts: OptionScope = \\{\\}\\)`))
    }
    expect(lookups.match(/\(\$\{all\}::boolean OR status = 'ACTIVE'\)/g)).toHaveLength(3)
    for (const page of ['incidents/new', 'inspections/new', 'audits/new']) {
      expect(read(`app/assurance/${page}/page.tsx`), page).not.toMatch(/includeInactive/)
    }
    for (const page of ['incidents', 'inspections', 'audits']) {
      expect(read(`app/assurance/${page}/page.tsx`), page).toMatch(/includeInactive: true/)
    }
  })
  it('create-time validation refuses inactive locations, assets and external organisations', () => {
    expect(lookups).toMatch(/active\('Location', sql`SELECT status FROM locations/)
    expect(lookups).toMatch(/active\('Asset', sql`SELECT status FROM assets/)
    expect(lookups).toMatch(/active\('External organisation', sql`SELECT status FROM external_organisations/)
    expect(lookups).toMatch(/is inactive and cannot be used on new records/)
  })
  it('the client manager imports only client-safe modules (no server bundle leak)', () => {
    const src = read('app/assurance/_components/ReferenceDataManager.tsx')
    expect(src.startsWith("'use client';")).toBe(true)
    const imports = [...src.matchAll(/from '([^']+)'/g)].map(m => m[1])
    expect(imports.filter(i => /lib\/(db|referenceData\/service|assurance\/(?!.*Rules))/.test(i))).toEqual([])
    expect(imports).toContain('@/lib/referenceData/rules')
    expect(src).not.toMatch(/>\s*Delete\s*</)
  })
})

describe('help and navigation', () => {
  it('reference data has a help topic and a registered work instruction', () => {
    expect(read('lib/assurance/help/topics.ts')).toMatch(/'reference-data': \{ slug: 'manage-reference-data'/)
    expect(read('lib/assurance/help/registry.ts')).toMatch(/slug: 'manage-reference-data', file: 'work-instructions\/12-manage-reference-data\.md'/)
    expect(fs.existsSync(path.join(ROOT, 'docs/assurance/work-instructions/12-manage-reference-data.md'))).toBe(true)
  })
  it('the admin guide no longer says Assurance has no screens for reference data', () => {
    const guide = read('docs/assurance/admin-guide.md')
    expect(guide).not.toMatch(/has no screens for maintaining locations/)
    expect(guide).not.toMatch(/No Assurance screens for locations, assets or external organisations/)
    expect(guide).toMatch(/### Reference data: locations, assets and external organisations/)
  })
})
