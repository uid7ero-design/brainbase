import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Modular Platform Foundation Phase F.4B — capability entitlement schema
// foundation. This suite proves both standalone scripts contain ONLY the
// single approved additive CREATE TABLE each — no seed data, no touch
// to any existing table — and that both Prisma schema files represent
// the approved SQL semantics accurately. Schema preparation only: no
// application code reads or writes these tables yet, and no Production
// DDL has been executed by this task.

const MODULES_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/create-modules.sql')
const ORG_MODULES_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/create-organisation-modules.sql')
const MODULES_SOURCE = fs.readFileSync(MODULES_SCRIPT_PATH, 'utf-8')
const ORG_MODULES_SOURCE = fs.readFileSync(ORG_MODULES_SCRIPT_PATH, 'utf-8')

// SQL uses `--` line comments — strip them so assertions only ever see
// real, executable DDL, never explanatory prose (which legitimately
// mentions words like INSERT/UPDATE/CASCADE/UUID when explaining what
// the script deliberately does NOT do) — the same discipline already
// proven in tests/containment/organisationTimezoneSchema.test.ts.
function stripSqlComments(src: string): string {
  return src.replace(/--.*$/gm, '')
}
const MODULES_EXECUTABLE = stripSqlComments(MODULES_SOURCE)
const MODULES_COMPACT = MODULES_EXECUTABLE.replace(/\s+/g, ' ').trim()
const ORG_MODULES_EXECUTABLE = stripSqlComments(ORG_MODULES_SOURCE)
const ORG_MODULES_COMPACT = ORG_MODULES_EXECUTABLE.replace(/\s+/g, ' ').trim()

describe('scripts/create-modules.sql — capability registry (Phase F.4B)', () => {
  it('contains exactly one executable statement', () => {
    const statements = MODULES_COMPACT.replace(/;\s*$/, '').split(';').map(s => s.trim()).filter(Boolean)
    expect(statements).toHaveLength(1)
  })

  it('targets only public schema table "modules" (CREATE TABLE IF NOT EXISTS)', () => {
    expect(MODULES_COMPACT).toMatch(/CREATE TABLE IF NOT EXISTS modules \(/i)
  })

  it('key is TEXT PRIMARY KEY — no surrogate id column exists', () => {
    expect(MODULES_COMPACT).toMatch(/key\s+TEXT\s+PRIMARY KEY/i)
    expect(MODULES_COMPACT).not.toMatch(/\bid\s+TEXT\b/i)
    expect(MODULES_COMPACT).not.toMatch(/gen_random_uuid/i)
  })

  it('name is required (NOT NULL), description is nullable (no NOT NULL)', () => {
    expect(MODULES_COMPACT).toMatch(/name\s+TEXT\s+NOT NULL/i)
    expect(MODULES_COMPACT).toMatch(/description\s+TEXT,/i)
    expect(MODULES_COMPACT).not.toMatch(/description\s+TEXT\s+NOT NULL/i)
  })

  it('active is BOOLEAN NOT NULL DEFAULT true', () => {
    expect(MODULES_COMPACT).toMatch(/active\s+BOOLEAN\s+NOT NULL\s+DEFAULT true/i)
  })

  it('created_at/updated_at are TIMESTAMPTZ NOT NULL DEFAULT now()', () => {
    expect(MODULES_COMPACT).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT now\(\)/i)
    expect(MODULES_COMPACT).toMatch(/updated_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT now\(\)/i)
  })

  it('contains no seed data — no INSERT statement anywhere, executable or not, since a value literal could hide in either', () => {
    expect(MODULES_SOURCE).not.toMatch(/\bINSERT\b/i)
  })
})

