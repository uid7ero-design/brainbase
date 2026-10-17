import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'

// Eve Phase 2A — auth foundation. Every database dependency is mocked; no
// Production connection exists in this file.

process.env.EVE_SESSION_SECRET = 'eve-test-secret-0123456789abcdef0123456789abcdef'
process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'

type Row = Record<string, unknown>
const db: { users: Row[]; orgs: Row[]; entitled: Set<string>; fail: boolean } = {
  users: [], orgs: [], entitled: new Set(), fail: false,
}

const sqlMock = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  if (db.fail) throw new Error('db down')
  const q = strings.join('?')
  if (q.includes('FROM users WHERE username')) return db.users.filter(u => u.username === values[0])
  if (q.includes('FROM users WHERE id')) return db.users.filter(u => u.id === values[0])
  if (q.includes('FROM organisations WHERE id')) return db.orgs.filter(o => o.id === values[0])
  if (q.includes('FROM organisations o')) return db.orgs.filter(o => o.status === 'ACTIVE' && db.entitled.has(o.id as string))
  return []
})
vi.mock('@/lib/db', () => ({ default: (...a: unknown[]) => (sqlMock as unknown as (...x: unknown[]) => Promise<Row[]>)(...a) }))

vi.mock('@/lib/capabilities/requireCapability', async (orig) => {
  const actual = await orig<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    checkCapability: async (org: string) =>
      db.entitled.has(org) ? { allowed: true, entitlement: { key: 'events', config: {} } } : { allowed: false, reason: 'NO_ENTITLEMENT' },
    requireCapability: async (org: string) => {
      if (db.fail) throw new actual.CapabilityDatabaseError()
      if (!db.entitled.has(org)) throw new actual.CapabilityAccessError('NO_ENTITLEMENT')
      return { key: 'events', config: {} }
    },
  }
})

const { handleTicketingLogin, handleOrganisationSwitch, handleOrganisationList } = await import('@/lib/ticketing/login')
const { authorizeTicketingApiRequest } = await import('@/lib/ticketing/authorize')
const { issueTicketingSession, verifyTicketingSession } = await import('@/lib/ticketing/session')
const { decrypt } = await import('@/lib/session')
const sessionRoute = await import('@/app/api/ticketing/auth/session/route')
const logoutRoute = await import('@/app/api/ticketing/auth/logout/route')
const policy = await import('@ticketing/core/sessionPolicy')

const PW = 'correct horse'
const HASH = bcrypt.hashSync(PW, 4)
const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }

