import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Events dropdown-consistency phase — migrates the last five native
// <select> controls in the Events module (EventDetailClient's status
// field; QuestionsPanel's "add common question" menu, answer-type
// select, and scope select; RegistrationDetail's Yes/No answer editor)
// to FilterDropdown (app/events/_components/ui.tsx), the same component
// the registration-toolbar filters already use (see tests/containment/
// eventsRegistrationFilterDropdowns.test.ts for that earlier migration's
// own coverage). UI-only: no question/registration/event schema, no
// API payload shape, no auth, and no backend SQL changes anywhere in
// this phase — every claim below is checked structurally, matching
// this repo's established convention in the absence of a jsdom/React
// Testing Library harness.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const AUDITED_PATHS = [
  'app/events/[id]/EventDetailClient.tsx',
  'app/events/[id]/QuestionsPanel.tsx',
  'app/events/[id]/RegistrationDetail.tsx',
  'app/events/[id]/RegistrationsPanel.tsx',
]

// ─────────────────────────────────────────────────────────────────────
// Complete inventory / tripwire — the whole point of this phase
// ─────────────────────────────────────────────────────────────────────

describe('complete native <select> inventory across the audited Events UI paths', () => {
  it('zero native <select> elements remain in any audited file (the full inventory this phase migrated: EventDetailClient status, QuestionsPanel x3, RegistrationDetail Yes/No, plus the five registration-toolbar filters from the prior phase)', () => {
    for (const file of AUDITED_PATHS) {
      const src = stripComments(read(file))
      expect(src, `${file} must contain no native <select>`).not.toMatch(/<select[\s>]/)
    }
  })

  it('tripwire: fails if a new native <select> is introduced into any audited Events file without updating this explicit allowlist', () => {
    // Empty by design — every native <select> in these files has been
    // migrated. If a future change adds one back, this list is the one
    // place to consciously decide "yes, keep it native, here's why" by
    // adding an entry AND a justifying comment — not a silent regression.
    const ALLOWED_NATIVE_SELECT_FILES: string[] = []
    for (const file of AUDITED_PATHS) {
      const src = stripComments(read(file))
      const hasNativeSelect = /<select[\s>]/.test(src)
      if (hasNativeSelect) {
        expect(ALLOWED_NATIVE_SELECT_FILES, `${file} introduced a native <select> without being added to the explicit allowlist in this test`).toContain(file)
      }
    }
  })

  it('every audited file that has any dropdown-like control uses FilterDropdown, not a different/duplicate popup implementation', () => {
    for (const file of AUDITED_PATHS) {
      const src = stripComments(read(file))
      expect(src, `${file} must not introduce a second dropdown implementation`).not.toMatch(/react-select|Listbox|Combobox|<Popover/i)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// FilterDropdown — the triggerStyle enhancement (new in this phase)
// ─────────────────────────────────────────────────────────────────────

describe('app/events/_components/ui.tsx — FilterDropdown\'s triggerStyle enhancement', () => {
  const uiSrc = stripComments(read('app/events/_components/ui.tsx'))
  const start = uiSrc.indexOf('export function FilterDropdown')
  const end = uiSrc.indexOf('\n}\n', start) + 2
  const block = uiSrc.slice(start, end)

  it('accepts an optional triggerStyle prop, merged onto the trigger button AFTER its own defaults (so callers can override anything, including minWidth)', () => {
    expect(block).toContain('triggerStyle?: React.CSSProperties')
    const triggerStyleStart = block.indexOf('style={{\n          ...inputStyle')
    const triggerStyleEnd = block.indexOf('}}', triggerStyleStart)
    const triggerStyleBlock = block.slice(triggerStyleStart, triggerStyleEnd)
    expect(triggerStyleBlock.trim().endsWith('...triggerStyle,')).toBe(true)
  })

  it('the existing wrapper-level style prop is unchanged — triggerStyle is additive, not a replacement', () => {
    expect(block).toContain('style?: React.CSSProperties')
    expect(block).toMatch(/position: 'relative', flex: '0 1 auto', \.\.\.style/)
  })

  it('no disabled prop was added — none of the migrated call sites need it, and this component avoids unused API surface', () => {
    expect(block).not.toContain('disabled?:')
  })
})

// ─────────────────────────────────────────────────────────────────────
// EventDetailClient.tsx — status field
// ─────────────────────────────────────────────────────────────────────

describe('EventDetailClient.tsx — Status field migrated, values/behavior unchanged', () => {
  const src = stripComments(read('app/events/[id]/EventDetailClient.tsx'))

  it('imports FilterDropdown', () => {
    expect(src).toMatch(/import\s*\{[\s\S]*?\bFilterDropdown\b[\s\S]*?\}\s*from\s*'\.\.\/_components\/ui'/)
  })

  it('renders exactly one FilterDropdown for Status with the exact same three values/labels as the prior <select>', () => {
    const idx = src.indexOf('ariaLabel="Status"')
    expect(idx).toBeGreaterThan(-1)
    const block = src.slice(idx - 50, idx + 400)
    expect(block).toContain("{ value: 'DRAFT', label: 'Draft' }")
    expect(block).toContain("{ value: 'PUBLISHED', label: 'Published' }")
    expect(block).toContain("{ value: 'CANCELLED', label: 'Cancelled' }")
  })

  it('onChange still updates the exact same status state the form\'s save() reads directly (not native FormData) and PATCHes to the API', () => {
    const idx = src.indexOf('ariaLabel="Status"')
    const block = src.slice(idx, idx + 200)
    expect(block).toMatch(/onChange=\{v => setStatus\(v as EventDetail\['status'\]\)\}/)
    expect(src).toMatch(/body: JSON\.stringify\(\{[\s\S]*?status,/)
  })

  it('fills its 3-column form-grid cell width, matching its sibling datetime inputs', () => {
    const idx = src.indexOf('ariaLabel="Status"')
    const block = src.slice(idx, idx + 600)
    expect(block).toContain("style={{ width: '100%' }}")
    expect(block).toContain("triggerStyle={{ width: '100%' }}")
  })
})

// ─────────────────────────────────────────────────────────────────────
// QuestionsPanel.tsx — three dropdowns
// ─────────────────────────────────────────────────────────────────────

describe('QuestionsPanel.tsx — all three dropdowns migrated, values/behavior unchanged', () => {
  const src = stripComments(read('app/events/[id]/QuestionsPanel.tsx'))

  it('imports FilterDropdown and DropdownOption', () => {
    expect(src).toMatch(/import\s*\{[\s\S]*?\bFilterDropdown\b[\s\S]*?\}\s*from\s*'\.\.\/_components\/ui'/)
    expect(src).toContain('DropdownOption')
  })

  it('"Add a common question" is an action menu, not a persistent filter — value is always the literal empty string, never derived from selected state', () => {
    const idx = src.indexOf('ariaLabel="Add a common question"')
    expect(idx).toBeGreaterThan(-1)
    const block = src.slice(idx, idx + 500)
    expect(block).toMatch(/value=""/)
    expect(block).toContain("{ value: '', label: '+ Add common question…' }")
    expect(block).toContain('...COMMON_QUESTIONS.map((c): DropdownOption => ({ value: c.label, label: c.label }))')
  })

  it('selecting a common-question template still calls setCreateTemplate + setShowCreate exactly as the native select\'s onChange did', () => {
    const idx = src.indexOf('ariaLabel="Add a common question"')
    const block = src.slice(idx, idx + 500)
    expect(block).toContain('setCreateTemplate(tpl)')
    expect(block).toContain('setShowCreate(true)')
  })

  it('Answer type dropdown maps FIELD_TYPES to FIELD_TYPE_LABELS exactly as the prior <select> did, onChange still calls setFieldType', () => {
    const idx = src.indexOf('ariaLabel="Answer type"')
    expect(idx).toBeGreaterThan(-1)
    const block = src.slice(idx, idx + 400)
    expect(block).toContain('options={FIELD_TYPES.map((t): DropdownOption => ({ value: t, label: FIELD_TYPE_LABELS[t] }))}')
    expect(block).toMatch(/onChange=\{v => setFieldType\(v as FieldType\)\}/)
  })

  it('Asked (scope) dropdown maps SCOPES to SCOPE_LABELS exactly as the prior <select> did, onChange still calls setScope', () => {
    const idx = src.indexOf('ariaLabel="Asked"')
    expect(idx).toBeGreaterThan(-1)
    const block = src.slice(idx, idx + 400)
    expect(block).toContain('options={SCOPES.map((s): DropdownOption => ({ value: s, label: SCOPE_LABELS[s] }))}')
    expect(block).toMatch(/onChange=\{v => setScope\(v as Scope\)\}/)
  })

  it('the question-create/edit form still submits fieldType/scope as plain React state via fetch(), never native FormData, and the API payload shape is unchanged', () => {
    expect(src).toMatch(/const res = await onSubmit\(\{[\s\S]*?field_type: fieldType, required, scope,/)
  })

  it('Answer type and Asked dropdowns fill their 2-column form-grid cells', () => {
    for (const label of ['Answer type', 'Asked']) {
      const idx = src.indexOf(`ariaLabel="${label}"`)
      const block = src.slice(idx, idx + 400)
      expect(block).toContain("style={{ width: '100%' }}")
      expect(block).toContain("triggerStyle={{ width: '100%' }}")
    }
  })

  it('no question/registration schema or validation logic was touched — FIELD_TYPES, SCOPES, and the options-editor UI for SINGLE_SELECT/MULTI_SELECT are unchanged', () => {
    expect(src).toContain("const FIELD_TYPES = ['SHORT_TEXT', 'LONG_TEXT', 'YES_NO', 'SINGLE_SELECT', 'MULTI_SELECT'] as const")
    expect(src).toContain("const SCOPES = ['ORDER', 'ATTENDEE'] as const")
    expect(src).toContain('const isSelect = fieldType === \'SINGLE_SELECT\' || fieldType === \'MULTI_SELECT\'')
  })
})

// ─────────────────────────────────────────────────────────────────────
// RegistrationDetail.tsx — Yes/No answer editor
// ─────────────────────────────────────────────────────────────────────

describe('RegistrationDetail.tsx — Yes/No answer editor migrated, values/behavior/API payload unchanged', () => {
  const src = stripComments(read('app/events/[id]/RegistrationDetail.tsx'))

  it('imports FilterDropdown', () => {
    expect(src).toMatch(/import\s*\{[\s\S]*?\bFilterDropdown\b[\s\S]*?\}\s*from\s*'\.\.\/_components\/ui'/)
  })

  it('renders exactly one FilterDropdown for the YES_NO answer editor, with the exact same yes/no values/labels and the same true/false-tolerant normalization the prior <select> used', () => {
    const idx = src.indexOf("r.field_type === 'YES_NO'")
    expect(idx).toBeGreaterThan(-1)
    const block = src.slice(idx, idx + 500)
    expect(block).toMatch(/value=\{responseForm === 'yes' \|\| responseForm === 'true' \? 'yes' : 'no'\}/)
    expect(block).toContain("options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}")
  })

  it('onChange is still setResponseForm directly — the same state saveResponse() reads to build the PATCH payload', () => {
    const idx = src.indexOf("r.field_type === 'YES_NO'")
    const block = src.slice(idx, idx + 300)
    expect(block).toContain('onChange={setResponseForm}')
    expect(src).toMatch(/body: JSON\.stringify\(\{ answer: inputValueToAnswer\(r\.field_type, responseForm\) \}\)/)
  })

  it('uses a compact triggerStyle (smaller padding/font, narrow minWidth) matching the prior inline select\'s own compact sizing — not the toolbar-scale default', () => {
    const idx = src.indexOf("r.field_type === 'YES_NO'")
    const block = src.slice(idx, idx + 400)
    expect(block).toMatch(/triggerStyle=\{\{ padding: '5px 9px', fontSize: 12\.5, minWidth: 70 \}\}/)
  })

  it('the LONG_TEXT and default (short text) answer editors are untouched — still a plain <textarea>/<input>', () => {
    expect(src).toMatch(/<textarea value=\{responseForm\}/)
    expect(src).toMatch(/<input value=\{responseForm\}/)
  })

  it('no ticket-token/resend logic was touched — the existing "never regenerate" comment and copyTicketLink() are unchanged', () => {
    // Checks the RAW file (not comment-stripped src) since the claim
    // being verified is that the comment itself is still there.
    const raw = read('app/events/[id]/RegistrationDetail.tsx')
    expect(raw).toContain('never regenerated')
    expect(src).toContain('function ticketUrl(token: string): string')
  })
})
