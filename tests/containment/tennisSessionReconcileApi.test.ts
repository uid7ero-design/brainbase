import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireRoleMock = vi.fn()
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}))

const reconcileAllMock = vi.fn()
vi.mock('@/lib/tennisSchedule', () => ({
  reconcileAllSessionsForOrg: (...args: unknown[]) => reconcileAllMock(...args),
}))

const { POST } = await import('@/app/api/dashboard/sessions/reconcile/route')

const manager = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' }

describe('POST /api/dashboard/sessions/reconcile', () => {
  beforeEach(() => { requireRoleMock.mockReset(); reconcileAllMock.mockReset() })

  it('denies a viewer — reconciliation is a write, gated at manager like every other mutating dashboard/sessions/* route', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await POST()
    expect(res.status).toBe(403)
    expect(reconcileAllMock).not.toHaveBeenCalled()
  })

  it('a manager triggers reconciliation scoped to their own organisation only', async () => {
    requireRoleMock.mockResolvedValue(manager)
    reconcileAllMock.mockResolvedValue({ reconciled: 3, totalGenerated: 5, totalCancelledInstances: 0, conflicts: [], errors: [] })
    const res = await POST()
    expect(res.status).toBe(200)
    expect(reconcileAllMock).toHaveBeenCalledWith('org-a')
    const data = await res.json()
    expect(data.totalGenerated).toBe(5)
  })

  it('a manager from a different organisation only ever reconciles their own org — the endpoint has no session/org id in the request body to override it', async () => {
    requireRoleMock.mockResolvedValue({ ...manager, organisationId: 'org-b' })
    reconcileAllMock.mockResolvedValue({ reconciled: 0, totalGenerated: 0, totalCancelledInstances: 0, conflicts: [], errors: [] })
    await POST()
    expect(reconcileAllMock).toHaveBeenCalledWith('org-b')
    expect(reconcileAllMock).not.toHaveBeenCalledWith('org-a')
  })

  it('awaits reconcileAllSessionsForOrg before responding — the result is not returned until the underlying work has actually completed', async () => {
    requireRoleMock.mockResolvedValue(manager)
    let resolved = false
    reconcileAllMock.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => { resolved = true; resolve({ reconciled: 1, totalGenerated: 1, totalCancelledInstances: 0, conflicts: [], errors: [] }) }, 5)
    }))
    const res = await POST()
    expect(resolved).toBe(true)
    expect(res.status).toBe(200)
  })

  it('surfaces per-session errors from a partial failure without a 500 — one bad session does not hide results for the rest', async () => {
    requireRoleMock.mockResolvedValue(manager)
    reconcileAllMock.mockResolvedValue({
      reconciled: 2, totalGenerated: 3, totalCancelledInstances: 0, conflicts: [],
      errors: [{ sessionId: 'sess-bad', message: 'DB error' }],
    })
    const res = await POST()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.errors).toEqual([{ sessionId: 'sess-bad', message: 'DB error' }])
    expect(data.totalGenerated).toBe(3)
  })

  it('a total failure of reconcileAllSessionsForOrg itself returns 500, not a silently-empty success', async () => {
    requireRoleMock.mockResolvedValue(manager)
    reconcileAllMock.mockRejectedValue(new Error('connection lost'))
    const res = await POST()
    expect(res.status).toBe(500)
  })
})
