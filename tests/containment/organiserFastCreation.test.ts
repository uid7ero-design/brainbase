import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// D.4.7D — fast creation + inline editing. Static source-text containment
// only — this repo has no jsdom/React Testing Library harness (see
// AGENTS.md/CLAUDE.md and every other containment test file's own note).
// The three locked changes this phase makes:
//   A. Repeatable group creation (submitNewGroup no longer closes the
//      creation UI on success).
//   B. Inline item-name editing directly in the table (ItemRow), without
//      losing the existing "click name to open drawer" interaction.
//   C. Generic dirty-draft protection in InlineText (mirrors D.4.7C's
//      Notes fix), covering every real call site.
// Each load-bearing assertion below is mutation-proofed in review
// (temporarily reverted, confirmed the corresponding test fails, restored).

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const pageSource = read('app/organiser/page.tsx')
const pageCode = stripComments(pageSource)

function block(startMarker: string, endMarker: string): string {
  const start = pageCode.indexOf(startMarker)
  const end = pageCode.indexOf(endMarker, start)
  expect(start, `start marker not found: ${startMarker}`).toBeGreaterThan(-1)
  expect(end, `end marker not found after start: ${endMarker}`).toBeGreaterThan(start)
  return pageCode.slice(start, end)
}

const submitNewGroupBlock = () => block('async function submitNewGroup(', '\n  const [importMsg')
const addingGroupJsxBlock = () => block('{addingGroup && (', '\n                  {boardData && boardData.groups.length === 0')
const itemRowBlock = () => block('function ItemRow(', '\nfunction GroupSection(')
const inlineTextBlock = () => block('function InlineText(', '\nfunction CustomCell(')

