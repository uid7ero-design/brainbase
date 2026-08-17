import { describe, it, expect, vi, beforeEach } from 'vitest'

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}))

const { propagateRecurringEnrolment, enrolActiveLineagesIntoNewInstance, isDateWithinAnyPause } =
  await import('@/lib/tennisRecurrence')

const ORG = 'org-a'
const SESSION = 'sess-1'
const GROUP = 'group-1'

function futureInstanceRow(date: string, enrolled = 0, maxCapacity = 8) {
  return { id: `inst-${date}`, date, start_time: '18:00', max_capacity: maxCapacity, session_type: 'Group', enrolled }
}

describe('isDateWithinAnyPause', () => {
  it('true when the date falls inside a window (inclusive both ends)', () => {
    const pauses = [{ pause_from: '2026-09-28', pause_until: '2026-10-11' }]
    expect(isDateWithinAnyPause('2026-09-28', pauses)).toBe(true)
    expect(isDateWithinAnyPause('2026-10-11', pauses)).toBe(true)
    expect(isDateWithinAnyPause('2026-10-04', pauses)).toBe(true)
  })
  it('false outside the window', () => {
    const pauses = [{ pause_from: '2026-09-28', pause_until: '2026-10-11' }]
    expect(isDateWithinAnyPause('2026-09-27', pauses)).toBe(false)
    expect(isDateWithinAnyPause('2026-10-12', pauses)).toBe(false)
  })
})

describe('propagateRecurringEnrolment', () => {
  beforeEach(() => sqlMock.mockReset())

  it('propagates into every eligible future instance and reports the summary', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // loadPauseWindows: no pauses
      .mockResolvedValueOnce([futureInstanceRow('2026-08-25'), futureInstanceRow('2026-09-01')]) // future instances
      // instance 1: no existing booking, insert succeeds
      .mockResolvedValueOnce([]) // existence check
      .mockResolvedValueOnce([{ id: 'b1' }]) // insert RETURNING
      // instance 2: no existing booking, insert succeeds
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'b2' }])

    const summary = await propagateRecurringEnrolment({
      organisationId: ORG, sessionId: SESSION, recurringGroupId: GROUP,
      clientName: 'Test Player', clientEmail: null, afterDate: '2026-08-18',
    })

    expect(summary.propagated).toBe(2)
    expect(summary.alreadyPresent).toBe(0)
    expect(summary.capacityBlocked).toBe(0)
    expect(summary.errors).toBe(0)
  })

  it('never touches instances on or before afterDate (past protection is the SQL WHERE clause itself)', async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]) // no pauses, no future instances returned by the query
    const summary = await propagateRecurringEnrolment({
      organisationId: ORG, sessionId: SESSION, recurringGroupId: GROUP,
      clientName: 'Test Player', clientEmail: null, afterDate: '2026-08-18',
    })
    expect(summary.propagated).toBe(0)
    // Confirm the instances query itself filters strictly after afterDate.
    const instancesCallArgs = sqlMock.mock.calls[1]
    expect(instancesCallArgs).toContain('2026-08-18')
  })

  it('skips a date inside a pause window without inserting', async () => {
    sqlMock
      .mockResolvedValueOnce([{ pause_from: '2026-08-24', pause_until: '2026-08-31' }])
      .mockResolvedValueOnce([futureInstanceRow('2026-08-25')])

    const summary = await propagateRecurringEnrolment({
      organisationId: ORG, sessionId: SESSION, recurringGroupId: GROUP,
      clientName: 'Test Player', clientEmail: null, afterDate: '2026-08-18',
    })
    expect(summary.paused).toBe(1)
    expect(summary.propagated).toBe(0)
    // Only the pause + instances queries ran — no existence check, no insert.
    expect(sqlMock).toHaveBeenCalledTimes(2)
  })

  it('skips (without inserting) and reports a capacity-full future instance', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([futureInstanceRow('2026-08-25', 8, 8)]) // full
      .mockResolvedValueOnce([]) // existence check: not already present

    const summary = await propagateRecurringEnrolment({
      organisationId: ORG, sessionId: SESSION, recurringGroupId: GROUP,
      clientName: 'Test Player', clientEmail: null, afterDate: '2026-08-18',
    })
    expect(summary.capacityBlocked).toBe(1)
    expect(summary.skippedDates).toEqual(['2026-08-25'])
    expect(summary.propagated).toBe(0)
  })

  it('does not overbook: does not insert once capacity-blocked, even though it does not throw', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([futureInstanceRow('2026-08-25', 8, 8)])
      .mockResolvedValueOnce([])

    await propagateRecurringEnrolment({
      organisationId: ORG, sessionId: SESSION, recurringGroupId: GROUP,
      clientName: 'Test Player', clientEmail: null, afterDate: '2026-08-18',
    })
    // Only pause + instances + existence-check calls — never reaches an INSERT.
    expect(sqlMock).toHaveBeenCalledTimes(3)
  })

  it('treats an existing booking for the same lineage in that instance as already-present, not a new propagation', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([futureInstanceRow('2026-08-25')])
      .mockResolvedValueOnce([{ '1': 1 }]) // existence check finds a row

    const summary = await propagateRecurringEnrolment({
      organisationId: ORG, sessionId: SESSION, recurringGroupId: GROUP,
      clientName: 'Test Player', clientEmail: null, afterDate: '2026-08-18',
    })
    expect(summary.alreadyPresent).toBe(1)
    expect(summary.propagated).toBe(0)
  })

  it('a lost ON CONFLICT race (concurrent duplicate request) counts as already-present, not an error', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([futureInstanceRow('2026-08-25')])
      .mockResolvedValueOnce([]) // existence check: not present yet
      .mockResolvedValueOnce([]) // INSERT ... ON CONFLICT DO NOTHING returns zero rows — lost the race

    const summary = await propagateRecurringEnrolment({
      organisationId: ORG, sessionId: SESSION, recurringGroupId: GROUP,
      clientName: 'Test Player', clientEmail: null, afterDate: '2026-08-18',
    })
    expect(summary.alreadyPresent).toBe(1)
    expect(summary.errors).toBe(0)
  })

  it('the propagated booking resets paid/attendance for the new date (does not copy from another week)', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([futureInstanceRow('2026-08-25')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'b1' }])

    await propagateRecurringEnrolment({
      organisationId: ORG, sessionId: SESSION, recurringGroupId: GROUP,
      clientName: 'Test Player', clientEmail: null, afterDate: '2026-08-18',
    })
    // paid/attendance are never interpolated as parameters for a propagated
    // booking — they're hardcoded literals in the INSERT text itself
    // ('confirmed', false, true — paid=false, is_recurring=true), so there
    // is no value carried over from any other week's booking.
    const insertSql = (sqlMock.mock.calls[3][0] as string[]).join('')
    expect(insertSql).toContain("'confirmed', false, true")
  })
})

