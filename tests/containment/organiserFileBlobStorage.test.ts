import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Phase D.4.6C-QA-FILE-FIX — Vercel Blob attachment storage hotfix.
// Covers the POST/DELETE route rewrite (fs.writeFile/unlink -> @vercel/blob
// put()/del()) and lib/organiser/attachmentStorage.ts's own helpers.
// @vercel/blob and @/lib/db are both mocked — no real network/DB call.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: (...args: unknown[]) => requireCapabilityMock(...args) }
})

type SqlCall = { text: string; values: unknown[] }
let sqlCalls: SqlCall[] = []
let sqlResult: unknown[] = []
let sqlShouldThrow = false
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  sqlCalls.push({ text: strings.join('§'), values })
  if (sqlShouldThrow) return Promise.reject(new Error('connection terminated unexpectedly at 10.0.4.12:5432 (simulated DB failure)'))
  return Promise.resolve(sqlResult)
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const putMock = vi.fn()
const delMock = vi.fn()
vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => putMock(...args),
  del: (...args: unknown[]) => delMock(...args),
}))

const filesRoute = await import('@/app/api/organiser/items/[itemId]/files/route')
const fileIdRoute = await import('@/app/api/organiser/items/[itemId]/files/[fileId]/route')
const { isManagedOrganiserAttachmentUrl } = await import('@/lib/organiser/attachmentStorage')

const SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'manager', name: 'James' }
const ITEM_CTX = { params: Promise.resolve({ itemId: 'item-1' }) }
const ITEM_FILE_CTX = { params: Promise.resolve({ itemId: 'item-1', fileId: 'file-1' }) }
const MANAGED_URL = 'https://abc123.public.blob.vercel-storage.com/organiser-attachments/org-a/item-1/uuid-invoice.pdf'
const LEGACY_URL = '/organiser-attachments/item-1/uuid-invoice.pdf'

function postReqWithFile(file: File | null): NextRequest {
  const fd = new FormData()
  if (file) fd.append('file', file)
  return asNextRequest(new Request('http://localhost/api/organiser/items/item-1/files', { method: 'POST', body: fd }))
}

beforeEach(() => {
  requireSessionMock.mockReset()
  requireCapabilityMock.mockReset()
  sqlMock.mockReset()
  putMock.mockReset()
  delMock.mockReset()
  sqlCalls = []
  sqlResult = []
  sqlShouldThrow = false
  requireSessionMock.mockResolvedValue(SESSION)
  requireCapabilityMock.mockResolvedValue({ key: 'organiser', config: {} })
  // First sql call in POST is always the item-existence/board_id lookup.
  sqlResult = [{ id: 'item-1', board_id: 'board-1' }]
  putMock.mockResolvedValue({ url: MANAGED_URL, pathname: 'organiser-attachments/org-a/item-1/uuid-invoice.pdf', contentType: 'application/pdf' })
})

// ── isManagedOrganiserAttachmentUrl ──────────────────────────────────────

describe('isManagedOrganiserAttachmentUrl', () => {
  it('recognizes a genuine Vercel Blob public-storage hostname', () => {
    expect(isManagedOrganiserAttachmentUrl(MANAGED_URL)).toBe(true)
  })
  it('rejects a legacy local-path value', () => {
    expect(isManagedOrganiserAttachmentUrl(LEGACY_URL)).toBe(false)
  })
  it('rejects an arbitrary external URL', () => {
    expect(isManagedOrganiserAttachmentUrl('https://evil.example.com/x')).toBe(false)
  })
  it('rejects an unparsable value without throwing', () => {
    expect(isManagedOrganiserAttachmentUrl('not a url')).toBe(false)
  })
})

// ── POST success ──────────────────────────────────────────────────────────

