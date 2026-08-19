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

const archiveSessionAtomicallyMock = vi.fn()
const restoreSessionWithCompensationMock = vi.fn()
vi.mock('@/lib/tennisSchedule', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tennisSchedule')>('@/lib/tennisSchedule')
  return {
    ...actual,
    archiveSessionAtomically: (...args: unknown[]) => archiveSessionAtomicallyMock(...args),
    restoreSessionWithCompensation: (...args: unknown[]) => restoreSessionWithCompensationMock(...args),
  }
})

const { POST: archivePOST } = await import('@/app/api/dashboard/sessions/[id]/archive/route')
const { POST: restorePOST } = await import('@/app/api/dashboard/sessions/[id]/restore/route')

const manager = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Luke' }
const params = Promise.resolve({ id: 'sess-1' })

function postRequest(action: 'archive' | 'restore'): NextRequest {
  return asNextRequest(new Request(`http://localhost/api/dashboard/sessions/sess-1/${action}`, { method: 'POST' }))
}

describe('POST /api/dashboard/sessions/[id]/archive', () => {
  beforeEach(() => { requireRoleMock.mockReset(); archiveSessionAtomicallyMock.mockReset() })

  it('denies a caller below manager', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await archivePOST(postRequest('archive'), { params })
    expect(res.status).toBe(403)
    expect(archiveSessionAtomicallyMock).not.toHaveBeenCalled()
  })

  it('archives successfully and reports the cancellation result, including a protected-booking conflict as a success-with-warning, not a failure', async () => {
    requireRoleMock.mockResolvedValue(manager)
    archiveSessionAtomicallyMock.mockResolvedValue({
      outcome: 'archived', cancelledInstances: 2, conflicts: [{ instanceId: 'inst-1', date: '2099-01-02' }],
    })

    const res = await archivePOST(postRequest('archive'), { params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ archived: true, cancel: { cancelledInstances: 2, conflicts: [{ instanceId: 'inst-1', date: '2099-01-02' }] } })
    expect(archiveSessionAtomicallyMock).toHaveBeenCalledWith({ organisationId: 'org-a', sessionId: 'sess-1', actingUserId: 'u1' })
  })

  it('a cross-org / missing session reports 404, never a false success', async () => {
    requireRoleMock.mockResolvedValue(manager)
    archiveSessionAtomicallyMock.mockResolvedValue({ outcome: 'not_found' })
    const res = await archivePOST(postRequest('archive'), { params })
    expect(res.status).toBe(404)
  })

  it('archiving an already-archived session returns 409, not a silent no-op success', async () => {
    requireRoleMock.mockResolvedValue(manager)
    archiveSessionAtomicallyMock.mockResolvedValue({ outcome: 'already_archived' })
    const res = await archivePOST(postRequest('archive'), { params })
    expect(res.status).toBe(409)
  })

  it('an unexpected failure inside the atomic transaction returns 500 — never a 200 on a partially-completed archive', async () => {
    requireRoleMock.mockResolvedValue(manager)
    archiveSessionAtomicallyMock.mockRejectedValue(new Error('transaction rolled back'))
    const res = await archivePOST(postRequest('archive'), { params })
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBeDefined()
    expect(data.archived).toBeUndefined()
  })
})

describe('POST /api/dashboard/sessions/[id]/restore', () => {
  beforeEach(() => { requireRoleMock.mockReset(); restoreSessionWithCompensationMock.mockReset() })

  it('denies a caller below manager', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'))
    const res = await restorePOST(postRequest('restore'), { params })
    expect(res.status).toBe(403)
    expect(restoreSessionWithCompensationMock).not.toHaveBeenCalled()
  })

  it('clears archived_at and reports the reconcile result', async () => {
    requireRoleMock.mockResolvedValue(manager)
    restoreSessionWithCompensationMock.mockResolvedValue({ outcome: 'restored', reconcile: { generated: 4, cancelledInstances: 0, conflicts: [] } })

    const res = await restorePOST(postRequest('restore'), { params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.restored).toBe(true)
    expect(data.reconcile.generated).toBe(4)
    expect(restoreSessionWithCompensationMock).toHaveBeenCalledWith({ organisationId: 'org-a', sessionId: 'sess-1', actingUserId: 'u1' })
  })

  it('a cross-org / missing session reports 404', async () => {
    requireRoleMock.mockResolvedValue(manager)
    restoreSessionWithCompensationMock.mockResolvedValue({ outcome: 'not_found' })
    const res = await restorePOST(postRequest('restore'), { params })
    expect(res.status).toBe(404)
  })

  it('restoring a session that is not archived returns 409, not a silent no-op success', async () => {
    requireRoleMock.mockResolvedValue(manager)
    restoreSessionWithCompensationMock.mockResolvedValue({ outcome: 'not_archived' })
    const res = await restorePOST(postRequest('restore'), { params })
    expect(res.status).toBe(409)
  })

  it('a reconciliation failure — even after archived_at was cleared and compensated back internally — returns 500, never a false 200 success', async () => {
    requireRoleMock.mockResolvedValue(manager)
    restoreSessionWithCompensationMock.mockResolvedValue({ outcome: 'reconcile_failed', error: 'boom' })
    const res = await restorePOST(postRequest('restore'), { params })
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBeDefined()
    expect(data.restored).toBeUndefined()
  })
})

describe('Manage Sessions UX — active/archived toggle, badge, Restore action', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/dashboard/sessions/page.tsx'), 'utf-8')

  it('defaults to active sessions only', () => {
    expect(source).toContain('const [showArchived, setShowArchived] = useState(false)')
    expect(source).toContain('const visible = showArchived ? sessions : sessions.filter(s => !s.archived_at)')
  })

  it('"Show archived" toggle reveals archived sessions', () => {
    const fnStart = source.indexOf('function ManageSessionsModal(')
    const fnEnd = source.indexOf('\n// ─── Calendar')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('Show archived')
    expect(body).toContain('checked={showArchived}')
    expect(body).toContain('onChange={e => setShowArchived(e.target.checked)}')
  })

  it('an archived row displays an "Archived" badge', () => {
    const fnStart = source.indexOf('function ManageSessionsModal(')
    const fnEnd = source.indexOf('\n// ─── Calendar')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('const archived = !!s.archived_at')
    expect(body).toContain('{archived && (')
    expect(body).toContain('>Archived<')
  })

  it('a Restore action is wired for archived rows, calling the onRestore prop', () => {
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

describe('migration is additive and idempotent (static — live twice-run verification was performed separately against a disposable schema)', () => {
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
