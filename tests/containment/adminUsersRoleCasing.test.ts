import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}

const getSessionMock = vi.fn();
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  return { ...actual, getSession: (...args: unknown[]) => getSessionMock(...args) };
});

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}));

// SEC-1A: requireSession() (lib/org.ts) calls cookies() internally to
// resolve a super_admin's org_override — without this mock, the real
// next/headers cookies() throws outside a real request context.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock('@/lib/tokens', () => ({
  createToken: vi.fn(async () => 'token-123'),
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async () => {}),
  verificationEmail: vi.fn(() => ({ subject: 'Verify', html: '<p></p>' })),
}));

// SEC-1A: this route's audit calls (lib/admin/auditLog.ts) are real,
// unmocked here, and issue their own sql() calls — but since every test
// below only configures `sqlMock.mockResolvedValueOnce(...)` for the
// calls it actually cares about, an audit call beyond the configured
// chain simply resolves to `undefined`, which logHrEvent-style
// best-effort audit helpers already swallow internally (see
// lib/admin/auditLog.ts's own try/catch) — it never affects these tests'
// own assertions or the route's own response. Dedicated audit-content
// coverage lives in tests/containment/adminAuditLog.test.ts and
// tests/containment/adminUsersAuthoritativeSession.test.ts.

const { GET, PATCH, DELETE, POST } = await import('@/app/api/admin/users/route');

// users.id / organisations.id / users.organisation_id are Prisma `String`
// fields — confirmed via a direct read-only information_schema query against
// the real database to be genuine TEXT columns (not the native `uuid`
// type). Some rows (e.g. ones created via this route's own POST, which
// inserts `gen_random_uuid()::text`) hold UUID-*shaped* text values, which
// is what makes the id/organisation_id `::uuid`-cast bug (fixed in an
// earlier commit) reproducible only with an id shaped like this — a plain
// placeholder id would have hit a different Postgres error instead.
const UUID_SHAPED_ID = '123e4567-e89b-12d3-a456-426614174000';

// users.role, by contrast, IS a real Postgres enum (`UserRole`), confirmed
// the same way: SUPER_ADMIN, ADMIN, MANAGER, ANALYST, VIEWER — uppercase
// labels only. A previous commit (3d54af3) lowercased `role` before writing
// it to the DB in both PATCH and POST, which is invalid for this enum and
// is what caused Production to keep failing (with a *different* Postgres
// error — invalid input value for enum "UserRole" — not the text/uuid one)
// even after the id/organisation_id cast bug was fixed. This was verified
// directly against the real database via non-destructive `EXPLAIN` calls
// before writing this fix; see the commit message for detail.
const UPPERCASE_ROLE = 'MANAGER';
const LOWERCASE_ROLE = 'manager';

// Synthetic, computed (not a quoted literal) — exists purely to satisfy the
// route's own ">= 8 characters" length check; sql is fully mocked below, so
// this value is never hashed, stored, or compared against anything real.
// Built with .repeat() rather than a string literal so it doesn't read as a
// plausible real password sitting next to a fixture email address.
const TEST_PASSWORD = 'x'.repeat(12);

