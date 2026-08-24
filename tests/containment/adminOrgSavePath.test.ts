import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// Modular Platform Foundation Phase F.6R — repairs the pre-existing
// admin organisation Save path (predates and is unrelated to the
// capability-platform work; confirmed in Phase F.6Q via git history to
// have never been touched by PR #50/#51). Two independent defects on
// the same broken path:
//   1. app/api/admin/orgs/route.ts's PATCH/DELETE compared the TEXT
//      organisations.id column against an explicit ::uuid cast,
//      which Postgres cannot do for an equality operator regardless
//      of whether the id string happens to be UUID-shaped.
//   2. app/admin/orgs/AdminClient.tsx's saveOrg had no exception
//      handling at all, so any thrown error (a non-JSON error body,
//      a network rejection, anything) permanently stranded the
//      "Saving…" pending state.
// This suite proves both fixes: PATCH/DELETE (1) via a real,
// behavioural route-handler test (existing repo convention — mocked
// @/lib/session + @/lib/db, the exported route functions invoked
// directly), and saveOrg (2) via source-level containment assertions,
// since this repo has no React component-rendering test
// infrastructure — none was added here.

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

const getSessionMock = vi.fn()
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>()
  return { ...actual, getSession: (...args: unknown[]) => getSessionMock(...args) }
})

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}
function sqlCallArgs(index: number): unknown[] {
  return sqlMock.mock.calls[index] as unknown as unknown[]
}
function sqlCallText(index: number): string {
  const args = sqlCallArgs(index)
  return (args[0] as TemplateStringsArray).join(' ')
}

const { PATCH, DELETE } = await import('@/app/api/admin/orgs/route')

const SUPER_ADMIN = { userId: 'u1', organisationId: 'brainbase-org', role: 'super_admin', name: 'James' }

// A real, live, opaque TEXT organisation id — Phase F.6Q confirmed the
// actual Brainbase/LD Tennis ids are UUID-shaped text (a legacy
// artifact), but the schema's own declared default is a cuid — a
// non-UUID-shaped string. The fix must work for BOTH shapes, since
// organisation ids are opaque TEXT, never validated/cast as UUID.
const CUID_SHAPED_ID = 'clx8f9a2b0000abc123def456'

beforeEach(() => {
  getSessionMock.mockReset()
  sqlMock.mockReset()
  responseQueue = []
  callCount = 0
  getSessionMock.mockResolvedValue(SUPER_ADMIN)
})

describe('PATCH /api/admin/orgs — TEXT id contract (Phase F.6R)', () => {
  it('6. PATCH no longer applies ::uuid to the organisation id', async () => {
    queue([{ id: CUID_SHAPED_ID, name: 'New Name', slug: 'new-slug' }])
    const req = asNextRequest(new Request(`http://localhost/api/admin/orgs?id=${CUID_SHAPED_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name', slug: 'new-slug' }),
    }))
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    expect(sqlCallText(0)).not.toMatch(/::uuid/i)
  })

  it('8a. PATCH compares against the opaque id directly, with no other type conversion', async () => {
    queue([{ id: CUID_SHAPED_ID, name: 'New Name', slug: 'new-slug' }])
    const req = asNextRequest(new Request(`http://localhost/api/admin/orgs?id=${CUID_SHAPED_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name', slug: 'new-slug' }),
    }))
    await PATCH(req)
    expect(sqlCallText(0)).toMatch(/WHERE id = /)
    expect(sqlCallArgs(0)).toContain(CUID_SHAPED_ID)
  })

  it('a cuid-shaped id (never UUID-shaped) succeeds — the old cast would have thrown on syntax alone for this shape', async () => {
    queue([{ id: CUID_SHAPED_ID, name: 'Renamed', slug: 'renamed' }])
    const req = asNextRequest(new Request(`http://localhost/api/admin/orgs?id=${CUID_SHAPED_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed', slug: 'renamed' }),
    }))
    const res = await PATCH(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.org.id).toBe(CUID_SHAPED_ID)
  })

  it('still returns 404 when no row matches', async () => {
    queue([])
    const req = asNextRequest(new Request(`http://localhost/api/admin/orgs?id=${CUID_SHAPED_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', slug: 'x' }),
    }))
    const res = await PATCH(req)
    expect(res.status).toBe(404)
  })

  it('still rejects a non-super_admin caller before any DB access', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u2', role: 'manager' })
    const req = asNextRequest(new Request(`http://localhost/api/admin/orgs?id=${CUID_SHAPED_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', slug: 'x' }),
    }))
    const res = await PATCH(req)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/admin/orgs — TEXT id contract (Phase F.6R)', () => {
  it('7. DELETE no longer applies ::uuid to the organisation id', async () => {
    queue([{ n: 0 }], [])
    const req = asNextRequest(new Request(`http://localhost/api/admin/orgs?id=${CUID_SHAPED_ID}`, { method: 'DELETE' }))
    const res = await DELETE(req)
    expect(res.status).toBe(200)
    expect(sqlCallText(0)).not.toMatch(/::uuid/i)
    expect(sqlCallText(1)).not.toMatch(/::uuid/i)
  })

  it('8b. the assigned-users pre-check and the DELETE itself both compare the opaque id directly', async () => {
    queue([{ n: 0 }], [])
    const req = asNextRequest(new Request(`http://localhost/api/admin/orgs?id=${CUID_SHAPED_ID}`, { method: 'DELETE' }))
    await DELETE(req)
    expect(sqlCallArgs(0)).toContain(CUID_SHAPED_ID)
    expect(sqlCallArgs(1)).toContain(CUID_SHAPED_ID)
    // The unrelated COUNT(*)::int aggregate cast is untouched — only the id comparison changed.
    expect(sqlCallText(0)).toMatch(/COUNT\(\*\)::int/i)
  })

  it('a cuid-shaped id succeeds for the assigned-users safety check', async () => {
    queue([{ n: 2 }])
    const req = asNextRequest(new Request(`http://localhost/api/admin/orgs?id=${CUID_SHAPED_ID}`, { method: 'DELETE' }))
    const res = await DELETE(req)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/2 user/i)
  })
})

