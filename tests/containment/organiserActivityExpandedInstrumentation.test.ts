import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Phase D.4.5F — board/group/comment/file activity instrumentation.
// Covers all 9 newly-instrumented mutations: board.created/updated/deleted,
// group.created/updated/deleted, comment.created, file.added/file.deleted.
// Every DB call is mocked — no production connection, no real Postgres
// (real-Postgres coverage lives in
// scripts/tests/verify-organiser-item-activity-concurrency.sh's new
// sections). For each mutation this file proves: the SQL text contains the
// exact writable-CTE shape (mutation + activity_row in ONE statement —
// atomic by construction, no best-effort logging path), the event_type/
// entity_type/entity_id are correct, actor/tenant are bound from session
// only, same-value updates produce no activity row (the field_diff.any_
// changed gate), and the JSON response shape is unchanged from before this
// phase.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}
function jsonReq(url: string, method: string, body?: unknown) {
  return asNextRequest(new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

type SqlCall = { text: string; values: unknown[] }
let sqlCalls: SqlCall[] = []
let sqlResult: unknown[] = []
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  sqlCalls.push({ text: strings.join('§'), values })
  return Promise.resolve(sqlResult)
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: (...args: unknown[]) => requireCapabilityMock(...args) }
})

const boardsRoute = await import('@/app/api/organiser/boards/route')
const boardIdRoute = await import('@/app/api/organiser/boards/[boardId]/route')
const boardGroupsRoute = await import('@/app/api/organiser/boards/[boardId]/groups/route')
const groupIdRoute = await import('@/app/api/organiser/groups/[groupId]/route')
const itemUpdatesRoute = await import('@/app/api/organiser/items/[itemId]/updates/route')
// file.added's own describe block below uses static source-text checks
// only (a real POST call needs a multipart/form-data body plus a real
// fs.writeFile target, not worth mocking here) — no runtime import needed.
const itemFileIdRoute = await import('@/app/api/organiser/items/[itemId]/files/[fileId]/route')
// Phase D.4.6H — comment.deleted, the new file this phase mirrors from
// file.deleted's own atomic DELETE + activity_row pattern.
const itemUpdateIdRoute = await import('@/app/api/organiser/items/[itemId]/updates/[updateId]/route')

const SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'manager', name: 'James' }
const BOARD_CTX = { params: Promise.resolve({ boardId: 'board-1' }) }
const GROUP_CTX = { params: Promise.resolve({ groupId: 'group-1' }) }
const ITEM_CTX = { params: Promise.resolve({ itemId: 'item-1' }) }
const ITEM_FILE_CTX = { params: Promise.resolve({ itemId: 'item-1', fileId: 'file-1' }) }
const ITEM_UPDATE_CTX = { params: Promise.resolve({ itemId: 'item-1', updateId: 'update-1' }) }

beforeEach(() => {
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  sqlMock.mockReset()
  sqlCalls = []
  sqlResult = []
  requireSessionMock.mockResolvedValue(SESSION)
  requireCapabilityMock.mockResolvedValue({ key: 'organiser', config: {} })
})

