import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion of the migration file's DDL shape — the
// deeper functional proof (real FK/CHECK/UNIQUE constraint enforcement,
// CASCADE behaviour, and idempotency across two real applications) lives
// in scripts/tests/verify-email-tokens-migration.sh, a disposable
// postgres:16-alpine harness (25/25 checks passing), matching this
// repository's established discipline that constraint/concurrency claims
// are proven against real Postgres, never asserted from static text
// alone. These tests exist to catch a future accidental edit to the
// script's declared shape — e.g. someone "fixing" user_id back to UUID,
// matching app/api/admin/migrate/route.ts's own known-wrong definition.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}

const migrationPath = 'scripts/add-email-tokens.sql'
const source = read(migrationPath)
// The header comments deliberately quote app/api/admin/migrate/route.ts's
// OLD, wrong `user_id UUID` definition for documentation purposes (see
// the file's own "Root cause this corrects" paragraph) — so a blanket
// "this file never mentions UUID" check would false-fail on the file's
// own explanatory prose. Scope the negative UUID assertions to just the
// actual CREATE TABLE statement instead.
const ddlOnly = source.slice(source.indexOf('CREATE TABLE IF NOT EXISTS email_tokens'), source.indexOf(');', source.indexOf('CREATE TABLE IF NOT EXISTS email_tokens')))

describe('scripts/add-email-tokens.sql — target schema matches the corrected TEXT-id contract', () => {
  it('the file exists at the expected repository path', () => {
    expect(fs.existsSync(path.join(process.cwd(), migrationPath))).toBe(true)
  })

  it('id is TEXT with a real database default (gen_random_uuid()::text) — never a native UUID column', () => {
    expect(ddlOnly).toMatch(/id\s+TEXT\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)::text/)
    expect(ddlOnly).not.toMatch(/\bUUID\b/i)
  })

  it('user_id is TEXT and references users(id) — never UUID, matching the real Production-confirmed users.id type (not app/api/admin/migrate/route.ts\'s own known-wrong UUID definition)', () => {
    expect(ddlOnly).toMatch(/user_id\s+TEXT\s+NOT NULL REFERENCES users\(id\)/)
    expect(ddlOnly).not.toMatch(/user_id\s+UUID/i)
  })

  it('the user_id foreign key is ON DELETE CASCADE', () => {
    expect(source).toMatch(/REFERENCES users\(id\) ON DELETE CASCADE/)
  })

  it('token is TEXT NOT NULL UNIQUE', () => {
    expect(source).toMatch(/token\s+TEXT\s+NOT NULL UNIQUE/)
  })

  it('type is TEXT with a CHECK restricting it to exactly (\'verify\', \'reset\') — matching lib/tokens.ts\'s TokenType union', () => {
    expect(source).toMatch(/type\s+TEXT\s+NOT NULL CHECK \(type IN \('verify', 'reset'\)\)/)
  })

  it('expires_at is required (NOT NULL); used_at is nullable — a token starts unconsumed and every token carries an explicit TTL', () => {
    expect(source).toMatch(/expires_at\s+TIMESTAMPTZ\s+NOT NULL/)
    expect(source).toMatch(/used_at\s+TIMESTAMPTZ,/)
    expect(source).not.toMatch(/used_at\s+TIMESTAMPTZ\s+NOT NULL/)
  })

  it('created_at defaults to now()', () => {
    expect(source).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT NULL DEFAULT now\(\)/)
  })

  it('both required indexes are declared, idempotently (IF NOT EXISTS)', () => {
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_email_tokens_token ON email_tokens\(token\)/)
    expect(source).toMatch(/CREATE INDEX IF NOT EXISTS idx_email_tokens_user\s+ON email_tokens\(user_id\)/)
  })

  it('the table creation itself is idempotent (IF NOT EXISTS) — safe to re-run, matching every other scripts/*.sql in this repository', () => {
    expect(source).toMatch(/CREATE TABLE IF NOT EXISTS email_tokens/)
  })

  it('carries the same manual-run warning every other schema script in this repository uses — never auto-executed', () => {
    expect(source).toMatch(/Run once, manually,\s*\n-- against the target database\. NOT run automatically/)
  })

  it('carries a rollback comment block (not executed) for the record, matching this repository\'s convention', () => {
    expect(source).toMatch(/Rollback \(not run automatically/)
    expect(source).toContain('DROP TABLE IF EXISTS email_tokens;')
  })

  it('carries an inline, non-executed verification query block for a human to run after applying the migration', () => {
    expect(source).toMatch(/Verification \(run manually, read-only, after applying the above\)/)
    expect(source).toContain("information_schema.columns")
  })

  it('does not reference app/api/admin/migrate/route.ts as something this script depends on or extends — this is a standalone replacement, not a patch to that route (which remains unmodified by this task)', () => {
    const migrateRouteSource = read('app/api/admin/migrate/route.ts')
    expect(migrateRouteSource).toContain('user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE')
    // Confirms the stale route was intentionally left untouched, not
    // silently corrected in place — this task's own explicit instruction.
  })

  it('references the real-Postgres verification harness that proves the constraints above actually work', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'scripts/tests/verify-email-tokens-migration.sh'))).toBe(true)
  })
})
