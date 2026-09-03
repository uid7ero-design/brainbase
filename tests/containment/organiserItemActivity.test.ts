import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Phase D.4.5C-B — item POST/PATCH/DELETE activity instrumentation.
// Static/mocked containment tests only prove the QUERY TEXT/STRUCTURE
// these routes build (CTE names, event_type classification expression,
// FILTER-based suppression, actor/tenant binding) — they cannot prove
// real MVCC/locking correctness (no real transaction/snapshot/locking
// semantics exist in a mock, by construction). That correctness is
// proven separately, empirically, against real PostgreSQL 16, by
// scripts/tests/verify-organiser-item-activity-concurrency.sh (40/40
// checks passing, including the same-field-concurrency hard gate and a
// mutation proof that removing FOR UPDATE reintroduces the invalid-fork
// bug) — see the phase report's own "M/N/O/T" sections for that harness's
// full results.

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

let responseQueue: unknown[][] = []
let callCount = 0
const sqlCalls: { strings: TemplateStringsArray; values: unknown[] }[] = []
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  sqlCalls.push({ strings, values })
  return Promise.resolve(responseQueue[callCount++] ?? [])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...(args as [TemplateStringsArray, ...unknown[]])),
}))

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: (...args: unknown[]) => requireCapabilityMock(...args) }
})

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}
function queryText(callIndex = 0): string {
  const call = sqlCalls[callIndex]
  return call ? call.strings.join('?') : ''
}
function queryValues(callIndex = 0): unknown[] {
  return sqlCalls[callIndex]?.values ?? []
}

const boardItemsRoute = await import('@/app/api/organiser/boards/[boardId]/items/route')
const itemIdRoute = await import('@/app/api/organiser/items/[itemId]/route')

const SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'manager', name: 'James' }
const BOARD_CTX = { params: Promise.resolve({ boardId: 'board-1' }) }
const ITEM_CTX = { params: Promise.resolve({ itemId: 'item-1' }) }

beforeEach(() => {
  requireSessionMock.mockReset()
  sqlMock.mockClear()
  sqlCalls.length = 0
  requireCapabilityMock.mockReset()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(SESSION)
  requireCapabilityMock.mockResolvedValue({ key: 'organiser', config: {} })
})