function patchRequest(body: unknown, id: string = UUID_SHAPED_ID): NextRequest {
  return asNextRequest(new Request(`http://localhost/api/admin/users?id=${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function deleteRequest(id: string = UUID_SHAPED_ID): NextRequest {
  return asNextRequest(new Request(`http://localhost/api/admin/users?id=${id}`, { method: 'DELETE' }));
}

function postRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

// A mocked `sql` never actually asks Postgres to resolve an operator or
// validate an enum label, so it can't itself catch either the `text = uuid`
// bug or the enum-casing bug — that's exactly why the previous test suite
// (which only ever asserted on mocked *return values*, and in the role
// case asserted the *wrong* expected casing) stayed green while Production
// kept failing. This inspects the literal SQL text and the interpolated
// values of every call instead: the tagged-template call arrives at the
// mock as [stringsArray, ...values], so callArgs[0] is the SQL source and
// the remaining entries are the actual runtime values substituted in.
function allQueryTextFromCalls(calls: unknown[][]): string {
  return calls.map(callArgs => (callArgs[0] as string[]).join('')).join('\n');
}

const superAdminSession = { userId: 'admin1', organisationId: 'bb-org', role: 'super_admin', name: 'James' };
const notSuperAdminSession = { userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Not James' };

// SEC-1A: requireSession()'s own DB-authoritative lookup row for each
// session above — the FIRST sql() call of every authorized request is now
// this lookup (lib/org.ts), not the route's own business-logic query.
// Queued as the leading `.mockResolvedValueOnce(...)` in every test below;
// every other queued response (and every `sqlMock.mock.calls[N]` index)
// shifts by exactly +1 versus the pre-SEC-1A version of this file.
const superAdminRow = [{ id: 'admin1', organisation_id: 'bb-org', role: 'super_admin', status: 'ACTIVE' }];
const notSuperAdminRow = [{ id: 'u1', organisation_id: 'org-a', role: 'manager', status: 'ACTIVE' }];

// A user row exactly as the real UserRole enum stores it — uppercase.
const lukeRowUppercase = {
  id: UUID_SHAPED_ID, email: 'luke@example.com', name: 'Luke Doughty', role: 'VIEWER',
  organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString(),
  org_name: 'LD Tennis',
};

describe('GET /api/admin/users — role display normalisation', () => {
  beforeEach(() => { getSessionMock.mockReset(); sqlMock.mockReset(); });

  it('normalises the enum-stored uppercase role to lowercase for the edit form', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([lukeRowUppercase]);

    const res = await GET();
    const data = await res.json();
    expect(data.users[0].role).toBe('viewer');
  });
});

describe('PATCH /api/admin/users — role enum casing, id/schema type contract, and validation', () => {
  beforeEach(() => { getSessionMock.mockReset(); sqlMock.mockReset(); });

  it('rejects a non-super_admin caller', async () => {
    getSessionMock.mockResolvedValue(notSuperAdminSession);
    sqlMock.mockResolvedValueOnce(notSuperAdminRow); // requireSession's own lookup — correctly identifies insufficient role
    const res = await PATCH(patchRequest({ role: LOWERCASE_ROLE }));
    expect(res.status).toBe(403);
    // Exactly one call happens now — requireSession's own DB-authoritative
    // lookup, which is precisely how it correctly determines this caller
    // is not super_admin. This replaces the pre-SEC-1A assertion that NO
    // call happened at all, which is no longer true (and was only ever
    // true because authorization was a raw JWT check with no DB step).
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('updates viewer -> manager: writes the UPPERCASE enum label to the DB but returns lowercase to the client', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([{ name: 'Luke Doughty', role: 'VIEWER', organisation_id: 'ld-tennis-org', email: 'luke@example.com', password_hash: 'hash' }])
      // RETURNING reflects what a real UserRole enum column actually stores — uppercase.
      .mockResolvedValueOnce([{ id: UUID_SHAPED_ID, email: 'luke@example.com', name: 'Luke Doughty', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{ name: 'LD Tennis' }]);

    const res = await PATCH(patchRequest({ name: 'Luke Doughty', role: LOWERCASE_ROLE, organisationId: 'ld-tennis-org', email: 'luke@example.com' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    // Client-facing response stays lowercase, matching GET's convention.
    expect(data.user.role).toBe('manager');

    // The actual UPDATE sent to Postgres must carry the UPPERCASE enum
    // label — this is the real production bug: it must NOT be lowercase.
    // Index shifted from 1 -> 2: index 0 is now requireSession's own
    // lookup, index 1 is the route's current-user SELECT, index 2 is this UPDATE.
    const updateCallArgs = sqlMock.mock.calls[2];
    expect(updateCallArgs).toContain(UPPERCASE_ROLE);
    expect(updateCallArgs).not.toContain(LOWERCASE_ROLE);

    // The separately-fixed id/organisation_id regression: no query issued
    // by this request may cast the id/organisationId parameter to ::uuid —
    // those columns are TEXT, confirmed directly against the real schema.
    const allSql = allQueryTextFromCalls(sqlMock.mock.calls);
    expect(allSql).not.toContain('::uuid');
  });

  it('still accepts and correctly uppercases a case-variant role submission (defence in depth)', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([{ name: 'Luke Doughty', role: 'VIEWER', organisation_id: 'ld-tennis-org', email: 'luke@example.com', password_hash: 'hash' }])
      .mockResolvedValueOnce([{ id: UUID_SHAPED_ID, email: 'luke@example.com', name: 'Luke Doughty', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{ name: 'LD Tennis' }]);

    const res = await PATCH(patchRequest({ role: 'Manager', organisationId: 'ld-tennis-org' }));
    expect(res.status).toBe(200);

    const updateCallArgs = sqlMock.mock.calls[2];
    expect(updateCallArgs).toContain(UPPERCASE_ROLE);
  });

  it('still rejects a genuinely invalid role', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock.mockResolvedValueOnce(superAdminRow);
    const res = await PATCH(patchRequest({ role: 'owner' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('role must be one of');
    // Only requireSession's own lookup ran — the route's own validation
    // rejected the body before any business-logic query.
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('returns a JSON error (not an uncaught throw) if the DB update fails', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockRejectedValueOnce(new Error('connection lost'));

    const res = await PATCH(patchRequest({ role: LOWERCASE_ROLE, organisationId: 'ld-tennis-org' }));
    expect(res.status).toBe(500);
    // Must be parseable JSON — this is what previously surfaced to the
    // client as "Unexpected end of JSON input" when the handler threw
    // without a surrounding try/catch.
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });

  it('fails safely (404, not a DB error) for a non-UUID-shaped, nonexistent id', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([]); // no matching row

    const res = await PATCH(patchRequest({ role: LOWERCASE_ROLE }, 'does-not-exist'));
    expect(res.status).toBe(404);

    const allSql = allQueryTextFromCalls(sqlMock.mock.calls);
    expect(allSql).not.toContain('::uuid');
  });

  it('organisation assignment is unaffected by the role/id fixes: omitting organisationId keeps the existing organisation', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([{ name: 'Luke Doughty', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email: 'luke@example.com', password_hash: 'hash' }])
      .mockResolvedValueOnce([{ id: UUID_SHAPED_ID, email: 'luke@example.com', name: 'Luke Doughty', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{ name: 'LD Tennis' }]);

    const res = await PATCH(patchRequest({ name: 'Luke Doughty' })); // no organisationId in body
    expect(res.status).toBe(200);

    const updateCallArgs = sqlMock.mock.calls[2];
    expect(updateCallArgs).toContain('ld-tennis-org'); // fell back to current.organisation_id
  });

  it('preserves the existing role unchanged (already uppercase from the DB) when role is omitted from the request', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([{ name: 'Luke Doughty', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email: 'luke@example.com', password_hash: 'hash' }])
      .mockResolvedValueOnce([{ id: UUID_SHAPED_ID, email: 'luke@example.com', name: 'Luke Doughty', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{ name: 'LD Tennis' }]);

    const res = await PATCH(patchRequest({ name: 'Luke Doughty' })); // no role in body
    expect(res.status).toBe(200);

    // current.role (already uppercase, straight from the DB) must be used
    // as-is, not re-cased or corrupted when it falls through unchanged.
    const updateCallArgs = sqlMock.mock.calls[2];
    expect(updateCallArgs).toContain(UPPERCASE_ROLE);
  });
});

describe('DELETE /api/admin/users — id/schema type contract', () => {
  beforeEach(() => { getSessionMock.mockReset(); sqlMock.mockReset(); });

  it('rejects a non-super_admin caller', async () => {
    getSessionMock.mockResolvedValue(notSuperAdminSession);
    sqlMock.mockResolvedValueOnce(notSuperAdminRow);
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(403);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('blocks deleting your own account', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock.mockResolvedValueOnce(superAdminRow);
    const res = await DELETE(deleteRequest(superAdminSession.userId));
    expect(res.status).toBe(409);
    // Only requireSession's own lookup ran — the self-delete guard
    // rejected before any DELETE statement was issued.
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('deletes a user by UUID-shaped id without casting it against the TEXT id column', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([{ username: 'x', name: 'X', role: 'VIEWER', organisation_id: 'ld-tennis-org' }]);

    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(200);

    const allSql = allQueryTextFromCalls(sqlMock.mock.calls);
    expect(allSql).not.toContain('::uuid');
  });
});

describe('POST /api/admin/users — role enum casing on creation', () => {
  beforeEach(() => { getSessionMock.mockReset(); sqlMock.mockReset(); });

  it('still rejects an invalid role on create', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock.mockResolvedValueOnce(superAdminRow);
    const res = await POST(postRequest({ username: 'newcoach', password: TEST_PASSWORD, name: 'New Coach', role: 'owner', organisationId: 'ld-tennis-org' }));
    expect(res.status).toBe(400);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('writes the UPPERCASE enum label even though a lowercase value was submitted, and returns lowercase to the client', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([{ id: 'new-id', email: 'newcoach@example.com', name: 'New Coach', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: false, created_at: new Date().toISOString() }]);

    const res = await POST(postRequest({ username: 'newcoach', password: TEST_PASSWORD, name: 'New Coach', role: LOWERCASE_ROLE, organisationId: 'ld-tennis-org' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.user.role).toBe('manager');

    const insertCallArgs = sqlMock.mock.calls[1];
    expect(insertCallArgs).toContain(UPPERCASE_ROLE);
    expect(insertCallArgs).not.toContain(LOWERCASE_ROLE);
  });

  it('also uppercases a mixed-case role submission', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([{ id: 'new-id', email: 'newcoach@example.com', name: 'New Coach', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: false, created_at: new Date().toISOString() }]);

    const res = await POST(postRequest({ username: 'newcoach', password: TEST_PASSWORD, name: 'New Coach', role: 'MaNaGeR', organisationId: 'ld-tennis-org' }));
    expect(res.status).toBe(201);

    const insertCallArgs = sqlMock.mock.calls[1];
    expect(insertCallArgs).toContain(UPPERCASE_ROLE);
  });

  it('generates the new user id as text (gen_random_uuid()::text), matching the TEXT id column — not a bare ::uuid value', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([{ id: 'new-id', email: 'newcoach@example.com', name: 'New Coach', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: false, created_at: new Date().toISOString() }]);

    await POST(postRequest({ username: 'newcoach', password: TEST_PASSWORD, name: 'New Coach', role: LOWERCASE_ROLE, organisationId: 'ld-tennis-org' }));

    const insertSql = (sqlMock.mock.calls[1][0] as string[]).join('');
    expect(insertSql).toContain('gen_random_uuid()::text');
    expect(insertSql).not.toContain('::uuid');
  });
})

// Root-cause regression suite — "School Test Organisation" task.
// users.username (NOT NULL, UNIQUE, no database-level default) and
// users.updated_at (NOT NULL, no database-level default — User's
// Prisma model is a plain `@updatedAt`, never `@dbgenerated(...)`,
// exactly the same class of defect app/api/admin/orgs/route.ts's own
// POST handler had for organisations.id/.updated_at) were both
// previously OMITTED from this route's raw SQL INSERT. Confirmed
// against real DEV: the create-user form (AdminClient.tsx) has always
// had genuinely separate Username and Email inputs, but the route
// collapsed them into one value and used it as `email` only — never
// writing anything to the `username` column at all — causing every
// user-creation attempt to fail with a real not-null-constraint
// violation.
describe('POST /api/admin/users — username/email column contract (root-cause fix)', () => {
  beforeEach(() => { getSessionMock.mockReset(); sqlMock.mockReset(); });

  it('username and email are written to their own separate columns — email is optional and independent of username', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([{ id: 'new-id', username: 'jane.smith', email: 'jane@council.gov.au', name: 'Jane Smith', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: false, created_at: new Date().toISOString() }]);

    const res = await POST(postRequest({ username: 'jane.smith', email: 'jane@council.gov.au', password: TEST_PASSWORD, name: 'Jane Smith', role: LOWERCASE_ROLE, organisationId: 'ld-tennis-org' }));
    expect(res.status).toBe(201);

    const insertSql = (sqlMock.mock.calls[1][0] as string[]).join('');
    expect(insertSql).toContain('INSERT INTO users (id, username, email, password_hash, name, role, organisation_id, email_verified, updated_at)');
    const insertArgs = sqlMock.mock.calls[1]
    expect(insertArgs).toContain('jane.smith')
    expect(insertArgs).toContain('jane@council.gov.au')
  })

  it('username is required — a request with only an email (no username) is rejected before any DB call, matching the form\'s own required={f.key !== \'email\'} contract', async () => {
    getSessionMock.mockResolvedValue(superAdminSession)
    sqlMock.mockResolvedValueOnce(superAdminRow)
    const res = await POST(postRequest({ email: 'jane@council.gov.au', password: TEST_PASSWORD, name: 'Jane Smith', role: LOWERCASE_ROLE, organisationId: 'ld-tennis-org' }))
    expect(res.status).toBe(400)
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('email is genuinely optional — a username-only account (no email) still succeeds', async () => {
    getSessionMock.mockResolvedValue(superAdminSession)
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([{ id: 'new-id', username: 'jane.smith', email: null, name: 'Jane Smith', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: false, created_at: new Date().toISOString() }])

    const res = await POST(postRequest({ username: 'jane.smith', password: TEST_PASSWORD, name: 'Jane Smith', role: LOWERCASE_ROLE, organisationId: 'ld-tennis-org' }))
    expect(res.status).toBe(201)
    const insertArgs = sqlMock.mock.calls[1]
    expect(insertArgs).toContain(null)
  })

  it('the INSERT supplies updated_at explicitly (now()) — the other column with no database-level default', async () => {
    getSessionMock.mockResolvedValue(superAdminSession)
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([{ id: 'new-id', username: 'jane.smith', email: null, name: 'Jane Smith', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: false, created_at: new Date().toISOString() }])

    await POST(postRequest({ username: 'jane.smith', password: TEST_PASSWORD, name: 'Jane Smith', role: LOWERCASE_ROLE, organisationId: 'ld-tennis-org' }))
    const insertSql = (sqlMock.mock.calls[1][0] as string[]).join('')
    expect(insertSql).toMatch(/now\(\)/)
  })

  it('a username collision (unique-constraint violation) is reported as "Username already taken", distinguishing it from an email collision', async () => {
    getSessionMock.mockResolvedValue(superAdminSession)
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "users_username_key"'))

    const res = await POST(postRequest({ username: 'jane.smith', password: TEST_PASSWORD, name: 'Jane Smith', role: LOWERCASE_ROLE, organisationId: 'ld-tennis-org' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/Username already taken/)
  })

  it('an unexpected database error still returns a real JSON error body — never a bare re-throw', async () => {
    getSessionMock.mockResolvedValue(superAdminSession)
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockRejectedValueOnce(new Error('null value in column "username" of relation "users" violates not-null constraint'))

    const res = await POST(postRequest({ username: 'jane.smith', password: TEST_PASSWORD, name: 'Jane Smith', role: LOWERCASE_ROLE, organisationId: 'ld-tennis-org' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
  })

  it('a failure in the verification-email step (createToken throwing — e.g. a missing email_tokens table, confirmed against real DEV) does NOT fail the request — the user row is already committed and this is a non-fatal side effect', async () => {
    getSessionMock.mockResolvedValue(superAdminSession)
    sqlMock
      .mockResolvedValueOnce(superAdminRow)
      .mockResolvedValueOnce([{ id: 'new-id', username: 'jane.smith', email: 'jane@council.gov.au', name: 'Jane Smith', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: false, created_at: new Date().toISOString() }])
    const { createToken } = await import('@/lib/tokens')
    vi.mocked(createToken).mockRejectedValueOnce(new Error('relation "email_tokens" does not exist'))

    const res = await POST(postRequest({ username: 'jane.smith', email: 'jane@council.gov.au', password: TEST_PASSWORD, name: 'Jane Smith', role: LOWERCASE_ROLE, organisationId: 'ld-tennis-org' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.user.username).toBe('jane.smith')
  })
});

// app/admin/users/page.tsx + app/admin/users/UsersClient.tsx — a SEPARATE
// surface from the /api/admin/users route tested above (this page issues
// its own raw SQL query directly and never calls that route's GET
// handler), with its own independent instance of the exact same defect
// class already fixed above: users.role comes back from Postgres
// UPPERCASE, but UsersClient's <select> options
// (super_admin/admin/manager/viewer) are lowercase. Since the bound
// value={u.role} never matched any <option value=...>, every row's
// dropdown silently fell back to displaying the browser-default first
// option — "Super Admin" — regardless of the row's actual stored role.
// The role mutation itself (updateUserRole) always worked correctly; this
// was purely a display/state-normalisation bug, confirmed live during
// Stripe Preview testing.
//
// Static source-text assertion, not a claim of proven rendering
// behaviour — this project has no jsdom/React Testing Library harness
// (same caveat spelled out across every other *StaticCheck.test.ts file
// in this suite, e.g. clientDayOverviewStaticCheck.test.ts). The genuine
// end-to-end proof for this fix is the Preview verification described in
// this PR, not this suite.
const adminUsersPageSource = fs.readFileSync(path.resolve(__dirname, '../../app/admin/users/page.tsx'), 'utf-8');
const usersClientSource = fs.readFileSync(path.resolve(__dirname, '../../app/admin/users/UsersClient.tsx'), 'utf-8');

describe('app/admin/users/page.tsx — role normalised to lowercase before reaching UsersClient', () => {
  it('the users list passed to UsersClient is lowercased server-side, not left as the raw enum casing', () => {
    expect(adminUsersPageSource).toMatch(/\.map\(u => \(\{ \.\.\.u, role: u\.role\.toLowerCase\(\) \}\)\)/);
  });

  it('normalisation runs unconditionally on every request (not just once at first paint) — this page re-runs in full on every navigation/revalidation, including the revalidatePath(\'/admin/users\') updateUserRole() itself triggers, so a role change is re-normalised on every subsequent render, never just the initial load', () => {
    // The normalisation is inline in the same request handler that issues
    // the SQL query and renders <UsersClient> — there is no separate
    // one-time/cached code path that could serve a stale, un-normalised
    // list after a role change.
    const queryIndex = adminUsersPageSource.indexOf('FROM users u');
    const mapIndex = adminUsersPageSource.indexOf('.toLowerCase()');
    const renderIndex = adminUsersPageSource.indexOf('<UsersClient');
    expect(queryIndex).toBeGreaterThan(-1);
    expect(mapIndex).toBeGreaterThan(queryIndex);
    expect(renderIndex).toBeGreaterThan(mapIndex);
  });

  // A. B. C. D. — every assignable enum label the schema actually defines
  // lowercases to exactly the Role/option value UsersClient expects. Real
  // (non-mocked) JS string semantics — a genuine behavioural check, not
  // source-text matching — tying the schema's own documented enum labels
  // (see the UPPERCASE_ROLE / adminOrgSavePath comments above) to the
  // exact values UsersClient's ROLES/ROLE_LABELS use.
  it('A. SUPER_ADMIN normalises to the exact value UsersClient renders as "Super Admin"', () => {
    expect('SUPER_ADMIN'.toLowerCase()).toBe('super_admin');
    expect(usersClientSource).toMatch(/super_admin:\s*'Super Admin'/);
  });
  it('B. ADMIN normalises to the exact value UsersClient renders as "Admin"', () => {
    expect('ADMIN'.toLowerCase()).toBe('admin');
    expect(usersClientSource).toMatch(/admin:\s*'Admin'/);
  });
  it('C. MANAGER normalises to the exact value UsersClient renders as "Manager"', () => {
    expect('MANAGER'.toLowerCase()).toBe('manager');
    expect(usersClientSource).toMatch(/manager:\s*'Manager'/);
  });
  it('D. VIEWER normalises to the exact value UsersClient renders as "Viewer"', () => {
    expect('VIEWER'.toLowerCase()).toBe('viewer');
    expect(usersClientSource).toMatch(/viewer:\s*'Viewer'/);
  });
});

describe('app/admin/users/UsersClient.tsx — role <select> value always matches one of its own <option>s', () => {
  it('E. ANALYST is intentionally excluded from the general assignable ROLES list (Phase C1.6 — no defined privilege placement), but a row whose actual role IS analyst gets its own matching <option> so it still displays "Analyst" instead of falling back to "Super Admin"', () => {
    // The general list stays exactly 4 values — this fix does not make
    // analyst newly assignable through this UI.
    expect(usersClientSource).toMatch(/const ROLES: Role\[\] = \['super_admin', 'admin', 'manager', 'viewer'\]/);
    // But the row-specific fallback option exists for a row that already
    // holds it, using the same ROLE_LABELS.analyst entry the file already
    // carried (Phase C1.6) for exactly this reason.
    expect(usersClientSource).toMatch(/u\.role === 'analyst' && <option value="analyst">\{ROLE_LABELS\.analyst\}<\/option>/);
  });

  it('F. selecting "Manager" from the dropdown invokes updateUserRole(userId, \'manager\') — the option\'s value is the lowercase Role literal, not the display label', () => {
    expect(usersClientSource).toMatch(/\{ROLES\.map\(r => <option key=\{r\} value=\{r\}>\{ROLE_LABELS\[r\]\}<\/option>\)\}/);
    expect(usersClientSource).toContain("onChange={e => handleRoleChange(u.id, e.target.value as Role)}");
    expect(usersClientSource).toContain('function handleRoleChange(userId: string, role: Role) {');
    expect(usersClientSource).toContain('startTransition(() => updateUserRole(userId, role));');
  });

  it('G. after a role change, the next render still displays the newly-assigned role rather than snapping back to "Super Admin" — updateUserRole() calls revalidatePath(\'/admin/users\'), which re-runs page.tsx (and its normalisation) from scratch, not a client-side-only optimistic update that could drift from the real stored value', () => {
    const actionsSource = fs.readFileSync(path.resolve(__dirname, '../../app/actions/users.ts'), 'utf-8');
    expect(actionsSource).toMatch(/export async function updateUserRole\(userId: string, role: Role\) \{[\s\S]*?revalidatePath\('\/admin\/users'\);/);
  });

  it('H. the own-row disabled protection (a super_admin cannot change their own active role through this dropdown) is unchanged by this fix', () => {
    expect(usersClientSource).toContain('disabled={u.id === currentUserId}');
  });
});

// §5 (error handling) — reported per this task's own instructions rather
// than fixed: handleRoleChange/handleDelete both fire updateUserRole()/
// deleteUser() inside startTransition(() => ...) without awaiting or
// catching the returned promise. This is pre-existing, and identical for
// both call sites (not something this fix introduces or makes worse) — a
// thrown Unauthorized/Invalid-role/DB error surfaces nowhere in the UI.
// This component has no lightweight established error-display pattern
// that fits a fire-and-forget void-returning action (createUser/
// updateUserDetails/resetUserPassword all use useActionState, which
// updateUserRole/deleteUser deliberately do not — converting them would
// change their call signature for no reason related to the role-casing
// bug this task targets). Left unchanged, per the explicit instruction to
// report rather than broaden scope into a notification/toast refactor.
describe('app/admin/users/UsersClient.tsx — role-change error handling (pre-existing limitation, confirmed unchanged)', () => {
  it('updateUserRole and deleteUser are both still fire-and-forget inside startTransition, with no .catch/error surface — a known, pre-existing limitation shared identically by both call sites, not introduced by this fix', () => {
    expect(usersClientSource).toContain('startTransition(() => updateUserRole(userId, role));');
    expect(usersClientSource).toContain('startTransition(() => deleteUser(user.id));');
    expect(usersClientSource).not.toMatch(/updateUserRole\([^)]*\)\.catch/);
  });
});