describe('AdminClient.tsx — saveOrg exception/pending-state lifecycle (Phase F.6R)', () => {
  const ADMIN_CLIENT_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../../app/admin/orgs/AdminClient.tsx'),
    'utf-8',
  )
  function stripAdminComments(src: string): string {
    return src
      .replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
  }
  const ADMIN_CODE = stripAdminComments(ADMIN_CLIENT_SOURCE)

  function saveOrgBody(): string {
    const start = ADMIN_CODE.indexOf('async function saveOrg(')
    expect(start, 'expected to find saveOrg(...)').toBeGreaterThan(-1)
    const end = ADMIN_CODE.indexOf('\n  }\n', start)
    return ADMIN_CODE.slice(start, end)
  }

  it('1. saveOrg wraps its fetch/response handling in try/catch', () => {
    const body = saveOrgBody()
    expect(body).toMatch(/try\s*\{[\s\S]*await fetch\([\s\S]*\}\s*catch/)
  })

  it('2. saving state is cleared via a single finally block, not duplicated per-branch calls', () => {
    const body = saveOrgBody()
    expect(body).toMatch(/finally\s*\{\s*setSaving\(false\);\s*\}/)
    // Only the initial setSaving(true) should remain outside the finally.
    const setSavingFalseCount = (body.match(/setSaving\(false\)/g) ?? []).length
    expect(setSavingFalseCount).toBe(1)
  })

  it('3. a response-body parsing failure is tolerated and surfaces the generic fallback, never throws unguarded', () => {
    const body = saveOrgBody()
    expect(body).toMatch(/res\.json\(\)\.catch\(\(\) => null\)/)
    expect(body).toMatch(/Unable to save organisation\./)
  })

  it('the network/thrown-exception catch branch surfaces the same generic fallback, never raw error text', () => {
    const body = saveOrgBody()
    expect(body).toMatch(/catch\s*\{\s*flash\('Unable to save organisation\.', true\);\s*\}/)
  })

  it('4. the success path is preserved — org state update, modal close, and success flash all remain', () => {
    const body = saveOrgBody()
    expect(body).toMatch(/setOrgs\(p => p\.map\(o => o\.id === editOrg\.id \? data\.org : o\)\)/)
    expect(body).toMatch(/flash\(`Organisation "\$\{data\.org\.name\}" updated\.`\)/)
  })

  it('5. the modal only closes (setEditOrg(null)) on the success path, never in a failure branch', () => {
    const body = saveOrgBody()
    const closeIndex = body.indexOf('setEditOrg(null)')
    const catchIndex = body.indexOf('} catch {')
    expect(closeIndex).toBeGreaterThan(-1)
    expect(catchIndex).toBeGreaterThan(-1)
    expect(closeIndex).toBeLessThan(catchIndex)
  })
})
