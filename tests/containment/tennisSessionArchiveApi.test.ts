import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

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

const cancelFutureInstancesForArchiveMock = vi.fn()
const reconcileFutureInstancesMock = vi.fn()
vi.mock('@/lib/tennisSchedule', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tennisSchedule')>('@/lib/tennisSchedule')
  return {
    ...actual,
    cancelFutureInstancesForArchive: (...args: unknown[]) => cancelFutureInstancesForArchiveMock(...args),
    reconcileFutureInstances: (...args: unknown[]) => reconcileFutureInstancesMock(...args),
  }
})

const { POST: archivePOST } = await import('@/app/api/dashboard/sessions/[id]/archive/route')
const { POST: restorePOST } = await import('@/app/api/dashboard/sessions/[id]/restore/route')

const manager = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' }
const params = Promise.resolve({ id: 'sess-1' })

function postRequest(): NextRequest {
  return asNextRequest(new Request('http://localhost/api/dashboard/sessions/sess-1/archive', { method: 'POST' }))
}

describe('POST /api/dashboard/sessions/[id]/archive', () => {
  beforeEach(() => {
    requireRoleMock.mockReset(); sqlMock.mockReset(); cancelFutureInstancesForArchiveMock.mockReset()
  })

  it('16. denies a caller below manager', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await archivePOST(postRequest(), { params })
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('3. sets archived_at and reports the cancellation result', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockResolvedValueOnce([{ id: 'sess-1' }]) // UPDATE ... RETURNING id
    cancelFutureInstancesForArchiveMock.mockResolvedValue({ cancelledInstances: 2, conflicts: [] })

    const res = await archivePOST(postRequest(), { params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.archived).toBe(true)
    expect(data.cancel).toEqual({ cancelledInstances: 2, conflicts: [] })
    expect(cancelFutureInstancesForArchiveMock).toHaveBeenCalledWith({ organisationId: 'org-a', sessionId: 'sess-1' })

    const updateCall = sqlMock.mock.calls.find(call => (call[0] as string[]).join('').includes('UPDATE sessions'))
    expect((updateCall![0] as string[]).join('')).toContain('archived_at = NOW()')
    expect((updateCall![0] as string[]).join('')).toContain('archived_at IS NULL')
  })

  it('15. a cross-org id matches nothing — never archives another organisation\'s session', async () => {
    requireRoleMock.mockResolvedValue({ ...manager, organisationId: 'org-a' })
    sqlMock
      .mockResolvedValueOnce([]) // UPDATE ... WHERE organisation_id = 'org-a' matches zero rows (session belongs to org-b)
      .mockResolvedValueOnce([]) // existence check also finds nothing scoped to org-a
    const res = await archivePOST(postRequest(), { params })
    expect(res.status).toBe(404)
    expect(cancelFutureInstancesForArchiveMock).not.toHaveBeenCalled()
    const sawOrgA = sqlMock.mock.calls.some(call => call.includes('org-a'))
    expect(sawOrgA).toBe(true)
  })

  it('archiving an already-archived session returns a 409, not a silent no-op success', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock
      .mockResolvedValueOnce([]) // UPDATE ... AND archived_at IS NULL matches nothing (already archived)
      .mockResolvedValueOnce([{ id: 'sess-1' }]) // but it does exist for this org
    const res = await archivePOST(postRequest(), { params })
    expect(res.status).toBe(409)
    expect(cancelFutureInstancesForArchiveMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/dashboard/sessions/[id]/restore', () => {
  beforeEach(() => {
    requireRoleMock.mockReset(); sqlMock.mockReset(); reconcileFutureInstancesMock.mockReset()
  })

  it('16. denies a caller below manager', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await restorePOST(postRequest(), { params })
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('9/10. clears archived_at and immediately reconciles the session\'s future dates from its existing schedule rules', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockResolvedValueOnce([{
      id: 'sess-1', day_of_week: 2, start_time: '17:00', duration_minutes: 60, max_capacity: 8,
      session_type: 'GROUP', start_date: '2026-01-01', end_mode: 'ongoing', end_after_weeks: null, end_date: null,
    }])
    reconcileFutureInstancesMock.mockResolvedValue({ generated: 4, cancelledInstances: 0, conflicts: [] })

    const res = await restorePOST(postRequest(), { params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.restored).toBe(true)
    expect(data.reconcile.generated).toBe(4)
    expect(reconcileFutureInstancesMock).toHaveBeenCalledWith(expect.objectContaining({
      organisationId: 'org-a', sessionId: 'sess-1',
      rules: expect.objectContaining({ day_of_week: 2, end_mode: 'ongoing' }),
    }))

    const updateCall = sqlMock.mock.calls.find(call => (call[0] as string[]).join('').includes('UPDATE sessions'))
    expect((updateCall![0] as string[]).join('')).toContain('archived_at = NULL')
    expect((updateCall![0] as string[]).join('')).toContain('archived_at IS NOT NULL')
  })

  it('15. a cross-org id matches nothing — never restores another organisation\'s session', async () => {
    requireRoleMock.mockResolvedValue({ ...manager, organisationId: 'org-a' })
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await restorePOST(postRequest(), { params })
    expect(res.status).toBe(404)
    expect(reconcileFutureInstancesMock).not.toHaveBeenCalled()
  })

  it('restoring a session that is not archived returns a 409, not a silent no-op success', async () => {
    requireRoleMock.mockResolvedValue(manager)
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'sess-1' }])
    const res = await restorePOST(postRequest(), { params })
    expect(res.status).toBe(409)
    expect(reconcileFutureInstancesMock).not.toHaveBeenCalled()
  })
})

describe('11/12/13/14. Manage Sessions UX — active/archived toggle, badge, Restore action', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/dashboard/sessions/page.tsx'), 'utf-8')

  it('11. defaults to active sessions only', () => {
    expect(source).toContain('const [showArchived, setShowArchived] = useState(false)')
    expect(source).toContain('const visible = showArchived ? sessions : sessions.filter(s => !s.archived_at)')
  })

  it('12. "Show archived" toggle reveals archived sessions', () => {
    const fnStart = source.indexOf('function ManageSessionsModal(')
    const fnEnd = source.indexOf('\n// ─── Calendar')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('Show archived')
    expect(body).toContain('checked={showArchived}')
    expect(body).toContain('onChange={e => setShowArchived(e.target.checked)}')
  })

  it('13. an archived row displays an "Archived" badge', () => {
    const fnStart = source.indexOf('function ManageSessionsModal(')
    const fnEnd = source.indexOf('\n// ─── Calendar')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('const archived = !!s.archived_at')
    expect(body).toContain('{archived && (')
    expect(body).toContain('>Archived<')
  })

  it('14. a Restore action is wired for archived rows, calling the onRestore prop', () => {
    const fnStart = source.indexOf('function ManageSessionsModal(')
    const fnEnd = source.indexOf('\n// ─── Calendar')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('handleRestoreClick(s.id)')
    expect(body).toContain('await onRestore(id)')
  })

  it('Repair is hidden for archived rows (nothing to reconcile) and Archive is hidden once already archived — no over-cluttered action row', () => {
    const fnStart = source.indexOf('function ManageSessionsModal(')
    const fnEnd = source.indexOf('\n// ─── Calendar')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toMatch(/archived \? \(\s*<button onClick=\{\(\) => handleRestoreClick/)
    expect(body).toContain('{!archived && (')
  })

  it('the page wires handleArchive/handleRestore into the modal', () => {
    expect(source).toContain('onArchive={handleArchive}')
    expect(source).toContain('onRestore={handleRestore}')
  })
})

describe('17. migration is additive and idempotent (static — live twice-run verification was performed separately against a disposable schema)', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../scripts/add-session-archive.sql'), 'utf-8')

  it('adds the column and index idempotently (IF NOT EXISTS)', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS archived_at timestamptz')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_sessions_archived_at')
  })

  it('the column is nullable with no default — no backfill, every existing row stays active', () => {
    expect(sql).not.toMatch(/archived_at timestamptz NOT NULL/)
    expect(sql).not.toMatch(/archived_at timestamptz[^;]*DEFAULT/i)
  })

  it('is purely additive — no DROP/RENAME/ALTER COLUMN TYPE outside the commented rollback block', () => {
    const liveStatements = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
    expect(liveStatements).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
    expect(liveStatements).not.toMatch(/RENAME/i)
    expect(liveStatements).not.toMatch(/ALTER\s+COLUMN\s+\w+\s+TYPE/i)
  })
})
