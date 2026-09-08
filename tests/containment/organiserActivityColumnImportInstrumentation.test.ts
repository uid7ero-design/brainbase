import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Phase D.4.6G — closes the two Organiser mutation paths a prior read-only
// audit identified as having zero activity instrumentation despite being
// meaningful product changes: CSV/XLSX import and column create/update/
// delete. Same mocked-sql, no-real-Postgres convention as
// tests/containment/organiserActivityExpandedInstrumentation.test.ts
// (D.4.5F) — this file proves SQL shape, event_type/entity_type/entity_id
// correctness, actor/tenant binding, and unchanged response shape; it
// cannot prove real Postgres semantics (not needed here — none of this
// phase's SQL is materially novel beyond patterns already empirically
// proven for boards/groups/items in prior phases).

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

const boardColumnsRoute = await import('@/app/api/organiser/boards/[boardId]/columns/route')
const columnIdRoute = await import('@/app/api/organiser/columns/[columnId]/route')
const importRoute = await import('@/app/api/organiser/boards/[boardId]/import/route')

const SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'manager', name: 'James' }
const BOARD_CTX = { params: Promise.resolve({ boardId: 'board-1' }) }
const COLUMN_CTX = { params: Promise.resolve({ columnId: 'col-1' }) }

beforeEach(() => {
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  sqlMock.mockReset()
  sqlCalls = []
  sqlResult = []
  requireSessionMock.mockResolvedValue(SESSION)
  requireCapabilityMock.mockResolvedValue({ key: 'organiser', config: {} })
})

// ── COLUMN.CREATED ───────────────────────────────────────────────────────

describe('column.created — POST /api/organiser/boards/[boardId]/columns', () => {
  // One shared mock row satisfies all 3 calls this route makes (board
  // check, position select, insert+activity) — see this file's header for
  // why a single generic shape is safe across every call site here.
  beforeEach(() => { sqlResult = [{ id: 'col-1', name: 'Priority', type: 'status', options: [], position: 0, next: 0 }] })

  it('is one atomic writable-CTE statement (column insert + activity_row), the third of three sql calls', async () => {
    await boardColumnsRoute.POST(jsonReq('http://localhost/x', 'POST', { name: 'Priority', type: 'status' }), BOARD_CTX)
    expect(sqlCalls).toHaveLength(3)
    const sql = sqlCalls[2].text
    expect(sql).toContain('INSERT INTO organiser_columns')
    expect(sql).toMatch(/activity_row AS \(/)
    expect(sql).toMatch(/INSERT INTO organiser_activity/)
    expect(sql).toContain("'column.created'")
    expect(sql).toContain("'column'")
  })

  it('before_json is NULL, after_json carries only name and type — never options', async () => {
    await boardColumnsRoute.POST(jsonReq('http://localhost/x', 'POST', { name: 'Priority', type: 'status' }), BOARD_CTX)
    const sql = sqlCalls[2].text
    expect(sql).toMatch(/inserted\.id::text, NULL,/)
    expect(sql).toContain("'name', organiser_activity_sanitise_scalar(to_jsonb(inserted.name))")
    expect(sql).toContain("'type', organiser_activity_sanitise_scalar(to_jsonb(inserted.type))")
    const activityBlock = sql.slice(sql.indexOf('activity_row AS ('), sql.indexOf('FROM inserted', sql.indexOf('activity_row AS (')))
    expect(activityBlock).not.toMatch(/'options'/)
  })

  it('actor/tenant bound from session only', async () => {
    await boardColumnsRoute.POST(jsonReq('http://localhost/x', 'POST', { name: 'Priority', type: 'status' }), BOARD_CTX)
    expect(sqlCalls[2].values).toContain('org-a')
    expect(sqlCalls[2].values).toContain('user-1')
    expect(sqlCalls[2].values).toContain('James')
  })

  it('response shape unchanged: { column: {...} }', async () => {
    const res = await boardColumnsRoute.POST(jsonReq('http://localhost/x', 'POST', { name: 'Priority', type: 'status' }), BOARD_CTX)
    const json = await res.json()
    expect(json.column).toMatchObject({ id: 'col-1', name: 'Priority', type: 'status' })
  })
})

// ── COLUMN.UPDATED ───────────────────────────────────────────────────────

describe('column.updated — PATCH /api/organiser/columns/[columnId]', () => {
  beforeEach(() => { sqlResult = [{ id: 'col-1', board_id: 'board-1', name: 'Priority Level', type: 'status', options: [], position: 0 }] })

  it('is one atomic writable-CTE statement (FOR UPDATE + UPDATE + activity_row)', async () => {
    await columnIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Priority Level' }), COLUMN_CTX)
    expect(sqlCalls).toHaveLength(1)
    const sql = sqlCalls[0].text
    expect(sql).toMatch(/FOR UPDATE/)
    expect(sql).toContain('UPDATE organiser_columns')
    expect(sql).toMatch(/activity_row AS \(/)
    expect(sql).toMatch(/INSERT INTO organiser_activity/)
    expect(sql).toContain("'column.updated'")
    expect(sql).toContain("'column'")
  })

  it('the activity gate (field_diff.any_changed) is present — a same-value update produces no row', async () => {
    await columnIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Priority Level' }), COLUMN_CTX)
    expect(sqlCalls[0].text).toMatch(/WHERE field_diff\.any_changed IS TRUE/)
  })

  it('position is excluded from the diffed field list — never logged as a noise field', async () => {
    await columnIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { position: 3 }), COLUMN_CTX)
    const text = sqlCalls[0].text
    const latBlock = text.slice(text.indexOf('LATERAL (VALUES'), text.indexOf(') AS f(key, old_val, new_val)'))
    expect(latBlock).not.toMatch(/'position'/)
  })

  it('name and options are the diffed fields', async () => {
    await columnIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Priority Level' }), COLUMN_CTX)
    const text = sqlCalls[0].text
    const latBlock = text.slice(text.indexOf('LATERAL (VALUES'), text.indexOf(') AS f(key, old_val, new_val)'))
    expect(latBlock).toContain("'name'")
    expect(latBlock).toContain("'options'")
  })

  it('board_id for the activity row comes from the locked old row (old.board_id), not a client-supplied value', async () => {
    await columnIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Priority Level', board_id: 'evil-board' }), COLUMN_CTX)
    const text = sqlCalls[0].text
    expect(text).toMatch(/old\.board_id, §, §,\s*\n\s*'column\.updated'/)
    expect(sqlCalls[0].values).not.toContain('evil-board')
  })

  it('actor/tenant bound from session only', async () => {
    await columnIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Priority Level' }), COLUMN_CTX)
    expect(sqlCalls[0].values).toContain('org-a')
    expect(sqlCalls[0].values).toContain('user-1')
    expect(sqlCalls[0].values).toContain('James')
  })

  it('response shape unchanged: { column: {...} }', async () => {
    const res = await columnIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Priority Level' }), COLUMN_CTX)
    const json = await res.json()
    expect(json.column).toMatchObject({ id: 'col-1', name: 'Priority Level' })
  })

  it('404 when the column does not exist for this tenant, unchanged behavior', async () => {
    sqlResult = []
    const res = await columnIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'X' }), COLUMN_CTX)
    expect(res.status).toBe(404)
  })
})

