import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness. See
// tennisInitialFrequencyStaticChecks.test.ts for the same caveat spelled
// out in full.

const SOURCE_PATH = path.resolve(__dirname, '../../app/dashboard/sessions/page.tsx')
const source = fs.readFileSync(SOURCE_PATH, 'utf-8')

describe('app/dashboard/sessions/page.tsx — Manage Sessions modal replaces the cluttered strip', () => {
  it('1. the legacy horizontal Manage strip (SessionChip rendered above the calendar on every load) is no longer rendered', () => {
    expect(source).not.toContain('function SessionChip(')
    expect(source).not.toMatch(/>Manage<\/span>/) // the old "MANAGE" strip label
  })

  it('2. a "Manage sessions" action is visible near the header, not buried', () => {
    const headerStart = source.indexOf('{/* ── Page header')
    const headerEnd = source.indexOf('{!loading && sessions.length === 0')
    expect(headerStart).toBeGreaterThan(-1)
    const headerBlock = source.slice(headerStart, headerEnd)
    expect(headerBlock).toContain('Manage sessions')
    expect(headerBlock).toContain('setShowManageSessions(true)')
  })

  it('3. Manage Sessions exposes Repair / Edit / Delete for every session', () => {
    const fnStart = source.indexOf('function ManageSessionsModal(')
    const fnEnd = source.indexOf('\n// ─── Calendar')
    expect(fnStart).toBeGreaterThan(-1)
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('handleRepair(s.id)')
    expect(body).toContain('onEdit(s)')
    expect(body).toContain('handleDeleteConfirmed(s.id)')
  })

  it('4. Manage Sessions lists every session template (not filtered to ones with visible future instances) — the whole point is reaching an otherwise-unreachable session', () => {
    const fnStart = source.indexOf('function ManageSessionsModal(')
    const fnEnd = source.indexOf('\n// ─── Calendar')
    const body = source.slice(fnStart, fnEnd)
    // Sorted straight from the full `sessions` prop, no instance-based filter.
    expect(body).toContain('const sorted = [...sessions].sort(')
    expect(body).not.toMatch(/sessions\.filter\(/)
  })

  it('the page hierarchy reads: header -> calendar controls/date heading -> calendar -> selected detail — Manage Sessions renders only on demand, not inline in that flow', () => {
    const headerIdx = source.indexOf('{/* ── Page header')
    const controlsIdx = source.indexOf('Summary / controls row')
    const calendarCommentIdx = source.indexOf('{/* ── Calendar: the ONE primary scheduling surface')
    const detailIdx = source.indexOf('{selectedSessionId && selectedSession && (')
    expect(headerIdx).toBeGreaterThan(-1)
    expect(controlsIdx).toBeGreaterThan(headerIdx)
    expect(calendarCommentIdx).toBeGreaterThan(headerIdx)
    expect(detailIdx).toBeGreaterThan(calendarCommentIdx)
    // The modal's own render call sits with the other on-demand modals near
    // the top of the JSX (gated by state), not injected between the controls
    // row and the calendar grid.
    const modalCallIdx = source.indexOf('{showManageSessions && (')
    expect(modalCallIdx).toBeLessThan(controlsIdx)
  })
})

describe('app/dashboard/sessions/page.tsx — selected-state colour stripe fix', () => {
  it('5. the type-colour left border is set unconditionally (never gated on `selected`), so it always survives selection', () => {
    const fnStart = source.indexOf('function CalendarEntry(')
    const fnEnd = source.indexOf('\nfunction WeekGrid(')
    const body = source.slice(fnStart, fnEnd)
    const borderLeftLines = body.match(/borderLeft: `[^`]*`/g) ?? []
    expect(borderLeftLines.length).toBeGreaterThanOrEqual(2) // compact + full variants
    for (const line of borderLeftLines) {
      expect(line).toContain('typeColour')
      expect(line).not.toContain('selected ?')
    }
  })

  it('6. selected state adds a separate purple/indigo emphasis on the other three sides, distinct from the type-colour side', () => {
    const fnStart = source.indexOf('function CalendarEntry(')
    const fnEnd = source.indexOf('\nfunction WeekGrid(')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain("const fullBorderColor = selected ? 'rgba(99,102,241,.50)'")
    expect(body).toContain("const compactBorderColor = selected ? 'rgba(99,102,241,.45)'")
    // Every side but the left uses that selected-derived colour, not the type colour.
    expect(body).toMatch(/borderTop: `1px solid \$\{(full|compact)BorderColor\}`/)
    expect(body).toMatch(/borderRight: `1px solid \$\{(full|compact)BorderColor\}`/)
    expect(body).toMatch(/borderBottom: `1px solid \$\{(full|compact)BorderColor\}`/)
  })

  it('no shorthand `border` property is mixed with `borderLeft` in CalendarEntry (the exact collision pattern that caused the bug)', () => {
    const fnStart = source.indexOf('function CalendarEntry(')
    const fnEnd = source.indexOf('\nfunction WeekGrid(')
    const body = source.slice(fnStart, fnEnd)
    expect(body).not.toMatch(/\bborder: `1px solid/)
  })
})

