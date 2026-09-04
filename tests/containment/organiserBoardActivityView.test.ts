import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.5E — board-level Activity view. Static source-text containment
// only — this repo has no jsdom/React Testing Library harness (see
// AGENTS.md/CLAUDE.md and every other containment test file's own note).
// Pure-logic behavior (item-label resolution, event-type handling, group
// resolution) is covered with real function calls in
// tests/containment/organiserBoardActivityFormat.test.ts; this file proves
// the SOURCE wiring — the view exists as a fourth Table/Board/Calendar/
// Activity option, is scoped correctly, loads/refreshes correctly, and the
// pre-existing board/drawer architecture is unchanged.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const pageSource = read('app/organiser/page.tsx')
const pageCode = stripComments(pageSource)

describe('ViewMode — Activity is a fourth board view', () => {
  it('ViewMode includes "activity" alongside table/board/calendar', () => {
    expect(pageCode).toMatch(/type ViewMode = "table" \| "board" \| "calendar" \| "activity";/)
  })

  it('the view switcher offers all four options', () => {
    expect(pageCode).toMatch(/\(\["table", "board", "calendar", "activity"\] as ViewMode\[\]\)\.map/)
  })
})

describe('BoardActivity — the new section itself', () => {
  const start = pageCode.indexOf('function BoardActivity(')
  // stripComments removes the '// ── ITEM DETAIL DRAWER' section-header
  // comment this block used to end at, so it must be located by the next
  // real CODE boundary instead — ItemActivity is the very next function
  // defined after BoardActivity in the source.
  const end = pageCode.indexOf('\nfunction ItemActivity(', start)
  const block = pageCode.slice(start, end)

  it('exists as its own function and imports the real board-feed formatter (not a duplicated inline switch statement)', () => {
    expect(start).toBeGreaterThan(-1)
    expect(pageCode).toMatch(/import \{ describeActivityEvent, describeBoardActivityEvent, type ActivityEventLike \} from ["']@\/lib\/organiser\/activityFormat["']/)
  })

  it('fetches from the board-scoped endpoint, with credentials included', () => {
    expect(block).toMatch(/fetch\(`\/api\/organiser\/activity\?boardId=\$\{encodeURIComponent\(boardId\)\}`, \{ credentials: "include" \}\)/)
  })

  it('has an explicit loading state, empty state, and error state', () => {
    expect(block).toMatch(/loading \?[\s\S]{0,60}Loading activity/)
    expect(block).toMatch(/error \?[\s\S]{0,60}\{error\}/)
    expect(block).toMatch(/events\.length === 0 \?[\s\S]{0,100}No activity yet/)
  })

  it('supports bounded "Load more" pagination via next_cursor', () => {
    expect(block).toMatch(/cursor=\$\{encodeURIComponent\(nextCursor\)\}/)
    expect(block).toMatch(/Load more/)
  })

  it('renders newest-first as returned by the API — no client-side re-sort', () => {
    expect(block).not.toMatch(/\.sort\(/)
  })

  it('renders through describeBoardActivityEvent, not describeActivityEvent (the single-item variant) and not scattered inline event_type handling', () => {
    expect(block).toMatch(/describeBoardActivityEvent\(ev, groupNamesById, liveItemNamesById\)/)
    expect(block).not.toMatch(/describeActivityEvent\(ev/)
    expect(block).not.toMatch(/event_type === ['"]item\./)
  })

  it('item name and item click-through are both derived from the items prop only — no independent fetch for either', () => {
    expect(block).toMatch(/liveItemsById/)
    expect(block).toMatch(/liveItemNamesById/)
    expect((block.match(/fetch\(/g) ?? []).length).toBe(2) // initial load + loadMore, both to the activity endpoint
  })

  it('click-through only for a live item entity — never offered for a deleted item or a non-item entity_type', () => {
    expect(block).toMatch(/ev\.entity_type === "item" \? liveItemsById\[ev\.entity_id\] : undefined/)
    expect(block).toMatch(/onClick=\{liveItem \? \(\) => onOpenItem\(liveItem\) : undefined\}/)
  })
})

describe('BoardActivity — mounted only while the Activity view is selected', () => {
  it('is rendered exactly once, gated on view === "activity" && boardData, keyed for clean refresh-on-mutation', () => {
    const idx = pageCode.indexOf('{view === "activity" && boardData && (')
    expect(idx).toBeGreaterThan(-1)
    const block = pageCode.slice(idx, idx + 400)
    expect(block).toMatch(/<BoardActivity/)
    expect(block).toMatch(/key=\{`\$\{activeBoard\.id\}:\$\{boardActivityRefreshKey\}`\}/)
    expect(block).toMatch(/boardId=\{activeBoard\.id\}/)
    expect(block).toMatch(/items=\{boardData\.items\}/)
    expect(block).toMatch(/onOpenItem=\{setDrawerItem\}/)
  })

  it('table/board/calendar content is gated on their own distinct view checks — switching to Activity does not also render them', () => {
    expect(pageCode).toMatch(/\{view === "table" && \(/)
    expect(pageCode).toMatch(/\{view === "board" && boardData && \(/)
    expect(pageCode).toMatch(/\{view === "calendar" && boardData && \(/)
  })

  it('does not open the item drawer automatically — no drawerItem/setDrawerItem call outside an explicit click handler', () => {
    const start = pageCode.indexOf('function BoardActivity(')
    // stripComments removes the '// ── ITEM DETAIL DRAWER' section-header
  // comment this block used to end at, so it must be located by the next
  // real CODE boundary instead — ItemActivity is the very next function
  // defined after BoardActivity in the source.
  const end = pageCode.indexOf('\nfunction ItemActivity(', start)
    const block = pageCode.slice(start, end)
    expect(block).not.toMatch(/useEffect\([\s\S]{0,200}onOpenItem\(/)
  })
})

describe('boardActivityRefreshKey — derived from boardData.items only, no new fetch', () => {
  it('is computed via useMemo from boardData.items (count + latest updated_at), not an independent network call', () => {
    const start = pageCode.indexOf('const boardActivityRefreshKey = useMemo(')
    expect(start).toBeGreaterThan(-1)
    const end = pageCode.indexOf('}, [boardData?.items]);', start)
    const block = pageCode.slice(start, end)
    expect(block).toMatch(/boardData\?\.items/)
    expect(block).not.toMatch(/fetch\(/)
  })
})

describe('Board header/rail preserved — Activity is added as a view option, not a redesign', () => {
  it('the board name, view switcher, and Import control remain in the same header block Activity also lives under', () => {
    const headerStart = pageCode.indexOf('<InlineText value={activeBoard.name}')
    expect(headerStart).toBeGreaterThan(-1)
    const headerBlock = pageCode.slice(headerStart, headerStart + 1800)
    expect(headerBlock).toContain('Import CSV/XLSX')
    expect(headerBlock).toMatch(/\(\["table", "board", "calendar", "activity"\]/)
  })

  it('"+ New group" remains scoped to the table view only — Activity does not surface a table-only action', () => {
    expect(pageCode).toMatch(/view === "table" && <button onClick=\{\(\) => setAddingGroup\(true\)\}/)
  })

  it('OrganiserShell/OrganiserRail (board rail, global TopNav boundary) are untouched — no new import, no structural change to the shell wiring', () => {
    const shellUsage = pageCode.match(/<OrganiserShell/g) ?? []
    const railUsage = pageCode.match(/<OrganiserRail/g) ?? []
    expect(shellUsage).toHaveLength(1)
    expect(railUsage).toHaveLength(1)
  })
})

describe('ItemDrawer architecture unchanged by this phase', () => {
  const start = pageCode.indexOf('function ItemDrawer(')
  const end = pageCode.indexOf('\nfunction Field(', start)
  const block = pageCode.slice(start, end)

  it('still takes exactly the same props as after D.4.5D — no new prop added for the board feed', () => {
    expect(block).toMatch(/item: OrganiserItem; onClose: \(\) => void; onUpdate: \(id: string, patch: Record<string, unknown>\) => void; groupNamesById: Record<string, string>/)
  })

  it('still renders exactly one ItemActivity (the D.4.5D single-item tab), untouched', () => {
    const matches = block.match(/<ItemActivity /g) ?? []
    expect(matches).toHaveLength(1)
  })
})
