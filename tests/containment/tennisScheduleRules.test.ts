import { describe, it, expect, vi, beforeEach } from 'vitest'

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}))

const enrolActiveLineagesMock = vi.fn()
vi.mock('@/lib/tennisRecurrence', () => ({
  enrolActiveLineagesIntoNewInstance: (...args: unknown[]) => enrolActiveLineagesMock(...args),
}))

const { computeExpectedOccurrences, reconcileFutureInstances, reconcileAllSessionsForOrg, HORIZON_WEEKS } = await import('@/lib/tennisSchedule')

function d(y: number, m: number, day: number): Date {
  return new Date(y, m - 1, day)
}

// A Wednesday, arbitrarily chosen as "today" for pure-function tests.
const TODAY = d(2026, 8, 19)

describe('computeExpectedOccurrences — pure schedule computation', () => {
  it('after_weeks: generates exactly the requested count of weekly occurrences, counted from the schedule\'s own start', () => {
    // start_date is a Wednesday (TODAY itself) with a Monday schedule, so
    // the first occurrence (08-24) and all 9 weeks after it are >= today —
    // nothing gets dropped as "already past" here.
    const dates = computeExpectedOccurrences(
      { day_of_week: 1, start_date: '2026-08-19', end_mode: 'after_weeks', end_after_weeks: 10, end_date: null },
      TODAY,
    )
    expect(dates).toHaveLength(10)
    expect(dates[0]).toBe('2026-08-24')
    expect(dates[9]).toBe('2026-10-26') // 9 weeks after the first Monday
    // Strictly weekly, no gaps or duplicates.
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1])
      const cur = new Date(dates[i])
      expect((cur.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)).toBe(7)
    }
  })

  it('after_weeks: an already-underway term still ends on its originally-intended week, not shrunk by re-checking later', () => {
    // Term's true first occurrence was 2026-07-06 (a Monday), 10 weeks —
    // several of those weeks are already in the past relative to TODAY
    // (2026-08-19), so only the remaining future ones are returned, but the
    // final one still lands on week 10 counted from the TRUE start
    // (2026-09-07), not shifted by recomputing from today.
    const dates = computeExpectedOccurrences(
      { day_of_week: 1, start_date: '2026-07-06', end_mode: 'after_weeks', end_after_weeks: 10, end_date: null },
      TODAY,
    )
    expect(dates).toEqual(['2026-08-24', '2026-08-31', '2026-09-07'])
    // None of the returned dates are in the past.
    for (const date of dates) expect(new Date(date) >= TODAY).toBe(true)
  })

  it('on_date: stops generating at the end date and never generates past it', () => {
    const dates = computeExpectedOccurrences(
      { day_of_week: 5, start_date: '2026-08-19', end_mode: 'on_date', end_after_weeks: null, end_date: '2026-09-11' },
      TODAY,
    )
    // Fridays from 2026-08-21 through the last Friday on/before 2026-09-11.
    expect(dates).toEqual(['2026-08-21', '2026-08-28', '2026-09-04', '2026-09-11'])
    expect(dates.every(date => date <= '2026-09-11')).toBe(true)
  })

  it('ongoing: keeps a rolling window of exactly HORIZON_WEEKS from today, never an unbounded/infinite list', () => {
    const dates = computeExpectedOccurrences(
      { day_of_week: 1, start_date: '2026-08-17', end_mode: 'ongoing', end_after_weeks: null, end_date: null },
      TODAY,
    )
    expect(dates.length).toBeLessThanOrEqual(HORIZON_WEEKS + 1)
    expect(dates.length).toBeGreaterThan(0)
    const last = new Date(dates[dates.length - 1])
    const horizonEnd = new Date(TODAY); horizonEnd.setDate(horizonEnd.getDate() + HORIZON_WEEKS * 7)
    expect(last <= horizonEnd).toBe(true)
  })

  it('never returns a date before today, even for a schedule whose start_date is in the past', () => {
    const dates = computeExpectedOccurrences(
      { day_of_week: 1, start_date: '2020-01-01', end_mode: 'ongoing', end_after_weeks: null, end_date: null },
      TODAY,
    )
    expect(dates.every(date => new Date(date) >= TODAY)).toBe(true)
  })

  it('a legacy session with no start_date (null) is treated as ongoing-from-today, matching prior default behaviour', () => {
    const dates = computeExpectedOccurrences(
      { day_of_week: 1, start_date: null, end_mode: 'ongoing', end_after_weeks: null, end_date: null },
      TODAY,
    )
    expect(dates.length).toBeGreaterThan(0)
    expect(new Date(dates[0]) >= TODAY).toBe(true)
  })

  it('never produces duplicate dates', () => {
    const dates = computeExpectedOccurrences(
      { day_of_week: 3, start_date: '2026-08-19', end_mode: 'ongoing', end_after_weeks: null, end_date: null },
      TODAY,
    )
    expect(new Set(dates).size).toBe(dates.length)
  })
})

