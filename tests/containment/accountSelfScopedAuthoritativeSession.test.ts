import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// SEC-1B3 — POST /api/account/avatar and GET/PUT /api/account/profile
// were gated on raw getSession(), a JWT-only claim never revalidated
// against the DB. Now gated on requireSession() (lib/org.ts), which
// re-reads the caller's current role/organisation/status from the
// database on every call.
//
// Mocking follows the established pattern in
// tests/containment/orgHomeOrganisationId.test.ts.

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
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const cookieStore = new Map<string, string>()
const cookieSetMock = vi.fn((name: string, value: string) => { cookieStore.set(name, value) })
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (...args: [string, string, unknown]) => cookieSetMock(args[0], args[1]),
  }),
}))

// SEC-1B3 predates the Blob migration; avatar storage is now
// @vercel/blob (see lib/account/avatarStorage.ts), not fs/promises.
const putMock = vi.fn<(...args: unknown[]) => Promise<{ url: string }>>()
const delMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => putMock(...args),
  del: (...args: unknown[]) => delMock(...args),
}))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const ACTIVE_USER_ROW = { id: 'user1', organisation_id: 'org-a', role: 'manager' }

const { POST: postAvatar } = await import('@/app/api/account/avatar/route')
const { GET: getProfile, PUT: putProfile } = await import('@/app/api/account/profile/route')

beforeEach(() => {
  getSessionMock.mockReset()
  // A full mockReset() (not just mockClear()) — one test below replaces
  // sqlMock's implementation entirely (to simulate a write failing
  // mid-sequence); restoring the default queue-based implementation
  // here, every time, keeps that test from leaking into any other.
  sqlMock.mockReset()
  sqlMock.mockImplementation(() => Promise.resolve(responseQueue[callCount++] ?? []))
  putMock.mockReset()
  delMock.mockReset()
  putMock.mockResolvedValue({ url: MANAGED_AVATAR_URL })
  delMock.mockResolvedValue(undefined)
  cookieSetMock.mockClear()
  cookieStore.clear()
  responseQueue = []
  callCount = 0
})

function avatarRequest(file: File | null): NextRequest {
  const fd = new FormData()
  if (file) fd.set('file', file)
  return asNextRequest(new Request('http://localhost/api/account/avatar', { method: 'POST', body: fd }))
}

// Real magic-byte-valid image buffers/Files — the route now sniffs
// actual bytes (lib/account/avatarStorage.ts's sniffAvatarMimeType), so
// a declared-type-only fake (e.g. 3 arbitrary bytes) is no longer
// sufficient to reach the upload path at all.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])
function pngFile(name = 'a.png') { return new File([PNG_BYTES], name, { type: 'image/png' }) }
function jpegFile(name = 'a.jpg') { return new File([JPEG_BYTES], name, { type: 'image/jpeg' }) }

const MANAGED_AVATAR_URL = 'https://abc123.public.blob.vercel-storage.com/users/user1/avatar/xyz.png'
const OLD_MANAGED_AVATAR_URL = 'https://abc123.public.blob.vercel-storage.com/users/user1/avatar/old.png'
const EXTERNAL_AVATAR_URL = 'https://example.com/someone-elses-avatar.png'

