import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import { types as neonTypes } from '@neondatabase/serverless'

// Real disposable-Postgres proof — Eve Phase 3.5: server-side session
// revocation and the shared rate limiter. Runs the ACTUAL session, login,
// authorization and limiter code against PostgreSQL 17 with the real
// migration (scripts/create-ticketing-sessions-and-rate-limits.sql).
//
// Proves: persist-first issuance; live-session verification folded into the
// user read; logout / org-switch / password-change revocation (and that the
// switch and the password change are atomic); the fresh checks for user
// status, role, organisation and Events capability still decide; one atomic
// counter shared by simulated instances; concurrency; window rollover; key
// isolation; no PII in stored keys; bounded cleanup; the explicit outage
// behaviour per class; a small latency benchmark.
//
// Never against Production/Preview — a disposable container. Skipped when
// docker is unavailable.

process.env.EVE_SESSION_SECRET = 'eve-test-secret-0123456789abcdef0123456789abcdef'
process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'

const CONTAINER = `ticketing-sessions-vitest-${process.pid}`
const HOST_PORT = 61700 + (process.pid % 1000)
function dockerAvailable(): boolean { try { execSync('docker version', { stdio: 'ignore' }); return true } catch { return false } }
const HAS_DOCKER = dockerAvailable()

const db = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool, down: false }))

vi.mock('@/lib/db', () => {
  type Query = { text: string; values: unknown[]; then: Promise<unknown[]>['then'] }
  function sql(strings: TemplateStringsArray, ...values: unknown[]): Query {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return {
      text, values,
      then(onF, onR) {
        if (db.down) return Promise.reject(new Error('database unavailable')).then(onF, onR)
        return db.pool.query(text, values as unknown[]).then(r => r.rows).then(onF, onR)
      },
    }
  }
  sql.transaction = async (queries: Query[]) => {
    if (db.down) throw new Error('database unavailable')
    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      const out: unknown[][] = []
      for (const q of queries) out.push((await client.query(q.text, q.values as unknown[])).rows)
      await client.query('COMMIT')
      return out
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }
  return { default: sql }
})

const MIGRATION = 'scripts/create-ticketing-sessions-and-rate-limits.sql'
const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }

