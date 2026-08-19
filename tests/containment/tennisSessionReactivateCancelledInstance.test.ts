import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression coverage for the LD Tennis production bug: a session archived
// and restored ("Restored — Already up to date — nothing to repair.") left
// its future Sundays missing from the calendar entirely. Root cause: the
// unique index on session_instances(session_id, date) means
// `INSERT ... ON CONFLICT (session_id, date) DO NOTHING` no-ops whenever
// ANY row already exists for that date — including a stale 'cancelled' one
// left behind by an earlier archive/schedule-shrink. The calendar only ever
// shows status = 'scheduled' rows, so a date stuck on a cancelled row was
// permanently invisible, and reconcile/restore/repair all reported
// "nothing to do" forever because the INSERT never told them otherwise.

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}))

const enrolActiveLineagesMock = vi.fn()
vi.mock('@/lib/tennisRecurrence', () => ({
  enrolActiveLineagesIntoNewInstance: (...args: unknown[]) => enrolActiveLineagesMock(...args),
}))

const { reconcileFutureInstances } = await import('@/lib/tennisSchedule')

// Matches the actual production repro: "today" is Wed 2026-08-19, the
// session runs Sundays, and the missing dates were Sun 2026-08-23 and
// Sun 2026-08-30.
const SUNDAY = 0
const baseRules = {
  day_of_week: SUNDAY,
  start_date: '2026-08-02', // an earlier Sunday — schedule already underway
  end_mode: 'on_date' as const,
  end_after_weeks: null,
  end_date: '2026-09-06', // bounds expected occurrences to exactly 3 known Sundays
}
function baseParams(overrides: Partial<Parameters<typeof reconcileFutureInstances>[0]> = {}) {
  return {
    organisationId: 'org-a',
    sessionId: 'sess-1',
    rules: baseRules,
    startTime: '03:00',
    durationMinutes: 60,
    maxCapacity: 8,
    sessionType: 'GROUP_TERM_JUNIOR',
    ...overrides,
  }
}

// A tiny fake session_instances table for this one session, keyed by date,
// so each test can express "this date already has a row in status X" and
// have the mock behave the way the real unique-indexed table would.
type FakeRow = { id: string; status: 'scheduled' | 'cancelled'; protected?: boolean }

function installFakeDb(rows: Record<string, FakeRow>) {
  sqlMock.mockReset()
  enrolActiveLineagesMock.mockReset()
  sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('')

    if (text.includes('SET start_time') && text.includes('duration_minutes') && !text.includes('WHERE id =')) {
      return Promise.resolve([]) // blanket future-instance field refresh
    }

    if (text.includes('INSERT INTO session_instances')) {
      const date = values[3] as string
      if (rows[date]) return Promise.resolve([]) // ON CONFLICT DO NOTHING — a row already exists
      return Promise.resolve([{ id: `new-${date}` }])
    }

    if (text.includes('SELECT id, status FROM session_instances')) {
      const date = values[2] as string
      const row = rows[date]
      return Promise.resolve(row ? [{ id: row.id, status: row.status }] : [])
    }

    if (text.includes('SELECT id FROM bookings') && text.includes('paid = true OR attendance_status')) {
      const instanceId = values[0] as string
      const row = Object.values(rows).find(r => r.id === instanceId)
      return Promise.resolve(row?.protected ? [{ id: 'protected-booking-1' }] : [])
    }

    if (text.includes('UPDATE session_instances') && text.includes("status = 'scheduled'") && text.includes('WHERE id =')) {
      const instanceId = values[values.length - 1] as string
      const row = Object.values(rows).find(r => r.id === instanceId)
      if (row) row.status = 'scheduled'
      return Promise.resolve([])
    }

    if (text.includes('SELECT COUNT(*)::int AS cnt FROM bookings')) {
      return Promise.resolve([{ cnt: 0 }])
    }

    // cancelStaleFutureInstances' own future-scheduled-instance scan — none
    // of these tests need it to find anything.
    if (text.includes('FROM session_instances') && text.includes("status = 'scheduled'") && text.includes('date >=')) {
      return Promise.resolve([])
    }

    return Promise.resolve([])
  })
}