describe('POST /api/account/avatar — authorization', () => {
  it('rejects with 401 when there is no session, before touching Blob or the DB', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await postAvatar(avatarRequest(pngFile()))
    expect(res.status).toBe(401)
    expect(putMock).not.toHaveBeenCalled()
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been deactivated (status INACTIVE) since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await postAvatar(avatarRequest(pngFile()))
    expect(res.status).toBe(401)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been deleted since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'gone', organisationId: 'org-a', role: 'manager', name: 'Deleted User' })
    queue([])
    const res = await postAvatar(avatarRequest(pngFile()))
    expect(res.status).toBe(401)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Reassigned User' })
    queue([{ id: 'user1', organisation_id: 'org-b', role: 'manager' }])
    const res = await postAvatar(avatarRequest(pngFile()))
    expect(res.status).toBe(401)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('a currently-active DB-confirmed user succeeds, uploads to Blob under their own userId, and persists the URL', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    // requireSession lookup, SELECT current avatar_url (none), UPDATE
    queue([ACTIVE_USER_ROW], [{ avatar_url: null }], [])
    const res = await postAvatar(avatarRequest(pngFile()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.avatarUrl).toBe(MANAGED_AVATAR_URL)
    expect(putMock).toHaveBeenCalledTimes(1)
    const [pathname] = putMock.mock.calls[0] as [string]
    // Generated (UUID) filename under the AUTHENTICATED user's own path
    // — never the caller's original filename ("a.png").
    expect(pathname).toMatch(/^users\/user1\/avatar\/[0-9a-f-]+\.png$/)
    expect(delMock).not.toHaveBeenCalled() // nothing to clean up — no previous avatar
  })

  it('never accepts a declared MIME type that is not JPEG/PNG/WebP', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const svgFile = new File([new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')], 'a.svg', { type: 'image/svg+xml' })
    const res = await postAvatar(avatarRequest(svgFile))
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('rejects a declared GIF outright — dropped from the allow-list in this phase', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const gifFile = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], 'a.gif', { type: 'image/gif' })
    const res = await postAvatar(avatarRequest(gifFile))
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('rejects an oversize file before ever touching Blob', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const big = new Uint8Array(3 * 1024 * 1024 + 1)
    big.set(PNG_BYTES)
    const res = await postAvatar(avatarRequest(new File([big], 'big.png', { type: 'image/png' })))
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('rejects a declared-vs-sniffed MIME mismatch (real JPEG bytes wrapped in a .png-declared type)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const mismatched = new File([JPEG_BYTES], 'a.png', { type: 'image/png' })
    const res = await postAvatar(avatarRequest(mismatched))
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('rejects garbage bytes that match no allowed image type, even with a valid declared MIME', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const garbage = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'a.png', { type: 'image/png' })
    const res = await postAvatar(avatarRequest(garbage))
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('accepts a valid JPEG', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [{ avatar_url: null }], [])
    const res = await postAvatar(avatarRequest(jpegFile()))
    expect(res.status).toBe(200)
  })

  it('replacement: deletes the OLD managed avatar only after the new one is successfully linked in the DB', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [{ avatar_url: OLD_MANAGED_AVATAR_URL }], [])
    const res = await postAvatar(avatarRequest(pngFile()))
    expect(res.status).toBe(200)
    expect(delMock).toHaveBeenCalledTimes(1)
    expect(delMock).toHaveBeenCalledWith(OLD_MANAGED_AVATAR_URL)
  })

  it('replacement: never deletes an externally-hosted previous avatar URL this app never owned', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [{ avatar_url: EXTERNAL_AVATAR_URL }], [])
    const res = await postAvatar(avatarRequest(pngFile()))
    expect(res.status).toBe(200)
    expect(delMock).not.toHaveBeenCalled()
  })

  it('replacement: cleans up the newly-uploaded Blob and returns failure if the DB link write throws — old avatar left intact, never a false success', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    // requireSession lookup, SELECT current avatar_url succeeds, then the UPDATE throws.
    sqlMock.mockReset()
    let call = 0
    sqlMock.mockImplementation(() => {
      call += 1
      if (call === 1) return Promise.resolve([ACTIVE_USER_ROW])
      if (call === 2) return Promise.resolve([{ avatar_url: OLD_MANAGED_AVATAR_URL }])
      return Promise.reject(new Error('write failed'))
    })
    const res = await postAvatar(avatarRequest(pngFile()))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBeUndefined()
    // The orphaned NEW upload is cleaned up...
    expect(delMock).toHaveBeenCalledWith(MANAGED_AVATAR_URL)
    // ...but the OLD (still-current, since the DB write never committed) avatar is never touched.
    expect(delMock).not.toHaveBeenCalledWith(OLD_MANAGED_AVATAR_URL)
  })

  it('a failed Blob upload never reaches the DB write at all', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [{ avatar_url: null }])
    putMock.mockRejectedValueOnce(new Error('blob down'))
    const res = await postAvatar(avatarRequest(pngFile()))
    expect(res.status).toBe(502)
    // Only requireSession's lookup + the avatar_url read happened — no UPDATE call.
    expect(sqlMock).toHaveBeenCalledTimes(2)
  })
})

describe('lib/account/avatarStorage — isManagedAvatarUrl (pure)', () => {
  it('identifies a real Vercel Blob avatar URL as managed for the OWNING user, and any other URL as not', async () => {
    const { isManagedAvatarUrl } = await import('@/lib/account/avatarStorage')
    expect(isManagedAvatarUrl(MANAGED_AVATAR_URL, 'user1')).toBe(true)
    expect(isManagedAvatarUrl(EXTERNAL_AVATAR_URL, 'user1')).toBe(false)
  })

  it('a malformed URL is never treated as managed, for any userId', async () => {
    const { isManagedAvatarUrl } = await import('@/lib/account/avatarStorage')
    expect(isManagedAvatarUrl('not a url at all', 'user1')).toBe(false)
    expect(isManagedAvatarUrl('', 'user1')).toBe(false)
  })

  it("SECURITY: a real managed avatar URL belonging to a DIFFERENT user is never managed for this one", async () => {
    const { isManagedAvatarUrl } = await import('@/lib/account/avatarStorage')
    const otherUsersUrl = 'https://abc123.public.blob.vercel-storage.com/users/user2/avatar/genuine.png'
    expect(isManagedAvatarUrl(otherUsersUrl, 'user1')).toBe(false)
    expect(isManagedAvatarUrl(MANAGED_AVATAR_URL, 'user2')).toBe(false)
  })

  it('SECURITY: a same-prefix lookalike user id cannot bypass the namespace check (exact segment match, never startsWith)', async () => {
    const { isManagedAvatarUrl } = await import('@/lib/account/avatarStorage')
    // "user1" is a PREFIX of "user1x" — must not cross-match either direction.
    const lookalikeUrl = 'https://abc123.public.blob.vercel-storage.com/users/user1x/avatar/x.png'
    expect(isManagedAvatarUrl(lookalikeUrl, 'user1')).toBe(false)
    expect(isManagedAvatarUrl(MANAGED_AVATAR_URL, 'user1x')).toBe(false)
  })

  it('never treats an organisation logo Blob path as a managed avatar', async () => {
    const { isManagedAvatarUrl } = await import('@/lib/account/avatarStorage')
    const orgLogoUrl = 'https://abc123.public.blob.vercel-storage.com/organisations/org-a/logo/xyz.png'
    expect(isManagedAvatarUrl(orgLogoUrl, 'user1')).toBe(false)
  })
})