describe('reconcileFutureInstances — DB-mocked safety behaviour', () => {
  beforeEach(() => { sqlMock.mockReset(); enrolActiveLineagesMock.mockReset() })

  it('never issues any query touching dates before today (past instances untouched) — the UPDATE/SELECT are both date-bounded to >= today', async () => {
    sqlMock.mockResolvedValue([]) // every call: UPDATE (no return needed), INSERTs, final SELECT
    await reconcileFutureInstances({
      organisationId: 'org-a', sessionId: 'sess-1',
      rules: { day_of_week: 1, start_date: '2026-08-17', end_mode: 'ongoing', end_after_weeks: null, end_date: null },
      startTime: '17:00', durationMinutes: 60, maxCapacity: 8, sessionType: 'GROUP_TERM_JUNIOR',
    })
    // First call is the future-only UPDATE of start_time/duration/capacity.
    const firstCallSql = (sqlMock.mock.calls[0][0] as string[]).join('')
    expect(firstCallSql).toContain('status = \'scheduled\'')
    expect(firstCallSql).toContain('date >=')
  })

  it('extending: generates missing future instances up to the new horizon, calling enrolActiveLineagesIntoNewInstance for each new row', async () => {
    // reconcileFutureInstances() reads the real wall clock (`const today =
    // new Date()`, lib/tennisSchedule.ts) with no injectable override, and
    // the schedule below is a hardcoded 3-week window anchored to August
    // 2026 (the same reference month every other test in this file already
    // uses via the module-level TODAY constant). Left alone, this test
    // silently breaks the moment real time passes that window — which is
    // exactly what happened (see git history for this line). Freezing
    // "today" to a fixed instant inside the window makes the assertion
    // deterministic forever, independent of when the suite actually runs.
    // Midday UTC (not local midnight, not August 17th/24th/31st exactly)
    // avoids landing on a date boundary in either this repo's CI (UTC) or
    // a developer machine on a different offset.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T12:00:00Z'))
    try {
      sqlMock.mockImplementation((strings: TemplateStringsArray) => {
        const text = strings.join('')
        if (text.includes('INSERT INTO session_instances')) return Promise.resolve([{ id: 'new-inst-id' }])
        if (text.includes('SELECT COUNT(*)::int AS cnt')) return Promise.resolve([{ cnt: 0 }])
        return Promise.resolve([])
      })
      const result = await reconcileFutureInstances({
        organisationId: 'org-a', sessionId: 'sess-1',
        rules: { day_of_week: 1, start_date: '2026-08-17', end_mode: 'after_weeks', end_after_weeks: 3, end_date: null },
        startTime: '17:00', durationMinutes: 60, maxCapacity: 8, sessionType: 'GROUP_TERM_JUNIOR',
      })
      // Regression guard: proves this assertion is now evaluated under the
      // frozen system time above, not whatever the real wall clock is.
      expect(vi.isFakeTimers()).toBe(true)
      expect(result.generated).toBeGreaterThan(0)
      expect(enrolActiveLineagesMock).toHaveBeenCalled()
    } finally {
      // Always restored, even on assertion failure, so a fake system time
      // never leaks into a later test in this file or another file run in
      // the same worker.
      vi.useRealTimers()
    }
  })

  it('shortening: a future instance outside the new schedule with a protected (paid) booking is left scheduled and reported as a conflict, not cancelled', async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join('')
      if (text.includes('INSERT INTO session_instances')) return Promise.resolve([]) // nothing new needed
      if (text.includes('FROM session_instances') && text.includes('status = \'scheduled\'') && text.includes('date >=')) {
        return Promise.resolve([{ id: 'stale-inst-1', date: '2026-12-01' }]) // outside the shortened window
      }
      if (text.includes('paid = true OR attendance_status')) {
        return Promise.resolve([{ id: 'booking-protected' }]) // has a protected booking
      }
      return Promise.resolve([])
    })
    const result = await reconcileFutureInstances({
      organisationId: 'org-a', sessionId: 'sess-1',
      rules: { day_of_week: 1, start_date: '2026-08-17', end_mode: 'on_date', end_after_weeks: null, end_date: '2026-09-01' },
      startTime: '17:00', durationMinutes: 60, maxCapacity: 8, sessionType: 'GROUP_TERM_JUNIOR',
    })
    expect(result.cancelledInstances).toBe(0)
    expect(result.conflicts).toEqual([{ instanceId: 'stale-inst-1', date: '2026-12-01' }])
    // Never issued a cancelling UPDATE for the protected instance.
    const cancelCalls = sqlMock.mock.calls.filter(c => (c[0] as string[]).join('').includes("status = 'cancelled'"))
    expect(cancelCalls).toHaveLength(0)
  })

  it('shortening: a future instance outside the new schedule with NO protected booking is safely cancelled (not deleted)', async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join('')
      if (text.includes('INSERT INTO session_instances')) return Promise.resolve([])
      if (text.includes('FROM session_instances') && text.includes('status = \'scheduled\'') && text.includes('date >=')) {
        return Promise.resolve([{ id: 'stale-inst-2', date: '2026-12-01' }])
      }
      if (text.includes('paid = true OR attendance_status')) return Promise.resolve([]) // no protected bookings
      return Promise.resolve([])
    })
    const result = await reconcileFutureInstances({
      organisationId: 'org-a', sessionId: 'sess-1',
      rules: { day_of_week: 1, start_date: '2026-08-17', end_mode: 'on_date', end_after_weeks: null, end_date: '2026-09-01' },
      startTime: '17:00', durationMinutes: 60, maxCapacity: 8, sessionType: 'GROUP_TERM_JUNIOR',
    })
    expect(result.cancelledInstances).toBe(1)
    expect(result.conflicts).toEqual([])
    const cancelCalls = sqlMock.mock.calls.filter(c => (c[0] as string[]).join('').includes("session_instances SET status = 'cancelled'"))
    expect(cancelCalls.length).toBeGreaterThan(0)
  })
})

