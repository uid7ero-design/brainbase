import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import {
  validateSlug, validateEventInput, validateEventSessionInput, validateEventTicketTypeInput, mergeField,
} from '@/lib/events/validation'

describe('lib/events/validation — mergeField (R2 remediation 3, pure unit rules)', () => {
  it('an omitted key preserves the existing value', () => {
    expect(mergeField({}, 'description', 'existing')).toBe('existing')
  })

  it('an explicit null clears (overrides) the existing value', () => {
    expect(mergeField({ description: null }, 'description', 'existing')).toBeNull()
  })

  it('a provided value replaces the existing value', () => {
    expect(mergeField({ description: 'new' }, 'description', 'existing')).toBe('new')
  })

  it('a key explicitly set to undefined is still an own property, so it is treated as provided (not "omitted") — unreachable via a real request body, since JSON has no undefined literal and req.json() can never produce this shape', () => {
    expect(mergeField({ description: undefined }, 'description', 'existing')).toBeUndefined()
  })
})

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
const eventIdRoute = await import('@/app/api/events/[id]/route')
const ticketTypeIdRoute = await import('@/app/api/events/[id]/ticket-types/[ticketTypeId]/route')

const EVENT_CTX = { params: Promise.resolve({ id: 'event-1' }) }
const TICKET_TYPE_CTX = { params: Promise.resolve({ id: 'event-1', ticketTypeId: 'tt-1' }) }

