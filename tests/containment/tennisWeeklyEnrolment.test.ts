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

const propagateMock = vi.fn()
vi.mock('@/lib/tennisRecurrence', () => ({
  propagateRecurringEnrolment: (...args: unknown[]) => propagateMock(...args),
}))

const { POST } = await import('@/app/api/dashboard/sessions/[id]/instances/[instanceId]/route')

function postRequest(body: unknown) {
  return asNextRequest(new Request('http://localhost/api/dashboard/sessions/sess-1/instances/inst-1', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}
const params = Promise.resolve({ id: 'sess-1', instanceId: 'inst-1' })

const manager = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' }
const instanceRow = { id: 'inst-1', max_capacity: 8, date: '2026-08-18', start_time: '18:00', session_type: 'Group' }

describe('POST enrolment — initial Once vs Weekly', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset(); propagateMock.mockReset() })

  it('denies a caller below manager', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await POST(postRequest({ client_name: 'Test', frequency: 'once' }), { params })
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('Once: creates only the selected instance booking, is_recurring=false, no propagation call', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock
      .mockResolvedValueOnce([instanceRow])
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ id: 'b1', is_recurring: false, recurring_group_id: null }])

    const res = await POST(postRequest({ client_name: 'Test Player', frequency: 'once' }), { params })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.propagation).toBeNull()
    expect(propagateMock).not.toHaveBeenCalled()

    const insertCallArgs = sqlMock.mock.calls[2]
    expect(insertCallArgs).not.toContain(true) // is_recurring should not be interpolated true
  })

  it('Weekly: creates the current booking, is_recurring=true, and calls propagation for future instances', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock
      .mockResolvedValueOnce([instanceRow])
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ id: 'b1', is_recurring: true, recurring_group_id: 'group-x' }])
    propagateMock.mockResolvedValue({ propagated: 3, alreadyPresent: 0, paused: 0, capacityBlocked: 1, errors: 0, skippedDates: ['2026-09-15'] })

    const res = await POST(postRequest({ client_name: 'Test Player', frequency: 'weekly' }), { params })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.propagation.propagated).toBe(3)
    expect(data.propagation.capacityBlocked).toBe(1)

    expect(propagateMock).toHaveBeenCalledWith(expect.objectContaining({
      organisationId: 'org-a', sessionId: 'sess-1', clientName: 'Test Player', afterDate: '2026-08-18',
    }))
  })

  it('rejects enrolment (Once or Weekly) when the current instance is already full', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockResolvedValueOnce([instanceRow]).mockResolvedValueOnce([{ cnt: 8 }])

    const res = await POST(postRequest({ client_name: 'Test Player', frequency: 'weekly' }), { params })
    expect(res.status).toBe(409)
    expect(propagateMock).not.toHaveBeenCalled()
  })

  it('rejects a cross-org instance lookup (manager from a different org)', async () => {
    requireRoleMock.mockResolvedValue({ ...manager, organisationId: 'org-b' })
    sqlMock.mockResolvedValueOnce([]) // instance lookup filtered by org-b finds nothing

    const res = await POST(postRequest({ client_name: 'Test Player', frequency: 'weekly' }), { params })
    expect(res.status).toBe(404)
    expect(propagateMock).not.toHaveBeenCalled()
  })
})
