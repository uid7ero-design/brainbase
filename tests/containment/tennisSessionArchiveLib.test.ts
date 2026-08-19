import { describe, it, expect, vi, beforeEach } from 'vitest'

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}))

const { cancelFutureInstancesForArchive, reconcileAllSessionsForOrg } = await import('@/lib/tennisSchedule')

describe('cancelFutureInstancesForArchive — real execution against a mocked db', () => {
  beforeEach(() => { sqlMock.mockReset() })

  it('4/5/6/8. cancels safe future instances, leaves protected (paid/attended) ones scheduled, reports them as conflicts, and never rewrites a protected booking', async () => {
    // Call order inside cancelStaleFutureInstances (shared by reconcile and
    // archive — see lib/tennisSchedule.ts):
    //   1. SELECT staleCandidates (both future 'scheduled' instances)
    //   2. SELECT protectedBookings for the first (safe) instance -> []
    //   3. UPDATE bookings for the safe instance
    //   4. UPDATE session_instances for the safe instance
    //   5. SELECT protectedBookings for the second (protected) instance -> [{id:'b1'}]
    //      (no further UPDATE calls for this one — it's left scheduled)
    sqlMock
      .mockResolvedValueOnce([
        { id: 'inst-safe', date: '2099-01-01' },
        { id: 'inst-protected', date: '2099-01-02' },
      ])
      .mockResolvedValueOnce([]) // inst-safe has no protected booking
      .mockResolvedValueOnce([]) // UPDATE bookings (safe)
      .mockResolvedValueOnce([]) // UPDATE session_instances (safe)
      .mockResolvedValueOnce([{ id: 'booking-1' }]) // inst-protected IS protected

    const result = await cancelFutureInstancesForArchive({ organisationId: 'org-a', sessionId: 'sess-1' })

    expect(result.cancelledInstances).toBe(1)
    expect(result.conflicts).toEqual([{ instanceId: 'inst-protected', date: '2099-01-02' }])
    // Exactly 5 calls — no extra UPDATE was issued for the protected instance.
    expect(sqlMock).toHaveBeenCalledTimes(5)
  })

  it('7. only ever selects instances dated today or later — the underlying query text excludes past instances', async () => {
    sqlMock.mockResolvedValueOnce([])
    await cancelFutureInstancesForArchive({ organisationId: 'org-a', sessionId: 'sess-1' })
    const queryText = (sqlMock.mock.calls[0][0] as string[]).join('')
    expect(queryText).toContain("status = 'scheduled'")
    expect(queryText).toContain('date >=')
  })

  it('never generates a new instance — archiving only ever cancels, it has no INSERT path', async () => {
    sqlMock.mockResolvedValue([])
    await cancelFutureInstancesForArchive({ organisationId: 'org-a', sessionId: 'sess-1' })
    for (const call of sqlMock.mock.calls) {
      expect((call[0] as string[]).join('')).not.toContain('INSERT INTO session_instances')
    }
  })
})

describe('reconcileAllSessionsForOrg — archived sessions are excluded (1/2)', () => {
  beforeEach(() => { sqlMock.mockReset() })

  it('2. the org-wide session query excludes archived_at IS NOT NULL rows', async () => {
    sqlMock.mockResolvedValueOnce([]) // sessions query returns none
    await reconcileAllSessionsForOrg('org-a')
    const queryText = (sqlMock.mock.calls[0][0] as string[]).join('')
    expect(queryText).toContain('archived_at IS NULL')
    expect(queryText).toContain('organisation_id = ')
  })

  it('1. an active (archived_at IS NULL) session is still included and reconciled normally', async () => {
    sqlMock
      .mockResolvedValueOnce([{
        id: 'sess-active', day_of_week: 1, start_time: '10:00', duration_minutes: 60, max_capacity: 8,
        session_type: 'GROUP', start_date: null, end_mode: 'ongoing', end_after_weeks: null, end_date: null,
      }])
      // reconcileFutureInstances internals: UPDATE (time/capacity), then
      // per-expected-date INSERT attempts, then the stale-cancel SELECT.
      // Blanket-resolve everything else to keep this test focused on "was
      // the active session included at all", not the full reconcile
      // mechanics (already covered by this session's existing schedule tests).
      .mockResolvedValue([])
    const result = await reconcileAllSessionsForOrg('org-a')
    expect(result.reconciled).toBe(1)
    expect(result.errors).toEqual([])
  })
})
