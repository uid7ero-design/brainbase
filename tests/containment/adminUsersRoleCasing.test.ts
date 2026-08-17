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

// users.id / organisations.id are Prisma `String @default(cuid())` — plain
// Postgres TEXT columns, not the native `uuid` type — but some rows (e.g.
// ones created via this route's own POST, which inserts
// `gen_random_uuid()::text`) hold UUID-*shaped* text values. Production hit
// exactly this: casting the incoming id to `::uuid` before comparing it
// against a TEXT column throws `operator does not exist: text = uuid`
// whenever the id happens to look like a UUID. Using a UUID-shaped id here
// (instead of the previous plain 'user-1') is what makes this class of bug
// reproducible in these tests.
const UUID_SHAPED_ID = '123e4567-e89b-12d3-a456-426614174000';

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

// A mocked `sql` never actually asks Postgres to resolve an operator, so it
// can't itself catch `text = uuid` — that's exactly why the previous test
// suite (which only ever asserted on mocked *return values*) missed this in
// production. This inspects the literal SQL text of every call instead: the
// tagged-template call arrives at the mock as [stringsArray, ...values], so
// callArgs[0] is the actual SQL source with each interpolation hole in
// place, independent of what value was substituted there.
function allQueryTextFromCalls(calls: unknown[][]): string {
  return calls.map(callArgs => (callArgs[0] as string[]).join('')).join('\n');
}

const superAdminSession = { userId: 'admin1', organisationId: 'bb-org', role: 'super_admin', name: 'James' };

// This reproduces the exact production report: Luke's row was created via
// this route (which historically stored `role` in whatever case the client
// sent) rather than app/actions/users.ts's createUser (which always
// .toUpperCase()s), so his DB row genuinely holds a mixed/legacy case —
// simulated here as 'VIEWER' arriving via GET.
const lukeRowUppercase = {
  id: UUID_SHAPED_ID, email: 'luke@example.com', name: 'Luke Doughty', role: 'VIEWER',
  organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString(),
  org_name: 'LD Tennis',
};

describe('GET /api/admin/users — role display normalisation', () => {
  beforeEach(() => { getSessionMock.mockReset(); sqlMock.mockReset(); });

  it('normalises a legacy-uppercase stored role to lowercase for the edit form', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock.mockResolvedValueOnce([lukeRowUppercase]);

    const res = await GET();
    const data = await res.json();
    expect(data.users[0].role).toBe('viewer');
  });
});

describe('PATCH /api/admin/users — role casing, validation, and id/schema type contract', () => {
  beforeEach(() => { getSessionMock.mockReset(); sqlMock.mockReset(); });

  it('rejects a non-super_admin caller', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Not James' });
    const res = await PATCH(patchRequest({ role: 'manager' }));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('updates viewer -> manager for a UUID-shaped id against the actual TEXT id/organisation_id schema, using the exact lowercase value the real UI sends', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce([{ name: 'Luke Doughty', role: 'VIEWER', organisation_id: 'ld-tennis-org', email: 'luke@example.com', password_hash: 'hash' }])
      .mockResolvedValueOnce([{ id: UUID_SHAPED_ID, email: 'luke@example.com', name: 'Luke Doughty', role: 'manager', organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{ name: 'LD Tennis' }]);

    const res = await PATCH(patchRequest({ name: 'Luke Doughty', role: 'manager', organisationId: 'ld-tennis-org', email: 'luke@example.com' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.role).toBe('manager');

    // The UPDATE call must receive the canonical lowercase form, not the
    // legacy uppercase value that was previously in the DB.
    const updateCallArgs = sqlMock.mock.calls[1];
    expect(updateCallArgs).toContain('manager');
    expect(updateCallArgs).not.toContain('MANAGER');

    // The production regression: no query issued by this request may cast
    // the id/organisation_id parameter to ::uuid — those columns are TEXT.
    const allSql = allQueryTextFromCalls(sqlMock.mock.calls);
    expect(allSql).not.toContain('::uuid');
  });

  it('still accepts the update if a case-variant role is submitted (defence in depth)', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce([{ name: 'Luke Doughty', role: 'VIEWER', organisation_id: 'ld-tennis-org', email: 'luke@example.com', password_hash: 'hash' }])
      .mockResolvedValueOnce([{ id: UUID_SHAPED_ID, email: 'luke@example.com', name: 'Luke Doughty', role: 'manager', organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{ name: 'LD Tennis' }]);

    const res = await PATCH(patchRequest({ role: 'Manager', organisationId: 'ld-tennis-org' }));
    expect(res.status).toBe(200);
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

    const res = await PATCH(patchRequest({ role: 'manager', organisationId: 'ld-tennis-org' }));
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

    const res = await PATCH(patchRequest({ role: 'manager' }, 'does-not-exist'));
    expect(res.status).toBe(404);

    const allSql = allQueryTextFromCalls(sqlMock.mock.calls);
    expect(allSql).not.toContain('::uuid');
  });

  it('organisation assignment is unaffected by the id/cast fix: omitting organisationId keeps the existing organisation', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce([{ name: 'Luke Doughty', role: 'manager', organisation_id: 'ld-tennis-org', email: 'luke@example.com', password_hash: 'hash' }])
      .mockResolvedValueOnce([{ id: UUID_SHAPED_ID, email: 'luke@example.com', name: 'Luke Doughty', role: 'manager', organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{ name: 'LD Tennis' }]);

    const res = await PATCH(patchRequest({ name: 'Luke Doughty' })); // no organisationId in body
    expect(res.status).toBe(200);

    const updateCallArgs = sqlMock.mock.calls[1];
    expect(updateCallArgs).toContain('ld-tennis-org'); // fell back to current.organisation_id
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

describe('POST /api/admin/users — role casing on creation (unaffected by this fix)', () => {
  beforeEach(() => { getSessionMock.mockReset(); sqlMock.mockReset(); });

  it('still rejects an invalid role on create', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    const res = await POST(postRequest({ username: 'newcoach', password: 'longenoughpw', name: 'New Coach', role: 'owner', organisationId: 'ld-tennis-org' }));
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('stores a normalised lowercase role even if a mixed-case value is submitted', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock.mockResolvedValueOnce([{ id: 'new-id', email: 'newcoach@example.com', name: 'New Coach', role: 'manager', organisation_id: 'ld-tennis-org', email_verified: false, created_at: new Date().toISOString() }]);

    const res = await POST(postRequest({ username: 'newcoach', password: 'longenoughpw', name: 'New Coach', role: 'MANAGER', organisationId: 'ld-tennis-org' }));
    expect(res.status).toBe(201);

    const insertCallArgs = sqlMock.mock.calls[0];
    expect(insertCallArgs).toContain('manager');
    expect(insertCallArgs).not.toContain('MANAGER');
  });

  it('generates the new user id as text (gen_random_uuid()::text), matching the TEXT id column — not a bare ::uuid value', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock.mockResolvedValueOnce([{ id: 'new-id', email: 'newcoach@example.com', name: 'New Coach', role: 'manager', organisation_id: 'ld-tennis-org', email_verified: false, created_at: new Date().toISOString() }]);

    await POST(postRequest({ username: 'newcoach', password: 'longenoughpw', name: 'New Coach', role: 'manager', organisationId: 'ld-tennis-org' }));

    const insertSql = (sqlMock.mock.calls[0][0] as string[]).join('');
    expect(insertSql).toContain('gen_random_uuid()::text');
    expect(insertSql).not.toContain('::uuid');
  });
});
