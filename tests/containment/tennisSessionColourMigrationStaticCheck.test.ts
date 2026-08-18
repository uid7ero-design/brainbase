import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static assertions on the migration SQL text itself — the migration was
// additionally run twice against a disposable Postgres schema (created,
// verified, dropped) as part of preparing this round; that verification is
// not re-run here since it requires a live database connection this test
// suite doesn't have. See the deliverable report for those results. This
// file guards the properties that matter regardless: additive-only,
// idempotent, no backfill, no destructive statement.

const SQL_PATH = path.resolve(__dirname, '../../scripts/add-session-colour-override.sql')
const sql = fs.readFileSync(SQL_PATH, 'utf-8')

describe('scripts/add-session-colour-override.sql', () => {
  it('1. adds the column idempotently (IF NOT EXISTS) — safe to run more than once', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS session_colour_key text')
  })

  it('2. the column is nullable with no DEFAULT — every existing row is left NULL, nothing is backfilled', () => {
    expect(sql).not.toMatch(/session_colour_key text NOT NULL/)
    expect(sql).not.toMatch(/session_colour_key text[^;]*DEFAULT/i)
  })

  it('3. contains no UPDATE/backfill statement copying a type colour into sessions rows', () => {
    expect(sql).not.toMatch(/UPDATE\s+sessions/i)
  })

  it('4. is purely additive — no DROP, RENAME, or ALTER COLUMN TYPE on any existing column', () => {
    // The only DROP allowed is inside the commented-out rollback block.
    const liveStatements = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
    expect(liveStatements).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
    expect(liveStatements).not.toMatch(/RENAME/i)
    expect(liveStatements).not.toMatch(/ALTER\s+COLUMN\s+\w+\s+TYPE/i)
  })
})
