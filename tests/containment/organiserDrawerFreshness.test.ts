import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// D.4.7C — drawer freshness + Notes autosave. Static source-text
// containment only — this repo has no jsdom/React Testing Library harness
// (see AGENTS.md/CLAUDE.md and every other containment test file's own
// note). The Notes debounce/coalescing TIMING guarantees are proven with
// real executed async/await + fake timers in
// tests/containment/organiserNotesAutosave.test.ts (createNotesAutosaveTimer
// is pure, dependency-free TypeScript, unlike this React page); this file
// proves the SOURCE wiring — that ItemDrawer is actually built on that
// primitive and on boardData-derived state the way the phase requires.
//
// Root cause this phase fixed: before D.4.7C, the open drawer held its own
// separate `drawerItem` copy, patched in parallel by applyOptimisticItemPatch/
// restoreItemFields alongside boardData. Server-side changes (or even this
// client's own loadBoardData() reload) never touched that separate copy,
// and ItemActivity's own `${item.id}:${item.updated_at}` refresh key never
// changed because drawerItem.updated_at was frozen at drawer-open time —
// so Activity silently never refreshed while the drawer stayed open. D.4.7C
// removed the separate copy entirely: the open item is now looked up fresh
// from boardData.items on every render.

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

const itemDrawerBlock = () => block('function ItemDrawer(', '\nfunction Field(')

describe('drawer source of truth — openDrawerItemId + derived openItem, no separate drawerItem copy (1, 2)', () => {
  it('the open drawer is tracked by id only, never a separately-held item object', () => {
    expect(pageCode).toMatch(/const \[openDrawerItemId, setOpenDrawerItemId\] = useState<string \| null>\(null\)/)
    expect(pageCode).not.toMatch(/const \[drawerItem, setDrawerItem\]/)
  })

  it('the item the drawer renders is derived fresh from boardData.items every render, not a stored snapshot', () => {
    expect(pageCode).toMatch(/const openItem = boardData\?\.items\.find\(i => i\.id === openDrawerItemId\) \?\? null;/)
    // The <ItemDrawer> render site is gated on and fed this SAME derived
    // value — never a separate drawerItem.
    const idx = pageCode.indexOf('{openItem && (')
    expect(idx).toBeGreaterThan(-1)
    const renderBlock = pageCode.slice(idx, idx + 250)
    expect(renderBlock).toMatch(/<ItemDrawer item=\{openItem\}/)
    expect(renderBlock).toMatch(/onClose=\{\(\) => setOpenDrawerItemId\(null\)\}/)
  })

  it('a boardData refresh therefore propagates into the open drawer automatically — applyOptimisticItemPatch/restoreItemFields touch ONLY boardData, no second write site', () => {
    const applyBlock = block('function applyOptimisticItemPatch(', '\n  function restoreItemFields(')
    const restoreBlock = block('function restoreItemFields(', '\n  function readCurrentItemFields(')
    expect(applyBlock).not.toMatch(/setDrawerItem/)
    expect(restoreBlock).not.toMatch(/setDrawerItem/)
    expect(pageCode).not.toMatch(/setDrawerItem/)
  })

  it('ItemActivity is keyed by the derived item\'s own id+updated_at, which now genuinely changes after every mutation-triggered reload', () => {
    const drawerBlock = itemDrawerBlock()
    expect(drawerBlock).toMatch(/<ItemActivity key=\{`\$\{item\.id\}:\$\{item\.updated_at\}`\}/)
  })
})

