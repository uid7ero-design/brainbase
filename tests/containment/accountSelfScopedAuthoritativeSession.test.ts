import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// SEC-1B3 — POST /api/account/avatar and GET/PUT /api/account/profile
// were gated on raw getSession(), a JWT-only claim never revalidated
// against the DB. Now gated on requireSession() (lib/org.ts), which
// re-reads the caller's current role/organisation/status from the
// database on every call.
//
// Mocking follows the established pattern in
// tests/containment/orgHomeOrganisationId.test.ts.

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
  }),
}))

const writeFileMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
vi.mock('fs/promises', () => ({ writeFile: (...args: unknown[]) => writeFileMock(...args) }))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const ACTIVE_USER_ROW = { id: 'user1', organisation_id: 'org-a', role: 'manager' }

const { POST: postAvatar } = await import('@/app/api/account/avatar/route')
const { GET: getProfile, PUT: putProfile } = await import('@/app/api/account/profile/route')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  writeFileMock.mockClear()
  cookieStore.clear()
  responseQueue = []
  callCount = 0
})

function avatarRequest(file: File | null): NextRequest {
  const fd = new FormData()
  if (file) fd.set('file', file)
  return asNextRequest(new Request('http://localhost/api/account/avatar', { method: 'POST', body: fd }))
}

describe('POST /api/account/avatar — authorization', () => {
  it('rejects with 401 when there is no session, before touching the filesystem or DB', async () => {
    getSessionMock.mockResolvedValue(null)
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const res = await postAvatar(avatarRequest(file))
    expect(res.status).toBe(401)
    expect(writeFileMock).not.toHaveBeenCalled()
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been deactivated (status INACTIVE) since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const res = await postAvatar(avatarRequest(file))
    expect(res.status).toBe(401)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been deleted since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'manager', name: 'Deleted User' })
    queue([])
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const res = await postAvatar(avatarRequest(file))
    expect(res.status).toBe(401)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Reassigned User' })
    queue([{ id: 'user1', organisation_id: 'org-b', role: 'manager' }])
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const res = await postAvatar(avatarRequest(file))
    expect(res.status).toBe(401)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('a currently-active DB-confirmed user succeeds and writes the file under their own userId, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const res = await postAvatar(avatarRequest(file))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.avatarUrl).toMatch(/^\/avatars\/user1\.png\?v=\d+$/)
    expect(writeFileMock).toHaveBeenCalledTimes(1)
    const [filepath] = writeFileMock.mock.calls[0] as [string]
    expect(filepath).toContain('user1.png')
  })
})

describe('GET /api/account/profile — authorization', () => {
  it('rejects with 401 when there is no session, before any DB read', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await getProfile()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorised' })
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been deactivated (status INACTIVE) since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await getProfile()
    expect(res.status).toBe(401)
    expect(sqlMock).toHaveBeenCalledTimes(1) // only requireSession's own lookup
  })

  it('rejects with 401 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Reassigned User' })
    queue([{ id: 'user1', organisation_id: 'org-b', role: 'manager' }])
    const res = await getProfile()
    expect(res.status).toBe(401)
  })

  it('a currently-active DB-confirmed user succeeds, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [{ id: 'user1', username: 'u1', org_name: 'Org A' }], [])
    const res = await getProfile()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toMatchObject({ id: 'user1', username: 'u1' })
  })
})

describe('PUT /api/account/profile — authorization and containment', () => {
  function putRequest(body: unknown): NextRequest {
    return asNextRequest(new Request('http://localhost/api/account/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  it('rejects with 401 when there is no session, before any DB write', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await putProfile(putRequest({ bio: 'hacked' }))
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been deactivated (status INACTIVE) since the JWT was issued, before any DB write', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await putProfile(putRequest({ bio: 'hacked' }))
    expect(res.status).toBe(401)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('a currently-active DB-confirmed user can update their own safe profile fields, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const res = await putProfile(putRequest({ bio: 'Hello', role: 'super_admin', organisation_id: 'org-x' }))
    expect(res.status).toBe(200)
    // requireSession's own lookup, then exactly one UPDATE call.
    expect(sqlMock).toHaveBeenCalledTimes(2)
  })
})
