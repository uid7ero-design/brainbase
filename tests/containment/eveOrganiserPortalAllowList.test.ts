import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'

// Eve organiser allow-list — the Eve ORGANISER PORTAL. Everything behind Eve
// sign-in goes through /api/ticketing/auth/* and authorizeTicketingApiRequest,
// so an organisation with settings.events.eveEnabled !== true can neither sign
// in to Eve nor keep using an existing Eve session. BrainBase's own organiser
// and admin (authorizeEventsRequest, session cookies) never read the setting.
// Every database dependency is mocked; no Production connection exists here.

process.env.EVE_SESSION_SECRET = 'eve-test-secret-0123456789abcdef0123456789abcdef'
process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'

type Row = Record<string, unknown>
const ENABLED = { events: { eveEnabled: true } }
const db: { users: Row[]; orgs: Row[]; entitled: Set<string>; sessions: Map<string, { user: string; org: string; revoked: string | null }>; counters: Map<string, number> } = {
  users: [], orgs: [], entitled: new Set(), sessions: new Map(), counters: new Map(),
}
const eveOn = (o: Row) => (o.settings as { events?: { eveEnabled?: unknown } } | null | undefined)?.events?.eveEnabled === true

const sqlMock = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const q = strings.join('?')
  if (q.includes('INSERT INTO ticketing_rate_limits')) {
    const k = String(values[0]); const n = (db.counters.get(k) ?? 0) + 1; db.counters.set(k, n); return [{ count: n }]
  }
  if (q.includes('DELETE FROM ticketing_rate_limits') || q.includes('DELETE FROM ticketing_sessions')) return []
  if (q.includes('INSERT INTO ticketing_sessions')) {
    db.sessions.set(String(values[0]), { user: String(values[1]), org: String(values[2]), revoked: null }); return []
  }
  if (q.includes('UPDATE ticketing_sessions')) {
    if (q.includes("'ORG_SWITCH'")) { const s = db.sessions.get(String(values[0])); if (s && s.user === values[1]) s.revoked = 'ORG_SWITCH' }
    return []
  }
  if (q.includes('FROM users WHERE username')) return db.users.filter(u => u.username === values[0])
  if (q.includes('FROM users WHERE id')) {
    const s = db.sessions.get(String(values[0]))
    const live = !!s && s.user === values[2] && s.org === values[1] && !s.revoked
    return db.users.filter(u => u.id === values[2]).map(u => ({ ...u, session_live: live }))
  }
  if (q.includes('FROM organisations WHERE id')) return db.orgs.filter(o => o.id === values[0])
  if (q.includes('FROM organisations o')) {
    // The real query filters on settings -> 'events' -> 'eveEnabled' = 'true'::jsonb (asserted below).
    return db.orgs.filter(o => o.status === 'ACTIVE' && db.entitled.has(o.id as string) && eveOn(o))
  }
  return []
})
vi.mock('@/lib/db', () => ({
  default: Object.assign(
    (...a: unknown[]) => ({ then: (res: (v: Row[]) => unknown, rej: (e: unknown) => unknown) => (sqlMock as unknown as (...x: unknown[]) => Promise<Row[]>)(...a).then(res, rej) }),
    { transaction: async (qs: PromiseLike<unknown>[]) => { const out: unknown[] = []; for (const q of qs) out.push(await q); return out } },
  ),
}))
vi.mock('@/lib/capabilities/requireCapability', async (orig) => {
  const actual = await orig<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    checkCapability: async (org: string) => db.entitled.has(org) ? { allowed: true, entitlement: { key: 'events', config: {} } } : { allowed: false, reason: 'NO_ENTITLEMENT' },
    requireCapability: async (org: string) => {
      if (!db.entitled.has(org)) throw new actual.CapabilityAccessError('NO_ENTITLEMENT')
      return { key: 'events', config: {} }
    },
  }
})

const { handleTicketingLogin, handleOrganisationSwitch, handleOrganisationList } = await import('@/lib/ticketing/login')
const { authorizeTicketingApiRequest } = await import('@/lib/ticketing/authorize')
const { issueTicketingSession } = await import('@/lib/ticketing/session')
const sessionRoute = await import('@/app/api/ticketing/auth/session/route')
const { handleOrganiserEvents, handleOrganiserCheckIn } = await import('@/lib/ticketing/organiserApi')

