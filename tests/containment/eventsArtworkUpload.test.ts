import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

// Events & Ticketing — production-safe event artwork upload (Vercel
// Blob). Route-level behavior proven through the real route module with
// @vercel/blob's put()/del() mocked (no real network/credential
// dependency — this repo's dev environment has no BLOB_READ_WRITE_TOKEN
// configured, see the accompanying report), matching every other Events
// containment test's established sql/session mocking pattern.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

// ─── Mocks ──────────────────────────────────────────────────────────

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: vi.fn().mockResolvedValue({ key: 'events', config: {} }) }
})

const putMock = vi.fn()
const delMock = vi.fn()
vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => putMock(...args),
  del: (...args: unknown[]) => delMock(...args),
}))

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}
function sessionAs(role: string, organisationId = 'org-a') {
  return { userId: 'u1', organisationId, role }
}

const artworkRoute = await import('@/app/api/events/[id]/artwork/route')
const EVENT_CTX = { params: Promise.resolve({ id: 'event-1' }) }

const MANAGED_URL = 'https://abc123.public.blob.vercel-storage.com/events/org-a/event-1/old-uuid.jpg'
const EXTERNAL_URL = 'https://example.com/manually-pasted-poster.jpg'

const EVENT_NO_ARTWORK = { id: 'event-1', artwork_url: null }
const EVENT_WITH_MANAGED_ARTWORK = { id: 'event-1', artwork_url: MANAGED_URL }
const EVENT_WITH_EXTERNAL_ARTWORK = { id: 'event-1', artwork_url: EXTERNAL_URL }

beforeEach(() => {
  requireSessionMock.mockReset()
  sqlMock.mockReset()
  putMock.mockReset()
  delMock.mockReset()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
  putMock.mockResolvedValue({ url: 'https://abc123.public.blob.vercel-storage.com/events/org-a/event-1/new-uuid.jpg' })
  delMock.mockResolvedValue(undefined)
})

// ─── Byte fixtures — real magic-byte signatures, not just declared MIME ──

function jpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
}
function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
}
function webpBytes(): Uint8Array {
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0, 0, 0, 0, 0])
}
function plainTextBytes(): Uint8Array {
  return new TextEncoder().encode('this is not an image, just plain text padding to be a plausible size')
}

function uploadReq(file: File, url = 'http://localhost/api/events/event-1/artwork') {
  const fd = new FormData()
  fd.append('file', file)
  return asNextRequest(new Request(url, { method: 'POST', body: fd }))
}
function deleteReq(url = 'http://localhost/api/events/event-1/artwork') {
  return asNextRequest(new Request(url, { method: 'DELETE' }))
}

// ─── Permissions ────────────────────────────────────────────────────

