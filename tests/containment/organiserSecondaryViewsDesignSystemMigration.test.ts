import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(
  path.resolve(__dirname, '../../app/organiser/page.tsx'),
  'utf-8',
)

function block(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

const kanban = block('function KanbanView(', '// ── CALENDAR VIEW')
const calendar = block('function CalendarView(', '// ── BOARD ACTIVITY')
const boardActivity = block('function BoardActivity(', '// ── ITEM DETAIL DRAWER')
const itemActivity = block('function ItemActivity(', 'function ItemDrawer(')

describe('C.5 Organiser Kanban, Calendar, and Activity chrome migration', () => {
  it('migrates Kanban surfaces, text hierarchy, controls, and spacing to canonical tokens', () => {
    for (const token of [
      '--bb-canvas', '--bb-space-5', '--bb-space-7', '--bb-text-secondary',
      '--bb-text-muted', '--bb-surface-1', '--bb-border-subtle', '--bb-shadow-sm',
      '--bb-text-primary', '--bb-text-tertiary', '--bb-surface-soft',
      '--bb-border-default', '--bb-radius-lg', '--bb-radius-sm',
    ]) expect(kanban).toContain(token)
    expect(kanban).not.toContain('useOpsTheme')
  })

  it('preserves Kanban status grouping and status mutation behavior', () => {
    expect(kanban).toContain('const topLevel = items.filter(i => !i.parent_item_id)')
    expect(kanban).toContain('const statuses = Array.from(new Set([...STATUS_OPTIONS, ...topLevel.map(i => i.status)]))')
    expect(kanban).toContain('const cards = topLevel.filter(i => i.status === status)')
    expect(kanban).toContain('onClick={() => onOpenDrawer(item)}')
    expect(kanban).toContain('onClick={e => e.stopPropagation()}')
    expect(kanban).toContain('onChange={e => onUpdateItem(item.id, { status: e.target.value })}')
    expect(kanban).toContain('Array.from(new Set([...STATUS_OPTIONS, item.status]))')
  })

  it('migrates Calendar navigation, cells, labels, and today treatment to canonical tokens', () => {
    for (const token of [
      '--bb-canvas', '--bb-radius-md', '--bb-surface-soft',
      '--bb-text-primary', '--bb-type-micro-size',
      '--bb-type-micro-tracking', '--bb-text-muted', '--bb-border-focus',
      '--bb-border-subtle', '--bb-accent-300', '--bb-text-tertiary',
    ]) expect(calendar).toContain(token)
    expect(calendar).not.toContain('useOpsTheme')
    expect(calendar).not.toContain('navBtnStyle(t)')
  })

  it('preserves Calendar month navigation, Today action, due-date grouping, limits, and item opening', () => {
    expect(calendar).toContain('const [monthDate, setMonthDate] = useState(() => new Date())')
    expect(calendar).toContain('setMonthDate(new Date(year, month - 1, 1))')
    expect(calendar).toContain('setMonthDate(new Date(year, month + 1, 1))')
    expect(calendar).toContain('setMonthDate(new Date())')
    expect(calendar).toContain('const itemsByDate = new Map<string, OrganiserItem[]>()')
    expect(calendar).toContain('if (!it.due_date) continue')
    expect(calendar).toContain('dayItems.slice(0, 3)')
    expect(calendar).toContain('dayItems.length > 3')
    expect(calendar).toContain('onClick={() => onOpenDrawer(it)}')
  })

  it('migrates Board Activity loading/error/empty/event/diff chrome to canonical tokens', () => {
    for (const token of [
      '--bb-canvas', '--bb-text-tertiary', '--bb-danger', '--bb-text-muted',
      '--bb-radius-md', '--bb-surface-1', '--bb-border-subtle',
      '--bb-text-primary', '--bb-text-secondary',
    ]) expect(boardActivity).toContain(token)
    expect(boardActivity).not.toContain('useOpsTheme')
  })

  it('preserves Board Activity fetch, cancellation, pagination, live-item click-through, and refresh semantics', () => {
    expect(boardActivity).toContain('fetch(`/api/organiser/activity?boardId=${encodeURIComponent(boardId)}`')
    expect(boardActivity).toContain('let cancelled = false')
    expect(boardActivity).toContain('if (cancelled) return')
    expect(boardActivity).toContain('return () => { cancelled = true; }')
    expect(boardActivity).toContain('if (!nextCursor || loadingMore) return')
    expect(boardActivity).toContain('&cursor=${encodeURIComponent(nextCursor)}')
    expect(boardActivity).toContain('setEvents(prev => [...prev, ...(d.activity ?? [])])')
    expect(boardActivity).toContain('const liveItem = ev.entity_type === "item" ? liveItemsById[ev.entity_id] : undefined')
    expect(boardActivity).toContain('onClick={liveItem ? () => onOpenItem(liveItem) : undefined}')
    expect(boardActivity).toContain('}, [boardId, refreshKey])')
  })

  it('uses the same token-backed activity treatment for Item Activity without changing its data behavior', () => {
    for (const token of [
      '--bb-text-muted', '--bb-danger', '--bb-radius-md', '--bb-surface-soft',
      '--bb-border-subtle', '--bb-text-primary', '--bb-text-secondary',
    ]) expect(itemActivity).toContain(token)
    expect(itemActivity).not.toContain('useOpsTheme')
    expect(itemActivity).toContain('fetch(`/api/organiser/activity?itemId=${encodeURIComponent(itemId)}`')
    expect(itemActivity).toContain('}, [itemId, updatedAt])')
    expect(itemActivity).toContain('if (!nextCursor || loadingMore) return')
    expect(itemActivity).toContain('&cursor=${encodeURIComponent(nextCursor)}')
    expect(itemActivity).toContain('setEvents(prev => [...prev, ...(d.activity ?? [])])')
  })

  it('uses a token-backed secondary action style for Calendar and Activity pagination controls', () => {
    const helper = block('function viewButtonStyle()', 'function CalendarView(')
    for (const token of [
      '--bb-radius-md', '--bb-surface-soft', '--bb-border-default', '--bb-text-secondary',
    ]) expect(helper).toContain(token)
    expect(calendar).toContain('viewButtonStyle()')
    expect(boardActivity).toContain('style={viewButtonStyle()}')
    expect(itemActivity).toContain('style={viewButtonStyle()}')
  })

  it('removes the targeted legacy chrome literals from all three views', () => {
    const combined = [kanban, calendar, boardActivity, itemActivity].join('\n')
    for (const literal of [
      'rgba(139,92,246,.4)', '#C4B5FD', 'color: "#EF4444"',
      'background: t.ink(', 'border: `1px solid ${t.ink(', 'color: t.ink(',
    ]) {
      expect(combined).not.toContain(literal)
    }
  })

  it('does not add drag/drop, auth, capability, database, or persistence behavior', () => {
    const combined = [kanban, calendar, boardActivity, itemActivity].join('\n')
    expect(combined).not.toContain('draggable=')
    expect(combined).not.toContain('onDragStart=')
    expect(combined).not.toContain('onDrop=')
    expect(combined).not.toContain('requireCapability')
    expect(combined).not.toContain('requireRole')
    expect(combined).not.toContain('sql`')
    expect(combined).not.toContain('prisma.')
    expect(combined).not.toContain('localStorage')
  })
})
