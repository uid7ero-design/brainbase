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
})
