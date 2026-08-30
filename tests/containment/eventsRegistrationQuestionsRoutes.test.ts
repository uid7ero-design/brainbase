import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Events & Ticketing Phase 4B (§4/§9) — proves the manager-facing
// registration-question CRUD routes:
//   GET  /api/events/[id]/questions            — viewer+
//   POST /api/events/[id]/questions            — manager+
//   PATCH /api/events/[id]/questions/[qId]      — manager+, no DELETE handler
// enforce role minimums, tenant scoping (an event owned by another
// organisation is 404, never leaked), and input validation, matching
// every other Events CRUD route's own established pattern (see
// eventsCrossOrgIsolation.test.ts / eventsRoleEnforcement.test.ts for
// the sessions/ticket-types equivalents this file mirrors).

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
// The reorder route's atomic lock-then-swap is submitted via
// sql.transaction([...]) — a separate mock from sqlMock itself, same
// convention every other transactional route's own test file uses
// (see eventsPublicRegistration.test.ts). Each sql`...` call used to
// BUILD the transaction's array elements still lands in sqlMock, in
// order, so callText()/callArgs() can inspect them; transactionMock's
// resolved value becomes the route's own `results` array.
let transactionFinalResult: unknown[] = []
const transactionMock = vi.fn(async () => [[], transactionFinalResult])
;(sqlMock as unknown as { transaction: typeof transactionMock }).transaction = transactionMock
vi.mock('@/lib/db', () => ({ default: sqlMock }))

vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: vi.fn().mockResolvedValue({ key: 'events', config: {} }) }
})

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}
function callText(index: number): string {
  const call = sqlMock.mock.calls[index] as unknown as unknown[]
  return (call[0] as TemplateStringsArray).join(' ')
}
function callArgs(index: number): unknown[] {
  return sqlMock.mock.calls[index] as unknown as unknown[]
}

const questionsRoute = await import('@/app/api/events/[id]/questions/route')
const questionIdRoute = await import('@/app/api/events/[id]/questions/[questionId]/route')
const reorderRoute = await import('@/app/api/events/[id]/questions/[questionId]/reorder/route')

