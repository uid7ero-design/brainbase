import { describe, it, expect } from 'vitest'
import {
  REQUIREMENT_CATEGORIES, SUBMISSION_STATUSES, addDays, assignmentState, isIsoDate, organisationHeadline, todayIn,
} from '@/lib/assurance/contractorAssuranceRules'

// BrainBase Assurance — contractor assurance status rules (A0.1G). Pure and
// deterministic: the documented rule, not a risk or compliance score.

const today = '2026-10-03'
const s = (hasAccepted: boolean, acceptedExpiresOn: string | null, renewalNoticeDays: number | null) =>
  assignmentState({ hasAccepted, acceptedExpiresOn, renewalNoticeDays, today })

describe('vocabulary mirrors the A0.1G CHECK constraints', () => {
  it('categories and submission statuses', () => {
    expect(REQUIREMENT_CATEGORIES).toEqual(['INSURANCE', 'LICENCE', 'REGISTRATION', 'CERTIFICATION', 'ACCREDITATION', 'COMPETENCY', 'POLICY_DOCUMENT', 'OTHER'])
    expect(SUBMISSION_STATUSES).toEqual(['SUBMITTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED'])
  })
})

describe('calendar dates', () => {
  it('validates real YYYY-MM-DD dates and adds days without time-zone drift', () => {
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-2-3')).toBe(false)
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-03-31', -31)).toBe('2026-02-28')
  })
  it('today is the calendar date in the Assurance time zone', () => {
    // 2026-10-02 15:00 UTC is already 3 Oct in Adelaide (UTC+9:30).
    expect(todayIn('Australia/Adelaide', new Date('2026-10-02T15:00:00Z'))).toBe('2026-10-03')
    expect(todayIn('UTC', new Date('2026-10-02T15:00:00Z'))).toBe('2026-10-02')
  })
})

describe('assignment state', () => {
  it('MISSING without accepted evidence', () => expect(s(false, null, 30)).toBe('MISSING'))
  it('CURRENT when accepted with no expiry date', () => expect(s(true, null, 30)).toBe('CURRENT'))
  it('EXPIRED strictly before today; expiring today is not yet expired', () => {
    expect(s(true, '2026-10-02', null)).toBe('EXPIRED')
    expect(s(true, '2026-10-03', null)).toBe('CURRENT')
    expect(s(true, '2026-10-03', 1)).toBe('EXPIRING_SOON')
  })
  it('EXPIRING_SOON only inside a configured renewal notice window (inclusive)', () => {
    expect(s(true, '2026-11-02', 30)).toBe('EXPIRING_SOON')
    expect(s(true, '2026-11-03', 30)).toBe('CURRENT')
    expect(s(true, '2026-10-10', null)).toBe('CURRENT')   // no window configured → no expiring-soon state
  })
})

describe('organisation headline precedence', () => {
  it('EXPIRED > MISSING > AWAITING_REVIEW > EXPIRING_SOON > CURRENT; no assignments → NO_REQUIREMENTS', () => {
    expect(organisationHeadline([], 0)).toBe('NO_REQUIREMENTS')
    expect(organisationHeadline([], 3)).toBe('NO_REQUIREMENTS')
    expect(organisationHeadline(['CURRENT', 'EXPIRED', 'MISSING'], 1)).toBe('EXPIRED')
    expect(organisationHeadline(['CURRENT', 'MISSING', 'EXPIRING_SOON'], 1)).toBe('MISSING')
    expect(organisationHeadline(['CURRENT', 'EXPIRING_SOON'], 1)).toBe('AWAITING_REVIEW')
    expect(organisationHeadline(['CURRENT', 'EXPIRING_SOON'], 0)).toBe('EXPIRING_SOON')
    expect(organisationHeadline(['CURRENT', 'CURRENT'], 0)).toBe('CURRENT')
  })
})
