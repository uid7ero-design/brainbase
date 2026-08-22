import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// ── Founder OS Phase D — Real Tasks & Action Management ─────────────────────
//
// Founder tasks are NOT a new table. They are the same organiser_boards /
// organiser_items tables the canonical /command/organiser UI reads and
// writes, resolved server-side to BrainBase's own org+board via
// lib/founder/tasksBoard.ts (deliberately ignoring org_override
// impersonation — Founder OS's own tasks always mean BrainBase's own
// tasks). This file proves: no demo/mock fallback, super_admin enforcement,
// tenant-boundary preservation, create/update/completion persistence,
// deterministic due-date grouping, and that nothing outside this phase's
// four new files + the two founder/page.tsx call sites was touched.

const getAuthSessionMock = vi.fn()
vi.mock('@/lib/authSession', () => ({
  getAuthSession: (...args: unknown[]) => getAuthSessionMock(...args),
}))

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

// sqlMock's own inferred call signature takes zero args (only its wrapper
// above forwards them), so .mock.calls entries type as `[]` — cast through
// `unknown` to inspect the real runtime arguments each call received.
function sqlCallArgs(index: number): unknown[] {
  return sqlMock.mock.calls[index] as unknown as unknown[]
}

const { GET, POST } = await import('@/app/api/founder/tasks/route')
const { PATCH } = await import('@/app/api/founder/tasks/[itemId]/route')
const { POST: POST_BOARD } = await import('@/app/api/founder/tasks/board/route')

const TASKS_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/tasks/route.ts'), 'utf-8')
const ITEM_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/tasks/[itemId]/route.ts'), 'utf-8')
const BOARD_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/tasks/board/route.ts'), 'utf-8')
const TASKS_BOARD_LIB_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../lib/founder/tasksBoard.ts'), 'utf-8')
const FOUNDER_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'), 'utf-8')
const ATTN_QUEUE_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/attention-queue/route.ts'), 'utf-8')
const ORGANISER_BOARDS_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/boards/route.ts'), 'utf-8')
const IMPLEMENTATIONS_ROUTE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/api/implementations/route.ts'), 'utf-8')

// Scoped to executable code, not this file's own explanatory prose (the
// tasksBoard.ts/board/route.ts comments legitimately name WORK/Tafe when
// explaining why they must never be selected — same established pattern as
// founderTrustBoundaryHardening.test.ts).
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}
const TASKS_BOARD_LIB_EXECUTABLE = stripComments(TASKS_BOARD_LIB_SOURCE)
const BOARD_ROUTE_EXECUTABLE = stripComments(BOARD_ROUTE_SOURCE)

function utcDateString(offsetDays: number): string {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays))
  return d.toISOString().slice(0, 10)
}

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

const SUPER_ADMIN = { role: 'super_admin', organisationId: 'org-caller', userId: 'u1' }
const BOARD = { id: 'board-1', name: 'Founder Tasks' }
const ORG_ROW = [{ id: 'org-brainbase' }]
const BOARD_ROW = [{ id: BOARD.id, name: BOARD.name }]

beforeEach(() => {
  getAuthSessionMock.mockReset()
  sqlMock.mockClear()
  responseQueue = []
  callCount = 0
})

// ── 1. No demo/mock task fallback ───────────────────────────────────────────

describe('No demo/mock task data', () => {
  it('the old static "not connected" FounderTasks placeholder function is gone', () => {
    expect(FOUNDER_PAGE_SOURCE).not.toMatch(/function FounderTasks\(\)\s*\{/)
  })

  it('both call sites use the new real components, not the retired placeholder', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain('<FounderTaskSummary />')
    expect(FOUNDER_PAGE_SOURCE).toContain('<FounderTasksPanel />')
    expect(FOUNDER_PAGE_SOURCE).not.toMatch(/<FounderTasks\s*\/>/)
  })

  it('no fabricated fields: no AI priority score, progress percentage, or fake-owner/fake-deadline constant anywhere in the new task routes', () => {
    for (const src of [TASKS_ROUTE_SOURCE, ITEM_ROUTE_SOURCE, BOARD_ROUTE_SOURCE]) {
      expect(src).not.toMatch(/aiScore|progressPercent|fakeOwner|MOCK_TASK|DEMO_TASK/i)
    }
  })

  it('both UI components fetch the real endpoint, not a local constant array', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("fetch('/api/founder/tasks')")
  })
})

