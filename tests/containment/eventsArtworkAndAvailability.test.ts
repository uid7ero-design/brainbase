import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import { validateEventInput, validateArtworkUrl } from '@/lib/events/validation'

// Events & Ticketing — artwork/poster support + the malformed
// availability-badge fix. Static source-text checks stand in for
// behavioral component rendering (this repo has no jsdom/React Testing
// Library harness — same rationale as the block-scoped checks in
// tests/containment/eventsArchitectureContainment.test.ts); route-level
// artwork mutation/read behavior is proven through the real route
// modules with mocked sql/session, matching every other Events
// containment test's established pattern.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ─── Availability display fix ─────────────────────────────────────────

describe('Public event page — malformed aggregate remaining badge is gone', () => {
  const clientSrc = stripComments(read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx'))

  it('no function reduces/sums .remaining across multiple ticket types (or types+sessions) into one combined figure', () => {
    // The exact defect: `.reduce((sum, t) => sum + t.remaining, 0)` —
    // must never reappear, on ticket types or on any cross-entity total.
    expect(clientSrc).not.toMatch(/reduce\(\(sum,\s*t\)\s*=>\s*sum\s*\+\s*t\.remaining/)
    expect(clientSrc).not.toMatch(/totalRemaining/)
    expect(clientSrc).not.toMatch(/totalCapacity/)
  })

  it('the hero availability state never renders a bare summed/concatenated number — only a calm state label', () => {
    const fn = clientSrc.slice(clientSrc.indexOf('function availabilityState'), clientSrc.indexOf('function EventHeader'))
    expect(fn).toMatch(/Tickets available/)
    expect(fn).toMatch(/Sold out/)
    // No arithmetic addition of remaining values anywhere in this function.
    expect(fn).not.toMatch(/\+\s*t\.remaining/)
  })

  it('ticket type remaining is still displayed independently, on its own choice card', () => {
    const fn = clientSrc.slice(clientSrc.indexOf('function TicketOption'), clientSrc.indexOf('function SessionOption'))
    expect(fn).toMatch(/ticket\.remaining/)
    expect(fn).toMatch(/formatPlacesRemaining/)
  })

  it('session remaining is still displayed independently, on its own choice card', () => {
    const fn = clientSrc.slice(clientSrc.indexOf('function SessionOption'))
    expect(fn).toMatch(/session\.remaining/)
    expect(fn).toMatch(/formatPlacesRemaining/)
  })

  it('ticket type and session remaining are never combined in the same expression', () => {
    expect(clientSrc).not.toMatch(/ticket\.remaining\s*\+\s*session/)
    expect(clientSrc).not.toMatch(/session\.remaining\s*\+\s*ticket/)
  })

  it('copy is sentence case ("N places remaining"), not the all-caps "N REMAINING" the old uppercase-transform styling forced', () => {
    expect(clientSrc).toMatch(/place\$\{remaining === 1 \? '' : 's'\} remaining/)
    // The old per-row labels used textTransform: 'uppercase' specifically
    // on the remaining/sold-out line — that styling must be gone from
    // both option components (letterSpacing-only styling elsewhere in
    // the file, e.g. the "EVENT" eyebrow label, is unrelated and fine).
    const ticketFn = clientSrc.slice(clientSrc.indexOf('function TicketOption'), clientSrc.indexOf('function SessionOption'))
    const sessionFn = clientSrc.slice(clientSrc.indexOf('function SessionOption'))
    expect(ticketFn).not.toMatch(/textTransform: 'uppercase'/)
    expect(sessionFn).not.toMatch(/textTransform: 'uppercase'/)
  })
})

describe('lib/events/publicEventDetail.ts — bigint/string root cause is fixed at the source', () => {
  const src = stripComments(read('lib/events/publicEventDetail.ts'))

  it('both remaining computations (session and ticket type) are cast to ::int, not left as bigint', () => {
    const castCount = (src.match(/\)::int AS remaining/g) ?? []).length
    expect(castCount).toBe(2)
  })
})

// ─── Artwork feature — validation ────────────────────────────────────

describe('validateArtworkUrl — pure unit rules', () => {
  it('accepts undefined/null (no artwork, or field omitted from a PATCH)', () => {
    expect(validateArtworkUrl(undefined)).toBeNull()
    expect(validateArtworkUrl(null)).toBeNull()
  })

  it('accepts an empty string (treated as "no artwork" by callers)', () => {
    expect(validateArtworkUrl('')).toBeNull()
  })

  it('accepts a well-formed https URL', () => {
    expect(validateArtworkUrl('https://images.example.com/poster.jpg')).toBeNull()
  })

  it('rejects a non-string value', () => {
    expect(validateArtworkUrl(12345)).toBeTruthy()
  })

  it('rejects a value that is not an http(s) URL', () => {
    expect(validateArtworkUrl('javascript:alert(1)')).toBeTruthy()
    expect(validateArtworkUrl('/local/path.jpg')).toBeTruthy()
    expect(validateArtworkUrl('ftp://example.com/x.jpg')).toBeTruthy()
  })

  it('rejects an excessively long value', () => {
    expect(validateArtworkUrl(`https://example.com/${'a'.repeat(3000)}`)).toBeTruthy()
  })
})

describe('validateEventInput — wires artwork_url validation in', () => {
  const base = {
    name: 'Formal', slug: 'formal', timezone: 'Australia/Adelaide',
    starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z',
  }
  it('a valid event with no artwork_url still passes', () => {
    expect(validateEventInput(base)).toBeNull()
  })
  it('a valid event with a well-formed artwork_url passes', () => {
    expect(validateEventInput({ ...base, artwork_url: 'https://example.com/poster.jpg' })).toBeNull()
  })
  it('an invalid artwork_url fails the whole event validation', () => {
    expect(validateEventInput({ ...base, artwork_url: 'not-a-url' })).toBeTruthy()
  })
})

// ─── Artwork feature — route behaviour (mocked sql/session) ───────────

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

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
  return {
    ...actual,
    requireCapability: vi.fn().mockResolvedValue({ key: 'events', config: {} }),
    checkCapability: vi.fn().mockResolvedValue({ allowed: true, entitlement: { key: 'events', config: {} } }),
  }
})

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}
function sessionAs(role: string) {
  return { userId: 'u1', organisationId: 'org-a', role }
}
function jsonReq(url: string, method: string, body?: unknown) {
  return asNextRequest(new Request(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

const eventsRoute = await import('@/app/api/events/route')
const eventIdRoute = await import('@/app/api/events/[id]/route')
const publicGetRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/route')

const EVENT_CTX = { params: Promise.resolve({ id: 'event-1' }) }

const EXISTING_EVENT_NO_ARTWORK = {
  id: 'event-1', organisation_id: 'org-a', name: 'Formal', slug: 'formal',
  description: 'Desc', venue: 'Venue', artwork_url: null, status: 'DRAFT',
  starts_at: new Date('2026-12-01T10:00:00Z'), ends_at: new Date('2026-12-01T12:00:00Z'),
  timezone: 'Australia/Adelaide',
}

beforeEach(() => {
  requireSessionMock.mockReset()
  sqlMock.mockReset()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
})

describe('POST /api/events — optional artwork_url', () => {
  const validBody = {
    name: 'Formal', slug: 'formal', timezone: 'Australia/Adelaide',
    starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z',
  }

  it('creating an event with no artwork_url still succeeds (optional field absent)', async () => {
    queue([{ id: 'event-1', ...validBody, artwork_url: null }])
    const res = await eventsRoute.POST(jsonReq('http://localhost/api/events', 'POST', validBody))
    expect(res.status).toBe(201)
  })

  it('creating an event with a valid artwork_url persists it in the INSERT call', async () => {
    queue([{ id: 'event-1', ...validBody, artwork_url: 'https://example.com/poster.jpg' }])
    await eventsRoute.POST(jsonReq('http://localhost/api/events', 'POST', { ...validBody, artwork_url: 'https://example.com/poster.jpg' }))
    const insertCall = sqlMock.mock.calls[0] as unknown as unknown[]
    expect(insertCall).toContain('https://example.com/poster.jpg')
  })

  it('an invalid artwork_url is rejected with 400, no INSERT ever issued', async () => {
    const res = await eventsRoute.POST(jsonReq('http://localhost/api/events', 'POST', { ...validBody, artwork_url: 'not-a-url' }))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/events/[id] — artwork_url mutation', () => {
  it('a viewer cannot replace artwork — 403, no UPDATE issued', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await eventIdRoute.PATCH(
      jsonReq('http://localhost/x', 'PATCH', { artwork_url: 'https://example.com/poster.jpg' }), EVENT_CTX,
    )
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('a manager can set artwork_url — the UPDATE call carries the new URL and the caller\'s own organisationId', async () => {
    queue([EXISTING_EVENT_NO_ARTWORK], [{ ...EXISTING_EVENT_NO_ARTWORK, artwork_url: 'https://example.com/poster.jpg' }])
    const res = await eventIdRoute.PATCH(
      jsonReq('http://localhost/x', 'PATCH', { artwork_url: 'https://example.com/poster.jpg' }), EVENT_CTX,
    )
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[1] as unknown as unknown[]
    expect(updateCall).toContain('https://example.com/poster.jpg')
    expect(updateCall).toContain('org-a') // never trusts a client-supplied organisation id — always the session's own
  })

  it('sending artwork_url: null explicitly clears it (same mergeField contract as description/venue)', async () => {
    const withArtwork = { ...EXISTING_EVENT_NO_ARTWORK, artwork_url: 'https://example.com/old.jpg' }
    queue([withArtwork], [{ ...withArtwork, artwork_url: null }])
    const res = await eventIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { artwork_url: null }), EVENT_CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[1] as unknown as unknown[]
    expect(updateCall).not.toContain('https://example.com/old.jpg')
  })

  it('omitting artwork_url from the PATCH body leaves the existing value unchanged', async () => {
    const withArtwork = { ...EXISTING_EVENT_NO_ARTWORK, artwork_url: 'https://example.com/keep.jpg' }
    queue([withArtwork], [withArtwork])
    const res = await eventIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { name: 'Formal' }), EVENT_CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[1] as unknown as unknown[]
    expect(updateCall).toContain('https://example.com/keep.jpg')
  })

  it('an invalid artwork_url on PATCH is rejected with 400 before any UPDATE', async () => {
    queue([EXISTING_EVENT_NO_ARTWORK])
    const res = await eventIdRoute.PATCH(jsonReq('http://localhost/x', 'PATCH', { artwork_url: 'not-a-url' }), EVENT_CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(1) // only the ownership SELECT
  })
})

describe('Public event detail — artwork_url is an approved public-safe field, nothing else new is exposed', () => {
  const ORG_ROW = [{ id: 'org-a' }]
  function publishedEventRow(artworkUrl: string | null) {
    return [{
      id: 'event-1', organisation_id: 'org-a', name: 'Formal', slug: 'formal',
      description: 'Desc', venue: 'Venue', artwork_url: artworkUrl,
      starts_at: new Date('2026-12-01T10:00:00Z'), ends_at: new Date('2026-12-01T12:00:00Z'),
      timezone: 'Australia/Adelaide',
    }]
  }
  const CTX = { params: Promise.resolve({ organisationSlug: 'ld-tennis', eventSlug: 'formal' }) }

  it('a populated artwork_url is returned to an anonymous caller', async () => {
    queue(ORG_ROW, publishedEventRow('https://example.com/poster.jpg'), [], [])
    const res = await publicGetRoute.GET(asNextRequest(new Request('http://localhost/x')), CTX)
    const body = await res.json()
    expect(body.event.artwork_url).toBe('https://example.com/poster.jpg')
  })

  it('an absent artwork (null) is returned as null, not an error or a missing key', async () => {
    queue(ORG_ROW, publishedEventRow(null), [], [])
    const res = await publicGetRoute.GET(asNextRequest(new Request('http://localhost/x')), CTX)
    const body = await res.json()
    expect(body.event).toHaveProperty('artwork_url', null)
  })

  it('adding artwork_url did not expand the public allow-list beyond it — still no organisation id/created_by/internal status leak', async () => {
    queue(ORG_ROW, publishedEventRow('https://example.com/poster.jpg'), [], [])
    const res = await publicGetRoute.GET(asNextRequest(new Request('http://localhost/x')), CTX)
    const body = await res.json()
    const serialised = JSON.stringify(body)
    expect(serialised).not.toMatch(/organisation_id|created_by|"status"/i)
    expect(body.event).not.toHaveProperty('id')
    expect(body.event).not.toHaveProperty('organisation_id')
  })
})

// ─── Architecture containment for every file this pass touched ────────

const TOUCHED_FILES = [
  'lib/events/validation.ts',
  'lib/events/publicResolve.ts',
  'lib/events/publicEventDetail.ts',
  'app/api/events/route.ts',
  'app/api/events/[id]/route.ts',
  'app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx',
  'app/events/[id]/EventDetailClient.tsx',
]

function stripSqlLineComments(sql: string): string {
  return sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n')
}

describe('Events artwork/availability pass — no LD Tennis coupling in reusable code', () => {
  for (const file of TOUCHED_FILES) {
    it(`${file} never hardcodes the ld-tennis slug or LD_TENNIS_ORG_ID`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/ld-tennis/)
      expect(code).not.toMatch(/LD_TENNIS_ORG_ID/)
      expect(code).not.toMatch(/process\.env\.[A-Z_]*ORG_ID/)
    })
  }

  it('scripts/add-events-artwork.sql never references ld-tennis or a hardcoded organisation id in its live DDL', () => {
    const live = stripSqlLineComments(read('scripts/add-events-artwork.sql'))
    expect(live).not.toMatch(/ld-tennis/i)
  })
})

describe('Events artwork/availability pass — no new storage subsystem introduced', () => {
  for (const file of TOUCHED_FILES) {
    it(`${file} introduces no blob/S3/filesystem-upload dependency`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/@vercel\/blob/)
      expect(code).not.toMatch(/aws-sdk/)
      expect(code).not.toMatch(/cloudinary/i)
      expect(code).not.toMatch(/multer|formidable/i)
      expect(code).not.toMatch(/fs\.writeFile|writeFile\(/)
      expect(code).not.toMatch(/from ['"]fs(\/promises)?['"]/)
    })
  }

  // @vercel/blob was deliberately added in a LATER, explicitly-scoped
  // pass (the production-safe artwork upload phase) as the platform's
  // own already-selected storage direction — see
  // docs/architecture/decisions/0001-data-hub-ingestion-foundation.md §9
  // and lib/events/blobStorage.ts's own header comment. This test file
  // covers the earlier URL-reference-only pass and no longer asserts its
  // absence; it still guards against any OTHER, non-approved storage
  // dependency ever sneaking in.
  it('package.json has no non-approved storage/upload dependency (S3, Cloudinary, multer, etc.) — @vercel/blob is the one deliberately approved exception, added in a later pass', () => {
    const pkg = read('package.json')
    expect(pkg).not.toMatch(/"aws-sdk"|"cloudinary"|"multer"|"formidable"|"uploadthing"/i)
  })
})

// QR/check-in were explicitly authorized in a LATER, dedicated pass
// (Phase 3 — digital tickets + check-in, see
// tests/containment/eventsPhase3Ticketing.test.ts for that pass's own
// containment coverage). This describe block covered the artwork/
// availability pass specifically, before that authorization existed;
// it no longer asserts QR/check-in absence, but still guards against
// anything that pass never sanctioned (payment/email/CRM/audit).
describe('Events artwork/availability pass — no payment/email/CRM/audit scope creep', () => {
  for (const file of TOUCHED_FILES) {
    it(`${file} has no payment/email/CRM/audit code`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/stripe|paypal|square|checkout\.session|payment_intent/i)
      expect(code).not.toMatch(/resend|sendEmail|nodemailer/i)
      expect(code).not.toMatch(/audit_logs|AuditLog/)
    })
  }
})

describe('scripts/add-events-artwork.sql — additive-only schema change', () => {
  it('uses IF NOT EXISTS and touches only the events table', () => {
    const live = stripSqlLineComments(read('scripts/add-events-artwork.sql'))
    expect(live).toMatch(/ALTER TABLE events ADD COLUMN IF NOT EXISTS artwork_url TEXT/)
    expect(live).not.toMatch(/\bDROP\b/i)
    expect(live).not.toMatch(/ALTER TABLE\s+(?!events\b)/i)
  })
})