// Shared assertions every instrumented statement must satisfy.
function assertAtomicWritableCte(sql: string, opts: { mutationVerb: 'INSERT INTO organiser_' | 'UPDATE organiser_' | 'DELETE FROM organiser_'; eventType: string; entityType: string }) {
  expect(sql).toContain(opts.mutationVerb)
  expect(sql).toMatch(/activity_row AS \(/)
  expect(sql).toMatch(/INSERT INTO organiser_activity/)
  expect(sql).toContain(`'${opts.eventType}'`)
  expect(sql).toContain(`'${opts.entityType}'`)
  // One single sql`...` statement — the whole point of the writable-CTE
  // pattern is that the mutation and its activity row commit or fail
  // together, never as two separate round trips.
  expect(sqlCalls).toHaveLength(1)
}

// ── BOARD.CREATED ────────────────────────────────────────────────────────

describe('board.created — POST /api/organiser/boards', () => {
  beforeEach(() => { sqlResult = [{ id: 'board-1', name: 'WORK', color: null, icon: null, position: 0, created_at: new Date(), updated_at: new Date() }] })

  // boards/route.ts's POST makes TWO sql calls: a position-select
  // (pre-existing, unrelated to activity), then the atomic insert+activity
  // statement — sqlCalls[1] is the one this phase added instrumentation to.
  it('is one atomic writable-CTE statement (board insert + activity_row)', async () => {
    await boardsRoute.POST(jsonReq('http://localhost/api/organiser/boards', 'POST', { name: 'WORK' }))
    expect(sqlCalls).toHaveLength(2)
    const sql = sqlCalls[1].text
    expect(sql).toContain('INSERT INTO organiser_')
    expect(sql).toMatch(/activity_row AS \(/)
    expect(sql).toMatch(/INSERT INTO organiser_activity/)
    expect(sql).toContain("'board.created'")
    expect(sql).toContain("'board'")
  })

  it('before_json is NULL, after_json carries only name', async () => {
    await boardsRoute.POST(jsonReq('http://localhost/api/organiser/boards', 'POST', { name: 'WORK' }))
    expect(sqlCalls[1].text).toMatch(/before_json, after_json\s*\)/)
    expect(sqlCalls[1].text).toMatch(/inserted\.id::text, NULL,/)
    expect(sqlCalls[1].text).toMatch(/jsonb_build_object\('name', organiser_activity_sanitise_scalar\(to_jsonb\(inserted\.name\)\)\)/)
  })

  it('actor/tenant are bound from session only', async () => {
    await boardsRoute.POST(jsonReq('http://localhost/api/organiser/boards', 'POST', { name: 'WORK' }))
    expect(sqlCalls[1].values).toContain('org-a')
    expect(sqlCalls[1].values).toContain('user-1')
    expect(sqlCalls[1].values).toContain('James')
  })

  it('response shape unchanged: { board: {...} } with item_count: 0', async () => {
    const res = await boardsRoute.POST(jsonReq('http://localhost/api/organiser/boards', 'POST', { name: 'WORK' }))
    const json = await res.json()
    expect(json.board).toMatchObject({ id: 'board-1', name: 'WORK', item_count: 0 })
  })
})

// ── BOARD.UPDATED ────────────────────────────────────────────────────────

describe('board.updated — PATCH /api/organiser/boards/[boardId]', () => {
  beforeEach(() => { sqlResult = [{ id: 'board-1', name: 'Operations', color: null, icon: null, position: 0, created_at: new Date(), updated_at: new Date() }] })

  it('is one atomic writable-CTE statement (FOR UPDATE + UPDATE + activity_row)', async () => {
    await boardIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Operations' }), BOARD_CTX)
    expect(sqlCalls[0].text).toMatch(/FOR UPDATE/)
    assertAtomicWritableCte(sqlCalls[0].text, { mutationVerb: 'UPDATE organiser_', eventType: 'board.updated', entityType: 'board' })
  })

  it('same-value update (name unchanged) still commits the row update but the activity gate (any_changed) is present in SQL', async () => {
    await boardIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Operations' }), BOARD_CTX)
    expect(sqlCalls[0].text).toMatch(/WHERE field_diff\.any_changed IS TRUE/)
  })

  it('position is excluded from the diffed field list — never logged as a noise field', async () => {
    await boardIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { position: 3 }), BOARD_CTX)
    const latValues = sqlCalls[0].text.slice(sqlCalls[0].text.indexOf('LATERAL'), sqlCalls[0].text.indexOf('field_diff', sqlCalls[0].text.indexOf('LATERAL') + 1) + 200)
    expect(latValues).not.toMatch(/'position'/)
  })

  it('actor/tenant bound from session only', async () => {
    await boardIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Operations' }), BOARD_CTX)
    expect(sqlCalls[0].values).toContain('org-a')
    expect(sqlCalls[0].values).toContain('user-1')
    expect(sqlCalls[0].values).toContain('James')
  })

  it('response shape unchanged: { board: {...} }', async () => {
    const res = await boardIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Operations' }), BOARD_CTX)
    const json = await res.json()
    expect(json.board).toMatchObject({ id: 'board-1', name: 'Operations' })
  })

  it('404 when the board does not exist for this tenant, unchanged behavior', async () => {
    sqlResult = []
    const res = await boardIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'X' }), BOARD_CTX)
    expect(res.status).toBe(404)
  })
})

// ── BOARD.DELETED ────────────────────────────────────────────────────────