describe('A. repeatable group creation', () => {
  describe('A1/A2 — success does not close the creation flow (sequential creation architecture)', () => {
    it('success clears groupName but never calls setAddingGroup(false)', () => {
      const b = submitNewGroupBlock()
      const okIdx = b.indexOf('if (ok) {')
      const elseIdx = b.indexOf('} else {', okIdx)
      const okBranch = b.slice(okIdx, elseIdx)
      expect(okBranch).toMatch(/setGroupName\(""\);/)
      expect(okBranch).not.toMatch(/setAddingGroup\(false\)/)
    })

    it('the input stays rendered purely on `addingGroup` — nothing in the success path ever flips it, so it remains true (and the input mounted) across repeated successful creates', () => {
      const jsx = addingGroupJsxBlock()
      expect(jsx).toMatch(/\{addingGroup && \(/)
      // The ONLY place addingGroup is set false in this whole block is the
      // Escape branch and the Cancel button — never on successful submit.
      const setFalseCount = (jsx.match(/setAddingGroup\(false\)/g) ?? []).length
      expect(setFalseCount).toBe(2) // Escape handler + Cancel button, both explicit user-initiated exits
    })
  })

  describe('A3 — duplicate Enter/Add protection preserved', () => {
    it('the guard still checks groupSubmitting, and both Enter and the Add button route through the same submitNewGroup', () => {
      const b = submitNewGroupBlock()
      expect(b).toMatch(/if \(!trimmed \|\| groupSubmitting\) return;/)
      const jsx = addingGroupJsxBlock()
      expect(jsx).toMatch(/onKeyDown=\{e => \{ if \(e\.key === "Enter"\) submitNewGroup\(\);/)
      expect(jsx).toMatch(/<button onClick=\{submitNewGroup\}/)
    })
  })

  describe('A4/A5 — failed create retains value, retry works', () => {
    it('failure sets a safe error, clears submitting, and does NOT clear the name or close the flow', () => {
      const b = submitNewGroupBlock()
      const elseIdx = b.indexOf('} else {')
      const elseBranch = b.slice(elseIdx)
      expect(elseBranch).toMatch(/setGroupError\("Couldn't create group\. Try again\."\)/)
      expect(elseBranch).not.toMatch(/setGroupName\(""\)/)
      expect(elseBranch).not.toMatch(/setAddingGroup\(false\)/)
      expect(b).toMatch(/setGroupSubmitting\(false\);\s*if \(ok\)/) // submitting cleared before branching, for both outcomes
    })
  })

  describe('A6 — Escape exits creation, sends no POST', () => {
    it('Escape clears the name, clears the transient error, and closes addingGroup — without calling submitNewGroup/createGroup', () => {
      const jsx = addingGroupJsxBlock()
      const escIdx = jsx.indexOf('if (e.key === "Escape")')
      expect(escIdx).toBeGreaterThan(-1)
      const escBranch = jsx.slice(escIdx, jsx.indexOf('}', jsx.indexOf('}', escIdx) + 1) + 1)
      expect(escBranch).toMatch(/setGroupName\(""\)/)
      expect(escBranch).toMatch(/setGroupError\(null\)/)
      expect(escBranch).toMatch(/setAddingGroup\(false\)/)
      expect(escBranch).not.toMatch(/submitNewGroup\(\)/)
    })
  })

  describe('A7 — focus continuation after success', () => {
    it('a ref is attached to the group-name input and re-focused on confirmed success', () => {
      const b = submitNewGroupBlock()
      expect(b).toMatch(/groupNameInputRef\.current\?\.focus\(\);/)
      const jsx = addingGroupJsxBlock()
      expect(jsx).toMatch(/ref=\{groupNameInputRef\}/)
    })
  })
})

describe('B. inline item-name editing in the table', () => {
  describe('B1/B4 — ItemRow provides a direct rename UI wired to onUpdate', () => {
    it('uses InlineText, saving via onUpdate(item.id, { name: v })', () => {
      const rowBlock = itemRowBlock()
      expect(rowBlock).toMatch(/<InlineText\s*\n\s*value=\{item\.name\}\s*\n\s*onSave=\{v => onUpdate\(item\.id, \{ name: v \}\)\}/)
    })
  })

  describe('B2 — correct SaveStatus key', () => {
    it('wires status={saveStatus[`item:${item.id}:name`]}', () => {
      const rowBlock = itemRowBlock()
      expect(rowBlock).toMatch(/status=\{saveStatus\[`item:\$\{item\.id\}:name`\]\}/)
    })
  })

  describe('B3 — drawer-open path preserved', () => {
    it('a click on the item name still calls onOpenDrawer(item)', () => {
      const rowBlock = itemRowBlock()
      expect(rowBlock).toMatch(/onClick=\{\(\) => onOpenDrawer\(item\)\}/)
      expect(rowBlock).toMatch(/title="Open details"/)
    })

    it('rename and drawer-open are distinct elements — the rename trigger is a separate <button>, not the same element as the drawer-open span', () => {
      const rowBlock = itemRowBlock()
      const triggerIdx = rowBlock.indexOf('renderTrigger={({ display, startEdit }) => (')
      expect(triggerIdx).toBeGreaterThan(-1)
      const triggerBlock = rowBlock.slice(triggerIdx, rowBlock.indexOf('/>', triggerIdx))
      expect(triggerBlock).toMatch(/onClick=\{\(\) => onOpenDrawer\(item\)\}/)
      expect(triggerBlock).toMatch(/onClick=\{startEdit\}/)
      // Two distinct onClick handlers within the trigger — never the same
      // element handling both.
      const onOpenIdx = triggerBlock.indexOf('onClick={() => onOpenDrawer(item)}')
      const onEditIdx = triggerBlock.indexOf('onClick={startEdit}')
      expect(onOpenIdx).not.toBe(-1)
      expect(onEditIdx).not.toBe(-1)
      expect(onOpenIdx).not.toBe(onEditIdx)
    })
  })

  describe('B5 — no direct fetch from the inline editor', () => {
    it('ItemRow never calls fetch(...) itself — only onUpdate/onDelete/onOpenDrawer/onToggleCollapse props', () => {
      const rowBlock = itemRowBlock()
      expect(rowBlock).not.toMatch(/fetch\(/)
    })
  })
})

describe('C. InlineText — generic dirty-draft protection', () => {
  describe('C1/C2 — render-time reconciliation gates on dirty, not merely on value change', () => {
    it('reconciles draft to the new authoritative value only when NOT dirty', () => {
      const b = inlineTextBlock()
      expect(b).toMatch(/if \(seenValue !== value\) \{\s*setSeenValue\(value\);\s*(?:\/\/[^\n]*\n\s*)*if \(!dirty\) setDraft\(value\);\s*\}/)
    })

    it('the old unconditional `useEffect(() => { setDraft(value) }, [value])` bug is gone', () => {
      expect(pageCode).not.toMatch(/useEffect\(\(\) => \{ setDraft\(value\); \}, \[value\]\);/)
    })
  })

  describe('C3 — Escape restores the LATEST authoritative value, not the value from edit start', () => {
    it('cancelEdit resets draft from the current `value` prop (not a captured edit-start snapshot) and issues no save', () => {
      const b = inlineTextBlock()
      const fnBlock = block('function cancelEdit(', '\n\n  if (!editing)')
      expect(fnBlock).toMatch(/setDraft\(value\);/)
      expect(fnBlock).toMatch(/setDirty\(false\);/)
      expect(fnBlock).toMatch(/setEditing\(false\);/)
      expect(fnBlock).not.toMatch(/onSave/)
      void b
    })

    it('Escape calls cancelEdit, never commitEdit', () => {
      const b = inlineTextBlock()
      expect(b).toMatch(/if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); cancelEdit\(\); \}/)
    })
  })

  describe('C5/C6 — Enter and blur both commit exactly once, never twice', () => {
    it('Enter only blurs the input — onSave is invoked solely from the single onBlur=commitEdit handler', () => {
      const b = inlineTextBlock()
      expect(b).toMatch(/if \(e\.key === "Enter"\) \{ \(e\.target as HTMLInputElement\)\.blur\(\); \}/)
      expect(b).toMatch(/onBlur=\{commitEdit\}/)
      // onSave appears in exactly one place: inside commitEdit.
      const onSaveMatches = b.match(/onSave\(draft\)/g) ?? []
      expect(onSaveMatches).toHaveLength(1)
    })
  })

  describe('C7 — Escape never saves', () => {
    it('cancelEdit contains no call to onSave', () => {
      const fnBlock = block('function cancelEdit(', '\n\n  if (!editing)')
      expect(fnBlock).not.toMatch(/onSave/)
    })
  })

  describe('C8 — unchanged value does not write', () => {
    it('commitEdit only calls onSave when draft actually differs from the authoritative value', () => {
      const fnBlock = block('function commitEdit(', '\n  function cancelEdit(')
      expect(fnBlock).toMatch(/if \(draft !== value\) onSave\(draft\);/)
    })
  })

  describe('C9 — protection is generic, not special-cased to item name', () => {
    it('every real call site (group name, drawer item name, table item name, board name, custom text column) shares the same InlineText component — no parallel/duplicated implementation', () => {
      const callSites = pageCode.match(/<InlineText\b/g) ?? []
      // CustomCell (text column), group name, drawer item name, board name,
      // and the new table item-name cell — five real usages of ONE component.
      expect(callSites.length).toBe(5)
    })

    it('the dirty-draft state (dirty/seenValue) lives inside InlineText itself, not duplicated per call site', () => {
      const b = inlineTextBlock()
      expect(b).toMatch(/const \[dirty, setDirty\] = useState\(false\);/)
      expect(b).toMatch(/const \[seenValue, setSeenValue\] = useState\(value\);/)
    })
  })
})
