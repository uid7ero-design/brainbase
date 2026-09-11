import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// SEC-1B3 — the six social routes (analyse, callback, connect, insights,
// posts, sync) were each gated on raw getSession(), a JWT-only claim
// never revalidated against the DB. Now gated on requireSession()
// (lib/org.ts), which re-reads the caller's current role/organisation/
// status from the database on every call.
//
// social/callback is the OAuth redirect-back handler — it runs with the
// caller's OWN already-established session cookie (same-site browser
// navigation carries it back), not a pre-auth state; its separate
// social_oauth_state cookie is an independent CSRF check, unaffected by
// this change. Its auth-failure path is a redirect to /login (not JSON),
// preserved exactly.

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

const getSessionMock = vi.fn()
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>()
  return { ...actual, getSession: (...args: unknown[]) => getSessionMock(...args) }
})

let responseQueue: unknown[][] = []
let callCount = 0
let calls: { text: string; values: unknown[] }[] = []
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values })
  return Promise.resolve(responseQueue[callCount++] ?? [])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...(args as [TemplateStringsArray, ...unknown[]])),
}))

const cookieStore = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => { cookieStore.set(name, value) },
    delete: (name: string) => { cookieStore.delete(name) },
  }),
}))

const socialAgentRunMock = vi.fn()
vi.mock('@/lib/agents/socialAgent', () => ({ run: (...args: unknown[]) => socialAgentRunMock(...args) }))

const exchangeCodeMock = vi.fn()
const getLongLivedMock = vi.fn()
const getConnectedIGMock = vi.fn()
vi.mock('@/lib/social/instagram', () => ({
  exchangeCodeForToken: (...args: unknown[]) => exchangeCodeMock(...args),
  getLongLivedToken: (...args: unknown[]) => getLongLivedMock(...args),
  getConnectedIGAccount: (...args: unknown[]) => getConnectedIGMock(...args),
  fetchPosts: vi.fn(async () => []),
  fetchComments: vi.fn(async () => []),
}))
vi.mock('@/lib/social/crypto', () => ({ encrypt: vi.fn((v: string) => `enc:${v}`), decrypt: vi.fn((v: string) => v.replace('enc:', '')) }))
vi.mock('@/lib/social/demo', () => ({ IS_DEMO_MODE: false, DEMO_POSTS: [], DEMO_COMMENTS: [] }))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const ACTIVE_USER_ROW = { id: 'user1', organisation_id: 'org-a', role: 'manager' }

const { POST: postAnalyse } = await import('@/app/api/social/analyse/route')
const { GET: getCallback } = await import('@/app/api/social/callback/route')
const { GET: getConnect } = await import('@/app/api/social/connect/route')
const { GET: getInsights } = await import('@/app/api/social/insights/route')
const { GET: getPosts } = await import('@/app/api/social/posts/route')
const { POST: postSync } = await import('@/app/api/social/sync/route')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  socialAgentRunMock.mockReset()
  exchangeCodeMock.mockReset()
  getLongLivedMock.mockReset()
  getConnectedIGMock.mockReset()
  cookieStore.clear()
  calls = []
  responseQueue = []
  callCount = 0
  process.env.META_APP_ID = 'test-app-id'
})

describe('POST /api/social/analyse — authorization', () => {
  it('rejects with 401 when there is no session, before invoking the social agent', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await postAnalyse()
    expect(res.status).toBe(401)
    expect(socialAgentRunMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the DB-current user is deactivated (status INACTIVE), before invoking the social agent', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await postAnalyse()
    expect(res.status).toBe(401)
    expect(socialAgentRunMock).not.toHaveBeenCalled()
  })

  it('a currently-active DB-confirmed user succeeds, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    socialAgentRunMock.mockResolvedValue({ confidence: 0.8, summary: 'ok', findings: [], warnings: [], recommendedActions: [], evidence: undefined })
    const res = await postAnalyse()
    expect(res.status).toBe(200)
    expect(socialAgentRunMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a', userId: 'user1' }))
  })
})