describe('Notes — local draft decoupled from item.notes (3, 4)', () => {
  it('the textarea renders ONLY the local draft, never item.notes directly, and routes typing through handleNotesChange (not a direct onUpdate call)', () => {
    const drawerBlock = itemDrawerBlock()
    const fieldIdx = drawerBlock.indexOf('<Field label="Notes"')
    const textareaBlock = drawerBlock.slice(fieldIdx, fieldIdx + 400)
    expect(textareaBlock).toMatch(/value=\{notesDraft\}/)
    expect(textareaBlock).toMatch(/onChange=\{e => handleNotesChange\(e\.target\.value\)\}/)
    expect(textareaBlock).not.toMatch(/value=\{item\.notes/)
    expect(textareaBlock).not.toMatch(/onChange=\{e => onUpdate\(item\.id, \{ notes:/)
  })

  it('a dirty draft is never overwritten by an authoritative item.notes refresh — the render-time reconciliation branch gates on !notesDirty', () => {
    const drawerBlock = itemDrawerBlock()
    const idx = drawerBlock.indexOf('} else if (notesSeenValue !== (item.notes ?? "")) {')
    expect(idx).toBeGreaterThan(-1)
    const block2 = drawerBlock.slice(idx, idx + 250)
    expect(block2).toMatch(/if \(!notesDirty\) setNotesDraft\(item\.notes \?\? ""\);/)
  })

  it('a CLEAN draft DOES reconcile from an authoritative item.notes refresh (same effect, positive case — not merely gated, actually assigns)', () => {
    const drawerBlock = itemDrawerBlock()
    expect(drawerBlock).toMatch(/if \(!notesDirty\) setNotesDraft\(item\.notes \?\? ""\);/)
  })

  it('dirty is cleared only via the generic saveStatus reaching "saved" for this exact key — not by onUpdate\'s own return value (which resolves early for a coalesced-away call and can\'t be trusted)', () => {
    const drawerBlock = itemDrawerBlock()
    expect(drawerBlock).toMatch(/const notesSaveState = saveStatus\[notesKey\]\?\.state;/)
    expect(drawerBlock).toMatch(/if \(notesSaveState === "saved"\) setNotesDirty\(false\);/)
  })

  it('unchanged Notes (draft returns to the authoritative value) cancel any pending timer and clear dirty without sending', () => {
    const fnBlock = block('function handleNotesChange(', '\n  function flushNotesNow(')
    expect(fnBlock).toMatch(/if \(value === \(item\.notes \?\? ""\)\) \{/)
    expect(fnBlock).toMatch(/notesAutosave\.cancel\(\);\s*setNotesDirty\(false\);\s*return;/)
  })
})

describe('Notes — debounce + blur flush wired to the real autosave primitive (matches organiserNotesAutosave.test.ts\'s own proofs)', () => {
  it('schedules via createNotesAutosaveTimer at 800ms, calling the real onUpdate/item-field path on fire — not a parallel fetch implementation', () => {
    expect(pageCode).toMatch(/createNotesAutosaveTimer<string>\(\s*\(itemId, value\) => onUpdate\(itemId, \{ notes: value \}\),\s*\{ debounceMs: 800 \},\s*\)/)
  })

  it('onBlur flushes the pending draft immediately via the same flush path used elsewhere (item switch / drawer close)', () => {
    const drawerBlock = itemDrawerBlock()
    const fieldIdx = drawerBlock.indexOf('<Field label="Notes"')
    const textareaBlock = drawerBlock.slice(fieldIdx, fieldIdx + 400)
    expect(textareaBlock).toMatch(/onBlur=\{flushNotesNow\}/)
    const flushBlock = block('function flushNotesNow(', '\n  async function uploadFile(')
    expect(flushBlock).toMatch(/notesAutosave\.cancel\(\);/)
    expect(flushBlock).toMatch(/onUpdate\(pending\.itemId, \{ notes: pending\.value \}\);/)
  })

  it('the notes save-state key is item:<id>:notes, matching every other field\'s convention', () => {
    expect(pageCode).toMatch(/const notesKey = `item:\$\{item\.id\}:notes`;/)
  })
})

describe('item switch safety — new item initializes correctly, stale prior item cannot leak in (5, 6)', () => {
  it('switching the open item resets the draft/dirty state synchronously during render, keyed by comparison state (not a ref — this repo\'s lint config flags ref reads during render)', () => {
    const drawerBlock = itemDrawerBlock()
    const idx = drawerBlock.indexOf('if (notesSeenItemId !== item.id) {')
    expect(idx).toBeGreaterThan(-1)
    const guardBlock = drawerBlock.slice(idx, idx + 250)
    expect(guardBlock).toMatch(/setNotesSeenItemId\(item\.id\);/)
    expect(guardBlock).toMatch(/setNotesDraft\(item\.notes \?\? ""\);/)
    expect(guardBlock).toMatch(/setNotesDirty\(false\);/)
  })

  it('the flush-on-switch/close effect fires the CAPTURED (pending.itemId, pending.value) pair from the timer, never this render\'s own live `item` — so a stale prior item\'s draft can only ever be sent to that same prior item, never to whatever is now open', () => {
    const flushEffectStart = pageCode.indexOf('useEffect(() => {\n    return () => {\n      const pending = notesAutosave.peek();')
    expect(flushEffectStart).toBeGreaterThan(-1)
    const flushEffectBlock = pageCode.slice(flushEffectStart, flushEffectStart + 400)
    expect(flushEffectBlock).toMatch(/onUpdate\(pending\.itemId, \{ notes: pending\.value \}\);/)
    expect(flushEffectBlock).not.toMatch(/onUpdate\(item\.id,/)
    expect(flushEffectBlock).toMatch(/\}, \[item\.id\]\);/)
  })
})

describe('comments (Updates) / attachments (Files) — existing independent fetch state, invalidate-on-success (F)', () => {
  it('successful comment create appends the new comment via local state — no drawer/board reload needed to see it', () => {
    const fnBlock = block('async function addUpdate(', '\n  const drawerContent = (')
    expect(fnBlock).toMatch(/setUpdates\(prev => \[d\.update, \.\.\.prev\]\);/)
  })

  it('a failed comment create no longer fakes success — it surfaces a visible error and does NOT clear the user\'s typed text (D.4.7C fix)', () => {
    const fnBlock = block('async function addUpdate(', '\n  const drawerContent = (')
    expect(fnBlock).toMatch(/if \(!res\.ok \|\| !d\.update\) \{\s*setUpdateError\(`Couldn't post update \(\$\{res\.status\}\)\.`\);\s*return;\s*\}/)
    expect(fnBlock).toMatch(/catch \{\s*setUpdateError\("Couldn't post update\. Check your connection and try again\."\);\s*\}/)
    // setNewUpdate("") — clearing the input — must be reachable ONLY from
    // the success path, i.e. it appears strictly after the success-only
    // setUpdates call, never inside the two failure branches above.
    const successIdx = fnBlock.indexOf('setUpdates(prev => [d.update, ...prev]);')
    const clearIdx = fnBlock.indexOf('setNewUpdate("");')
    expect(clearIdx).toBeGreaterThan(successIdx)
  })

  it('the visible comment error is rendered next to the Post update control', () => {
    const drawerBlock = itemDrawerBlock()
    const idx = drawerBlock.indexOf('Post update</button>')
    const nearby = drawerBlock.slice(idx, idx + 200)
    expect(nearby).toMatch(/\{updateError && \(/)
  })

  it('successful attachment upload/delete mutate local file state directly (append/filter) — no drawer/board reload storm', () => {
    const uploadBlock = block('async function uploadFile(', '\n  async function deleteFile(')
    const deleteBlock = block('async function deleteFile(', '\n  async function addUpdate(')
    expect(uploadBlock).toMatch(/setFiles\(prev => \[d\.file!, \.\.\.prev\]\);/)
    expect(deleteBlock).toMatch(/setFiles\(prev => prev\.filter\(f => f\.id !== fileId\)\);/)
  })

  it('a failed upload/delete shows a visible error and does not fabricate the file list', () => {
    const uploadBlock = block('async function uploadFile(', '\n  async function deleteFile(')
    const deleteBlock = block('async function deleteFile(', '\n  async function addUpdate(')
    expect(uploadBlock).toMatch(/setFileError\(d\.error \|\| `Upload failed \(\$\{res\.status\}\)\.`\);\s*return;/)
    expect(deleteBlock).toMatch(/setFileError\(`Couldn't delete file \(\$\{res\.status\}\)\.`\);\s*return;/)
  })

  it('files/updates fetch is keyed by item.id only — switching the open item refetches exactly once per switch, never once per keystroke or per field save', () => {
    const drawerBlock = itemDrawerBlock()
    const idx = drawerBlock.indexOf('useEffect(() => {\n    fetch(`/api/organiser/items/${item.id}/files`')
    expect(idx).toBeGreaterThan(-1)
    const effectBlock = drawerBlock.slice(idx, idx + 450)
    expect(effectBlock).toMatch(/\}, \[item\.id\]\);/)
  })
})
