import { describe, it, expect, vi, beforeEach } from 'vitest'

const sqlMock = vi.fn()
const transactionMock = vi.fn()
function sqlFn(...args: unknown[]) { return sqlMock(...args) }
sqlFn.transaction = (...args: unknown[]) => transactionMock(...args)
vi.mock('@/lib/db', () => ({ default: sqlFn }))

const { archiveSessionAtomically, restoreSessionWithCompensation, reconcileAllSessionsForOrg } = await import('@/lib/tennisSchedule')

// PII that must never appear in an audit_logs before_state/after_state
// payload — the brief explicitly forbids names, emails, booking PII,
// payment information, and secrets. Counts and IDs only.
const FORBIDDEN_AUDIT_CONTENT = /email|phone|payment|card|name.*:.*['"]\w|address/i

describe('archiveSessionAtomically — real execution against a mocked db', () => {
  beforeEach(() => { sqlMock.mockReset(); transactionMock.mockReset() })

  it('archives, cancels safe future instances, leaves protected ones as conflicts (not failures), and writes one audit entry — all inside a single sql.transaction() call', async () => {
    sqlMock
      .mockResolvedValueOnce([{ archived_at: null }]) // existence + not-already-archived check
      .mockResolvedValueOnce([ // candidates, protected computed in-query
        { id: 'inst-safe', date: '2099-01-01', protected: false },
        { id: 'inst-protected', date: '2099-01-02', protected: true },
      ])
      .mockResolvedValue([]) // every query-construction call while building the transaction batch

    transactionMock.mockResolvedValueOnce([
      [{ id: 'sess-1', archived_at: '2026-08-19T00:00:00.000Z' }], // UPDATE sessions ... RETURNING
    ])

    const result = await archiveSessionAtomically({ organisationId: 'org-a', sessionId: 'sess-1', actingUserId: 'u1' })

    expect(result).toEqual({
      outcome: 'archived',
      cancelledInstances: 1,
      conflicts: [{ instanceId: 'inst-protected', date: '2099-01-02' }],
    })
    expect(transactionMock).toHaveBeenCalledTimes(1)

    // 2 direct reads (existence check, candidates) + 4 queries built into the
    // transaction batch (archived_at UPDATE, 1 safe instance's 2 cancel
    // UPDATEs, 1 audit insert) — the protected instance contributes none.
    expect(sqlMock).toHaveBeenCalledTimes(6)
    expect((sqlMock.mock.calls[2][0] as string[]).join('')).toContain('UPDATE sessions')
    expect((sqlMock.mock.calls[2][0] as string[]).join('')).toContain('archived_at = NOW()')
    expect((sqlMock.mock.calls[2][0] as string[]).join('')).toContain('archived_at IS NULL')

    const auditCall = sqlMock.mock.calls.find(call => (call[0] as string[]).join('').includes('INSERT INTO audit_logs'))
    expect(auditCall).toBeDefined()
    // [strings, id, organisationId, userId, action, sessionId, beforeStateJSON, afterStateJSON]
    expect(auditCall![2]).toBe('org-a')
    expect(auditCall![3]).toBe('u1')
    expect(auditCall![4]).toBe('session.archive')
    expect(auditCall![5]).toBe('sess-1')
    expect(auditCall![6]).toBe(JSON.stringify({ archived_at: null }))
    expect(auditCall![7]).toBe(JSON.stringify({ archived_at: 'now', cancelledInstances: 1, conflictCount: 1 }))
    expect(JSON.stringify(auditCall)).not.toMatch(FORBIDDEN_AUDIT_CONTENT)
  })

  it('a rejected sql.transaction() call propagates unchanged — the route must never report success from a partially applied archive', async () => {
    sqlMock
      .mockResolvedValueOnce([{ archived_at: null }])
      .mockResolvedValueOnce([{ id: 'inst-safe', date: '2099-01-01', protected: false }])
      .mockResolvedValue([])
    transactionMock.mockRejectedValueOnce(new Error('connection reset mid-transaction'))

    await expect(
      archiveSessionAtomically({ organisationId: 'org-a', sessionId: 'sess-1', actingUserId: 'u1' }),
    ).rejects.toThrow('connection reset mid-transaction')
  })

  it('a cross-org id matches nothing — never archives another organisation\'s session, and never opens a transaction', async () => {
    sqlMock.mockResolvedValueOnce([]) // existence check scoped to organisationId finds nothing
    const result = await archiveSessionAtomically({ organisationId: 'org-a', sessionId: 'sess-1', actingUserId: 'u1' })
    expect(result).toEqual({ outcome: 'not_found' })
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('an already-archived session is reported, not silently re-archived, and never opens a transaction', async () => {
    sqlMock.mockResolvedValueOnce([{ archived_at: '2026-01-01T00:00:00.000Z' }])
    const result = await archiveSessionAtomically({ organisationId: 'org-a', sessionId: 'sess-1', actingUserId: 'u1' })
    expect(result).toEqual({ outcome: 'already_archived' })
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('losing a race with a concurrent archive inside the transaction itself is reported as already_archived, never a false success', async () => {
    sqlMock
      .mockResolvedValueOnce([{ archived_at: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([])
    transactionMock.mockResolvedValueOnce([[]]) // UPDATE ... RETURNING matched zero rows
    const result = await archiveSessionAtomically({ organisationId: 'org-a', sessionId: 'sess-1', actingUserId: 'u1' })
    expect(result).toEqual({ outcome: 'already_archived' })
  })
})

describe('restoreSessionWithCompensation — real execution against a mocked db', () => {
  beforeEach(() => { sqlMock.mockReset(); transactionMock.mockReset() })

  const scheduleRow = {
    day_of_week: 2, start_time: '17:00', duration_minutes: 60, max_capacity: 8, session_type: 'GROUP',
    start_date: '2026-01-01', end_mode: 'ongoing' as const, end_after_weeks: null, end_date: null,
  }

  it('clears archived_at, reconciles, and writes a success audit event with no PII', async () => {
    sqlMock
      .mockResolvedValueOnce([{ archived_at: '2026-01-01T00:00:00.000Z', ...scheduleRow }]) // SELECT rows
      .mockResolvedValueOnce([{ id: 'sess-1' }]) // UPDATE clear archived_at ... RETURNING id
      .mockResolvedValue([]) // everything reconcileFutureInstances touches, plus the final audit insert

    const result = await restoreSessionWithCompensation({ organisationId: 'org-a', sessionId: 'sess-1', actingUserId: 'u1' })

    expect(result).toEqual({ outcome: 'restored', reconcile: { generated: 0, cancelledInstances: 0, conflicts: [] } })

    const auditCall = sqlMock.mock.calls.find(call => (call[0] as string[]).join('').includes('INSERT INTO audit_logs'))
    expect(auditCall).toBeDefined()
    expect(auditCall![2]).toBe('org-a')
    expect(auditCall![3]).toBe('u1')
    expect(auditCall![4]).toBe('session.restore')
    expect(auditCall![5]).toBe('sess-1')
    expect(auditCall![6]).toBe(JSON.stringify({ archived_at: '2026-01-01T00:00:00.000Z' }))
    expect(auditCall![7]).toBe(JSON.stringify({ archived_at: null, generated: 0, cancelledInstances: 0 }))
    expect(JSON.stringify(auditCall)).not.toMatch(FORBIDDEN_AUDIT_CONTENT)
  })

  it('a reconcile failure after archived_at was cleared triggers a compensating rollback to the EXACT previous archived_at value — never a false success, never an audit event', async () => {
    const PREVIOUS_ARCHIVED_AT = '2026-01-01T00:00:00.000Z'
    sqlMock
      .mockResolvedValueOnce([{ archived_at: PREVIOUS_ARCHIVED_AT, ...scheduleRow }]) // SELECT rows
      .mockResolvedValueOnce([{ id: 'sess-1' }]) // clear archived_at succeeds
      .mockRejectedValueOnce(new Error('reconcile boom')) // first statement inside reconcileFutureInstances fails
      .mockResolvedValueOnce([]) // compensating UPDATE

    const result = await restoreSessionWithCompensation({ organisationId: 'org-a', sessionId: 'sess-1', actingUserId: 'u1' })

    expect(result).toEqual({ outcome: 'reconcile_failed', error: 'reconcile boom' })
    expect(sqlMock).toHaveBeenCalledTimes(4)

    const compensatingCall = sqlMock.mock.calls[3]
    expect((compensatingCall[0] as string[]).join('')).toContain('UPDATE sessions')
    expect((compensatingCall[0] as string[]).join('')).toContain('archived_at')
    // The exact previous timestamp is restored — not "now", not null.
    expect(compensatingCall[1]).toBe(PREVIOUS_ARCHIVED_AT)

    const auditCall = sqlMock.mock.calls.find(call => (call[0] as string[]).join('').includes('INSERT INTO audit_logs'))
    expect(auditCall).toBeUndefined()
  })

  it('even if the compensating rollback itself also fails, the function still reports reconcile_failed rather than throwing or claiming success', async () => {
    sqlMock
      .mockResolvedValueOnce([{ archived_at: '2026-01-01T00:00:00.000Z', ...scheduleRow }])
      .mockResolvedValueOnce([{ id: 'sess-1' }])
      .mockRejectedValueOnce(new Error('reconcile boom'))
      .mockRejectedValueOnce(new Error('compensation also failed'))

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await restoreSessionWithCompensation({ organisationId: 'org-a', sessionId: 'sess-1', actingUserId: 'u1' })
    expect(result).toEqual({ outcome: 'reconcile_failed', error: 'reconcile boom' })
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('a cross-org id matches nothing — never restores another organisation\'s session', async () => {
    sqlMock.mockResolvedValueOnce([])
    const result = await restoreSessionWithCompensation({ organisationId: 'org-a', sessionId: 'sess-1', actingUserId: 'u1' })
    expect(result).toEqual({ outcome: 'not_found' })
  })

  it('restoring a session that is not archived reports not_archived, not a silent no-op success', async () => {
    sqlMock.mockResolvedValueOnce([{ archived_at: null, ...scheduleRow }])
    const result = await restoreSessionWithCompensation({ organisationId: 'org-a', sessionId: 'sess-1', actingUserId: 'u1' })
    expect(result).toEqual({ outcome: 'not_archived' })
  })

  it('losing a race with a concurrent restore (the clearing UPDATE matches zero rows) is reported as not_archived, never a false success', async () => {
    sqlMock
      .mockResolvedValueOnce([{ archived_at: '2026-01-01T00:00:00.000Z', ...scheduleRow }])
      .mockResolvedValueOnce([]) // UPDATE ... AND archived_at IS NOT NULL matched zero rows
    const result = await restoreSessionWithCompensation({ organisationId: 'org-a', sessionId: 'sess-1', actingUserId: 'u1' })
    expect(result).toEqual({ outcome: 'not_archived' })
  })
})

describe('reconcileAllSessionsForOrg — archived sessions are excluded', () => {
  beforeEach(() => { sqlMock.mockReset() })

  it('the org-wide session query excludes archived_at IS NOT NULL rows', async () => {
    sqlMock.mockResolvedValueOnce([]) // sessions query returns none
    await reconcileAllSessionsForOrg('org-a')
    const queryText = (sqlMock.mock.calls[0][0] as string[]).join('')
    expect(queryText).toContain('archived_at IS NULL')
    expect(queryText).toContain('organisation_id = ')
  })

  it('an active (archived_at IS NULL) session is still included and reconciled normally', async () => {
    sqlMock
      .mockResolvedValueOnce([{
        id: 'sess-active', day_of_week: 1, start_time: '10:00', duration_minutes: 60, max_capacity: 8,
        session_type: 'GROUP', start_date: null, end_mode: 'ongoing', end_after_weeks: null, end_date: null,
      }])
      .mockResolvedValue([])
    const result = await reconcileAllSessionsForOrg('org-a')
    expect(result.reconciled).toBe(1)
    expect(result.errors).toEqual([])
  })
})
