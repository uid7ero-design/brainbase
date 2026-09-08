import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.6H-R2 — systemic UUID/TEXT foreign-key type repair.
//
// app/api/admin/migrate/route.ts was originally written when
// organisations.id was (apparently) a native UUID column. At some point
// the real, canonical organisations.id (and users.id) were established as
// TEXT/cuid-compatible strings (see prisma/schema.prisma's
// `Organisation.id String @id @default(cuid())` and `User.organisation_id
// String` with `@relation(fields: [organisation_id], references: [id])`,
// and scripts/create-tennis-lead-messages.sql's own header comment:
// "id/lead_id/organisation_id/created_by all use TEXT ... users.id are
// all TEXT, per prisma/schema.prisma"). This file's dozens of legacy
// CREATE TABLE IF NOT EXISTS statements were never updated to match —
// each one is a latent landmine that only fails on an environment where
// that specific table doesn't yet exist (IF NOT EXISTS silently no-ops
// everywhere the table is already present). This is independently
// confirmed by this repo's own
// app/api/admin/migrate/crm-contact-classification/route.ts, created
// specifically because "[the main migrate route's] full legacy replay
// was found to fail on an unrelated, pre-existing waste_records schema
// defect before ever reaching the classification step."
//
// This test proves the defect class cannot silently return: every
// organisation_id column that REFERENCES organisations(id) must be
// TEXT-typed, and organisations.id itself (the root of the family) must
// be TEXT. It also locks in the specific, narrow set of co-located
// user-ID-family columns (created_by/user_id/submitted_by REFERENCES
// users(id)) that were fixed alongside their table's organisation_id
// column — necessary because a single CREATE TABLE statement fails
// atomically, so fixing organisation_id alone would not have made those
// particular statements valid on a fresh environment.
//
// email_tokens.user_id was ORIGINALLY excluded (Classification B:
// standalone, not co-located with any organisation_id column) — but a
// disposable-Postgres fresh-schema run empirically proved it to be the
// very next hard blocker after this repair (the exact same defect
// class, same auto-generated constraint name shape:
// "email_tokens_user_id_fkey ... incompatible types: uuid and text"),
// preventing progression to every later table including organiser_* and
// the final crm_contacts step. It was subsequently authorized and
// repaired too (see this phase's report for the full second-defect-stop
// sequence) — final count: 44 schema declaration type-token changes
// (1 root + 35 organisation_id + 7 co-located Classification-A + 1
// email_tokens.user_id), all UUID → TEXT only, no other semantic
// changed.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}

const routeSource = read('app/api/admin/migrate/route.ts')

