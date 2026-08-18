import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness. See
// tennisInitialFrequencyStaticChecks.test.ts for the same caveat spelled
// out in full.

const SOURCE_PATH = path.resolve(__dirname, '../../app/dashboard/sessions/page.tsx')
const source = fs.readFileSync(SOURCE_PATH, 'utf-8')

describe('app/dashboard/sessions/page.tsx — static checks (schedule fields + session type dropdown + form alignment)', () => {
  it('the Create/Edit form has the new Schedule fields: Start Date and an Ends control (After weeks / On date / Ongoing)', () => {
    expect(source).toContain('Start Date')
    expect(source).toContain("set('end_mode', 'after_weeks')")
    expect(source).toContain("set('end_mode', 'on_date')")
    expect(source).toContain("set('end_mode', 'ongoing')")
  })

  it('the Type dropdown is sourced from fetched organisation session types, not the old hardcoded array, when any exist', () => {
    expect(source).toContain('sessionTypes.length > 0')
    expect(source).toContain("fetch('/api/dashboard/session-types")
    // The hardcoded array still exists only as the pre-migration/empty-list fallback.
    expect(source).toContain(': FLAT_LEGACY_TYPE_OPTIONS')
  })

  it('the fallback list is used only when no live types are present — it is not the primary source', () => {
    const typeOptionsBlock = source.match(/const typeOptions: SelectOption\[\] = sessionTypes\.length > 0[\s\S]{0,400}/)
    expect(typeOptionsBlock).not.toBeNull()
    expect(typeOptionsBlock![0]).toContain('sessionTypes')
  })

  it('archived types are excluded from the Type dropdown options unless currently selected (never orphans an existing session\'s saved type)', () => {
    expect(source).toContain('t.active || t.slug === form.session_type')
  })

  it('sessionLabel/sessionChip resolve regardless of active state — an archived type still renders correctly on a historical/current session', () => {
    const sessionLabelFn = source.match(/function sessionLabel\([\s\S]{0,200}/)
    const sessionChipFn = source.match(/function sessionChip\([\s\S]{0,300}/)
    expect(sessionLabelFn).not.toBeNull()
    expect(sessionChipFn).not.toBeNull()
    // Neither filters the lookup by t.active — only the dropdown does that.
    expect(sessionLabelFn![0]).not.toMatch(/\.active/)
    expect(sessionChipFn![0]).not.toMatch(/\.active/)
  })

  it('colour selection is restricted to the fixed palette (no raw CSS/free-text colour input in the form)', () => {
    expect(source).toContain('SESSION_TYPE_COLOUR_PALETTE')
    expect(source).toContain('SESSION_TYPE_COLOUR_KEYS')
    // The Manage Session Types colour picker uses the fixed key list, not a text input.
    expect(source).toMatch(/options=\{SESSION_TYPE_COLOUR_KEYS\.map/)
  })

  it('the 4-field alignment bug is fixed with a shared fixed-height label style applied uniformly to every label in a multi-column row, not a per-field margin patch', () => {
    expect(source).toContain('fieldRowLbl')
    expect(source).toContain('minHeight: 28')
    // Applied to Start Date/Start Time/Duration row AND Max Capacity/Price row — not just one.
    const rowLblUsages = (source.match(/fieldRowLbl\}/g) ?? []).length
    expect(rowLblUsages).toBeGreaterThanOrEqual(5) // 3 schedule fields + 2 capacity/price fields
  })

  it('the form is grouped into the requested sections: Session Details, Schedule, Capacity & Price, Location', () => {
    expect(source).toContain('Session Details');
    expect(source).toMatch(/>Schedule</)
    expect(source).toMatch(/Capacity &amp; Price|Capacity & Price/)
    expect(source).toMatch(/>Location</)
  })

  it('the old "Recurring weekly" checkbox is relabelled to avoid implying it controls how often the class itself runs (that is now the Schedule section\'s job)', () => {
    expect(source).not.toContain('>Recurring weekly<')
    expect(source).toContain('Allow weekly (recurring) enrolment')
  })

  it('there is exactly one recurrence-related control in the form — the schedule Ends control and the enrolment checkbox are visibly distinct, not two competing "is this recurring" toggles', () => {
    // Only one <input type="checkbox" ...recurring...> remains in the form fields.
    const checkboxMatches = source.match(/type="checkbox" checked=\{form\.recurring\}/g) ?? []
    expect(checkboxMatches).toHaveLength(1)
  })

  it('"Generate 6 weeks" as primary workflow language is gone — replaced by automatic scheduling plus a demoted manual repair action', () => {
    expect(source).not.toContain('Generate 6 weeks')
    expect(source).toContain('Repair future dates')
  })

  it('a schedule summary line (e.g. "Ongoing · Mondays 5:00 PM") is shown on the selected session, with an Edit schedule affordance', () => {
    expect(source).toContain('function scheduleSummary(')
    expect(source).toContain('Schedule: {scheduleSummary(selectedSession)}')
    expect(source).toContain('Edit schedule')
  })
})