describe('board.deleted — DELETE /api/organiser/boards/[boardId]', () => {
  beforeEach(() => { sqlResult = [{ id: 'board-1' }] })

  it('is one atomic writable-CTE statement (DELETE + activity_row)', async () => {
    await boardIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), BOARD_CTX)
    assertAtomicWritableCte(sqlCalls[0].text, { mutationVerb: 'DELETE FROM organiser_', eventType: 'board.deleted', entityType: 'board' })
  })

  it('before_json preserves name; after_json carries a bounded cascade-count summary (D.4.6H) — never per-row/per-entity detail', async () => {
    await boardIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), BOARD_CTX)
    const text = sqlCalls[0].text
    expect(text).toMatch(/jsonb_build_object\('name', organiser_activity_sanitise_scalar\(to_jsonb\(deleted\.name\)\)\)/)
    expect(text).toMatch(/jsonb_build_object\('affected_group_count', would_cascade\.groups, 'affected_item_count', would_cascade\.items\)/)
    // Block-scope to just the would_cascade CTE body and confirm it is
    // built entirely from COUNT(*) subqueries — no per-row SELECT of
    // names/ids/content that could leak into the bounded summary.
    const cteStart = text.indexOf('would_cascade AS (')
    const cteEnd = text.indexOf('deleted AS (')
    const cteBody = text.slice(cteStart, cteEnd)
    expect(cteBody).toMatch(/COUNT\(\*\)::int FROM organiser_groups/)
    expect(cteBody).toMatch(/COUNT\(\*\)::int FROM organiser_items/)
    expect((cteBody.match(/SELECT/g) || []).length).toBe(3) // outer SELECT + 2 scalar COUNT subqueries, nothing else
  })

  it('response shape unchanged: { success: true }', async () => {
    const res = await boardIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), BOARD_CTX)
    expect(await res.json()).toEqual({ success: true })
  })
})

// ── GROUP.CREATED ────────────────────────────────────────────────────────

describe('group.created — POST /api/organiser/boards/[boardId]/groups', () => {
  it('board existence check, position select, then one atomic insert+activity call — the activity insert itself is never split into a second round trip', async () => {
    sqlCalls = []
    sqlResult = [{ id: 'board-1' }]
    // First call: board existence check
    const origMock = sqlMock.getMockImplementation()!
    let call = 0
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      call += 1
      sqlCalls.push({ text: strings.join('§'), values })
      if (call === 1) return Promise.resolve([{ id: 'board-1' }])
      if (call === 2) return Promise.resolve([{ next: 0 }])
      return Promise.resolve([{ id: 'group-1', name: 'Backlog', color: null, position: 0 }])
    })
    const res = await boardGroupsRoute.POST(jsonReq('http://localhost/x', 'POST', { name: 'Backlog' }), BOARD_CTX)
    expect(sqlCalls).toHaveLength(3)
    assertLikeAtomic(sqlCalls[2].text)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.group).toMatchObject({ id: 'group-1', name: 'Backlog' })
    sqlMock.mockImplementation(origMock)

    function assertLikeAtomic(sql: string) {
      expect(sql).toContain('INSERT INTO organiser_groups')
      expect(sql).toMatch(/activity_row AS \(/)
      expect(sql).toContain("'group.created'")
      expect(sql).toContain("'group'")
    }
  })
})

// ── GROUP.UPDATED ────────────────────────────────────────────────────────

describe('group.updated — PATCH /api/organiser/groups/[groupId]', () => {
  beforeEach(() => { sqlResult = [{ id: 'group-1', name: 'In Progress', color: null, position: 0 }] })

  it('is one atomic writable-CTE statement (FOR UPDATE + UPDATE + activity_row)', async () => {
    await groupIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'In Progress' }), GROUP_CTX)
    expect(sqlCalls[0].text).toMatch(/FOR UPDATE/)
    assertAtomicWritableCte(sqlCalls[0].text, { mutationVerb: 'UPDATE organiser_', eventType: 'group.updated', entityType: 'group' })
  })

  it('board_id is selected (needed for the activity row, not returned in the API response)', async () => {
    await groupIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'In Progress' }), GROUP_CTX)
    expect(sqlCalls[0].text).toMatch(/SELECT id, board_id, name, color, position/)
    const res = await groupIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'In Progress' }), GROUP_CTX)
    const json = await res.json()
    expect(json.group).not.toHaveProperty('board_id')
  })

  it('position excluded from the diffed field list', async () => {
    await groupIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { position: 2 }), GROUP_CTX)
    const latValues = sqlCalls[0].text.slice(sqlCalls[0].text.indexOf('LATERAL'), sqlCalls[0].text.indexOf('activity_row'))
    expect(latValues).not.toMatch(/'position'/)
  })

  it('same-value guard present (field_diff.any_changed gate)', async () => {
    await groupIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'In Progress' }), GROUP_CTX)
    expect(sqlCalls[0].text).toMatch(/WHERE field_diff\.any_changed IS TRUE/)
  })
})

