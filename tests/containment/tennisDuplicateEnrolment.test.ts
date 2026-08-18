import { describe, it, expect, vi, beforeEach } from 'vitest'

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}))

const { normalizeEmail, findDuplicateEnrolment } = await import('@/lib/tennisRecurrence')

describe('normalizeEmail', () => {
  it('lowercases and trims (case-insensitivity + whitespace)', () => {
    expect(normalizeEmail('Jimmy@Example.com')).toBe('jimmy@example.com')
    expect(normalizeEmail('  jimmy@example.com  ')).toBe('jimmy@example.com')
    expect(normalizeEmail('JIMMY@EXAMPLE.COM')).toBe('jimmy@example.com')
  })
  it('returns null for empty/whitespace-only/missing email — no fuzzy fallback', () => {
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
  })
})

const ORG = 'org-a'
const SESSION = 'sess-1'
const INSTANCE = 'inst-1'
const EMAIL = 'jimmy@example.com'

describe('findDuplicateEnrolment', () => {
  beforeEach(() => sqlMock.mockReset())

  it('A: same email already Weekly in this class -> denies a new Weekly attempt', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'b1', is_recurring: true, session_instance_id: 'other-inst', recurring_group_id: 'group-a' }])
    const result = await findDuplicateEnrolment({ organisationId: ORG, sessionId: SESSION, instanceId: INSTANCE, emailNorm: EMAIL, wantWeekly: true })
    expect(result).toEqual({ type: 'weekly_exists', message: 'This player is already enrolled weekly in this session.' })
  })

  it('B: same email already Weekly in this class -> also denies a new Once attempt on a different date', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'b1', is_recurring: true, session_instance_id: 'other-inst', recurring_group_id: 'group-a' }])
    const result = await findDuplicateEnrolment({ organisationId: ORG, sessionId: SESSION, instanceId: INSTANCE, emailNorm: EMAIL, wantWeekly: false })
    expect(result.type).toBe('weekly_exists')
  })

  it('C: same email already Once on this exact instance -> denies a duplicate Once for the same date', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'b1', is_recurring: false, session_instance_id: INSTANCE, recurring_group_id: null }])
    const result = await findDuplicateEnrolment({ organisationId: ORG, sessionId: SESSION, instanceId: INSTANCE, emailNorm: EMAIL, wantWeekly: false })
    expect(result).toEqual({ type: 'once_same_date', message: 'This player is already enrolled for this session date.' })
  })

  it('D: same email has a Once on a different date -> allows a new Once on this (different) date', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'b1', is_recurring: false, session_instance_id: 'other-inst', recurring_group_id: null }])
    const result = await findDuplicateEnrolment({ organisationId: ORG, sessionId: SESSION, instanceId: INSTANCE, emailNorm: EMAIL, wantWeekly: false })
    expect(result).toEqual({ type: 'none' })
  })

  it('E: same email has an existing Once on THIS instance and Luke chooses Weekly -> reports upgradeable (convert in place), not a new lineage', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'b1', is_recurring: false, session_instance_id: INSTANCE, recurring_group_id: null }])
    const result = await findDuplicateEnrolment({ organisationId: ORG, sessionId: SESSION, instanceId: INSTANCE, emailNorm: EMAIL, wantWeekly: true })
    expect(result).toEqual({ type: 'once_upgradeable', existingBookingId: 'b1', existingRecurringGroupId: null })
  })

  it('F: same email has a Once on a DIFFERENT date and Luke chooses Weekly -> blocked with a directing message, not silently guessed', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'b1', is_recurring: false, session_instance_id: 'other-inst', recurring_group_id: null }])
    const result = await findDuplicateEnrolment({ organisationId: ORG, sessionId: SESSION, instanceId: INSTANCE, emailNorm: EMAIL, wantWeekly: true })
    expect(result.type).toBe('once_exists_elsewhere')
  })

  it('no existing bookings -> allows Once or Weekly freely', async () => {
    sqlMock.mockResolvedValueOnce([])
    const once = await findDuplicateEnrolment({ organisationId: ORG, sessionId: SESSION, instanceId: INSTANCE, emailNorm: EMAIL, wantWeekly: false })
    expect(once).toEqual({ type: 'none' })
    sqlMock.mockResolvedValueOnce([])
    const weekly = await findDuplicateEnrolment({ organisationId: ORG, sessionId: SESSION, instanceId: INSTANCE, emailNorm: EMAIL, wantWeekly: true })
    expect(weekly).toEqual({ type: 'none' })
  })

  it('cancelled historical bookings do not block a new legitimate enrolment (excluded by the query itself)', async () => {
    // The query's WHERE status != 'cancelled' means a cancelled row for this
    // email/session/instance is never returned here at all.
    sqlMock.mockResolvedValueOnce([])
    const result = await findDuplicateEnrolment({ organisationId: ORG, sessionId: SESSION, instanceId: INSTANCE, emailNorm: EMAIL, wantWeekly: false })
    expect(result).toEqual({ type: 'none' })
    const queryArgs = sqlMock.mock.calls[0]
    const queryText = (queryArgs[0] as string[]).join('')
    expect(queryText).toContain("status != 'cancelled'")
  })

  it('the query is scoped to organisation_id and session_id, never leaking across tenants or classes', async () => {
    sqlMock.mockResolvedValueOnce([])
    await findDuplicateEnrolment({ organisationId: ORG, sessionId: SESSION, instanceId: INSTANCE, emailNorm: EMAIL, wantWeekly: false })
    const queryArgs = sqlMock.mock.calls[0]
    expect(queryArgs).toContain(ORG)
    expect(queryArgs).toContain(SESSION)
  })
})