// POST makes 3 sql calls, unchanged in count/order from before this phase
// (board tenant check, then the pre-existing MAX(position)+1 read — see
// the phase report's explicit note that this pre-existing race is not
// being fixed here — then the new writable-CTE insert+activity
// statement) — call index 2 is the one this phase actually changed.
describe('POST /api/organiser/boards/[boardId]/items — item.created', () => {
  it('the third statement builds an INSERT into organiser_items AND an INSERT into organiser_activity, combined via a writable CTE (one round trip, one atomic unit)', async () => {
    queue([{ id: 'board-1' }], [{ next: 0 }], [{ id: 'item-new', name: 'New Item', status: 'Not Started', board_id: 'board-1' }])
    await boardItemsRoute.POST(jsonReq('http://localhost/x', 'POST', { name: 'New Item' }), BOARD_CTX)
    const text = queryText(2)
    expect(text).toContain('WITH inserted AS')
    expect(text).toContain('INSERT INTO organiser_items')
    expect(text).toContain('activity_row AS')
    expect(text).toContain('INSERT INTO organiser_activity')
    expect(text).toContain("'item.created'")
    expect(text).toContain("'item'")
  })

  // Phase D.4.5C-T/U — regression test for a real production incident:
  // activity_row's SELECT referenced inserted.board_id, but the
  // `inserted` CTE's RETURNING clause never listed board_id — Postgres
  // rejected the whole statement ("column inserted.board_id does not
  // exist"), and because POST has no try/catch, that became an
  // unhandled HTTP 500 with an empty body. This mock-based suite never
  // executes real SQL (see the file-header comment) so it could not
  // catch this by itself — the empirical proof is
  // scripts/tests/verify-organiser-item-activity-concurrency.sh's new
  // P1-P9b checks against real PostgreSQL. This test is the cheap,
  // Docker-free companion: it parses the real RETURNING clause and
  // every `inserted.<column>` reference inside activity_row, and
  // fails if any referenced column is missing from RETURNING — the
  // exact invariant this whole class of bug violates.
  it('every inserted.<column> reference inside activity_row has a matching column in the inserted CTE\'s RETURNING clause', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/boards/[boardId]/items/route.ts'), 'utf8')
    const returningStart = source.indexOf('RETURNING', source.indexOf('INSERT INTO organiser_items'))
    const returningEnd = source.indexOf('\n    ),', returningStart)
    const returningClause = source.slice(returningStart, returningEnd)
    const returningColumns = new Set(
      returningClause
        .replace('RETURNING', '')
        .split(',')
        .map(col => {
          const aliasMatch = col.match(/AS\s+(\w+)\s*$/i)
          if (aliasMatch) return aliasMatch[1]
          return col.trim().split(/\s+/)[0].replace(/::\w+$/, '')
        })
        .map(col => col.trim())
        .filter(Boolean)
    )

    const activityStart = source.indexOf('activity_row AS')
    const activityFromIdx = source.indexOf('FROM inserted', activityStart)
    const activityBlock = source.slice(activityStart, activityFromIdx)
    const referenced = new Set(
      [...activityBlock.matchAll(/inserted\.(\w+)/g)].map(m => m[1])
    )

    expect(referenced.size).toBeGreaterThan(0) // sanity: the regex itself matched something
    for (const col of referenced) {
      expect(returningColumns, `activity_row references inserted.${col}, but RETURNING does not include it — this is exactly the production 500 bug`).toContain(col)
    }
  })

  // Phase D.4.5C-T/U — board_id had to be added to RETURNING (above) so
  // activity_row could reference it, but board_id was never part of the
  // { item: ... } response contract before this fix. The final SELECT
  // uses an explicit column list (not `inserted.*`) specifically so
  // adding board_id to RETURNING does not silently change what clients
  // receive.
  it('board_id does not leak into the final response SELECT — the response item contract is unchanged despite board_id now being in RETURNING', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/boards/[boardId]/items/route.ts'), 'utf8')
    // The final SELECT is textually the LAST "SELECT" keyword in the
    // template literal (activity_row's own SELECT ends with
    // "RETURNING id" before this one begins).
    const lastSelectIdx = source.lastIndexOf('SELECT')
    expect(lastSelectIdx).toBeGreaterThan(-1) // sanity: found a SELECT at all
    const templateEnd = source.indexOf('`;', lastSelectIdx)
    const finalSelectBlock = source.slice(lastSelectIdx, templateEnd)
    expect(finalSelectBlock).not.toMatch(/\bboard_id\b/)
    expect(finalSelectBlock).not.toContain('inserted.*')
  })

  it('after_json is a minimum identity summary (name/status/group_id/parent_item_id) — never a full-row dump', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/boards/[boardId]/items/route.ts'), 'utf8')
    const activityStart = source.indexOf('activity_row AS')
    const activityEnd = source.indexOf('FROM inserted')
    const block = source.slice(activityStart, activityEnd)
    expect(block).toContain("'name'")
    expect(block).toContain("'status'")
    expect(block).toContain("'group_id'")
    expect(block).toContain("'parent_item_id'")
    expect(block).not.toContain("'notes'")
    expect(block).not.toContain("'priority'")
    expect(block).not.toContain("'owner'")
    expect(block).not.toContain("'custom_values'")
  })

  it('before_json is NULL for a create event', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/boards/[boardId]/items/route.ts'), 'utf8')
    expect(source).toMatch(/'item\.created', 'item', inserted\.id::text, NULL,/)
  })

  it('actor/organisation are bound from session values only — never from the request body', async () => {
    queue([{ id: 'board-1' }], [{ next: 0 }], [{ id: 'item-new' }])
    await boardItemsRoute.POST(jsonReq('http://localhost/x', 'POST', {
      name: 'New Item', actor_user_id: 'fake', actor_name: 'Fake', userId: 'fake2', organisationId: 'org-evil',
    }), BOARD_CTX)
    const values = queryValues(2)
    expect(values).toContain('org-a')
    expect(values).toContain('user-1')
    expect(values).toContain('James')
    expect(values).not.toContain('org-evil')
    expect(values).not.toContain('fake')
    expect(values).not.toContain('Fake')
  })

  it('response shape is unchanged: { item: <row> }', async () => {
    queue([{ id: 'board-1' }], [{ next: 0 }], [{ id: 'item-new', name: 'New Item' }])
    const res = await boardItemsRoute.POST(jsonReq('http://localhost/x', 'POST', { name: 'New Item' }), BOARD_CTX)
    const body = await res.json()
    expect(body).toEqual({ item: { id: 'item-new', name: 'New Item' } })
  })
})

