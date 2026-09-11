import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';

// SEC-1A — behavioral regression coverage for app/api/admin/impersonate/
// route.ts. Previously this route authorized via raw getSession() plus a
// manual `session.role !== 'super_admin'` string comparison — the JWT-only
// role claim, never revalidated against the DB. This suite proves the
// route now goes through the REAL requireRole()/requireSession() chain
// (lib/org.ts, unmocked) — only their own dependencies (getSession, sql,
// cookies) and the audit module are mocked, mirroring the established
// convention in tests/containment/crmBackfillImpersonationAuthChain.test.ts
// and requireSessionStatusEnforcement.test.ts.

const getSessionMock = vi.fn();
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  return { ...actual, getSession: (...args: unknown[]) => getSessionMock(...args) };
});

let responseQueue: unknown[][] = [];
let callCount = 0;
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []));
vi.mock('@/lib/db', () => ({ default: sqlMock }));

const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => { cookieStore.set(name, value); },
    delete: (name: string) => { cookieStore.delete(name); },
  }),
}));

const logImpersonationStartedMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const logImpersonationStoppedMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock('@/lib/admin/auditLog', () => ({
  logImpersonationStarted: (...args: unknown[]) => logImpersonationStartedMock(...args),
  logImpersonationStopped: (...args: unknown[]) => logImpersonationStoppedMock(...args),
}));

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0; }

function makeRequest(body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('http://localhost/api/admin/impersonate', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9', 'user-agent': 'test-agent/1.0', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

const { GET, POST, DELETE } = await import('@/app/api/admin/impersonate/route');

const activeSuperAdminSession = { userId: 'founder-1', organisationId: 'brainbase-org', role: 'super_admin', name: 'Founder' };

beforeEach(() => {
  getSessionMock.mockReset();
  sqlMock.mockClear();
  cookieStore.clear();
  responseQueue = [];
  callCount = 0;
  logImpersonationStartedMock.mockClear();
  logImpersonationStoppedMock.mockClear();
});

describe('A1-A6. Authorization — DB-authoritative, not raw JWT', () => {
  it('A1. ACTIVE current super-admin succeeds (GET)', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin', status: 'ACTIVE' }]);

    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('A2. INACTIVE super-admin JWT is rejected (GET)', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin', status: 'INACTIVE' }]);

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('A3. JWT claims super_admin but current DB role is now lower — rejected (GET)', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession); // stale JWT still says super_admin
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'viewer', status: 'ACTIVE' }]);

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('A4. Deleted/missing user is rejected (GET)', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue([]); // no row returned — user no longer exists

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('A5. Organisation drift (DB org differs from JWT org) is rejected per the authoritative helper', async () => {
    getSessionMock.mockResolvedValue({ ...activeSuperAdminSession, organisationId: 'stale-org' });
    queue([{ id: 'founder-1', organisation_id: 'reassigned-org', role: 'super_admin', status: 'ACTIVE' }]);

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('A6. A normal, non-super-admin (e.g. manager) is rejected', async () => {
    getSessionMock.mockResolvedValue({ ...activeSuperAdminSession, role: 'manager' });
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'manager', status: 'ACTIVE' }]);

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('no session at all is rejected on every method', async () => {
    getSessionMock.mockResolvedValue(null);
    queue();

    expect((await GET()).status).toBe(403);
    expect((await POST(makeRequest({ orgId: 'org-x' }))).status).toBe(403);
    expect((await DELETE(makeRequest())).status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled(); // requireSession fails before any DB call
  });
});

describe('A7-A8. Valid impersonation start/stop still works for an active current super-admin', () => {
  it('A7. POST begins impersonation, sets the cookie, and returns the target org', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin', status: 'ACTIVE' }],
      [{ id: 'school-test-org', name: 'School Test Organisation' }],
    );

    const res = await POST(makeRequest({ orgId: 'school-test-org' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, orgId: 'school-test-org', orgName: 'School Test Organisation' });
    expect(cookieStore.get('org_override')).toBe('school-test-org');
  });

  it('A8. DELETE stops impersonation, clearing the cookie', async () => {
    cookieStore.set('org_override', 'school-test-org');
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin', status: 'ACTIVE' }]);

    const res = await DELETE(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(cookieStore.has('org_override')).toBe(false);
  });

  it('DELETE with no active impersonation still succeeds (nothing to clear) and does not write a misleading stop event', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin', status: 'ACTIVE' }]);

    const res = await DELETE(makeRequest());
    expect(res.status).toBe(200);
    expect(logImpersonationStoppedMock).not.toHaveBeenCalled();
  });
});

describe('A9. Existing target-organisation validation still works', () => {
  it('POST with a non-existent target organisation returns 404 and does not start impersonation or audit', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin', status: 'ACTIVE' }],
      [], // org lookup finds nothing
    );

    const res = await POST(makeRequest({ orgId: 'does-not-exist' }));
    expect(res.status).toBe(404);
    expect(cookieStore.has('org_override')).toBe(false);
    expect(logImpersonationStartedMock).not.toHaveBeenCalled();
  });

  it('POST with a missing orgId in the body returns 400 before any authorization-adjacent DB work', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin', status: 'ACTIVE' }]);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('a demoted/disabled stale session cannot supply an orgId to override the authorization decision — the request body is only consulted AFTER requireRole succeeds', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession); // JWT still claims super_admin
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'viewer', status: 'ACTIVE' }]); // DB says otherwise

    const res = await POST(makeRequest({ orgId: 'school-test-org' }));
    expect(res.status).toBe(403);
    expect(cookieStore.has('org_override')).toBe(false);
    expect(logImpersonationStartedMock).not.toHaveBeenCalled();
  });
});

