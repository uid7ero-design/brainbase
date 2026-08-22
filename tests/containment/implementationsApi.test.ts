import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Client Implementations Phase 2A — API contract + tenancy behaviour.

const getAuthSessionMock = vi.fn()
vi.mock('@/lib/authSession', () => ({
  getAuthSession: (...args: unknown[]) => getAuthSessionMock(...args),
}))

type SqlCall = { text: string; values: unknown[] }
let sqlCalls: SqlCall[] = []
let responses: {
  orgCheck?: unknown[]; ownerCheck?: unknown[]; insert?: unknown[];
  list?: unknown[]; getOne?: unknown[]; existing?: unknown[]; update?: unknown[];
} = {}

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('')
  sqlCalls.push({ text, values })
  if (text.includes('FROM organisations WHERE id')) return Promise.resolve(responses.orgCheck ?? [])
  if (text.includes('FROM users WHERE id')) return Promise.resolve(responses.ownerCheck ?? [])
  if (text.includes('INSERT INTO implementations')) return Promise.resolve(responses.insert ?? [])
  if (text.includes('SELECT id, organisation_id FROM implementations WHERE id')) return Promise.resolve(responses.existing ?? [])
  if (text.includes('UPDATE implementations')) return Promise.resolve(responses.update ?? [])
  if (text.includes('FROM implementations i') && text.includes('WHERE i.id =')) return Promise.resolve(responses.getOne ?? [])
  if (text.includes('FROM implementations i')) return Promise.resolve(responses.list ?? [])
  return Promise.resolve([])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const { GET: listGET, POST } = await import('@/app/api/implementations/route')
const { GET: oneGET, PATCH } = await import('@/app/api/implementations/[id]/route')

function reset() {
  sqlCalls = []
  responses = {}
  sqlMock.mockClear()
  getAuthSessionMock.mockReset()
}
beforeEach(reset)

function listReq(qs = ''): Request {
  return new Request(`http://localhost/api/implementations${qs}`)
}
function postReq(body: unknown): Request {
  return new Request('http://localhost/api/implementations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
function patchReq(body: unknown): Request {
  return new Request('http://localhost/api/implementations/impl-1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
function idParams(id = 'impl-1') { return { params: Promise.resolve({ id }) } }

// ── Auth gating ──────────────────────────────────────────────────────────

describe('GET /api/implementations — auth gating', () => {
  it('401 with no session', async () => {
    getAuthSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await listGET(listReq())
    expect(res.status).toBe(401)
  })

  it('any authenticated role (viewer) can list — org-scoped', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'viewer', organisationId: 'org-1', userId: 'u1' })
    responses.list = []
    const res = await listGET(listReq())
    expect(res.status).toBe(200)
  })
})

describe('POST /api/implementations — write gating', () => {
  it('401 with no session', async () => {
    getAuthSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await POST(postReq({ name: 'X', organisation_id: 'org-1' }))
    expect(res.status).toBe(401)
  })

  it('403 for viewer (not admin/super_admin)', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'viewer', organisationId: 'org-1', userId: 'u1' })
    const res = await POST(postReq({ name: 'X', organisation_id: 'org-1' }))
    expect(res.status).toBe(403)
  })

  it('403 for manager (not admin/super_admin)', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'manager', organisationId: 'org-1', userId: 'u1' })
    const res = await POST(postReq({ name: 'X', organisation_id: 'org-1' }))
    expect(res.status).toBe(403)
  })
})

// ── Server-side organisation scoping ────────────────────────────────────

describe('Server-side organisation scoping (GET list)', () => {
  it('non-super_admin: the WHERE clause is scoped to session.organisationId, never a client-supplied value — this route takes no organisationId query param honoring for non-super_admin at all', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-real', userId: 'u1' })
    responses.list = []
    // Even if a caller appends ?organisationId=someone-elses-org, a non-
    // super_admin's own session org is what's actually used server-side.
    await listGET(listReq('?organisationId=someone-elses-org'))
    const listCall = sqlCalls.find(c => c.text.includes('FROM implementations i') && !c.text.includes('WHERE i.id ='))
    expect(listCall).toBeDefined()
    expect(listCall!.values).toContain('org-real')
    expect(listCall!.values).not.toContain('someone-elses-org')
  })

  it('super_admin with no filter: scopeOrgId is null (sees every organisation)', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'super_admin', organisationId: 'org-brainbase', userId: 'u1' })
    responses.list = []
    await listGET(listReq())
    const listCall = sqlCalls.find(c => c.text.includes('FROM implementations i') && !c.text.includes('WHERE i.id ='))
    expect(listCall!.values).toContain(null)
  })

  it('super_admin with an explicit ?organisationId= filter: that value is used', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'super_admin', organisationId: 'org-brainbase', userId: 'u1' })
    responses.list = []
    await listGET(listReq('?organisationId=org-target'))
    const listCall = sqlCalls.find(c => c.text.includes('FROM implementations i') && !c.text.includes('WHERE i.id ='))
    expect(listCall!.values).toContain('org-target')
  })
})