const PW = 'correct horse'
const HASH = bcrypt.hashSync(PW, 4)
const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }
let n = 0
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('http://brainbase.test/api/ticketing/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', ...GATE, 'x-ticketing-client-ip': `10.1.0.${++n}`, ...headers }, body: JSON.stringify(body),
})
const withSession = (token: string, init: RequestInit = {}) =>
  new Request('http://brainbase.test/x', { ...init, headers: { ...GATE, 'x-ticketing-session': token, 'content-type': 'application/json' } })
const tok = async (u: string, o: string) => (await issueTicketingSession(u, o))!.token
const org = (id: string) => db.orgs.find(o => o.id === id)!
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

beforeEach(() => {
  db.sessions = new Map(); db.counters = new Map()
  db.entitled = new Set(['org-on', 'org-ld', 'org-other-on'])
  db.orgs = [
    // Enabled on Eve.
    { id: 'org-on', name: 'On Org', slug: 'on', status: 'ACTIVE', settings: ENABLED },
    { id: 'org-other-on', name: 'Other On', slug: 'other-on', status: 'ACTIVE', settings: { branding: { name: 'X' }, ...ENABLED } },
    // LD Tennis-style: Events entitlement + published events, never enabled on Eve.
    { id: 'org-ld', name: 'LD Tennis', slug: 'ld-tennis', status: 'ACTIVE', settings: { branding: { name: 'LD' } } },
    // No Events at all.
    { id: 'org-noev', name: 'No Events', slug: 'noev', status: 'ACTIVE', settings: ENABLED },
  ]
  db.users = [
    { id: 'u-on', username: 'on', password_hash: HASH, organisation_id: 'org-on', role: 'MANAGER', status: 'ACTIVE', name: 'On' },
    { id: 'u-ld', username: 'ld', password_hash: HASH, organisation_id: 'org-ld', role: 'ADMIN', status: 'ACTIVE', name: 'LD admin' },
    { id: 'u-noev', username: 'noev', password_hash: HASH, organisation_id: 'org-noev', role: 'ADMIN', status: 'ACTIVE', name: 'NoEv' },
    { id: 'u-sa', username: 'sa', password_hash: HASH, organisation_id: 'org-ld', role: 'SUPER_ADMIN', status: 'ACTIVE', name: 'SA' },
  ]
})

