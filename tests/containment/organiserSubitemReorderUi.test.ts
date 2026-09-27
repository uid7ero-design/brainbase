import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const pageCode = stripComments(read('app/organiser/page.tsx'))

function block(startMarker: string, endMarker: string): string {
  const start = pageCode.indexOf(startMarker)
  const end = pageCode.indexOf(endMarker, start)
  expect(start, 'start marker not found: ' + startMarker).toBeGreaterThan(-1)
  expect(end, 'end marker not found: ' + endMarker).toBeGreaterThan(start)
  return pageCode.slice(start, end)
}

const groupSectionBlock = () => block('function GroupSection(', '\nfunction KanbanView(')
const reorderSubitemsBlock = () => block('async function reorderSubitems(', '\n  async function addItem(')

describe('E4 same-parent subitem drag wiring', () => {
  it('gives subitems the existing dedicated drag handle without reusing top-level drag state', () => {
    const b = groupSectionBlock()
    expect(b).toMatch(/onItemDragHandleStart=\{\(\) => setDraggingSubitem\(\{ parentId: item\.id, itemId: child\.id \}\)\}/)
    expect(b).toMatch(/onItemDragHandleStart=\{\(\) => setDraggingItemId\(item\.id\)\}/)
  })

  it('same-parent scope is enforced before computing a drop', () => {
    const b = groupSectionBlock()
    expect(b).toMatch(/if \(!dragged \|\| dragged\.parentId !== parentItemId \|\| dragged\.itemId === targetItemId\) return;/)
    expect(b).toMatch(/const currentIds = childrenOf\(parentItemId\)\.map\(i => i\.id\)/)
  })

  it('dropping a subitem onto itself is a no-op', () => {
    const b = groupSectionBlock()
    expect(b).toMatch(/dragged\.itemId === targetItemId/)
  })

  it('drop on an existing sibling inserts before that sibling', () => {
    const b = groupSectionBlock()
    expect(b).toMatch(/function handleSubitemDrop\(parentItemId: string, targetItemId: string\)/)
    expect(b).toMatch(/onReorderSubitems\(parentItemId, \[\.\.\.without\.slice\(0, targetIndex\), dragged\.itemId, \.\.\.without\.slice\(targetIndex\)\]\)/)
  })

  it('has a trailing same-parent drop target and already-last remains a no-op', () => {
    const b = groupSectionBlock()
    expect(b).toMatch(/title="Move subitem to end"/)
    expect(b).toMatch(/handleSubitemDropAtEnd\(item\.id\)/)
    expect(b).toMatch(/currentIds\[currentIds\.length - 1\] === dragged\.itemId/)
    expect(b).toMatch(/onReorderSubitems\(parentItemId, \[\.\.\.currentIds\.filter\(id => id !== dragged\.itemId\), dragged\.itemId\]\)/)
  })

  it('subitem drop handlers stop propagation so they cannot trigger top-level drop handling', () => {
    const b = groupSectionBlock()
    const childStart = b.indexOf('!collapsed && kids.map(child =>')
    const addStart = b.indexOf('!collapsed && (', childStart)
    expect(childStart).toBeGreaterThan(-1)
    expect(addStart).toBeGreaterThan(childStart)
    expect(b.slice(childStart, addStart)).toMatch(/e\.stopPropagation\(\)/)
  })

  it('does not mutate group_id or parent_item_id while computing same-parent reorder', () => {
    const b = groupSectionBlock()
    const start = b.indexOf('function handleSubitemDrop(')
    const end = b.indexOf('const color =', start)
    const handlers = b.slice(start, end)
    expect(handlers).not.toMatch(/group_id\s*:/)
    expect(handlers).not.toMatch(/parent_item_id\s*:/)
  })
})

describe('E4 reorderSubitems optimistic reliability', () => {
  it('keys the coalescing queue per board and parent scope', () => {
    const b = reorderSubitemsBlock()
    expect(b).toMatch(/board:\$\{activeId\}:item-order:parent:\$\{parentItemId\}/)
    expect(b).toMatch(/enqueueCoalesced\(reorderQueueRef\.current, key, orderedItemIds/)
  })

  it('optimistically rewrites positions only for children of the selected parent', () => {
    const b = reorderSubitemsBlock()
    expect(b).toMatch(/item\.parent_item_id === parentItemId && posById\.has\(item\.id\)/)
  })

  it('sends one complete same-parent order to the subitem reorder endpoint', () => {
    const b = reorderSubitemsBlock()
    expect(b).toMatch(/fetch\(\x60\/api\/organiser\/boards\/\$\{activeId\}\/items\/\$\{parentItemId\}\/reorder\x60/)
    expect(b).toMatch(/JSON\.stringify\(\{ ordered_item_ids: value \}\)/)
  })

  it('409 reloads authoritative board state', () => {
    const b = reorderSubitemsBlock()
    const idx = b.indexOf('res.status === 409')
    expect(idx).toBeGreaterThan(-1)
    expect(b.slice(idx, idx + 260)).toMatch(/loadBoardData\(activeId\)/)
  })

  it('ordinary failure restores last confirmed order and reports the rollback', () => {
    const b = reorderSubitemsBlock()
    expect(b).toMatch(/let confirmedOrder: string\[\] \| null = null/)
    expect(b).toMatch(/Couldn't save subitem order\. Reverting\./)
    expect(b).toMatch(/applyOrder\(prev, confirmedOrder \?\? preDragScope\.map\(i => i\.id\)\)/)
  })

  it('successful response reconciles authoritative positions', () => {
    const b = reorderSubitemsBlock()
    expect(b).toMatch(/confirmedOrder = value/)
    expect(b).toMatch(/const posById = new Map\(data\.order\.map\(o => \[o\.id, o\.position\]\)\)/)
  })

  it('does not add subitem reorder behavior to Kanban or Calendar', () => {
    const kanban = block('function KanbanView(', '\nfunction CalendarView(')
    const calendar = block('function CalendarView(', '\nfunction ')
    expect(kanban).not.toMatch(/reorderSubitems|handleSubitemDrop|setDraggingSubitem/)
    expect(calendar).not.toMatch(/reorderSubitems|handleSubitemDrop|setDraggingSubitem/)
  })
})
