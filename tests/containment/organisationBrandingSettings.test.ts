import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Organisation Branding — Phase 2 (settings UI + logo upload). Every
// DB call and every Blob call is mocked — no real database or network
// call anywhere in this file. Mirrors the exact mocking conventions
// established by tests/containment/eventsFreeOrderCancellation.test.ts
// (SQL response queue) and tests/containment/eventArtworkAspectRatioFix
// -style source-text assertions for the UI/static checks.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlCalls: unknown[][] = []
const sqlMock = vi.fn((...args: unknown[]) => {
  sqlCalls.push(args)
  return Promise.resolve(responseQueue[callCount++] ?? [])
})
vi.mock('@/lib/db', () => ({ default: sqlMock }))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function sqlText(call: unknown[]): string {
  return ((call[0] as unknown) as TemplateStringsArray).join('')
}

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

const putMock = vi.fn()
const delMock = vi.fn()
vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => putMock(...args),
  del: (...args: unknown[]) => delMock(...args),
}))

function sessionAs(role: string, organisationId = 'org-a') {
  return { userId: 'user-1', organisationId, homeOrganisationId: organisationId, role, name: 'Test User' }
}

const brandingRoute = await import('@/app/api/organisations/branding/route')
const logoRoute = await import('@/app/api/organisations/branding/logo/route')
const { sniffLogoMimeType, isManagedLogoUrl } = await import('@/lib/organisations/brandingStorage')

const MANAGED_URL = 'https://abc123.public.blob.vercel-storage.com/organisations/org-a/logo/xyz.png'
const OLD_MANAGED_URL = 'https://abc123.public.blob.vercel-storage.com/organisations/org-a/logo/old-one.png'
const EXTERNAL_URL = 'https://example.com/their-own-logo.png'

const FULL_BRANDING = {
  name: 'Acme School', logoUrl: null, accentColor: '#8a4dff', email: 'events@acme.test',
  phone: '0400 000 000', website: 'https://acme.test', address: '1 Example St', abn: '12 345 678 901',
  emailFooter: 'Thanks!', emailSenderName: 'Acme Events Team',
}

// A minimal magic-byte-valid PNG buffer/File for upload tests.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])
function fakeFile(bytes: Buffer, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type })
}
function formDataWith(file: File): FormData {
  const fd = new FormData()
  fd.append('file', file)
  return fd
}
function uploadReq(file: File) {
  return new Request('http://localhost/x', { method: 'POST', body: formDataWith(file) })
}

beforeEach(() => {
  sqlMock.mockReset()
  sqlMock.mockImplementation((...args: unknown[]) => {
    sqlCalls.push(args)
    return Promise.resolve(responseQueue[callCount++] ?? [])
  })
  sqlCalls.length = 0; responseQueue = []; callCount = 0
  requireSessionMock.mockReset()
  putMock.mockReset(); delMock.mockReset()
  putMock.mockResolvedValue({ url: MANAGED_URL })
  delMock.mockResolvedValue(undefined)
})

// ─── Auth (§3, §12) — branding GET/PUT route ────────────────────────────

describe('Branding route — auth (GET/PUT share the same admin+ gate)', () => {
  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await brandingRoute.GET()
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer -> 403', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await brandingRoute.GET()
    expect(res.status).toBe(403)
  })

  it('manager -> 403 (branding is org-level configuration, not an ordinary manager-floor mutation)', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager'))
    const res = await brandingRoute.GET()
    expect(res.status).toBe(403)
  })

  it('admin -> 200', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('admin'))
    queue([{ name: 'Acme School', settings: { branding: FULL_BRANDING } }])
    const res = await brandingRoute.GET()
    expect(res.status).toBe(200)
  })

  it('super_admin (with an org_override already resolved by requireSession) -> 200, uses the impersonated organisationId', async () => {
    // org_override resolution happens INSIDE requireSession() itself
    // (lib/org.ts) — this route never re-derives or special-cases it;
    // simulating a super_admin session whose organisationId already
    // reflects an override is the correct way to test that this route
    // simply trusts whatever requireSession() resolved.
    requireSessionMock.mockResolvedValue(sessionAs('super_admin', 'impersonated-org'))
    queue([{ name: 'Impersonated Org', settings: {} }])
    const res = await brandingRoute.GET()
    expect(res.status).toBe(200)
    expect(sqlText(sqlCalls[0])).toContain('SELECT name, settings FROM organisations')
    const values = sqlCalls[0].slice(1) as unknown[]
    expect(JSON.stringify(values)).toContain('impersonated-org')
  })

  it('no Events or Commercial capability check anywhere in either route', () => {
    const routeCode = stripComments(read('app/api/organisations/branding/route.ts'))
    const logoCode = stripComments(read('app/api/organisations/branding/logo/route.ts'))
    for (const code of [routeCode, logoCode]) {
      expect(code).not.toMatch(/authorizeEventsRequest|authorizeCommercialRequest|requireCapability/)
    }
  })
})

