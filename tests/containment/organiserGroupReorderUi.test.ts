import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.7E (Slice E2) — group reorder UI wiring. Static source-text
// containment only (this repo has no jsdom/RTL harness — see AGENTS.md/
// CLAUDE.md). The transaction/persistence correctness this UI calls into
// is proven separately in organiserReorderTransaction.integration.test.ts
// (real Postgres) and organiserGroupReorderRoute.test.ts (mocked route).
// This file only proves: the drag handle is a distinct hit target from
// every other GroupSection control, it's never rendered for the synthetic
// "No group" bucket, the optimistic-apply/rollback shape is present, and
// D.4.7B/C/D's own prior-phase surfaces are untouched by this addition.

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

const groupSectionBlock = () => block('function GroupSection(', '\nfunction ')
const reorderGroupsBlock = () => block('async function reorderGroups(', '\n  const [draggingGroupId')
const handleGroupDropBlock = () => block('function handleGroupDrop(', '\n  }')
const handleGroupDropAtEndBlock = () => block('function handleGroupDropAtEnd(', '\n  }')
const trailingDropZoneBlock = () => block('{boardData && boardData.groups.length > 0 && (', '\n                  {boardData && boardData.items.some(i => !i.group_id)')
const tableViewLoopBlock = () => block('{view === "table" && (', '{view === "board" && boardData && (')
const itemRowBlock = () => block('function ItemRow(', '\nfunction GroupSection(')
const inlineTextBlock = () => block('function InlineText(', '\nfunction CustomCell(')

