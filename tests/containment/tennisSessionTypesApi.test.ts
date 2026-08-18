import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

function asNextRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest
}

const requireRoleMock = vi.fn()
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}))

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}))

const { GET } = await import('@/app/api/dashboard/session-types/route')
const { POST } = await import('@/app/api/dashboard/session-types/route')
const { PATCH } = await import('@/app/api/dashboard/session-types/[id]/route')

const manager = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' }
const viewer  = { userId: 'u2', organisationId: 'org-a', role: 'viewer', name: 'Assistant' }

describe('GET /api/dashboard/session-types', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset() })

  it('a viewer can list active org types (role restriction: viewer minimum, not manager-only)', async () => {
    requireRoleMock.mockResolvedValue(viewer)
    sqlMock.mockResolvedValueOnce([{ id: 't1', name: 'Hot Shots', slug: 'GROUP_TERM_JUNIOR', colour_key: 'green', active: true, sort_order: 0 }])
    const res = await GET(asNextRequest('http://localhost/api/dashboard/session-types'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.types).toHaveLength(1)
  })

  it('denies an unauthenticated/unrecognised caller', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await GET(asNextRequest('http://localhost/api/dashboard/session-types'))
    expect(res.status).toBe(403)
  })

  it('default (no include_archived) query excludes inactive types — archived types stay hidden from the create/edit selector', async () => {
    requireRoleMock.mockResolvedValue(viewer)
    sqlMock.mockResolvedValueOnce([])
    await GET(asNextRequest('http://localhost/api/dashboard/session-types'))
    const queryText = (sqlMock.mock.calls[0][0] as string[]).join('')
    expect(queryText).toContain('active = true')
  })

  it('include_archived=1 returns archived types too (needed so the Manage screen and existing-session labels can still resolve them)', async () => {
    requireRoleMock.mockResolvedValue(viewer)
    sqlMock.mockResolvedValueOnce([])
    await GET(asNextRequest('http://localhost/api/dashboard/session-types?include_archived=1'))
    const queryText = (sqlMock.mock.calls[0][0] as string[]).join('')
    expect(queryText).not.toContain('active = true')
  })

  it('the query is scoped to the caller organisation_id — cross-org types are never visible', async () => {
    requireRoleMock.mockResolvedValue({ ...viewer, organisationId: 'org-b' })
    sqlMock.mockResolvedValueOnce([])
    await GET(asNextRequest('http://localhost/api/dashboard/session-types'))
    const queryArgs = sqlMock.mock.calls[0]
    expect(queryArgs).toContain('org-b')
    expect(queryArgs).not.toContain('org-a')
  })

  it('degrades to an empty list (not an error) if session_types does not exist yet (migration not applied)', async () => {
    requireRoleMock.mockResolvedValue(viewer)
    sqlMock.mockRejectedValueOnce(new Error('relation "session_types" does not exist'))
    const res = await GET(asNextRequest('http://localhost/api/dashboard/session-types'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.types).toEqual([])
  })
})

describe('POST /api/dashboard/session-types', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset() })

  it('denies a viewer (role restriction: manager minimum to create)', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await POST(asNextRequest('http://localhost/api/dashboard/session-types', { method: 'POST', body: JSON.stringify({ name: 'X' }) }))
    expect(res.status).toBe(403)
  })

  it('a manager can add a new own-org type', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock
      .mockResolvedValueOnce([]) // name-uniqueness check: none found
      .mockResolvedValueOnce([]) // slug clash check: none found
      .mockResolvedValueOnce([{ maxSort: 3 }])
      .mockResolvedValueOnce([{ id: 't-new', name: 'Ladder Night', slug: 'LADDER_NIGHT', colour_key: 'teal', active: true, sort_order: 3 }])
    const res = await POST(asNextRequest('http://localhost/api/dashboard/session-types', { method: 'POST', body: JSON.stringify({ name: 'Ladder Night', colour_key: 'teal' }) }))
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.type.name).toBe('Ladder Night')
  })

  it('duplicate type name (case-insensitive) within the org is rejected with 409, not silently created', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockResolvedValueOnce([{ id: 'existing' }]) // name-uniqueness check finds a match
    const res = await POST(asNextRequest('http://localhost/api/dashboard/session-types', { method: 'POST', body: JSON.stringify({ name: 'hot shots tennis' }) }))
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toContain('already exists')
  })

  it('rejects an empty name', async () => {
    requireRoleMock.mockResolvedValue(manager)
    const res = await POST(asNextRequest('http://localhost/api/dashboard/session-types', { method: 'POST', body: JSON.stringify({ name: '  ' }) }))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('an invalid colour_key falls back to slate rather than accepting arbitrary values', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ maxSort: 0 }])
      .mockResolvedValueOnce([{ id: 't-new', name: 'X', slug: 'X', colour_key: 'slate', active: true, sort_order: 0 }])
    await POST(asNextRequest('http://localhost/api/dashboard/session-types', { method: 'POST', body: JSON.stringify({ name: 'X', colour_key: 'javascript:alert(1)' }) }))
    const insertArgs = sqlMock.mock.calls[3]
    expect(insertArgs).toContain('slate')
    expect(insertArgs).not.toContain('javascript:alert(1)')
  })
})

describe('PATCH /api/dashboard/session-types/[id]', () => {
  const params = Promise.resolve({ id: 'type-1' })
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset() })

  it('denies a viewer', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await PATCH(asNextRequest('http://localhost/api/dashboard/session-types/type-1', { method: 'PATCH', body: JSON.stringify({ active: false }) }), { params })
    expect(res.status).toBe(403)
  })

  it('archiving sets active=false without deleting the row', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockResolvedValueOnce([{ id: 'type-1', name: 'Assessment', slug: 'ASSESSMENT', colour_key: 'slate', active: false, sort_order: 9 }])
    const res = await PATCH(asNextRequest('http://localhost/api/dashboard/session-types/type-1', { method: 'PATCH', body: JSON.stringify({ active: false }) }), { params })
    expect(res.status).toBe(200)
    const updateSql = (sqlMock.mock.calls[0][0] as string[]).join('')
    expect(updateSql).toContain('UPDATE session_types')
    expect(updateSql).not.toContain('DELETE')
  })

  it('rejects an invalid colour_key on rename/recolour', async () => {
    requireRoleMock.mockResolvedValue(manager)
    const res = await PATCH(asNextRequest('http://localhost/api/dashboard/session-types/type-1', { method: 'PATCH', body: JSON.stringify({ colour_key: 'not-a-real-colour' }) }), { params })
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})