describe('GET /api/social/callback — authorization (OAuth redirect-back)', () => {
  function callbackRequest(qs: string): NextRequest {
    return asNextRequest(new Request(`http://localhost/api/social/callback${qs}`))
  }

  it('redirects to /login when there is no session, before any state/code handling or external token exchange', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await getCallback(callbackRequest('?code=abc&state=xyz'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
    expect(exchangeCodeMock).not.toHaveBeenCalled()
  })

  it('redirects to /login when the DB-current user is deactivated (status INACTIVE), before any external token exchange', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await getCallback(callbackRequest('?code=abc&state=xyz'))
    expect(res.headers.get('location')).toContain('/login')
    expect(exchangeCodeMock).not.toHaveBeenCalled()
  })

  it('a currently-active DB-confirmed user completes the connection, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    cookieStore.set('social_oauth_state', 'xyz')
    exchangeCodeMock.mockResolvedValue({ access_token: 'short' })
    getLongLivedMock.mockResolvedValue({ access_token: 'long', expires_in: 3600 })
    getConnectedIGMock.mockResolvedValue({ id: 'ig-1', name: 'My Account' })

    const res = await getCallback(callbackRequest('?code=abc&state=xyz'))
    expect(res.headers.get('location')).toContain('connected=1')
    expect(calls.some(c => c.text.includes('INSERT INTO social_accounts') && c.values.includes('org-a'))).toBe(true)
  })

  it('the CSRF state check still fires independently of session validity', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    cookieStore.set('social_oauth_state', 'expected-state')
    const res = await getCallback(callbackRequest('?code=abc&state=wrong-state'))
    expect(res.headers.get('location')).toContain('invalid_state')
    expect(exchangeCodeMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/social/connect — authorization', () => {
  it('rejects with 401 when there is no session, before generating OAuth state or redirecting', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await getConnect(asNextRequest(new Request('http://localhost/api/social/connect')))
    expect(res.status).toBe(401)
  })

  it('rejects with 401 when the DB-current user is deactivated (status INACTIVE)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await getConnect(asNextRequest(new Request('http://localhost/api/social/connect')))
    expect(res.status).toBe(401)
  })

  it('a currently-active DB-confirmed user is redirected to Facebook OAuth, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const res = await getConnect(asNextRequest(new Request('http://localhost/api/social/connect')))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('facebook.com')
  })
})

describe('GET /api/social/insights — authorization', () => {
  it('rejects with 401 when there is no session, before any DB read', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await getInsights()
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been deleted since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'manager', name: 'Deleted User' })
    queue([])
    const res = await getInsights()
    expect(res.status).toBe(401)
  })

  it('a currently-active DB-confirmed user succeeds, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const res = await getInsights()
    expect(res.status).toBe(200)
  })
})

describe('GET /api/social/posts — authorization', () => {
  it('rejects with 401 when there is no session', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await getPosts(asNextRequest(new Request('http://localhost/api/social/posts')))
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Reassigned User' })
    queue([{ id: 'user1', organisation_id: 'org-b', role: 'manager' }])
    const res = await getPosts(asNextRequest(new Request('http://localhost/api/social/posts')))
    expect(res.status).toBe(401)
  })

  it('a currently-active DB-confirmed user succeeds, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const res = await getPosts(asNextRequest(new Request('http://localhost/api/social/posts')))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/social/sync — authorization', () => {
  it('rejects with 401 when there is no session, before any external fetch or DB write', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await postSync()
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the DB-current user is deactivated (status INACTIVE), before any external fetch', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await postSync()
    expect(res.status).toBe(401)
    expect(calls.some(c => c.text.includes('social_accounts'))).toBe(false)
  })

  it('a currently-active DB-confirmed user with no connected account gets a 404, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [])
    const res = await postSync()
    expect(res.status).toBe(404)
  })
})
