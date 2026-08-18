import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireRoleMock = vi.fn()
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}))

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}))

const { GET } = await import('@/app/api/dashboard/sessions/route')

describe('GET /api/dashboard/sessions — session-level PLAYERS/enrolled_count semantics', () => {
  beforeEach(() => { requireRoleMock.mockReset(); sqlMock.mockReset() })

  it('denies a caller below viewer', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('the enrolled_count query counts distinct recurring lineages / distinct one-off booking ids, not total booking rows', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' })
    // The mock can't execute real SQL, so this asserts on the query text
    // itself — the real semantics are proven against a live database in
    // tests/containment/tennisSessionPlayerCount.integration.test.ts.
    sqlMock.mockResolvedValueOnce([])
    await GET()
    const querySql = (sqlMock.mock.calls[0][0] as string[]).join('')
    expect(querySql).toContain('COUNT(DISTINCT COALESCE(b.recurring_group_id, b.id))')
    // Regression guard: must not regress to the old total-row-count form.
    expect(querySql).not.toMatch(/COUNT\(\*\)::int FROM bookings b\s*\n\s*WHERE b\.session_id/)
  })

  it('performs no write: exactly one sql call (the SELECT), nothing else — reconciliation is not a side effect of this GET', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' })
    sqlMock.mockResolvedValueOnce([{ id: 's1', day_of_week: 1, start_time: '10:00', enrolled_count: 0 }])
    await GET()
    // If GET still fired reconcileFutureInstances (INSERT/UPDATE session_instances,
    // SELECT for protected bookings, etc.) there would be more than one call here.
    expect(sqlMock).toHaveBeenCalledTimes(1)
    const querySql = (sqlMock.mock.calls[0][0] as string[]).join('')
    expect(querySql).toContain('SELECT')
    expect(querySql).not.toMatch(/INSERT INTO session_instances|UPDATE session_instances/)
  })
})
