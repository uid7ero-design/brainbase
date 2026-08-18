import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness. See
// tennisInitialFrequencyStaticChecks.test.ts for the same caveat spelled
// out in full.

const SOURCE_PATH = path.resolve(__dirname, '../../app/dashboard/sessions/page.tsx')
const source = fs.readFileSync(SOURCE_PATH, 'utf-8')

function sliceFn(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('app/dashboard/sessions/page.tsx — Create/Edit Session Colour field', () => {
  const formFieldsBody = sliceFn('function SessionFormFields(', '\n// ─── Create Modal')

  it('defaults to "Use type colour" — the form field is a new session_colour_key on SessionFormState, not required to submit', () => {
    expect(source).toContain('session_colour_key: string // \'\' = inherit the session type\'s colour')
    expect(source).toContain("session_colour_key: '',") // CreateModal initial state
  })

  it('shows the RESOLVED inherited type colour name when not overridden, unambiguous vs. an override', () => {
    expect(formFieldsBody).toContain('Use type colour${typeColourName ? ` — ${typeColourName}` : \'\'}')
    expect(formFieldsBody).toContain('Session override — ${SESSION_TYPE_COLOUR_NAMES[form.session_colour_key]')
  })

  it('an explicit "Use type colour" reset action is only shown while overriding, and it stores an empty value (resolves to NULL server-side)', () => {
    expect(formFieldsBody).toContain('{form.session_colour_key && (')
    expect(formFieldsBody).toContain("onClick={() => set('session_colour_key', '')}")
  })

  it('reuses the exact same ColourPicker/palette component Manage Types uses — no second, duplicated colour-picking UI', () => {
    expect(formFieldsBody).toContain('<ColourPicker value={form.session_colour_key || typeColourKey || \'slate\'} onChange={v => set(\'session_colour_key\', v)} />')
  })

  it('EditModal seeds the form from the session\'s existing override (or blank if none), never invents a value', () => {
    const editBody = sliceFn('function EditModal(', '\n// ─── Manage Session Types')
    expect(editBody).toContain("session_colour_key: session.session_colour_key ?? '',")
  })
})

describe('app/dashboard/sessions/page.tsx — expanded palette is the single shared source everywhere colour is picked', () => {
  it('both Manage Types (recolour + add-new) and the Session Colour field render via the same <ColourPicker> component', () => {
    const colourPickerUsages = (source.match(/<ColourPicker /g) ?? []).length
    // 1 recolour existing type + 1 add-new type + 1 session colour field.
    expect(colourPickerUsages).toBeGreaterThanOrEqual(3)
  })
})
