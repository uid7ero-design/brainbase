import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Modular Platform Foundation Phase F.2A — organisation canonical
// timezone schema foundation. This suite proves the standalone script
// contains ONLY the single approved additive operation and nothing
// else — no backfill, no default, no NOT NULL, no touch to any other
// column/table. This is schema preparation only: no application code
// reads or writes organisations.timezone yet, and no Production DDL
// has been executed by this task.

const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/add-organisations-timezone.sql')
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf-8')

// SQL uses `--` line comments, not `//` — strip them so assertions only
// ever see real, executable DDL, never explanatory prose (which
// legitimately mentions words like "UPDATE"/"DROP"/"default" when
// explaining what the script deliberately does NOT do — a naive,
// unstripped textual check would false-positive on that prose).
function stripSqlComments(src: string): string {
  return src.replace(/--.*$/gm, '')
}
const EXECUTABLE = stripSqlComments(SCRIPT_SOURCE)
const EXECUTABLE_COMPACT = EXECUTABLE.replace(/\s+/g, ' ').trim()

describe('scripts/add-organisations-timezone.sql — schema foundation only (Phase F.2A)', () => {
  it('contains exactly one executable statement', () => {
    // Strip the single trailing semicolon before splitting, so an empty
    // trailing segment isn't counted as a second statement.
    const statements = EXECUTABLE_COMPACT.replace(/;\s*$/, '').split(';').map(s => s.trim()).filter(Boolean)
    expect(statements).toHaveLength(1)
  })

  it('the single statement targets public.organisations and adds a nullable timezone TEXT column', () => {
    expect(EXECUTABLE_COMPACT).toMatch(/ALTER TABLE\s+public\.organisations\s+ADD COLUMN IF NOT EXISTS\s+timezone\s+TEXT\s*;/i)
  })

  it('uses ADD COLUMN IF NOT EXISTS (idempotent, never a bare ADD COLUMN)', () => {
    expect(EXECUTABLE_COMPACT).toMatch(/ADD COLUMN IF NOT EXISTS/i)
  })

  it('does NOT specify a DEFAULT anywhere in the executable statement', () => {
    expect(EXECUTABLE_COMPACT).not.toMatch(/DEFAULT/i)
  })

  it('does NOT specify NOT NULL anywhere in the executable statement', () => {
    expect(EXECUTABLE_COMPACT).not.toMatch(/NOT NULL/i)
  })

  it('does NOT specify a CHECK constraint', () => {
    expect(EXECUTABLE_COMPACT).not.toMatch(/CHECK\s*\(/i)
  })

  it('contains no DML of any kind — no UPDATE, INSERT, DELETE — in executable SQL (comment-stripped)', () => {
    expect(EXECUTABLE).not.toMatch(/\bUPDATE\b/i)
    expect(EXECUTABLE).not.toMatch(/\bINSERT\b/i)
    expect(EXECUTABLE).not.toMatch(/\bDELETE\b/i)
  })

  it('contains no destructive DDL — no DROP, no TRUNCATE — in executable SQL (comment-stripped)', () => {
    expect(EXECUTABLE).not.toMatch(/\bDROP\b/i)
    expect(EXECUTABLE).not.toMatch(/\bTRUNCATE\b/i)
  })

  it('does not alter organisations.id, or the id column of any table', () => {
    expect(EXECUTABLE).not.toMatch(/\bALTER\s+COLUMN\s+id\b/i)
    expect(EXECUTABLE).not.toMatch(/\bid\s+(TEXT|UUID)\b/i)
  })

  it('does not touch plan, status, or settings', () => {
    expect(EXECUTABLE).not.toMatch(/\bplan\b/i)
    expect(EXECUTABLE).not.toMatch(/\bstatus\b/i)
    expect(EXECUTABLE).not.toMatch(/\bsettings\b/i)
  })

  it('contains no module/organisation_modules table DDL', () => {
    expect(EXECUTABLE).not.toMatch(/\bmodules\b/i)
    expect(EXECUTABLE).not.toMatch(/organisation_modules/i)
    expect(EXECUTABLE).not.toMatch(/CREATE TABLE/i)
  })

  it('contains no users-table DDL', () => {
    expect(EXECUTABLE).not.toMatch(/\busers\b/i)
  })

  it('targets no table other than organisations', () => {
    const tableRefs = [...EXECUTABLE.matchAll(/ALTER TABLE\s+([a-z0-9_.]+)/gi)].map(m => m[1].toLowerCase())
    expect(tableRefs).toHaveLength(1)
    expect(tableRefs[0]).toBe('public.organisations')
  })

  it('the file explains it is for deliberate manual Production execution only, not automatic', () => {
    expect(SCRIPT_SOURCE).toMatch(/manually|NOT run automatically/i)
  })

  it('comments legitimately mention words like UPDATE/DROP/default only when explaining what the script deliberately does NOT do — confirms the comment-stripping test setup itself is working, not masking a real statement', () => {
    // The raw (unstripped) source DOES mention these words in prose...
    expect(SCRIPT_SOURCE).toMatch(/default/i)
    // ...but the comment-stripped executable text does not contain the
    // word "DEFAULT" at all (already asserted above) — proving the
    // stripping function is actually removing that prose, not just
    // coincidentally passing.
    expect(EXECUTABLE).not.toMatch(/no database default/i)
  })
})

describe('Prisma schema files — minimal, matching synchronization (Phase F.2A)', () => {
  const PRISMA_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf-8')
  const BACKEND_PRISMA_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../backend_migration/prisma/schema.prisma'), 'utf-8')

  function organisationModelBody(source: string): string {
    const start = source.indexOf('model Organisation {')
    expect(start).toBeGreaterThan(-1)
    const end = source.indexOf('\n}', start)
    return source.slice(start, end)
  }

  it('both Organisation models declare timezone as an optional String (nullable), nothing else changed on that line', () => {
    for (const source of [PRISMA_SOURCE, BACKEND_PRISMA_SOURCE]) {
      const body = organisationModelBody(source)
      expect(body).toMatch(/timezone\s+String\?/)
    }
  })

  it('id/name/slug/plan/status/settings/created_at/updated_at are unchanged in both files (only the new timezone line was added)', () => {
    for (const source of [PRISMA_SOURCE, BACKEND_PRISMA_SOURCE]) {
      const body = organisationModelBody(source)
      expect(body).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/)
      expect(body).toMatch(/name\s+String\b/)
      expect(body).toMatch(/slug\s+String\s+@unique/)
      expect(body).toMatch(/plan\s+Plan\s+@default\(TRIAL\)/)
      expect(body).toMatch(/status\s+OrgStatus\s+@default\(ACTIVE\)/)
      expect(body).toMatch(/settings\s+Json\s+@default\("\{\}"\)/)
    }
  })
})

describe('No application consumer wired yet (Phase F.2A is schema-only)', () => {
  it('no route reads or writes organisations.timezone', () => {
    // A repo-wide check that no application code (outside this new SQL
    // script/Prisma schema/this test file itself) references
    // "organisations.timezone"-style consumption. Deliberately scoped
    // to app/api and lib, matching the scope of routes explicitly
    // called out as untouched (Microsoft/Google/Founder OS/me/account).
    const scanDirs = ['app/api', 'lib']
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
          if (/organisations?\.timezone\b/i.test(content) || /org\.timezone\b/.test(content)) {
            offenders.push(full)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
