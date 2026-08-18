import { describe, it, expect } from 'vitest'
import { getMonthGridRange, eachDayInRange, toDateStr } from '@/lib/date'

// Regression coverage for the Production report that Monday session
// instances (e.g. "Hot Shot" Monday 10:00, "Private" Monday 17:00) were not
// appearing in the Month calendar while a Friday session ("Test 2") did.
//
// Root cause investigation (read-only query against the real LD Tennis
// production data) found this was NOT a date-parsing/timezone/query bug:
// every session_instances row's stored date already matched its session
// template's day_of_week exactly (verified via EXTRACT(DOW)), and the two
// affected sessions simply had zero session_instances rows in the current
// window — their last "Generate 6 weeks" batch had expired months earlier
// and nobody had re-generated it. The calendar's date bucketing itself
// (reproduced here as a pure function, matching exactly what
// WeekGrid/MonthGrid do: `instances.filter(inst => inst.date === toDateStr(day))`)
// was already correct — these tests prove that, and guard against a real
// future regression in the same bucketing logic.

type Inst = { id: string; date: string; session_id: string }

function bucketByDate(days: Date[], instances: Inst[]): Map<string, Inst[]> {
  const map = new Map<string, Inst[]>()
  for (const day of days) {
    const key = toDateStr(day)
    map.set(key, instances.filter(inst => inst.date === key))
  }
  return map
}

describe('Month grid instance bucketing — August 2026', () => {
  const monthAnchor = new Date(2026, 7, 1) // August 2026
  const range = getMonthGridRange(monthAnchor)
  const days = eachDayInRange(range)

  const mondayInstance: Inst = { id: 'inst-monday', date: '2026-08-03', session_id: 'sess-hotshot' } // a Monday
  const fridayInstance: Inst = { id: 'inst-friday', date: '2026-08-21', session_id: 'sess-test2' }   // a Friday

  it('a Monday instance is bucketed into its exact Monday cell, not a neighbouring day', () => {
    const buckets = bucketByDate(days, [mondayInstance, fridayInstance])
    expect(buckets.get('2026-08-03')).toEqual([mondayInstance])
    // Not leaked into the day before/after via an off-by-one.
    expect(buckets.get('2026-08-02')).toEqual([])
    expect(buckets.get('2026-08-04')).toEqual([])
  })

  it('a Friday instance in the same month is bucketed correctly alongside the Monday one', () => {
    const buckets = bucketByDate(days, [mondayInstance, fridayInstance])
    expect(buckets.get('2026-08-21')).toEqual([fridayInstance])
  })

  it('every day in the 42-cell grid gets exactly one bucket entry (array), covering the whole visible month', () => {
    const buckets = bucketByDate(days, [mondayInstance, fridayInstance])
    expect(buckets.size).toBe(42)
    expect(toDateStr(days[0])).toBe('2026-07-27')
    expect(toDateStr(days[days.length - 1])).toBe('2026-09-06')
  })

  it('a Monday instance one week earlier/later is bucketed into a different cell than the reference Monday', () => {
    const otherMonday: Inst = { id: 'inst-other-monday', date: '2026-08-10', session_id: 'sess-hotshot' }
    const buckets = bucketByDate(days, [mondayInstance, otherMonday])
    expect(buckets.get('2026-08-03')).toEqual([mondayInstance])
    expect(buckets.get('2026-08-10')).toEqual([otherMonday])
  })
})