describe('reconcileAllSessionsForOrg — the automatic top-up trigger invoked by POST /api/dashboard/sessions/reconcile', () => {
  beforeEach(() => { sqlMock.mockReset(); enrolActiveLineagesMock.mockReset() })

  it('reconciles every session belonging to the organisation, scoped by the SELECT itself', async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('')
      if (text.includes('FROM sessions WHERE organisation_id')) {
        return Promise.resolve([
          { id: 'sess-1', day_of_week: 1, start_time: '10:00', duration_minutes: 60, max_capacity: 8, session_type: 'GROUP_TERM_JUNIOR', start_date: '2026-08-17', end_mode: 'ongoing', end_after_weeks: null, end_date: null },
          { id: 'sess-2', day_of_week: 5, start_time: '17:00', duration_minutes: 60, max_capacity: 8, session_type: 'CARDIO_SESSION', start_date: '2026-08-21', end_mode: 'ongoing', end_after_weeks: null, end_date: null },
        ])
      }
      if (text.includes('INSERT INTO session_instances')) return Promise.resolve([{ id: `inst-${values[0]}` }])
      if (text.includes('SELECT COUNT(*)::int AS cnt')) return Promise.resolve([{ cnt: 0 }])
      return Promise.resolve([])
    })
    const result = await reconcileAllSessionsForOrg('org-a')
    expect(result.reconciled).toBe(2)
    expect(result.totalGenerated).toBeGreaterThan(0)
    // The SELECT that finds which sessions to reconcile is itself org-scoped.
    const selectCall = sqlMock.mock.calls.find(c => (c[0] as string[]).join('').includes('FROM sessions WHERE organisation_id'))
    expect(selectCall).toContain('org-a')
  })

  it('a single failing session is isolated: it is recorded in errors, and the other session in the same batch still reconciles and is counted — one bad row cannot abort the whole batch', async () => {
    let updateCallCount = 0
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join('')
      if (text.includes('FROM sessions WHERE organisation_id')) {
        return Promise.resolve([
          { id: 'sess-bad', day_of_week: 1, start_time: '10:00', duration_minutes: 60, max_capacity: 8, session_type: 'GROUP_TERM_JUNIOR', start_date: '2026-08-17', end_mode: 'ongoing', end_after_weeks: null, end_date: null },
          { id: 'sess-good', day_of_week: 5, start_time: '17:00', duration_minutes: 60, max_capacity: 8, session_type: 'CARDIO_SESSION', start_date: '2026-08-21', end_mode: 'ongoing', end_after_weeks: null, end_date: null },
        ])
      }
      if (text.includes('SET start_time = ')) {
        updateCallCount++
        if (updateCallCount === 1) throw new Error('simulated DB error for the first session only')
        return Promise.resolve([])
      }
      if (text.includes('INSERT INTO session_instances')) return Promise.resolve([{ id: 'inst-good' }])
      if (text.includes('SELECT COUNT(*)::int AS cnt')) return Promise.resolve([{ cnt: 0 }])
      return Promise.resolve([])
    })
    const result = await reconcileAllSessionsForOrg('org-a')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].sessionId).toBe('sess-bad')
    expect(result.reconciled).toBe(1) // sess-good still succeeded
  })

  it('idempotent: a second reconcile where every expected date already exists (ON CONFLICT DO NOTHING branch) reports zero newly generated, not duplicates or an error', async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join('')
      if (text.includes('FROM sessions WHERE organisation_id')) {
        return Promise.resolve([
          { id: 'sess-1', day_of_week: 1, start_time: '10:00', duration_minutes: 60, max_capacity: 8, session_type: 'GROUP_TERM_JUNIOR', start_date: '2026-08-17', end_mode: 'ongoing', end_after_weeks: null, end_date: null },
        ])
      }
      // Simulates the ON CONFLICT ... DO NOTHING branch: the INSERT executes
      // but RETURNING yields no rows because the row already existed.
      if (text.includes('INSERT INTO session_instances')) return Promise.resolve([])
      return Promise.resolve([])
    })
    const result = await reconcileAllSessionsForOrg('org-a')
    expect(result.totalGenerated).toBe(0)
    expect(result.errors).toEqual([])
    expect(enrolActiveLineagesMock).not.toHaveBeenCalled() // never called for a conflict/no-op insert
  })

  it('every generation query still targets ON CONFLICT (session_id, date) DO NOTHING — the same production unique constraint this relies on', async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join('')
      if (text.includes('FROM sessions WHERE organisation_id')) {
        return Promise.resolve([
          { id: 'sess-1', day_of_week: 1, start_time: '10:00', duration_minutes: 60, max_capacity: 8, session_type: 'GROUP_TERM_JUNIOR', start_date: '2026-08-17', end_mode: 'ongoing', end_after_weeks: null, end_date: null },
        ])
      }
      if (text.includes('INSERT INTO session_instances')) return Promise.resolve([{ id: 'inst-1' }])
      if (text.includes('SELECT COUNT(*)::int AS cnt')) return Promise.resolve([{ cnt: 0 }])
      return Promise.resolve([])
    })
    await reconcileAllSessionsForOrg('org-a')
    const insertCalls = sqlMock.mock.calls.filter(c => (c[0] as string[]).join('').includes('INSERT INTO session_instances'))
    expect(insertCalls.length).toBeGreaterThan(0)
    for (const call of insertCalls) {
      const text = (call[0] as string[]).join('')
      expect(text).toContain('ON CONFLICT (session_id, date)')
      expect(text).toContain('DO NOTHING')
    }
  })
})
