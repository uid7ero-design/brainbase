import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';

// SEC-1A — behavioral regression coverage for app/api/admin/users/
// route.ts. Previously this route authorized every method via raw
// getSession() plus a manual `session.role?.toLowerCase() !==
// 'super_admin'` string comparison. This suite proves every method now
// goes through the REAL requireRole()/requireSession() chain (lib/org.ts,
// unmocked) — only their own dependencies and the audit module are
// mocked.

const getSessionMock = vi.fn();
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  return { ...actual, getSession: (...args: unknown[]) => getSessionMock(...args) };
});

let responseQueue: unknown[][] = [];
let callCount = 0;
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []));
vi.mock('@/lib/db', () => ({ default: sqlMock }));

// requireSession() (lib/org.ts) calls cookies() internally to resolve a
// super_admin's org_override — without this mock, the real next/headers
// cookies() throws outside a real request context, which the route's own
// `catch { return forbidden(); }` swallows into an indistinguishable 403,
// masking every other test behind a false "unauthorized" result.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(async () => 'hashed-password-value') } }));
vi.mock('@/lib/tokens', () => ({ createToken: vi.fn(async () => 'token-123') }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => {}), verificationEmail: vi.fn(() => ({ subject: 's', html: 'h' })) }));

const logUserCreatedMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const logUserUpdatedMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const logUserRoleChangedMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const logUserOrganisationChangedMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const logUserDeletedMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock('@/lib/admin/auditLog', () => ({
  logUserCreated: (...args: unknown[]) => logUserCreatedMock(...args),
  logUserUpdated: (...args: unknown[]) => logUserUpdatedMock(...args),
  logUserRoleChanged: (...args: unknown[]) => logUserRoleChangedMock(...args),
  logUserOrganisationChanged: (...args: unknown[]) => logUserOrganisationChangedMock(...args),
  logUserDeleted: (...args: unknown[]) => logUserDeletedMock(...args),
}));

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0; }

