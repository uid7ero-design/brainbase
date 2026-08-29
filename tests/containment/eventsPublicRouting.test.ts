import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

// Events & Ticketing Phase 2 — proves the public read path
// (resolvePublicEvent + the public GET route + the public page): a
// published event is accessible anonymously; draft/cancelled/
// nonexistent/wrong-organisation-slug events are all uniformly
// unavailable; no session is required or consulted; only the allow-
// listed safe fields are ever returned.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const checkCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, checkCapability: (...args: unknown[]) => checkCapabilityMock(...args) }
})

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

const publicGetRoute = await import('@/app/api/public/events/[organisationSlug]/[eventSlug]/route')
const { resolvePublicEvent } = await import('@/lib/events/publicResolve')

const ORG_ROW = [{ id: 'org-a' }]
const PUBLISHED_EVENT_ROW = [{
  id: 'event-1', organisation_id: 'org-a', name: 'Graduation', slug: 'graduation',
  description: 'A wonderful day', venue: 'Hall', starts_at: new Date('2026-12-01T10:00:00Z'),
  ends_at: new Date('2026-12-01T12:00:00Z'), timezone: 'Australia/Adelaide', created_by: 'user-1', status: 'PUBLISHED',
}]

const CTX = { params: Promise.resolve({ organisationSlug: 'ld-tennis', eventSlug: 'graduation' }) }

beforeEach(() => {
  sqlMock.mockReset()
  checkCapabilityMock.mockReset()
  responseQueue = []
  callCount = 0
  checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'events', config: {} } })
})

describe('resolvePublicEvent — published/draft/cancelled/cross-org', () => {
  it('a published event resolves successfully', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW)
    const result = await resolvePublicEvent('ld-tennis', 'graduation')
    expect(result.ok).toBe(true)
  })

  it("the event lookup requires status = 'PUBLISHED', so a draft/cancelled event resolves to not-ok (simulated by an empty result, exactly like the real WHERE clause would produce)", async () => {
    queue(ORG_ROW, []) // a real DB's WHERE status='PUBLISHED' excludes a DRAFT/CANCELLED row
    const result = await resolvePublicEvent('ld-tennis', 'graduation')
    expect(result.ok).toBe(false)
  })

  it('unknown organisation slug -> not ok, no further queries', async () => {
    queue([])
    const result = await resolvePublicEvent('no-such-org', 'graduation')
    expect(result.ok).toBe(false)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('unknown event slug within a real organisation -> not ok', async () => {
    queue(ORG_ROW, [])
    const result = await resolvePublicEvent('ld-tennis', 'no-such-event')
    expect(result.ok).toBe(false)
  })

  it('never accepts or trusts an organisationId parameter — the function signature itself only accepts slugs', () => {
    // Type-level guarantee: resolvePublicEvent(organisationSlug: string, eventSlug: string) has no
    // organisationId parameter at all; this is asserted by the successful compile of every call site
    // in this file passing only two slug strings. Documented here as the structural claim it is.
    expect(resolvePublicEvent.length).toBe(2)
  })
})

describe('resolvePublicEvent — capability gating', () => {
  it('disabled Events capability -> not ok, event lookup never runs', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false, reason: 'NO_ENTITLEMENT' })
    queue(ORG_ROW)
    const result = await resolvePublicEvent('ld-tennis', 'graduation')
    expect(result.ok).toBe(false)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('capability DB failure fails closed -> not ok (never "ok" on an outage)', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false, reason: 'DATABASE_ERROR' })
    queue(ORG_ROW)
    const result = await resolvePublicEvent('ld-tennis', 'graduation')
    expect(result.ok).toBe(false)
  })
})

describe('Public GET route — no session required, safe field allow-list', () => {
  it('a published event is accessible with zero authentication of any kind', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, [], [])
    const res = await publicGetRoute.GET(asNextRequest(new Request('http://localhost/x')), CTX)
    expect(res.status).toBe(200)
  })

  it('unavailable event -> 404, uniform message', async () => {
    queue([])
    const res = await publicGetRoute.GET(asNextRequest(new Request('http://localhost/x')), CTX)
    expect(res.status).toBe(404)
  })

  it('never returns organisation internal id, created_by, attendee/purchaser data, or internal status', async () => {
    queue(ORG_ROW, PUBLISHED_EVENT_ROW, [], [])
    const res = await publicGetRoute.GET(asNextRequest(new Request('http://localhost/x')), CTX)
    const body = await res.json()
    const serialised = JSON.stringify(body)
    expect(serialised).not.toMatch(/organisation_id|created_by|purchaser|attendee|"status"/i)
    expect(body.event).not.toHaveProperty('id')
    expect(body.event).not.toHaveProperty('organisation_id')
    expect(body.event).not.toHaveProperty('created_by')
  })

  it('the route file never calls an authenticated session helper', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/api/public/events/[organisationSlug]/[eventSlug]/route.ts'),
      'utf8',
    )
    expect(src).not.toMatch(/requireSession|requireRole|getSession|getAuthSession|cookies\(\)/)
  })
})

describe('Public page — unavailable events produce Next\'s standard not-found response', () => {
  it('app/e/[organisationSlug]/[eventSlug]/page.tsx calls notFound() when the resolver returns not-ok', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/e/[organisationSlug]/[eventSlug]/page.tsx'),
      'utf8',
    )
    expect(src).toMatch(/notFound\(\)/)
    expect(src).toMatch(/from ['"]next\/navigation['"]/)
  })
})