function post(body: unknown, headers: Record<string, string> = GATE) {
  return new Request('http://brainbase.test/api/ticketing/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  })
}
function withSession(token: string, headers: Record<string, string> = {}) {
  return new Request('http://brainbase.test/x', { headers: { ...GATE, 'x-ticketing-session': token, ...headers } })
}
let n = 0
const freshIp = () => ({ ...GATE, 'x-ticketing-client-ip': `10.0.0.${++n}` })
const tok = async (u: string, o: string) => (await issueTicketingSession(u, o))!.token

beforeEach(() => {
  db.fail = false
  db.entitled = new Set(['org-a', 'org-b'])
  db.orgs = [
    { id: 'org-a', name: 'A', status: 'ACTIVE' },
    { id: 'org-b', name: 'B', status: 'ACTIVE' },
    { id: 'org-c', name: 'C (no events)', status: 'ACTIVE' },
  ]
  db.users = [
    { id: 'u-mgr', username: 'mgr', password_hash: HASH, organisation_id: 'org-a', role: 'MANAGER', status: 'ACTIVE', name: 'Mgr' },
    { id: 'u-view', username: 'view', password_hash: HASH, organisation_id: 'org-a', role: 'VIEWER', status: 'ACTIVE', name: 'View' },
    { id: 'u-off', username: 'off', password_hash: HASH, organisation_id: 'org-a', role: 'MANAGER', status: 'INACTIVE', name: 'Off' },
    { id: 'u-noev', username: 'noev', password_hash: HASH, organisation_id: 'org-c', role: 'ADMIN', status: 'ACTIVE', name: 'NoEv' },
    { id: 'u-sa', username: 'sa', password_hash: HASH, organisation_id: 'org-a', role: 'SUPER_ADMIN', status: 'ACTIVE', name: 'SA' },
    { id: 'u-sa2', username: 'sa2', password_hash: HASH, organisation_id: 'org-c', role: 'SUPER_ADMIN', status: 'ACTIVE', name: 'SA2' },
  ]
})

describe('login', () => {
  it('issues a token for a valid active user in an entitled org', async () => {
    const res = await handleTicketingLogin(post({ username: 'Mgr', password: PW }, freshIp()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.organisationId).toBe('org-a')
    expect((await verifyTicketingSession(body.token))?.userId).toBe('u-mgr')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(JSON.stringify(body)).not.toMatch(/password|hash/i)
  })

  it('returns the identical generic 401 for wrong password, missing, disabled and un-entitled', async () => {
    const cases = [
      { username: 'mgr', password: 'nope' }, { username: 'ghost', password: PW },
      { username: 'off', password: PW }, { username: 'noev', password: PW },
    ]
    const bodies = []
    for (const c of cases) {
      const res = await handleTicketingLogin(post(c, freshIp()))
      expect(res.status).toBe(401)
      bodies.push(await res.text())
    }
    expect(new Set(bodies).size).toBe(1)
  })

  it('rate limits repeated attempts for one username', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) statuses.push((await handleTicketingLogin(post({ username: 'ratelimited', password: 'x' }, freshIp()))).status)
    expect(statuses.slice(0, 10).every(s => s === 401)).toBe(true)
    expect(statuses[11]).toBe(429)
  })

  it('refuses a browser-origin request and a request without the gate secret', async () => {
    expect((await handleTicketingLogin(post({ username: 'mgr', password: PW }, { ...GATE, origin: 'https://evil.test' }))).status).toBe(403)
    expect((await handleTicketingLogin(post({ username: 'mgr', password: PW }, {}))).status).toBe(401)
    expect((await handleTicketingLogin(post({ username: 'mgr', password: PW }, { 'x-ticketing-api-key': 'wrong' }))).status).toBe(401)
  })

  it('does not let an ordinary user pick another organisation', async () => {
    const res = await handleTicketingLogin(post({ username: 'mgr', password: PW, organisationId: 'org-b' }, freshIp()))
    expect(res.status).toBe(401)
  })

  it('super_admin with an ineligible home org must select an eligible one', async () => {
    const res = await handleTicketingLogin(post({ username: 'sa2', password: PW }, freshIp()))
    expect(res.status).toBe(409)
    expect((await res.json()).organisations.map((o: Row) => o.id)).toEqual(['org-a', 'org-b'])
    const ok = await handleTicketingLogin(post({ username: 'sa2', password: PW, organisationId: 'org-b' }, freshIp()))
    expect(ok.status).toBe(200)
    const bad = await handleTicketingLogin(post({ username: 'sa2', password: PW, organisationId: 'org-c' }, freshIp()))
    expect(bad.status).toBe(401)
  })
})

describe('session token', () => {
  it('carries identifiers, audience and expiry only', async () => {
    const token = await tok('u-mgr', 'org-a')
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'org', 'sub'])
    expect(payload.aud).toBe(policy.TICKETING_SESSION_AUDIENCE)
  })

  it('rejects expired, wrong-audience and wrong-secret tokens', async () => {
    const key = new TextEncoder().encode(process.env.EVE_SESSION_SECRET!)
    const base = (aud: string, exp: number, k = key) =>
      new SignJWT({ org: 'org-a' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(policy.TICKETING_SESSION_ISSUER)
        .setAudience(aud).setSubject('u-mgr').setIssuedAt(exp - 120).setExpirationTime(exp).sign(k)
    const now = Math.floor(Date.now() / 1000)
    expect(await verifyTicketingSession(await base(policy.TICKETING_SESSION_AUDIENCE, now + 60))).not.toBeNull()
    expect(await verifyTicketingSession(await base(policy.TICKETING_SESSION_AUDIENCE, now - 60))).toBeNull()
    expect(await verifyTicketingSession(await base('other-product', now + 60))).toBeNull()
    expect(await verifyTicketingSession(await base(policy.TICKETING_SESSION_AUDIENCE, now + 60, new TextEncoder().encode('x'.repeat(40))))).toBeNull()
  })

  it('does not accept a BrainBase session token, and BrainBase does not accept an Eve token', async () => {
    const bb = await new SignJWT({ userId: 'u-mgr', organisationId: 'org-a', role: 'manager', name: 'x', expiresAt: 'x' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('12h')
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET!))
    expect(await verifyTicketingSession(bb)).toBeNull()
    expect(await decrypt(await tok('u-mgr', 'org-a'))).toBeNull()
  })

  it('refuses to sign when the secret is missing, short, or equal to SESSION_SECRET', async () => {
    const saved = process.env.EVE_SESSION_SECRET
    try {
      process.env.EVE_SESSION_SECRET = 'short'
      expect(await issueTicketingSession('u', 'o')).toBeNull()
      process.env.EVE_SESSION_SECRET = process.env.SESSION_SECRET
      expect(await issueTicketingSession('u', 'o')).toBeNull()
      delete process.env.EVE_SESSION_SECRET
      expect(await issueTicketingSession('u', 'o')).toBeNull()
    } finally { process.env.EVE_SESSION_SECRET = saved }
  })

  it('logout directs the cookie to be cleared and needs the gate', async () => {
    const ok = await logoutRoute.POST(new Request('http://x/', { method: 'POST', headers: GATE }))
    expect((await ok.json()).clearCookie).toBe(true)
    expect((await logoutRoute.POST(new Request('http://x/', { method: 'POST' }))).status).toBe(401)
  })

  it('cookie policy: distinct name, HttpOnly, strict, host-only', () => {
    expect(policy.TICKETING_SESSION_COOKIE).not.toBe('session')
    const o = policy.ticketingCookieOptions(true)
    expect(o).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' })
    expect('domain' in o).toBe(false)
  })

  it('same-origin check requires an exactly matching Origin', () => {
    expect(policy.isSameOrigin('https://eve.test', 'https://eve.test')).toBe(true)
    expect(policy.isSameOrigin('https://evil.test', 'https://eve.test')).toBe(false)
    expect(policy.isSameOrigin(null, 'https://eve.test')).toBe(false)
    expect(policy.isSameOrigin('not a url', 'https://eve.test')).toBe(false)
  })
})