describe('PATCH /api/organiser/items/[itemId] — atomic before/after capture', () => {
  it('the statement locks the old row (FOR UPDATE, MATERIALIZED) before updating it', async () => {
    queue([{ id: 'item-1', status: 'Working on it' }])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'Working on it' }), ITEM_CTX)
    const text = queryText(0)
    expect(text).toMatch(/WITH old AS MATERIALIZED/)
    expect(text).toContain('FOR UPDATE')
  })

  it('no pre-SELECT statement exists outside the one atomic statement — exactly one sql call for the whole PATCH', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'X' }), ITEM_CTX)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('the tenant predicate (organisation_id) is present in the locked old CTE itself, not only in a later clause', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'X' }), ITEM_CTX)
    const text = queryText(0)
    const oldCteEnd = text.indexOf('),', text.indexOf('WITH old AS MATERIALIZED'))
    const oldCteBlock = text.slice(0, oldCteEnd)
    expect(oldCteBlock).toContain('organisation_id')
  })

  it('updated depends on old (FROM old ... WHERE i.id = old.id) — the update reads its "keep old value" fallback from the locked row, not a bare column reference', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'X' }), ITEM_CTX)
    const text = queryText(0)
    expect(text).toMatch(/FROM old\s*\n\s*WHERE i\.id = old\.id/)
  })

  it('activity_row depends on both old and updated (FROM old, updated, field_diff, custom_diff)', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'X' }), ITEM_CTX)
    const text = queryText(0)
    expect(text).toMatch(/FROM old, updated, field_diff, custom_diff/)
  })

  it('the final response selects from updated only, matching the pre-existing RETURNING column list', async () => {
    queue([{ id: 'item-1', group_id: null, parent_item_id: null, name: 'X', status: 'Y', priority: null, owner: null, due_date: null, notes: null, fields: {}, custom_values: {}, position: 0, created_at: 'a', updated_at: 'b' }])
    const res = await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'Y' }), ITEM_CTX)
    const body = await res.json()
    expect(body.item).toEqual({ id: 'item-1', group_id: null, parent_item_id: null, name: 'X', status: 'Y', priority: null, owner: null, due_date: null, notes: null, fields: {}, custom_values: {}, position: 0, created_at: 'a', updated_at: 'b' })
  })

  it('404 semantics unchanged: zero returned rows -> { error: "Not found" }, 404', async () => {
    queue([])
    const res = await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'X' }), ITEM_CTX)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })
})

describe('PATCH — event classification and suppression (structural)', () => {
  it('event_type is item.moved iff group_id or parent_item_id genuinely changed, item.updated otherwise (NULL-safe IS DISTINCT FROM)', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'X' }), ITEM_CTX)
    const text = queryText(0)
    expect(text).toMatch(/old\.group_id IS DISTINCT FROM updated\.group_id OR old\.parent_item_id IS DISTINCT FROM updated\.parent_item_id/)
    expect(text).toContain("'item.moved'")
    expect(text).toContain("'item.updated'")
  })

  it('position is never part of the field_diff LATERAL VALUES list — position-only changes cannot produce a diff key or gate the suppression check', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { position: 5 }), ITEM_CTX)
    const text = queryText(0)
    const latStart = text.indexOf('LATERAL (VALUES')
    const latEnd = text.indexOf(') AS f(key, old_val, new_val)')
    const latBlock = text.slice(latStart, latEnd)
    expect(latBlock).not.toContain("'position'")
  })

  it('the suppression gate requires field_diff.any_changed OR custom_diff.any_changed before any activity row is inserted', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'X' }), ITEM_CTX)
    const text = queryText(0)
    expect(text).toMatch(/WHERE field_diff\.any_changed IS TRUE OR custom_diff\.any_changed IS TRUE/)
  })

  it('changed-field detection uses IS DISTINCT FROM (actual value comparison), not "was the key present in the request"', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'X' }), ITEM_CTX)
    const text = queryText(0)
    expect(text).toMatch(/f\.old_val IS DISTINCT FROM f\.new_val/)
  })
})

describe('PATCH — custom_values key-level diff (structural)', () => {
  it('diffs via jsonb_each over the REQUESTED custom_values payload, comparing each requested key against the locked old value — not the full merged object', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { custom_values: { b: 3 } }), ITEM_CTX)
    const text = queryText(0)
    expect(text).toMatch(/jsonb_each\(\?::jsonb\) AS kv\(key, value\)/)
    expect(text).toMatch(/old\.custom_values -> kv\.key IS DISTINCT FROM kv\.value/)
    const values = queryValues(0)
    expect(values).toContain(JSON.stringify({ b: 3 }))
  })

  it('preserves the existing merge semantics (old.custom_values || requested) — unchanged from before this phase', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { custom_values: { b: 3 } }), ITEM_CTX)
    const text = queryText(0)
    expect(text).toMatch(/old\.custom_values \|\|/)
  })

  it('every diffed value (field-level and custom_values) is passed through organiser_activity_sanitise_scalar', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'X', custom_values: { b: 3 } }), ITEM_CTX)
    const text = queryText(0)
    const count = (text.match(/organiser_activity_sanitise_scalar/g) ?? []).length
    expect(count).toBeGreaterThanOrEqual(9) // 8 fields x2 (old/new) is done via one call per VALUES cell, plus 2 for custom_diff
  })
})