describe('POST /api/events/[id]/artwork — permissions', () => {
  it('no session -> 401, no upload attempted', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await artworkRoute.POST(uploadReq(new File([jpegBytes()], 'a.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    expect(res.status).toBe(401)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('viewer cannot upload -> 403, no upload attempted', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await artworkRoute.POST(uploadReq(new File([jpegBytes()], 'a.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    expect(res.status).toBe(403)
    expect(putMock).not.toHaveBeenCalled()
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('manager can upload -> 200, event updated', async () => {
    queue([EVENT_NO_ARTWORK], [{ artwork_url: 'https://abc123.public.blob.vercel-storage.com/events/org-a/event-1/new-uuid.jpg' }])
    const res = await artworkRoute.POST(uploadReq(new File([jpegBytes()], 'a.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    expect(res.status).toBe(200)
    expect(putMock).toHaveBeenCalledTimes(1)
  })

  it('a cross-tenant event (belongs to a different organisation) is rejected -> 404, no upload attempted', async () => {
    queue([]) // ownership SELECT scoped to the caller's own org finds nothing
    const res = await artworkRoute.POST(uploadReq(new File([jpegBytes()], 'a.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    expect(res.status).toBe(404)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('capability not entitled -> rejected before any upload/db mutation is attempted', async () => {
    const { checkCapability } = await import('@/lib/capabilities/requireCapability')
    const original = checkCapability
    vi.spyOn(await import('@/lib/capabilities/requireCapability'), 'requireCapability').mockRejectedValueOnce(new Error('Forbidden'))
    const res = await artworkRoute.POST(uploadReq(new File([jpegBytes()], 'a.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    expect(res.status).toBe(403)
    expect(putMock).not.toHaveBeenCalled()
    void original
  })
})

// ─── Validation ─────────────────────────────────────────────────────

describe('POST /api/events/[id]/artwork — file validation', () => {
  it('a genuine JPEG is accepted', async () => {
    queue([EVENT_NO_ARTWORK], [{ artwork_url: 'x' }])
    const res = await artworkRoute.POST(uploadReq(new File([jpegBytes()], 'a.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    expect(res.status).toBe(200)
  })

  it('a genuine PNG is accepted', async () => {
    queue([EVENT_NO_ARTWORK], [{ artwork_url: 'x' }])
    const res = await artworkRoute.POST(uploadReq(new File([pngBytes()], 'a.png', { type: 'image/png' })), EVENT_CTX)
    expect(res.status).toBe(200)
  })

  it('a genuine WebP is accepted', async () => {
    queue([EVENT_NO_ARTWORK], [{ artwork_url: 'x' }])
    const res = await artworkRoute.POST(uploadReq(new File([webpBytes()], 'a.webp', { type: 'image/webp' })), EVENT_CTX)
    expect(res.status).toBe(200)
  })

  it('an unsupported declared MIME type is rejected -> 400, no upload attempted', async () => {
    queue([EVENT_NO_ARTWORK])
    const res = await artworkRoute.POST(uploadReq(new File([plainTextBytes()], 'a.txt', { type: 'text/plain' })), EVENT_CTX)
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('an oversized file is rejected -> 400, no upload attempted', async () => {
    queue([EVENT_NO_ARTWORK])
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    big.set(jpegBytes())
    const res = await artworkRoute.POST(uploadReq(new File([big], 'big.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('an empty file is rejected -> 400, no upload attempted', async () => {
    queue([EVENT_NO_ARTWORK])
    const res = await artworkRoute.POST(uploadReq(new File([], 'empty.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('a misleading extension/declared type over content that is not an image at all is rejected — magic-byte sniff fails', async () => {
    queue([EVENT_NO_ARTWORK])
    // Filename and declared Content-Type both claim JPEG; actual bytes are plain text.
    const res = await artworkRoute.POST(uploadReq(new File([plainTextBytes()], 'photo.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/does not match an allowed image type/i)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('a declared type that disagrees with the real byte signature is rejected — declaring PNG over genuine JPEG bytes', async () => {
    queue([EVENT_NO_ARTWORK])
    const res = await artworkRoute.POST(uploadReq(new File([jpegBytes()], 'photo.png', { type: 'image/png' })), EVENT_CTX)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/does not match its declared type/i)
    expect(putMock).not.toHaveBeenCalled()
  })
})

// ─── Storage key design ─────────────────────────────────────────────

describe('POST /api/events/[id]/artwork — storage key design', () => {
  it('the Blob pathname is tenant/event-scoped and generated — never the raw uploaded filename', async () => {
    queue([EVENT_NO_ARTWORK], [{ artwork_url: 'x' }])
    await artworkRoute.POST(uploadReq(new File([jpegBytes()], '../../etc/passwd.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    const pathname = putMock.mock.calls[0][0] as string
    expect(pathname).toMatch(/^events\/org-a\/event-1\/[0-9a-f-]{36}\.jpg$/)
    expect(pathname).not.toMatch(/passwd/)
    expect(pathname).not.toMatch(/\.\./)
  })

  it('the pathname uses the caller\'s own session organisationId, never a client-supplied one', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager', 'org-real'))
    queue([{ id: 'event-1', artwork_url: null }], [{ artwork_url: 'x' }])
    await artworkRoute.POST(uploadReq(new File([jpegBytes()], 'a.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    const pathname = putMock.mock.calls[0][0] as string
    expect(pathname.startsWith('events/org-real/')).toBe(true)
  })
})

// ─── Storage failure handling ───────────────────────────────────────

describe('POST /api/events/[id]/artwork — provider/DB failure handling', () => {
  it('a Blob provider error is handled safely (502), event is not updated', async () => {
    queue([EVENT_NO_ARTWORK])
    putMock.mockRejectedValue(new Error('service unavailable'))
    const res = await artworkRoute.POST(uploadReq(new File([jpegBytes()], 'a.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    expect(res.status).toBe(502)
    // Only the ownership SELECT ran — no UPDATE was ever attempted.
    expect(sqlMock).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/service unavailable/)
  })
})

// ─── Replacement ────────────────────────────────────────────────────

describe('POST /api/events/[id]/artwork — replacement ordering and safety', () => {
  it('the new object is uploaded and the Event is updated to reference it BEFORE the old object is deleted', async () => {
    queue([EVENT_WITH_MANAGED_ARTWORK], [{ artwork_url: 'https://abc123.public.blob.vercel-storage.com/events/org-a/event-1/new-uuid.jpg' }])
    await artworkRoute.POST(uploadReq(new File([jpegBytes()], 'a.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(delMock).toHaveBeenCalledTimes(1)
    expect(delMock).toHaveBeenCalledWith(MANAGED_URL)
    // Global invocation order across all mocked calls this test made:
    // ownership SELECT (sql #1) < put < UPDATE (sql #2) < del.
    const sqlOrders = sqlMock.mock.invocationCallOrder
    expect(putMock.mock.invocationCallOrder[0]).toBeGreaterThan(sqlOrders[0])
    expect(sqlOrders[1]).toBeGreaterThan(putMock.mock.invocationCallOrder[0])
    expect(delMock.mock.invocationCallOrder[0]).toBeGreaterThan(sqlOrders[1])
  })

  it('if the Event update fails after a successful upload, the OLD artwork is never deleted (old artwork preserved)', async () => {
    queue([EVENT_WITH_MANAGED_ARTWORK]) // ownership SELECT only — the UPDATE below throws
    sqlMock.mockImplementationOnce(() => Promise.resolve([EVENT_WITH_MANAGED_ARTWORK]))
    sqlMock.mockImplementationOnce(() => Promise.reject(new Error('connection reset')))
    const res = await artworkRoute.POST(uploadReq(new File([jpegBytes()], 'a.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    expect(res.status).toBe(500)
    expect(delMock).not.toHaveBeenCalled() // old artwork must survive a failed replacement
  })

  it('a failed upload never reaches the point where the old artwork could be touched', async () => {
    queue([EVENT_WITH_MANAGED_ARTWORK])
    putMock.mockRejectedValue(new Error('upload failed'))
    await artworkRoute.POST(uploadReq(new File([jpegBytes()], 'a.jpg', { type: 'image/jpeg' })), EVENT_CTX)
    expect(delMock).not.toHaveBeenCalled()
  })
})

// ─── Removal ────────────────────────────────────────────────────────

describe('DELETE /api/events/[id]/artwork — removal behaviour', () => {
  it('a BrainBase-managed (Blob) artwork is both cleared from the Event and deleted from storage', async () => {
    queue([EVENT_WITH_MANAGED_ARTWORK], [])
    const res = await artworkRoute.DELETE(deleteReq(), EVENT_CTX)
    expect(res.status).toBe(200)
    expect(delMock).toHaveBeenCalledWith(MANAGED_URL)
    // artwork_url = NULL is a literal SQL keyword here, not an
    // interpolated parameter, so it appears in the call's template
    // strings (the query text), not among its interpolated args.
    const updateCall = sqlMock.mock.calls[1] as unknown as [TemplateStringsArray, ...unknown[]]
    expect(updateCall[0].join(' ')).toMatch(/artwork_url\s*=\s*NULL/i)
  })

  it('an external URL from the prior interim architecture is only cleared from the Event — never externally deleted', async () => {
    queue([EVENT_WITH_EXTERNAL_ARTWORK], [])
    const res = await artworkRoute.DELETE(deleteReq(), EVENT_CTX)
    expect(res.status).toBe(200)
    expect(delMock).not.toHaveBeenCalled()
    const updateCall = sqlMock.mock.calls[1] as unknown as [TemplateStringsArray, ...unknown[]]
    expect(updateCall[0].join(' ')).toMatch(/artwork_url\s*=\s*NULL/i)
  })

  it('a viewer cannot remove artwork -> 403, no clearing/deletion attempted', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await artworkRoute.DELETE(deleteReq(), EVENT_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
    expect(delMock).not.toHaveBeenCalled()
  })

  it('a cross-tenant removal is rejected -> 404, no clearing/deletion attempted', async () => {
    queue([]) // ownership SELECT scoped to the caller's own org finds nothing
    const res = await artworkRoute.DELETE(deleteReq(), EVENT_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(delMock).not.toHaveBeenCalled()
  })

  it('removing when there is no artwork is a harmless no-op, not an error', async () => {
    queue([EVENT_NO_ARTWORK])
    const res = await artworkRoute.DELETE(deleteReq(), EVENT_CTX)
    expect(res.status).toBe(200)
    expect(delMock).not.toHaveBeenCalled()
  })
})

// ─── Architecture containment ───────────────────────────────────────

const TOUCHED_FILES = [
  'lib/events/artworkConstants.ts',
  'lib/events/blobStorage.ts',
  'app/api/events/[id]/artwork/route.ts',
  'app/events/[id]/EventDetailClient.tsx',
]

describe('Event artwork upload — architecture containment', () => {
  for (const file of TOUCHED_FILES) {
    it(`${file} never writes to the local filesystem`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/fs\.writeFile|writeFile\(/)
      expect(code).not.toMatch(/from ['"]fs(\/promises)?['"]/)
    })

    it(`${file} never stores image bytes as base64`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/base64/i)
    })

    it(`${file} has no QR/check-in/payment/email/CRM/audit code`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/qrcode|checkin|check-in|barcode/i)
      expect(code).not.toMatch(/stripe|paypal|square|checkout\.session|payment_intent/i)
      expect(code).not.toMatch(/resend|sendEmail|nodemailer/i)
      expect(code).not.toMatch(/audit_logs|AuditLog/)
    })

    it(`${file} never hardcodes the ld-tennis slug or LD_TENNIS_ORG_ID`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/ld-tennis/)
      expect(code).not.toMatch(/LD_TENNIS_ORG_ID/)
    })
  }

  it('the upload route never trusts a client-supplied organisation id', () => {
    const code = stripComments(read('app/api/events/[id]/artwork/route.ts'))
    expect(code).not.toMatch(/body\.organisation_id/)
    expect(code).not.toMatch(/body\.organisationId/)
    expect(code).not.toMatch(/formData\.get\(['"]organisation/i)
  })

  it('the upload route calls authorizeEventsRequest before any handler logic', () => {
    const code = stripComments(read('app/api/events/[id]/artwork/route.ts'))
    expect(code).toMatch(/authorizeEventsRequest\('manager'\)/)
  })

  it('no Blob read-write token or storage credential is embedded in source (env-var reference only)', () => {
    for (const file of TOUCHED_FILES) {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/vercel_blob_rw_[A-Za-z0-9]/i)
    }
  })
})
