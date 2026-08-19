import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

function asNextRequest(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest
}

const requireRoleMock = vi.fn()
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}))

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}))

const { GET } = await import('@/app/api/dashboard/sessions/instances/route')

const manager = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' }

describe('GET /api/dashboard/sessions/instances — bounded calendar range query', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset() })

  it('denies a caller below viewer', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await GET(asNextRequest('http://localhost/api/dashboard/sessions/instances'))
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('with no date_from/date_to: queries unbounded (backward compatible — used by the wrong-weekday auto-fix check)', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockResolvedValueOnce([])
    const res = await GET(asNextRequest('http://localhost/api/dashboard/sessions/instances'))
    expect(res.status).toBe(200)
    const queryArgs = sqlMock.mock.calls[0]
    // Both date params interpolate as null when absent, and the query's own
    // "IS NULL OR" clause is what makes that unbounded rather than the API
    // route branching in JS.
    expect(queryArgs).toContain(null)
  })

  it('with date_from and date_to: both are passed through to the query as bind parameters', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockResolvedValueOnce([])
    const res = await GET(asNextRequest('http://localhost/api/dashboard/sessions/instances?date_from=2026-08-17&date_to=2026-08-23'))
    expect(res.status).toBe(200)
    const queryArgs = sqlMock.mock.calls[0]
    expect(queryArgs).toContain('2026-08-17')
    expect(queryArgs).toContain('2026-08-23')
  })

  it('the query is always scoped to the caller organisation_id, regardless of range', async () => {
    requireRoleMock.mockResolvedValue({ ...manager, organisationId: 'org-b' })
    sqlMock.mockResolvedValueOnce([])
    await GET(asNextRequest('http://localhost/api/dashboard/sessions/instances?date_from=2026-08-17&date_to=2026-08-23'))
    const queryArgs = sqlMock.mock.calls[0]
    expect(queryArgs).toContain('org-b')
    expect(queryArgs).not.toContain('org-a')
  })

  it('rejects a malformed date_from (not YYYY-MM-DD) without querying the database', async () => {
    requireRoleMock.mockResolvedValue(manager)
    const res = await GET(asNextRequest('http://localhost/api/dashboard/sessions/instances?date_from=17-08-2026&date_to=2026-08-23'))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed date_to without querying the database', async () => {
    requireRoleMock.mockResolvedValue(manager)
    const res = await GET(asNextRequest('http://localhost/api/dashboard/sessions/instances?date_from=2026-08-17&date_to=next-week'))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('only status = \'scheduled\' instances are returned — a reactivated instance (status flipped back from cancelled by reconcile) becomes visible here, a still-cancelled one never does', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockResolvedValueOnce([])
    await GET(asNextRequest('http://localhost/api/dashboard/sessions/instances?date_from=2026-08-17&date_to=2026-09-06'))
    const queryText = (sqlMock.mock.calls[0][0] as string[]).join('')
    expect(queryText).toContain("si.status = 'scheduled'")
  })

  it('a month-grid-sized range (up to 6 weeks) is a single bounded query, not an unbounded fetch of all history', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockResolvedValueOnce([])
    await GET(asNextRequest('http://localhost/api/dashboard/sessions/instances?date_from=2026-07-27&date_to=2026-09-06'))
    expect(sqlMock).toHaveBeenCalledTimes(1)
    const queryArgs = sqlMock.mock.calls[0]
    expect(queryArgs).toContain('2026-07-27')
    expect(queryArgs).toContain('2026-09-06')
  })
})