describe('lib/account/avatarStorage — sniffAvatarMimeType (pure)', () => {
  it('detects real PNG/JPEG magic bytes', async () => {
    const { sniffAvatarMimeType } = await import('@/lib/account/avatarStorage')
    expect(sniffAvatarMimeType(Buffer.from(PNG_BYTES))).toBe('image/png')
    expect(sniffAvatarMimeType(Buffer.from(JPEG_BYTES))).toBe('image/jpeg')
  })

  it('rejects garbage bytes (e.g. an SVG\'s actual textual content)', async () => {
    const { sniffAvatarMimeType } = await import('@/lib/account/avatarStorage')
    expect(sniffAvatarMimeType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull()
  })
})

describe('GET /api/account/profile — authorization', () => {
  it('rejects with 401 when there is no session, before any DB read', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await getProfile()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorised' })
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been deactivated (status INACTIVE) since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await getProfile()
    expect(res.status).toBe(401)
    expect(sqlMock).toHaveBeenCalledTimes(1) // only requireSession's own lookup
  })

  it('rejects with 401 when the user has been reassigned to a different organisation since the JWT was issued', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Reassigned User' })
    queue([{ id: 'user1', organisation_id: 'org-b', role: 'manager' }])
    const res = await getProfile()
    expect(res.status).toBe(401)
  })

  it('a currently-active DB-confirmed user succeeds, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [{ id: 'user1', username: 'u1', org_name: 'Org A' }], [])
    const res = await getProfile()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toMatchObject({ id: 'user1', username: 'u1' })
  })
})

describe('PUT /api/account/profile — authorization and containment', () => {
  function putRequest(body: unknown): NextRequest {
    return asNextRequest(new Request('http://localhost/api/account/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  it('rejects with 401 when there is no session, before any DB write', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await putProfile(putRequest({ bio: 'hacked' }))
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the user has been deactivated (status INACTIVE) since the JWT was issued, before any DB write', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'Deactivated User' })
    queue([{ id: 'user1', organisation_id: 'org-a', role: 'manager', status: 'INACTIVE' }])
    const res = await putProfile(putRequest({ bio: 'hacked' }))
    expect(res.status).toBe(401)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('a currently-active DB-confirmed user can update their own safe profile fields, unchanged existing behaviour', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const res = await putProfile(putRequest({ bio: 'Hello', role: 'super_admin', organisation_id: 'org-x' }))
    expect(res.status).toBe(200)
    // requireSession's own lookup, then exactly one UPDATE call.
    expect(sqlMock).toHaveBeenCalledTimes(2)
  })

  it('avatar_url is never written through this route, even if supplied — it is silently dropped, not an error', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const res = await putProfile(putRequest({ avatar_url: 'https://evil.example.com/not-an-image.html' }))
    // avatar_url alone is not in ALLOWED_FIELDS, so nothing to update.
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('No valid fields provided')
  })

  it('rejects an About me value over the server-enforced length limit, no DB write attempted', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const res = await putProfile(putRequest({ bio: 'x'.repeat(1001) }))
    expect(res.status).toBe(400)
    // requireSession's own lookup only — no UPDATE attempted.
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-string About me value', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW])
    const res = await putProfile(putRequest({ bio: 12345 }))
    expect(res.status).toBe(400)
  })

  it('trims About me and accepts exactly the maximum length', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [{ name: 'User One', first_name: null, last_name: null, display_name: null }])
    const res = await putProfile(putRequest({ bio: `  ${'x'.repeat(1000)}  ` }))
    expect(res.status).toBe(200)
  })

  it('reissues the session cookie (via createSession) when a name-affecting field changes, so TopNav/`/api/me` reflect it without requiring re-login', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [{ name: 'User One', first_name: null, last_name: null, display_name: 'Jamie' }])
    const res = await putProfile(putRequest({ display_name: 'Jamie' }))
    expect(res.status).toBe(200)
    expect(cookieSetMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT reissue the session cookie when only a non-name-affecting field changes', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue([ACTIVE_USER_ROW], [{ name: 'User One', first_name: null, last_name: null, display_name: null }])
    const res = await putProfile(putRequest({ phone: '0400 000 000' }))
    expect(res.status).toBe(200)
    expect(cookieSetMock).not.toHaveBeenCalled()
  })
})