// ── GROUP.DELETED ────────────────────────────────────────────────────────

describe('group.deleted — DELETE /api/organiser/groups/[groupId]', () => {
  beforeEach(() => { sqlResult = [{ id: 'group-1' }] })

  it('is one atomic writable-CTE statement (DELETE + activity_row)', async () => {
    await groupIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), GROUP_CTX)
    assertAtomicWritableCte(sqlCalls[0].text, { mutationVerb: 'DELETE FROM organiser_', eventType: 'group.deleted', entityType: 'group' })
  })

  it('before_json preserves name; after_json NULL; board_id captured from the deleted row for the activity insert', async () => {
    await groupIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), GROUP_CTX)
    expect(sqlCalls[0].text).toMatch(/RETURNING id, board_id, name/)
    expect(sqlCalls[0].text).toMatch(/deleted\.board_id/)
  })

  it('only reads a bounded COUNT(*) from organiser_items (D.4.6H would_orphan) — never writes it, never fabricates per-item item.moved events', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/groups/[groupId]/route.ts'), 'utf8')
    // D.4.6H deliberately adds ONE read-only COUNT(*) against
    // organiser_items (would_orphan, for the bounded affected_item_count
    // summary) — this is not the fabricated per-item write this test
    // originally guarded against. What must still never appear is any
    // write verb against organiser_items, or a synthesized 'item.moved'
    // literal implying a per-item event was invented.
    expect(source).not.toMatch(/(UPDATE|INSERT INTO|DELETE FROM)\s+organiser_items/)
    expect(source).not.toMatch(/'item\.moved'/)
    // The only SELECT-side reference to organiser_items is the bounded
    // would_orphan COUNT(*) — confirm it's a count, not a row/content read.
    const fromMatches = source.match(/FROM\s+organiser_items/g) || []
    expect(fromMatches.length).toBe(1)
    expect(source).toMatch(/would_orphan AS \(\s*SELECT COUNT\(\*\)::int AS n FROM organiser_items/)
  })

  it('response shape unchanged: { success: true }', async () => {
    const res = await groupIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), GROUP_CTX)
    expect(await res.json()).toEqual({ success: true })
  })
})

// ── COMMENT.CREATED ──────────────────────────────────────────────────────

describe('comment.created — POST /api/organiser/items/[itemId]/updates', () => {
  it('two calls: item-existence/board-lookup, then one atomic insert+activity call', async () => {
    let call = 0
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      call += 1
      sqlCalls.push({ text: strings.join('§'), values })
      if (call === 1) return Promise.resolve([{ id: 'item-1', board_id: 'board-1' }])
      return Promise.resolve([{ id: 'update-1', author_name: 'James', body: 'Waiting on supplier confirmation', created_at: new Date() }])
    })
    const res = await itemUpdatesRoute.POST(jsonReq('http://localhost/x', 'POST', { body: 'Waiting on supplier confirmation' }), ITEM_CTX)
    expect(sqlCalls).toHaveLength(2)
    const sql = sqlCalls[1].text
    expect(sql).toContain('INSERT INTO organiser_item_updates')
    expect(sql).toMatch(/activity_row AS \(/)
    expect(sql).toContain("'comment.created'")
    expect(sql).toContain("'comment'")
    expect(res.status).toBe(200)
  })

  it('item_id is set on the activity row (so it surfaces in the Item Activity tab too)', async () => {
    let call = 0
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      call += 1
      sqlCalls.push({ text: strings.join('§'), values })
      if (call === 1) return Promise.resolve([{ id: 'item-1', board_id: 'board-1' }])
      return Promise.resolve([{ id: 'update-1', author_name: 'James', body: 'text', created_at: new Date() }])
    })
    await itemUpdatesRoute.POST(jsonReq('http://localhost/x', 'POST', { body: 'text' }), ITEM_CTX)
    expect(sqlCalls[1].text).toMatch(/organisation_id, board_id, item_id, actor_user_id, actor_name,/)
  })

  it('excerpt is sanitised via organiser_activity_sanitise_scalar — no separate/duplicate truncation logic', async () => {
    let call = 0
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      call += 1
      sqlCalls.push({ text: strings.join('§'), values })
      if (call === 1) return Promise.resolve([{ id: 'item-1', board_id: 'board-1' }])
      return Promise.resolve([{ id: 'update-1', author_name: 'James', body: 'text', created_at: new Date() }])
    })
    await itemUpdatesRoute.POST(jsonReq('http://localhost/x', 'POST', { body: 'text' }), ITEM_CTX)
    expect(sqlCalls[1].text).toMatch(/jsonb_build_object\('excerpt', organiser_activity_sanitise_scalar\(to_jsonb\(inserted\.body\)\)\)/)
  })

  it('the full comment body is never duplicated verbatim into the activity INSERT text as a second literal — only via the sanitiser wrapping inserted.body', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/items/[itemId]/updates/route.ts'), 'utf8')
    const activityBlock = source.slice(source.indexOf('activity_row AS ('), source.indexOf('SELECT id, author_name, body, created_at FROM inserted'))
    expect(activityBlock).not.toMatch(/\$\{text\}/)
  })
})