// ── Request-body organisation spoofing ──────────────────────────────────

describe('Request-body organisation_id spoofing is rejected for non-super_admin', () => {
  it('admin: body.organisation_id is ignored — the INSERT always uses session.organisationId', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-real', userId: 'u1' })
    responses.insert = [{ id: 'impl-new', organisation_id: 'org-real', name: 'X' }]
    const res = await POST(postReq({ name: 'X', organisation_id: 'org-someone-elses' }))
    expect(res.status).toBe(201)
    const insertCall = sqlCalls.find(c => c.text.includes('INSERT INTO implementations'))
    expect(insertCall!.values).toContain('org-real')
    expect(insertCall!.values).not.toContain('org-someone-elses')
  })
})

// ── SUPER_ADMIN deliberate cross-org behaviour ──────────────────────────

describe('SUPER_ADMIN cross-organisation create is deliberate, not implicit', () => {
  it('super_admin MUST supply organisation_id — 400 if omitted (no implicit default org)', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'super_admin', organisationId: 'org-brainbase', userId: 'u1' })
    const res = await POST(postReq({ name: 'X' }))
    expect(res.status).toBe(400)
  })

  it('super_admin-supplied organisation_id is verified to exist before insert — rejected if it does not', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'super_admin', organisationId: 'org-brainbase', userId: 'u1' })
    responses.orgCheck = [] // organisation lookup returns nothing
    const res = await POST(postReq({ name: 'X', organisation_id: 'org-does-not-exist' }))
    expect(res.status).toBe(400)
    const insertCall = sqlCalls.find(c => c.text.includes('INSERT INTO implementations'))
    expect(insertCall).toBeUndefined() // never reached the insert
  })

  it('super_admin-supplied organisation_id that DOES exist is used for the insert', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'super_admin', organisationId: 'org-brainbase', userId: 'u1' })
    responses.orgCheck = [{ id: 'org-target' }]
    responses.insert = [{ id: 'impl-new', organisation_id: 'org-target', name: 'X' }]
    const res = await POST(postReq({ name: 'X', organisation_id: 'org-target' }))
    expect(res.status).toBe(201)
    const insertCall = sqlCalls.find(c => c.text.includes('INSERT INTO implementations'))
    expect(insertCall!.values).toContain('org-target')
  })
})

// ── Cross-org reads prevented for non-super_admin ───────────────────────

describe('GET /api/implementations/[id] — cross-org read prevention', () => {
  it('a row belonging to a different organisation returns 404 for a non-super_admin caller (not 403 — does not confirm existence)', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-mine', userId: 'u1' })
    responses.getOne = [{ id: 'impl-1', organisation_id: 'org-not-mine', name: 'Secret project' }]
    const res = await oneGET(listReq(), idParams('impl-1'))
    expect(res.status).toBe(404)
  })

  it('a row belonging to the caller\'s own organisation is returned', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-mine', userId: 'u1' })
    responses.getOne = [{ id: 'impl-1', organisation_id: 'org-mine', name: 'My project' }]
    const res = await oneGET(listReq(), idParams('impl-1'))
    expect(res.status).toBe(200)
  })

  it('super_admin can read a row belonging to any organisation', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'super_admin', organisationId: 'org-brainbase', userId: 'u1' })
    responses.getOne = [{ id: 'impl-1', organisation_id: 'org-anyone', name: 'Any project' }]
    const res = await oneGET(listReq(), idParams('impl-1'))
    expect(res.status).toBe(200)
  })

  it('a genuinely nonexistent id returns 404 for everyone', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'super_admin', organisationId: 'org-brainbase', userId: 'u1' })
    responses.getOne = []
    const res = await oneGET(listReq(), idParams('impl-does-not-exist'))
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/implementations/[id] — cross-org write prevention', () => {
  it('non-super_admin cannot PATCH a row belonging to a different organisation (404)', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-mine', userId: 'u1' })
    responses.existing = [{ id: 'impl-1', organisation_id: 'org-not-mine' }]
    const res = await PATCH(patchReq({ name: 'New name' }), idParams('impl-1'))
    expect(res.status).toBe(404)
    const updateCall = sqlCalls.find(c => c.text.includes('UPDATE implementations'))
    expect(updateCall).toBeUndefined()
  })
})

