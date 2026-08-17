import { describe, it, expect } from 'vitest'
import {
  toDateStr, addDays, addWeeks, addMonths, startOfWeek, endOfWeek,
  getWeekRange, getMonthGridRange, formatWeekHeading, formatMonthHeading, isSameDay,
} from '@/lib/date'

function d(y: number, m: number, day: number): Date {
  return new Date(y, m - 1, day)
}

describe('toDateStr', () => {
  it('formats a local date as YYYY-MM-DD with zero-padding', () => {
    expect(toDateStr(d(2026, 8, 5))).toBe('2026-08-05')
    expect(toDateStr(d(2026, 12, 31))).toBe('2026-12-31')
  })
})

describe('addDays / addWeeks', () => {
  it('adds and subtracts days correctly across a month boundary', () => {
    expect(toDateStr(addDays(d(2026, 8, 30), 3))).toBe('2026-09-02')
    expect(toDateStr(addDays(d(2026, 9, 2), -3))).toBe('2026-08-30')
  })

  it('addWeeks moves by exactly 7 days', () => {
    expect(toDateStr(addWeeks(d(2026, 8, 17), 1))).toBe('2026-08-24')
    expect(toDateStr(addWeeks(d(2026, 8, 17), -1))).toBe('2026-08-10')
  })
})

describe('addMonths', () => {
  it('moves forward and backward across year boundaries', () => {
    expect(toDateStr(addMonths(d(2026, 12, 15), 1))).toBe('2027-01-15')
    expect(toDateStr(addMonths(d(2027, 1, 15), -1))).toBe('2026-12-15')
  })

  it('clamps to the last valid day of the target month instead of rolling over', () => {
    // 31 Jan + 1 month -> should land on 28 Feb 2026 (non-leap year), not 3 Mar.
    expect(toDateStr(addMonths(d(2026, 1, 31), 1))).toBe('2026-02-28')
  })

  it('handles a leap-year February correctly', () => {
    // 2028 is a leap year.
    expect(toDateStr(addMonths(d(2028, 1, 31), 1))).toBe('2028-02-29')
    expect(toDateStr(addMonths(d(2027, 1, 31), 1))).toBe('2027-02-28') // 2027 is not a leap year
  })
})

describe('startOfWeek / endOfWeek — Monday-start week', () => {
  it('a Monday maps to itself', () => {
    const monday = d(2026, 8, 17) // confirmed Monday
    expect(toDateStr(startOfWeek(monday))).toBe('2026-08-17')
    expect(toDateStr(endOfWeek(monday))).toBe('2026-08-23')
  })

  it('a Sunday maps back to the Monday that started its week (not the next week)', () => {
    const sunday = d(2026, 8, 23)
    expect(toDateStr(startOfWeek(sunday))).toBe('2026-08-17')
    expect(toDateStr(endOfWeek(sunday))).toBe('2026-08-23')
  })

  it('a mid-week Wednesday maps to the correct Monday/Sunday', () => {
    const wed = d(2026, 8, 19)
    expect(toDateStr(startOfWeek(wed))).toBe('2026-08-17')
    expect(toDateStr(endOfWeek(wed))).toBe('2026-08-23')
  })
})

describe('getWeekRange', () => {
  it('a week fully inside one month', () => {
    const range = getWeekRange(d(2026, 8, 19))
    expect(toDateStr(range.start)).toBe('2026-08-17')
    expect(toDateStr(range.end)).toBe('2026-08-23')
  })

  it('a week that crosses a month boundary', () => {
    const range = getWeekRange(d(2026, 8, 31)) // Monday 31 Aug
    expect(toDateStr(range.start)).toBe('2026-08-31')
    expect(toDateStr(range.end)).toBe('2026-09-06')
  })

  it('a week that crosses a year boundary', () => {
    const range = getWeekRange(d(2026, 12, 30)) // Wednesday 30 Dec 2026
    expect(toDateStr(range.start)).toBe('2026-12-28')
    expect(toDateStr(range.end)).toBe('2027-01-03')
  })
})

describe('getMonthGridRange', () => {
  it('August 2026 (1 Aug is a Saturday, 31 Aug is a Monday) includes leading/trailing grid days', () => {
    const range = getMonthGridRange(d(2026, 8, 15))
    // 1 Aug 2026 is a Saturday -> grid starts Monday 27 Jul 2026.
    expect(toDateStr(range.start)).toBe('2026-07-27')
    // 31 Aug 2026 is a Monday -> grid ends Sunday 6 Sep 2026.
    expect(toDateStr(range.end)).toBe('2026-09-06')
  })

  it('February in a leap year (2028)', () => {
    const range = getMonthGridRange(d(2028, 2, 10))
    // 1 Feb 2028 is a Tuesday -> grid starts Monday 31 Jan 2028.
    expect(toDateStr(range.start)).toBe('2028-01-31')
    // 29 Feb 2028 (leap day) is a Tuesday -> grid ends Sunday 5 Mar 2028.
    expect(toDateStr(range.end)).toBe('2028-03-05')
  })

  it('December -> January year boundary', () => {
    const range = getMonthGridRange(d(2026, 12, 10))
    expect(range.start.getFullYear()).toBe(2026)
    expect(range.end.getFullYear()).toBe(2027)
  })
})

describe('formatWeekHeading', () => {
  it('a week fully inside one month', () => {
    expect(formatWeekHeading(getWeekRange(d(2026, 8, 19)))).toBe('17–23 August 2026')
  })

  it('a week crossing a month boundary within the same year', () => {
    expect(formatWeekHeading(getWeekRange(d(2026, 8, 31)))).toBe('31 Aug – 6 Sep 2026')
  })

  it('a week crossing a year boundary shows both years to avoid ambiguity', () => {
    expect(formatWeekHeading(getWeekRange(d(2026, 12, 30)))).toBe('28 Dec 2026 – 3 Jan 2027')
  })
})

describe('formatMonthHeading', () => {
  it('formats month and year', () => {
    expect(formatMonthHeading(d(2026, 8, 1))).toBe('August 2026')
    expect(formatMonthHeading(d(2027, 1, 15))).toBe('January 2027')
  })
})

describe('isSameDay', () => {
  it('true for the same calendar day regardless of time-of-day differences in construction', () => {
    expect(isSameDay(d(2026, 8, 17), new Date(2026, 7, 17, 23, 59))).toBe(true)
  })
  it('false for different days', () => {
    expect(isSameDay(d(2026, 8, 17), d(2026, 8, 18))).toBe(false)
  })
})

describe('navigation composition (Previous / Today / Next semantics)', () => {
  it('Previous then Next on a week returns to the original week', () => {
    const start = d(2026, 8, 19)
    const prev = addWeeks(start, -1)
    const back = addWeeks(prev, 1)
    expect(toDateStr(startOfWeek(back))).toBe(toDateStr(startOfWeek(start)))
  })

  it('Previous then Next on a month returns to the original month', () => {
    const start = d(2026, 8, 15)
    const prev = addMonths(start, -1)
    const back = addMonths(prev, 1)
    expect(back.getFullYear()).toBe(start.getFullYear())
    expect(back.getMonth()).toBe(start.getMonth())
  })
})