describe('Audit wiring — the route calls the audit module with the right shape on success only', () => {
  it('POST calls logImpersonationStarted with actor, home org, and target org', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue(
      [{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin', status: 'ACTIVE' }],
      [{ id: 'school-test-org', name: 'School Test Organisation' }],
    );

    await POST(makeRequest({ orgId: 'school-test-org' }));

    expect(logImpersonationStartedMock).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'founder-1',
      actorHomeOrganisationId: 'brainbase-org',
      targetOrganisationId: 'school-test-org',
      ipAddress: '203.0.113.9',
      userAgent: 'test-agent/1.0',
    }));
  });

  it('DELETE calls logImpersonationStopped with the org that WAS being impersonated', async () => {
    cookieStore.set('org_override', 'school-test-org');
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin', status: 'ACTIVE' }]);

    await DELETE(makeRequest());

    expect(logImpersonationStoppedMock).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'founder-1',
      actorHomeOrganisationId: 'brainbase-org',
      targetOrganisationId: 'school-test-org',
    }));
  });

  it('a REJECTED (403) POST never calls logImpersonationStarted', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'manager', status: 'ACTIVE' }]);

    await POST(makeRequest({ orgId: 'school-test-org' }));
    expect(logImpersonationStartedMock).not.toHaveBeenCalled();
  });

  it('GET never calls either audit function (read-only)', async () => {
    getSessionMock.mockResolvedValue(activeSuperAdminSession);
    queue([{ id: 'founder-1', organisation_id: 'brainbase-org', role: 'super_admin', status: 'ACTIVE' }]);

    await GET();
    expect(logImpersonationStartedMock).not.toHaveBeenCalled();
    expect(logImpersonationStoppedMock).not.toHaveBeenCalled();
  });
});

describe('A10. No raw getSession() + manual role comparison remains as the authorization gate', () => {
  it('the route imports and calls requireRole from @/lib/org, and no longer imports or calls getSession from @/lib/session', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/api/admin/impersonate/route.ts'), 'utf8');
    // Strip comments first — this file's own documentation comments
    // legitimately quote the OLD pattern by name to explain what changed;
    // checking actual code (not prose) is what proves the bypass is gone.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(codeOnly).toContain("from '@/lib/org'");
    expect(codeOnly).toMatch(/requireRole\(\s*'super_admin'\s*\)/);
    expect(codeOnly).not.toMatch(/from ['"]@\/lib\/session['"]/);
    expect(codeOnly).not.toMatch(/session\.role\s*!==\s*['"]super_admin['"]/);
    expect(codeOnly).not.toMatch(/\bgetSession\s*\(/);
  });
});
