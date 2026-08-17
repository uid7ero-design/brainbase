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

const { PATCH } = await import('@/app/api/dashboard/enrolments/[id]/route')

function patchRequest(body: unknown) {
  return asNextRequest(new Request('http://localhost/api/dashboard/enrolments/booking-1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}
const params = Promise.resolve({ id: 'booking-1' })

const manager = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' }
const onceBooking = { id: 'booking-1', session_id: 'sess-1', session_instance_id: 'inst-1', client_name: 'Test Player', client_email: null, date: '2026-08-18', recurring_group_id: null }
const weeklyBooking = { ...onceBooking, recurring_group_id: 'group-1' }

describe('PATCH /api/dashboard/enrolments/[id] — Once <-> Weekly toggle', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset(); propagateMock.mockReset() })

  it('denies a caller below manager', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await PATCH(patchRequest({ is_recurring: true }), { params })
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('Once -> Weekly: mints a lineage id, marks recurring, and backfills using the same propagation primitive initial enrolment uses', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock
      .mockResolvedValueOnce([onceBooking])
      .mockResolvedValueOnce([{ id: 'booking-1', is_recurring: true, recurring_group_id: 'new-group' }])
    propagateMock.mockResolvedValue({ propagated: 4, alreadyPresent: 0, paused: 0, capacityBlocked: 1, errors: 0, skippedDates: ['2026-09-01'] })

    const res = await PATCH(patchRequest({ is_recurring: true }), { params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.propagation.propagated).toBe(4)
    expect(propagateMock).toHaveBeenCalledWith(expect.objectContaining({ afterDate: '2026-08-18', clientName: 'Test Player' }))
  })

  it('reuses the existing recurring_group_id instead of minting a new one if the booking already has one', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock
      .mockResolvedValueOnce([weeklyBooking])
      .mockResolvedValueOnce([{ id: 'booking-1', is_recurring: true, recurring_group_id: 'group-1' }])
    propagateMock.mockResolvedValue({ propagated: 0, alreadyPresent: 3, paused: 0, capacityBlocked: 0, errors: 0, skippedDates: [] })

    await PATCH(patchRequest({ is_recurring: true }), { params })
    expect(propagateMock).toHaveBeenCalledWith(expect.objectContaining({ recurringGroupId: 'group-1' }))
  })

  it('Weekly -> Once: stops future generation and cancels already-generated future copies, preserving the current booking', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock
      .mockResolvedValueOnce([weeklyBooking])
      .mockResolvedValueOnce([{ id: 'booking-1', is_recurring: false, recurring_group_id: 'group-1' }])
      .mockResolvedValueOnce([{ id: 'future-1' }, { id: 'future-2' }]) // two future copies cancelled

    const res = await PATCH(patchRequest({ is_recurring: false }), { params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.futureCancelled).toBe(2)

    // The current booking's own UPDATE must not set status to cancelled.
    const currentUpdateSql = (sqlMock.mock.calls[1][0] as string[]).join('')
    expect(currentUpdateSql).not.toContain("status = 'cancelled'")
  })

  it('cross-org: booking lookup scoped by organisation_id denies access to another org’s booking', async () => {
    requireRoleMock.mockResolvedValue({ ...manager, organisationId: 'org-b' })
    sqlMock.mockResolvedValueOnce([]) // lookup filtered by org-b finds nothing (booking belongs to org-a)

    const res = await PATCH(patchRequest({ is_recurring: true }), { params })
    expect(res.status).toBe(404)
    expect(propagateMock).not.toHaveBeenCalled()
  })
})
