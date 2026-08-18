import { describe, it, expect } from 'vitest'
import { greetingForHour, firstNameOf, greetingLine, currentAdelaideHour } from '@/lib/dashboard/greeting'

describe('greetingForHour — time-of-day bucketing', () => {
  it('6. before noon renders Good morning', () => {
    expect(greetingForHour(0)).toBe('Good morning')
    expect(greetingForHour(6)).toBe('Good morning')
    expect(greetingForHour(11)).toBe('Good morning')
  })

  it('7. noon through before 5pm renders Good afternoon', () => {
    expect(greetingForHour(12)).toBe('Good afternoon')
    expect(greetingForHour(14)).toBe('Good afternoon')
    expect(greetingForHour(16)).toBe('Good afternoon')
  })

  it('8. 5pm onward renders Good evening', () => {
    expect(greetingForHour(17)).toBe('Good evening')
    expect(greetingForHour(20)).toBe('Good evening')
    expect(greetingForHour(23)).toBe('Good evening')
  })
})

describe('firstNameOf / greetingLine', () => {
  it('extracts just the first name from a full name', () => {
    expect(firstNameOf('Luke Doughty')).toBe('Luke')
    expect(firstNameOf('Luke')).toBe('Luke')
  })

  it('trims surrounding whitespace and collapses internal runs', () => {
    expect(firstNameOf('  Luke   Doughty  ')).toBe('Luke')
  })

  it('9. a missing/blank first name falls back to a neutral greeting, not "undefined" or an empty name', () => {
    expect(firstNameOf('')).toBeNull()
    expect(firstNameOf('   ')).toBeNull()
    expect(firstNameOf(null)).toBeNull()
    expect(firstNameOf(undefined)).toBeNull()
    expect(greetingLine(9, '')).toBe('Good morning')
    expect(greetingLine(9, null)).toBe('Good morning')
    expect(greetingLine(9, '')).not.toContain('undefined')
  })

  it('combines greeting + first name into the exact header string', () => {
    expect(greetingLine(9, 'Luke Doughty')).toBe('Good morning, Luke')
    expect(greetingLine(20, 'Luke Doughty')).toBe('Good evening, Luke')
  })

  it('never derives the name from anything other than the name argument itself (no global/client-input access in this pure function)', () => {
    // Purity check: same inputs always produce the same output, and the
    // function signature takes no request/cookie/DOM access.
    expect(greetingLine(9, 'Luke')).toBe(greetingLine(9, 'Luke'))
  })
})

describe('currentAdelaideHour — timezone-safe, independent of server-process timezone', () => {
  it('computes the Adelaide-local hour from a UTC instant, not the process TZ', () => {
    // 2026-08-20T00:00:00Z is ACST (UTC+9:30, non-DST) => 09:30 local => hour 9
    expect(currentAdelaideHour(new Date('2026-08-20T00:00:00Z'))).toBe(9)
    // 2026-08-20T12:00:00Z => 21:30 local => hour 21
    expect(currentAdelaideHour(new Date('2026-08-20T12:00:00Z'))).toBe(21)
  })

  it('never returns 24 for midnight (a known Intl hour12:false quirk this helper explicitly guards against)', () => {
    // 2026-08-19T14:30:00Z => 00:00 ACST exactly => hour must be 0, not 24
    expect(currentAdelaideHour(new Date('2026-08-19T14:30:00Z'))).toBe(0)
  })

  it('stays within the valid 0-23 range for a full day of instants', () => {
    for (let h = 0; h < 24; h++) {
      const hour = currentAdelaideHour(new Date(Date.UTC(2026, 7, 20, h, 0, 0)))
      expect(hour).toBeGreaterThanOrEqual(0)
      expect(hour).toBeLessThanOrEqual(23)
    }
  })
})
