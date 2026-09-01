import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

// Events & Ticketing Phase 6 — internal staff notes (event_order_notes).
// Route-level tests only: every dependency is mocked, no real database.
// Real-Postgres proof of the schema's own tenant/event/order integrity
// (composite FK, cascade, soft delete, author SET NULL, idempotent
// migration) lives in scripts/tests/verify-events-order-notes.sh — not
// duplicated here. What THIS file proves: route orchestration,
// permission/tenant enforcement, audit-log call shape (never the note
// body), and that the CRM boundary is never crossed.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
    checkCapability: vi.fn().mockResolvedValue({ allowed: true, entitlement: { key: 'events', config: {} } }),
  }
})

const logNoteAddedMock = vi.fn().mockResolvedValue(undefined)
const logNoteEditedMock = vi.fn().mockResolvedValue(undefined)
const logNoteDeletedMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/events/auditLog', () => ({
  logNoteAdded: (...args: unknown[]) => logNoteAddedMock(...args),
  logNoteEdited: (...args: unknown[]) => logNoteEditedMock(...args),
  logNoteDeleted: (...args: unknown[]) => logNoteDeletedMock(...args),
}))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function sessionAs(role: string, organisationId = 'org-a') { return { userId: 'staff-1', organisationId, role, name: 'Staff One' } }
function jsonReq(body?: unknown, method = 'POST') {
  return asNextRequest(new Request('http://localhost/x', {
    method, headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

const listCreateRoute = await import('@/app/api/events/[id]/orders/[orderId]/notes/route')
const editDeleteRoute = await import('@/app/api/events/[id]/orders/[orderId]/notes/[noteId]/route')

const CTX = { params: Promise.resolve({ id: 'event-1', orderId: 'order-1' }) }
const NOTE_CTX = { params: Promise.resolve({ id: 'event-1', orderId: 'order-1', noteId: 'note-1' }) }

beforeEach(() => {
  sqlMock.mockClear()
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  logNoteAddedMock.mockClear()
  logNoteEditedMock.mockClear()
  logNoteDeletedMock.mockClear()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
  requireCapabilityMock.mockResolvedValue({ key: 'events', config: {} })
})

// ─── List notes ─────────────────────────────────────────────────────

describe('GET notes — list', () => {
  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await listCreateRoute.GET(jsonReq(undefined, 'GET'), CTX)
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer cannot list notes -> 403', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await listCreateRoute.GET(jsonReq(undefined, 'GET'), CTX)
    expect(res.status).toBe(403)
  })

  it('cross-tenant/unknown order -> 404, note query never runs', async () => {
    queue([])
    const res = await listCreateRoute.GET(jsonReq(undefined, 'GET'), CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('returns notes for a real, same-tenant order, excluding soft-deleted rows by construction (the query itself filters deleted_at IS NULL)', async () => {
    queue([{ id: 'order-1' }], [{ id: 'note-1', body: 'hello', author_name_snapshot: 'Staff One', created_at: 't1', updated_at: 't1', edited_at: null }])
    const res = await listCreateRoute.GET(jsonReq(undefined, 'GET'), CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notes).toHaveLength(1)
    const listCall = sqlMock.mock.calls[1] as unknown as TemplateStringsArray[]
    expect(listCall[0].join('')).toMatch(/deleted_at IS NULL/)
  })
})

// ─── Create note ────────────────────────────────────────────────────

describe('POST notes — create', () => {
  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await listCreateRoute.POST(jsonReq({ body: 'hi' }), CTX)
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer cannot create a note -> 403', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await listCreateRoute.POST(jsonReq({ body: 'hi' }), CTX)
    expect(res.status).toBe(403)
  })

  it('empty body is rejected -> 400, no DB call', async () => {
    const res = await listCreateRoute.POST(jsonReq({ body: '   ' }), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('missing body field is rejected -> 400', async () => {
    const res = await listCreateRoute.POST(jsonReq({}), CTX)
    expect(res.status).toBe(400)
  })

  it('a body over the documented maximum length is rejected -> 400, no DB call', async () => {
    const res = await listCreateRoute.POST(jsonReq({ body: 'x'.repeat(4001) }), CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('a body at exactly the maximum length is accepted', async () => {
    queue([{ id: 'order-1' }], [{ id: 'note-1', body: 'x'.repeat(4000), author_name_snapshot: 'Staff One', created_at: 't1', updated_at: 't1', edited_at: null }])
    const res = await listCreateRoute.POST(jsonReq({ body: 'x'.repeat(4000) }), CTX)
    expect(res.status).toBe(201)
  })

  it('cross-tenant/unknown order -> 404, insert never attempted', async () => {
    queue([])
    const res = await listCreateRoute.POST(jsonReq({ body: 'hi' }), CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('a real order in this organisation succeeds — organisation_id and event_id come from session/URL, never the request body', async () => {
    queue([{ id: 'order-1' }], [{ id: 'note-1', body: 'trimmed body', author_name_snapshot: 'Staff One', created_at: 't1', updated_at: 't1', edited_at: null }])
    const res = await listCreateRoute.POST(jsonReq({ body: '  trimmed body  ', organisation_id: 'org-evil', event_id: 'event-evil' }), CTX)
    expect(res.status).toBe(201)
    const insertCall = sqlMock.mock.calls[1] as unknown as [TemplateStringsArray, ...unknown[]]
    const values = insertCall.slice(1)
    expect(values).toContain('org-a') // session.organisationId, not the body's org-evil
    expect(values).toContain('event-1') // URL param, not the body's event-evil
    expect(values).toContain('trimmed body') // trimmed
    expect(values).not.toContain('org-evil')
    expect(values).not.toContain('event-evil')
  })

  it('a successful create logs a note_added audit entry containing only the note id, never the note body', async () => {
    queue([{ id: 'order-1' }], [{ id: 'note-99', body: 'sensitive note content', author_name_snapshot: 'Staff One', created_at: 't1', updated_at: 't1', edited_at: null }])
    const res = await listCreateRoute.POST(jsonReq({ body: 'sensitive note content' }), CTX)
    expect(res.status).toBe(201)
    expect(logNoteAddedMock).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', noteId: 'note-99' }))
    const loggedArgs = JSON.stringify(logNoteAddedMock.mock.calls[0])
    expect(loggedArgs).not.toContain('sensitive note content')
  })
})

// ─── Edit note ──────────────────────────────────────────────────────

describe('PATCH notes/[noteId] — edit', () => {
  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await editDeleteRoute.PATCH(jsonReq({ body: 'x' }, 'PATCH'), NOTE_CTX)
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer cannot edit -> 403', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await editDeleteRoute.PATCH(jsonReq({ body: 'x' }, 'PATCH'), NOTE_CTX)
    expect(res.status).toBe(403)
  })

  it('empty body -> 400, no DB call', async () => {
    const res = await editDeleteRoute.PATCH(jsonReq({ body: '  ' }, 'PATCH'), NOTE_CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('cross-tenant/unknown/already-deleted note -> 404 (the UPDATE itself filters deleted_at IS NULL, so a soft-deleted note cannot be revived by editing it)', async () => {
    queue([])
    const res = await editDeleteRoute.PATCH(jsonReq({ body: 'new text' }, 'PATCH'), NOTE_CTX)
    expect(res.status).toBe(404)
    const updateCall = sqlMock.mock.calls[0] as unknown as TemplateStringsArray[]
    expect(updateCall[0].join('')).toMatch(/deleted_at IS NULL/)
  })

  it('a successful edit sets edited_at and logs a note_edited audit entry with no note body', async () => {
    queue([{ id: 'note-1', body: 'updated text', author_name_snapshot: 'Staff One', created_at: 't1', updated_at: 't2', edited_at: 't2' }])
    const res = await editDeleteRoute.PATCH(jsonReq({ body: 'updated text' }, 'PATCH'), NOTE_CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[0] as unknown as TemplateStringsArray[]
    expect(updateCall[0].join('')).toMatch(/edited_at = now\(\)/)
    expect(logNoteEditedMock).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', noteId: 'note-1' }))
    expect(JSON.stringify(logNoteEditedMock.mock.calls[0])).not.toContain('updated text')
  })

  it('never touches author_user_id or author_name_snapshot — an edit does not rewrite who wrote the note', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/notes/[noteId]/route.ts'))
    const patchFn = code.slice(code.indexOf('export async function PATCH'), code.indexOf('export async function DELETE'))
    expect(patchFn).not.toMatch(/author_user_id\s*=/)
    expect(patchFn).not.toMatch(/author_name_snapshot\s*=/)
  })
})

// ─── Soft-delete note ───────────────────────────────────────────────

describe('DELETE notes/[noteId] — soft delete', () => {
  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await editDeleteRoute.DELETE(jsonReq(undefined, 'DELETE'), NOTE_CTX)
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer cannot delete -> 403', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await editDeleteRoute.DELETE(jsonReq(undefined, 'DELETE'), NOTE_CTX)
    expect(res.status).toBe(403)
  })

  it('cross-tenant/unknown/already-deleted note -> 404', async () => {
    queue([])
    const res = await editDeleteRoute.DELETE(jsonReq(undefined, 'DELETE'), NOTE_CTX)
    expect(res.status).toBe(404)
  })

  it('a successful delete is a soft delete (UPDATE deleted_at), never a hard DELETE, and logs a note_deleted audit entry', async () => {
    queue([{ id: 'note-1' }])
    const res = await editDeleteRoute.DELETE(jsonReq(undefined, 'DELETE'), NOTE_CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[0] as unknown as TemplateStringsArray[]
    const text = updateCall[0].join('')
    expect(text).toMatch(/UPDATE event_order_notes/)
    expect(text).toMatch(/SET deleted_at = now\(\)/)
    expect(text).not.toMatch(/^\s*DELETE FROM/i)
    expect(logNoteDeletedMock).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', noteId: 'note-1' }))
  })

  it('this route file never issues a hard DELETE FROM statement anywhere', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/notes/[noteId]/route.ts'))
    expect(code).not.toMatch(/DELETE FROM/i)
  })
})

// ─── CRM boundary ───────────────────────────────────────────────────

describe('CRM boundary — internal notes never reach CRM', () => {
  it('neither notes route file imports anything from lib/crm', () => {
    const listCreate = read('app/api/events/[id]/orders/[orderId]/notes/route.ts')
    const editDelete = read('app/api/events/[id]/orders/[orderId]/notes/[noteId]/route.ts')
    expect(listCreate).not.toMatch(/from ['"]@\/lib\/crm/)
    expect(editDelete).not.toMatch(/from ['"]@\/lib\/crm/)
  })

  it('the purchaser-edit route never touches crm_contact_id — editing purchaser details does not relink or overwrite the CRM contact', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/route.ts'))
    // crm_contact_id may appear in a RETURNING/SELECT list (read-only),
    // but never on the left-hand side of an assignment. Scope the check
    // to the SET...WHERE region specifically, since crm_contact_id does
    // legitimately appear later in the same statement's RETURNING list.
    expect(code).not.toMatch(/crm_contact_id\s*=\s*\$\{/)
    const setClause = code.slice(code.indexOf('SET'), code.indexOf('WHERE', code.indexOf('SET')))
    expect(setClause).not.toMatch(/crm_contact_id/)
  })
})

// ─── Attendee edit preserves ticket token / check-in history ───────

describe('Attendee edit — preserves ticket_token and check-in history (§ existing Phase 6 work, retained)', () => {
  it('the attendee-edit route never assigns ticket_token, checked_in_at, or checked_in_by_user_id', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/attendees/[attendeeId]/route.ts'))
    expect(code).not.toMatch(/SET[^;]*ticket_token\s*=/i)
    expect(code).not.toMatch(/SET[^;]*checked_in_at\s*=/i)
    expect(code).not.toMatch(/SET[^;]*checked_in_by_user_id\s*=/i)
  })
})

// ─── Response edit preserves snapshots ─────────────────────────────

describe('Response edit — preserves snapshots (§ existing Phase 6 work, retained)', () => {
  it('the response-edit route never assigns question_id, question_label_snapshot, or field_type_snapshot', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/responses/[responseId]/route.ts'))
    expect(code).not.toMatch(/SET[^;]*question_id\s*=/i)
    expect(code).not.toMatch(/SET[^;]*question_label_snapshot\s*=/i)
    expect(code).not.toMatch(/SET[^;]*field_type_snapshot\s*=/i)
  })
})

// ─── Public exposure ────────────────────────────────────────────────

describe('Public privacy — internal notes are never exposed publicly', () => {
  it('no file under app/api/public or the public ticket page references event_order_notes', () => {
    const publicDirs = ['app/api/public/events', 'lib/events/publicTicket.ts', 'app/t']
    for (const dir of publicDirs) {
      const full = path.join(process.cwd(), dir)
      if (!fs.existsSync(full)) continue
      const files = fs.statSync(full).isDirectory() ? walk(full) : [full]
      for (const f of files) {
        const content = fs.readFileSync(f, 'utf8')
        expect(content, `${f} must not reference event_order_notes`).not.toMatch(/event_order_notes/)
      }
    }
  })
})

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}
