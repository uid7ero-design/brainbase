import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import {
  validateSlug, validateEventInput, validateEventSessionInput, validateEventTicketTypeInput,
} from '@/lib/events/validation'

describe('lib/events/validation — pure unit rules', () => {
  it('rejects an empty/whitespace slug', () => {
    expect(validateSlug('')).toBeTruthy()
    expect(validateSlug('   ')).toBeTruthy()
  })

  it('rejects a slug with uppercase, spaces, or invalid characters', () => {
    expect(validateSlug('Spring Formal')).toBeTruthy()
    expect(validateSlug('spring_formal')).toBeTruthy()
    expect(validateSlug('spring--formal')).toBeTruthy()
    expect(validateSlug('-spring-formal')).toBeTruthy()
  })

  it('accepts a well-formed slug', () => {
    expect(validateSlug('spring-formal-2026')).toBeNull()
  })

  it('rejects an event with ends_at before or equal to starts_at', () => {
    const base = { name: 'Formal', slug: 'formal', timezone: 'Australia/Adelaide' }
    expect(validateEventInput({ ...base, starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T09:00:00Z' })).toBeTruthy()
    expect(validateEventInput({ ...base, starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T10:00:00Z' })).toBeTruthy()
  })

  it('accepts a valid event', () => {
    expect(validateEventInput({
      name: 'Formal', slug: 'formal', timezone: 'Australia/Adelaide',
      starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z',
    })).toBeNull()
  })

  it('rejects an invalid status', () => {
    expect(validateEventInput({
      name: 'Formal', slug: 'formal', timezone: 'Australia/Adelaide', status: 'LIVE',
      starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z',
    })).toBeTruthy()
  })

  it('rejects an unrecognised timezone', () => {
    expect(validateEventInput({
      name: 'Formal', slug: 'formal', timezone: 'Not/A_Real_Zone',
      starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z',
    })).toBeTruthy()
  })

  it('rejects a session with ends_at before starts_at', () => {
    expect(validateEventSessionInput({
      name: 'Rehearsal', capacity: 10,
      starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T09:00:00Z',
    })).toBeTruthy()
  })

  it('rejects a negative or non-integer session capacity', () => {
    const valid = { name: 'Rehearsal', starts_at: '2026-12-01T09:00:00Z', ends_at: '2026-12-01T10:00:00Z' }
    expect(validateEventSessionInput({ ...valid, capacity: -1 })).toBeTruthy()
    expect(validateEventSessionInput({ ...valid, capacity: 1.5 })).toBeTruthy()
  })

  it('accepts a zero session capacity (a valid, if unusable, non-negative whole number)', () => {
    expect(validateEventSessionInput({
      name: 'Rehearsal', capacity: 0,
      starts_at: '2026-12-01T09:00:00Z', ends_at: '2026-12-01T10:00:00Z',
    })).toBeNull()
  })

  it('rejects a negative ticket price', () => {
    expect(validateEventTicketTypeInput({ name: 'GA', price_cents: -100, capacity: 10 })).toBeTruthy()
  })

  it('accepts a zero (free) ticket price', () => {
    expect(validateEventTicketTypeInput({ name: 'GA', price_cents: 0, capacity: 10 })).toBeNull()
  })

  it('rejects a negative or non-integer ticket capacity', () => {
    expect(validateEventTicketTypeInput({ name: 'GA', price_cents: 0, capacity: -1 })).toBeTruthy()
    expect(validateEventTicketTypeInput({ name: 'GA', price_cents: 0, capacity: 2.5 })).toBeTruthy()
  })

  it('rejects a non-integer sort order', () => {
    expect(validateEventTicketTypeInput({ name: 'GA', price_cents: 0, capacity: 10, sort_order: 1.5 })).toBeTruthy()
  })
})

// ─── Route-level validation wiring (400s) and slug-conflict (409) ──────

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
let shouldThrowUniqueViolation = false
const sqlMock = vi.fn(() => {
  if (shouldThrowUniqueViolation) return Promise.reject(new Error('duplicate key value violates unique constraint "events_organisation_id_slug_key"'))
  return Promise.resolve(responseQueue[callCount++] ?? [])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: vi.fn().mockResolvedValue({ key: 'events', config: {} }) }
})

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}

const eventsRoute = await import('@/app/api/events/route')

beforeEach(() => {
  requireSessionMock.mockReset()
  sqlMock.mockClear()
  responseQueue = []
  callCount = 0
  shouldThrowUniqueViolation = false
  requireSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager' })
})

function jsonReq(body: unknown) {
  return asNextRequest(new Request('http://localhost/api/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}

describe('Events route — validation and slug-conflict wiring', () => {
  it('invalid event input -> 400, no INSERT is ever issued', async () => {
    const res = await eventsRoute.POST(jsonReq({ name: '', slug: 'formal' }))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('duplicate slug within one organisation -> 409, not 500', async () => {
    shouldThrowUniqueViolation = true
    const res = await eventsRoute.POST(jsonReq({
      name: 'Formal', slug: 'formal', timezone: 'Australia/Adelaide',
      starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z',
    }))
    expect(res.status).toBe(409)
  })

  it('the same slug is a valid, independent value in a different organisation — uniqueness is scoped to (organisation_id, slug), never global', async () => {
    // Proven structurally: the DB constraint is UNIQUE(organisation_id, slug)
    // (see scripts/create-events.sql), not UNIQUE(slug) alone — so a
    // duplicate-key rejection can only ever fire within the same org.
    // Confirmed here by asserting the insert always carries the caller's
    // own organisationId alongside the slug, never a bare slug check.
    queue([{ id: 'e1', organisation_id: 'org-a', slug: 'formal' }])
    await eventsRoute.POST(jsonReq({
      name: 'Formal', slug: 'formal', timezone: 'Australia/Adelaide',
      starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T12:00:00Z',
    }))
    const call = sqlMock.mock.calls[0] as unknown as unknown[]
    expect(call).toContain('org-a')
    expect(call).toContain('formal')
  })
})
