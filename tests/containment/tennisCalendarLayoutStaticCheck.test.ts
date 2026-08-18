import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness. See
// tennisInitialFrequencyStaticChecks.test.ts for the same caveat spelled
// out in full.

const SOURCE_PATH = path.resolve(__dirname, '../../app/dashboard/sessions/page.tsx')
const source = fs.readFileSync(SOURCE_PATH, 'utf-8')

describe('app/dashboard/sessions/page.tsx — static source checks (single-calendar layout)', () => {
  it('the legacy duplicate "Weekly Schedule" 7-day template grid is no longer rendered', () => {
    // The section heading and its DAYS_ORDER-based 7-column template grid
    // are gone; a code comment may still reference the old name for context.
    expect(source).not.toMatch(/>Weekly Schedule</)
    expect(source).not.toMatch(/DAYS_ORDER\.map\(day =>/)
    expect(source).not.toMatch(/function SessionCard\(/)
  })

  it('the calendar is the only date-browsing surface left — Week/Month grids still present', () => {
    expect(source).toContain('function WeekGrid(')
    expect(source).toContain('function MonthGrid(')
  })

  it('session management (Generate 6 weeks / Edit / Delete) is still reachable via the compact SessionChip strip, not deleted along with the old grid', () => {
    expect(source).toContain('function SessionChip(')
    expect(source).toContain('onClick={() => selectSession(s.id)}')
  })

  it('"Generate 6 weeks" and "+ New Session" are preserved', () => {
    expect(source).toContain("'↻ Generate 6 weeks'")
    expect(source).toContain('onClick={generateInstances}')
    expect(source).toContain('+ New Session')
    expect(source).toContain('onClick={() => setShowCreate(true)}')
  })

  it('calendar navigation controls (Prev/Today/Next, Week|Month) appear exactly once — not duplicated across two surfaces', () => {
    const prevCount = (source.match(/calendarPrev/g) ?? []).length
    const nextCount = (source.match(/calendarNext/g) ?? []).length
    const todayCount = (source.match(/calendarToday/g) ?? []).length
    // Each appears in its function definition + exactly one JSX onClick wire-up.
    expect(prevCount).toBe(2)
    expect(nextCount).toBe(2)
    expect(todayCount).toBe(2)
  })

  it('the selected calendar instance is visually distinguished using the existing purple/indigo selected convention', () => {
    expect(source).toContain('selected={inst.id === selectedInstanceId}')
    expect(source).toContain('selectedInstanceId={selectedInstanceId}')
    expect(source).toMatch(/selected \? '#c7d2fe' : /)
  })

  it('the calendar grid is wrapped for horizontal scroll on narrow viewports instead of crushing columns', () => {
    expect(source).toMatch(/overflowX: 'auto'/)
    expect(source).toContain('minWidth: 700')
  })

  it('the page uses a wider desktop content width than the old narrow layout', () => {
    expect(source).toContain('maxWidth: 1400')
    expect(source).not.toContain('maxWidth: 960')
  })

  it('Week/Month toggle and calendar range bounding (date_from/date_to) remain intact', () => {
    expect(source).toContain("useState<'week' | 'month'>('week')")
    expect(source).toContain('${API}/instances?date_from=${toDateStr(range.start)}&date_to=${toDateStr(range.end)}')
  })
})
