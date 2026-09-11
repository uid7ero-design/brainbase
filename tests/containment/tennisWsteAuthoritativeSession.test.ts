import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// SEC-1B3 — POST /api/tennis/blog/upload-image and POST /api/wste/verify
// were each gated on raw getSession(), a JWT-only claim never revalidated
// against the DB. Now gated on requireSession() (lib/org.ts), which
// re-reads the caller's current role/organisation/status from the
// database on every call.

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

const sharpToBufferMock = vi.fn(async () => Buffer.from([1, 2, 3]))
const sharpResizeMock = vi.fn(() => ({ webp: () => ({ toBuffer: sharpToBufferMock }) }))
vi.mock('sharp', () => ({ default: vi.fn(() => ({ resize: sharpResizeMock })) }))

const verifyServiceMock = vi.fn()
vi.mock('@/lib/wste/verifyService', () => ({ verifyService: (...args: unknown[]) => verifyServiceMock(...args) }))
vi.mock('@/lib/wste/demoScenarios', () => ({ getDemoScenario: vi.fn(() => ({ organisationId: 'attacker-org', gpsPoints: [], propertyId: 'p1' })) }))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const ACTIVE_USER_ROW = { id: 'user1', organisation_id: 'org-a', role: 'manager' }

const { POST: postUploadImage } = await import('@/app/api/tennis/blog/upload-image/route')
const { POST: postVerify } = await import('@/app/api/wste/verify/route')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  writeFileMock.mockClear()
  sharpResizeMock.mockClear()
  sharpToBufferMock.mockClear()
  verifyServiceMock.mockReset()
  cookieStore.clear()
  responseQueue = []
  callCount = 0
})

function imageUploadRequest(file: File | null): NextRequest {
  const fd = new FormData()
  if (file) fd.set('file', file)
  return asNextRequest(new Request('http://localhost/api/tennis/blog/upload-image', { method: 'POST', body: fd }))
}

describe('POST /api/tennis/blog/upload-image — authorization', () => {
  it('rejects with 401 when there is no session, before any file read/resize/write', async () => {
    getSessionMock.mockResolvedValue(null)
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const res = await postUploadImage(imageUploadRequest(file))
    expect(res.status).toBe(401)
    expect(writeFileMock).not.toHaveBeenCalled()
    expect(sharpResizeMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the DB-current user is deactivated (status INACTIVE), before any file write', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const res = await postUploadImage(imageUploadRequest(file))
    expect(res.status).toBe(401)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been deleted since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'manager', name: 'Deleted User' })
    queue([])
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const res = await postUploadImage(imageUploadRequest(file))
    expect(res.status).toBe(401)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('a currently-active DB-confirmed user succeeds, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const res = await postUploadImage(imageUploadRequest(file))
    expect(res.status).toBe(200)
    expect(writeFileMock).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(body.url).toMatch(/^\/blog-images\/.+\.webp$/)
  })
})

describe('POST /api/wste/verify — authorization', () => {
  function verifyRequest(body: unknown): NextRequest {
    return asNextRequest(new Request('http://localhost/api/wste/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  it('rejects with 401 when there is no session, before invoking verifyService', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await postVerify(verifyRequest({ propertyId: 'p1' }))
    expect(res.status).toBe(401)
    expect(verifyServiceMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the DB-current user is deactivated (status INACTIVE), before invoking verifyService', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await postVerify(verifyRequest({ propertyId: 'p1' }))
    expect(res.status).toBe(401)
    expect(verifyServiceMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Reassigned User' })
    queue([{ id: 'user1', organisation_id: 'org-b', role: 'manager' }])
    const res = await postVerify(verifyRequest({ propertyId: 'p1' }))
    expect(res.status).toBe(401)
    expect(verifyServiceMock).not.toHaveBeenCalled()
  })

  it('a currently-active DB-confirmed user succeeds, and a demo scenario\'s own organisationId is overridden by the session\'s org (cannot be used to target another org), unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    verifyServiceMock.mockReturnValue({ verified: true })
    const res = await postVerify(verifyRequest({ propertyId: 'p1' }))
    expect(res.status).toBe(200)
    const passedInput = verifyServiceMock.mock.calls[0]?.[0] as { organisationId: string }
    // getDemoScenario() is mocked to return organisationId: 'attacker-org'
    // — the route must overwrite it with the session's own org.
    expect(passedInput.organisationId).toBe('org-a')
  })
})
