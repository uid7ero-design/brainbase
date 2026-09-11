import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// SEC-1B3 — POST/GET/DELETE /api/briefings and GET/POST /api/onboarding/
// progress, POST /api/onboarding/submit, POST /api/onboarding/upload were
// each gated on raw getSession(), a JWT-only claim never revalidated
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
  }),
}))

vi.mock('xlsx', () => ({
  read: vi.fn(() => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } })),
  utils: { sheet_to_json: vi.fn(() => [['h1', 'h2'], ['a', 'b']]) },
}))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const ACTIVE_USER_ROW = { id: 'user1', organisation_id: 'org-a', role: 'manager' }

const { POST: postBriefing, GET: getBriefings, DELETE: deleteBriefing } = await import('@/app/api/briefings/route')
const { GET: getProgress, POST: postProgress } = await import('@/app/api/onboarding/progress/route')
const { POST: postSubmit } = await import('@/app/api/onboarding/submit/route')
const { POST: postUpload } = await import('@/app/api/onboarding/upload/route')

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockClear()
  cookieStore.clear()
  calls = []
  responseQueue = []
  callCount = 0
})

function jsonRequest(url: string, method: string, body: unknown): NextRequest {
  return asNextRequest(new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
}

describe('briefings — authorization (POST/GET/DELETE share one gate)', () => {
  it('POST rejects with 401 when there is no session, before any INSERT', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await postBriefing(jsonRequest('http://localhost/api/briefings', 'POST', { title: 't', responseText: 'r' }))
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('POST rejects with 401 when the DB-current user is deactivated (status INACTIVE), before any INSERT', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await postBriefing(jsonRequest('http://localhost/api/briefings', 'POST', { title: 't', responseText: 'r' }))
    expect(res.status).toBe(401)
    expect(calls.some(c => c.text.includes('INSERT INTO saved_briefings'))).toBe(false)
  })

  it('GET rejects with 401 when the user has been deleted since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'manager', name: 'Deleted User' })
    queue([])
    const res = await getBriefings(asNextRequest(new Request('http://localhost/api/briefings')))
    expect(res.status).toBe(401)
  })

  it('DELETE rejects with 401 when the user has been reassigned to a different organisation, before any DELETE statement runs', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Reassigned User' })
    queue([{ id: 'user1', organisation_id: 'org-b', role: 'manager' }])
    const res = await deleteBriefing(asNextRequest(new Request('http://localhost/api/briefings?id=00000000-0000-0000-0000-000000000000')))
    expect(res.status).toBe(401)
    expect(calls.some(c => c.text.includes('DELETE FROM saved_briefings'))).toBe(false)
  })

  it('a currently-active DB-confirmed user can create, list, and delete their own org\'s briefings, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [{ id: 'b1', created_at: '2026-01-01' }])
    const postRes = await postBriefing(jsonRequest('http://localhost/api/briefings', 'POST', { title: 't', responseText: 'r' }))
    expect(postRes.status).toBe(200)
  })
})

describe('onboarding/progress — authorization', () => {
  it('GET rejects with 401 when there is no session, before any DB read', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await getProgress()
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('GET rejects with 401 when the DB-current user is deactivated (status INACTIVE)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await getProgress()
    expect(res.status).toBe(401)
  })

  it('POST rejects with 401 when the user has been deleted since the JWT was issued, before any write', async () => {
    getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'manager', name: 'Deleted User' })
    queue([])
    const res = await postProgress(jsonRequest('http://localhost/api/onboarding/progress', 'POST', { currentStep: 2, data: {} }))
    expect(res.status).toBe(401)
    expect(calls.some(c => c.text.includes('INSERT INTO onboarding_progress'))).toBe(false)
  })

  it('a currently-active DB-confirmed user succeeds, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const res = await postProgress(jsonRequest('http://localhost/api/onboarding/progress', 'POST', { currentStep: 2, data: {} }))
    expect(res.status).toBe(200)
  })
})

describe('onboarding/submit — authorization', () => {
  it('rejects with 401 when there is no session, before mutating organisations or import_mappings', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await postSubmit(jsonRequest('http://localhost/api/onboarding/submit', 'POST', { data: { org: { councilName: 'Hacked Council' } } }))
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the DB-current user is deactivated (status INACTIVE), before any organisations UPDATE', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await postSubmit(jsonRequest('http://localhost/api/onboarding/submit', 'POST', { data: { org: { councilName: 'Hacked Council' } } }))
    expect(res.status).toBe(401)
    expect(calls.some(c => c.text.includes('UPDATE organisations'))).toBe(false)
  })

  it('rejects with 401 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Reassigned User' })
    queue([{ id: 'user1', organisation_id: 'org-b', role: 'manager' }])
    const res = await postSubmit(jsonRequest('http://localhost/api/onboarding/submit', 'POST', { data: {} }))
    expect(res.status).toBe(401)
  })

  it('a currently-active DB-confirmed user can submit onboarding for their own org, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const res = await postSubmit(jsonRequest('http://localhost/api/onboarding/submit', 'POST', { data: { org: { councilName: 'Real Council' } } }))
    expect(res.status).toBe(200)
    expect(calls.some(c => c.text.includes('UPDATE organisations') && c.values.includes('Real Council'))).toBe(true)
  })
})

describe('onboarding/upload — authorization', () => {
  function uploadRequest(file: File | null): NextRequest {
    const fd = new FormData()
    if (file) fd.set('file', file)
    return asNextRequest(new Request('http://localhost/api/onboarding/upload', { method: 'POST', body: fd }))
  }

  it('rejects with 401 when there is no session, before parsing the file or writing to uploaded_files', async () => {
    getSessionMock.mockResolvedValue(null)
    const file = new File([new Uint8Array([1, 2, 3])], 'a.csv', { type: 'text/csv' })
    const res = await postUpload(uploadRequest(file))
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the DB-current user is deactivated (status INACTIVE), before parsing the file', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const file = new File([new Uint8Array([1, 2, 3])], 'a.csv', { type: 'text/csv' })
    const res = await postUpload(uploadRequest(file))
    expect(res.status).toBe(401)
    expect(calls.some(c => c.text.includes('INSERT INTO uploaded_files'))).toBe(false)
  })

  it('a currently-active DB-confirmed user can upload and parse a file, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [{ id: 'file1' }])
    const file = new File([new Uint8Array([1, 2, 3])], 'a.csv', { type: 'text/csv' })
    const res = await postUpload(uploadRequest(file))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fileId).toBe('file1')
  })
})