describe('POST /api/organiser/items/[itemId]/files — success path', () => {
  beforeEach(() => {
    // second sql call = the writable-CTE insert+activity
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      sqlCalls.push({ text: strings.join('§'), values })
      if (sqlCalls.length === 1) return Promise.resolve([{ id: 'item-1', board_id: 'board-1' }])
      return Promise.resolve([{ id: 'file-1', file_name: 'invoice.pdf', file_url: MANAGED_URL, file_size: 1234, created_at: new Date() }])
    })
  })

  it('uploads to Blob before touching the DB, with a server-generated, org+item-scoped pathname (never the raw filename alone)', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'invoice.pdf', { type: 'application/pdf' })
    await filesRoute.POST(postReqWithFile(file), ITEM_CTX)
    expect(putMock).toHaveBeenCalledTimes(1)
    const [pathname, , opts] = putMock.mock.calls[0]
    expect(pathname).toMatch(/^organiser-attachments\/org-a\/item-1\/[0-9a-f-]{36}-invoice\.pdf$/)
    expect(opts).toMatchObject({ access: 'public', contentType: 'application/pdf' })
  })

  it('stores Blob\'s own canonical url as file_url, and the original filename as file_name', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'invoice.pdf', { type: 'application/pdf' })
    await filesRoute.POST(postReqWithFile(file), ITEM_CTX)
    const insertCall = sqlCalls[1]
    expect(insertCall.values).toContain(MANAGED_URL)
    expect(insertCall.values).toContain('invoice.pdf')
  })

  it('DB insert + activity row remain one atomic writable-CTE statement, unchanged in shape', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'invoice.pdf', { type: 'application/pdf' })
    await filesRoute.POST(postReqWithFile(file), ITEM_CTX)
    const sql = sqlCalls[1].text
    expect(sql).toMatch(/WITH inserted AS \(\s*\n\s*INSERT INTO organiser_item_files/)
    expect(sql).toMatch(/activity_row AS \(/)
    expect(sql).toContain("'file.added'")
  })

  it('returns { file: {...} } with the Blob URL, and never calls del()', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'invoice.pdf', { type: 'application/pdf' })
    const res = await filesRoute.POST(postReqWithFile(file), ITEM_CTX)
    const json = await res.json()
    expect(json.file).toMatchObject({ id: 'file-1', file_url: MANAGED_URL })
    expect(delMock).not.toHaveBeenCalled()
  })

  it('a path-traversal-shaped filename never escapes the generated pathname\'s fixed org/item prefix', async () => {
    const file = new File([new Uint8Array([1])], '../../../etc/passwd', { type: 'text/plain' })
    await filesRoute.POST(postReqWithFile(file), ITEM_CTX)
    const [pathname] = putMock.mock.calls[0]
    expect(pathname.startsWith('organiser-attachments/org-a/item-1/')).toBe(true)
    expect(pathname).not.toMatch(/\.\./)
  })
})

// ── POST validation (no Blob/DB call for rejected input) ────────────────

