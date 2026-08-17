import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// See tennisInitialFrequencyStaticChecks.test.ts for why these are
// deliberately static source-text assertions rather than a claim of proven
// rendering behaviour (no jsdom/RTL in this project's test environment).

const SOURCE_PATH = path.resolve(__dirname, '../../app/dashboard/sessions/page.tsx')
const source = fs.readFileSync(SOURCE_PATH, 'utf-8')

describe('app/dashboard/sessions/page.tsx — static source checks (Bug 2: stale UI after mutation)', () => {
  it('refreshDashboard refetches both the sessions list and the current session instances list from the server', () => {
    expect(source).toContain('function refreshDashboard()')
    // Must hit the real sessions-list and per-session endpoints (the data
    // that actually renders PLAYERS/date-chip badges) — not just the
    // unused weekInstances state, which is what the previous version
    // refreshed instead (confirmed dead: WeekView/weekInstances are
    // unreferenced anywhere else in this file).
    const fnBody = source.slice(source.indexOf('function refreshDashboard()'), source.indexOf('function refreshDashboard()') + 600)
    expect(fnBody).toContain('fetch(API)')
    expect(fnBody).toContain('setSessions(')
    expect(fnBody).toContain('fetch(`${API}/${selectedSessionId}`)')
    expect(fnBody).toContain('setInstances(')
  })

  it('every recurrence-affecting mutation handler calls refreshDashboard (initial enrol, remove, remove-future, and roster-level actions via onRefresh)', () => {
    expect(source).toMatch(/onEnroll=\{b => \{[\s\S]{0,200}refreshDashboard\(\)/)
    expect(source).toMatch(/function handleRemove\(bookingId: string\) \{[\s\S]{0,200}refreshDashboard\(\)/)
    expect(source).toMatch(/function handleRemoveFuture\(bookingId: string\) \{[\s\S]{0,300}refreshDashboard\(\)/)
    expect(source).toContain('onRefresh={refreshDashboard}')
  })

  it('the roster-level actions (toggle Weekly/Once, pause, resume) call the onRefresh prop threaded from refreshDashboard', () => {
    // These live inside InstanceRoster and call the onRefresh prop, which
    // the page wires directly to refreshDashboard (checked above) — not a
    // second, independent, possibly-inconsistent refresh implementation.
    expect(source).toMatch(/async function toggleRecurring\(b: InstanceBooking\) \{[\s\S]{0,900}onRefresh\(\)/)
    expect(source).toMatch(/async function submitPause\(b: InstanceBooking\) \{[\s\S]{0,1300}onRefresh\(\)/)
    expect(source).toMatch(/async function resumeEarly\(b: InstanceBooking\) \{[\s\S]{0,500}onRefresh\(\)/)
  })

  it('handleRemoveFuture no longer collapses the roster panel via loadInstances (which used to reset selectedInstanceId)', () => {
    const fnStart = source.indexOf('function handleRemoveFuture(bookingId: string)')
    const fnBody = source.slice(fnStart, fnStart + 400)
    expect(fnBody).not.toContain('loadInstances(')
  })
})
