import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
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
// A second defect (organisation_id cast to ::uuid against a TEXT column)
// was fixed in the same first pass — see git history for that diff.
//
// A live Preview smoke test against that first pass then exposed a THIRD
// defect: users.id has the exact same "no database-level default" problem
// as organisations.id (User.id is also `@default(cuid())`), and the users
// INSERT omitted both `id` and `updated_at` entirely. This overnight pass
// fixes that by generating BOTH ids in JS with crypto.randomUUID() and
// committing both INSERTs as one atomic unit via the neon driver's
// sql.transaction() primitive (already established elsewhere in this
// codebase — see lib/commercial/invoices.ts) — generating the org id in
// JS, rather than via gen_random_uuid()::text inside Postgres, is what
// lets the users INSERT reference the same id without depending on a
// RETURNING clause, which sql.transaction()'s flat pre-built query array
// does not support.
//
// FINAL UNBLOCK (PR #216): the product decision is that public signup
// collects an explicit, human-chosen username rather than deriving one
// from email or generating one silently. app/signup/page.tsx now collects
// it directly, and the users INSERT below supplies it. The stored value is
// trimmed and lowercased — mirroring app/actions/users.ts's own
// createUser() convention rather than app/api/admin/users/route.ts's
// trim-only one — specifically because app/actions/auth.ts's login always
// lowercases the submitted username before its `WHERE username = ...`
// lookup; storing any other casing would make the exact username a user
// just chose at signup fail to log back in. Duplicate usernames are
// disambiguated from duplicate emails in the catch block below, mirroring
// app/api/admin/users/route.ts's own `msg.includes('username') ? ... : ...`
// pattern, while the pre-existing duplicate-email wording/behavior is left
// unchanged. Because both INSERTs are still committed via one
// sql.transaction() call, a duplicate-username failure on the second
// statement cannot leave an orphan organisation from the first.

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

const checkRateLimitMock = vi.fn()
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args) }))

vi.mock('@/lib/clientIp', () => ({ getClientIp: () => '203.0.113.1' }))

const createSessionMock = vi.fn()
vi.mock('@/lib/session', () => ({ createSession: (...args: unknown[]) => createSessionMock(...args) }))

// sql`...` calls now build a lazy, unawaited query; sql.transaction([...])
// awaits the whole array as one atomic unit (the real neon driver's own
// shape — see lib/commercial/invoices.ts). sqlMock records each built
// query's template text + bound params via a queue()/rejection helper;
// transactionMock mirrors real Promise.all-style "all succeed or the
// first rejection wins" semantics.
let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
const transactionMock = vi.fn((queries: unknown[]) => Promise.all(queries))