describe('sign-in to the Eve organiser portal', () => {
  it('a disabled (LD Tennis-style) organisation cannot sign in: 403 EVE_NOT_ENABLED, no token, no session row', async () => {
    const res = await handleTicketingLogin(post({ username: 'ld', password: PW }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ error: 'EVE_NOT_ENABLED' })
    expect(db.sessions.size).toBe(0)
  })

  it('an enabled organisation signs in as before', async () => {
    const res = await handleTicketingLogin(post({ username: 'on', password: PW }))
    expect(res.status).toBe(200)
    expect((await res.json()).organisationId).toBe('org-on')
  })

  it('missing settings, false, and the string "true" are all disabled (default false)', async () => {
    for (const settings of [null, {}, { events: {} }, { events: { eveEnabled: false } }, { events: { eveEnabled: 'true' } }, { events: { eveEnabled: 1 } }]) {
      org('org-ld').settings = settings
      expect((await handleTicketingLogin(post({ username: 'ld', password: PW }))).status, JSON.stringify(settings)).toBe(403)
    }
  })

  it('nothing is revealed before the password is verified: a wrong password on a disabled org is the generic 401', async () => {
    const wrong = await handleTicketingLogin(post({ username: 'ld', password: 'nope' }))
    const ghost = await handleTicketingLogin(post({ username: 'ghost', password: PW }))
    expect(wrong.status).toBe(401)
    expect(await wrong.text()).toBe(await ghost.text())
  })

  it('an organisation without Events keeps the generic 401 (unchanged), even with the Eve flag set', async () => {
    const res = await handleTicketingLogin(post({ username: 'noev', password: PW }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid username or password.' })
  })

  it('no leakage: the refusal carries only a code, never an organisation id, name or the enabled list', async () => {
    const text = await (await handleTicketingLogin(post({ username: 'ld', password: PW }))).text()
    expect(text).not.toMatch(/org-|On Org|Other On|LD Tennis|ld-tennis|organisations/)
  })
})

describe('super_admin', () => {
  it('home organisation disabled: chooses among ENABLED organisations only', async () => {
    const res = await handleTicketingLogin(post({ username: 'sa', password: PW }))
    expect(res.status).toBe(409)
    expect((await res.json()).organisations.map((o: Row) => o.id)).toEqual(['org-on', 'org-other-on'])
    expect((await handleTicketingLogin(post({ username: 'sa', password: PW, organisationId: 'org-ld' }))).status).toBe(401)
    expect((await handleTicketingLogin(post({ username: 'sa', password: PW, organisationId: 'org-on' }))).status).toBe(200)
  })

  it('no organisation enabled at all (the state on deploy): 403 EVE_NOT_ENABLED, not an empty chooser', async () => {
    for (const o of db.orgs) o.settings = {}
    const res = await handleTicketingLogin(post({ username: 'sa', password: PW }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'EVE_NOT_ENABLED' })
  })

  it('cannot switch into, or see in the list, a disabled organisation', async () => {
    const t = await tok('u-sa', 'org-on')
    const sw = (id: string) => withSession(t, { method: 'POST', body: JSON.stringify({ organisationId: id }) })
    expect((await handleOrganisationSwitch(sw('org-ld'))).status).toBe(403)
    const list = await handleOrganisationList(withSession(t))
    expect((await list.json()).organisations.map((o: Row) => o.id)).toEqual(['org-on', 'org-other-on'])
  })
})

describe('existing Eve sessions', () => {
  it('stop working on the very next call once the organisation is disabled, and work again when re-enabled', async () => {
    const t = await tok('u-on', 'org-on')
    expect((await sessionRoute.GET(withSession(t))).status).toBe(200)
    org('org-on').settings = { events: { eveEnabled: false } }
    const off = await sessionRoute.GET(withSession(t))
    expect(off.status).toBe(403)
    expect(await off.json()).toEqual({ error: 'EVE_NOT_ENABLED' })
    expect((await handleOrganiserEvents(withSession(t))).status).toBe(403)
    org('org-on').settings = ENABLED
    expect((await sessionRoute.GET(withSession(t))).status).toBe(200)
  })

  it('every organiser API refuses a disabled organisation before reading anything (events, check-in)', async () => {
    const t = await tok('u-ld', 'org-ld')
    const before = sqlMock.mock.calls.length
    expect((await handleOrganiserEvents(withSession(t))).status).toBe(403)
    expect((await handleOrganiserCheckIn(withSession(t, { method: 'POST', body: '{}' }), 'ev-1', 'confirm')).status).toBe(403)
    const reads = sqlMock.mock.calls.slice(before).map(c => (c[0] as TemplateStringsArray).join('?'))
    expect(reads.some(q => /event_orders|event_tickets|FROM events/.test(q))).toBe(false)
  })

  it('tenant isolation: one organisation being enabled never admits another', async () => {
    const ld = await tok('u-ld', 'org-ld')
    const res = await authorizeTicketingApiRequest(withSession(ld), 'viewer')
    expect(res.ok).toBe(false)
    // org-on stays enabled and usable alongside it.
    expect((await authorizeTicketingApiRequest(withSession(await tok('u-on', 'org-on')), 'viewer')).ok).toBe(true)
    // A disabled org's user cannot borrow an enabled org's id.
    expect((await authorizeTicketingApiRequest(withSession(await tok('u-ld', 'org-on')), 'viewer')).ok).toBe(false)
  })
})

describe('boundaries (source)', () => {
  it('the org list query filters on the JSON boolean, not a string', () => {
    expect(read('lib/ticketing/login.ts')).toContain(`(o.settings -> 'events' -> 'eveEnabled') = 'true'::jsonb`)
  })

  it("BrainBase's own organiser/admin auth never reads the Eve setting", () => {
    for (const rel of ['lib/events/authorize.ts', 'lib/session.ts', 'middleware.ts']) {
      if (!fs.existsSync(path.join(process.cwd(), rel))) continue
      expect(read(rel), rel).not.toMatch(/eveEnabled|isEveEnabledSetting|eveEnablement/)
    }
  })

  it('the Eve ticketing auth is used only by the Eve server-to-server surface', () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(p)
      return /\.(ts|tsx)$/.test(e.name) ? [p] : []
    })
    const users = ['app', 'lib', 'components']
      .flatMap(d => walk(path.join(process.cwd(), d)))
      .map(f => path.relative(process.cwd(), f).replace(/\\/g, '/'))
      .filter(f => read(f).includes("@/lib/ticketing/authorize'"))
    for (const f of users) expect(f).toMatch(/^(app\/api\/ticketing\/|lib\/ticketing\/)/)
  })

  it('historical buyer artefacts (/t, /b, checkout status) do not go through the organiser auth', () => {
    expect(read('lib/ticketing/publicApi.ts')).not.toContain('authorizeTicketingApiRequest')
  })
})