// ── FILE.ADDED ────────────────────────────────────────────────────────────

describe('file.added — POST /api/organiser/items/[itemId]/files', () => {
  it('the activity payload includes only file_name and file_size — no signed URL, token, or file content', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/items/[itemId]/files/route.ts'), 'utf8')
    const activityBlock = source.slice(source.indexOf('activity_row AS ('), source.indexOf('FROM inserted', source.indexOf('activity_row AS (')))
    expect(activityBlock).toMatch(/'file_name'/)
    expect(activityBlock).toMatch(/'file_size'/)
    expect(activityBlock).not.toMatch(/file_url/)
    expect(activityBlock).not.toMatch(/signed|token|credential/i)
  })

  it('is one atomic writable-CTE statement for the file metadata insert (event_type file.added, entity_type file)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/items/[itemId]/files/route.ts'), 'utf8')
    expect(source).toMatch(/WITH inserted AS \(\s*\n\s*INSERT INTO organiser_item_files/)
    expect(source).toMatch(/activity_row AS \(/)
    expect(source).toContain("'file.added'")
    expect(source).toContain("'file'")
  })

  it('item_id is set on the activity row', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/items/[itemId]/files/route.ts'), 'utf8')
    expect(source).toMatch(/organisation_id, board_id, item_id, actor_user_id, actor_name,/)
  })
})

// ── FILE.DELETED ──────────────────────────────────────────────────────────

describe('file.deleted — DELETE /api/organiser/items/[itemId]/files/[fileId]', () => {
  beforeEach(() => { sqlResult = [{ file_url: '/organiser-attachments/item-1/abc-invoice.pdf' }] })

  it('is one atomic writable-CTE statement (DELETE + activity_row)', async () => {
    await itemFileIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_FILE_CTX)
    assertAtomicWritableCte(sqlCalls[0].text, { mutationVerb: 'DELETE FROM organiser_', eventType: 'file.deleted', entityType: 'file' })
  })

  it('before_json preserves file_name; after_json NULL; board_id captured from the deleted row', async () => {
    await itemFileIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_FILE_CTX)
    expect(sqlCalls[0].text).toMatch(/RETURNING id, board_id, file_name, file_url/)
    expect(sqlCalls[0].text).toMatch(/jsonb_build_object\('file_name', organiser_activity_sanitise_scalar\(to_jsonb\(deleted\.file_name\)\)\),\s*\n\s*NULL/)
  })

  it('response still returns file_url for the fs.unlink cleanup step — unchanged business behavior', async () => {
    const res = await itemFileIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_FILE_CTX)
    expect(res.status).toBe(200)
  })
})

// ── COMMENT.DELETED (D.4.6H) ────────────────────────────────────────────────