describe('scripts/create-organisation-modules.sql — entitlement + configuration (Phase F.4B)', () => {
  it('contains exactly one executable statement', () => {
    const statements = ORG_MODULES_COMPACT.replace(/;\s*$/, '').split(';').map(s => s.trim()).filter(Boolean)
    expect(statements).toHaveLength(1)
  })

  it('targets only public schema table "organisation_modules" (CREATE TABLE IF NOT EXISTS)', () => {
    expect(ORG_MODULES_COMPACT).toMatch(/CREATE TABLE IF NOT EXISTS organisation_modules \(/i)
  })

  it('id is TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text', () => {
    expect(ORG_MODULES_COMPACT).toMatch(/id\s+TEXT\s+PRIMARY KEY\s+DEFAULT gen_random_uuid\(\)::text/i)
  })

  it('organisation_id and module_key are TEXT NOT NULL (never UUID)', () => {
    expect(ORG_MODULES_COMPACT).toMatch(/organisation_id\s+TEXT\s+NOT NULL/i)
    expect(ORG_MODULES_COMPACT).toMatch(/module_key\s+TEXT\s+NOT NULL/i)
    expect(ORG_MODULES_EXECUTABLE).not.toMatch(/organisation_id\s+UUID/i)
    expect(ORG_MODULES_EXECUTABLE).not.toMatch(/module_id\s+UUID/i)
    expect(ORG_MODULES_EXECUTABLE).not.toContain('module_id')
  })

  it('enabled is BOOLEAN NOT NULL DEFAULT false', () => {
    expect(ORG_MODULES_COMPACT).toMatch(/enabled\s+BOOLEAN\s+NOT NULL\s+DEFAULT false/i)
  })

  it("config is JSONB NOT NULL DEFAULT '{}'", () => {
    expect(ORG_MODULES_COMPACT).toMatch(/config\s+JSONB\s+NOT NULL\s+DEFAULT '\{\}'/i)
  })

  it('created_at/updated_at are TIMESTAMPTZ NOT NULL DEFAULT now()', () => {
    expect(ORG_MODULES_COMPACT).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT now\(\)/i)
    expect(ORG_MODULES_COMPACT).toMatch(/updated_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT now\(\)/i)
  })

  it('organisation_id foreign key targets organisations(id) with ON DELETE RESTRICT — never CASCADE', () => {
    expect(ORG_MODULES_COMPACT).toMatch(/FOREIGN KEY \(organisation_id\) REFERENCES organisations\(id\) ON DELETE RESTRICT/i)
    expect(ORG_MODULES_EXECUTABLE).not.toMatch(/organisation_id\)[^;]*ON DELETE CASCADE/i)
  })

  it('module_key foreign key targets modules(key) with ON DELETE RESTRICT — never CASCADE', () => {
    expect(ORG_MODULES_COMPACT).toMatch(/FOREIGN KEY \(module_key\) REFERENCES modules\(key\) ON DELETE RESTRICT/i)
    expect(ORG_MODULES_EXECUTABLE).not.toMatch(/module_key\)[^;]*ON DELETE CASCADE/i)
  })

  it('UNIQUE (organisation_id, module_key) constraint is present', () => {
    expect(ORG_MODULES_COMPACT).toMatch(/UNIQUE \(organisation_id, module_key\)/i)
  })

  it('contains no seed data or entitlement writes', () => {
    expect(ORG_MODULES_SOURCE).not.toMatch(/\bINSERT\b/i)
  })
})

