import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Modular Platform Foundation Phase F.6B — initial capability registry
// seed. This suite proves scripts/seed-modules-registry.sql inserts
// ONLY the two Phase F.6A-approved capability keys (crm, organiser)
// into public.modules, grants no organisation any entitlement, is
// idempotent, and contains no seed of any other capability, integration,
// or legacy concept. No Production DDL/DML has been executed by this
// task — registry seeding, not entitlement, and not yet run anywhere.

const SEED_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/seed-modules-registry.sql')

// SQL uses `--` line comments — strip them so assertions only ever see
// real, executable SQL, never explanatory prose (which legitimately
// mentions words like organisation_modules/DELETE/UUID/plan when
// explaining what this script deliberately does NOT do) — the same
// discipline already proven in organisationTimezoneSchema.test.ts and
// capabilitySchemaFoundation.test.ts.
function stripSqlComments(src: string): string {
  return src.replace(/--.*$/gm, '')
}

describe('scripts/seed-modules-registry.sql — initial capability registry (Phase F.6B)', () => {
  it('1. the seed script exists', () => {
    expect(fs.existsSync(SEED_SCRIPT_PATH)).toBe(true)
  })

  const SOURCE = fs.readFileSync(SEED_SCRIPT_PATH, 'utf-8')
  const EXECUTABLE = stripSqlComments(SOURCE)
  const COMPACT = EXECUTABLE.replace(/\s+/g, ' ').trim()

  it('2. targets only the modules registry — a single INSERT INTO modules, no other table', () => {
    const insertTargets = [...EXECUTABLE.matchAll(/INSERT\s+INTO\s+(\w+)/gi)].map(m => m[1])
    expect(insertTargets).toEqual(['modules'])
  })

  it('contains exactly one executable statement', () => {
    const statements = COMPACT.replace(/;\s*$/, '').split(';').map(s => s.trim()).filter(Boolean)
    expect(statements).toHaveLength(1)
  })

  function extractRows(): string[] {
    const match = COMPACT.match(/VALUES\s*(.+?)\s*ON CONFLICT/i)
    expect(match, 'expected a VALUES (...) clause before ON CONFLICT').not.toBeNull()
    const valuesBlock = match![1]
    // Split top-level "(...)" row tuples — none of the actual seed
    // values contain a literal ')' or ',' inside a quoted string here,
    // so a straightforward paren-tuple match is sufficient and safer
    // than a naive comma split (which would break on ('crm', 'CRM', ...)).
    return [...valuesBlock.matchAll(/\(([^()]*)\)/g)].map(m => m[1])
  }

  it('3. exactly the two approved keys exist: crm and organiser', () => {
    const rows = extractRows()
    const keys = rows.map(r => r.split(',')[0].trim())
    expect(keys).toEqual(["'crm'", "'organiser'"])
  })

  it('4. no third capability key is seeded — exactly two rows', () => {
    expect(extractRows()).toHaveLength(2)
  })

  it('5. both entries explicitly set active = true', () => {
    const rows = extractRows()
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.trim()).toMatch(/,\s*true\s*$/i)
    }
  })

  it('6. both entries have a non-empty name', () => {
    const rows = extractRows()
    // row shape: 'key', 'name', 'description', active
    for (const row of rows) {
      const nameField = row.split("',").slice(1).join("',").split(",")[0]
      expect(nameField.replace(/'/g, '').trim().length).toBeGreaterThan(0)
    }
    expect(COMPACT).toMatch(/'crm',\s*'CRM',/)
    expect(COMPACT).toMatch(/'organiser',\s*'Organiser',/)
  })

  it('7. both entries have a non-empty description', () => {
    expect(COMPACT).toMatch(/'crm',\s*'CRM',\s*'[^']+',\s*true/i)
    expect(COMPACT).toMatch(/'organiser',\s*'Organiser',\s*'[^']+',\s*true/i)
  })

  it('8. the statement is idempotent via ON CONFLICT (key) DO NOTHING', () => {
    expect(COMPACT).toMatch(/ON CONFLICT \(key\) DO NOTHING/i)
  })

  it('9. no organisation_modules INSERT exists', () => {
    expect(EXECUTABLE).not.toMatch(/INSERT\s+INTO\s+organisation_modules/i)
  })

  it('10. no entitlement assignment of any kind exists — no organisation_modules reference anywhere in executable SQL', () => {
    expect(EXECUTABLE).not.toMatch(/organisation_modules/i)
    expect(EXECUTABLE).not.toMatch(/\benabled\b/i)
  })

  it('11. no UPDATE statement exists (matched by shape, not a bare word, since comments may legitimately explain what this script does not do)', () => {
    expect(EXECUTABLE).not.toMatch(/UPDATE\s+\w+\s+SET/i)
  })

  it('12. no DELETE statement exists', () => {
    expect(EXECUTABLE).not.toMatch(/DELETE\s+FROM/i)
  })

  it('13. no destructive DDL or schema mutation exists (DROP/TRUNCATE/ALTER/CREATE)', () => {
    expect(EXECUTABLE).not.toMatch(/\bDROP\b/i)
    expect(EXECUTABLE).not.toMatch(/\bTRUNCATE\b/i)
    expect(EXECUTABLE).not.toMatch(/\bALTER\b/i)
    expect(EXECUTABLE).not.toMatch(/\bCREATE\b/i)
  })

  it('14. no organisation id is embedded anywhere', () => {
    expect(EXECUTABLE).not.toMatch(/organisation_id/i)
    expect(EXECUTABLE).not.toMatch(/\borg[-_]?id\b/i)
  })

  it('15. no UUID assumption exists', () => {
    expect(EXECUTABLE).not.toMatch(/\bUUID\b/i)
    expect(EXECUTABLE).not.toMatch(/::uuid/i)
    expect(EXECUTABLE).not.toMatch(/gen_random_uuid/i)
  })

  it('16. no organisations.plan reference exists', () => {
    expect(EXECUTABLE).not.toMatch(/organisations?\.plan/i)
    expect(EXECUTABLE).not.toMatch(/\bplan\b/i)
  })

  it('17. no Microsoft/Google/Instagram/integration-provider concept exists', () => {
    expect(EXECUTABLE).not.toMatch(/microsoft|google|instagram|integration|oauth|access_token|refresh_token/i)
  })

  it('18. no other capability is accidentally registered (bookings/tennis/events/ticketing/waste/HLNA/uploads/etc.)', () => {
    const forbiddenKeys = [
      'bookings', 'tennis', 'events', 'ticketing', 'waste', 'hlna', 'chat',
      'uploads', 'imports', 'founder', 'admin', 'reporting', 'reports',
      'dashboard', 'sessions',
    ]
    for (const key of forbiddenKeys) {
      expect(EXECUTABLE.toLowerCase()).not.toContain(`'${key}'`)
    }
  })

  it('contains no seed of organisation entitlement or config data of any kind', () => {
    expect(EXECUTABLE).not.toMatch(/\bconfig\b/i)
  })
})