describe('authorizeTicketingApiRequest', () => {
  it('allows an active entitled user and reloads role from the DB', async () => {
    const t = await tok('u-view', 'org-a')
    const r = await authorizeTicketingApiRequest(withSession(t), 'viewer')
    expect(r.ok && r.context.role).toBe('viewer')
    const denied = await authorizeTicketingApiRequest(withSession(t), 'manager')
    expect(!denied.ok && denied.response.status).toBe(403)
    db.users[1].role = 'MANAGER' // promoted after token issue
    expect((await authorizeTicketingApiRequest(withSession(t), 'manager')).ok).toBe(true)
  })

  it('denies a user disabled after the token was issued', async () => {
    const t = await tok('u-mgr', 'org-a')
    db.users[0].status = 'INACTIVE'
    const r = await authorizeTicketingApiRequest(withSession(t), 'viewer')
    expect(!r.ok && r.response.status).toBe(401)
  })

  it('denies when the Events capability is removed after issue', async () => {
    const t = await tok('u-mgr', 'org-a')
    db.entitled.delete('org-a')
    const r = await authorizeTicketingApiRequest(withSession(t), 'viewer')
    expect(!r.ok && r.response.status).toBe(403)
  })

  it('denies a non-super_admin whose token org differs from their DB org (cross-tenant)', async () => {
    const r = await authorizeTicketingApiRequest(withSession(await tok('u-mgr', 'org-b')), 'viewer')
    expect(!r.ok && r.response.status).toBe(401)
  })

  it('denies a suspended organisation and fails closed on DB errors', async () => {
    const t = await tok('u-mgr', 'org-a')
    db.orgs[0].status = 'SUSPENDED'
    expect((await authorizeTicketingApiRequest(withSession(t), 'viewer')).ok).toBe(false)
    db.orgs[0].status = 'ACTIVE'
    db.fail = true
    const r = await authorizeTicketingApiRequest(withSession(t), 'viewer')
    expect(!r.ok && r.response.status).toBe(503)
  })

  it('denies an unrecognised role (analyst) and a missing/garbage token', async () => {
    db.users[0].role = 'ANALYST'
    const r = await authorizeTicketingApiRequest(withSession(await tok('u-mgr', 'org-a')), 'viewer')
    expect(!r.ok && r.response.status).toBe(403)
    expect((await authorizeTicketingApiRequest(withSession('garbage'), 'viewer')).ok).toBe(false)
    expect((await authorizeTicketingApiRequest(new Request('http://x/', { headers: GATE }), 'viewer')).ok).toBe(false)
  })

  it('session route returns DB-derived context', async () => {
    const res = await sessionRoute.GET(withSession(await tok('u-mgr', 'org-a')))
    expect(await res.json()).toMatchObject({ organisationId: 'org-a', user: { id: 'u-mgr', role: 'manager' } })
  })
})