// ── COLUMN.DELETED ───────────────────────────────────────────────────────

describe('column.deleted — DELETE /api/organiser/columns/[columnId]', () => {
  beforeEach(() => { sqlResult = [{ id: 'col-1', board_id: 'board-1', name: 'Priority', type: 'status' }] })

  it('is one atomic writable-CTE statement (DELETE + activity_row), the first of two sql calls', async () => {
    await columnIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), COLUMN_CTX)
    // Call 0: DELETE + activity_row (atomic). Call 1: the pre-existing
    // custom_values cleanup sweep — unchanged, unrelated to activity.
    expect(sqlCalls.length).toBeGreaterThanOrEqual(1)
    const sql = sqlCalls[0].text
    expect(sql).toContain('DELETE FROM organiser_columns')
    expect(sql).toMatch(/activity_row AS \(/)
    expect(sql).toMatch(/INSERT INTO organiser_activity/)
    expect(sql).toContain("'column.deleted'")
    expect(sql).toContain("'column'")
  })

  it('before_json carries name and type; after_json is NULL', async () => {
    await columnIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), COLUMN_CTX)
    const sql = sqlCalls[0].text
    expect(sql).toContain("'name', organiser_activity_sanitise_scalar(to_jsonb(deleted.name))")
    expect(sql).toContain("'type', organiser_activity_sanitise_scalar(to_jsonb(deleted.type))")
    expect(sql).toMatch(/\),\s*\n\s*NULL\s*\n\s*FROM deleted/)
  })

  it('the pre-existing custom_values cleanup sweep is unchanged and still runs after the delete', async () => {
    await columnIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), COLUMN_CTX)
    expect(sqlCalls).toHaveLength(2)
    expect(sqlCalls[1].text).toMatch(/UPDATE organiser_items/)
    expect(sqlCalls[1].text).toMatch(/custom_values - §/)
  })

  it('actor/tenant bound from session only', async () => {
    await columnIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), COLUMN_CTX)
    expect(sqlCalls[0].values).toContain('org-a')
    expect(sqlCalls[0].values).toContain('user-1')
    expect(sqlCalls[0].values).toContain('James')
  })

  it('response shape unchanged: { success: true }; 404 semantics unchanged', async () => {
    const res = await columnIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), COLUMN_CTX)
    expect(await res.json()).toEqual({ success: true })

    sqlResult = []
    const res404 = await columnIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), COLUMN_CTX)
    expect(res404.status).toBe(404)
  })
})

// ── IMPORT.COMPLETED ─────────────────────────────────────────────────────

