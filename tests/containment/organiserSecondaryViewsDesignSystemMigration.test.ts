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

const organiserCss = fs.readFileSync(path.resolve(__dirname, '../../components/organiser/Organiser.module.css'), 'utf-8')

describe('C.5 Organiser Kanban, Calendar, and Activity chrome migration', () => {
  it('migrates Kanban surfaces, text hierarchy, controls, and spacing to canonical tokens', () => {
    // Integration note (main + app visual convergence): main's C.x rollout pinned its own
    // inline --bb-* styling. The reviewed Phase D3 implementation supersedes that presentation
    // (CSS module on the Phase A app tokens, shared primitives, dialog semantics), so this
    // assertion now pins the D3 equivalent. Every behavioural assertion in this file is unchanged.
    expect(kanban).toContain('className={styles.')
    expect(kanban).not.toContain('useOpsTheme')
    expect(kanban).not.toMatch(/#[0-9a-fA-F]{6}\b|rgba\(255, ?255, ?255/)
    for (const token of ['var(--bg-surface)', 'var(--border)', 'var(--text-primary)', 'var(--text-muted)'])
      expect(organiserCss).toContain(token)

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
    // Integration note (main + app visual convergence): main's C.x rollout pinned its own
    // inline --bb-* styling. The reviewed Phase D3 implementation supersedes that presentation
    // (CSS module on the Phase A app tokens, shared primitives, dialog semantics), so this
    // assertion now pins the D3 equivalent. Every behavioural assertion in this file is unchanged.
    expect(calendar).toContain('className={styles.')
    expect(calendar).not.toContain('useOpsTheme')
    expect(calendar).not.toMatch(/#[0-9a-fA-F]{6}\b|rgba\(255, ?255, ?255/)
    for (const token of ['var(--bg-surface)', 'var(--border)', 'var(--text-primary)', 'var(--text-muted)'])
      expect(organiserCss).toContain(token)

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
    // Integration note (main + app visual convergence): main's C.x rollout pinned its own
    // inline --bb-* styling. The reviewed Phase D3 implementation supersedes that presentation
    // (CSS module on the Phase A app tokens, shared primitives, dialog semantics), so this
    // assertion now pins the D3 equivalent. Every behavioural assertion in this file is unchanged.
    expect(boardActivity).toContain('className={styles.')
    expect(boardActivity).not.toContain('useOpsTheme')
    expect(boardActivity).not.toMatch(/#[0-9a-fA-F]{6}\b|rgba\(255, ?255, ?255/)
    for (const token of ['var(--bg-surface)', 'var(--border)', 'var(--text-primary)', 'var(--text-muted)'])
      expect(organiserCss).toContain(token)

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
    // Integration note (main + app visual convergence): main's C.x rollout pinned its own
    // inline --bb-* styling. The reviewed Phase D3 implementation supersedes that presentation
    // (CSS module on the Phase A app tokens, shared primitives, dialog semantics), so this
    // assertion now pins the D3 equivalent; main's behavioural assertions below are kept verbatim.
    expect(itemActivity).toContain('className={styles.')
    expect(itemActivity).not.toContain('useOpsTheme')
    expect(itemActivity).not.toMatch(/#[0-9a-fA-F]{6}\b|rgba\(255, ?255, ?255/)
    for (const token of ['var(--bg-surface)', 'var(--border)', 'var(--text-primary)', 'var(--text-muted)'])
      expect(organiserCss).toContain(token)
    // Main's Item Activity data-behaviour assertions (restored verbatim).
    expect(itemActivity).toContain('fetch(`/api/organiser/activity?itemId=${encodeURIComponent(itemId)}`')
    expect(itemActivity).toContain('}, [itemId, updatedAt])')
    expect(itemActivity).toContain('if (!nextCursor || loadingMore) return')
    expect(itemActivity).toContain('&cursor=${encodeURIComponent(nextCursor)}')
    expect(itemActivity).toContain('setEvents(prev => [...prev, ...(d.activity ?? [])])')
  })

  it('uses a token-backed secondary action style for Calendar and Activity pagination controls', () => {
    // Integration note (main + app visual convergence): main's C.x rollout pinned its own
    // inline --bb-* styling. The reviewed Phase D3 implementation supersedes that presentation
    // (CSS module on the Phase A app tokens, shared primitives, dialog semantics), so this
    // assertion now pins the D3 equivalent. Every behavioural assertion in this file is unchanged.
    expect(calendar).toContain('buttonProps(')
    expect(boardActivity).toContain('<button type="button" onClick={loadMore} disabled={loadingMore} {...buttonProps("secondary", "sm")}>')
    expect(itemActivity).toContain('<button type="button" onClick={loadMore} disabled={loadingMore} {...buttonProps("secondary", "sm")}>')
    expect(calendar).not.toContain('navBtnStyle(t)')

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
