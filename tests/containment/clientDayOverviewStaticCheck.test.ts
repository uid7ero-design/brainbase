import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness (same caveat
// spelled out across every other *StaticCheck.test.ts file in this suite).

const pageSource = fs.readFileSync(path.resolve(__dirname, '../../app/dashboard/page.tsx'), 'utf-8')
const dashSource = fs.readFileSync(path.resolve(__dirname, '../../components/dashboard/TennisDashboard.tsx'), 'utf-8')
const scheduleSource = fs.readFileSync(path.resolve(__dirname, '../../components/dashboard/TodaysSchedule.tsx'), 'utf-8')
const weatherSource = fs.readFileSync(path.resolve(__dirname, '../../components/dashboard/WeatherPanel.tsx'), 'utf-8')

describe('app/dashboard/page.tsx — dashboard resolution', () => {
  it('resolves the dashboard variant via the shared slug-based resolver, not an inline env-var equality check', () => {
    expect(pageSource).toContain("import { resolveDashboardVariant } from '@/lib/dashboard/clientDashboard'")
    expect(pageSource).toContain('resolveDashboardVariant(session.organisationId)')
    expect(pageSource).not.toContain('LD_TENNIS_ORG_ID')
    expect(pageSource).not.toContain('session.organisationId === ')
  })

  it('re-validates the session against the DB (getAuthSession) rather than trusting the JWT alone for a data-bearing page', () => {
    expect(pageSource).toContain("import { getAuthSession } from '@/lib/authSession'")
  })

  it('the BrainBase fallback is preserved for any organisation the resolver does not recognise', () => {
    const lastReturn = pageSource.slice(pageSource.lastIndexOf('return <BrainBase'))
    expect(lastReturn).toContain('return <BrainBase />')
  })

  it('no user ID (Luke, or any hardcoded id) appears anywhere in the routing logic', () => {
    expect(pageSource).not.toMatch(/luke/i)
    expect(pageSource).not.toMatch(/userId\s*===\s*['"]/)
  })
})

describe("app/dashboard/page.tsx — Today's Sessions query", () => {
  it('10/11. counts only today\'s Adelaide-calendar-day instances — an explicit date equality, not a range that could include other days', () => {
    expect(pageSource).toContain("si.date = (NOW() AT TIME ZONE 'Australia/Adelaide')::date")
  })

  it('12. only scheduled (non-cancelled) instances are counted, matching the Sessions calendar\'s own semantics', () => {
    expect(pageSource).toContain("si.status = 'scheduled'")
  })

  it('13. instances are returned in chronological order', () => {
    expect(pageSource).toContain('ORDER BY si.start_time ASC')
  })

  it('the query is organisation-scoped', () => {
    expect(pageSource).toContain('s.organisation_id = ${oid}')
  })

  it('todaysSessions KPI count is derived from the same query result, not a second independent count that could disagree', () => {
    expect(pageSource).toContain('todaysSessions: todaysInstances.length')
  })
})

describe('components/dashboard/TodaysSchedule.tsx — reuses the shared session display resolver', () => {
  it("14. colour resolution goes through the single shared resolver (session override → type → fallback), never re-derived", () => {
    expect(scheduleSource).toContain("import { sessionLabel, optionalLabel, sessionColourDot, type SessionTypeRow } from '@/lib/sessionDisplay'")
    expect(scheduleSource).toContain('sessionColourDot(inst.session_type, sessionTypes, inst.session_colour_key)')
  })

  it('15. optional label suppression reuses optionalLabel() rather than reimplementing the redundancy check', () => {
    expect(scheduleSource).toContain('optionalLabel(inst.session_name, inst.session_type, sessionTypes)')
  })

  it('Session Type (not the raw stored name) is the primary title, matching the rest of the app', () => {
    expect(scheduleSource).toContain('sessionLabel(inst.session_type, sessionTypes)')
  })

  it('24. the empty state is a clean, specific message — never a blank card or "undefined"', () => {
    expect(scheduleSource).toContain('No sessions scheduled today')
  })

  it('offers a way back to the full Sessions surface', () => {
    expect(scheduleSource).toContain("href=\"/dashboard/sessions\"")
  })
})

describe('components/dashboard/WeatherPanel.tsx — parameterised, LD Tennis unchanged', () => {
  it('21. coordinates are props with defaults exactly matching LD Tennis\'s original hardcoded values', () => {
    expect(weatherSource).toContain('const DEFAULT_LAT = -34.93')
    expect(weatherSource).toContain('const DEFAULT_LNG = 138.60')
    expect(weatherSource).toContain("const DEFAULT_TZ  = 'Australia/Adelaide'")
  })

  it('22/23. latitude/longitude/timezone/labels are optional props (never required, never invented when absent) — omitting them safely falls back to the known-good defaults', () => {
    expect(weatherSource).toMatch(/latitude\?:\s*number/)
    expect(weatherSource).toMatch(/longitude\?:\s*number/)
    expect(weatherSource).toContain('latitude = DEFAULT_LAT')
    expect(weatherSource).toContain('longitude = DEFAULT_LNG')
  })

  it('TennisDashboard calls WeatherPanel with no props, so LD Tennis renders with zero behavioural change', () => {
    expect(dashSource).toMatch(/<WeatherPanel\s*\/>/)
  })
})

describe('components/dashboard/TennisDashboard.tsx — greeting header + empty states + no municipal content', () => {
  it('the greeting is rendered once, in the page header, computed by the shared library rather than re-implemented here', () => {
    expect(dashSource).toContain('{greeting}')
    expect(dashSource).not.toMatch(/Good morning|Good afternoon|Good evening/)
  })

  it('25. Needs Attention empty state is specific and encouraging, not blank', () => {
    expect(dashSource).toContain("You're all caught up")
  })

  it('26. Recent Activity empty state is specific, not blank', () => {
    expect(dashSource).toContain('No recent activity')
  })

  it('30. no BrainBase owner/municipal shell content is imported into the client day overview', () => {
    expect(dashSource).not.toContain("from '@/components/BrainBase'")
    expect(dashSource).not.toContain('LeftSidebar')
    expect(dashSource).not.toContain('Demo Council')
  })

  it('four KPI cards appear in the requested order: Today\'s Sessions, New Leads, Follow-ups, Open Leads (formerly "Active Clients" — see the dedicated rename test below)', () => {
    const kpiBlockStart = dashSource.indexOf("Row 1: KPI cards")
    const kpiBlockEnd = dashSource.indexOf('Row 2:')
    const block = dashSource.slice(kpiBlockStart, kpiBlockEnd)
    // Match the actual StatCard label="..." prop, not a bare substring —
    // a bare substring would also match this file's own explanatory code
    // comments, which is exactly the false-pass this test used to be
    // vulnerable to before the Active Clients -> Open Leads rename.
    const order = ["Today's Sessions", 'New Leads', 'Follow-ups', 'Open Leads']
      .map(label => block.indexOf(`label="${label}"`))
    expect(order.every(i => i > -1)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
})