describe.runIf(HAS_DOCKER)('real Postgres — Eve sessions + shared rate limiter (Phase 3.5)', () => {
  let sess: typeof import('@/lib/ticketing/session')
  let auth: typeof import('@/lib/ticketing/authorize')
  let login: typeof import('@/lib/ticketing/login')
  let rl: typeof import('@/lib/ticketing/rateLimit')
  let revoke: typeof import('@/lib/ticketing/sessionRevocation')
  const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await db.pool.query(text, values)).rows as T[]
  const withSession = (token: string) => new Request('http://bb.test/x', { headers: { ...GATE, 'x-ticketing-session': token } })
  const sessions = async () => q<{ id: string; user_id: string; organisation_id: string; revoked_at: Date | null; revoked_reason: string | null }>(`SELECT * FROM ticketing_sessions ORDER BY created_at, id`)

  beforeAll(async () => {
    execSync(`docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb -p ${HOST_PORT}:5432 postgres:17-alpine`, { stdio: 'ignore' })
    let ready = false
    for (let i = 0; i < 30; i++) {
      if (spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0) { ready = true; break }
      await new Promise(r => setTimeout(r, 1000))
    }
    if (!ready) throw new Error('postgres container did not become ready within 30s')
    db.pool = new Pool({ host: 'localhost', port: HOST_PORT, user: 'postgres', password: 'test', database: 'testdb', max: 30, types: neonTypes as unknown as import('pg').CustomTypesConfig })
    for (const stmt of [
      `CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'ACTIVE');`,
      `CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT REFERENCES organisations(id) ON DELETE CASCADE, username TEXT UNIQUE, name TEXT, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', password_hash TEXT);`,
      `CREATE TABLE modules (key TEXT PRIMARY KEY, active BOOLEAN NOT NULL DEFAULT true);`,
      `CREATE TABLE organisation_modules (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE, module_key TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true, config JSONB NOT NULL DEFAULT '{}');`,
      fs.readFileSync(path.join(process.cwd(), MIGRATION), 'utf8'),
    ]) await db.pool.query(stmt)
    sess = await import('@/lib/ticketing/session')
    auth = await import('@/lib/ticketing/authorize')
    login = await import('@/lib/ticketing/login')
    rl = await import('@/lib/ticketing/rateLimit')
    revoke = await import('@/lib/ticketing/sessionRevocation')
  }, 180_000)

  afterAll(async () => {
    await db.pool?.end().catch(() => {})
    spawnSync('docker', ['rm', '-f', CONTAINER])
  })

  beforeEach(async () => {
    db.down = false
    await q(`DELETE FROM ticketing_sessions`)
    await q(`DELETE FROM ticketing_rate_limits`)
    await q(`DELETE FROM organisation_modules`); await q(`DELETE FROM users`); await q(`DELETE FROM organisations`); await q(`DELETE FROM modules`)
    await q(`INSERT INTO modules (key, active) VALUES ('events', true)`)
    await q(`INSERT INTO organisations (id, name, slug) VALUES ('org-a','A','a'),('org-b','B','b')`)
    await q(`INSERT INTO organisation_modules (id, organisation_id, module_key) VALUES ('m-a','org-a','events'),('m-b','org-b','events')`)
    await q(`INSERT INTO users (id, organisation_id, username, name, role) VALUES ('u-mgr','org-a','mgr','Mgr','MANAGER'),('u-sa','org-a','sa','SA','SUPER_ADMIN'),('u-other','org-b','other','Other','MANAGER')`)
  })

  // ── migration ─────────────────────────────────────────────────────────
  describe('migration', () => {
    it('is idempotent and additive', async () => {
      await db.pool.query(fs.readFileSync(path.join(process.cwd(), MIGRATION), 'utf8'))
      const cols = await q<{ table_name: string }>(`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_name IN ('ticketing_sessions','ticketing_rate_limits')`)
      expect(cols.map(c => c.table_name).sort()).toEqual(['ticketing_rate_limits', 'ticketing_sessions'])
    })

    it('enforces the approved constraints', async () => {
      const ins = (extra: string) => db.pool.query(`INSERT INTO ticketing_sessions (id, user_id, organisation_id, created_at, expires_at, revoked_at, revoked_reason) VALUES (${extra})`)
      await expect(ins(`'s1','u-mgr','org-a', now(), now() - interval '1 hour', NULL, NULL`)).rejects.toThrow(/ticketing_sessions_expiry_check/)
      await expect(ins(`'s2','u-mgr','org-a', now(), now() + interval '1 hour', now(), NULL`)).rejects.toThrow(/revocation_pair_check/)
      await expect(ins(`'s3','u-mgr','org-a', now(), now() + interval '1 hour', NULL, 'LOGOUT'`)).rejects.toThrow(/revocation_pair_check/)
      await expect(ins(`'s4','u-mgr','org-a', now(), now() + interval '1 hour', now(), 'WHATEVER'`)).rejects.toThrow(/revoked_reason_check/)
      for (const reason of ['LOGOUT', 'ORG_SWITCH', 'PASSWORD_CHANGE', 'ADMIN']) {
        await ins(`'ok-${reason}','u-mgr','org-a', now(), now() + interval '1 hour', now(), '${reason}'`)
      }
      await expect(ins(`'fk','no-user','org-a', now(), now() + interval '1 hour', NULL, NULL`)).rejects.toThrow(/foreign key/)
      const rl2 = (vals: string) => db.pool.query(`INSERT INTO ticketing_rate_limits (key_hash, window_start, count, expires_at) VALUES (${vals})`)
      const h = 'a'.repeat(64)
      await expect(rl2(`'${h}', now(), 0, now() + interval '1 minute'`)).rejects.toThrow(/count_check/)
      await expect(rl2(`'${h}', now(), 1, now() - interval '1 minute'`)).rejects.toThrow(/expiry_check/)
      await expect(rl2(`'raw-ip-1.2.3.4', now(), 1, now() + interval '1 minute'`)).rejects.toThrow(/key_hash_check/)
    })

    it('deleting a user removes their sessions (cascade)', async () => {
      await sess.issueTicketingSession('u-mgr', 'org-a')
      expect(await sessions()).toHaveLength(1)
      await q(`DELETE FROM users WHERE id = 'u-mgr'`)
      expect(await sessions()).toHaveLength(0)
    })
  })

  // ── sessions ──────────────────────────────────────────────────────────
  describe('sessions', () => {
    it('issuance persists the row first; the token\'s jti is the row id and expiry is ~8h', async () => {
      const issued = (await sess.issueTicketingSession('u-mgr', 'org-a'))!
      const claims = (await sess.verifyTicketingSession(issued.token))!
      const [row] = await sessions()
      expect(row).toMatchObject({ id: claims.jti, user_id: 'u-mgr', organisation_id: 'org-a', revoked_at: null })
      const [{ secs }] = await q<{ secs: number }>(`SELECT extract(epoch FROM expires_at - created_at)::int AS secs FROM ticketing_sessions`)
      expect(secs).toBe(8 * 60 * 60)
    })

    it('no token is returned when the row cannot be written', async () => {
      expect(await sess.issueTicketingSession('u-mgr', 'no-such-org')).toBeNull() // FK violation
      expect(await sessions()).toHaveLength(0)
    })

    it('the live-session check is folded into the user read: live session authorises; logout kills the same token at once; repeat logout is safe', async () => {
      const { token } = (await sess.issueTicketingSession('u-mgr', 'org-a'))!
      expect((await auth.authorizeTicketingApiRequest(withSession(token), 'viewer')).ok).toBe(true)
      expect((await login.handleTicketingLogout(withSession(token))).status).toBe(200)
      const after = await auth.authorizeTicketingApiRequest(withSession(token), 'viewer')
      expect(!after.ok && after.response.status).toBe(401)
      expect((await login.handleTicketingLogout(withSession(token))).status).toBe(200)
      const [row] = await sessions()
      expect(row.revoked_reason).toBe('LOGOUT')
      db.down = true // the database cannot confirm the revocation => reported, never claimed
      expect((await login.handleTicketingLogout(withSession(token))).status).toBe(503)
    })

    it('logout of an unknown / forged session never touches anyone else\'s', async () => {
      const a = (await sess.issueTicketingSession('u-mgr', 'org-a'))!
      const b = (await sess.issueTicketingSession('u-mgr', 'org-a'))!
      await login.handleTicketingLogout(withSession(a.token))
      expect((await auth.authorizeTicketingApiRequest(withSession(b.token), 'viewer')).ok).toBe(true)
      expect((await login.handleTicketingLogout(withSession('not-a-token'))).status).toBe(200)
      expect((await sessions()).filter(s => !s.revoked_at)).toHaveLength(1)
    })

    it('organisation switch is one transaction: the old session is revoked, the new one is live, and a failed switch changes nothing', async () => {
      const old = (await sess.issueTicketingSession('u-sa', 'org-a'))!
      const oldId = (await sess.verifyTicketingSession(old.token))!.jti
      const next = (await sess.issueTicketingSession('u-sa', 'org-b', { replaceSessionId: oldId }))!
      expect(next).not.toBeNull()
      const rows = await sessions()
      expect(rows.find(r => r.id === oldId)).toMatchObject({ revoked_reason: 'ORG_SWITCH' })
      expect(rows.filter(r => !r.revoked_at)).toHaveLength(1)
      expect((await auth.authorizeTicketingApiRequest(withSession(old.token), 'viewer')).ok).toBe(false)
      expect((await auth.authorizeTicketingApiRequest(withSession(next.token), 'viewer')).ok).toBe(true)

      // A switch whose INSERT fails (unknown organisation) rolls the revoke back too.
      const keep = (await sess.issueTicketingSession('u-sa', 'org-a'))!
      const keepId = (await sess.verifyTicketingSession(keep.token))!.jti
      expect(await sess.issueTicketingSession('u-sa', 'no-such-org', { replaceSessionId: keepId })).toBeNull()
      expect((await sessions()).find(r => r.id === keepId)!.revoked_at).toBeNull()
      expect((await auth.authorizeTicketingApiRequest(withSession(keep.token), 'viewer')).ok).toBe(true)
    })

    it('the switch cannot revoke another user\'s session', async () => {
      const victim = (await sess.issueTicketingSession('u-other', 'org-b'))!
      const victimId = (await sess.verifyTicketingSession(victim.token))!.jti
      await sess.issueTicketingSession('u-sa', 'org-b', { replaceSessionId: victimId })
      expect((await sessions()).find(r => r.id === victimId)!.revoked_at).toBeNull()
    })

    it('password change: the SAME transaction revokes every open Eve session of that user only; a failed change revokes nothing', async () => {
      const a = (await sess.issueTicketingSession('u-mgr', 'org-a'))!
      const b = (await sess.issueTicketingSession('u-mgr', 'org-a'))!
      const other = (await sess.issueTicketingSession('u-other', 'org-b'))!
      const bId = (await sess.verifyTicketingSession(b.token))!.jti
      await login.handleTicketingLogout(withSession(b.token)) // already revoked: keeps its original reason

      const { default: sql } = await import('@/lib/db')
      await sql.transaction([
        sql`UPDATE users SET password_hash = ${'new-hash'} WHERE id = ${'u-mgr'}`,
        revoke.revokeUserSessionsQuery('u-mgr'),
      ] as never)
      expect((await auth.authorizeTicketingApiRequest(withSession(a.token), 'viewer')).ok).toBe(false)
      expect((await auth.authorizeTicketingApiRequest(withSession(other.token), 'viewer')).ok).toBe(true)
      const rows = await sessions()
      expect(rows.find(r => r.id === bId)!.revoked_reason).toBe('LOGOUT')
      expect(rows.filter(r => r.user_id === 'u-mgr' && r.id !== bId).every(r => r.revoked_reason === 'PASSWORD_CHANGE')).toBe(true)

      const c = (await sess.issueTicketingSession('u-mgr', 'org-a'))!
      await expect(sql.transaction([
        sql`UPDATE users SET password_hash = ${'x'} WHERE id = ${'u-mgr'}`,
        revoke.revokeUserSessionsQuery('u-mgr'),
        sql`UPDATE users SET no_such_column = 1`,
      ] as never)).rejects.toThrow()
      expect((await auth.authorizeTicketingApiRequest(withSession(c.token), 'viewer')).ok).toBe(true) // nothing was revoked
      const [{ password_hash }] = await q<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = 'u-mgr'`)
      expect(password_hash).toBe('new-hash') // and the failed password write did not apply either
    })

    it('the fresh checks still decide, with the SAME token: role, user status, organisation and Events capability', async () => {
      const { token } = (await sess.issueTicketingSession('u-mgr', 'org-a'))!
      expect((await auth.authorizeTicketingApiRequest(withSession(token), 'manager')).ok).toBe(true)
      await q(`UPDATE users SET role = 'VIEWER' WHERE id = 'u-mgr'`)
      const down = await auth.authorizeTicketingApiRequest(withSession(token), 'manager')
      expect(!down.ok && down.response.status).toBe(403)
      expect((await auth.authorizeTicketingApiRequest(withSession(token), 'viewer')).ok).toBe(true)
      await q(`UPDATE users SET status = 'INACTIVE' WHERE id = 'u-mgr'`)
      const inactive = await auth.authorizeTicketingApiRequest(withSession(token), 'viewer')
      expect(!inactive.ok && inactive.response.status).toBe(401)
      await q(`UPDATE users SET status = 'ACTIVE' WHERE id = 'u-mgr'`)
      await q(`UPDATE organisation_modules SET enabled = false WHERE organisation_id = 'org-a'`)
      const noCap = await auth.authorizeTicketingApiRequest(withSession(token), 'viewer')
      expect(!noCap.ok && noCap.response.status).toBe(403)
      await q(`UPDATE organisation_modules SET enabled = true WHERE organisation_id = 'org-a'`)
      await q(`UPDATE users SET organisation_id = 'org-b' WHERE id = 'u-mgr'`)
      const moved = await auth.authorizeTicketingApiRequest(withSession(token), 'viewer')
      expect(!moved.ok && moved.response.status).toBe(401)
    })

    it('an expired row, a row for another organisation, and a token with no row are all dead', async () => {
      const { token } = (await sess.issueTicketingSession('u-mgr', 'org-a'))!
      const id = (await sess.verifyTicketingSession(token))!.jti
      await q(`UPDATE ticketing_sessions SET created_at = now() - interval '9 hours', expires_at = now() - interval '1 hour' WHERE id = $1`, [id])
      expect((await auth.authorizeTicketingApiRequest(withSession(token), 'viewer')).ok).toBe(false)
      await q(`UPDATE ticketing_sessions SET created_at = now(), expires_at = now() + interval '1 hour', organisation_id = 'org-b' WHERE id = $1`, [id])
      expect((await auth.authorizeTicketingApiRequest(withSession(token), 'viewer')).ok).toBe(false)
      await q(`DELETE FROM ticketing_sessions`)
      expect((await auth.authorizeTicketingApiRequest(withSession(token), 'viewer')).ok).toBe(false)
    })

    it('housekeeping removes at most 100 long-expired rows per call and leaves live ones', async () => {
      await q(`INSERT INTO ticketing_sessions (id, user_id, organisation_id, created_at, expires_at)
               SELECT 'old-' || g, 'u-mgr', 'org-a', now() - interval '3 days', now() - interval '2 days' FROM generate_series(1, 150) g`)
      const live = await sess.issueTicketingSession('u-mgr', 'org-a')
      expect(live).not.toBeNull()
      await sess.pruneTicketingSessions()
      expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM ticketing_sessions`))[0].n).toBe(51)
    })
  })

  // ── rate limiter ──────────────────────────────────────────────────────
  describe('rate limiter', () => {
    const P = (over: Partial<import('@/lib/ticketing/rateLimit').LimitPolicy> = {}) => ({ cls: 'test-class', max: 5, windowSeconds: 3600, outage: 'fallback' as const, ...over })

    it('allows up to max, then limits; counts are exact', async () => {
      const out: boolean[] = []
      for (let i = 0; i < 8; i++) out.push((await rl.limit(P(), ['ip-1'])).allowed)
      expect(out).toEqual([true, true, true, true, true, false, false, false])
    })

    it('is atomic under concurrency: exactly max of 100 parallel requests are allowed', async () => {
      const results = await Promise.all(Array.from({ length: 100 }, () => rl.limit(P({ max: 20 }), ['race'])))
      expect(results.filter(r => r.allowed).length).toBe(20)
      const [{ count }] = await q<{ count: number }>(`SELECT count FROM ticketing_rate_limits`)
      expect(count).toBe(100)
    })

    it('two simulated app instances (separate module state) see ONE shared limit', async () => {
      vi.resetModules()
      const instanceB = await import('@/lib/ticketing/rateLimit')
      const policy = P({ max: 6 })
      const a: boolean[] = [], b: boolean[] = []
      for (let i = 0; i < 5; i++) {
        a.push((await rl.limit(policy, ['shared'])).allowed)
        b.push((await instanceB.limit(policy, ['shared'])).allowed)
      }
      expect([...a, ...b].filter(Boolean)).toHaveLength(6) // 10 requests across two instances, 6 allowed in total
    })

    it('the window rolls over', async () => {
      const policy = P({ max: 2, windowSeconds: 2 })
      for (let attempt = 0; attempt < 3; attempt++) {
        // Align to a fresh window so the three calls cannot straddle a boundary.
        const wait = 2100 - (Date.now() % 2000)
        if (wait < 2100) await new Promise(r => setTimeout(r, wait % 2000 + 50))
        const first = [await rl.limit(policy, ['roll']), await rl.limit(policy, ['roll']), await rl.limit(policy, ['roll'])].map(r => r.allowed)
        if (first.join() !== 'true,true,false') continue
        await new Promise(r => setTimeout(r, 2200))
        expect((await rl.limit(policy, ['roll'])).allowed).toBe(true)
        return
      }
      throw new Error('could not observe a clean window')
    }, 20_000)

    it('keys are isolated by class, organisation, user, event and address; dimensions cannot collide', async () => {
      const policy = P({ max: 1 })
      expect((await rl.limit(policy, ['org-a', 'u1', 'ev1'])).allowed).toBe(true)
      expect((await rl.limit(policy, ['org-a', 'u1', 'ev1'])).allowed).toBe(false)
      for (const other of [['org-b', 'u1', 'ev1'], ['org-a', 'u2', 'ev1'], ['org-a', 'u1', 'ev2'], ['org-a', 'u1']]) {
        expect((await rl.limit(policy, other)).allowed).toBe(true)
      }
      expect((await rl.limit(P({ max: 1, cls: 'other-class' }), ['org-a', 'u1', 'ev1'])).allowed).toBe(true)
      expect(rl.limiterKeyHash('c', ['ab', 'c'])).not.toBe(rl.limiterKeyHash('c', ['a', 'bc']))
      expect(rl.limiterKeyHash('c', ['x'])).toMatch(/^[0-9a-f]{64}$/)
    })

    it('stores no email, address, id or token in the clear: only 64-hex key hashes', async () => {
      const secrets = ['someone@example.com', '203.0.113.77', 'u-secret-user', 'ticket-token-ABC123', 'org-a']
      await rl.limit(P(), secrets)
      await rl.limit(rl.LIMITS.loginUser, ['someone@example.com'])
      const rows = await q<Record<string, unknown>>(`SELECT * FROM ticketing_rate_limits`)
      expect(rows.length).toBeGreaterThan(1)
      const blob = JSON.stringify(rows)
      for (const s of secrets) expect(blob).not.toContain(s)
      for (const r of rows) expect(r.key_hash).toMatch(/^[0-9a-f]{64}$/)
      const cols = await q<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ticketing_rate_limits' ORDER BY 1`)
      expect(cols.map(c => c.column_name)).toEqual(['count', 'expires_at', 'key_hash', 'window_start'])
    })

    it('malformed / hostile dimension values are hashed, never interpreted', async () => {
      for (const d of ["'; DROP TABLE ticketing_rate_limits;--", '', '\u0000', 'x'.repeat(10_000), '日本語']) {
        expect((await rl.limit(P({ max: 100 }), [d])).allowed).toBe(true)
      }
      expect((await q(`SELECT 1 FROM ticketing_rate_limits`)).length).toBe(5)
    })

    it('outage: a FAIL-CLOSED class denies (UNAVAILABLE); a FALLBACK class degrades to the in-memory limiter and is logged without identifiers', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      db.down = true
      expect(await rl.limit(P({ outage: 'closed' }), ['x'])).toEqual({ allowed: false, reason: 'UNAVAILABLE' })
      const policy = P({ max: 2, cls: 'fallback-class' })
      const r = [await rl.limit(policy, ['sensitive-ip-9.9.9.9'], 'mem:key:1'), await rl.limit(policy, ['sensitive-ip-9.9.9.9'], 'mem:key:1'), await rl.limit(policy, ['sensitive-ip-9.9.9.9'], 'mem:key:1')]
      expect(r.map(x => x.allowed)).toEqual([true, true, false])
      expect(r[0]).toMatchObject({ allowed: true, degraded: true })
      const logged = warn.mock.calls.map(c => String(c[0])).join('\n')
      expect(logged).toContain('ticketing_rate_limit_degraded')
      expect(logged).toContain('ticketing_rate_limit_unavailable')
      expect(logged).not.toMatch(/sensitive-ip|9\.9\.9\.9|mem:key/)
      warn.mockRestore()
    })

    it('login: the limiter being down returns 503 and never a token', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      await q(`UPDATE users SET password_hash = $1 WHERE id = 'u-mgr'`, [(await import('bcryptjs')).default.hashSync('pw-correct', 4)])
      const body = JSON.stringify({ username: 'mgr', password: 'pw-correct' })
      const req = () => new Request('http://bb.test/login', { method: 'POST', headers: { ...GATE, 'content-type': 'application/json', 'x-ticketing-client-ip': '198.51.100.7' }, body })
      expect((await login.handleTicketingLogin(req())).status).toBe(200)
      await q(`DROP TABLE ticketing_rate_limits`) // limiter store gone => outage
      const res = await login.handleTicketingLogin(req())
      expect(res.status).toBe(503)
      expect(JSON.stringify(await res.json())).not.toMatch(/token/i)
      await db.pool.query(fs.readFileSync(path.join(process.cwd(), MIGRATION), 'utf8'))
      warn.mockRestore()
    })

    it('cleanup is bounded: one pass removes at most 200 expired rows and never a live one', async () => {
      await q(`INSERT INTO ticketing_rate_limits (key_hash, window_start, count, expires_at)
               SELECT md5(g::text) || md5((g+1)::text), now() - interval '2 days', 1, now() - interval '1 day' FROM generate_series(1, 300) g`)
      const rnd = vi.spyOn(Math, 'random').mockReturnValue(0)
      await rl.limit(P(), ['live-row'])
      await new Promise(r => setTimeout(r, 300)) // the prune is fire-and-forget
      rnd.mockRestore()
      const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM ticketing_rate_limits`)
      expect(n).toBe(100 + 1) // 300 expired - 200 pruned + the live row
      expect((await q(`SELECT 1 FROM ticketing_rate_limits WHERE expires_at > now()`)).length).toBe(1)
    })

    it('resetLimit clears one key only', async () => {
      await rl.limit(P({ max: 1 }), ['a']); await rl.limit(P({ max: 1 }), ['b'])
      await rl.resetLimit(P(), ['a'])
      expect((await rl.limit(P({ max: 1 }), ['a'])).allowed).toBe(true)
      expect((await rl.limit(P({ max: 1 }), ['b'])).allowed).toBe(false)
    })

    it('benchmark: sequential and parallel increments are fast enough for the intended load', async () => {
      const policy = P({ max: 1_000_000 })
      await rl.limit(policy, ['warm'])
      const N = 300
      const t0 = performance.now()
      for (let i = 0; i < N; i++) await rl.limit(policy, [`bench-${i % 10}`])
      const seqMs = (performance.now() - t0) / N
      const t1 = performance.now()
      await Promise.all(Array.from({ length: 300 }, (_, i) => rl.limit(policy, [`par-${i % 5}`])))
      const parMs = performance.now() - t1
      console.log(`[bench] sequential ${seqMs.toFixed(2)} ms/op, 300 parallel in ${parMs.toFixed(0)} ms (local container; Neon adds network latency)`)
      expect(seqMs).toBeLessThan(25)
      expect(parMs).toBeLessThan(5000)
    }, 60_000)
  })
})