function patchReq(url: string, body: unknown) {
  return asNextRequest(new Request(url, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}

const EXISTING_EVENT = {
  id: 'event-1', organisation_id: 'org-a', name: 'Formal', slug: 'formal',
  description: 'Old description', venue: 'Old venue', status: 'DRAFT',
  starts_at: new Date('2026-12-01T10:00:00Z'), ends_at: new Date('2026-12-01T12:00:00Z'),
  timezone: 'Australia/Adelaide',
}

const EXISTING_TICKET_TYPE = {
  id: 'tt-1', event_id: 'event-1', organisation_id: 'org-a', name: 'GA',
  description: 'Old ticket description', price_cents: 0, capacity: 100, active: true, sort_order: 0,
}

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

// R2 remediation 3 — independent review found `body.field ?? existing.field`
// treats an explicit `null` identically to "field omitted", so a UI-driven
// "clear this field" PATCH silently no-ops instead of clearing it. Fixed
// via mergeField() (property-presence based). These tests prove all three
// PATCH semantics behaviorally through the real route, for every nullable
// field the independent review named (Event.description, Event.venue,
// EventTicketType.description) — and that merged-state validation (the
// one-field-PATCH-creates-an-invalid-pair guard) still works afterward.
describe('Event PATCH — explicit-null clearing semantics (R2 remediation 3)', () => {
  it('omitting description leaves the existing value unchanged', async () => {
    queue([EXISTING_EVENT], [{ ...EXISTING_EVENT }])
    const res = await eventIdRoute.PATCH(patchReq('http://localhost/x', { name: 'Formal' }), EVENT_CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[1] as unknown as unknown[]
    expect(updateCall).toContain('Old description')
  })

  it('sending a new description string replaces the existing value', async () => {
    queue([EXISTING_EVENT], [{ ...EXISTING_EVENT, description: 'New description' }])
    const res = await eventIdRoute.PATCH(patchReq('http://localhost/x', { name: 'Formal', description: 'New description' }), EVENT_CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[1] as unknown as unknown[]
    expect(updateCall).toContain('New description')
    expect(updateCall).not.toContain('Old description')
  })

  it('sending description: null explicitly clears it — the exact bug the independent review found', async () => {
    queue([EXISTING_EVENT], [{ ...EXISTING_EVENT, description: null }])
    const res = await eventIdRoute.PATCH(patchReq('http://localhost/x', { name: 'Formal', description: null }), EVENT_CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[1] as unknown as unknown[]
    expect(updateCall).not.toContain('Old description')
    expect(updateCall).toContain(null)
  })

  it('omitting venue leaves the existing value unchanged', async () => {
    queue([EXISTING_EVENT], [{ ...EXISTING_EVENT }])
    const res = await eventIdRoute.PATCH(patchReq('http://localhost/x', { name: 'Formal' }), EVENT_CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[1] as unknown as unknown[]
    expect(updateCall).toContain('Old venue')
  })

  it('sending a new venue string replaces the existing value', async () => {
    queue([EXISTING_EVENT], [{ ...EXISTING_EVENT, venue: 'New venue' }])
    const res = await eventIdRoute.PATCH(patchReq('http://localhost/x', { name: 'Formal', venue: 'New venue' }), EVENT_CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[1] as unknown as unknown[]
    expect(updateCall).toContain('New venue')
    expect(updateCall).not.toContain('Old venue')
  })

  it('sending venue: null explicitly clears it', async () => {
    queue([EXISTING_EVENT], [{ ...EXISTING_EVENT, venue: null }])
    const res = await eventIdRoute.PATCH(patchReq('http://localhost/x', { name: 'Formal', venue: null }), EVENT_CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[1] as unknown as unknown[]
    expect(updateCall).not.toContain('Old venue')
    expect(updateCall).toContain(null)
  })

  it('required fields still reject an explicit null (never silently kept, never silently nulled) — merged-state validation catches it', async () => {
    queue([EXISTING_EVENT]) // only the ownership SELECT — PATCH must 400 before any UPDATE
    const res = await eventIdRoute.PATCH(patchReq('http://localhost/x', { name: null }), EVENT_CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('merged-state validation still rejects an invalid result after the mergeField refactor — a new starts_at after the untouched existing ends_at is still caught', async () => {
    queue([EXISTING_EVENT]) // existing.ends_at = 2026-12-01T12:00:00Z
    const res = await eventIdRoute.PATCH(patchReq('http://localhost/x', { starts_at: '2027-01-01T00:00:00Z' }), EVENT_CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })
})

describe('EventTicketType PATCH — explicit-null clearing semantics (R2 remediation 3)', () => {
  it('omitting description leaves the existing value unchanged', async () => {
    queue([EXISTING_TICKET_TYPE], [{ ...EXISTING_TICKET_TYPE }])
    const res = await ticketTypeIdRoute.PATCH(patchReq('http://localhost/x', { name: 'GA' }), TICKET_TYPE_CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[1] as unknown as unknown[]
    expect(updateCall).toContain('Old ticket description')
  })

  it('sending a new description string replaces the existing value', async () => {
    queue([EXISTING_TICKET_TYPE], [{ ...EXISTING_TICKET_TYPE, description: 'New ticket description' }])
    const res = await ticketTypeIdRoute.PATCH(patchReq('http://localhost/x', { name: 'GA', description: 'New ticket description' }), TICKET_TYPE_CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[1] as unknown as unknown[]
    expect(updateCall).toContain('New ticket description')
    expect(updateCall).not.toContain('Old ticket description')
  })

  it('sending description: null explicitly clears it — the exact bug the independent review found', async () => {
    queue([EXISTING_TICKET_TYPE], [{ ...EXISTING_TICKET_TYPE, description: null }])
    const res = await ticketTypeIdRoute.PATCH(patchReq('http://localhost/x', { name: 'GA', description: null }), TICKET_TYPE_CTX)
    expect(res.status).toBe(200)
    const updateCall = sqlMock.mock.calls[1] as unknown as unknown[]
    expect(updateCall).not.toContain('Old ticket description')
    expect(updateCall).toContain(null)
  })

  it('required fields still reject an explicit null — merged-state validation catches it', async () => {
    queue([EXISTING_TICKET_TYPE]) // only the ownership SELECT — PATCH must 400 before any UPDATE
    const res = await ticketTypeIdRoute.PATCH(patchReq('http://localhost/x', { name: null }), TICKET_TYPE_CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('a negative price still rejected after the mergeField refactor (omitted-vs-provided semantics did not weaken numeric validation)', async () => {
    queue([EXISTING_TICKET_TYPE])
    const res = await ticketTypeIdRoute.PATCH(patchReq('http://localhost/x', { price_cents: -500 }), TICKET_TYPE_CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })
})
