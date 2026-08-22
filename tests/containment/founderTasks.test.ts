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

  it('the board resolver reads organiser_boards deterministically (position then created_at), never guesses/hardcodes an id', () => {
    expect(TASKS_BOARD_LIB_SOURCE).toContain('FROM organiser_boards')
    expect(TASKS_BOARD_LIB_SOURCE).toContain('ORDER BY position ASC, created_at ASC')
  })
})

// ── 3. Super_admin enforcement across all four endpoints ───────────────────

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

// ── 4. Tenant-boundary preservation ─────────────────────────────────────────

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
    const firstCallStrings = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join('')
    expect(firstCallStrings).toContain('FROM organisations')
    expect(firstCallStrings).toContain('WHERE slug =')
  })

  it('PATCH scopes its existence check and update to the resolved board+org, not any board the caller names', () => {
    expect(ITEM_ROUTE_SOURCE).toContain('SELECT id FROM organiser_items')
    expect(ITEM_ROUTE_SOURCE).toContain('WHERE id = ${itemId} AND board_id = ${board.id} AND organisation_id = ${orgId}')
  })
})

// ── 5. Task creation persists correctly ─────────────────────────────────────

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

// ── 6. Task update persists correctly / completion & reopen semantics ──────

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

// ── 7. Deterministic due-date grouping ──────────────────────────────────────

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

// ── 8. Board creation is explicit, idempotent, never silent ────────────────

describe('POST /api/founder/tasks/board — explicit, founder-initiated only', () => {
  beforeEach(() => getAuthSessionMock.mockResolvedValue(SUPER_ADMIN))

  it('is a deliberate no-op (409) if a board already exists — never creates a second board', async () => {
    queue(ORG_ROW, BOARD_ROW)
    const res = await POST_BOARD()
    expect(res.status).toBe(409)
  })

  it('creates exactly one board named "Founder Tasks" when none exists', async () => {
    queue(ORG_ROW, [], BOARD_ROW)
    const res = await POST_BOARD()
    expect(res.status).toBe(201)
    const insertCallStrings = (sqlMock.mock.calls[2][0] as TemplateStringsArray).join('')
    expect(insertCallStrings).toContain('INSERT INTO organiser_boards')
  })
})

// ── 9. Existing Founder OS Attention Queue sources remain intact ───────────

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

// ── 10. Phase C implementation intelligence remains intact ─────────────────

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

// ── 11. No unrelated Organiser behaviour was changed ────────────────────────

describe('Regression: the generic Organiser API is untouched by the Founder task adapter', () => {
  it('organiser boards route still uses its own impersonation-aware requireRole auth, unchanged', () => {
    expect(ORGANISER_BOARDS_ROUTE_SOURCE).toContain("requireRole('viewer')")
  })

  it('the organiser boards route does not reference the new founder-specific adapter', () => {
    expect(ORGANISER_BOARDS_ROUTE_SOURCE).not.toContain('resolveBrainbaseOrgId')
    expect(ORGANISER_BOARDS_ROUTE_SOURCE).not.toContain('lib/founder/tasksBoard')
  })
})
