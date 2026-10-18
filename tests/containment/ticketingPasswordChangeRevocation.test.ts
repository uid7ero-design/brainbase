import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Eve Phase 3.5 — every existing password-change path revokes the user's Eve
// sessions IN THE SAME TRANSACTION as the password write (both or neither),
// and reports a failure instead of a false success. The transaction itself is
// proven against real Postgres in ticketingSessionsRateLimitRealPostgres.test.ts.

const ROOT = path.resolve(__dirname, '../..')
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')

const PATHS: { file: string; write: RegExp; failure: RegExp }[] = [
  { file: 'app/actions/profile.ts', write: /UPDATE users SET password_hash = \$\{hash\}/, failure: /Your password could not be updated/ },
  { file: 'app/actions/users.ts', write: /UPDATE users SET password_hash = \$\{passwordHash\}/, failure: /The password could not be updated/ },
  { file: 'app/api/auth/reset-password/route.ts', write: /SET password_hash = \$\{hash\}/, failure: /status: 500/ },
  { file: 'app/api/admin/users/route.ts', write: /password_hash = \$\{newHash\}/, failure: /transaction\(\[updateQuery, revokeUserSessionsQuery\(id\)\]\)/ },
]

describe('password change revokes Eve sessions atomically', () => {
  for (const p of PATHS) {
    it(`${p.file}: imports the revocation, runs it in sql.transaction with the password write, and reports failure`, () => {
      const src = read(p.file)
      expect(src).toContain("from '@/lib/ticketing/sessionRevocation'")
      expect(src).toMatch(p.write)
      expect(src).toMatch(/sql\.transaction\(\[/)
      expect(src).toMatch(/revokeUserSessionsQuery\(/)
      expect(src).toMatch(p.failure)
    })
  }

  it('the revocation fragment is a single UPDATE that only closes OPEN sessions of one user, with the approved reason', () => {
    const src = read('lib/ticketing/sessionRevocation.ts')
    expect(src).toMatch(/UPDATE ticketing_sessions SET revoked_at = NOW\(\), revoked_reason = \$\{reason\}/)
    expect(src).toMatch(/WHERE user_id = \$\{userId\} AND revoked_at IS NULL/)
    expect(src).toMatch(/reason: 'PASSWORD_CHANGE' \| 'ADMIN' = 'PASSWORD_CHANGE'/)
  })

  it('BrainBase session semantics are untouched: none of the four paths touches lib/session or the BrainBase cookie', () => {
    for (const p of PATHS) {
      const src = read(p.file)
      expect(src).not.toMatch(/ticketing_sessions|issueTicketingSession|revokeTicketingSession/)
    }
  })

  it('the admin route only adds the revocation when a password was actually supplied', () => {
    const src = read('app/api/admin/users/route.ts')
    expect(src).toMatch(/const rows = password\n\s+\? \(await sql\.transaction\(\[updateQuery, revokeUserSessionsQuery\(id\)\]\)\)\[0\]\n\s+: await updateQuery;/)
  })
})

describe('session issuance is persist-first and never the token without a row', () => {
  it('issueTicketingSession writes the row before signing, and org switch revokes in the same transaction', () => {
    const src = read('lib/ticketing/session.ts')
    const insertAt = src.indexOf('INSERT INTO ticketing_sessions')
    const signAt = src.indexOf('new SignJWT')
    expect(insertAt).toBeGreaterThan(0)
    expect(signAt).toBeGreaterThan(insertAt)
    expect(src).toMatch(/sql\.transaction\(\[\n\s+insert,\n\s+sql`\n\s+UPDATE ticketing_sessions SET revoked_at = NOW\(\), revoked_reason = 'ORG_SWITCH'/)
    expect(src).toMatch(/catch \(err\) \{[\s\S]*return null;/)
  })

  it('every protected-request read requires a live session row for the same user and organisation', () => {
    for (const f of ['lib/ticketing/authorize.ts', 'lib/ticketing/login.ts']) {
      const src = read(f)
      expect(src, f).toMatch(/s\.id = \$\{claims\.jti\} AND s\.user_id = users\.id AND s\.organisation_id = \$\{claims\.organisationId\}/)
      expect(src, f).toMatch(/s\.revoked_at IS NULL\s+AND s\.expires_at > NOW\(\)/)
      expect(src, f).toMatch(/session_live/)
    }
  })

  it('the migration is additive: two CREATE TABLE IF NOT EXISTS, no ALTER/DROP/UPDATE of existing tables', () => {
    const sqlText = read('scripts/create-ticketing-sessions-and-rate-limits.sql').split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect((sqlText.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length).toBe(2)
    expect(sqlText).not.toMatch(/\bALTER TABLE\b|\bDROP\b|^\s*UPDATE\b|^\s*INSERT\b|^\s*DELETE\b|\bTRUNCATE\b/m)
  })
})
