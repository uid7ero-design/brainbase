import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness. See
// tennisInitialFrequencyStaticChecks.test.ts for the same caveat spelled
// out in full.

const SOURCE_PATH = path.resolve(__dirname, '../../app/dashboard/sessions/page.tsx')
const source = fs.readFileSync(SOURCE_PATH, 'utf-8')

describe('app/dashboard/sessions/page.tsx — static source checks (Week/Month calendar)', () => {
  it('the calendar fetch is bounded by date_from/date_to, never an unbounded fetch of all history', () => {
    expect(source).toContain('${API}/instances?date_from=${toDateStr(range.start)}&date_to=${toDateStr(range.end)}')
  })

  it('Week view uses getWeekRange and Month view uses getMonthGridRange — the same helpers the range-query bounds off', () => {
    expect(source).toContain('getWeekRange(anchor)')
    expect(source).toContain('getMonthGridRange(anchor)')
    expect(source).toContain('<WeekGrid range={getWeekRange(calendarAnchor)}')
    expect(source).toContain('<MonthGrid range={getMonthGridRange(calendarAnchor)}')
  })

  it('navigation (Prev/Today/Next) only moves the anchor date — it never calls generate-instances or any mutating endpoint', () => {
    expect(source).toContain("function calendarPrev() { setCalendarLoading(true); setCalendarAnchor(a => calendarView === 'week' ? addWeeks(a, -1) : addMonths(a, -1)) }")
    expect(source).toContain("function calendarNext() { setCalendarLoading(true); setCalendarAnchor(a => calendarView === 'week' ? addWeeks(a, 1) : addMonths(a, 1)) }")
    expect(source).toContain('function calendarToday() { setCalendarLoading(true); setCalendarAnchor(new Date()) }')
    // The nav handlers themselves must contain no fetch/POST calls of their own —
    // they only flip state; the bounded GET is triggered by the reactive effect.
    const prevFnMatch = source.match(/function calendarPrev\(\) \{[^}]*\}/)
    expect(prevFnMatch).not.toBeNull()
    expect(prevFnMatch![0]).not.toMatch(/generate-instances|POST/)
  })

  it('clicking a calendar entry reuses the existing selectInstance function rather than a new parallel selection path', () => {
    expect(source).toContain('onSelectInstance={selectInstance}')
  })

  it('the manual instance-repair action (formerly "Generate 6 weeks", now "Repair future dates" per the automatic scheduling feature) is separate from calendar navigation', () => {
    expect(source).toContain('Repair future dates')
    expect(source).toContain('onClick={generateInstances}')
  })

  it('the calendar view defaults to week', () => {
    expect(source).toContain("useState<'week' | 'month'>('week')")
  })

  it('mutations (enrol, toggle, remove, pause, generate, create/save/delete session) refresh the calendar via loadCalendar, not a removed weekInstances state', () => {
    expect(source).not.toContain('weekInstances')
    expect(source).not.toContain('setWeekInstances')
    expect(source).not.toContain('weekLoading')
    expect(source).toContain('loadCalendar(calendarAnchor, calendarView)')
  })

  it('the old flat WeekView/InstancesPanel components were removed, not left as dead code alongside the new grid', () => {
    expect(source).not.toMatch(/function WeekView\(/)
    expect(source).not.toMatch(/function InstancesPanel\(/)
  })
})