function makeRequest(url: string, method: string, body?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9', 'user-agent': 'test-agent/1.0' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

const { GET, PATCH, DELETE, POST } = await import('@/app/api/admin/users/route');

const activeSuperAdminSession = { userId: 'founder-1', organisationId: 'brainbase-org', role: 'super_admin', name: 'Founder' };
const activeSuperAdminRow = { id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin', status: 'ACTIVE' };

beforeEach(() => {
  getSessionMock.mockReset();
  sqlMock.mockClear();
  responseQueue = [];
  callCount = 0;
  logUserCreatedMock.mockClear();
  logUserUpdatedMock.mockClear();
  logUserRoleChangedMock.mockClear();
  logUserOrganisationChangedMock.mockClear();
  logUserDeletedMock.mockClear();
});

describe('B1-B5. Authorization — DB-authoritative, not raw JWT (checked for every method)', () => {
  const cases: Array<{ label: string; call: () => Promise<Response> }> = [
    { label: 'GET', call: () => GET() },
    { label: 'PATCH', call: () => PATCH(makeRequest('http://localhost/api/admin/users?id=u1', 'PATCH', { name: 'X' })) },
    { label: 'DELETE', call: () => DELETE(makeRequest('http://localhost/api/admin/users?id=u1', 'DELETE')) },
    { label: 'POST', call: () => POST(makeRequest('http://localhost/api/admin/users', 'POST', { username: 'a', password: 'password123', name: 'A', role: 'viewer', organisationId: 'org-1' })) },
  ];

  for (const { label, call } of cases) {
    it(`${label}: B1. ACTIVE current super-admin succeeds (passes the auth gate)`, async () => {
      getSessionMock.mockResolvedValue(activeSuperAdminSession);
      // Provide enough queued rows for whichever method runs past the auth gate.
      queue(
        [activeSuperAdminRow],
        [{ name: 'x', role: 'VIEWER', organisation_id: 'org-1', email: null, password_hash: 'h' }],
        [{ id: 'u1', email: null, name: 'x', role: 'VIEWER', organisation_id: 'org-1', email_verified: true, created_at: new Date() }],
        [{ name: 'Org' }],
      );
      const res = await call();
      expect(res.status).not.toBe(403);
    });

    it(`${label}: B2. INACTIVE super-admin is rejected`, async () => {
      getSessionMock.mockResolvedValue(activeSuperAdminSession);
      queue([{ ...activeSuperAdminRow, status: 'INACTIVE' }]);
      const res = await call();
      expect(res.status).toBe(403);
    });

    it(`${label}: B3. stale JWT claiming super_admin after DB downgrade is rejected`, async () => {
      getSessionMock.mockResolvedValue(activeSuperAdminSession); // JWT still says super_admin
      queue([{ ...activeSuperAdminRow, role: 'viewer' }]); // DB says otherwise
      const res = await call();
      expect(res.status).toBe(403);
    });

    it(`${label}: B4. missing/deleted user is rejected`, async () => {
      getSessionMock.mockResolvedValue(activeSuperAdminSession);
      queue([]); // no row
      const res = await call();
      expect(res.status).toBe(403);
    });

    it(`${label}: B5. non-super-admin (manager) is rejected`, async () => {
      getSessionMock.mockResolvedValue({ ...activeSuperAdminSession, role: 'manager' });
      queue([{ ...activeSuperAdminRow, role: 'manager' }]);
      const res = await call();
      expect(res.status).toBe(403);
    });
  }
});

describe('B6. Existing valid behavior for listing/creating/updating/deleting users is preserved', () => {
  it('GET lists users, lowercasing role for display, unchanged from before', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [activeSuperAdminRow],
      [{ id: 'u1', email: 'a@x.com', name: 'A', role: 'VIEWER', organisation_id: 'org-1', email_verified: true, created_at: new Date(), org_name: 'Org' }],
    );
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.users[0].role).toBe('viewer');
  });

  it('PATCH updates name/role/organisation/email and returns the updated user with org_name', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [activeSuperAdminRow],
      [{ name: 'Old Name', role: 'VIEWER', organisation_id: 'org-1', email: 'old@x.com', password_hash: 'oldhash' }],
      [{ id: 'u1', email: 'new@x.com', name: 'New Name', role: 'MANAGER', organisation_id: 'org-2', email_verified: true, created_at: new Date() }],
      [{ name: 'Org Two' }],
    );
    const res = await PATCH(makeRequest('http://localhost/api/admin/users?id=u1', 'PATCH', { name: 'New Name', role: 'manager', organisationId: 'org-2', email: 'new@x.com' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.user.name).toBe('New Name');
    expect(body.user.role).toBe('manager');
    expect(body.user.org_name).toBe('Org Two');
  });

  it('PATCH rejects an invalid role exactly as before', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue([activeSuperAdminRow]);
    const res = await PATCH(makeRequest('http://localhost/api/admin/users?id=u1', 'PATCH', { role: 'not-a-real-role' }));
    expect(res.status).toBe(400);
  });

  it('DELETE still blocks deleting your own account (pre-existing, unchanged protection)', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue([activeSuperAdminRow]);
    const res = await DELETE(makeRequest('http://localhost/api/admin/users?id=founder-1', 'DELETE'));
    expect(res.status).toBe(409);
  });

  it('DELETE removes another user and still returns { success: true }', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [activeSuperAdminRow],
      [{ username: 'jane', name: 'Jane', role: 'VIEWER', organisation_id: 'org-1' }],
    );
    const res = await DELETE(makeRequest('http://localhost/api/admin/users?id=u1', 'DELETE'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
  });

  it('DELETE for a non-existent id still returns { success: true } (unchanged — no new 404 branch introduced)', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [activeSuperAdminRow],
      [], // RETURNING found nothing
    );
    const res = await DELETE(makeRequest('http://localhost/api/admin/users?id=does-not-exist', 'DELETE'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(logUserDeletedMock).not.toHaveBeenCalled();
  });

  it('POST creates a user with the required fields and returns 201', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [activeSuperAdminRow],
      [{ id: 'new-user-1', username: 'jane.smith', email: null, name: 'Jane Smith', role: 'VIEWER', organisation_id: 'org-1', email_verified: false, created_at: new Date() }],
    );
    const res = await POST(makeRequest('http://localhost/api/admin/users', 'POST', {
      username: 'jane.smith', password: 'password123', name: 'Jane Smith', role: 'viewer', organisationId: 'org-1',
    }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.user.username).toBe('jane.smith');
  });
});

