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

const { POST: pausePost, DELETE: pauseDelete } = await import('@/app/api/dashboard/enrolments/[id]/pause/route')

function postRequest(body: unknown) {
  return asNextRequest(new Request('http://localhost/api/dashboard/enrolments/booking-1/pause', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}
function deleteRequest() {
  return asNextRequest(new Request('http://localhost/api/dashboard/enrolments/booking-1/pause', { method: 'DELETE' }))
}
const params = Promise.resolve({ id: 'booking-1' })

const manager = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' }
const onceBooking = { id: 'booking-1', session_id: 'sess-1', session_instance_id: 'inst-1', client_name: 'Test Player', client_email: null, date: '2026-08-18', recurring_group_id: null }
const weeklyBooking = { ...onceBooking, recurring_group_id: 'group-1' }

describe('POST /api/dashboard/enrolments/[id]/pause — create pause window', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset() })

  it('denies a caller below manager', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await pausePost(postRequest({ pause_from: '2026-09-28', pause_until: '2026-10-11' }), { params })
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects a booking that is not a weekly recurring enrolment', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockResolvedValueOnce([{ ...onceBooking, is_recurring: false }])
    const res = await pausePost(postRequest({ pause_from: '2026-09-28', pause_until: '2026-10-11' }), { params })
    expect(res.status).toBe(400)
  })

  it('rejects an invalid range (pause_until before pause_from)', async () => {
    requireRoleMock.mockResolvedValue(manager)
    const res = await pausePost(postRequest({ pause_from: '2026-10-11', pause_until: '2026-09-28' }), { params })
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('cross-org: a manager from a different org cannot pause a booking they cannot see', async () => {
    requireRoleMock.mockResolvedValue({ ...manager, organisationId: 'org-b' })
    sqlMock.mockResolvedValueOnce([]) // lookup filtered by org-b finds nothing (booking belongs to org-a)

    const res = await pausePost(postRequest({ pause_from: '2026-09-28', pause_until: '2026-10-11' }), { params })
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1) // only the lookup — no pause row was ever inserted
  })

  it('cancels eligible future bookings inside the window and reports conflicts for paid/attended ones instead of deleting them', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock
      .mockResolvedValueOnce([{ ...weeklyBooking, is_recurring: true }])
      .mockResolvedValueOnce([{ id: 'pause-1', pause_from: '2026-09-28', pause_until: '2026-10-11', reason: null }])
      .mockResolvedValueOnce([
        { id: 'future-clean', paid: false, attendance_status: null, date: '2026-10-01' },
        { id: 'future-paid', paid: true, attendance_status: null, date: '2026-10-08' },
      ])
      .mockResolvedValueOnce([]) // UPDATE cancelling future-clean

    const res = await pausePost(postRequest({ pause_from: '2026-09-28', pause_until: '2026-10-11' }), { params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.cancelled).toBe(1)
    expect(data.conflicts).toEqual([{ id: 'future-paid', date: '2026-10-08' }])
  })
})

describe('DELETE /api/dashboard/enrolments/[id]/pause — clear pause and backfill', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset(); propagateMock.mockReset() })

  it('denies a caller below manager', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await pauseDelete(deleteRequest(), { params })
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('clears the pause and backfills eligible future instances from the booking date forward', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock
      .mockResolvedValueOnce([{ ...weeklyBooking, is_recurring: true }])
      .mockResolvedValueOnce([]) // DELETE FROM booking_recurrence_pauses
    propagateMock.mockResolvedValue({ propagated: 2, alreadyPresent: 1, paused: 0, capacityBlocked: 0, errors: 0, skippedDates: [] })

    const res = await pauseDelete(deleteRequest(), { params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.propagation.propagated).toBe(2)
    expect(propagateMock).toHaveBeenCalledWith(expect.objectContaining({ recurringGroupId: 'group-1', afterDate: '2026-08-18' }))
  })
})
