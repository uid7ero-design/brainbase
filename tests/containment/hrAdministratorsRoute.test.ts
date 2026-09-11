import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// HR-1 — behavioral coverage for POST/DELETE /api/hr/administrators.
// Proves the two, and only two, callers who may grant/revoke the
// HR-administrator entitlement: an existing HR administrator
// (canManageHrAccess), or a platform super_admin (explicit bootstrap
// handling for this one endpoint only — never an implicit grant
// anywhere else; see the route's own header comment).

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}
function jsonRequest(url: string, method: string, body: unknown): NextRequest {
  return asNextRequest(new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

const requireSessionMock = vi.fn();
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>();
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) };
});

const requireCapabilityMock = vi.fn();
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>();
  return { ...actual, requireCapability: (...args: unknown[]) => requireCapabilityMock(...args) };
});

const resolveHrAccessContextMock = vi.fn();
vi.mock('@/lib/hr/context', () => ({ resolveHrAccessContext: (...args: unknown[]) => resolveHrAccessContextMock(...args) }));

const logHrEventMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock('@/lib/hr/auditLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/auditLog')>();
  return { ...actual, logHrEvent: (...args: unknown[]) => logHrEventMock(...args) };
});

let responseQueue: unknown[][] = [];
let callCount = 0;
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []));
vi.mock('@/lib/db', () => ({ default: sqlMock }));

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0; }

const HR_ADMIN_CTX = { organisationId: 'org-a', selfPersonId: null, isHrAdministrator: true, hasRestrictedHrAccess: false };
const NOBODY_CTX = { organisationId: 'org-a', selfPersonId: null, isHrAdministrator: false, hasRestrictedHrAccess: false };

function session(role: string) {
  return { userId: 'user-1', organisationId: 'org-a', homeOrganisationId: 'org-a', role, name: 'Test User' };
}

const { POST: grant, DELETE: revoke } = await import('@/app/api/hr/administrators/route');

beforeEach(() => {
  requireSessionMock.mockReset();
  requireCapabilityMock.mockReset();
  resolveHrAccessContextMock.mockReset();
  logHrEventMock.mockClear();
  sqlMock.mockClear();
  responseQueue = [];
  callCount = 0;
  requireCapabilityMock.mockResolvedValue({ key: 'people', config: {} });
});

describe('POST /api/hr/administrators — authorization', () => {
  it('rejects with 401 when there is no session', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await grant(jsonRequest('http://localhost/api/hr/administrators', 'POST', { user_id: 'user-2' }));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects with 403 for a plain user who is neither an existing HR administrator nor a super_admin', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await grant(jsonRequest('http://localhost/api/hr/administrators', 'POST', { user_id: 'user-2' }));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('an existing HR administrator can grant the entitlement to another user', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'user-2', organisation_id: 'org-a' }], [{ id: 'grant-1' }]);
    const res = await grant(jsonRequest('http://localhost/api/hr/administrators', 'POST', { user_id: 'user-2' }));
    expect(res.status).toBe(201);
  });

  it('a platform super_admin can grant the entitlement even with no existing hr_administrators row (genuine bootstrap case)', async () => {
    requireSessionMock.mockResolvedValue(session('super_admin'));
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX); // zero hr_administrators rows exist yet
    queue([{ id: 'user-2', organisation_id: 'org-a' }], [{ id: 'grant-1' }]);
    const res = await grant(jsonRequest('http://localhost/api/hr/administrators', 'POST', { user_id: 'user-2' }));
    expect(res.status).toBe(201);
  });

  it('rejects granting to a user in a different organisation (tenant isolation)', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]); // isUserInOrganisation finds nothing for this org
    const res = await grant(jsonRequest('http://localhost/api/hr/administrators', 'POST', { user_id: 'org-b-user' }));
    expect(res.status).toBe(400);
  });

  it('a successful grant writes exactly one hr_administrator.granted audit event', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'user-2', organisation_id: 'org-a' }], [{ id: 'grant-1' }]);
    await grant(jsonRequest('http://localhost/api/hr/administrators', 'POST', { user_id: 'user-2' }));
    expect(logHrEventMock).toHaveBeenCalledTimes(1);
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(entry).toMatchObject({ action: 'hr_administrator.granted', resourceType: 'hr_administrator', resourceId: 'user-2' });
  });

  it('a rejected grant (permission denied) writes no audit event', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    await grant(jsonRequest('http://localhost/api/hr/administrators', 'POST', { user_id: 'user-2' }));
    expect(logHrEventMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/hr/administrators — authorization', () => {
  it('rejects with 401 when there is no session', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await revoke(asNextRequest(new Request('http://localhost/api/hr/administrators?userId=user-2', { method: 'DELETE' })));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects with 403 for a plain user', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await revoke(asNextRequest(new Request('http://localhost/api/hr/administrators?userId=user-2', { method: 'DELETE' })));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('an existing HR administrator can revoke another user\'s entitlement', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'grant-1' }]);
    const res = await revoke(asNextRequest(new Request('http://localhost/api/hr/administrators?userId=user-2', { method: 'DELETE' })));
    expect(res.status).toBe(200);
  });
});