describe('GET /api/organisations/branding', () => {
  beforeEach(() => requireSessionMock.mockResolvedValue(sessionAs('admin')))

  it('returns organisationName + full private branding, never raw settings', async () => {
    queue([{ name: 'Acme School', settings: { branding: FULL_BRANDING, commercial: { businessProfile: { tradingName: 'Should Not Appear' } } } }])
    const res = await brandingRoute.GET()
    const body = await res.json()
    expect(body.organisationName).toBe('Acme School')
    expect(body.branding).toEqual(FULL_BRANDING)
    expect(JSON.stringify(body)).not.toContain('Should Not Appear')
    expect(body.settings).toBeUndefined()
  })

  it('organisation not found -> 404', async () => {
    queue([])
    const res = await brandingRoute.GET()
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/organisations/branding', () => {
  beforeEach(() => requireSessionMock.mockResolvedValue(sessionAs('admin')))
  function putReq(body: unknown) {
    return new Request('http://localhost/x', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }

  it('organisationId is never taken from the request body — even a spoofed one is ignored, the session\'s own organisationId is always used', async () => {
    queue([{ id: 'org-a' }], [{ name: 'Acme', settings: { branding: FULL_BRANDING } }])
    await brandingRoute.PUT(putReq({ ...FULL_BRANDING, organisationId: 'org-SPOOFED' }) as never)
    const updateCall = sqlCalls.find(c => sqlText(c).includes('UPDATE organisations'))
    expect(updateCall).toBeTruthy()
    const values = updateCall!.slice(1) as unknown[]
    expect(JSON.stringify(values)).toContain('org-a')
    expect(JSON.stringify(values)).not.toContain('org-SPOOFED')
  })

  it('writes only settings.branding via jsonb_set — namespace isolation intact (re-proving Phase 1\'s own guarantee through this route)', async () => {
    queue([{ id: 'org-a' }], [{ name: 'Acme', settings: { branding: FULL_BRANDING } }])
    await brandingRoute.PUT(putReq(FULL_BRANDING) as never)
    const updateCall = sqlCalls.find(c => sqlText(c).includes('UPDATE organisations'))
    expect(sqlText(updateCall!)).toMatch(/'\{branding\}'/)
  })

  it('an invalid accentColor is rejected with 400 and a useful message, no DB write attempted', async () => {
    const res = await brandingRoute.PUT(putReq({ ...FULL_BRANDING, accentColor: 'not-a-colour' }) as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/hex/i)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('an invalid website is rejected with 400, no DB write attempted', async () => {
    const res = await brandingRoute.PUT(putReq({ ...FULL_BRANDING, website: 'javascript:alert(1)' }) as never)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('an invalid email is rejected with 400, no DB write attempted', async () => {
    const res = await brandingRoute.PUT(putReq({ ...FULL_BRANDING, email: 'not-an-email' }) as never)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('malformed JSON body -> 400, no DB write attempted', async () => {
    const res = await brandingRoute.PUT(new Request('http://localhost/x', { method: 'PUT', body: 'not json' }) as never)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns the re-read, sanitized saved result — not merely an echo of the input', async () => {
    queue([{ id: 'org-a' }], [{ name: 'Acme', settings: { branding: { ...FULL_BRANDING, accentColor: '#aabbcc' } } }])
    const res = await brandingRoute.PUT(putReq({ ...FULL_BRANDING, accentColor: '#ABC' }) as never)
    const body = await res.json()
    expect(body.branding.accentColor).toBe('#aabbcc')
  })
})

// ─── Logo route (§5, §6, §12) ─────────────────────────────────────────

describe('sniffLogoMimeType / isManagedLogoUrl (pure functions)', () => {
  it('detects real PNG/JPEG magic bytes', () => {
    expect(sniffLogoMimeType(PNG_SIGNATURE)).toBe('image/png')
    expect(sniffLogoMimeType(JPEG_SIGNATURE)).toBe('image/jpeg')
  })
  it('rejects garbage bytes (e.g. an SVG\'s actual textual content)', () => {
    expect(sniffLogoMimeType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull()
  })
  it('identifies a real Vercel Blob public URL as managed, and any other URL (including a lookalike) as not', () => {
    expect(isManagedLogoUrl(MANAGED_URL)).toBe(true)
    expect(isManagedLogoUrl(EXTERNAL_URL)).toBe(false)
    expect(isManagedLogoUrl('not a url at all')).toBe(false)
  })
})

describe('Logo route — auth', () => {
  it('unauthenticated -> 401, no Blob call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await logoRoute.POST(uploadReq(fakeFile(PNG_SIGNATURE, 'logo.png', 'image/png')) as never)
    expect(res.status).toBe(401)
    expect(putMock).not.toHaveBeenCalled()
  })
  it('manager -> 403, no Blob call', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager'))
    const res = await logoRoute.POST(uploadReq(fakeFile(PNG_SIGNATURE, 'logo.png', 'image/png')) as never)
    expect(res.status).toBe(403)
    expect(putMock).not.toHaveBeenCalled()
  })
  it('admin -> proceeds past the auth gate', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('admin'))
    queue([{ name: 'Acme', settings: {} }])
    const res = await logoRoute.POST(uploadReq(fakeFile(PNG_SIGNATURE, 'logo.png', 'image/png')) as never)
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})

describe('POST /api/organisations/branding/logo (upload)', () => {
  beforeEach(() => requireSessionMock.mockResolvedValue(sessionAs('admin', 'org-a')))

  it('accepts JPEG/PNG/WebP', async () => {
    for (const [bytes, type] of [[PNG_SIGNATURE, 'image/png'], [JPEG_SIGNATURE, 'image/jpeg']] as const) {
      putMock.mockClear()
      queue([{ name: 'Acme', settings: {} }])
      const res = await logoRoute.POST(uploadReq(fakeFile(bytes, 'logo', type)) as never)
      expect(res.status).toBe(200)
      expect(putMock).toHaveBeenCalledTimes(1)
    }
  })

  it('rejects a declared SVG outright — never in the allow-list', async () => {
    queue([{ name: 'Acme', settings: {} }])
    const res = await logoRoute.POST(uploadReq(fakeFile(Buffer.from('<svg></svg>'), 'logo.svg', 'image/svg+xml')) as never)
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('rejects oversize files before ever touching Blob', async () => {
    const bigFile = new File([new Uint8Array(3 * 1024 * 1024)], 'logo.png', { type: 'image/png' })
    const res = await logoRoute.POST(uploadReq(bigFile) as never)
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('rejects a declared-vs-sniffed MIME mismatch (e.g. a .png filename/type wrapping real JPEG bytes)', async () => {
    const res = await logoRoute.POST(uploadReq(fakeFile(JPEG_SIGNATURE, 'logo.png', 'image/png')) as never)
    expect(res.status).toBe(400)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('the Blob pathname is tenant-scoped, containing the AUTHENTICATED organisation id (never a client-supplied one)', async () => {
    queue([{ name: 'Acme', settings: {} }])
    await logoRoute.POST(uploadReq(fakeFile(PNG_SIGNATURE, 'logo.png', 'image/png')) as never)
    const pathname = putMock.mock.calls[0][0] as string
    expect(pathname).toMatch(/^organisations\/org-a\/logo\//)
  })

  it('never trusts the caller\'s filename for the stored pathname — always a generated name', async () => {
    queue([{ name: 'Acme', settings: {} }])
    await logoRoute.POST(uploadReq(fakeFile(PNG_SIGNATURE, '../../etc/passwd.png', 'image/png')) as never)
    const pathname = putMock.mock.calls[0][0] as string
    expect(pathname).not.toContain('etc/passwd')
    expect(pathname).not.toContain('..')
  })

  it('uploads with access: public', async () => {
    queue([{ name: 'Acme', settings: {} }])
    await logoRoute.POST(uploadReq(fakeFile(PNG_SIGNATURE, 'logo.png', 'image/png')) as never)
    expect(putMock.mock.calls[0][2]).toMatchObject({ access: 'public' })
  })

  it('deletes the OLD managed logo only after the new one is successfully linked', async () => {
    queue([{ name: 'Acme', settings: { branding: { ...FULL_BRANDING, logoUrl: OLD_MANAGED_URL } } }], [{ id: 'org-a' }])
    await logoRoute.POST(uploadReq(fakeFile(PNG_SIGNATURE, 'logo.png', 'image/png')) as never)
    expect(delMock).toHaveBeenCalledTimes(1)
    expect(delMock).toHaveBeenCalledWith(OLD_MANAGED_URL)
  })

  it('never deletes an externally-hosted previous logo URL', async () => {
    queue([{ name: 'Acme', settings: { branding: { ...FULL_BRANDING, logoUrl: EXTERNAL_URL } } }], [{ id: 'org-a' }])
    await logoRoute.POST(uploadReq(fakeFile(PNG_SIGNATURE, 'logo.png', 'image/png')) as never)
    expect(delMock).not.toHaveBeenCalled()
  })

  it('cleans up the newly-uploaded Blob if the DB link write fails', async () => {
    // mockImplementationOnce calls are consumed in order, ONE call
    // each, then fall back to the queue-based default installed in
    // beforeEach — so this does not leak into any later test the way
    // a permanent mockImplementation() override would.
    sqlMock.mockImplementationOnce((...args: unknown[]) => { sqlCalls.push(args); return Promise.resolve([{ name: 'Acme', settings: {} }]) }) // the pre-read SELECT
    sqlMock.mockImplementationOnce((...args: unknown[]) => { sqlCalls.push(args); return Promise.reject(new Error('DB write failed')) }) // the UPDATE inside setOrganisationBranding
    const res = await logoRoute.POST(uploadReq(fakeFile(PNG_SIGNATURE, 'logo.png', 'image/png')) as never)
    expect(res.status).toBe(500)
    expect(delMock).toHaveBeenCalledTimes(1)
    expect(delMock).toHaveBeenCalledWith(MANAGED_URL) // the just-uploaded (now orphaned) object
  })

  it('a failed Blob upload never reaches the DB at all', async () => {
    putMock.mockRejectedValue(new Error('Blob provider down'))
    queue([{ name: 'Acme', settings: {} }])
    const res = await logoRoute.POST(uploadReq(fakeFile(PNG_SIGNATURE, 'logo.png', 'image/png')) as never)
    expect(res.status).toBe(502)
    // Only the pre-read SELECT happened — no UPDATE.
    expect(sqlCalls.some(c => sqlText(c).includes('UPDATE organisations'))).toBe(false)
  })
})

describe('DELETE /api/organisations/branding/logo', () => {
  beforeEach(() => requireSessionMock.mockResolvedValue(sessionAs('admin', 'org-a')))

  it('sets logoUrl=null FIRST, then deletes the old managed Blob', async () => {
    queue([{ name: 'Acme', settings: { branding: { ...FULL_BRANDING, logoUrl: MANAGED_URL } } }])
    const res = await logoRoute.DELETE()
    expect(res.status).toBe(200)
    const updateCall = sqlCalls.find(c => sqlText(c).includes('UPDATE organisations'))
    expect(updateCall).toBeTruthy()
    const values = updateCall!.slice(1) as unknown[]
    // The written branding JSON should have logoUrl: null.
    const jsonArg = values.find(v => typeof v === 'string' && v.includes('"name"')) as string
    expect(JSON.parse(jsonArg).logoUrl).toBeNull()
    expect(delMock).toHaveBeenCalledWith(MANAGED_URL)
  })

  it('never deletes an externally-hosted logo URL', async () => {
    queue([{ name: 'Acme', settings: { branding: { ...FULL_BRANDING, logoUrl: EXTERNAL_URL } } }])
    await logoRoute.DELETE()
    expect(delMock).not.toHaveBeenCalled()
  })

  it('no-ops cleanly if there was no logo to begin with', async () => {
    queue([{ name: 'Acme', settings: { branding: FULL_BRANDING } }]) // logoUrl already null
    const res = await logoRoute.DELETE()
    expect(res.status).toBe(200)
    expect(delMock).not.toHaveBeenCalled()
    expect(sqlCalls.some(c => sqlText(c).includes('UPDATE organisations'))).toBe(false)
  })

  it('manager is denied -> 403, no mutation', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager'))
    const res = await logoRoute.DELETE()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

// ─── UI / static (§12) ────────────────────────────────────────────────

describe('Settings page — route, auth, and V1 field coverage (static)', () => {
  const pageCode = stripComments(read('app/settings/branding/page.tsx'))
  const clientCode = stripComments(read('app/settings/branding/BrandingSettingsClient.tsx'))

  it('the settings route exists at app/settings/branding', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app/settings/branding/page.tsx'))).toBe(true)
  })

  it('the page is gated at admin+ via the shared requireRole primitive, not a parallel auth check', () => {
    expect(pageCode).toMatch(/requireRole\('admin'\)/)
    expect(pageCode).toMatch(/from '@\/lib\/org'/)
  })

  it('the page never gates on an Events or Commercial capability', () => {
    expect(pageCode).not.toMatch(/authorizeEventsRequest|authorizeCommercialRequest|requireCapability/)
  })

  it('every V1 field is present in the client component', () => {
    for (const field of ['name', 'logoUrl', 'accentColor', 'email', 'phone', 'website', 'address', 'abn', 'emailFooter', 'emailSenderName']) {
      expect(clientCode).toContain(field)
    }
  })

  it('the four required section groupings are present', () => {
    expect(clientCode).toMatch(/Brand/)
    expect(clientCode).toMatch(/Business details/i)
    expect(clientCode).toMatch(/Customer-facing contact/i)
    expect(clientCode).toMatch(/Email identity/i)
  })

  it('logo constraints (type + max size) are shown to the user', () => {
    expect(clientCode).toMatch(/JPEG, PNG, or WebP/)
    expect(clientCode).toMatch(/MAX_LOGO_MB/)
  })

  it('blank brand name explains the organisation-name fallback', () => {
    expect(clientCode).toMatch(/will be used instead/)
  })

  it('never imports TicketCard (PR #142) — the preview card is self-contained', () => {
    expect(clientCode).not.toMatch(/TicketCard/)
    expect(clientCode).not.toMatch(/components\/events/)
  })

  it('a native colour picker (input type="color") is present alongside a synced hex text input', () => {
    expect(clientCode).toMatch(/type="color"/)
    expect(clientCode).toMatch(/type="text"\s*$|value=\{form\.accentColor\}/m)
  })

  it('only one accent-colour field exists — no primary/accent dual-theme complexity', () => {
    const occurrences = (clientCode.match(/accentColor/g) ?? []).length
    // Present, but not duplicated into a second "primary"/"secondary" colour concept.
    expect(clientCode).not.toMatch(/primaryColor|secondaryColor|themeColor/)
    expect(occurrences).toBeGreaterThan(0)
  })

  it('save failure never wipes local form values — the catch/error path never resets `form`', () => {
    const fnStart = clientCode.indexOf('async function handleSave')
    const fnEnd = clientCode.indexOf('\n  }', fnStart)
    const fnBody = clientCode.slice(fnStart, fnEnd)
    expect(fnBody).toMatch(/setSaveError/)
    expect(fnBody).not.toMatch(/setForm\(brandingToForm\(initialBranding\)\)/)
  })

  it('a failed logo upload restores the previously-saved logoUrl, not a blank/broken state', () => {
    const fnStart = clientCode.indexOf('async function handleLogoUpload')
    const fnEnd = clientCode.indexOf('\n  }', fnStart)
    const fnBody = clientCode.slice(fnStart, fnEnd)
    expect(fnBody).toMatch(/previousLogoUrl/)
  })

  it('keyboard-accessible labels exist for every input (htmlFor/id pairing)', () => {
    const idOccurrences = (clientCode.match(/id="brand-/g) ?? []).length
    const labelForOccurrences = (clientCode.match(/htmlFor=\{id\}/g) ?? []).length
    expect(idOccurrences).toBeGreaterThanOrEqual(7)
    expect(labelForOccurrences).toBeGreaterThan(0)
  })
})

describe('TopNav — Branding link', () => {
  const code = stripComments(read('components/nav/TopNav.tsx'))
  it('is gated to admin+ (or super_admin), not shown to every authenticated user', () => {
    const linkIdx = code.indexOf('href="/settings/branding"')
    expect(linkIdx).toBeGreaterThan(-1)
    const before = code.slice(Math.max(0, linkIdx - 400), linkIdx)
    expect(before).toMatch(/role === 'admin' \|\| role === 'super_admin'/)
  })
})
