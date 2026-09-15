import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// D.4.7B — Organiser mutation reliability + save-state foundation.
// Static source-text containment only — this repo has no jsdom/React
// Testing Library harness (see AGENTS.md/CLAUDE.md and every other
// containment test file's own note). Each block-scoped assertion below
// is mutation-proofed in review (temporarily reverted, confirmed the
// corresponding test fails, restored) per the phase's own load-bearing-
// proof requirement.
//
// Scope, per D.4.7B's own instructions: updateItem, addItem, createGroup,
// renameGroup, deleteGroup, deleteItem, AddItemRow, and the +New group
// UI. Board/column mutations (createBoard, addColumn, etc.) share the
// identical pre-existing silent-failure pattern but are deliberately
// left untouched — out of this phase's named scope, not overlooked.

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

const updateItemBlock = () => block('async function updateItem(', '\n  async function deleteItem(')
const addItemBlock = () => block('async function addItem(', '\n  async function updateItem(')
const groupMutationsBlock = () => block('async function createGroup(', '\n  async function addItem(')
const deleteItemBlock = () => block('async function deleteItem(', '\n  async function addColumn(')
const loadBoardDataBlock = () => block('const loadBoardData = useCallback(', '\n  useEffect(() => { loadBoards(); }')
const addItemRowBlock = () => block('function AddItemRow(', '\nfunction AddColumnButton(')
const submitNewGroupBlock = () => block('async function submitNewGroup(', '\n  const groupNamesById')