vi.mock('@/lib/db', () => ({
  default: Object.assign(
    (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
    { transaction: (...args: unknown[]) => (transactionMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(args[0]) },
  ),
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
  username: 'testfounder',
  email: 'founder@example.com',
  orgName: 'Acme Co',
  password: 'correct-horse-battery',
}

const ORG_UUID = '11111111-1111-4111-8111-111111111111'
const USER_UUID = '22222222-2222-4222-8222-222222222222'

const originalRandomUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto)
function mockUuidSequence(...ids: string[]) {
  let i = 0
  // Direct reassignment rather than vi.spyOn: crypto.randomUUID is
  // inherited from Crypto.prototype with no own property descriptor on
  // globalThis.crypto in this Node runtime, which vi.spyOn's
  // save/restore logic does not handle cleanly. A plain own-property
  // override (restored in afterAll below) works reliably instead.
  globalThis.crypto.randomUUID = vi.fn(() => (ids[i++] ?? originalRandomUUID())) as typeof globalThis.crypto.randomUUID
}

afterAll(() => {
  globalThis.crypto.randomUUID = originalRandomUUID
})

beforeEach(() => {
  checkRateLimitMock.mockReset()
  createSessionMock.mockReset()
  sqlMock.mockReset()
  transactionMock.mockReset()
  transactionMock.mockImplementation((queries: unknown[]) => Promise.all(queries))
  responseQueue = []
  callCount = 0
  checkRateLimitMock.mockReturnValue(true)
  mockUuidSequence(ORG_UUID, USER_UUID)
})

describe('POST /api/auth/signup — organisation id no longer omitted (root-cause fix)', () => {
  it('the organisations INSERT (query 0) supplies id and updated_at explicitly — the exact two columns with no database-level default', async () => {
    queue([], [])
    await POST(signupRequest(VALID_BODY))
    const text = sqlCallText(0)
    expect(text).toMatch(/INSERT INTO organisations \(id, name, slug, plan, status, settings, updated_at\)/)
    expect(text).toMatch(/now\(\)/)
    expect(sqlCallArgs(0)).toContain(ORG_UUID)
  })

  it('a successful signup no longer fails with the organisations.id NOT NULL violation — returns 200 success', async () => {
    queue([], [])
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true })
  })

  it('directly reproduces the exact prior failure as a regression guard — the old NOT NULL error, if it recurred, would still surface as a safe 500, never an unhandled throw', async () => {
    transactionMock.mockRejectedValueOnce(new Error('null value in column "id" of relation "organisations" violates not-null constraint'))
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
  })
})

describe('POST /api/auth/signup — users.id / users.updated_at no longer omitted (overnight fix)', () => {
  it('the users INSERT (query 1) supplies id and updated_at explicitly, using a freshly generated id — not a value read back from the organisations INSERT', async () => {
    queue([], [])
    await POST(signupRequest(VALID_BODY))
    const text = sqlCallText(1)
    expect(text).toMatch(/INSERT INTO users \(id, username, name, email, password_hash, role, status, organisation_id, email_verified, updated_at\)/)
    expect(text).toMatch(/now\(\)/)
    expect(sqlCallArgs(1)).toContain(USER_UUID)
  })

  it('directly reproduces the exact users.id failure discovered by the live Preview smoke test as a regression guard', async () => {
    transactionMock.mockRejectedValueOnce(new Error('null value in column "id" of relation "users" violates not-null constraint'))
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
    expect(createSessionMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/signup — both inserts committed atomically', () => {
  it('sql.transaction is invoked with exactly the two prepared queries, in order (organisations, then users)', async () => {
    queue([], [])
    await POST(signupRequest(VALID_BODY))
    expect(transactionMock).toHaveBeenCalledTimes(1)
    const queries = transactionMock.mock.calls[0][0] as unknown[]
    expect(queries).toHaveLength(2)
  })

  it('the organisation id generated for the organisations INSERT is the exact same id used as users.organisation_id — no dependency on a RETURNING round-trip', async () => {
    queue([], [])
    await POST(signupRequest(VALID_BODY))
    expect(sqlCallArgs(0)).toContain(ORG_UUID)
    expect(sqlCallArgs(1)).toContain(ORG_UUID)
  })

  it('a failure anywhere in the transaction never creates a session — no half-signed-up state', async () => {
    transactionMock.mockRejectedValueOnce(new Error('some unexpected database error'))
    await POST(signupRequest(VALID_BODY))
    expect(createSessionMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/signup — organisation_id TEXT contract (no ::uuid cast)', () => {
  it('no statement in the signup flow casts any id to ::uuid — organisations.id/users.id/users.organisation_id are all TEXT', async () => {
    queue([], [])
    await POST(signupRequest(VALID_BODY))
    expect(sqlCallText(0)).not.toMatch(/::uuid/i)
    expect(sqlCallText(1)).not.toMatch(/::uuid/i)
  })

  it('neither INSERT relies on gen_random_uuid() — both ids are generated once in JS and passed as bound parameters', async () => {
    queue([], [])
    await POST(signupRequest(VALID_BODY))
    expect(sqlCallText(0)).not.toMatch(/gen_random_uuid/i)
    expect(sqlCallText(1)).not.toMatch(/gen_random_uuid/i)
  })
})

describe('POST /api/auth/signup — role/status enum casing matches the real Postgres enums', () => {
  it('role and status are supplied as the uppercase enum labels the schema actually defines (UserRole/UserStatus), matching every other raw-SQL users INSERT in this codebase', async () => {
    queue([], [])
    await POST(signupRequest(VALID_BODY))
    expect(sqlCallText(1)).toMatch(/'ADMIN'/)
    expect(sqlCallText(1)).toMatch(/'ACTIVE'/)
  })
})

describe('POST /api/auth/signup — organisation id propagation into the session', () => {
  it('createSession is called with the freshly generated user id, organisation id, the lowercase "admin" role literal, and the trimmed name — never a value read back from the database', async () => {
    queue([], [])
    await POST(signupRequest(VALID_BODY))
    expect(createSessionMock).toHaveBeenCalledWith(USER_UUID, ORG_UUID, 'admin', VALID_BODY.name)
  })
})

describe('POST /api/auth/signup — unrelated behaviour unchanged', () => {
  it('still returns 400 when required fields are missing — never reaches the database', async () => {
    const res = await POST(signupRequest({ name: 'Test', email: '', orgName: 'Acme', password: 'password123' }))
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('still returns 400 for an invalid email address — never reaches the database', async () => {
    const res = await POST(signupRequest({ ...VALID_BODY, email: 'not-an-email' }))
    expect(res.status).toBe(400)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('still returns 400 for a password under 8 characters — never reaches the database', async () => {
    const res = await POST(signupRequest({ ...VALID_BODY, password: 'short' }))
    expect(res.status).toBe(400)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('still returns 429 when the rate limit is exceeded — never reaches the database', async () => {
    checkRateLimitMock.mockReturnValue(false)
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(429)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('a duplicate-email unique-constraint violation is still mapped to a 409, unchanged', async () => {
    transactionMock.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "users_email_key"'))
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already exists/i)
  })

  it('an unexpected database error still returns a safe 500 JSON body, never an unhandled throw', async () => {
    transactionMock.mockRejectedValueOnce(new Error('some unexpected database error'))
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
  })
})

describe('POST /api/auth/signup — explicit username (PR #216 final unblock)', () => {
  it('(A) still returns 400 when username is missing — never reaches the database', async () => {
    const res = await POST(signupRequest({ ...VALID_BODY, username: '' }))
    expect(res.status).toBe(400)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('(A) still returns 400 when username is only whitespace — never reaches the database', async () => {
    const res = await POST(signupRequest({ ...VALID_BODY, username: '   ' }))
    expect(res.status).toBe(400)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('(B) a valid username reaches the users INSERT (query 1) as a bound parameter', async () => {
    queue([], [])
    await POST(signupRequest(VALID_BODY))
    expect(sqlCallText(1)).toMatch(/INSERT INTO users \(id, username, /)
    expect(sqlCallArgs(1)).toContain('testfounder')
  })

  it('(C) username is trimmed and lowercased before storage — matching app/actions/auth.ts login\'s own trim().toLowerCase() lookup, so the exact string a user types at signup is guaranteed to authenticate afterward', async () => {
    queue([], [])
    await POST(signupRequest({ ...VALID_BODY, username: '  TestFounder  ' }))
    expect(sqlCallArgs(1)).toContain('testfounder')
    expect(sqlCallArgs(1)).not.toContain('  TestFounder  ')
    expect(sqlCallArgs(1)).not.toContain('TestFounder')
  })

  it('(D) a duplicate-username unique-constraint violation is mapped to a distinct 409, never the generic email-duplicate wording', async () => {
    transactionMock.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "users_username_key"'))
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/username/i)
    expect(body.error).not.toMatch(/email/i)
  })

  it('(E) a duplicate-username failure creates no partial organisation state — no session created, since both INSERTs share one atomic transaction', async () => {
    transactionMock.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "users_username_key"'))
    await POST(signupRequest(VALID_BODY))
    expect(createSessionMock).not.toHaveBeenCalled()
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('(F) the pre-existing duplicate-email 409 wording/behavior is unchanged now that username disambiguation exists alongside it', async () => {
    transactionMock.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "users_email_key"'))
    const res = await POST(signupRequest(VALID_BODY))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already exists/i)
  })
})
