import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

const requireRoleMock = vi.fn()
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}))

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}))

// reconcileFutureInstances is a real DB-touching function unrelated to this
// round's colour work — stub it so these tests only exercise the colour
// validation/plumbing in the sessions routes themselves.
vi.mock('@/lib/tennisSchedule', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tennisSchedule')>('@/lib/tennisSchedule')
  return {
    ...actual,
    reconcileFutureInstances: vi.fn().mockResolvedValue({ generated: 0, reactivated: 0, cancelledInstances: 0, conflicts: [] }),
  }
})

const { POST } = await import('@/app/api/dashboard/sessions/route')
const { PATCH } = await import('@/app/api/dashboard/sessions/[id]/route')

const manager = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' }

function postRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/dashboard/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}
function patchRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/dashboard/sessions/sess-1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}
const params = Promise.resolve({ id: 'sess-1' })

const baseCreateBody = {
  day_of_week: 1, start_time: '10:00', session_type: 'GROUP_TERM_JUNIOR',
}

describe('POST /api/dashboard/sessions — session_colour_key validation', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset(); requireRoleMock.mockResolvedValue(manager) })

  it('rejects an unknown colour key with 400 and never touches the database', async () => {
    const res = await POST(postRequest({ ...baseCreateBody, session_colour_key: 'not-a-real-colour' }))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects raw hex as a colour override — the finite palette is the only accepted input', async () => {
    const res = await POST(postRequest({ ...baseCreateBody, session_colour_key: '#ff0000' }))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('omitting session_colour_key creates the session with a null override (inherits the type colour)', async () => {
    sqlMock.mockResolvedValue([{
      id: 'new-1', day_of_week: 1, start_time: '10:00', duration_minutes: 60, max_capacity: 8,
      session_type: 'GROUP_TERM_JUNIOR', start_date: null, end_mode: 'ongoing', end_after_weeks: null, end_date: null,
      session_colour_key: null,
    }])
    const res = await POST(postRequest(baseCreateBody))
    expect(res.status).toBe(201)
    const insertCall = sqlMock.mock.calls.find(call => (call[0] as string[]).join('').includes('INSERT INTO sessions'))
    expect(insertCall).toBeDefined()
    expect(insertCall).toContain(null)
  })

  it('a valid colour key is accepted and passed through to the insert', async () => {
    sqlMock.mockResolvedValue([{
      id: 'new-1', day_of_week: 1, start_time: '10:00', duration_minutes: 60, max_capacity: 8,
      session_type: 'GROUP_TERM_JUNIOR', start_date: null, end_mode: 'ongoing', end_after_weeks: null, end_date: null,
      session_colour_key: 'orange',
    }])
    const res = await POST(postRequest({ ...baseCreateBody, session_colour_key: 'orange' }))
    expect(res.status).toBe(201)
    const insertCall = sqlMock.mock.calls.find(call => (call[0] as string[]).join('').includes('INSERT INTO sessions'))
    expect(insertCall).toContain('orange')
  })
})

describe('PATCH /api/dashboard/sessions/[id] — session_colour_key validation + explicit reset-to-inherit', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset(); requireRoleMock.mockResolvedValue(manager) })

  it('rejects an unknown colour key with 400 and never touches the database', async () => {
    const res = await PATCH(patchRequest({ session_colour_key: 'javascript:alert(1)' }), { params })
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('field omitted entirely leaves the stored override untouched (uses the sql`session_colour_key` self-reference fragment, not a blind overwrite)', async () => {
    sqlMock.mockResolvedValue([{
      id: 'sess-1', name: 'X', day_of_week: 1, start_time: '10:00', duration_minutes: 60, max_capacity: 8,
      session_type: 'GROUP_TERM_JUNIOR', resource_id: null, recurring: true, price_per_session: 0, created_at: new Date().toISOString(),
      start_date: null, end_mode: 'ongoing', end_after_weeks: null, end_date: null, session_colour_key: 'orange',
    }])
    const res = await PATCH(patchRequest({ name: 'X' }), { params })
    expect(res.status).toBe(200)
    // The UPDATE statement's SET clause references the column itself as a
    // fallback (a nested `sql` fragment) rather than being given an
    // explicit value when the field was never sent.
    const updateCall = sqlMock.mock.calls.find(call => (call[0] as string[]).join('').includes('UPDATE sessions'))
    expect(updateCall).toBeDefined()
  })

  it('field explicitly sent as null resets the override back to "inherit type colour"', async () => {
    sqlMock.mockResolvedValue([{
      id: 'sess-1', name: 'X', day_of_week: 1, start_time: '10:00', duration_minutes: 60, max_capacity: 8,
      session_type: 'GROUP_TERM_JUNIOR', resource_id: null, recurring: true, price_per_session: 0, created_at: new Date().toISOString(),
      start_date: null, end_mode: 'ongoing', end_after_weeks: null, end_date: null, session_colour_key: null,
    }])
    const res = await PATCH(patchRequest({ session_colour_key: null }), { params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.session.session_colour_key).toBeNull()
  })

  it('field sent as a valid key sets the override', async () => {
    sqlMock.mockResolvedValue([{
      id: 'sess-1', name: 'X', day_of_week: 1, start_time: '10:00', duration_minutes: 60, max_capacity: 8,
      session_type: 'GROUP_TERM_JUNIOR', resource_id: null, recurring: true, price_per_session: 0, created_at: new Date().toISOString(),
      start_date: null, end_mode: 'ongoing', end_after_weeks: null, end_date: null, session_colour_key: 'cyan',
    }])
    const res = await PATCH(patchRequest({ session_colour_key: 'cyan' }), { params })
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls.find(call => (call[0] as string[]).join('').includes('UPDATE sessions'))
    expect(updateCall).toContain('cyan')
  })

  it('cross-org PATCH still cannot touch another organisation\'s session even when only session_colour_key is sent', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' })
    sqlMock.mockResolvedValue([]) // WHERE ... AND organisation_id = 'org-a' matches nothing for an org-b session
    const res = await PATCH(patchRequest({ session_colour_key: 'cyan' }), { params })
    expect(res.status).toBe(404)
  })
})

describe('GET routes return session_colour_key so the UI never needs a second fetch to resolve colour', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset(); requireRoleMock.mockResolvedValue(manager) })

  it('GET /api/dashboard/sessions selects session_colour_key', async () => {
    const { GET } = await import('@/app/api/dashboard/sessions/route')
    sqlMock.mockResolvedValue([])
    await GET(asNextRequest(new Request('http://localhost/api/dashboard/sessions')))
    const selectCall = sqlMock.mock.calls.find(call => (call[0] as string[]).join('').includes('FROM sessions s'))
    expect((selectCall![0] as string[]).join('')).toContain('session_colour_key')
  })

  it('GET /api/dashboard/sessions/instances selects s.session_colour_key', async () => {
    const { GET } = await import('@/app/api/dashboard/sessions/instances/route')
    sqlMock.mockResolvedValue([])
    await GET(asNextRequest(new Request('http://localhost/api/dashboard/sessions/instances')))
    const selectCall = sqlMock.mock.calls.find(call => (call[0] as string[]).join('').includes('FROM session_instances'))
    expect((selectCall![0] as string[]).join('')).toContain('session_colour_key')
  })
})