describe('Global containment — no DML, no destructive DDL, no legacy assumptions, no unrelated schema touched (Phase F.4B)', () => {
  const ALL_EXECUTABLE = [MODULES_EXECUTABLE, ORG_MODULES_EXECUTABLE]

  it('no INSERT/UPDATE/DELETE DML statement in executable SQL — matched by shape (INSERT INTO / UPDATE ... SET / DELETE FROM), not a bare word match, since the scripts\' own comments legitimately say "ON DELETE RESTRICT" and describe DELETE being blocked', () => {
    for (const src of ALL_EXECUTABLE) {
      expect(src).not.toMatch(/INSERT\s+INTO/i)
      expect(src).not.toMatch(/UPDATE\s+\w+\s+SET/i)
      expect(src).not.toMatch(/DELETE\s+FROM/i)
    }
  })

  it('no DROP or TRUNCATE in executable SQL (comment-stripped) — comments are allowed to mention rollback SQL in prose', () => {
    for (const src of ALL_EXECUTABLE) {
      expect(src).not.toMatch(/\bDROP\b/i)
      expect(src).not.toMatch(/\bTRUNCATE\b/i)
    }
  })

  it('no UUID organisation/module FK assumption anywhere (the exact legacy mistake this phase corrects)', () => {
    for (const src of ALL_EXECUTABLE) {
      expect(src).not.toMatch(/organisation_id\s+UUID/i)
      expect(src).not.toMatch(/\bUUID\b/i)
    }
  })

  it('no timezone/organisations.timezone change — Phase F.4B does not touch the Phase F.2 column', () => {
    for (const src of ALL_EXECUTABLE) {
      expect(src).not.toMatch(/\btimezone\b/i)
    }
    expect(ORG_MODULES_EXECUTABLE).not.toMatch(/ALTER TABLE organisations/i)
    expect(MODULES_EXECUTABLE).not.toMatch(/ALTER TABLE organisations/i)
  })

  it('no integration schema — no Microsoft/Google/Instagram/OAuth table or column reference', () => {
    for (const src of ALL_EXECUTABLE) {
      expect(src).not.toMatch(/microsoft|google|instagram|oauth|access_token|refresh_token/i)
    }
  })

  it('no customer business-data table is created — only modules and organisation_modules', () => {
    const createStatements = [...MODULES_EXECUTABLE.matchAll(/CREATE TABLE[^(]*/gi), ...ORG_MODULES_EXECUTABLE.matchAll(/CREATE TABLE[^(]*/gi)]
      .map(m => m[0].replace(/\s+/g, ' ').trim())
    expect(createStatements).toHaveLength(2)
    expect(createStatements.some(s => /modules\b/i.test(s) && !/organisation_modules/i.test(s))).toBe(true)
    expect(createStatements.some(s => /organisation_modules/i.test(s))).toBe(true)
  })

  it('this phase introduces no requireModule()-style server-side enforcement primitive anywhere in the repository (not built until a later, separately-approved phase)', () => {
    // Deliberately scoped to the NEW primitive this phase does not
    // build, not to "organisation_modules" as a bare string — several
    // files already reference that legacy, never-deployed table from
    // before this phase (app/api/me/route.ts, app/api/account/
    // modules/route.ts, the two HLNA agent routes, etc. — fully
    // documented in the Phase F.0/F.4A reports) and would false-
    // positive a broader scan without actually testing anything this
    // phase changed. Whether the diff itself only touches schema-
    // definition files is verified separately via `git diff
    // --name-status` during validation, not inside this unit test.
    const scanDirs = ['app/api', 'lib', 'components']
    const offenders: string[] = []
    for (const dir of scanDirs) {
      const abs = path.resolve(__dirname, '../../', dir)
      if (!fs.existsSync(abs)) continue
      const stack = [abs]
      while (stack.length) {
        const current = stack.pop()!
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name)
          if (entry.isDirectory()) { stack.push(full); continue }
          if (!/\.(ts|tsx)$/.test(entry.name)) continue
          const content = fs.readFileSync(full, 'utf-8')
          if (/requireModule\s*\(|requireCapability\s*\(/.test(content)) offenders.push(full)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('Prisma schema synchronization — PlatformModule/OrganisationModule models (Phase F.4B)', () => {
  const PRISMA_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf-8')
  const BACKEND_PRISMA_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../backend_migration/prisma/schema.prisma'), 'utf-8')

  function modelBody(source: string, modelName: string): string {
    const start = source.indexOf(`model ${modelName} {`)
    expect(start, `expected to find model ${modelName}`).toBeGreaterThan(-1)
    const end = source.indexOf('\n}', start)
    return source.slice(start, end)
  }

  it('the capability model is named PlatformModule, not Module — avoiding the pre-existing waste-domain enum Module collision', () => {
    for (const source of [PRISMA_SOURCE, BACKEND_PRISMA_SOURCE]) {
      expect(source).toContain('enum Module {') // the pre-existing, untouched enum
      expect(source).toContain('model PlatformModule {')
      expect(source).not.toContain('model Module {')
    }
  })

  it('PlatformModule maps to table "modules" and uses key as its primary identity, no surrogate id', () => {
    for (const source of [PRISMA_SOURCE, BACKEND_PRISMA_SOURCE]) {
      const body = modelBody(source, 'PlatformModule')
      expect(body).toMatch(/key\s+String\s+@id/)
      expect(body).not.toMatch(/\bid\s+String\s+@id/)
      expect(source).toMatch(/model PlatformModule \{[\s\S]*?@@map\("modules"\)/)
    }
  })

  it('OrganisationModule uses a DB-generated surrogate id (dbgenerated gen_random_uuid, not an application-side cuid default)', () => {
    for (const source of [PRISMA_SOURCE, BACKEND_PRISMA_SOURCE]) {
      const body = modelBody(source, 'OrganisationModule')
      expect(body).toMatch(/id\s+String\s+@id\s+@default\(dbgenerated\("\(gen_random_uuid\(\)\)::text"\)\)/)
      expect(body).not.toMatch(/@default\(cuid\(\)\)/)
    }
  })

  it('OrganisationModule declares organisation_id/module_key as plain String scalars matching Production-confirmed TEXT, with enabled defaulting false and config defaulting {}', () => {
    for (const source of [PRISMA_SOURCE, BACKEND_PRISMA_SOURCE]) {
      const body = modelBody(source, 'OrganisationModule')
      expect(body).toMatch(/organisation_id\s+String\b/)
      expect(body).toMatch(/module_key\s+String\b/)
      expect(body).toMatch(/enabled\s+Boolean\s+@default\(false\)/)
      expect(body).toMatch(/config\s+Json\s+@default\("\{\}"\)/)
    }
  })

  it('both relations use onDelete: Restrict, matching the locked (not Cascade) FK behaviour', () => {
    for (const source of [PRISMA_SOURCE, BACKEND_PRISMA_SOURCE]) {
      const body = modelBody(source, 'OrganisationModule')
      const restrictCount = (body.match(/onDelete:\s*Restrict/g) ?? []).length
      expect(restrictCount).toBe(2)
      expect(body).not.toMatch(/onDelete:\s*Cascade/)
    }
  })

  it('the UNIQUE(organisation_id, module_key) constraint is represented via @@unique', () => {
    for (const source of [PRISMA_SOURCE, BACKEND_PRISMA_SOURCE]) {
      const body = modelBody(source, 'OrganisationModule')
      expect(body).toMatch(/@@unique\(\[organisation_id, module_key\]\)/)
    }
  })

  it('both new models use @db.Timestamptz(6) for created_at/updated_at, matching the locked TIMESTAMPTZ SQL authority', () => {
    for (const source of [PRISMA_SOURCE, BACKEND_PRISMA_SOURCE]) {
      for (const model of ['PlatformModule', 'OrganisationModule']) {
        const body = modelBody(source, model)
        expect(body).toMatch(/created_at\s+DateTime\s+@default\(now\(\)\)\s+@db\.Timestamptz\(6\)/)
        expect(body).toMatch(/updated_at\s+DateTime\s+@updatedAt\s+@db\.Timestamptz\(6\)/)
      }
    }
  })

  it('existing Organisation model scalar fields (id/name/slug/plan/status/settings/timezone/created_at/updated_at) are unchanged — only a new relation field and the two new models were added', () => {
    for (const source of [PRISMA_SOURCE, BACKEND_PRISMA_SOURCE]) {
      const body = modelBody(source, 'Organisation')
      expect(body).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/)
      expect(body).toMatch(/plan\s+Plan\s+@default\(TRIAL\)/)
      expect(body).toMatch(/status\s+OrgStatus\s+@default\(ACTIVE\)/)
      expect(body).toMatch(/settings\s+Json\s+@default\("\{\}"\)/)
      expect(body).toMatch(/timezone\s+String\?/)
      expect(body).toMatch(/organisation_modules\s+OrganisationModule\[\]/)
    }
  })
})