function sessionAs(role: string, organisationId = 'org-a') {
  return { userId: 'u1', organisationId, role }
}
function req(url: string, method: string, body?: unknown) {
  return asNextRequest(new Request(url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

const OWNED_EVENT_CTX = { params: Promise.resolve({ id: 'event-1' }) }
const OTHER_ORG_EVENT_CTX = { params: Promise.resolve({ id: 'event-owned-by-org-b' }) }
const QUESTION_CTX = { params: Promise.resolve({ id: 'event-1', questionId: 'q-1' }) }

beforeEach(() => {
  requireSessionMock.mockReset()
  sqlMock.mockReset()
  transactionMock.mockClear()
  responseQueue = []
  callCount = 0
  transactionFinalResult = []
  transactionMock.mockImplementation(async () => [[], transactionFinalResult])
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
})
function resolveTransaction(finalResult: unknown[]) {
  transactionFinalResult = finalResult
  transactionMock.mockImplementationOnce(async () => [[], finalResult])
}
function rejectTransaction(err: Error) {
  transactionMock.mockRejectedValueOnce(err)
}

describe('GET /api/events/[id]/questions — viewer+ read', () => {
  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await questionsRoute.GET(req('http://localhost/x', 'GET'), OWNED_EVENT_CTX)
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer role can read', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    queue([{ id: 'event-1' }], [])
    const res = await questionsRoute.GET(req('http://localhost/x', 'GET'), OWNED_EVENT_CTX)
    expect(res.status).toBe(200)
  })

  it('an event owned by another organisation is 404, not leaked — the ownership query is scoped to the caller\'s own organisation_id', async () => {
    queue([]) // ownership SELECT finds nothing under org-a
    const res = await questionsRoute.GET(req('http://localhost/x', 'GET'), OTHER_ORG_EVENT_CTX)
    expect(res.status).toBe(404)
    expect(callArgs(0)).toContain('org-a')
    expect(callArgs(0)).not.toContain('org-b')
  })

  it('the question list query is scoped to organisation_id AND event_id', async () => {
    queue([{ id: 'event-1' }], [])
    await questionsRoute.GET(req('http://localhost/x', 'GET'), OWNED_EVENT_CTX)
    const text = callText(1)
    expect(text).toMatch(/organisation_id/i)
    expect(text).toMatch(/event_id/i)
    expect(callArgs(1)).toContain('org-a')
    expect(callArgs(1)).toContain('event-1')
  })
})

describe('POST /api/events/[id]/questions — manager+ create', () => {
  const VALID_BODY = { label: 'Dietary requirements', field_type: 'LONG_TEXT', scope: 'ATTENDEE' }

  it('viewer cannot create -> 403, no DB write', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await questionsRoute.POST(req('http://localhost/x', 'POST', VALID_BODY), OWNED_EVENT_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('manager can create — 201', async () => {
    queue([{ id: 'event-1' }], [{ id: 'q-new', ...VALID_BODY, help_text: null, required: false, options: null, sort_order: 0, active: true }])
    const res = await questionsRoute.POST(req('http://localhost/x', 'POST', VALID_BODY), OWNED_EVENT_CTX)
    expect(res.status).toBe(201)
  })

  it('invalid body (bad field_type) -> 400, no INSERT', async () => {
    queue([{ id: 'event-1' }])
    const res = await questionsRoute.POST(req('http://localhost/x', 'POST', { ...VALID_BODY, field_type: 'FILE_UPLOAD' }), OWNED_EVENT_CTX)
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(1) // ownership check only
  })

  it('cannot create a question against another organisation\'s event -> 404, no INSERT', async () => {
    queue([]) // ownership SELECT under org-a finds nothing
    const res = await questionsRoute.POST(req('http://localhost/x', 'POST', VALID_BODY), OTHER_ORG_EVENT_CTX)
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('mutation proof — the INSERT binds the caller\'s own organisation_id, never a client-supplied one (the accepted body shape has no such key anyway)', async () => {
    queue([{ id: 'event-1' }], [{ id: 'q-new' }])
    await questionsRoute.POST(req('http://localhost/x', 'POST', { ...VALID_BODY, organisation_id: 'org-b' }), OWNED_EVENT_CTX)
    const insertArgs = callArgs(1)
    expect(insertArgs).toContain('org-a')
    expect(insertArgs).not.toContain('org-b')
  })
})

describe('PATCH /api/events/[id]/questions/[questionId] — manager+ edit/deactivate/reorder', () => {
  const EXISTING = {
    id: 'q-1', label: 'Dietary requirements', help_text: null, field_type: 'LONG_TEXT',
    required: false, scope: 'ATTENDEE', options: null, sort_order: 0, active: true,
  }

  it('viewer cannot patch -> 403', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await questionIdRoute.PATCH(req('http://localhost/x', 'PATCH', { active: false }), QUESTION_CTX)
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('deactivating a question is a pure boolean toggle — active: false succeeds without needing the full question shape resent', async () => {
    queue([{ id: 'event-1' }], [EXISTING], [{ ...EXISTING, active: false }])
    const res = await questionIdRoute.PATCH(req('http://localhost/x', 'PATCH', { active: false }), QUESTION_CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.question.active).toBe(false)
  })

  it('reactivating (active: true) works the same way', async () => {
    queue([{ id: 'event-1' }], [{ ...EXISTING, active: false }], [{ ...EXISTING, active: true }])
    const res = await questionIdRoute.PATCH(req('http://localhost/x', 'PATCH', { active: true }), QUESTION_CTX)
    expect(res.status).toBe(200)
  })

  it('a sort_order-only patch (reorder) succeeds without resending label/field_type/scope', async () => {
    queue([{ id: 'event-1' }], [EXISTING], [{ ...EXISTING, sort_order: 5 }])
    const res = await questionIdRoute.PATCH(req('http://localhost/x', 'PATCH', { sort_order: 5 }), QUESTION_CTX)
    expect(res.status).toBe(200)
  })

  it('a content edit is validated through the same shape rules as create — an invalid field_type is rejected', async () => {
    queue([{ id: 'event-1' }], [EXISTING])
    const res = await questionIdRoute.PATCH(req('http://localhost/x', 'PATCH', { field_type: 'FILE_UPLOAD' }), QUESTION_CTX)
    expect(res.status).toBe(400)
  })

  it('a question belonging to another organisation\'s event is 404, no UPDATE', async () => {
    queue([]) // ownership check fails
    const res = await questionIdRoute.PATCH(req('http://localhost/x', 'PATCH', { active: false }), { params: Promise.resolve({ id: 'event-owned-by-org-b', questionId: 'q-1' }) })
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('an unknown questionId within an owned event is 404', async () => {
    queue([{ id: 'event-1' }], [])
    const res = await questionIdRoute.PATCH(req('http://localhost/x', 'PATCH', { active: false }), QUESTION_CTX)
    expect(res.status).toBe(404)
  })
})

// Phase 4B pre-commit remediation §2, then the final concurrency fix —
// atomic reorder. Replaces the old "two independent client-issued
// PATCH requests" swap, and then a since-rejected "one UPDATE with an
// embedded neighbor lookup, no lock" version (unsafe under genuine
// concurrency — see the route's own extensive comment on why), with a
// lock-then-swap pair of statements submitted via ONE
// sql.transaction([...]) call: statement 1 locks every sibling row in
// the (event, organisation, scope) group FOR UPDATE; statement 2 (a
// fresh, post-lock statement, per Postgres's per-statement snapshot
// rule) computes the neighbor via LAG/LEAD window functions and swaps
// sort_order, all against guaranteed-fresh data. What these MOCKED
// tests prove: route-level orchestration, tenant/event/scope scoping,
// and error handling. The genuine "concurrent reorder cannot use a
// stale pre-swap view" guarantee is proven separately, against real
// PostgreSQL, in scripts/tests/verify-events-phase4b-response-atomicity.sh's
// reorder-concurrency section (mocks have no real transaction/lock/
// snapshot semantics, by construction).
describe('PATCH /api/events/[id]/questions/[questionId]/reorder — atomic (lock-then-swap) reorder', () => {
  const REORDER_CTX = { params: Promise.resolve({ id: 'event-1', questionId: 'q-2' }) };

  it('viewer cannot reorder -> 403, no DB call', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'));
    const res = await reorderRoute.PATCH(req('http://localhost/x', 'PATCH', { direction: 'up' }), REORDER_CTX);
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a successful adjacent reorder swaps sort_order for exactly the target and its neighbor, via one sql.transaction([...]) call', async () => {
    queue([{ id: 'event-1' }], [{ id: 'q-2' }]); // loadOwnedEvent, existence check
    resolveTransaction([{ id: 'q-2', sort_order: 0 }, { id: 'q-1', sort_order: 1 }]);
    const res = await reorderRoute.PATCH(req('http://localhost/x', 'PATCH', { direction: 'up' }), REORDER_CTX);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions).toHaveLength(2);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    // Statement 1 (index 2): the whole-scope-group lock.
    const lockText = callText(2);
    expect(lockText).toMatch(/FOR UPDATE/i);
    expect(lockText).toMatch(/organisation_id/i);
    expect(lockText).toMatch(/event_id/i);
    expect(lockText).not.toMatch(/UPDATE event_registration_questions AS q/i);
    // Statement 2 (index 3): the neighbor computation + swap UPDATE,
    // re-scoped to organisation_id/event_id independently of statement 1.
    const swapText = callText(3);
    expect(swapText).toMatch(/LAG\(/i);
    expect(swapText).toMatch(/LEAD\(/i);
    expect(swapText).toMatch(/UPDATE event_registration_questions AS q/i);
    expect(swapText).toMatch(/organisation_id/i);
    expect(swapText).toMatch(/event_id/i);
  });

  it('cross-tenant rejection — an event owned by another organisation is 404, no existence check or transaction ever runs', async () => {
    queue([]); // ownership lookup under org-a finds nothing
    const res = await reorderRoute.PATCH(req('http://localhost/x', 'PATCH', { direction: 'up' }), REORDER_CTX);
    expect(res.status).toBe(404);
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('cross-event rejection — a questionId that exists but not under this event/org is 404, no transaction ever runs', async () => {
    queue([{ id: 'event-1' }], []); // existence check scoped to event_id/organisation_id finds nothing
    const res = await reorderRoute.PATCH(req('http://localhost/x', 'PATCH', { direction: 'up' }), REORDER_CTX);
    expect(res.status).toBe(404);
    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('cross-scope mutation is structurally impossible — the lock statement resolves scope via a subquery against the target row, and the swap statement\'s neighbor search is filtered to that same scope', async () => {
    queue([{ id: 'event-1' }], [{ id: 'q-2' }]);
    resolveTransaction([{ id: 'q-2', sort_order: 0 }, { id: 'q-1', sort_order: 1 }]);
    await reorderRoute.PATCH(req('http://localhost/x', 'PATCH', { direction: 'up' }), REORDER_CTX);
    const lockText = callText(2);
    expect(lockText).toMatch(/scope\s*=\s*\(/i); // resolved via subquery, not a passed-in value
    const swapText = callText(3);
    expect(swapText).toMatch(/q\.scope = t\.scope/i);
  });

  it('no neighbor in that direction (already at the boundary) is a clean 400, not an error, and no rows are touched', async () => {
    queue([{ id: 'event-1' }], [{ id: 'q-2' }]);
    resolveTransaction([]); // swap statement's WHERE clause matched zero rows
    const res = await reorderRoute.PATCH(req('http://localhost/x', 'PATCH', { direction: 'up' }), REORDER_CTX);
    expect(res.status).toBe(400);
  });

  it('an UPDATE that somehow affects only one row is reported as an error, never as a fabricated success (structurally unreachable, defensive only)', async () => {
    queue([{ id: 'event-1' }], [{ id: 'q-2' }]);
    resolveTransaction([{ id: 'q-2', sort_order: 0 }]); // only 1 row, not 2
    const res = await reorderRoute.PATCH(req('http://localhost/x', 'PATCH', { direction: 'up' }), REORDER_CTX);
    expect(res.status).toBe(500);
  });

  it('a transaction failure (e.g. a lock-wait timeout) fails safely — 500, generic message, no SQL/internal detail leaked', async () => {
    queue([{ id: 'event-1' }], [{ id: 'q-2' }]);
    rejectTransaction(new Error('deadlock detected while waiting for ShareLock on relation "event_registration_questions"'));
    const res = await reorderRoute.PATCH(req('http://localhost/x', 'PATCH', { direction: 'up' }), REORDER_CTX);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/deadlock|ShareLock|relation/i);
  });

  it('an invalid direction value is rejected before the existence check or transaction (ownership is still checked first, matching this route\'s own established ordering)', async () => {
    queue([{ id: 'event-1' }]);
    const res = await reorderRoute.PATCH(req('http://localhost/x', 'PATCH', { direction: 'sideways' }), REORDER_CTX);
    expect(res.status).toBe(400);
    expect(sqlMock).toHaveBeenCalledTimes(1); // ownership check only
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('the route module exports no DELETE (matches every other question route\'s deactivate-not-delete discipline)', () => {
    expect((reorderRoute as Record<string, unknown>).DELETE).toBeUndefined();
  });
});

describe('No DELETE handler on the question routes (§4 — deactivate, never hard-delete)', () => {
  it('the [questionId] route module exports no DELETE function', () => {
    expect((questionIdRoute as Record<string, unknown>).DELETE).toBeUndefined()
  })

  it('the collection route module exports no DELETE function', () => {
    expect((questionsRoute as Record<string, unknown>).DELETE).toBeUndefined()
  })
})
