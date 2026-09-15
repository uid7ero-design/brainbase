import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// D.4.7B / D.4.7B-R1 — Organiser mutation reliability + save-state
// foundation, hardened for deterministic server write ordering.
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
//
// D.4.7B-R1 replaced updateItem's client-only response-sequence guard
// (itemOpSeqRef) with a per item+field coalescing send queue
// (enqueueCoalesced, lib/organiser/coalescingMutationQueue.ts) so that
// server COMMIT order — not just client display order — matches the
// user's intended edit order. The actual concurrency/ordering GUARANTEE
// is proven with real executed async/await in
// tests/containment/coalescingMutationQueue.test.ts (this repo's only
// pure, dependency-free module able to be tested that way); the tests
// below prove updateItem is correctly WIRED to that primitive, which is
// all static source-text containment can honestly claim to prove.

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
// D.4.7B-R1 — the three helpers inserted immediately before updateItem
// (applyOptimisticItemPatch, restoreItemFields, readCurrentItemFields).
// Markers are code tokens only (not comments) since pageCode has all
// comments stripped already.
const restoreItemFieldsBlock = () => block('function restoreItemFields(', '\n  function readCurrentItemFields(')
const readCurrentItemFieldsBlock = () => block('function readCurrentItemFields(', '\n  async function updateItem(')

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
  it('captures the current (pre-optimistic-patch) values of only the exact patched fields, once per mutation chain', () => {
    const b = updateItemBlock()
    expect(b).toMatch(/const patchKeys = Object\.keys\(patch\)/)
    expect(b).toMatch(/if \(confirmedBase === null\) confirmedBase = readCurrentItemFields\(id, patchKeys\);/)
    // readCurrentItemFields itself only copies the requested keys, never the whole item.
    const rb = readCurrentItemFieldsBlock()
    expect(rb).toMatch(/for \(const k of keys\) out\[k\] = /)
    expect(rb).not.toMatch(/\.\.\.source/)
  })

  it('restores exactly the last server-confirmed fields on failure, in both boardData and drawerItem', () => {
    const b = updateItemBlock()
    expect(b).toMatch(/restoreItemFields\(id, confirmedBase as Record<string, unknown>\);/)
    // restoreItemFields itself is the thing that touches boardData/drawerItem.
    const rb = restoreItemFieldsBlock()
    expect(rb).toMatch(/items: prev\.items\.map\(i => i\.id === id \? \(\{ \.\.\.i, \.\.\.snapshot \} as OrganiserItem\) : i\)/)
    expect(rb).toMatch(/setDrawerItem\(prev => prev && prev\.id === id \? \(\{ \.\.\.prev, \.\.\.snapshot \} as OrganiserItem\) : prev\)/)
  })

  it('never rolls back the whole board — restoreItemFields only ever maps over existing items, never replaces the array wholesale', () => {
    const rb = restoreItemFieldsBlock()
    expect(rb).toMatch(/prev\.items\.map\(/)
    expect(rb).not.toMatch(/items:\s*\[/)
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

describe('updateItem — D.4.7B-R1 server-ordering protection via a per item+field coalescing queue (H)', () => {
  it('routes every write through enqueueCoalesced keyed by item+field (statusKey), replacing the old client-only response-sequence guard entirely', () => {
    const b = updateItemBlock()
    expect(b).toMatch(/const fieldKey = Object\.keys\(patch\)\.sort\(\)\.join\(","\)/)
    expect(b).toMatch(/const statusKey = `item:\$\{id\}:\$\{fieldKey\}`/)
    expect(b).toMatch(/await enqueueCoalesced\(itemFieldQueueRef\.current, statusKey, patch, async \(value, hasNewerPending\) => \{/)
    // the old response-sequence-number guard must be fully gone from the
    // whole file, not merely absent from this block — it is superseded,
    // not layered alongside enqueueCoalesced.
    expect(pageCode).not.toMatch(/itemOpSeqRef/)
  })

  it('dispatches the fetch itself INSIDE the coalesced callback, not before enqueueCoalesced is called — this is what actually guarantees at most one in-flight PATCH per item+field', () => {
    const b = updateItemBlock()
    const enqueueIdx = b.indexOf('await enqueueCoalesced(itemFieldQueueRef.current, statusKey, patch, async (value, hasNewerPending) => {')
    const fetchIdx = b.indexOf('fetch(`/api/organiser/items/${id}`', enqueueIdx)
    expect(enqueueIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeGreaterThan(enqueueIdx)
  })

  it('gates BOTH the failure-rollback branch and the success-finalize branch on hasNewerPending() — an intermediate step in a coalesced chain never rolls back or reports Saved on behalf of a value a newer edit is about to supersede', () => {
    const b = updateItemBlock()
    expect(b).toMatch(/if \(!ok\) \{\s*if \(!hasNewerPending\(\)\) \{\s*restoreItemFields\(id, confirmedBase as Record<string, unknown>\);\s*markError\(statusKey, "Couldn't save\. Your previous value was restored\."\);\s*\}/)
    expect(b).toMatch(/if \(!hasNewerPending\(\)\) \{\s*markSaved\(statusKey\);\s*if \(activeId\) loadBoardData\(activeId\);\s*\}/)
  })

  it('keys the coalescing queue by item+field, not by item alone — a concurrent edit to a different field on the same item uses a different queue key entirely', () => {
    const b = updateItemBlock()
    expect(b).not.toMatch(/itemFieldQueueRef\.current\[id\]/)
    expect(b).toMatch(/statusKey = `item:\$\{id\}:\$\{fieldKey\}`/)
    // itemFieldQueueRef is declared as a map (Record<string, ...>) keyed by
    // whatever string enqueueCoalesced is called with — proven independently,
    // for real, by coalescingMutationQueue.test.ts's own "different fields on
    // the SAME item never block each other" test.
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
