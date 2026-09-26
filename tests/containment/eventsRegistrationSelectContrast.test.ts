import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Registration operations phase — dark select dropdown contrast fix.
//
// ROOT CAUSE: app/events/_components/ui.tsx's shared inputStyle already
// set an explicit dark background/light text for the CLOSED state of
// every <input>/<select> that uses it — RegistrationsPanel's five
// filter selects among them. But background/color on the element itself
// never reaches the browser's OPEN native option popup; only the
// color-scheme CSS property does. With no color-scheme set anywhere
// (confirmed absent from both ui.tsx and globals.css before this fix),
// browsers fell back to their default LIGHT popup theme — white
// background, near-invisible light-on-light option text — while the
// closed control itself looked correct. This is the same fix already
// applied per-element elsewhere in this codebase (e.g.
// components/ops/maintenance/CreateJobModal.tsx's selects), applied
// once here to the shared primitive so every current AND future
// consumer of inputStyle gets it for free — not just RegistrationsPanel.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('app/events/_components/ui.tsx — shared inputs follow the global theme color-scheme', () => {
  const uiSrc = stripComments(read('app/events/_components/ui.tsx'))

  it('inputStyle keeps explicit themed background/text styling without forcing dark native chrome', () => {
    const start = uiSrc.indexOf('export const inputStyle')
    const end = uiSrc.indexOf('};', start)
    const block = uiSrc.slice(start, end)
    expect(block).not.toContain("colorScheme: 'dark'")
    expect(block).toContain('var(--bg-raised)')
    expect(block).toContain('color: TEXT_PRIMARY')
  })

  it('the global theme owns native control color-scheme for both dark and light modes', () => {
    const globals = read('app/globals.css')
    expect(globals).toContain('color-scheme: dark;')
    expect(globals).toMatch(/:root\[data-theme='light'\][\s\S]*color-scheme: light;/)
  })

  it('fieldStyle remains a label wrapper and does not override color-scheme itself', () => {
    const fieldStart = uiSrc.indexOf('export const fieldStyle')
    const fieldEnd = uiSrc.indexOf(';', fieldStart)
    const fieldBlock = uiSrc.slice(fieldStart, fieldEnd)
    expect(fieldBlock).not.toContain('colorScheme')
  })
})

// UPDATE (dropdown-replacement phase): the five registration toolbar
// filters below no longer use a native <select> at all — they were
// replaced with the FilterDropdown component (app/events/_components/
// ui.tsx) to visually match the top-nav dropdown family instead of a
// native browser popup; see tests/containment/
// eventsRegistrationFilterDropdowns.test.ts for that replacement's own
// full coverage. This block is kept narrowly scoped to what remains
// true: RegistrationsPanel's search box is still a plain <input> that
// spreads ...inputStyle directly, and FilterDropdown's own closed
// trigger (not a native <select>) also spreads ...inputStyle as its
// base — both still benefit from the colorScheme fix above, just via a
// different element than before.
describe('RegistrationsPanel.tsx — the remaining native inputStyle consumer (search box) still inherits the fix', () => {
  const src = stripComments(read('app/events/[id]/RegistrationsPanel.tsx'))

  it('imports inputStyle from the shared Events ui module', () => {
    expect(src).toMatch(/import\s*\{[^}]*\binputStyle\b[^}]*\}\s*from\s*'\.\.\/_components\/ui'/)
  })

  it('the search <input> still spreads ...inputStyle', () => {
    const inputBlock = src.slice(src.indexOf('<input'), src.indexOf('/>', src.indexOf('<input')) + 2)
    expect(inputBlock).toMatch(/style=\{\{\s*\.\.\.inputStyle/)
  })

  it('no <select> element remains anywhere in this file — all five filters now use FilterDropdown', () => {
    expect(src).not.toMatch(/<select[\s>]/)
  })
})

// UPDATE (dropdown-consistency phase): these three files' own native
// <select>s (EventDetailClient's status field, QuestionsPanel's
// answer-type/scope/common-question selects, RegistrationDetail's
// Yes/No answer editor) have all since been migrated to FilterDropdown
// too — see tests/containment/eventsDropdownConsistency.test.ts for
// that migration's own full coverage. This block is kept narrowly
// scoped to what remains true: all three files still import inputStyle
// (their other plain <input>/<textarea> fields use it directly, and
// FilterDropdown's own trigger spreads it as its base), so the
// colorScheme fix still reaches them.
describe('other Events form files still import inputStyle (their remaining plain inputs, and every FilterDropdown trigger, both still benefit from the fix)', () => {
  const consumers = [
    'app/events/[id]/EventDetailClient.tsx',
    'app/events/[id]/QuestionsPanel.tsx',
    'app/events/[id]/RegistrationDetail.tsx',
  ]

  for (const file of consumers) {
    it(`${file} imports inputStyle from the shared ui module`, () => {
      const src = stripComments(read(file))
      expect(src).toMatch(/import\s*\{[^}]*\binputStyle\b[^}]*\}\s*from\s*'[^']*_components\/ui'/)
    })
  }
})