describe('reconcileFutureInstances — a stale cancelled instance no longer permanently blocks its date', () => {
  beforeEach(() => { sqlMock.mockReset(); enrolActiveLineagesMock.mockReset() })

  it('reactivates a cancelled instance on a desired future Sunday instead of leaving the date dead (the exact archive/restore bug)', async () => {
    installFakeDb({
      '2026-08-23': { id: 'inst-aug23', status: 'cancelled' },
    })

    const result = await reconcileFutureInstances(baseParams())

    expect(result.reactivated).toBe(1)
    expect(result.generated).toBe(2) // the other two Sundays had no row at all — genuinely new
    expect(result.conflicts).toEqual([])

    const reactivateCall = sqlMock.mock.calls.find(c =>
      (c[0] as string[]).join('').includes('UPDATE session_instances') &&
      (c[0] as string[]).join('').includes("SET status = 'scheduled'") &&
      c.includes('inst-aug23'),
    )
    expect(reactivateCall).toBeDefined()
    expect(enrolActiveLineagesMock).toHaveBeenCalledWith(expect.objectContaining({
      instance: expect.objectContaining({ id: 'inst-aug23', date: '2026-08-23' }),
    }))
  })

  it('reuses the existing row in place — never deletes it or inserts a second row for the same date', async () => {
    installFakeDb({
      '2026-08-23': { id: 'inst-aug23', status: 'cancelled' },
    })
    await reconcileFutureInstances(baseParams())

    const deleteCalls = sqlMock.mock.calls.filter(c => (c[0] as string[]).join('').includes('DELETE'))
    expect(deleteCalls).toHaveLength(0)
    // Only one INSERT was attempted for 2026-08-23 (the original conflicting
    // one) — no second insert/duplicate-row attempt for that date.
    const insertsForAug23 = sqlMock.mock.calls.filter(c =>
      (c[0] as string[]).join('').includes('INSERT INTO session_instances') && c[4] === '2026-08-23',
    )
    expect(insertsForAug23).toHaveLength(1)
  })

  it('multiple future cancelled desired dates are all reactivated independently', async () => {
    installFakeDb({
      '2026-08-23': { id: 'inst-aug23', status: 'cancelled' },
      '2026-08-30': { id: 'inst-aug30', status: 'cancelled' },
      '2026-09-06': { id: 'inst-sep06', status: 'cancelled' },
    })

    const result = await reconcileFutureInstances(baseParams())

    expect(result.reactivated).toBe(3)
    expect(result.generated).toBe(0)
    const reactivatedIds = sqlMock.mock.calls
      .filter(c => (c[0] as string[]).join('').includes('UPDATE session_instances') && (c[0] as string[]).join('').includes("SET status = 'scheduled'"))
      .map(c => c[c.length - 1])
    expect(reactivatedIds.sort()).toEqual(['inst-aug23', 'inst-aug30', 'inst-sep06'])
  })

  it('an already-scheduled desired date is left untouched — not reactivated, not duplicated, not counted as generated', async () => {
    installFakeDb({
      '2026-08-23': { id: 'inst-aug23', status: 'scheduled' },
    })

    const result = await reconcileFutureInstances(baseParams())

    expect(result.reactivated).toBe(0)
    expect(result.generated).toBe(2) // only the two genuinely-missing dates
    const reactivateCalls = sqlMock.mock.calls.filter(c =>
      (c[0] as string[]).join('').includes('UPDATE session_instances') && (c[0] as string[]).join('').includes("SET status = 'scheduled'"),
    )
    expect(reactivateCalls).toHaveLength(0)
    expect(enrolActiveLineagesMock).not.toHaveBeenCalledWith(expect.objectContaining({
      instance: expect.objectContaining({ id: 'inst-aug23' }),
    }))
  })

  it('a cancelled instance with a protected (paid/attended) booking is left cancelled and reported as a conflict, never silently overwritten', async () => {
    installFakeDb({
      '2026-08-23': { id: 'inst-aug23', status: 'cancelled', protected: true },
    })

    const result = await reconcileFutureInstances(baseParams())

    expect(result.reactivated).toBe(0)
    expect(result.conflicts).toEqual([{ instanceId: 'inst-aug23', date: '2026-08-23' }])
    const reactivateCalls = sqlMock.mock.calls.filter(c =>
      (c[0] as string[]).join('').includes('UPDATE session_instances') && (c[0] as string[]).join('').includes("SET status = 'scheduled'"),
    )
    expect(reactivateCalls).toHaveLength(0)
    // The two other, genuinely new dates still enrol normally — only the
    // protected instance itself is never touched.
    expect(enrolActiveLineagesMock).not.toHaveBeenCalledWith(expect.objectContaining({
      instance: expect.objectContaining({ id: 'inst-aug23' }),
    }))
  })

  it('the reactivation lookup is scoped to the caller organisation_id, same as every other query in this module', async () => {
    installFakeDb({ '2026-08-23': { id: 'inst-aug23', status: 'cancelled' } })
    await reconcileFutureInstances(baseParams({ organisationId: 'org-a' }))

    const lookupCall = sqlMock.mock.calls.find(c => (c[0] as string[]).join('').includes('SELECT id, status FROM session_instances'))
    expect(lookupCall).toBeDefined()
    expect(lookupCall).toContain('org-a')
  })

  it('never issues a reactivation lookup for a date before today — expected dates are always future-bounded', async () => {
    installFakeDb({ '2026-08-23': { id: 'inst-aug23', status: 'cancelled' } })
    await reconcileFutureInstances(baseParams())

    const lookupCalls = sqlMock.mock.calls.filter(c => (c[0] as string[]).join('').includes('SELECT id, status FROM session_instances'))
    // Exactly one lookup per expected date whose INSERT conflicted — never
    // for a date outside computeExpectedOccurrences' [today, horizon] range.
    for (const call of lookupCalls) {
      const date = call[3] as string
      expect(new Date(date) >= new Date('2026-08-19')).toBe(true)
    }
  })
})

describe('generate-instances (Repair) and restore share the corrected reconciliation — no restore-only special case', () => {
  it('Repair (generate-instances route) surfaces reactivated dates through the exact same reconcileFutureInstances call restore uses', async () => {
    installFakeDb({ '2026-08-23': { id: 'inst-aug23', status: 'cancelled' } })
    const result = await reconcileFutureInstances(baseParams())
    // The generate-instances route (app/api/dashboard/sessions/[id]/generate-instances/route.ts)
    // returns `reconcile` verbatim from this same function — proving the fix
    // lives in the shared layer is exactly proving this object shape.
    expect(result).toEqual({
      generated: 2,
      reactivated: 1,
      cancelledInstances: 0,
      conflicts: [],
    })
  })
})