describe('C. Audit wiring — routes call the audit module with the right shape on success only', () => {
  it('PATCH calls logUserUpdated with a before/after diff excluding password, and never fires role/org events when neither changed', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [activeSuperAdminRow],
      [{ name: 'Old Name', role: 'VIEWER', organisation_id: 'org-1', email: 'old@x.com', password_hash: 'oldhash' }],
      [{ id: 'u1', email: 'old@x.com', name: 'New Name', role: 'VIEWER', organisation_id: 'org-1', email_verified: true, created_at: new Date() }],
      [{ name: 'Org' }],
    );
    await PATCH(makeRequest('http://localhost/api/admin/users?id=u1', 'PATCH', { name: 'New Name' }));

    expect(logUserUpdatedMock).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'founder-1',
      actorOrganisationId: 'brainbase-org',
      targetUserId: 'u1',
      before: { name: 'Old Name' },
      after: { name: 'New Name' },
      ipAddress: '203.0.113.9',
      userAgent: 'test-agent/1.0',
    }));
    expect(logUserRoleChangedMock).not.toHaveBeenCalled();
    expect(logUserOrganisationChangedMock).not.toHaveBeenCalled();
  });

  it('PATCH changing role fires BOTH logUserUpdated and the distinct logUserRoleChanged event', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [activeSuperAdminRow],
      [{ name: 'Name', role: 'VIEWER', organisation_id: 'org-1', email: null, password_hash: 'h' }],
      [{ id: 'u1', email: null, name: 'Name', role: 'MANAGER', organisation_id: 'org-1', email_verified: true, created_at: new Date() }],
      [{ name: 'Org' }],
    );
    await PATCH(makeRequest('http://localhost/api/admin/users?id=u1', 'PATCH', { role: 'manager' }));

    expect(logUserUpdatedMock).toHaveBeenCalled();
    expect(logUserRoleChangedMock).toHaveBeenCalledWith(expect.objectContaining({
      targetUserId: 'u1', beforeRole: 'viewer', afterRole: 'manager',
    }));
  });

  it('PATCH changing organisation fires the distinct logUserOrganisationChanged event', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [activeSuperAdminRow],
      [{ name: 'Name', role: 'VIEWER', organisation_id: 'org-1', email: null, password_hash: 'h' }],
      [{ id: 'u1', email: null, name: 'Name', role: 'VIEWER', organisation_id: 'org-2', email_verified: true, created_at: new Date() }],
      [{ name: 'Org Two' }],
    );
    await PATCH(makeRequest('http://localhost/api/admin/users?id=u1', 'PATCH', { organisationId: 'org-2' }));

    expect(logUserOrganisationChangedMock).toHaveBeenCalledWith(expect.objectContaining({
      targetUserId: 'u1', beforeOrganisationId: 'org-1', afterOrganisationId: 'org-2',
    }));
  });

  it('PATCH changing only the password marks after.password_changed = true and never includes the password value', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [activeSuperAdminRow],
      [{ name: 'Name', role: 'VIEWER', organisation_id: 'org-1', email: null, password_hash: 'oldhash' }],
      [{ id: 'u1', email: null, name: 'Name', role: 'VIEWER', organisation_id: 'org-1', email_verified: true, created_at: new Date() }],
      [{ name: 'Org' }],
    );
    await PATCH(makeRequest('http://localhost/api/admin/users?id=u1', 'PATCH', { password: 'newpassword123' }));

    const call = logUserUpdatedMock.mock.calls[0][0] as { after: Record<string, unknown> };
    expect(call.after).toEqual({ password_changed: true });
    expect(JSON.stringify(call)).not.toContain('newpassword123');
    expect(JSON.stringify(call)).not.toContain('oldhash');
  });

  it('a no-op PATCH (nothing actually differs) does not write any audit event', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [activeSuperAdminRow],
      [{ name: 'Same Name', role: 'VIEWER', organisation_id: 'org-1', email: null, password_hash: 'h' }],
      [{ id: 'u1', email: null, name: 'Same Name', role: 'VIEWER', organisation_id: 'org-1', email_verified: true, created_at: new Date() }],
      [{ name: 'Org' }],
    );
    await PATCH(makeRequest('http://localhost/api/admin/users?id=u1', 'PATCH', { name: 'Same Name' }));
    expect(logUserUpdatedMock).not.toHaveBeenCalled();
  });

  it('DELETE calls logUserDeleted with before-state and never the password hash', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [activeSuperAdminRow],
      [{ username: 'jane', name: 'Jane', role: 'VIEWER', organisation_id: 'org-1' }],
    );
    await DELETE(makeRequest('http://localhost/api/admin/users?id=u1', 'DELETE'));

    const call = logUserDeletedMock.mock.calls[0][0] as { before: Record<string, unknown> };
    expect(call.before).toEqual({ username: 'jane', name: 'Jane', role: 'viewer', organisation_id: 'org-1' });
    expect(JSON.stringify(call)).not.toMatch(/password/i);
  });

  it('POST calls logUserCreated with the new user id and safe fields, never the password', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [activeSuperAdminRow],
      [{ id: 'new-user-1', username: 'jane.smith', email: null, name: 'Jane Smith', role: 'VIEWER', organisation_id: 'org-1', email_verified: false, created_at: new Date() }],
    );
    await POST(makeRequest('http://localhost/api/admin/users', 'POST', {
      username: 'jane.smith', password: 'password123', name: 'Jane Smith', role: 'viewer', organisationId: 'org-1',
    }));

    const call = logUserCreatedMock.mock.calls[0][0] as { newUserId: string; after: Record<string, unknown> };
    expect(call.newUserId).toBe('new-user-1');
    expect(JSON.stringify(call)).not.toContain('password123');
  });
});