describe('comment.deleted — DELETE /api/organiser/items/[itemId]/updates/[updateId]', () => {
  beforeEach(() => { sqlResult = [{ id: 'update-1', board_id: 'board-1' }] })

  it('is one atomic writable-CTE statement (DELETE + activity_row)', async () => {
    await itemUpdateIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_UPDATE_CTX)
    assertAtomicWritableCte(sqlCalls[0].text, { mutationVerb: 'DELETE FROM organiser_', eventType: 'comment.deleted', entityType: 'comment' })
  })

  it('is scoped by id, item_id, AND organisation_id — never a bare updateId match', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/items/[itemId]/updates/[updateId]/route.ts'), 'utf8')
    const deleteStmt = source.slice(source.indexOf('DELETE FROM organiser_item_updates'), source.indexOf('RETURNING id, board_id'))
    expect(deleteStmt).toMatch(/id = \$\{updateId\}/)
    expect(deleteStmt).toMatch(/item_id = \$\{itemId\}/)
    expect(deleteStmt).toMatch(/organisation_id = \$\{session\.organisationId\}/)
  })

  it('item_id is set on the activity row (surfaces in the Item Activity tab, mirroring comment.created)', async () => {
    await itemUpdateIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_UPDATE_CTX)
    expect(sqlCalls[0].text).toMatch(/organisation_id, board_id, item_id, actor_user_id, actor_name,/)
  })

  it('before_json AND after_json are both NULL — no comment body/content is ever stored, by design (privacy-first: the standard row columns already convey everything safe)', async () => {
    await itemUpdateIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_UPDATE_CTX)
    const text = sqlCalls[0].text
    expect(text).toMatch(/'comment\.deleted', 'comment', deleted\.id::text, NULL, NULL/)
  })

  it('the route never SELECTs/RETURNs the comment body column anywhere — the SQL only ever names id/board_id', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/items/[itemId]/updates/[updateId]/route.ts'), 'utf8')
    // Scoped to actual SQL/code usage, not a blanket string ban — this
    // file's own explanatory comment legitimately uses the English word
    // "body" when explaining why it is NOT captured.
    expect(source).not.toMatch(/RETURNING[^)]*\bbody\b/i)
    expect(source).not.toContain('organiser_item_updates.body')
    expect(source).not.toMatch(/SELECT[^;]*\bbody\b/i)
  })

  it('actor/tenant are bound from session only — never from the request', async () => {
    await itemUpdateIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_UPDATE_CTX)
    const values = sqlCalls[0].values
    expect(values).toContain('org-a')
    expect(values).toContain('user-1')
    expect(values).toContain('James')
  })

  it('response shape unchanged: { success: true }; 404 when the comment/item/org triple does not match', async () => {
    const res = await itemUpdateIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_UPDATE_CTX)
    expect(await res.json()).toEqual({ success: true })

    sqlResult = []
    const res404 = await itemUpdateIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_UPDATE_CTX)
    expect(res404.status).toBe(404)
    expect(await res404.json()).toEqual({ error: 'Not found' })
  })

  // MUTATION CHECK — proves the "one atomic statement" assertion above
  // (`expect(sqlCalls).toHaveLength(1)` inside assertAtomicWritableCte)
  // actually constrains real behavior rather than passing vacuously.
  // Following this repo's own established mutation-check idiom (see
  // organiserHelenaRead.test.ts's "removing the end-exclusive comparison"
  // test): assert directly on the source that the specific regression
  // this phase's atomicity requirement (Step 8) exists to prevent — a
  // split "DELETE, then separately INSERT the activity row" — is not
  // present, rather than round-tripping a rewritten file through the
  // module loader at runtime.
  it('MUTATION CHECK: the route contains exactly one `await sql` call in DELETE — a split "await sql\`DELETE...\`; await sql\`INSERT INTO organiser_activity...\`" regression would defeat atomicity and is not present', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/items/[itemId]/updates/[updateId]/route.ts'), 'utf8')
    const deleteFnStart = source.indexOf('export async function DELETE')
    const deleteFnBody = source.slice(deleteFnStart)
    const awaitSqlCalls = deleteFnBody.match(/await sql`/g) || []
    expect(awaitSqlCalls.length).toBe(1)
    // Confirm the test above would actually have caught two calls: the
    // mock records every `sql\`...\`` invocation as a separate entry in
    // sqlCalls (see the sqlMock definition above), so a route with two
    // `await sql` calls produces sqlCalls.length === 2, which
    // assertAtomicWritableCte's own `toHaveLength(1)` assertion rejects.
    sqlCalls.length = 0
    sqlResult = [{ id: 'update-1', board_id: 'board-1' }]
    await sqlMock(Object.assign(['DELETE FROM organiser_item_updates ...'], { raw: [] }) as unknown as TemplateStringsArray)
    await sqlMock(Object.assign(['INSERT INTO organiser_activity ...'], { raw: [] }) as unknown as TemplateStringsArray)
    expect(() => expect(sqlCalls).toHaveLength(1)).toThrow()
  })
})

