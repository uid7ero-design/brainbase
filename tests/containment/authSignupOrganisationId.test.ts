import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Discovered during Stripe Preview E2E verification (3E Stripe operational
// readiness track) — app/api/auth/signup/route.ts's organisations INSERT
// omitted `id` and `updated_at`, both NOT NULL columns with NO database-
// level default (Organisation.id's Prisma model is `@default(cuid())`,
// not `@default(dbgenerated(...))`, and .updated_at is a plain
// `@updatedAt` — both are Prisma-Client-only conventions, never a real
// Postgres DEFAULT expression). Every single public signup attempt failed
// unconditionally with "null value in column \"id\" of relation
// \"organisations\" violates not-null constraint" — confirmed by directly
// reproducing it against a live Preview deployment before this fix.
//
// This is the exact same defect class app/api/admin/orgs/route.ts's POST
// handler already had fixed (see tests/containment/adminOrgSavePath.test.ts's
// "organisation creation no longer omits required NOT NULL columns" suite)
// — this suite applies the identical, already-established fix pattern
// (gen_random_uuid()::text / now()) to the signup route specifically.
//
// A second, previously-unreachable defect was found on the very next
// statement: the users INSERT cast organisation_id to `::uuid`
// (`${org.id}::uuid`), but users.organisation_id is TEXT — this exact
// ::uuid-on-a-TEXT-column anti-pattern is the same class of bug
// adminOrgSavePath.test.ts's "TEXT id contract" suites already guard
// against for the admin orgs route's PATCH/DELETE. It was never exercised
// before this fix because execution never reached it — the prior
// organisations.id violation always threw first.

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

const checkRateLimitMock = vi.fn()
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args) }))

vi.mock('@/lib/clientIp', () => ({ getClientIp: () => '203.0.113.1' }))

const createSessionMock = vi.fn()
vi.mock('@/lib/session', () => ({ createSession: (...args: unknown[]) => createSessionMock(...args) }))

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

const { POST } = await import('@/app/api/auth/signup/route')

function signupRequest(body: Record<string, unknown>): NextRequest {
  return asNextRequest(new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

const VALID_BODY = {
  name: 'Test Founder',
  email: 'founder@example.com',
  orgName: 'Acme Co',
  password: 'correct-horse-battery',
}

// A real, opaque, non-UUID-shaped TEXT id — proves the fix works for
// whatever gen_random_uuid()::text actually returns, without assuming
// any particular shape the route's own SQL happens to produce.
const GENERATED_ORG_ID = '9f6a1c3e-52b1-4b7a-9c3d-8e2f1a0b7c5d'

beforeEach(() => {
  checkRateLimitMock.mockReset()
  createSessionMock.mockReset()
  sqlMock.mockReset()
  responseQueue = []
  callCount = 0
  checkRateLimitMock.mockReturnValue(true)
})

describe('POST /api/auth/signup — organisation id no longer omitted (root-cause fix)', () => {
  it('the organisations INSERT supplies id and updated_at explicitly — the exact two columns with no database-level default', async () => {
    queue(
      [{ id: GENERATED_ORG_ID }],
      [{ id: 'user-1', name: VALID_BODY.name, role: 'ADMIN', organisation_id: GENERATED_ORG_ID }],
    )
    await POST(signupRequest(VALID_BODY))
    const text = sqlCallText(0)
    expect(text).toMatch(/INSERT INTO organisations \(id, name, slug, plan, status, settings, updated_at\)/)
    expect(text).toMatch(/gen_random_uuid\(\)::text/)
    expect(text).toMatch(/now\(\)/)
  })

  it('a successful signup no longer fails with the organisations.id NOT NULL violation — returns 200 success', async () => {
    queue(
      [{ id: GENERATED_ORG_ID }],
      [{ id: 'user-1', name: VALID_BODY.name, role: 'ADMIN', organisation_id: GENERATED_ORG_ID }],
    )
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true })
  })

  it('directly reproduces the exact prior failure as a regression guard — the old NOT NULL error, if it recurred, would still surface as a safe 500, never an unhandled throw', async () => {
    sqlMock.mockReset()
    sqlMock.mockRejectedValueOnce(new Error('null value in column "id" of relation "organisations" violates not-null constraint'))
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
  })
})