// ── Owner validation ──────────────────────────────────────────────────────

describe('Owner validation', () => {
  it('POST rejects an owner_user_id that does not exist', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-real', userId: 'u1' })
    responses.ownerCheck = []
    const res = await POST(postReq({ name: 'X', owner_user_id: 'user-does-not-exist' }))
    expect(res.status).toBe(400)
  })

  it('POST accepts an owner_user_id that exists', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-real', userId: 'u1' })
    responses.ownerCheck = [{ id: 'user-1' }]
    responses.insert = [{ id: 'impl-new', owner_user_id: 'user-1' }]
    const res = await POST(postReq({ name: 'X', owner_user_id: 'user-1' }))
    expect(res.status).toBe(201)
  })

  it('owner_user_id is NOT required to belong to the implementation\'s own organisation — implementation owners are BrainBase delivery staff, not client-org members (existence-only check, matching the crm_deals.assigned_to precedent)', () => {
    const routeSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/implementations/route.ts'), 'utf-8')
    expect(routeSource).toContain('SELECT id FROM users WHERE id = ${candidate}')
    expect(routeSource).not.toMatch(/owner.*organisation_id\s*===?\s*organisationId/)
  })

  it('PATCH rejects an owner_user_id that does not exist', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-mine', userId: 'u1' })
    responses.existing = [{ id: 'impl-1', organisation_id: 'org-mine' }]
    responses.ownerCheck = []
    const res = await PATCH(patchReq({ owner_user_id: 'user-does-not-exist' }), idParams('impl-1'))
    expect(res.status).toBe(400)
  })
})

// ── API input validation ────────────────────────────────────────────────

describe('API input validation', () => {
  it('POST rejects a missing/empty name', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-real', userId: 'u1' })
    const res = await POST(postReq({}))
    expect(res.status).toBe(400)
  })

  it('POST rejects an invalid explicit stage rather than silently defaulting it', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-real', userId: 'u1' })
    const res = await POST(postReq({ name: 'X', stage: 'not_a_real_stage' }))
    expect(res.status).toBe(400)
  })

  it('POST rejects an invalid explicit health rather than silently defaulting it', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-real', userId: 'u1' })
    const res = await POST(postReq({ name: 'X', health: 'critical' }))
    expect(res.status).toBe(400)
  })

  it('POST rejects invalid JSON', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-real', userId: 'u1' })
    const badReq = new Request('http://localhost/api/implementations', { method: 'POST', body: '{not json' })
    const res = await POST(badReq)
    expect(res.status).toBe(400)
  })

  it('PATCH rejects an invalid explicit stage', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-mine', userId: 'u1' })
    responses.existing = [{ id: 'impl-1', organisation_id: 'org-mine' }]
    const res = await PATCH(patchReq({ stage: 'nonsense' }), idParams('impl-1'))
    expect(res.status).toBe(400)
  })

  it('PATCH rejects clearing name to empty', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-mine', userId: 'u1' })
    responses.existing = [{ id: 'impl-1', organisation_id: 'org-mine' }]
    const res = await PATCH(patchReq({ name: '   ' }), idParams('impl-1'))
    expect(res.status).toBe(400)
  })
})

// ── UI: empty state, no demo data ───────────────────────────────────────