// ── 2. Tasks originate from the authoritative Organiser tables ─────────────

describe('Tasks are sourced from organiser_boards / organiser_items — no second task table', () => {
  it('GET reads organiser_items scoped to the resolved board', () => {
    expect(TASKS_ROUTE_SOURCE).toContain('FROM organiser_items')
    expect(TASKS_ROUTE_SOURCE).toContain('WHERE board_id = ${board.id} AND organisation_id = ${orgId} AND parent_item_id IS NULL')
  })

  it('POST inserts into organiser_items, not a new table', () => {
    expect(TASKS_ROUTE_SOURCE).toContain('INSERT INTO organiser_items')
  })

  it('PATCH updates organiser_items, scoped to id + board + organisation', () => {
    expect(ITEM_ROUTE_SOURCE).toContain('UPDATE organiser_items SET')
    expect(ITEM_ROUTE_SOURCE).toContain('WHERE id = ${itemId} AND board_id = ${board.id} AND organisation_id = ${orgId}')
  })

  it('board creation inserts into organiser_boards, not a bespoke founder-boards table', () => {
    expect(BOARD_ROUTE_SOURCE).toContain('INSERT INTO organiser_boards')
  })

  it('the board resolver reads organiser_boards by exact name only — never by position/order, never guesses/hardcodes an id', () => {
    expect(TASKS_BOARD_LIB_SOURCE).toContain('FROM organiser_boards')
    expect(TASKS_BOARD_LIB_SOURCE).toContain("const FOUNDER_BOARD_NAME = 'Founder Tasks';")
    expect(TASKS_BOARD_LIB_SOURCE).toContain('WHERE organisation_id = ${organisationId} AND name = ${FOUNDER_BOARD_NAME}')
    expect(TASKS_BOARD_LIB_SOURCE).not.toContain('ORDER BY position')
  })
})

// ── 3. Founder UI/API `title` maps to organiser_items.name (regression lock) ─
// organiser_items has no `title` column at all (Production schema: name text
// NOT NULL; no title column exists). The Founder task API's external field
// is named `title` for UX clarity, but every read/write must translate it
// to/from the real `name` column — never write/read a nonexistent `title`
// column.

describe('title (API/UI field) <-> organiser_items.name (DB column) mapping', () => {
  beforeEach(() => getAuthSessionMock.mockResolvedValue(SUPER_ADMIN))

  it('none of the three routes ever reference organiser_items.title or a bare "title" SQL column', () => {
    for (const src of [TASKS_ROUTE_SOURCE, ITEM_ROUTE_SOURCE, BOARD_ROUTE_SOURCE]) {
      expect(src).not.toContain('organiser_items.title')
      expect(src).not.toMatch(/INSERT INTO organiser_items \([^)]*\btitle\b/)
      expect(src).not.toMatch(/SET[\s\S]*?\btitle\b\s*=/)
    }
  })

  it('POST writes the submitted title into the INSERT column list as `name`', () => {
    expect(TASKS_ROUTE_SOURCE).toContain('board_id, organisation_id, group_id, parent_item_id, name, status,')
    expect(TASKS_ROUTE_SOURCE).toContain('${board.id}, ${orgId}, NULL, NULL, ${title}, ${STATUS_OPTIONS[0]},')
  })

  it('PATCH writes an updated title into the `name` column via COALESCE, not a `title` column', () => {
    expect(ITEM_ROUTE_SOURCE).toContain('name       = COALESCE(${title ?? null}, name),')
  })

  it('GET/POST/PATCH all map the DB row back to title: row.name in their response shaping', () => {
    expect(TASKS_ROUTE_SOURCE).toContain('title: row.name as string,')
    expect(ITEM_ROUTE_SOURCE).toContain('title: row.name,')
  })

  it('functional: a created task\'s title is actually persisted as the `name` value in the real INSERT call, not lost or misdirected to a title column', async () => {
    queue(
      ORG_ROW, BOARD_ROW, [{ next: 0 }],
      [{ id: 'item-name-check', name: 'Persisted via name column', status: 'Not Started', priority: null, owner: null, due_date: null, notes: null, created_at: '2026-08-22T00:00:00Z', updated_at: '2026-08-22T00:00:00Z' }],
    )
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ title: 'Persisted via name column' }) })
    const res = await POST(req)
    const insertCall = sqlCallArgs(3)
    expect(insertCall.slice(1)).toContain('Persisted via name column')
    const json = await res.json()
    expect(json.task.title).toBe('Persisted via name column')
  })

  it('functional: an updated title is passed through PATCH\'s UPDATE call and returned as task.title', async () => {
    queue(
      ORG_ROW, BOARD_ROW, [{ id: 'i1' }],
      [{ id: 'i1', name: 'Renamed task', status: 'Not Started', priority: null, owner: null, due_date: null, notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-22T00:00:00Z' }],
    )
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ title: 'Renamed task' }) })
    const res = await PATCH(req, { params: Promise.resolve({ itemId: 'i1' }) })
    const updateCall = sqlCallArgs(3)
    expect(updateCall.slice(1)).toContain('Renamed task')
    const json = await res.json()
    expect(json.task.title).toBe('Renamed task')
  })
})