describe('D. Failure-path — no mutation and no success audit when authorization fails', () => {
  it('PATCH: a rejected request never reaches the UPDATE or the audit call', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue([{ ...activeSuperAdminRow, status: 'INACTIVE' }]);
    const res = await PATCH(makeRequest('http://localhost/api/admin/users?id=u1', 'PATCH', { name: 'X' }));
    expect(res.status).toBe(403);
    expect(sqlMock).toHaveBeenCalledTimes(1); // only requireSession's own lookup ran
    expect(logUserUpdatedMock).not.toHaveBeenCalled();
  });

  it('DELETE: a rejected request never reaches the DELETE or the audit call', async () => {
    getSessionMock.mockResolvedValue({ ...activeSuperAdminSession, role: 'manager' });
    queue([{ ...activeSuperAdminRow, role: 'manager' }]);
    const res = await DELETE(makeRequest('http://localhost/api/admin/users?id=u1', 'DELETE'));
    expect(res.status).toBe(403);
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(logUserDeletedMock).not.toHaveBeenCalled();
  });

  it('POST: a rejected request never reaches the INSERT or the audit call', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue([]); // deleted/missing user
    const res = await POST(makeRequest('http://localhost/api/admin/users', 'POST', { username: 'a', password: 'password123', name: 'A', role: 'viewer', organisationId: 'org-1' }));
    expect(res.status).toBe(403);
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(logUserCreatedMock).not.toHaveBeenCalled();
  });
});

describe('No raw getSession() + manual role comparison remains as the authorization gate for any method', () => {
  it('the route imports and calls requireRole from @/lib/org for every method, and no longer imports or calls getSession', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/api/admin/users/route.ts'), 'utf8');
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(codeOnly).toContain("from '@/lib/org'");
    expect((codeOnly.match(/requireRole\(\s*'super_admin'\s*\)/g) ?? []).length).toBe(4); // GET, PATCH, DELETE, POST
    // A type-only import of `Role` from '@/lib/session' is fine (that type
    // still lives there) — what must be gone is importing/calling the raw
    // getSession() accessor itself.
    expect(codeOnly).not.toMatch(/import\s*\{[^}]*\bgetSession\b/);
    expect(codeOnly).not.toMatch(/session\??\.role/);
    expect(codeOnly).not.toMatch(/\bgetSession\s*\(/);
  });
});