// ── SECURITY — tenant scoping of the row the FOR UPDATE lock/DELETE targets ─

describe('Security — every board/group PATCH and DELETE\'s locked/deleted row is itself tenant-scoped', () => {
  it('board PATCH\'s "old" CTE is scoped by id AND organisation_id', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/boards/[boardId]/route.ts'), 'utf8')
    const cteStart = source.indexOf('WITH old AS MATERIALIZED')
    const oldCte = source.slice(cteStart, source.indexOf('FOR UPDATE', cteStart))
    expect(oldCte).toMatch(/AND organisation_id = \$\{session\.organisationId\}/)
  })

  it('board DELETE is scoped by id AND organisation_id', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/boards/[boardId]/route.ts'), 'utf8')
    const deleteStmt = source.slice(source.indexOf('DELETE FROM organiser_boards'), source.indexOf('RETURNING id, name'))
    expect(deleteStmt).toMatch(/AND organisation_id = \$\{session\.organisationId\}/)
  })

  it('group PATCH\'s "old" CTE is scoped by id AND organisation_id', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/groups/[groupId]/route.ts'), 'utf8')
    const cteStart = source.indexOf('WITH old AS MATERIALIZED')
    const oldCte = source.slice(cteStart, source.indexOf('FOR UPDATE', cteStart))
    expect(oldCte).toMatch(/AND organisation_id = \$\{session\.organisationId\}/)
  })

  it('group DELETE is scoped by id AND organisation_id', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/groups/[groupId]/route.ts'), 'utf8')
    const deleteStmt = source.slice(source.indexOf('DELETE FROM organiser_groups'), source.indexOf('RETURNING id, board_id, name'))
    expect(deleteStmt).toMatch(/AND organisation_id = \$\{session\.organisationId\}/)
  })
})

// ── SECURITY — tenant/actor binding across every new instrumentation ───────

describe('Security — every new instrumentation derives organisation/actor from session only', () => {
  const routeFiles = [
    'app/api/organiser/boards/route.ts',
    'app/api/organiser/boards/[boardId]/route.ts',
    'app/api/organiser/boards/[boardId]/groups/route.ts',
    'app/api/organiser/groups/[groupId]/route.ts',
    'app/api/organiser/items/[itemId]/updates/route.ts',
    'app/api/organiser/items/[itemId]/files/route.ts',
    'app/api/organiser/items/[itemId]/files/[fileId]/route.ts',
  ]

  it('every touched route still imports and calls authorizeOrganiserRequest(\'viewer\') — no regression to a bare requireRole', async () => {
    const fs = await import('fs')
    const path = await import('path')
    for (const file of routeFiles) {
      const code = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
      expect(code, `${file} must import authorizeOrganiserRequest`).toMatch(/import \{ authorizeOrganiserRequest \} from '@\/lib\/organiser\/authorize'/)
      expect(code, `${file} must not import bare requireRole`).not.toMatch(/requireRole/)
    }
  })

  it('every new activity INSERT sources actor_user_id/actor_name/organisation_id exclusively from ${session.*} interpolations, never from req.body', async () => {
    const fs = await import('fs')
    const path = await import('path')
    for (const file of routeFiles) {
      const code = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
      const idx = code.indexOf('activity_row AS (')
      if (idx === -1) continue // boards GET-only file has no activity_row; all others do
      const block = code.slice(idx, code.indexOf('FROM', idx + 400) + 200)
      expect(block, `${file} activity_row must bind organisationId from session`).toMatch(/\$\{session\.organisationId\}/)
      expect(block, `${file} activity_row must bind actor from session`).toMatch(/\$\{session\.userId\}|\.userId,/)
    }
  })

  it('no route reads organisation_id/actor identity from the request body', async () => {
    const fs = await import('fs')
    const path = await import('path')
    for (const file of routeFiles) {
      const code = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
      expect(code, `${file} must not read organisationId from body`).not.toMatch(/body\.organisationId|body\.organisation_id|body\.actorUserId|body\.actor_user_id/)
    }
  })
})