// ── 4. Super_admin enforcement across all four endpoints ───────────────────

describe('Founder task endpoints are super_admin-only', () => {
  it('GET /api/founder/tasks: 401 with no session, 403 for admin, no sql call in either case', async () => {
    getAuthSessionMock.mockRejectedValue(new Error('Unauthorized'))
    expect((await GET()).status).toBe(401)
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-1', userId: 'u1' })
    expect((await GET()).status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('POST /api/founder/tasks: 401/403 gating', async () => {
    getAuthSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ title: 'x' }) })
    expect((await POST(req)).status).toBe(401)
    getAuthSessionMock.mockResolvedValue({ role: 'viewer', organisationId: 'org-1', userId: 'u1' })
    expect((await POST(req)).status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('PATCH /api/founder/tasks/[itemId]: 401/403 gating', async () => {
    getAuthSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ status: 'Done' }) })
    expect((await PATCH(req, { params: Promise.resolve({ itemId: 'i1' }) })).status).toBe(401)
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-1', userId: 'u1' })
    expect((await PATCH(req, { params: Promise.resolve({ itemId: 'i1' }) })).status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('POST /api/founder/tasks/board: 401/403 gating', async () => {
    getAuthSessionMock.mockRejectedValue(new Error('Unauthorized'))
    expect((await POST_BOARD()).status).toBe(401)
    getAuthSessionMock.mockResolvedValue({ role: 'admin', organisationId: 'org-1', userId: 'u1' })
    expect((await POST_BOARD()).status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

// ── 5. Tenant-boundary preservation ─────────────────────────────────────────

describe('Tenant boundary: BrainBase org resolution ignores any caller-supplied org context', () => {
  it('resolveBrainbaseOrgId takes zero parameters — a caller (impersonating or not) cannot influence which org it resolves', () => {
    expect(TASKS_BOARD_LIB_SOURCE).toMatch(/export async function resolveBrainbaseOrgId\(\): Promise<string \| null> \{/)
  })

  it('resolveBrainbaseOrgId resolves by a fixed slug lookup, not session.organisationId or a request parameter', () => {
    expect(TASKS_BOARD_LIB_SOURCE).toContain("const BRAINBASE_SLUG = 'brainbase';")
    expect(TASKS_BOARD_LIB_SOURCE).toContain('WHERE slug = ${BRAINBASE_SLUG}')
  })

  it('none of the three task routes reference session.organisationId when resolving org context', () => {
    for (const src of [TASKS_ROUTE_SOURCE, ITEM_ROUTE_SOURCE, BOARD_ROUTE_SOURCE]) {
      expect(src).not.toContain('session.organisationId')
    }
  })

  it('GET never trusts a client-supplied organisation filter (no searchParams/body read)', () => {
    expect(TASKS_ROUTE_SOURCE).not.toContain('searchParams')
  })

  it('a super_admin impersonating another org (organisationId: "org-other-tenant") still resolves BrainBase tasks, not the impersonated org', async () => {
    getAuthSessionMock.mockResolvedValue({ role: 'super_admin', organisationId: 'org-other-tenant', userId: 'u1' })
    queue(ORG_ROW, BOARD_ROW, [])
    await GET()
    // First sql call resolves the org by slug — independent of session.organisationId.
    const firstCallStrings = (sqlCallArgs(0)[0] as TemplateStringsArray).join('')
    expect(firstCallStrings).toContain('FROM organisations')
    expect(firstCallStrings).toContain('WHERE slug =')
  })

  it('PATCH scopes its existence check and update to the resolved board+org, not any board the caller names', () => {
    expect(ITEM_ROUTE_SOURCE).toContain('SELECT id FROM organiser_items')
    expect(ITEM_ROUTE_SOURCE).toContain('WHERE id = ${itemId} AND board_id = ${board.id} AND organisation_id = ${orgId}')
  })
})

// ── 6. Task creation persists correctly ─────────────────────────────────────

describe('POST /api/founder/tasks — creation', () => {
  beforeEach(() => getAuthSessionMock.mockResolvedValue(SUPER_ADMIN))

  it('rejects an empty title with 400 and touches no DB', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ title: '  ' }) })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns 409 when no Founder Tasks board exists yet (does not silently seed one)', async () => {
    queue(ORG_ROW, [])
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ title: 'Ship it' }) })
    const res = await POST(req)
    expect(res.status).toBe(409)
  })

  it('persists a task with the full field set and returns it', async () => {
    queue(
      ORG_ROW, BOARD_ROW, [{ next: 0 }],
      [{
        id: 'item-1', name: 'Ship it', status: 'Not Started', priority: 'High', owner: 'James',
        due_date: '2026-09-01', notes: 'ship notes', created_at: '2026-08-22T00:00:00Z', updated_at: '2026-08-22T00:00:00Z',
      }],
    )
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ title: 'Ship it', priority: 'High', owner: 'James', due_date: '2026-09-01', notes: 'ship notes' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.task).toMatchObject({
      id: 'item-1', title: 'Ship it', status: 'Not Started', priority: 'High', owner: 'James',
      dueDate: '2026-09-01', notes: 'ship notes',
    })
  })

  it('silently drops an invalid priority rather than rejecting the whole task', async () => {
    queue(
      ORG_ROW, BOARD_ROW, [{ next: 0 }],
      [{ id: 'item-2', name: 'x', status: 'Not Started', priority: null, owner: null, due_date: null, notes: null, created_at: '2026-08-22T00:00:00Z', updated_at: '2026-08-22T00:00:00Z' }],
    )
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ title: 'x', priority: 'not-a-real-priority' }) })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.task.priority).toBeNull()
  })
})