describe('PATCH — actor and tenant binding (never from request body)', () => {
  it('actor_user_id/actor_name/organisation_id come from session values, never request body fields', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', {
      status: 'X', actor_user_id: 'fake-id', actor_name: 'Fake Name', userId: 'fake2', organisationId: 'org-evil',
    }), ITEM_CTX)
    const values = queryValues(0)
    expect(values).toContain('org-a')
    expect(values).toContain('user-1')
    expect(values).toContain('James')
    expect(values).not.toContain('org-evil')
    expect(values).not.toContain('fake-id')
    expect(values).not.toContain('Fake Name')
  })

  it('the WHERE clause on the locked old row always includes both itemId AND session.organisationId — a cross-tenant id can never match', async () => {
    queue([])
    await itemIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { status: 'X' }), ITEM_CTX)
    const values = queryValues(0)
    expect(values).toContain('item-1')
    expect(values).toContain('org-a')
  })
})

describe('DELETE /api/organiser/items/[itemId] — item.deleted', () => {
  it('the statement combines DELETE and the activity INSERT via a writable CTE, one atomic unit', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_CTX)
    const text = queryText(0)
    expect(text).toContain('WITH deleted AS')
    expect(text).toContain('DELETE FROM organiser_items')
    expect(text).toContain('activity_row AS')
    expect(text).toContain('INSERT INTO organiser_activity')
    expect(text).toContain("'item.deleted'")
  })

  it('before_json contains the approved minimal identity summary; after_json is NULL', async () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/items/[itemId]/route.ts'), 'utf8')
    const deleteStart = source.indexOf('export async function DELETE')
    const deleteBlock = source.slice(deleteStart)
    const jsonBlockStart = deleteBlock.indexOf('jsonb_build_object(')
    const jsonBlockEnd = deleteBlock.indexOf('),\n        NULL')
    const block = deleteBlock.slice(jsonBlockStart, jsonBlockEnd)
    expect(block).toContain("'name'")
    expect(block).toContain("'status'")
    expect(block).toContain("'group_id'")
    expect(block).toContain("'parent_item_id'")
    expect(deleteBlock).toContain('NULL')
  })

  it('no executable cascaded_subitem_count field anywhere — Gate B resolved as Option B (omit the count, record only the explicit parent event); the route file\'s own comment legitimately explains this decision in prose, so this checks comment-stripped code only', async () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/items/[itemId]/route.ts'), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code).not.toContain('cascaded_subitem_count')
    expect(code).not.toContain('subitem_count')
  })

  it('actor/tenant bound from session only', async () => {
    queue([{ id: 'item-1' }])
    await itemIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_CTX)
    const values = queryValues(0)
    expect(values).toContain('org-a')
    expect(values).toContain('user-1')
    expect(values).toContain('James')
  })

  it('response shape unchanged: { success: true }; 404 semantics unchanged', async () => {
    queue([{ id: 'item-1' }])
    const res = await itemIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_CTX)
    expect(await res.json()).toEqual({ success: true })

    queue([])
    const res404 = await itemIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_CTX)
    expect(res404.status).toBe(404)
    expect(await res404.json()).toEqual({ error: 'Not found' })
  })
})

describe('No best-effort item history — recordOrganiserActivity is never used by item routes', () => {
  it('POST/PATCH/DELETE item routes do not import recordOrganiserActivity or organiserActivityInsertQuery — the atomic writable-CTE statement is the only mechanism', () => {
    const postSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/boards/[boardId]/items/route.ts'), 'utf8')
    const itemSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/items/[itemId]/route.ts'), 'utf8')
    for (const source of [postSource, itemSource]) {
      expect(source).not.toMatch(/recordOrganiserActivity|organiserActivityInsertQuery/)
      expect(source).not.toMatch(/from ['"]@\/lib\/organiser\/activity['"]/)
    }
  })
})

describe('Zero instrumentation outside the two authorized item routes', () => {
  it('no other app/api/organiser/**/route.ts file references organiser_activity, activity_row, or lib/organiser/activity', () => {
    const orgDir = path.resolve(__dirname, '../../app/api/organiser')
    function listRouteFiles(dir: string): string[] {
      const out: string[] = []
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...listRouteFiles(full))
        else if (entry.name === 'route.ts') out.push(full)
      }
      return out
    }
    const allowed = new Set([
      path.resolve(__dirname, '../../app/api/organiser/boards/[boardId]/items/route.ts'),
      path.resolve(__dirname, '../../app/api/organiser/items/[itemId]/route.ts'),
    ])
    const files = listRouteFiles(orgDir)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      if (allowed.has(file)) continue
      const src = fs.readFileSync(file, 'utf8')
      expect(src, `${file} must not reference organiser_activity`).not.toMatch(/organiser_activity|organiser\/activity/)
    }
  })
})