describe('POST /api/auth/signup — organisation_id TEXT contract (no ::uuid cast)', () => {
  it('no statement in the signup flow casts organisation_id to ::uuid — organisations.id/users.organisation_id are both TEXT', async () => {
    queue(
      [{ id: GENERATED_ORG_ID }],
      [{ id: 'user-1', name: VALID_BODY.name, role: 'ADMIN', organisation_id: GENERATED_ORG_ID }],
    )
    await POST(signupRequest(VALID_BODY))
    expect(sqlCallText(0)).not.toMatch(/::uuid/i)
    expect(sqlCallText(1)).not.toMatch(/::uuid/i)
  })

  it('the users INSERT receives the exact organisation id string returned from the organisations INSERT, unmodified', async () => {
    queue(
      [{ id: GENERATED_ORG_ID }],
      [{ id: 'user-1', name: VALID_BODY.name, role: 'ADMIN', organisation_id: GENERATED_ORG_ID }],
    )
    await POST(signupRequest(VALID_BODY))
    expect(sqlCallArgs(1)).toContain(GENERATED_ORG_ID)
  })

  it('a non-UUID-shaped generated id (a cuid, or any opaque TEXT value) still succeeds — the old ::uuid cast would have thrown on syntax alone for this shape', async () => {
    const CUID_SHAPED_ID = 'clx8f9a2b0000abc123def456'
    queue(
      [{ id: CUID_SHAPED_ID }],
      [{ id: 'user-1', name: VALID_BODY.name, role: 'ADMIN', organisation_id: CUID_SHAPED_ID }],
    )
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(200)
    expect(sqlCallArgs(1)).toContain(CUID_SHAPED_ID)
  })
})

describe('POST /api/auth/signup — organisation id propagation into the session', () => {
  it('createSession is called with the same organisation id the user row was created against, not a re-derived or re-cast value', async () => {
    queue(
      [{ id: GENERATED_ORG_ID }],
      [{ id: 'user-1', name: VALID_BODY.name, role: 'admin', organisation_id: GENERATED_ORG_ID }],
    )
    await POST(signupRequest(VALID_BODY))
    expect(createSessionMock).toHaveBeenCalledWith('user-1', GENERATED_ORG_ID, 'admin', VALID_BODY.name)
  })
})

describe('POST /api/auth/signup — unrelated behaviour unchanged', () => {
  it('still returns 400 when required fields are missing — never reaches the database', async () => {
    const res = await POST(signupRequest({ name: 'Test', email: '', orgName: 'Acme', password: 'password123' }))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('still returns 400 for an invalid email address — never reaches the database', async () => {
    const res = await POST(signupRequest({ ...VALID_BODY, email: 'not-an-email' }))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('still returns 400 for a password under 8 characters — never reaches the database', async () => {
    const res = await POST(signupRequest({ ...VALID_BODY, password: 'short' }))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('still returns 429 when the rate limit is exceeded — never reaches the database', async () => {
    checkRateLimitMock.mockReturnValue(false)
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(429)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('a duplicate-email unique-constraint violation is still mapped to a 409, unchanged', async () => {
    sqlMock.mockReset()
    sqlMock.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "users_email_key"'))
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already exists/i)
  })

  it('an unexpected database error on the user INSERT still returns a safe 500 JSON body, never an unhandled throw', async () => {
    sqlMock.mockReset()
    // Chained .mockImplementationOnce/.mockRejectedValueOnce are consumed
    // in the exact order registered — call #1 (organisations INSERT)
    // resolves normally, call #2 (users INSERT) rejects.
    sqlMock
      .mockImplementationOnce(() => Promise.resolve([{ id: GENERATED_ORG_ID }]))
      .mockRejectedValueOnce(new Error('some unexpected database error'))
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
  })
})