describe('enrolActiveLineagesIntoNewInstance', () => {
  beforeEach(() => sqlMock.mockReset())

  it('enrols every currently-active lineage into a single newly-generated instance', async () => {
    sqlMock
      .mockResolvedValueOnce([{ recurring_group_id: 'g1', client_name: 'A', client_email: null }, { recurring_group_id: 'g2', client_name: 'B', client_email: null }]) // getActiveRecurringLineages
      .mockResolvedValueOnce([]) // pauses for g1
      .mockResolvedValueOnce([]) // existence check g1
      .mockResolvedValueOnce([{ id: 'b1' }]) // insert g1
      .mockResolvedValueOnce([]) // pauses for g2
      .mockResolvedValueOnce([]) // existence check g2
      .mockResolvedValueOnce([{ id: 'b2' }]) // insert g2

    const summary = await enrolActiveLineagesIntoNewInstance({
      organisationId: ORG, sessionId: SESSION,
      instance: futureInstanceRow('2026-09-08'),
    })
    expect(summary.propagated).toBe(2)
  })

  it('stops enrolling once capacity is reached mid-loop — does not overbook', async () => {
    sqlMock
      .mockResolvedValueOnce([{ recurring_group_id: 'g1', client_name: 'A', client_email: null }, { recurring_group_id: 'g2', client_name: 'B', client_email: null }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'b1' }]) // g1 enrols, capacity now 1/1
      .mockResolvedValueOnce([]) // pauses for g2
      .mockResolvedValueOnce([]) // existence check for g2 (not present) — then capacity_blocked

    const summary = await enrolActiveLineagesIntoNewInstance({
      organisationId: ORG, sessionId: SESSION,
      instance: futureInstanceRow('2026-09-08', 0, 1), // capacity 1
    })
    expect(summary.propagated).toBe(1)
    expect(summary.capacityBlocked).toBe(1)
  })
})