describe('GroupSection drag handle', () => {
  it('only renders when onGroupDragHandleStart is supplied — omitted entirely for the synthetic "No group" bucket', () => {
    const b = groupSectionBlock()
    expect(b).toMatch(/\{onGroupDragHandleStart && \(/)
  })

  it('is draggable and has its own onDragStart — a distinct hit target from the collapse chevron', () => {
    const b = groupSectionBlock()
    const handleIdx = b.indexOf('{onGroupDragHandleStart && (')
    const chevronIdx = b.indexOf('onClick={() => setOpen(o => !o)}')
    expect(handleIdx).toBeGreaterThan(-1)
    expect(chevronIdx).toBeGreaterThan(handleIdx) // handle precedes the chevron in source order (left of it in the row)
    const handleRegion = b.slice(handleIdx, chevronIdx)
    expect(handleRegion).toMatch(/draggable/)
    expect(handleRegion).toMatch(/onDragStart=/)
  })

  it('has an accessible title and aria-label (minimum keyboard/screen-reader discoverability, per the D.4.7E discovery report\'s own recommendation)', () => {
    const b = groupSectionBlock()
    const handleIdx = b.indexOf('{onGroupDragHandleStart && (')
    const chevronIdx = b.indexOf('onClick={() => setOpen(o => !o)}')
    const handleRegion = b.slice(handleIdx, chevronIdx)
    expect(handleRegion).toMatch(/title="Drag to reorder"/)
    expect(handleRegion).toMatch(/aria-label="Reorder group"/)
  })

  it('onDragStart calls onGroupDragHandleStart() — never mutates state directly inside GroupSection itself (ordering decisions live in the parent, which owns boardData)', () => {
    const b = groupSectionBlock()
    const handleIdx = b.indexOf('{onGroupDragHandleStart && (')
    const chevronIdx = b.indexOf('onClick={() => setOpen(o => !o)}')
    const handleRegion = b.slice(handleIdx, chevronIdx)
    expect(handleRegion).toMatch(/onGroupDragHandleStart\(\)/)
  })
})

describe('parent render loop — drag wiring scoped to real groups only', () => {
  it('each real group is wrapped in its own onDragOver/onDrop target and passes onGroupDragHandleStart', () => {
    const loop = tableViewLoopBlock()
    const mapIdx = loop.indexOf('boardData?.groups.map(g =>')
    const noGroupIdx = loop.indexOf('group={null}')
    expect(mapIdx).toBeGreaterThan(-1)
    expect(noGroupIdx).toBeGreaterThan(mapIdx)
    const realGroupRegion = loop.slice(mapIdx, noGroupIdx)
    expect(realGroupRegion).toMatch(/onDragOver=/)
    expect(realGroupRegion).toMatch(/onDrop=\{e => \{ e\.preventDefault\(\); handleGroupDrop\(g\.id\); \}\}/)
    expect(realGroupRegion).toMatch(/onGroupDragHandleStart=\{\(\) => setDraggingGroupId\(g\.id\)\}/)
  })

  it('the "No group" GroupSection instance receives no onGroupDragHandleStart prop at all', () => {
    const loop = tableViewLoopBlock()
    const noGroupIdx = loop.indexOf('group={null}')
    const afterNoGroup = loop.slice(noGroupIdx, noGroupIdx + 700)
    expect(afterNoGroup).not.toMatch(/onGroupDragHandleStart/)
  })
})

describe('reorderGroups — optimistic apply before network, coalesced, rollback on failure, reload on stale 409', () => {
  it('applies the new order to boardData optimistically BEFORE the network call is made', () => {
    const b = reorderGroupsBlock()
    const setBoardDataIdx = b.indexOf('setBoardData(prev =>')
    const enqueueIdx = b.indexOf('enqueueCoalesced(')
    expect(setBoardDataIdx).toBeGreaterThan(-1)
    expect(enqueueIdx).toBeGreaterThan(setBoardDataIdx)
  })

  it('uses enqueueCoalesced (not a bare fetch) keyed by board:<id>:group-order', () => {
    const b = reorderGroupsBlock()
    expect(b).toMatch(/enqueueCoalesced\(reorderQueueRef\.current, key,/)
    expect(b).toMatch(/`board:\$\{activeId\}:group-order`/)
  })

  it('a 409 response triggers a full board reload, never a local-snapshot rollback', () => {
    const b = reorderGroupsBlock()
    const status409Idx = b.indexOf('res.status === 409')
    expect(status409Idx).toBeGreaterThan(-1)
    const branch = b.slice(status409Idx, status409Idx + 150)
    expect(branch).toMatch(/loadBoardData\(activeId\)/)
  })

  it('any other failure restores the last CONFIRMED order, not merely the immediately-prior optimistic state', () => {
    const b = reorderGroupsBlock()
    expect(b).toMatch(/let confirmedOrder: string\[\] \| null = null;/)
    expect(b).toMatch(/if \(confirmedOrder === null\) confirmedOrder = preDragGroups\.map\(g => g\.id\);/)
    const restoreIdx = b.indexOf("showPageNotice(\"Couldn't save group order")
    expect(restoreIdx).toBeGreaterThan(-1)
    const restoreRegion = b.slice(restoreIdx, restoreIdx + 400)
    expect(restoreRegion).toMatch(/const restoreTo = confirmedOrder;/)
  })

  it('a successful response reconciles positions from the authoritative server order, and updates confirmedOrder for any LATER failure in the same coalesced chain', () => {
    const b = reorderGroupsBlock()
    const successIdx = b.indexOf('if (data?.order)')
    expect(successIdx).toBeGreaterThan(-1)
    const region = b.slice(successIdx, successIdx + 300)
    expect(region).toMatch(/confirmedOrder = value;/)
  })
})

describe('handleGroupDrop', () => {
  it('is a no-op when dropping a group onto itself, or when nothing is being dragged', () => {
    const b = handleGroupDropBlock()
    expect(b).toMatch(/if \(!draggedId \|\| draggedId === targetGroupId \|\| !boardData\) return;/)
  })

  it('computes the new order by removing the dragged id and reinserting it before the target, then calls reorderGroups', () => {
    const b = handleGroupDropBlock()
    expect(b).toMatch(/reorderGroups\(reordered\);/)
  })
})

describe('trailing "Move group to end" drop target (E2 fix — closes the "cannot reach last position" gap)', () => {
  it('exists, is scoped to boards with at least one real group, and carries onDragOver/onDrop/title/aria-label', () => {
    const b = trailingDropZoneBlock()
    expect(b).toMatch(/onDragOver=\{e => \{ if \(draggingGroupId\) e\.preventDefault\(\); \}\}/)
    expect(b).toMatch(/onDrop=\{e => \{ e\.preventDefault\(\); handleGroupDropAtEnd\(\); \}\}/)
    expect(b).toMatch(/title="Move group to end"/)
    expect(b).toMatch(/aria-label="Move group to end"/)
  })

  it('is collapsed (zero height, non-interactive) when nothing is being dragged, and only expands/becomes interactive while draggingGroupId is set — never a persistent visual element', () => {
    const b = trailingDropZoneBlock()
    expect(b).toMatch(/height: draggingGroupId \? 14 : 0,/)
    expect(b).toMatch(/pointerEvents: draggingGroupId \? "auto" : "none",/)
  })

  it('does not reference group={null} or the "No group" bucket in any way — "No group" stays fully excluded from the trailing target', () => {
    const b = trailingDropZoneBlock()
    expect(b).not.toMatch(/group=\{null\}/)
  })

  it('routes through the SAME reorderGroups(...) helper as every other drop — no second mutation path', () => {
    const b = handleGroupDropAtEndBlock()
    const reorderCalls = b.match(/reorderGroups\(/g) ?? []
    expect(reorderCalls.length).toBe(1)
  })

  it('appends the dragged id to the END of the current group order (never inserts it before an existing group)', () => {
    const b = handleGroupDropAtEndBlock()
    expect(b).toMatch(/reorderGroups\(\[\.\.\.without, draggedId\]\);/)
    // The insert-before-target shape from handleGroupDrop must NOT appear here.
    expect(b).not.toMatch(/without\.slice\(0, targetIndex\)/)
  })

  it('is a no-op with NO reorderGroups call when the dragged group is already last', () => {
    const b = handleGroupDropAtEndBlock()
    const guardIdx = b.indexOf('if (currentIds.length === 0 || currentIds[currentIds.length - 1] === draggedId) return;')
    expect(guardIdx).toBeGreaterThan(-1)
    const reorderIdx = b.indexOf('reorderGroups(')
    expect(reorderIdx).toBeGreaterThan(guardIdx) // the guard's `return` precedes the only reorderGroups call
  })

  it('handleGroupDrop (the pre-existing insert-before-target path) is completely unchanged by this fix', () => {
    const b = handleGroupDropBlock()
    expect(b).toMatch(/if \(!draggedId \|\| draggedId === targetGroupId \|\| !boardData\) return;/)
    expect(b).toMatch(/const reordered = \[\.\.\.without\.slice\(0, targetIndex\), draggedId, \.\.\.without\.slice\(targetIndex\)\];/)
  })
})

describe('regression — this phase touches nothing about item editing, drawer-open, or Notes', () => {
  it('ItemRow\'s D.4.7D renderTrigger-based inline rename is unchanged (name click still opens drawer, separate hover pencil still starts rename)', () => {
    const b = itemRowBlock()
    expect(b).toMatch(/onClick=\{\(\) => onOpenDrawer\(item\)\}/)
    expect(b).toMatch(/title="Rename"/)
  })

  it('InlineText\'s dirty-draft render-time-comparison state (D.4.7C/D.4.7D pattern) is unchanged', () => {
    const b = inlineTextBlock()
    expect(b).toMatch(/if \(seenValue !== value\) \{/)
    expect(b).toMatch(/if \(!dirty\) setDraft\(value\);/)
  })

  it('group rename (InlineText on the group name, click-to-edit) is unchanged by the trailing-drop-target fix', () => {
    const b = groupSectionBlock()
    expect(b).toMatch(/<InlineText value=\{group\.name\} bold onSave=\{v => onRenameGroup\(group\.id, v\)\}/)
  })
})

describe('no new activity event type introduced for reorder (locked by organiserActivitySchema.test.ts elsewhere; re-asserted here at the call-site level)', () => {
  it('reorderGroups never references a position/reorder-specific event type', () => {
    const b = reorderGroupsBlock()
    expect(b).not.toMatch(/group\.reordered|group\.position_changed|group\.repositioned/)
  })
})
