import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.5D — Item Activity tab/section in the existing item drawer.
// Static source-text containment only — this repo has no jsdom/React
// Testing Library harness (see AGENTS.md/CLAUDE.md and every other
// containment test file's own note). Pure-logic behavior (formatting,
// event-type handling, group resolution) is covered with real function
// calls in tests/containment/organiserActivityFormat.test.ts; this file
// proves the SOURCE wiring — the section exists, is scoped to an open
// drawer, loads/refreshes correctly, and the pre-existing drawer
// architecture is unchanged, not extended-in-place or redesigned.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const pageSource = read('app/organiser/page.tsx')
const pageCode = stripComments(pageSource)

describe('ItemActivity — the new section itself', () => {
  it('exists as its own function, imports the real formatter (not a duplicated inline switch statement)', () => {
    expect(pageCode).toMatch(/function ItemActivity\(/)
    // Phase D.4.5E — this import line also gained describeBoardActivityEvent
    // for the new board feed (see organiserBoardActivityView.test.ts); the
    // real assertion here — describeActivityEvent and ActivityEventLike are
    // imported from the shared formatter module, not reimplemented — still
    // holds, so the pattern is widened to match the real, current line
    // rather than the D.4.5D-only exact string.
    expect(pageCode).toMatch(/import \{ describeActivityEvent, describeBoardActivityEvent, type ActivityEventLike \} from ["']@\/lib\/organiser\/activityFormat["']/)
  })

  it('fetches from the new tenant-safe endpoint, scoped by itemId, with credentials included', () => {
    const start = pageCode.indexOf('function ItemActivity(')
    const end = pageCode.indexOf('\nfunction ItemDrawer(', start)
    const block = pageCode.slice(start, end)
    expect(block).toMatch(/fetch\(`\/api\/organiser\/activity\?itemId=\$\{encodeURIComponent\(itemId\)\}`, \{ credentials: "include" \}\)/)
  })

  it('has an explicit loading state, empty state, and error state — never a blank render on any of the three', () => {
    const start = pageCode.indexOf('function ItemActivity(')
    const end = pageCode.indexOf('\nfunction ItemDrawer(', start)
    const block = pageCode.slice(start, end)
    expect(block).toMatch(/loading \?[\s\S]{0,60}Loading/)
    expect(block).toMatch(/error \?[\s\S]{0,60}\{error\}/)
    expect(block).toMatch(/events\.length === 0 \?[\s\S]{0,60}No activity yet/)
  })

  it('re-fetches (from page 1, not appended) when itemId OR the item\'s own updatedAt changes — so an edit made while the drawer is open is reflected without closing/reopening it', () => {
    const start = pageCode.indexOf('function ItemActivity(')
    const end = pageCode.indexOf('\nfunction ItemDrawer(', start)
    const block = pageCode.slice(start, end)
    expect(block).toMatch(/\}, \[itemId, updatedAt\]\);/)
  })

  it('supports bounded "Load more" pagination via next_cursor — never loads unbounded history in one request', () => {
    const start = pageCode.indexOf('function ItemActivity(')
    const end = pageCode.indexOf('\nfunction ItemDrawer(', start)
    const block = pageCode.slice(start, end)
    expect(block).toMatch(/cursor=\$\{encodeURIComponent\(nextCursor\)\}/)
    expect(block).toMatch(/Load more/)
  })

  it('renders newest-first as returned by the API — no client-side re-sort that could invert the server\'s created_at DESC ordering', () => {
    const start = pageCode.indexOf('function ItemActivity(')
    const end = pageCode.indexOf('\nfunction ItemDrawer(', start)
    const block = pageCode.slice(start, end)
    expect(block).not.toMatch(/\.sort\(/)
  })

  it('renders through describeActivityEvent for every event — event-type handling lives in the shared formatter, not scattered inline switch/if-else logic in the component', () => {
    const start = pageCode.indexOf('function ItemActivity(')
    const end = pageCode.indexOf('\nfunction ItemDrawer(', start)
    const block = pageCode.slice(start, end)
    expect(block).toMatch(/describeActivityEvent\(ev, groupNamesById\)/)
    expect(block).not.toMatch(/event_type === ['"]item\./)
  })
})

describe('ItemDrawer — extended cleanly, not redesigned', () => {
  const start = pageCode.indexOf('function ItemDrawer(')
  const end = pageCode.indexOf('\nfunction Field(', start)
  const block = pageCode.slice(start, end)

  it('accepts groupNamesById as a new prop, sourced from the board\'s own groups — not an independent fetch inside the drawer', () => {
    expect(block).toMatch(/groupNamesById: Record<string, string>/)
  })

  it('renders exactly one ItemActivity, scoped to this item and reactive to its updated_at', () => {
    const matches = block.match(/<ItemActivity /g) ?? []
    expect(matches).toHaveLength(1)
    expect(block).toMatch(/<ItemActivity key=\{`\$\{item\.id\}:\$\{item\.updated_at\}`\} itemId=\{item\.id\} updatedAt=\{item\.updated_at\} groupNamesById=\{groupNamesById\} \/>/)
  })

  it('is keyed by itemId:updated_at — a fresh instance mounts (loading/error/events reset naturally) whenever either changes, rather than the effect resetting state imperatively', () => {
    expect(block).toMatch(/key=\{`\$\{item\.id\}:\$\{item\.updated_at\}`\}/)
  })

  it('the pre-existing Files and Updates sections are unchanged — Activity was added alongside them, not in place of either', () => {
    expect(block).toContain('Files')
    expect(block).toContain('+ Attach file')
    expect(block).toContain('Updates')
    expect(block).toContain('Post update')
  })

  it('the drawer still performs no session/capability/auth logic and no direct DB access of its own — activity is read through the fetch above, same as Files/Updates', () => {
    expect(block).not.toMatch(/requireSession|requireCapability|checkCapability/)
    expect(block).not.toMatch(/from '@\/lib\/db'/)
  })
})

describe('OrganiserPageContent — groupNamesById is derived, not independently fetched', () => {
  it('groupNamesById is built via useMemo from boardData.groups only, no new network call introduced for it', () => {
    const start = pageCode.indexOf('const groupNamesById = useMemo(')
    const end = pageCode.indexOf('}, [boardData?.groups]);', start)
    expect(start).toBeGreaterThan(-1)
    const block = pageCode.slice(start, end)
    expect(block).toMatch(/boardData\?\.groups/)
    expect(block).not.toMatch(/fetch\(/)
  })

  it('is passed into ItemDrawer only when the drawer is actually open (drawerItem is truthy) — activity is never fetched for a closed drawer', () => {
    const idx = pageCode.indexOf('{drawerItem && (')
    expect(idx).toBeGreaterThan(-1)
    const block = pageCode.slice(idx, idx + 300)
    expect(block).toMatch(/<ItemDrawer item=\{drawerItem\}[\s\S]*groupNamesById=\{groupNamesById\}/)
  })
})

describe('lib/organiser/activityFormat.ts is imported, not duplicated inline', () => {
  it('page.tsx contains no second FIELD_LABELS-shaped map or duplicated formatFieldValue-style switch', () => {
    expect(pageCode).not.toMatch(/FIELD_LABELS/)
    expect(pageCode).not.toMatch(/function formatFieldValue/)
    expect(pageCode).not.toMatch(/function formatFieldLabel/)
  })
})

describe('No new write path introduced anywhere in the drawer for activity', () => {
  it('the Activity section performs no POST/PATCH/DELETE call of its own — read-only, same append-only guarantee as the API', () => {
    const start = pageCode.indexOf('function ItemActivity(')
    const end = pageCode.indexOf('\nfunction ItemDrawer(', start)
    const block = pageCode.slice(start, end)
    expect(block).not.toMatch(/method:\s*["'](POST|PATCH|PUT|DELETE)["']/)
  })
})