describe('POST — input validation short-circuits before any Blob/DB call', () => {
  it('missing file field -> 400, no put(), no second sql call', async () => {
    const res = await filesRoute.POST(postReqWithFile(null), ITEM_CTX)
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
    expect(sqlCalls).toHaveLength(1) // only the item-lookup
  })

  it('empty file (0 bytes) -> 400, no put()', async () => {
    const file = new File([], 'empty.txt', { type: 'text/plain' })
    const res = await filesRoute.POST(postReqWithFile(file), ITEM_CTX)
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('oversized file (>15MB) -> 400, no put()', async () => {
    const big = new Uint8Array(15 * 1024 * 1024 + 1)
    const file = new File([big], 'big.bin', { type: 'application/octet-stream' })
    const res = await filesRoute.POST(postReqWithFile(file), ITEM_CTX)
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('item not found for this tenant -> 404, no put() at all', async () => {
    sqlResult = []
    const file = new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' })
    const res = await filesRoute.POST(postReqWithFile(file), ITEM_CTX)
    expect(res.status).toBe(404)
    expect(putMock).not.toHaveBeenCalled()
  })
})

// ── POST failure modes ───────────────────────────────────────────────────

describe('POST — Blob upload failure', () => {
  it('put() rejecting -> 502, generic error body, no DB insert attempted at all', async () => {
    putMock.mockRejectedValue(new Error('vercel_blob_rw_store123_secretTokenValue leaked in real error'))
    const file = new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' })
    const res = await filesRoute.POST(postReqWithFile(file), ITEM_CTX)
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json).toEqual({ error: expect.any(String) })
    expect(JSON.stringify(json)).not.toMatch(/vercel_blob_rw_|secretToken/)
    // only the item-lookup select ran; the insert+activity CTE never did
    expect(sqlCalls).toHaveLength(1)
  })
})

describe('POST — DB failure after successful Blob upload (compensation)', () => {
  beforeEach(() => {
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      sqlCalls.push({ text: strings.join('§'), values })
      if (sqlCalls.length === 1) return Promise.resolve([{ id: 'item-1', board_id: 'board-1' }])
      return Promise.reject(new Error('relation "organiser_item_files" connection reset (simulated)'))
    })
  })

  it('deletes the now-orphaned Blob object exactly once, using the uploaded url', async () => {
    const file = new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' })
    await filesRoute.POST(postReqWithFile(file), ITEM_CTX)
    expect(delMock).toHaveBeenCalledTimes(1)
    expect(delMock).toHaveBeenCalledWith(MANAGED_URL)
  })

  it('returns a safe generic 500 error — no db error text, no Blob token, no stack trace', async () => {
    const file = new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' })
    const res = await filesRoute.POST(postReqWithFile(file), ITEM_CTX)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(JSON.stringify(json)).not.toMatch(/connection reset|relation "organiser|at Object\.|\.ts:\d+/)
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────

describe('DELETE /api/organiser/items/[itemId]/files/[fileId] — Blob cleanup', () => {
  it('recognized Blob URL: del() is called exactly once with that url', async () => {
    sqlResult = [{ file_url: MANAGED_URL }]
    await fileIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_FILE_CTX)
    expect(delMock).toHaveBeenCalledTimes(1)
    expect(delMock).toHaveBeenCalledWith(MANAGED_URL)
  })

  it('legacy/local-path file_url: del() is NEVER called (never pass an unrecognized URL to Blob del())', async () => {
    sqlResult = [{ file_url: LEGACY_URL }]
    const res = await fileIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_FILE_CTX)
    expect(delMock).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })

  it('a del() failure is swallowed — DB row/activity are already committed and the route still returns success', async () => {
    sqlResult = [{ file_url: MANAGED_URL }]
    delMock.mockRejectedValue(new Error('object not found (simulated)'))
    const res = await fileIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_FILE_CTX)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })

  it('404 when no row matched this tenant/item/file — del() never called', async () => {
    sqlResult = []
    const res = await fileIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_FILE_CTX)
    expect(res.status).toBe(404)
    expect(delMock).not.toHaveBeenCalled()
  })
})

// ── Tenant isolation ──────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('POST binds organisation_id from session only, both in the item lookup and the insert', async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      sqlCalls.push({ text: strings.join('§'), values })
      if (sqlCalls.length === 1) return Promise.resolve([{ id: 'item-1', board_id: 'board-1' }])
      return Promise.resolve([{ id: 'file-1', file_name: 'a.txt', file_url: MANAGED_URL, file_size: 1, created_at: new Date() }])
    })
    const file = new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' })
    await filesRoute.POST(postReqWithFile(file), ITEM_CTX)
    expect(sqlCalls[0].values).toContain('org-a')
    expect(sqlCalls[1].values).toContain('org-a')
  })

  it('an item belonging to a different tenant is invisible: sql filters on organisation_id so a wrong-org session gets 404, never another tenant\'s board_id', async () => {
    sqlResult = [] // wrong-org lookup returns nothing, per the route's own organisation_id-scoped WHERE
    const file = new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' })
    const res = await filesRoute.POST(postReqWithFile(file), ITEM_CTX)
    expect(res.status).toBe(404)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('DELETE binds organisation_id from session in the WHERE clause', async () => {
    sqlResult = [{ file_url: MANAGED_URL }]
    await fileIdRoute.DELETE(asNextRequest(new Request('http://localhost/x', { method: 'DELETE' })), ITEM_FILE_CTX)
    expect(sqlCalls[0].values).toContain('org-a')
  })
})
