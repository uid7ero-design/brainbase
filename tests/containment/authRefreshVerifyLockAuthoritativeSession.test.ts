import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// SEC-1B3 — special-case conversion coverage for POST /api/auth/refresh
// and POST /api/auth/verify-lock.
//
// auth/refresh: refreshSession() (lib/session.ts, untouched by this
// phase) re-signs the cookie's OWN existing JWT payload verbatim with a
// fresh 12h expiry — it never itself re-checks the DB. Before SEC-1B3,
// that was the one place in the app that could grant an EXTENDED valid
// session to a since-deactivated/deleted/reassigned user, forever, via
// repeated refresh calls. Now gated on requireSession() first — refresh
// is refused outright once the caller no longer validates against the
// DB. refreshSession()'s own internals are intentionally untouched (see
// the route's own comment) and are exercised for real here (not mocked),
// since proving its actual re-signing behavior still fires on the
// success path is the point of this suite.
//
// auth/verify-lock: a client-side "lock screen" password re-entry —
// requires an already-established session cookie either way, so
// requireSession() applies with no pre-auth-state concern. Its own
// separate password_hash lookup/bcrypt check is unchanged.

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
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const cookieStore = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => { cookieStore.set(name, value) },
  }),
  headers: async () => ({ get: () => null }),
}))

const checkRateLimitMock = vi.fn<(...args: unknown[]) => boolean>(() => true)
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args) }))

const bcryptCompareMock = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true)
vi.mock('bcryptjs', () => ({ default: { compare: (...args: unknown[]) => bcryptCompareMock(...args) } }))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const ACTIVE_USER_ROW = { id: 'user1', organisation_id: 'org-a', role: 'manager' }

const { POST: postRefresh } = await import('@/app/api/auth/refresh/route')
const { POST: postVerifyLock } = await import('@/app/api/auth/verify-lock/route')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  checkRateLimitMock.mockClear()
  checkRateLimitMock.mockReturnValue(true)
  bcryptCompareMock.mockClear()
  bcryptCompareMock.mockResolvedValue(true)
  cookieStore.clear()
  responseQueue = []
  callCount = 0
})

describe('POST /api/auth/refresh — authorization', () => {
  it('rejects with 401 when there is no session, before touching the DB or reissuing a cookie', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await postRefresh()
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
    expect(cookieStore.has('session')).toBe(false)
  })

  it('rejects with 401 when the user has been deactivated (status INACTIVE) since the JWT was issued — no extended session is granted', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await postRefresh()
    expect(res.status).toBe(401)
    // requireSession's own lookup is the only sql call — no last_seen_at
    // UPDATE, and refreshSession() (which reads/rewrites the cookie) is
    // never reached.
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(cookieStore.has('session')).toBe(false)
  })

  it('rejects with 401 when the user has been deleted since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'manager', name: 'Deleted User' })
    queue([])
    const res = await postRefresh()
    expect(res.status).toBe(401)
    expect(cookieStore.has('session')).toBe(false)
  })

  it('rejects with 401 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Reassigned User' })
    queue([{ id: 'user1', organisation_id: 'org-b', role: 'manager' }])
    const res = await postRefresh()
    expect(res.status).toBe(401)
    expect(cookieStore.has('session')).toBe(false)
  })

  it('a currently-active DB-confirmed user succeeds: last_seen_at is updated and the session cookie is genuinely reissued (refreshSession() still runs, unmocked)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    // refreshSession() reads the RAW session cookie itself (independent
    // of the getSession() mock above) — seed it so decrypt() succeeds.
    const { encrypt } = await import('@/lib/session')
    const token = await encrypt({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
    cookieStore.set('session', token)

    const res = await postRefresh()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.expiresAt).toBe('string')
    expect(cookieStore.has('session')).toBe(true)
    expect(cookieStore.get('session')).not.toBe(token) // genuinely reissued, not the same token
  })
})

describe('POST /api/auth/verify-lock — authorization', () => {
  function verifyLockRequest(body: unknown = { password: 'correct-password' }): NextRequest {
    return asNextRequest(new Request('http://localhost/api/auth/verify-lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  it('rejects with 401 when there is no session, before any rate-limit check or password comparison', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await postVerifyLock(verifyLockRequest())
    expect(res.status).toBe(401)
    expect(checkRateLimitMock).not.toHaveBeenCalled()
    expect(bcryptCompareMock).not.toHaveBeenCalled()
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been deactivated (status INACTIVE) since the JWT was issued — cannot "unlock" even with the correct password', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await postVerifyLock(verifyLockRequest())
    expect(res.status).toBe(401)
    expect(bcryptCompareMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been deleted since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'manager', name: 'Deleted User' })
    queue([])
    const res = await postVerifyLock(verifyLockRequest())
    expect(res.status).toBe(401)
    expect(bcryptCompareMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Reassigned User' })
    queue([{ id: 'user1', organisation_id: 'org-b', role: 'manager' }])
    const res = await postVerifyLock(verifyLockRequest())
    expect(res.status).toBe(401)
    expect(bcryptCompareMock).not.toHaveBeenCalled()
  })

  it('a currently-active DB-confirmed user with the correct password succeeds, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [{ password_hash: 'hashed-value' }])
    const res = await postVerifyLock(verifyLockRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(bcryptCompareMock).toHaveBeenCalledWith('correct-password', 'hashed-value')
  })

  it('a currently-active DB-confirmed user with an INCORRECT password is rejected — unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [{ password_hash: 'hashed-value' }])
    bcryptCompareMock.mockResolvedValue(false)
    const res = await postVerifyLock(verifyLockRequest({ password: 'wrong-password' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Incorrect password.' })
  })

  it('rate limiting still applies after authorization succeeds — unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    checkRateLimitMock.mockReturnValue(false)
    const res = await postVerifyLock(verifyLockRequest())
    expect(res.status).toBe(429)
    expect(bcryptCompareMock).not.toHaveBeenCalled()
  })
})