describe('super_admin organisation selection', () => {
  const sw = (t: string, organisationId: string) => new Request('http://x/', {
    method: 'POST', headers: { ...GATE, 'x-ticketing-session': t, 'content-type': 'application/json' }, body: JSON.stringify({ organisationId }),
  })

  it('switches to an eligible org only', async () => {
    const t = await tok('u-sa', 'org-a')
    const ok = await handleOrganisationSwitch(sw(t, 'org-b'))
    expect(ok.status).toBe(200)
    expect((await verifyTicketingSession((await ok.json()).token))?.organisationId).toBe('org-b')
    expect((await handleOrganisationSwitch(sw(t, 'org-c'))).status).toBe(403)
    expect((await handleOrganisationSwitch(sw(t, 'org-missing'))).status).toBe(403)
  })

  it('refuses non-super_admin users and lists only entitled orgs', async () => {
    expect((await handleOrganisationSwitch(sw(await tok('u-mgr', 'org-a'), 'org-b'))).status).toBe(403)
    const list = await handleOrganisationList(withSession(await tok('u-sa', 'org-a')))
    expect((await list.json()).organisations.map((o: Row) => o.id)).toEqual(['org-a', 'org-b'])
  })

  it('a super_admin whose current org lost Events can still switch away', async () => {
    db.entitled.delete('org-a')
    const ok = await handleOrganisationSwitch(sw(await tok('u-sa', 'org-a'), 'org-b'))
    expect(ok.status).toBe(200)
  })
})

describe('boundary', () => {
  const ROOT = path.resolve(__dirname, '../..')
  function walk(dir: string, out: string[] = []) {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === '.next') continue
      const f = path.join(dir, e)
      if (statSync(f).isDirectory()) walk(f, out); else if (/\.(ts|tsx)$/.test(e)) out.push(f)
    }
    return out
  }

  it('no secret is exposed through NEXT_PUBLIC or client code', () => {
    const dirs = ['lib/ticketing', 'app/api/ticketing', 'apps/eve'].flatMap(d => walk(path.join(ROOT, d)))
    for (const f of dirs) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(EVE_SESSION|TICKETING_API)/)
    }
    for (const f of walk(path.join(ROOT, 'apps/eve'))) {
      const src = readFileSync(f, 'utf8')
      // Eve never holds the session-signing secret; the server-to-server
      // credential is read only by its one server-only config module.
      expect(src, f).not.toMatch(/EVE_SESSION_SECRET/)
      if (!f.replace(/\\/g, '/').endsWith('apps/eve/lib/ticketing/serverConfig.ts') && !f.replace(/\\/g, '/').includes('/apps/eve/tests/')) {
        expect(src, f).not.toMatch(/TICKETING_API_SECRET/)
      }
    }
  })

  it('server modules are server-only and apps/eve holds no SQL, bcrypt or jose', () => {
    for (const m of ['session', 'gate', 'authorize', 'login']) {
      expect(readFileSync(path.join(ROOT, `lib/ticketing/${m}.ts`), 'utf8')).toMatch(/^import 'server-only';/)
    }
    for (const f of walk(path.join(ROOT, 'apps/eve'))) {
      if (f.includes(`${path.sep}tests${path.sep}`)) continue
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/from ['"](bcryptjs|jose)['"]|\bsql`|password_hash/)
    }
  })

  it('the ticketing token never uses SESSION_SECRET as key and BrainBase auth files do not reference it', () => {
    const src = readFileSync(path.join(ROOT, 'lib/ticketing/session.ts'), 'utf8')
    expect(src).toMatch(/process\.env\.EVE_SESSION_SECRET/)
    // The only permitted mention is the equality guard.
    expect([...src.matchAll(/process\.env\.SESSION_SECRET/g)].length).toBe(1)
    expect(src).toMatch(/secret === process\.env\.SESSION_SECRET/)
    for (const f of ['lib/session.ts', 'lib/org.ts', 'lib/events/authorize.ts']) {
      expect(readFileSync(path.join(ROOT, f), 'utf8'), f).not.toMatch(/EVE_SESSION|lib\/ticketing/)
    }
  })

  it('ticketing routes expose no CORS surface', () => {
    for (const f of walk(path.join(ROOT, 'app/api/ticketing'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/Access-Control|export (async )?function OPTIONS|export const OPTIONS/i)
    }
  })
})