describe('app/dashboard/sessions/page.tsx — user-configurable session type colours', () => {
  it('7. Manage Types colour selection uses only the fixed, finite palette — never raw CSS/hex input', () => {
    expect(source).toContain('function ColourPicker(')
    const fnStart = source.indexOf('function ColourPicker(')
    const fnEnd = source.indexOf('\nfunction endTime(')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('SESSION_TYPE_COLOUR_KEYS.map(key =>')
    expect(body).not.toMatch(/type="text"|type="color"|<input/)
    // Each swatch shows both colour and a readable name — colour is never the only indicator.
    expect(body).toContain('SESSION_TYPE_COLOUR_NAMES[key]')
  })

  it('8. changing colour is a PATCH to the existing session_types row — no session row is touched, no migration implied', () => {
    const fnStart = source.indexOf('async function recolour(')
    const fnEnd = source.indexOf('\n  async function saveRename(')
    expect(fnStart).toBeGreaterThan(-1)
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain("method: 'PATCH'")
    expect(body).toContain('/api/dashboard/session-types/')
    expect(body).not.toMatch(/\/api\/dashboard\/sessions\/(?!reconcile)/) // never touches the sessions endpoint
  })

  it('9. Week and Month calendar entries resolve colour through sessionColourDot(session_type, sessionTypes) — updating a type\'s colour_key changes every entry of that type automatically', () => {
    const fnStart = source.indexOf('function CalendarEntry(')
    const fnEnd = source.indexOf('\nfunction WeekGrid(')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('const typeColour = sessionColourDot(inst.session_type, sessionTypes)')
  })

  it('the selected session detail header and Manage Sessions both resolve colour the same way (single source of truth, not a duplicated copy)', () => {
    const detailStart = source.indexOf('{/* Session header + actions */}')
    const detailEnd = source.indexOf('{deleteErr &&')
    expect(source.slice(detailStart, detailEnd)).toContain('sessionColourDot(selectedSession.session_type, sessionTypes)')

    const modalStart = source.indexOf('function ManageSessionsModal(')
    const modalEnd = source.indexOf('\n// ─── Calendar')
    expect(source.slice(modalStart, modalEnd)).toContain('sessionColourDot(s.session_type, sessionTypes)')
  })
})

describe('app/dashboard/sessions/page.tsx — calendar card content + no regressions', () => {
  it('10. calendar cards still show type, time, and occupancy (unchanged by this round\'s polish pass)', () => {
    const fnStart = source.indexOf('function CalendarEntry(')
    const fnEnd = source.indexOf('\nfunction WeekGrid(')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('const title  = sessionLabel(inst.session_type, sessionTypes)')
    expect(body).toContain('{inst.start_time}–{endTime(inst.start_time, inst.duration_minutes)}')
    expect(body).toContain('{inst.enrolled_count}/{inst.max_capacity}')
  })

  it('11. calendar entry selection wiring is unchanged — Week/Month clicks still reuse selectInstance', () => {
    expect(source).toContain('onSelectInstance={selectInstance}')
    expect(source).toContain('selected={inst.id === selectedInstanceId}')
  })

  it('12. schedule editing (Edit modal, schedule fields, reconcile-on-save) is untouched by this round', () => {
    expect(source).toContain("set('end_mode', 'after_weeks')")
    expect(source).toContain("set('end_mode', 'on_date')")
    expect(source).toContain("set('end_mode', 'ongoing')")
    expect(source).toContain('function EditModal(')
  })
})

describe('app/dashboard/sessions/page.tsx — Manage Sessions accessibility', () => {
  it('the modal is keyboard-closable (Escape) and exposes dialog semantics', () => {
    const fnStart = source.indexOf('function ManageSessionsModal(')
    const fnEnd = source.indexOf('\n// ─── Calendar')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain("e.key === 'Escape'")
    expect(body).toContain('role="dialog"')
    expect(body).toContain('aria-modal="true"')
  })

  it('icon-only/ambiguous buttons carry accessible labels', () => {
    const fnStart = source.indexOf('function ManageSessionsModal(')
    const fnEnd = source.indexOf('\n// ─── Calendar')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('aria-label="Close"')
    expect(body).toMatch(/aria-label=\{`Repair future dates for/)
    expect(body).toMatch(/aria-label=\{`Edit/)
    expect(body).toMatch(/aria-label=\{`Delete/)
  })

  it('the ColourPicker exposes each swatch as an accessible, named, checkable control — colour is never the only indicator', () => {
    const fnStart = source.indexOf('function ColourPicker(')
    const fnEnd = source.indexOf('\nfunction endTime(')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('role="radio"')
    expect(body).toContain('aria-checked={isSelected}')
    expect(body).toContain('aria-label={SESSION_TYPE_COLOUR_NAMES[key]')
  })
})
