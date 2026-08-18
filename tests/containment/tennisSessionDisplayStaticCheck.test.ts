import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness. See
// tennisInitialFrequencyStaticChecks.test.ts for the same caveat spelled
// out in full. The underlying title/label RESOLUTION logic itself (which
// string wins, when a label is suppressed) is covered by real execution
// tests against lib/sessionDisplay.ts in tennisSessionDisplay.test.ts —
// these checks only confirm the page actually wires that logic into each
// render site instead of the old session.name-first behaviour.

const SOURCE_PATH = path.resolve(__dirname, '../../app/dashboard/sessions/page.tsx')
const source = fs.readFileSync(SOURCE_PATH, 'utf-8')

describe('app/dashboard/sessions/page.tsx — Session Type as primary title + calendar times', () => {
  it('imports the shared display resolution from lib/sessionDisplay.ts rather than keeping a second copy inline', () => {
    expect(source).toContain("from '@/lib/sessionDisplay'")
    expect(source).toContain('sessionLabel')
    expect(source).toContain('optionalLabel')
  })

  it('Week view (non-compact CalendarEntry) title is resolved via sessionLabel, not the raw session_name field', () => {
    const fnStart = source.indexOf('function CalendarEntry(')
    const fnEnd = source.indexOf('\nfunction WeekGrid(')
    expect(fnStart).toBeGreaterThan(-1)
    expect(fnEnd).toBeGreaterThan(fnStart)
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('const title  = sessionLabel(inst.session_type, sessionTypes)')
    // The primary title span must render `title`, not the raw stored name directly.
    expect(body).not.toMatch(/>\{inst\.session_name\}</)
  })

  it('Week view entries show a start-end time range, derived via the existing endTime() helper (no new stored field, no new formatter)', () => {
    const fnStart = source.indexOf('function CalendarEntry(')
    const fnEnd = source.indexOf('\nfunction WeekGrid(')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('{inst.start_time}–{endTime(inst.start_time, inst.duration_minutes)}')
  })

  it('Week view shows the optional label as a distinct secondary line only when optionalLabel() returns non-null', () => {
    const fnStart = source.indexOf('function CalendarEntry(')
    const fnEnd = source.indexOf('\nfunction WeekGrid(')
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('const label = optionalLabel(inst.session_name, inst.session_type, sessionTypes)')
    expect(body).toContain('{label && (')
  })

  it('Month view (compact CalendarEntry) shows the start time immediately, before the type name, without requiring a click', () => {
    const fnStart = source.indexOf('function CalendarEntry(')
    const fnEnd = source.indexOf('\nfunction WeekGrid(')
    const body = source.slice(fnStart, fnEnd)
    // Compact branch: time-then-title, e.g. "10:00 Hot Shots Tennis".
    expect(body).toMatch(/\{inst\.start_time\}<\/span> \{title\}/)
  })

  it('Month view preserves the existing "+N more" overflow behaviour', () => {
    expect(source).toContain('{extra > 0 && <div')
    expect(source).toContain('+{extra} more')
  })

  it('the selected session detail header uses Session Type as the primary title, not the raw session name', () => {
    const headerStart = source.indexOf('{/* Session header + actions */}')
    const headerEnd = source.indexOf('{deleteErr &&')
    expect(headerStart).toBeGreaterThan(-1)
    expect(headerEnd).toBeGreaterThan(headerStart)
    const body = source.slice(headerStart, headerEnd)
    expect(body).toContain('sessionLabel(selectedSession.session_type, sessionTypes)')
    expect(body).not.toMatch(/\{selectedSession\.name\}/)
  })

  it('the detail header shows the optional label as a secondary line only when present', () => {
    const headerStart = source.indexOf('{/* Session header + actions */}')
    const headerEnd = source.indexOf('{deleteErr &&')
    const body = source.slice(headerStart, headerEnd)
    expect(body).toContain('optionalLabel(selectedSession.name, selectedSession.session_type, sessionTypes) && (')
  })

  it('the management strip (SessionChip) leads with Session Type, keeps Repair future dates / Edit / Delete unchanged', () => {
    const fnStart = source.indexOf('function SessionChip(')
    const fnEnd = source.indexOf('\n// ─── Calendar')
    expect(fnStart).toBeGreaterThan(-1)
    const body = source.slice(fnStart, fnEnd)
    expect(body).toContain('const title  = sessionLabel(session.session_type, sessionTypes)')
    expect(body).not.toMatch(/>\{session\.name\}</)
    expect(source).toContain('Repair future dates')
    expect(source).toContain('>Edit<')
  })

  it('Create/Edit form: Type comes before the Optional Label field, and the field is renamed', () => {
    const typeIdx = source.indexOf('<label style={fieldLbl}>Type</label>')
    const labelIdx = source.indexOf('<label style={fieldLbl}>Optional Label</label>')
    expect(typeIdx).toBeGreaterThan(-1)
    expect(labelIdx).toBeGreaterThan(typeIdx)
    expect(source).not.toContain('Session Name</label>')
    expect(source).toContain('Use only when you need to distinguish this class from others of the same type')
  })

  it('the form no longer requires a name to submit — only session_type gates the submit button', () => {
    expect(source).not.toMatch(/!form\.name\.trim\(\)/)
    expect(source).toContain('disabled={!form.session_type.trim() || saving}')
  })

  it('the Type dropdown still sources from the fetched, organisation-scoped session types list (with the pre-migration fallback intact)', () => {
    expect(source).toContain('sessionTypes.length > 0')
    expect(source).toContain('FLAT_LEGACY_TYPE_OPTIONS')
  })

  it('calendar instance selection is unchanged — Week/Month clicks still reuse the same selectInstance wiring', () => {
    expect(source).toContain('onSelectInstance={selectInstance}')
    expect(source).toContain('selected={inst.id === selectedInstanceId}')
  })
})
