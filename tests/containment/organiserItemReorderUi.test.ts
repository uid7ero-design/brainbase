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

describe('E3 ItemRow drag handle', () => {
  it('is an optional, dedicated draggable hit target with accessible labeling', () => {
    const b = itemRowBlock()
    expect(b).toMatch(/onItemDragHandleStart\?: \(\) => void/)
    expect(b).toMatch(/\{onItemDragHandleStart && \(/)
    expect(b).toMatch(/draggable/)
    expect(b).toMatch(/onDragStart=/)
    expect(b).toMatch(/title="Drag to reorder item"/)
    expect(b).toMatch(/aria-label="Reorder item"/)
  })

  it('keeps name-click drawer open and separate inline rename intact', () => {
    const b = itemRowBlock()
    expect(b).toMatch(/onClick=\{\(\) => onOpenDrawer\(item\)\}/)
    expect(b).toMatch(/title="Rename"/)
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

  it('introduces no item reorder activity type', () => {
    const b = reorderItemsBlock()
    expect(b).not.toMatch(/item\.reordered|item\.position_changed|item\.repositioned/)
  })
})
