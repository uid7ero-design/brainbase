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

const { GET, PATCH, POST } = await import('@/app/api/admin/users/route');

function patchRequest(body: unknown, id = 'user-1'): { req: NextRequest; url: string } {
  return {
    req: asNextRequest(new Request(`http://localhost/api/admin/users?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })),
    url: `http://localhost/api/admin/users?id=${id}`,
  };
}

function postRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

const superAdminSession = { userId: 'admin1', organisationId: 'bb-org', role: 'super_admin', name: 'James' };

// This reproduces the exact production report: Luke's row was created via
// this route (which historically stored `role` in whatever case the client
// sent) rather than app/actions/users.ts's createUser (which always
// .toUpperCase()s), so his DB row genuinely holds a mixed/legacy case —
// simulated here as 'VIEWER' arriving via GET.
const lukeRowUppercase = {
  id: 'luke-id', email: 'luke@example.com', name: 'Luke Doughty', role: 'VIEWER',
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

describe('PATCH /api/admin/users — role casing and validation', () => {
  beforeEach(() => { getSessionMock.mockReset(); sqlMock.mockReset(); });

  it('rejects a non-super_admin caller', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Not James' });
    const { req } = patchRequest({ role: 'manager' });
    const res = await PATCH(req);
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('updates viewer -> manager using the exact lowercase value the real UI sends', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce([{ name: 'Luke Doughty', role: 'VIEWER', organisation_id: 'ld-tennis-org', email: 'luke@example.com', password_hash: 'hash' }])
      .mockResolvedValueOnce([{ id: 'luke-id', email: 'luke@example.com', name: 'Luke Doughty', role: 'manager', organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{ name: 'LD Tennis' }]);

    const { req } = patchRequest({ name: 'Luke Doughty', role: 'manager', organisationId: 'ld-tennis-org', email: 'luke@example.com' });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.role).toBe('manager');

    // The UPDATE call must receive the canonical lowercase form, not the
    // legacy uppercase value that was previously in the DB.
    const updateCallArgs = sqlMock.mock.calls[1];
    expect(updateCallArgs).toContain('manager');
    expect(updateCallArgs).not.toContain('MANAGER');
  });

  it('still accepts the update if a case-variant role is submitted (defence in depth)', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock
      .mockResolvedValueOnce([{ name: 'Luke Doughty', role: 'VIEWER', organisation_id: 'ld-tennis-org', email: 'luke@example.com', password_hash: 'hash' }])
      .mockResolvedValueOnce([{ id: 'luke-id', email: 'luke@example.com', name: 'Luke Doughty', role: 'manager', organisation_id: 'ld-tennis-org', email_verified: true, created_at: new Date().toISOString() }])
      .mockResolvedValueOnce([{ name: 'LD Tennis' }]);

    const { req } = patchRequest({ role: 'Manager', organisationId: 'ld-tennis-org' });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
  });

  it('still rejects a genuinely invalid role', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    const { req } = patchRequest({ role: 'owner' });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('role must be one of');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns a JSON error (not an uncaught throw) if the DB update fails', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    sqlMock.mockRejectedValueOnce(new Error('connection lost'));

    const { req } = patchRequest({ role: 'manager', organisationId: 'ld-tennis-org' });
    const res = await PATCH(req);
    expect(res.status).toBe(500);
    // Must be parseable JSON — this is what previously surfaced to the
    // client as "Unexpected end of JSON input" when the handler threw
    // without a surrounding try/catch.
    const data = await res.json();
    expect(data.error).toBeTruthy();
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
});