describe('updateItem — response handling (A, B, F)', () => {
  it('inspects res.ok and treats non-2xx as failure, not just a resolved promise', () => {
    const b = updateItemBlock()
    expect(b).toMatch(/ok\s*=\s*res\.ok/)
    expect(b).toMatch(/if\s*\(!ok\)\s*\{/)
  })

  it('catches a thrown network error rather than letting it propagate unhandled', () => {
    const b = updateItemBlock()
    expect(b).toMatch(/try\s*\{[\s\S]*?fetch\(`\/api\/organiser\/items\/\$\{id\}`/)
    expect(b).toMatch(/catch\s*\{\s*ok\s*=\s*false;?\s*\}/)
  })

  it('shows a visible, non-raw error message on failure, never a raw server error', () => {
    const b = updateItemBlock()
    expect(b).toMatch(/markError\(statusKey, "Couldn't save\. Your previous value was restored\."\)/)
  })
})

describe('updateItem — field-scoped optimistic rollback (A, B)', () => {
  it('snapshots only the exact patched fields before the optimistic merge, not the whole item', () => {
    const b = updateItemBlock()
    expect(b).toMatch(/const patchKeys = Object\.keys\(patch\)/)
    expect(b).toMatch(/for \(const k of patchKeys\) \(prevSnapshot as Record<string, unknown>\)\[k\] = /)
  })

  it('restores exactly the snapshotted fields on failure, in both boardData and drawerItem', () => {
    const b = updateItemBlock()
    expect(b).toMatch(/if \(prevSnapshot\) \{/)
    expect(b).toMatch(/items: prev\.items\.map\(i => i\.id === id \? \(\{ \.\.\.i, \.\.\.snap \} as OrganiserItem\) : i\)/)
    expect(b).toMatch(/setDrawerItem\(prev => prev && prev\.id === id \? \(\{ \.\.\.prev, \.\.\.snap \} as OrganiserItem\) : prev\)/)
  })

  it('never rolls back the whole board — only this item is touched in the rollback branch', () => {
    const b = updateItemBlock()
    // The rollback branch's setBoardData call must map over existing items
    // and only replace the matching id, never replace the items array wholesale.
    const rollbackRegionStart = b.indexOf('if (!ok) {')
    const rollbackRegion = b.slice(rollbackRegionStart, rollbackRegionStart + 400)
    expect(rollbackRegion).toMatch(/prev\.items\.map\(/)
    expect(rollbackRegion).not.toMatch(/items:\s*\[/)
  })
})

describe('updateItem — save-state visibility (D, E)', () => {
  it('marks saving before the request and saved after a successful one', () => {
    const b = updateItemBlock()
    expect(b).toMatch(/markSaving\(statusKey\)/)
    expect(b).toMatch(/markSaved\(statusKey\)/)
    // saving must be called before the fetch, saved only after success is confirmed
    expect(b.indexOf('markSaving(statusKey)')).toBeLessThan(b.indexOf('fetch(`/api/organiser/items/${id}`'))
    expect(b.indexOf('markSaved(statusKey)')).toBeGreaterThan(b.indexOf('if (!ok) {'))
  })
})

describe('updateItem — concurrency / stale-response protection (H)', () => {
  it('claims a per-item-per-field sequence number before the optimistic update, and re-checks it after the request settles', () => {
    const b = updateItemBlock()
    expect(b).toMatch(/const fieldKey = Object\.keys\(patch\)\.sort\(\)\.join\(","\)/)
    expect(b).toMatch(/const statusKey = `item:\$\{id\}:\$\{fieldKey\}`/)
    expect(b).toMatch(/const mySeq = \(itemOpSeqRef\.current\[statusKey\] \?\? 0\) \+ 1/)
    expect(b).toMatch(/itemOpSeqRef\.current\[statusKey\] = mySeq/)
  })

  it('discards a stale settled request — skips rollback/save-state/reload if a newer edit to the same item+field has since started', () => {
    const b = updateItemBlock()
    expect(b).toMatch(/if \(itemOpSeqRef\.current\[statusKey\] !== mySeq\) return;/)
    // the guard must appear AFTER the fetch settles and BEFORE any rollback/markSaved/reload
    const guardIdx = b.indexOf('if (itemOpSeqRef.current[statusKey] !== mySeq) return;')
    expect(guardIdx).toBeGreaterThan(b.indexOf('} catch {\n      ok = false;\n    }'))
    expect(guardIdx).toBeLessThan(b.indexOf('markSaved(statusKey)'))
  })

  it('keys the sequence guard by item+field, not by item alone — editing one field must never invalidate a concurrent edit to a different field on the same item', () => {
    const b = updateItemBlock()
    // statusKey embeds fieldKey, and itemOpSeqRef is indexed by statusKey (not bare id)
    expect(b).not.toMatch(/itemOpSeqRef\.current\[id\]/)
    expect(b).toMatch(/itemOpSeqRef\.current\[statusKey\]/)
  })
})

describe('updateItem — reconciliation on success (C)', () => {
  it('triggers an authoritative board reload only after a confirmed, still-current success', () => {
    const b = updateItemBlock()
    const savedIdx = b.indexOf('markSaved(statusKey)')
    const reloadIdx = b.indexOf('if (activeId) loadBoardData(activeId)')
    expect(savedIdx).toBeGreaterThan(-1)
    expect(reloadIdx).toBeGreaterThan(savedIdx)
  })
})

describe('loadBoardData — reload-ordering protection (H, shared foundation)', () => {
  it('claims a monotonic sequence number per call and discards a response if a newer load has since started', () => {
    const b = loadBoardDataBlock()
    expect(b).toMatch(/const seq = \+\+boardLoadSeqRef\.current/)
    expect(b).toMatch(/if \(boardLoadSeqRef\.current !== seq\) return;/)
  })

  it('guards both the not-ok branch and the success branch — a stale failed load cannot null out fresher board state, and a stale successful load cannot overwrite it either', () => {
    const b = loadBoardDataBlock()
    const guardCount = (b.match(/if \(boardLoadSeqRef\.current !== seq\) return;/g) ?? []).length
    expect(guardCount).toBeGreaterThanOrEqual(2)
  })

  it('catches a thrown network error rather than leaving it unhandled', () => {
    const b = loadBoardDataBlock()
    expect(b).toMatch(/try\s*\{[\s\S]*?fetch\(`\/api\/organiser\/boards\/\$\{boardId\}`/)
    expect(b).toMatch(/catch\s*\{\s*return;\s*\}/)
  })
})

describe('addItem — duplicate-create protection (I, J)', () => {
  it('addItem itself reports success/failure via a boolean return, never assumed', () => {
    const b = addItemBlock()
    expect(b).toMatch(/async function addItem\([^)]*\): Promise<boolean>/)
    expect(b).toMatch(/if \(!res\.ok\) return false;/)
    expect(b).toMatch(/return true;/)
  })

  it('AddItemRow guards against duplicate submission with an in-flight flag checked before every submit', () => {
    const b = addItemRowBlock()
    expect(b).toMatch(/const \[submitting, setSubmitting\] = useState\(false\)/)
    expect(b).toMatch(/if \(!trimmed \|\| submitting\) return;/)
    expect(b).toMatch(/setSubmitting\(true\)/)
    expect(b).toMatch(/setSubmitting\(false\)/)
  })

  it('only clears the input on confirmed success — a failed create restores/keeps the typed name for retry', () => {
    const b = addItemRowBlock()
    const ifStart = b.indexOf('if (ok) {')
    const elseStart = b.indexOf('} else {', ifStart)
    const elseEnd = b.indexOf('\n    }', elseStart)
    const okBranch = b.slice(ifStart, elseStart)
    const failBranch = b.slice(elseStart, elseEnd)
    expect(okBranch).toMatch(/setValue\(""\)/)
    expect(okBranch).not.toMatch(/setError\(/)
    expect(failBranch).toMatch(/setError\("Couldn't create item\. Try again\."\)/)
    expect(failBranch).not.toMatch(/setValue\(""\)/)
  })

  it('the input is disabled while submitting, so key-repeat cannot fire a second overlapping submit', () => {
    const b = addItemRowBlock()
    expect(b).toMatch(/disabled=\{submitting\}/)
  })
})

describe('createGroup / +New group UI — duplicate-create protection (I, J, K)', () => {
  it('createGroup reports success/failure via a boolean return', () => {
    const b = groupMutationsBlock()
    expect(b).toMatch(/async function createGroup\(name: string\): Promise<boolean>/)
    expect(b).toMatch(/if \(!res\.ok\) return false;/)
  })

  it('submitNewGroup guards against duplicate submission the same way AddItemRow does (Enter AND the Add button both route through it)', () => {
    const b = submitNewGroupBlock()
    expect(b).toMatch(/if \(!trimmed \|\| groupSubmitting\) return;/)
    expect(b).toMatch(/setGroupSubmitting\(true\)/)
    expect(b).toMatch(/setGroupSubmitting\(false\)/)
  })

  it('a failed group create surfaces a visible error and keeps the add-group UI open with the typed name intact for retry', () => {
    const b = submitNewGroupBlock()
    const elseStart = b.indexOf('} else {')
    const elseEnd = b.indexOf('\n  }', elseStart)
    const failBranch = b.slice(elseStart, elseEnd)
    expect(failBranch).toMatch(/setGroupError\("Couldn't create group\. Try again\."\)/)
    expect(failBranch).not.toMatch(/setAddingGroup\(false\)/)
    expect(failBranch).not.toMatch(/setGroupName\(""\)/)
  })
})

describe('renameGroup / deleteGroup — group mutation safety (K)', () => {
  it('renameGroup inspects res.ok and surfaces a visible error instead of silently appearing to succeed', () => {
    const b = groupMutationsBlock()
    const renameBlock = b.slice(b.indexOf('async function renameGroup('), b.indexOf('async function deleteGroup('))
    expect(renameBlock).toMatch(/ok\s*=\s*res\.ok/)
    expect(renameBlock).toMatch(/if \(!ok\) \{\s*markError\(key, "Couldn't rename group\."\);\s*return;\s*\}/)
    expect(renameBlock).toMatch(/markSaved\(key\)/)
  })

  it('deleteGroup inspects res.ok and surfaces a visible error instead of silently appearing to succeed', () => {
    const b = groupMutationsBlock()
    const deleteBlock = b.slice(b.indexOf('async function deleteGroup('))
    expect(deleteBlock).toMatch(/ok\s*=\s*res\.ok/)
    expect(deleteBlock).toMatch(/if \(!ok\) \{\s*showPageNotice\("Couldn't delete group\. Try again\."\);\s*return;\s*\}/)
  })

  it('deleteGroup still confirms before deleting — this phase does not remove the existing confirmation', () => {
    const b = groupMutationsBlock()
    expect(b).toMatch(/confirm\("Delete this group\? Its items will move to/)
  })
})

describe('deleteItem — mutation safety (K)', () => {
  it('inspects res.ok and surfaces a visible error instead of silently appearing to succeed', () => {
    const b = deleteItemBlock()
    expect(b).toMatch(/ok\s*=\s*res\.ok/)
    expect(b).toMatch(/if \(!ok\) \{\s*showPageNotice\("Couldn't delete item\. Try again\."\);\s*return;\s*\}/)
  })

  it('only closes the drawer / reloads the board after a confirmed successful delete', () => {
    const b = deleteItemBlock()
    const guardIdx = b.indexOf('showPageNotice("Couldn\'t delete item. Try again.")')
    const closeIdx = b.indexOf('setDrawerItem(prev => prev && prev.id === id ? null : prev)')
    expect(closeIdx).toBeGreaterThan(guardIdx)
  })
})

describe('save-state model — no cross-item/field clobbering, auto-clear (G)', () => {
  it('saveStatus is a single keyed store, and markSaved schedules its own guarded auto-clear back to idle', () => {
    expect(pageCode).toMatch(/const \[saveStatus, setSaveStatus\] = useState<Record<string, SaveStatus>>\(\{\}\)/)
    expect(pageCode).toMatch(/function markSaved\(key: string\) \{/)
    expect(pageCode).toMatch(/prev\[key\]\?\.state === "saved" \? \{ \.\.\.prev, \[key\]: \{ state: "idle" \} \} : prev/)
  })

  it('markError overwrites the specific key only, so a later success/retry on that same key clears the error (markSaving/markSaved both replace the same key)', () => {
    expect(pageCode).toMatch(/function markSaving\(key: string\) \{\s*setSaveStatus\(prev => \(\{ \.\.\.prev, \[key\]: \{ state: "saving" \} \}\)\);/)
  })
})

describe('scope boundary — Notes/Owner deliberately not wired to visible save-state this phase', () => {
  it('the Notes Field usage does not yet receive a status prop (explicitly deferred to D.4.7C)', () => {
    const start = pageCode.indexOf('<Field label="Notes">')
    expect(start).toBeGreaterThan(-1)
    expect(pageCode.slice(start, start + 30)).not.toMatch(/status=/)
  })
})