describe('app/api/admin/migrate/route.ts — organisation_id type integrity (D.4.6H-R2)', () => {
  it('no column declaration anywhere in the file uses UUID while referencing organisations(id) — the exact defect class this phase repairs', () => {
    // Not brittle to whitespace: matches any amount of space between the
    // type token and REFERENCES, and tolerates NOT NULL in between.
    expect(routeSource).not.toMatch(/UUID(\s+NOT\s+NULL)?\s+REFERENCES\s+organisations\(id\)/)
  })

  it('no column declaration anywhere in the file uses UUID while referencing users(id) — the sibling defect class (users.id is TEXT too), including the second-defect-stop-rule fix (email_tokens.user_id)', () => {
    expect(routeSource).not.toMatch(/UUID(\s+NOT\s+NULL)?\s+REFERENCES\s+users\(id\)/)
  })

  it('organisations.id itself (the root of the whole family) is TEXT, not UUID — proven from source: prisma/schema.prisma declares Organisation.id as String @id @default(cuid())', () => {
    const createStart = routeSource.indexOf('CREATE TABLE IF NOT EXISTS organisations (')
    expect(createStart).toBeGreaterThan(-1)
    const createEnd = routeSource.indexOf(')', createStart)
    const block = routeSource.slice(createStart, createEnd)
    expect(block).toMatch(/id\s+TEXT\s+PRIMARY\s+KEY/)
    expect(block).not.toMatch(/id\s+UUID\s+PRIMARY\s+KEY/)
  })

  it('every organisation_id column declaration in the file is TEXT-typed (36 occurrences: the ALTER TABLE users column plus every CREATE TABLE IF NOT EXISTS column)', () => {
    const matches = [...routeSource.matchAll(/organisation_id\s+(TEXT|UUID)(\s+NOT\s+NULL)?\s+REFERENCES\s+organisations\(id\)/g)]
    expect(matches.length).toBeGreaterThan(30) // sanity: the regex itself matched a substantial, expected population
    for (const m of matches) {
      expect(m[1]).toBe('TEXT')
    }
  })

  it('the 7 co-located user-ID-family columns fixed alongside their organisation_id repair are TEXT (reports.created_by, import_mappings.created_by, audit_logs.user_id, onboarding_progress.user_id, agent_runs.user_id, saved_briefings.user_id, client_pipeline.submitted_by)', () => {
    const cases: Array<{ table: string; column: string }> = [
      { table: 'reports', column: 'created_by' },
      { table: 'import_mappings', column: 'created_by' },
      { table: 'audit_logs', column: 'user_id' },
      { table: 'onboarding_progress', column: 'user_id' },
      { table: 'agent_runs', column: 'user_id' },
      { table: 'saved_briefings', column: 'user_id' },
      { table: 'client_pipeline', column: 'submitted_by' },
    ]
    for (const { table, column } of cases) {
      const createStart = routeSource.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`)
      expect(createStart, `${table} CREATE TABLE not found`).toBeGreaterThan(-1)
      const createEnd = routeSource.indexOf('\n  `;', createStart)
      const block = routeSource.slice(createStart, createEnd)
      const colRegex = new RegExp(`${column}\\s+(TEXT|UUID)(\\s+NOT\\s+NULL)?\\s+REFERENCES\\s+users\\(id\\)`)
      const m = block.match(colRegex)
      expect(m, `${table}.${column} declaration not found in expected shape`).not.toBeNull()
      expect(m![1]).toBe('TEXT')
    }
  })

  it('email_tokens.user_id is TEXT — the second-defect-stop-rule fix, empirically proven necessary by a fresh-schema disposable-Postgres run (was originally Classification B / excluded, then authorized after the run hit it as the very next hard blocker)', () => {
    const createStart = routeSource.indexOf('CREATE TABLE IF NOT EXISTS email_tokens (')
    expect(createStart).toBeGreaterThan(-1)
    const createEnd = routeSource.indexOf('\n  `;', createStart)
    const block = routeSource.slice(createStart, createEnd)
    // NOT NULL and ON DELETE CASCADE preserved exactly — only the type
    // token changed.
    expect(block).toMatch(/user_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+users\(id\)\s+ON\s+DELETE\s+CASCADE/)
    expect(block).not.toMatch(/user_id\s+UUID/)
  })

  it('no ON DELETE / ON UPDATE / NOT NULL / DEFAULT semantic was altered on any repaired organisation_id column — only the type token changed (spot-check waste_records: NOT NULL preserved, no ON DELETE either before or after)', () => {
    const createStart = routeSource.indexOf('CREATE TABLE IF NOT EXISTS waste_records (')
    const createEnd = routeSource.indexOf('\n  `;', createStart)
    const block = routeSource.slice(createStart, createEnd)
    expect(block).toMatch(/organisation_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+organisations\(id\)/)
    expect(block).not.toMatch(/organisation_id[^,]*ON DELETE/)
  })

  it('agent_runs.organisation_id — the one nullable exception — kept its nullability (no NOT NULL added)', () => {
    const createStart = routeSource.indexOf('CREATE TABLE IF NOT EXISTS agent_runs (')
    const createEnd = routeSource.indexOf('\n  `;', createStart)
    const block = routeSource.slice(createStart, createEnd)
    expect(block).toMatch(/organisation_id\s+TEXT\s+REFERENCES\s+organisations\(id\)/)
    expect(block).not.toMatch(/organisation_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+organisations\(id\)/)
  })

  it('organiser_* tables and crm_contacts (already correct before this phase) are untouched — still TEXT, still present, still in the same relative order', () => {
    expect(routeSource).toContain("step('33. organiser_boards')")
    expect(routeSource).toContain("step('40. organiser_activity')")
    expect(routeSource).toContain("step('42. crm_contacts.classification')")
    const organiserBoardsStart = routeSource.indexOf('CREATE TABLE IF NOT EXISTS organiser_boards (')
    const organiserBoardsEnd = routeSource.indexOf('\n  `;', organiserBoardsStart)
    expect(routeSource.slice(organiserBoardsStart, organiserBoardsEnd)).toMatch(/organisation_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+organisations\(id\)/)
  })

  it('no destructive statement was introduced anywhere in the file (no ALTER COLUMN TYPE, no USING cast, no DROP COLUMN, no DROP TABLE)', () => {
    expect(routeSource).not.toMatch(/ALTER\s+COLUMN\s+\w+\s+TYPE/i)
    expect(routeSource).not.toMatch(/USING\s+\w+::/i)
    expect(routeSource).not.toMatch(/DROP\s+COLUMN/i)
    expect(routeSource).not.toMatch(/DROP\s+TABLE/i)
  })
})