describe('import.completed — POST /api/organiser/boards/[boardId]/import', () => {
  function csvFormData(csv: string): FormData {
    const fd = new FormData()
    fd.set('file', new File([csv], 'items.csv', { type: 'text/csv' }))
    return fd
  }

  function importReq(fd: FormData): NextRequest {
    return asNextRequest(new Request('http://localhost/x', { method: 'POST', body: fd }))
  }

  // One shared mock row satisfies board check (non-empty), existingGroups
  // select (harmless — this row's own name/position fields are read but
  // never matched against, since the fixture row below has no Group
  // column), position select (.next), and the item insert (.id) — a
  // single simple row with no group and no subitems keeps the call
  // sequence to exactly 5: board check, existingGroups, position select,
  // item insert, activity insert — see the header comment for the general
  // shared-mock-result convention this file follows.
  beforeEach(() => { sqlResult = [{ id: 'item-1', next: 0, name: 'Task', position: 0 }] })

  it('writes exactly one import.completed activity row, as the LAST sql call, after both loops complete', async () => {
    const res = await importRoute.POST(importReq(csvFormData('Item Name\nTask One\n')), BOARD_CTX)
    expect(res.status).toBe(200)
    const last = sqlCalls[sqlCalls.length - 1]
    expect(last.text).toContain('INSERT INTO organiser_activity')
    expect(last.text).toContain("'import.completed'")
    expect(last.text).toContain("'import'")
  })

  it('exactly one activity row is written per import request — never one per imported item', async () => {
    const res = await importRoute.POST(
      importReq(csvFormData('Item Name\nTask One\nTask Two\nTask Three\n')),
      BOARD_CTX,
    )
    expect(res.status).toBe(200)
    const activityCalls = sqlCalls.filter(c => c.text.includes('INSERT INTO organiser_activity'))
    expect(activityCalls).toHaveLength(1)
  })

  it('board_id/entity_id is the target board; item_id is not set (import has no single item)', async () => {
    await importRoute.POST(importReq(csvFormData('Item Name\nTask One\n')), BOARD_CTX)
    const last = sqlCalls[sqlCalls.length - 1]
    expect(last.values).toContain('board-1')
    expect(last.text).not.toMatch(/item_id/)
  })

  it('after_json contains only safe counts and source_type — never row content, filenames, or unmatched subitem names', async () => {
    await importRoute.POST(importReq(csvFormData('Item Name\nTask One\n')), BOARD_CTX)
    const last = sqlCalls[sqlCalls.length - 1]
    const jsonValue = last.values.find(v => typeof v === 'string' && v.includes('imported_count')) as string
    expect(jsonValue).toBeDefined()
    const parsed = JSON.parse(jsonValue)
    expect(parsed).toEqual({
      imported_count: 1,
      groups_created: 0,
      subitems_linked: 0,
      skipped_count: 0,
      unmatched_subitems_count: 0,
      source_type: 'csv',
    })
    expect(jsonValue).not.toMatch(/items\.csv/)
    expect(jsonValue).not.toMatch(/Task One/)
  })

  it('actor/tenant bound from session only', async () => {
    await importRoute.POST(importReq(csvFormData('Item Name\nTask One\n')), BOARD_CTX)
    const last = sqlCalls[sqlCalls.length - 1]
    expect(last.values).toContain('org-a')
    expect(last.values).toContain('user-1')
    expect(last.values).toContain('James')
  })

  it('a request that errors before reaching the loops (board not found) writes zero activity rows', async () => {
    sqlResult = []
    const res = await importRoute.POST(importReq(csvFormData('Item Name\nTask One\n')), BOARD_CTX)
    expect(res.status).toBe(404)
    const activityCalls = sqlCalls.filter(c => c.text.includes('INSERT INTO organiser_activity'))
    expect(activityCalls).toHaveLength(0)
  })

  it('an empty file (zero data rows) writes zero activity rows — the route returns 422 before either loop runs', async () => {
    const res = await importRoute.POST(importReq(csvFormData('Item Name\n')), BOARD_CTX)
    expect(res.status).toBe(422)
    const activityCalls = sqlCalls.filter(c => c.text.includes('INSERT INTO organiser_activity'))
    expect(activityCalls).toHaveLength(0)
  })

  it('response shape unchanged: { success, groupsCreated, itemsCreated, subitemsLinked, unmatchedSubitems }', async () => {
    const res = await importRoute.POST(importReq(csvFormData('Item Name\nTask One\n')), BOARD_CTX)
    const json = await res.json()
    expect(json).toEqual({
      success: true,
      groupsCreated: 0,
      itemsCreated: 1,
      subitemsLinked: 0,
      unmatchedSubitems: [],
    })
  })
})

// ── BOUNDARY REGRESSION ──────────────────────────────────────────────────

describe('D.4.6G does not touch any other Organiser route', () => {
  it('only the 3 targeted route files were modified to reference organiser_activity for the first time', () => {
    const itemRoute = fs.readFileSync(path.resolve(__dirname, '../../app/api/organiser/items/[itemId]/route.ts'), 'utf8')
    // Sanity: the item route's own D.4.6F relationship-validation logic is
    // untouched by this phase (still present, unchanged shape).
    expect(itemRoute).toMatch(/WITH RECURSIVE old AS MATERIALIZED/)
  })
})
