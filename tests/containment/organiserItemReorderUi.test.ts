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
  expect(start, `start marker not found: ${startMarker}`).toBeGreaterThan(-1)
  expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(start)
  return pageCode.slice(start, end)
}

const itemRowBlock = () => block('function ItemRow(', '\nfunction GroupSection(')
const groupSectionBlock = () => block('function GroupSection(', '\nfunction KanbanView(')
const reorderItemsBlock = () => block('async function reorderTopLevelItems(', '\n  async function addItem(')
// D.4.7F — the handler for handleTopLevelItemKeyReorder lives inside
// GroupSection, right after handleSubitemDropAtEnd; bounded to just that
// function (not the whole GroupSection block) for a tight assertion.
const handleTopLevelItemKeyReorderBlock = () => block('function handleTopLevelItemKeyReorder(', '\n  }')

describe('E3 ItemRow drag handle', () => {
  it('is an optional, dedicated draggable hit target rendered via <ReorderHandle>', () => {
    const b = itemRowBlock()
    expect(b).toMatch(/onItemDragHandleStart\?: \(\) => void/)
    expect(b).toMatch(/\{onItemDragHandleStart && \(/)
    expect(b).toMatch(/<ReorderHandle/)
    expect(b).toMatch(/onDragStart=/)
    expect(b).toMatch(/title="Drag to reorder item"/)
    expect(b).toMatch(/ariaLabel="Reorder item"/)
  })

  it('keeps name-click drawer open and separate inline rename intact', () => {
    const b = itemRowBlock()
    expect(b).toMatch(/onClick=\{\(\) => onOpenDrawer\(item\)\}/)
    expect(b).toMatch(/title="Rename"/)
  })
})

describe('D.4.7F — ItemRow/GroupSection keyboard reorder wiring (top-level items)', () => {
  it('ItemRow declares an optional onKeyReorder prop and wires it to ReorderHandle\'s onMove', () => {
    const b = itemRowBlock()
    expect(b).toMatch(/onKeyReorder\?: \(move: ReorderMove\) => void;/)
    expect(b).toMatch(/onMove=\{move => onKeyReorder\?\.\(move\)\}/)
  })

  it('the top-level ItemRow call site passes onKeyReorder wired to handleTopLevelItemKeyReorder(item.id, move)', () => {
    const b = groupSectionBlock()
    expect(b).toMatch(/onKeyReorder=\{move => handleTopLevelItemKeyReorder\(item\.id, move\)\}/)
  })

  it('handleTopLevelItemKeyReorder computes via moveInOrderedList against THIS group\'s own topLevel ids only', () => {
    const b = handleTopLevelItemKeyReorderBlock()
    expect(b).toMatch(/const currentIds = topLevel\.map\(i => i\.id\);/)
    expect(b).toMatch(/const reordered = moveInOrderedList\(currentIds, itemId, move\);/)
  })

  it('is a true no-op on a boundary move before any announcement or reorder call', () => {
    const b = handleTopLevelItemKeyReorderBlock()
    const guardIdx = b.indexOf('if (!reordered) return;')
    const announceIdx = b.indexOf('onAnnounce(')
    const reorderIdx = b.indexOf('onReorderTopLevelItems(')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(announceIdx).toBeGreaterThan(guardIdx)
    expect(reorderIdx).toBeGreaterThan(announceIdx)
  })

  it('terminates in the exact same onReorderTopLevelItems prop pointer drop already calls — exactly one call, no new mutation path', () => {
    const b = handleTopLevelItemKeyReorderBlock()
    const calls = b.match(/onReorderTopLevelItems\(/g) ?? []
    expect(calls.length).toBe(1)
    expect(b).not.toMatch(/fetch\(/)
  })

  it('announces with the entity type and moved-to position/total — matching the approved design\'s exact message shape', () => {
    const b = handleTopLevelItemKeyReorderBlock()
    expect(b).toMatch(/`Moved \$\{item\.name\} to position \$\{reordered\.indexOf\(itemId\) \+ 1\} of \$\{reordered\.length\}`/)
  })
})

describe('E3 GroupSection same-scope wiring', () => {
  it('keeps top-level item drag state separate from subitem drag state', () => {
    const b = groupSectionBlock()
    const top = b.indexOf('onItemDragHandleStart={() => setDraggingItemId(item.id)}')
    expect(top).toBeGreaterThan(-1)
    const kids = b.indexOf('!collapsed && kids.map(child =>')
    expect(kids).toBeGreaterThan(top)
    const childRegion = b.slice(kids, b.indexOf('!collapsed && (', kids))
    expect(childRegion).not.toMatch(/setDraggingItemId\(child\.id\)/)
    expect(childRegion).toMatch(/setDraggingSubitem/)
  })

  it('dropping a top-level item onto itself is a no-op before the reorder callback', () => {
    const b = groupSectionBlock()
    expect(b).toMatch(/if \(!draggedId \|\| draggedId === targetItemId\) return;/)
  })

  it('drop on an existing top-level item inserts before that item in the same scope', () => {
    const b = groupSectionBlock()
    expect(b).toMatch(/function handleTopLevelItemDrop\(targetItemId: string\)/)
    expect(b).toMatch(/const currentIds = topLevel\.map\(i => i\.id\)/)
    expect(b).toMatch(/onReorderTopLevelItems\(group\?\.id \?\? null, \[\.\.\.without\.slice\(0, targetIndex\), draggedId, \.\.\.without\.slice\(targetIndex\)\]\)/)
  })

  it('has a trailing drop target so a top-level item can become last', () => {
    const b = groupSectionBlock()
    expect(b).toMatch(/title="Move item to end"/)
    expect(b).toMatch(/handleTopLevelItemDropAtEnd\(\)/)
    expect(b).toMatch(/onReorderTopLevelItems\(group\?\.id \?\? null, \[\.\.\.currentIds\.filter\(id => id !== draggedId\), draggedId\]\)/)
  })

  it('already-last drop-at-end is a no-op before the reorder callback', () => {
    const b = groupSectionBlock()
    const guard = b.indexOf('currentIds[currentIds.length - 1] === draggedId')
    const call = b.indexOf('onReorderTopLevelItems(group?.id ?? null, [...currentIds.filter', guard)
    expect(guard).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(guard)
  })

  it('supports the real No group top-level item scope via groupId null', () => {
    const b = groupSectionBlock()
    expect(b).toMatch(/onReorderTopLevelItems\(group\?\.id \?\? null,/)
  })

  it('does not mutate group_id or parent_item_id while computing same-group reorder', () => {
    const b = groupSectionBlock()
    const dropStart = b.indexOf('function handleTopLevelItemDrop(')
    const colorStart = b.indexOf('const color =', dropStart)
    const handlers = b.slice(dropStart, colorStart)
    expect(handlers).not.toMatch(/group_id\s*:/)
    expect(handlers).not.toMatch(/parent_item_id\s*:/)
  })
})

describe('E3 reorderTopLevelItems optimistic reliability', () => {
  it('keys the coalescing queue per board and group scope', () => {
    const b = reorderItemsBlock()
    expect(b).toMatch(/board:\$\{activeId\}:item-order:group:\$\{groupId \?\? "none"\}/)
    expect(b).toMatch(/enqueueCoalesced\(reorderQueueRef\.current, key, orderedItemIds/)
  })

  it('optimistically rewrites positions only for top-level items in the selected group', () => {
    const b = reorderItemsBlock()
    expect(b).toMatch(/item\.group_id === groupId && !item\.parent_item_id && posById\.has\(item\.id\)/)
    expect(b).toMatch(/\? \{ \.\.\.item, position: posById\.get\(item\.id\)! \}/)
  })

  it('sends one complete same-scope order to the new reorder endpoint', () => {
    const b = reorderItemsBlock()
    expect(b).toMatch(/fetch\(\`\/api\/organiser\/boards\/\$\{activeId\}\/items\/reorder\`/)
    expect(b).toMatch(/JSON\.stringify\(\{ group_id: groupId, ordered_item_ids: value \}\)/)
  })

  it('409 reloads authoritative board state instead of trusting a stale local snapshot', () => {
    const b = reorderItemsBlock()
    const idx = b.indexOf('res.status === 409')
    expect(idx).toBeGreaterThan(-1)
    expect(b.slice(idx, idx + 250)).toMatch(/loadBoardData\(activeId\)/)
  })

  it('other failures restore the last server-confirmed order and surface a truthful error', () => {
    const b = reorderItemsBlock()
    expect(b).toMatch(/let confirmedOrder: string\[\] \| null = null/)
    expect(b).toMatch(/Couldn't save item order\. Reverting\./)
    expect(b).toMatch(/applyOrder\(prev, confirmedOrder \?\? preDragScope\.map\(i => i\.id\)\)/)
  })

  it('successful response reconciles authoritative positions and advances confirmedOrder', () => {
    const b = reorderItemsBlock()
    expect(b).toMatch(/confirmedOrder = value/)
    expect(b).toMatch(/const posById = new Map\(data\.order\.map\(o => \[o\.id, o\.position\]\)\)/)
  })
})

describe('E3 scope exclusions', () => {
  it('does not add item drag behavior to Kanban or Calendar views', () => {
    const kanban = block('function KanbanView(', '\nfunction CalendarView(')
    const calendar = block('function CalendarView(', '\nfunction ')
    expect(kanban).not.toMatch(/onItemDragHandleStart|reorderTopLevelItems|handleTopLevelItemDrop/)
    expect(calendar).not.toMatch(/onItemDragHandleStart|reorderTopLevelItems|handleTopLevelItemDrop/)
  })

  it('D.4.7F — does not add keyboard reorder behavior to Kanban or Calendar views either', () => {
    const kanban = block('function KanbanView(', '\nfunction CalendarView(')
    const calendar = block('function CalendarView(', '\nfunction ')
    expect(kanban).not.toMatch(/onKeyReorder|handleTopLevelItemKeyReorder|moveInOrderedList|ReorderHandle/)
    expect(calendar).not.toMatch(/onKeyReorder|handleTopLevelItemKeyReorder|moveInOrderedList|ReorderHandle/)
  })

  it('introduces no item reorder activity type', () => {
    const b = reorderItemsBlock()
    expect(b).not.toMatch(/item\.reordered|item\.position_changed|item\.repositioned/)
  })
})