// ── 7. Task update persists correctly / completion & reopen semantics ──────

describe('PATCH /api/founder/tasks/[itemId] — update, completion, reopen', () => {
  beforeEach(() => getAuthSessionMock.mockResolvedValue(SUPER_ADMIN))

  it('rejects an invalid status with 400', async () => {
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ status: 'not-a-status' }) })
    const res = await PATCH(req, { params: Promise.resolve({ itemId: 'i1' }) })
    expect(res.status).toBe(400)
  })

  it('rejects an invalid priority with 400', async () => {
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ priority: 'not-a-priority' }) })
    const res = await PATCH(req, { params: Promise.resolve({ itemId: 'i1' }) })
    expect(res.status).toBe(400)
  })

  it('returns 404 when the item does not exist within the resolved board+org (defense in depth)', async () => {
    queue(ORG_ROW, BOARD_ROW, [])
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ status: 'Done' }) })
    const res = await PATCH(req, { params: Promise.resolve({ itemId: 'ghost' }) })
    expect(res.status).toBe(404)
  })

  it('marking a task Done persists (completion)', async () => {
    queue(
      ORG_ROW, BOARD_ROW, [{ id: 'i1' }],
      [{ id: 'i1', name: 'x', status: 'Done', priority: null, owner: null, due_date: null, notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-22T00:00:00Z' }],
    )
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ status: 'Done' }) })
    const res = await PATCH(req, { params: Promise.resolve({ itemId: 'i1' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.task.status).toBe('Done')
  })

  it('reopening (Done -> Not Started) persists', async () => {
    queue(
      ORG_ROW, BOARD_ROW, [{ id: 'i1' }],
      [{ id: 'i1', name: 'x', status: 'Not Started', priority: null, owner: null, due_date: null, notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-22T00:00:00Z' }],
    )
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ status: 'Not Started' }) })
    const res = await PATCH(req, { params: Promise.resolve({ itemId: 'i1' }) })
    const json = await res.json()
    expect(json.task.status).toBe('Not Started')
  })

  it('an explicit null owner genuinely clears the owner (distinct from omitting the field)', async () => {
    queue(
      ORG_ROW, BOARD_ROW, [{ id: 'i1' }],
      [{ id: 'i1', name: 'x', status: 'Not Started', priority: null, owner: null, due_date: null, notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-22T00:00:00Z' }],
    )
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ owner: null }) })
    const res = await PATCH(req, { params: Promise.resolve({ itemId: 'i1' }) })
    const json = await res.json()
    expect(json.task.owner).toBeNull()
  })
})