describe('app/admin/implementations/page.tsx — no demo data, real empty state', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/admin/implementations/page.tsx'), 'utf-8')

  it('fetches real data from the API — no hardcoded implementation fixture array', () => {
    expect(source).toContain("fetch('/api/implementations')")
    expect(source).not.toMatch(/const\s+(MOCK|DEMO|SEED|FAKE)_?\w*\s*=\s*\[/i)
  })

  it('renders a genuine empty state, not a placeholder row', () => {
    expect(source).toContain('No implementations yet')
  })

  it('the create form only offers real organisations fetched from /api/admin/orgs, never a hardcoded list', () => {
    expect(source).toContain("fetch('/api/admin/orgs')")
    expect(source).not.toMatch(/const\s+ORGS\s*=\s*\[/i)
  })
})

describe('app/admin/implementations/[id]/page.tsx — core-record only, no later-phase features', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/admin/implementations/[id]/page.tsx'), 'utf-8')
  // Scoped to executable code, not this file's own explanatory header
  // comment, which legitimately names these excluded features when
  // documenting that they're deferred to later slices.
  const executable = source.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

  it('does not include services list, milestones, tasks, progress percentage, activity feed, billing, or Founder OS recommendations', () => {
    for (const forbidden of ['implementation_services', 'milestones', 'progress percentage', 'ActivityFeed', 'billing', 'AiRecommendations']) {
      expect(executable.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})

// ── Scope boundaries — every other system untouched ─────────────────────

describe('Scope boundaries — no unrelated system was touched by this slice', () => {
  it('Founder OS page is untouched', () => {
    const founderSource = fs.readFileSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'), 'utf-8')
    expect(founderSource).not.toContain('implementations')
    expect(founderSource).not.toContain('/api/implementations')
  })

  it('the Phase A attention-queue endpoint is untouched', () => {
    const attnSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/attention-queue/route.ts'), 'utf-8')
    expect(attnSource).not.toContain('implementations')
  })

  it('organiser schema/API is untouched', () => {
    const migrateSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/admin/migrate/route.ts'), 'utf-8')
    expect(migrateSource).not.toContain('implementation_id')
  })

  it('managed_services, client_onboarding, and deployment_proposals routes are untouched', () => {
    const onboarding = fs.readFileSync(path.resolve(__dirname, '../../app/api/deployments/onboarding/route.ts'), 'utf-8')
    const managed = fs.readFileSync(path.resolve(__dirname, '../../app/api/deployments/managed-services/route.ts'), 'utf-8')
    const proposals = fs.readFileSync(path.resolve(__dirname, '../../app/api/web-services/proposals/route.ts'), 'utf-8')
    for (const src of [onboarding, managed, proposals]) {
      expect(src).not.toContain('implementations')
    }
  })

  it('client_pipeline routes are untouched (including the known join bug — not fixed in this slice)', () => {
    const pipeline = fs.readFileSync(path.resolve(__dirname, '../../app/api/admin/pipeline/route.ts'), 'utf-8')
    // The join itself is still uncast — the exact bug identified in the
    // Phase 1 audit. (cp.id::text elsewhere, in an unrelated bookings
    // subquery, is not part of this bug and is fine to remain — so this
    // is scoped to the join line specifically, not a whole-file ban.)
    const joinLine = pipeline.split('\n').find(l => l.includes('LEFT JOIN organisations o ON o.id = cp.organisation_id'))
    expect(joinLine).toBeDefined()
    expect(joinLine).not.toContain('::text')
  })

  it('crm_* routes are untouched', () => {
    const deals = fs.readFileSync(path.resolve(__dirname, '../../app/api/crm/deals/route.ts'), 'utf-8')
    expect(deals).not.toContain('implementations')
  })

  it('LD Tennis routes are untouched', () => {
    const lead = fs.readFileSync(path.resolve(__dirname, '../../app/api/lead/route.ts'), 'utf-8')
    const leadsId = fs.readFileSync(path.resolve(__dirname, '../../app/api/leads/[id]/route.ts'), 'utf-8')
    const book = fs.readFileSync(path.resolve(__dirname, '../../app/api/tennis/book/route.ts'), 'utf-8')
    for (const src of [lead, leadsId, book]) {
      expect(src).not.toContain('implementations')
    }
  })

  it('AdminAside gained exactly one new nav entry, nothing else changed', () => {
    const nav = fs.readFileSync(path.resolve(__dirname, '../../components/admin/AdminAside.tsx'), 'utf-8')
    expect(nav).toContain("<Link href=\"/admin/implementations\" style={link('/admin/implementations')}>Client Implementations</Link>")
    // Every pre-existing nav link is still present, unchanged.
    for (const href of ['/admin/founder', '/admin/web-services', '/admin/deployments', '/admin/pipeline', '/admin/sessions', '/admin/orgs', '/admin/users', '/admin/agent-runs', '/admin/agent-test']) {
      expect(nav).toContain(`href="${href}"`)
    }
  })
})
