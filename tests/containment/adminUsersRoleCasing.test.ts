import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

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

vi.mock('@/lib/tokens', () => ({
  createToken: vi.fn(async () => 'token-123'),
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async () => {}),
  verificationEmail: vi.fn(() => ({ subject: 'Verify', html: '<p></p>' })),
}));

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
    sqlMock.mockResolvedValueOnce([lukeRowUppercase]);

    const res = await GET();
    const data = await res.json();
    expect(data.users[0].role).toBe('viewer');
  });
});

describe('PATCH /api/admin/users — role enum casing, id/schema type contract, and validation', () => {
  beforeEach(() => { getSessionMock.mockReset(); sqlMock.mockReset(); });

  it('rejects a non-super_admin caller', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Not James' });
    const res = await PATCH(patchRequest({ role: LOWERCASE_ROLE }));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('updates viewer -> manager: writes the UPPERCASE enum label to the DB but returns lowercase to the client', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
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
    const updateCallArgs = sqlMock.mock.calls[1];
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
      .mockResolvedValueOnce([{ name: 'Luke Doughty', role: 'VIEWER', organisation_id: 'ld-tennis-org', email: 'luke@example.com', password_hash: 'hash' }])
      .mockResolvedValueOnce([{ id: UUID_SHAPED_ID, email: 'luke@example.com', name: 'Luke Doughty', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{ name: 'LD Tennis' }]);

    const res = await PATCH(patchRequest({ role: 'Manager', organisationId: 'ld-tennis-org' }));
    expect(res.status).toBe(200);

    const updateCallArgs = sqlMock.mock.calls[1];
    expect(updateCallArgs).toContain(UPPERCASE_ROLE);
  });

  it('still rejects a genuinely invalid role', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    const res = await PATCH(patchRequest({ role: 'owner' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('role must be one of');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns a JSON error (not an uncaught throw) if the DB update fails', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock.mockRejectedValueOnce(new Error('connection lost'));

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
    sqlMock.mockResolvedValueOnce([]); // no matching row

    const res = await PATCH(patchRequest({ role: LOWERCASE_ROLE }, 'does-not-exist'));
    expect(res.status).toBe(404);

    const allSql = allQueryTextFromCalls(sqlMock.mock.calls);
    expect(allSql).not.toContain('::uuid');
  });

  it('organisation assignment is unaffected by the role/id fixes: omitting organisationId keeps the existing organisation', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce([{ name: 'Luke Doughty', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email: 'luke@example.com', password_hash: 'hash' }])
      .mockResolvedValueOnce([{ id: UUID_SHAPED_ID, email: 'luke@example.com', name: 'Luke Doughty', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{ name: 'LD Tennis' }]);

    const res = await PATCH(patchRequest({ name: 'Luke Doughty' })); // no organisationId in body
    expect(res.status).toBe(200);

    const updateCallArgs = sqlMock.mock.calls[1];
    expect(updateCallArgs).toContain('ld-tennis-org'); // fell back to current.organisation_id
  });

  it('preserves the existing role unchanged (already uppercase from the DB) when role is omitted from the request', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce([{ name: 'Luke Doughty', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email: 'luke@example.com', password_hash: 'hash' }])
      .mockResolvedValueOnce([{ id: UUID_SHAPED_ID, email: 'luke@example.com', name: 'Luke Doughty', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{ name: 'LD Tennis' }]);

    const res = await PATCH(patchRequest({ name: 'Luke Doughty' })); // no role in body
    expect(res.status).toBe(200);

    // current.role (already uppercase, straight from the DB) must be used
    // as-is, not re-cased or corrupted when it falls through unchanged.
    const updateCallArgs = sqlMock.mock.calls[1];
    expect(updateCallArgs).toContain(UPPERCASE_ROLE);
  });
});

describe('DELETE /api/admin/users — id/schema type contract', () => {
  beforeEach(() => { getSessionMock.mockReset(); sqlMock.mockReset(); });

  it('rejects a non-super_admin caller', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Not James' });
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('blocks deleting your own account', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    const res = await DELETE(deleteRequest(superAdminSession.userId));
    expect(res.status).toBe(409);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('deletes a user by UUID-shaped id without casting it against the TEXT id column', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock.mockResolvedValueOnce([]);

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
    const res = await POST(postRequest({ username: 'newcoach', password: 'longenoughpw', name: 'New Coach', role: 'owner', organisationId: 'ld-tennis-org' }));
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('writes the UPPERCASE enum label even though a lowercase value was submitted, and returns lowercase to the client', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock.mockResolvedValueOnce([{ id: 'new-id', email: 'newcoach@example.com', name: 'New Coach', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: false, created_at: new Date().toISOString() }]);

    const res = await POST(postRequest({ username: 'newcoach', password: 'longenoughpw', name: 'New Coach', role: LOWERCASE_ROLE, organisationId: 'ld-tennis-org' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.user.role).toBe('manager');

    const insertCallArgs = sqlMock.mock.calls[0];
    expect(insertCallArgs).toContain(UPPERCASE_ROLE);
    expect(insertCallArgs).not.toContain(LOWERCASE_ROLE);
  });

  it('also uppercases a mixed-case role submission', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock.mockResolvedValueOnce([{ id: 'new-id', email: 'newcoach@example.com', name: 'New Coach', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: false, created_at: new Date().toISOString() }]);

    const res = await POST(postRequest({ username: 'newcoach', password: 'longenoughpw', name: 'New Coach', role: 'MaNaGeR', organisationId: 'ld-tennis-org' }));
    expect(res.status).toBe(201);

    const insertCallArgs = sqlMock.mock.calls[0];
    expect(insertCallArgs).toContain(UPPERCASE_ROLE);
  });

  it('generates the new user id as text (gen_random_uuid()::text), matching the TEXT id column — not a bare ::uuid value', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock.mockResolvedValueOnce([{ id: 'new-id', email: 'newcoach@example.com', name: 'New Coach', role: UPPERCASE_ROLE, organisation_id: 'ld-tennis-org', email_verified: false, created_at: new Date().toISOString() }]);

    await POST(postRequest({ username: 'newcoach', password: 'longenoughpw', name: 'New Coach', role: LOWERCASE_ROLE, organisationId: 'ld-tennis-org' }));

    const insertSql = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(insertSql).toContain('gen_random_uuid()::text');
    expect(insertSql).not.toContain('::uuid');
  });
});