// ── 8. Deterministic due-date grouping ──────────────────────────────────────

describe('GET /api/founder/tasks — due-date grouping is deterministic', () => {
  beforeEach(() => getAuthSessionMock.mockResolvedValue(SUPER_ADMIN))

  it('buckets overdue / today / upcoming / no-due-date correctly, and Done always wins into completed regardless of due date', async () => {
    queue(ORG_ROW, BOARD_ROW, [
      { id: 'a', name: 'Overdue task', status: 'Not Started', priority: null, owner: null, due_date: utcDateString(-3), notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
      { id: 'b', name: 'Today task', status: 'Working on it', priority: null, owner: null, due_date: utcDateString(0), notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
      { id: 'c', name: 'Upcoming task', status: 'Not Started', priority: null, owner: null, due_date: utcDateString(5), notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
      { id: 'd', name: 'No due date task', status: 'Not Started', priority: null, owner: null, due_date: null, notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
      { id: 'e', name: 'Done but overdue', status: 'Done', priority: null, owner: null, due_date: utcDateString(-10), notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
    ])
    const res = await GET()
    const json = await res.json()
    expect(json.groups.overdue.map((t: { id: string }) => t.id)).toEqual(['a'])
    expect(json.groups.today.map((t: { id: string }) => t.id)).toEqual(['b'])
    expect(json.groups.upcoming.map((t: { id: string }) => t.id)).toEqual(['c'])
    expect(json.groups.noDueDate.map((t: { id: string }) => t.id)).toEqual(['d'])
    expect(json.groups.completed.map((t: { id: string }) => t.id)).toEqual(['e'])
  })

  it('reports board: null and all-empty groups honestly when no Founder Tasks board exists — no fabricated fallback data', async () => {
    queue(ORG_ROW, [])
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.board).toBeNull()
    expect(json.groups).toEqual({ overdue: [], today: [], upcoming: [], noDueDate: [], completed: [] })
  })
})

// ── 9. Board creation is explicit, idempotent, never silent ────────────────

describe('POST /api/founder/tasks/board — explicit, founder-initiated only', () => {
  beforeEach(() => getAuthSessionMock.mockResolvedValue(SUPER_ADMIN))

  it('is a deliberate no-op (409) if a board already exists — never creates a second board', async () => {
    queue(ORG_ROW, BOARD_ROW)
    const res = await POST_BOARD()
    expect(res.status).toBe(409)
  })

  it('creates exactly one board named "Founder Tasks" when none exists, appended after existing boards (not hardcoded position 0)', async () => {
    // org, existing-board check (none), position query (WORK/Tafe already
    // occupy 0/1 in Production — this must append, never collide), insert.
    queue(ORG_ROW, [], [{ next: 2 }], BOARD_ROW)
    const res = await POST_BOARD()
    expect(res.status).toBe(201)
    const positionCallStrings = (sqlCallArgs(2)[0] as TemplateStringsArray).join('')
    expect(positionCallStrings).toContain('COALESCE(MAX(position), -1) + 1')
    const insertCallStrings = (sqlCallArgs(3)[0] as TemplateStringsArray).join('')
    expect(insertCallStrings).toContain('INSERT INTO organiser_boards')
  })

  it('the board name passed to INSERT is the exact FOUNDER_BOARD_NAME constant, not a literal that could drift from the resolver', () => {
    expect(BOARD_ROUTE_SOURCE).toContain("VALUES (${orgId}, ${FOUNDER_BOARD_NAME}, ${position}, ${session.userId})")
    expect(BOARD_ROUTE_SOURCE).not.toMatch(/VALUES \([^)]*'Founder Tasks'/)
  })

  it('never hardcodes position 0 — WORK already occupies position 0 in Production', () => {
    expect(BOARD_ROUTE_SOURCE).not.toMatch(/VALUES\s*\(\$\{orgId\},\s*\$\{FOUNDER_BOARD_NAME\},\s*0,/)
  })
})

// ── 10. WORK/Tafe invisibility — critical tenant/data-boundary regression ──
// Production verification (post-Phase-D) found BrainBase's org already has
// two other real, populated Organiser boards: "WORK" (id
// e7d4f5c0-d73d-4391-b3e5-935d7f2a2e7f, position 0, containing real items
// including an overdue one) and "Tafe" (id
// 928c00cd-32d9-40de-802e-ea9ab09359c6, position 1). This section locks
// down that Founder Tasks can never read, return, adopt, or alter either
// board, regardless of their position or content. The exact-name SQL
// predicate itself was additionally verified directly against a disposable
// Postgres instance seeded with these exact Production ids/names/items
// (see the correction report) — that is the authoritative proof of the SQL
// filtering; the tests below lock down the application-layer contract that
// feeds that predicate and consumes its result.

describe('Critical tenant/data-boundary regression: WORK and Tafe are structurally invisible to Founder Tasks', () => {
  const WORK_BOARD_ID = 'e7d4f5c0-d73d-4391-b3e5-935d7f2a2e7f'
  const TAFE_BOARD_ID = '928c00cd-32d9-40de-802e-ea9ab09359c6'
  const FOUNDER_BOARD_ID = 'c9a1a111-1111-4111-8111-111111111111'

  beforeEach(() => getAuthSessionMock.mockResolvedValue(SUPER_ADMIN))

  it('the board resolver filters by name only — WORK/Tafe are named nowhere in the executable resolution logic', () => {
    expect(TASKS_BOARD_LIB_EXECUTABLE).not.toContain('WORK')
    expect(TASKS_BOARD_LIB_EXECUTABLE).not.toContain('Tafe')
    expect(TASKS_BOARD_LIB_EXECUTABLE).toContain('name = ${FOUNDER_BOARD_NAME}')
  })

  it('board creation never reads, alters, or references WORK/Tafe by name in its executable logic', () => {
    expect(BOARD_ROUTE_EXECUTABLE).not.toContain('WORK')
    expect(BOARD_ROUTE_EXECUTABLE).not.toContain('Tafe')
  })

  it('when only WORK/Tafe exist (no exact "Founder Tasks" board resolves), GET returns an honest board: null — WORK is never adopted as a fallback', async () => {
    queue(ORG_ROW, [])
    const res = await GET()
    const json = await res.json()
    expect(json.board).toBeNull()
    expect(json.groups).toEqual({ overdue: [], today: [], upcoming: [], noDueDate: [], completed: [] })
  })

  it('WORK may contain overdue items, but Founder Tasks returns none of them when Founder Tasks itself has none — no cross-board leakage into the response', async () => {
    // Simulates: resolver finds the (separately, exact-name-matched)
    // Founder Tasks board, which happens to have zero items of its own.
    // WORK's own overdue item ("Speak to Brenton...") is never queried by
    // this code path at all — the items SELECT is scoped to the resolved
    // board id only (see the next test), so it structurally cannot surface.
    queue(ORG_ROW, [{ id: FOUNDER_BOARD_ID, name: 'Founder Tasks' }], [])
    const res = await GET()
    const json = await res.json()
    expect(json.groups.overdue).toEqual([])
  })

  it('the items query is scoped to the resolved Founder Tasks board id only — the WORK/Tafe ids are never passed as query parameters', async () => {
    queue(ORG_ROW, [{ id: FOUNDER_BOARD_ID, name: 'Founder Tasks' }], [])
    await GET()
    const itemsCall = sqlCallArgs(2)
    const values = itemsCall.slice(1)
    expect(values).toContain(FOUNDER_BOARD_ID)
    expect(values).not.toContain(WORK_BOARD_ID)
    expect(values).not.toContain(TAFE_BOARD_ID)
  })

  it('POST board creation does not alter/adopt WORK: given WORK/Tafe exist but no exact "Founder Tasks" board, it creates a new board rather than returning/renaming WORK', async () => {
    queue(ORG_ROW, [], [{ next: 2 }], [{ id: FOUNDER_BOARD_ID, name: 'Founder Tasks' }])
    const res = await POST_BOARD()
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.board.id).toBe(FOUNDER_BOARD_ID)
    expect(json.board.id).not.toBe(WORK_BOARD_ID)
    expect(json.board.id).not.toBe(TAFE_BOARD_ID)
    expect(json.board.name).toBe('Founder Tasks')
  })

  it('repeated board creation calls cannot create a duplicate "Founder Tasks" board — idempotent/conflict-safe', async () => {
    queue(ORG_ROW, [{ id: FOUNDER_BOARD_ID, name: 'Founder Tasks' }])
    const res = await POST_BOARD()
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.board.id).toBe(FOUNDER_BOARD_ID)
  })
})

// ── 11. Existing Founder OS Attention Queue sources remain intact ──────────

describe('Regression: Phase A/C attention-queue endpoint is untouched by Phase D', () => {
  it('the attention-queue route still contains its established source markers', () => {
    expect(ATTN_QUEUE_ROUTE_SOURCE).toContain("const REQUEST_ACTIONABLE_STATUSES = ['new', 'in_progress'];")
    expect(ATTN_QUEUE_ROUTE_SOURCE).toContain('const UPCOMING_WINDOW_DAYS = 14;')
  })

  it('the attention-queue route was not modified to reference organiser_items/founder tasks', () => {
    expect(ATTN_QUEUE_ROUTE_SOURCE).not.toContain('organiser_items')
    expect(ATTN_QUEUE_ROUTE_SOURCE).not.toContain('founder/tasks')
  })
})

// ── 12. Phase C implementation intelligence remains intact ─────────────────

describe('Regression: Client Implementations next_action is untouched by Phase D', () => {
  it('implementations route still reads/writes next_action — not migrated or removed', () => {
    expect(IMPLEMENTATIONS_ROUTE_SOURCE).toContain('next_action')
  })

  it('no founder task route references implementations or next_action — linkage is deliberately deferred, not half-built', () => {
    for (const src of [TASKS_ROUTE_SOURCE, ITEM_ROUTE_SOURCE, BOARD_ROUTE_SOURCE]) {
      expect(src).not.toContain('next_action')
      expect(src).not.toContain('implementation_id')
    }
  })
})

// ── 13. No unrelated Organiser behaviour was changed ────────────────────────

describe('Regression: the generic Organiser API is untouched by the Founder task adapter', () => {
  it('organiser boards route still uses its own impersonation-aware requireRole auth, unchanged', () => {
    expect(ORGANISER_BOARDS_ROUTE_SOURCE).toContain("requireRole('viewer')")
  })

  it('the organiser boards route does not reference the new founder-specific adapter', () => {
    expect(ORGANISER_BOARDS_ROUTE_SOURCE).not.toContain('resolveBrainbaseOrgId')
    expect(ORGANISER_BOARDS_ROUTE_SOURCE).not.toContain('lib/founder/tasksBoard')
  })
})
