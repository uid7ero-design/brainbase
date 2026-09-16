import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// HR-1 — behavioral coverage for POST/DELETE /api/hr/administrators.
// Proves the two, and only two, callers who may grant/revoke the
// HR-administrator entitlement: an existing HR administrator
// (canManageHrAccess), or a platform super_admin (explicit bootstrap
// handling for this one endpoint only — never an implicit grant
// anywhere else; see the route's own header comment).
//
// HR-2 — the route's own isBootstrapSuperAdmin special-case is gone.
// canManageHrAccess(ctx) (== ctx.isHrAdministrator) alone now decides
// every case, because lib/hr/context.ts's resolveHrAccessContext()
// resolves isHrAdministrator: true for role === 'super_admin'
// unconditionally (see hrContextResolution.test.ts for that resolution
// proof). Since resolveHrAccessContext is fully mocked in this file,
// the super_admin bootstrap test below supplies SUPER_ADMIN_CTX
// directly rather than relying on any route-level role check — proving
// the route reaches the correct outcome purely from ctx, with zero
// remaining role-awareness of its own.

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
let calls: { text: string; values: unknown[] }[] = [];
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values });
  return Promise.resolve(responseQueue[callCount++] ?? []);
});
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...(args as [TemplateStringsArray, ...unknown[]])),
}));

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0; }

const HR_ADMIN_CTX = { organisationId: 'org-a', selfPersonId: null, isHrAdministrator: true, hasRestrictedHrAccess: false };
const NOBODY_CTX = { organisationId: 'org-a', selfPersonId: null, isHrAdministrator: false, hasRestrictedHrAccess: false };
const SUPER_ADMIN_CTX = { organisationId: 'org-a', selfPersonId: null, isHrAdministrator: true, hasRestrictedHrAccess: true };
const SELF_ONLY_CTX = { organisationId: 'org-a', selfPersonId: 'person-1', isHrAdministrator: false, hasRestrictedHrAccess: false };

function session(role: string) {
  return { userId: 'user-1', organisationId: 'org-a', homeOrganisationId: 'org-a', role, name: 'Test User' };
}

const { GET: list, POST: grant, DELETE: revoke } = await import('@/app/api/hr/administrators/route');

beforeEach(() => {
  requireSessionMock.mockReset();
  requireCapabilityMock.mockReset();
  resolveHrAccessContextMock.mockReset();
  logHrEventMock.mockClear();
  sqlMock.mockClear();
  calls = [];
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

  it('a platform super_admin can grant the entitlement (bootstrap case) — resolveHrAccessContext already resolves isHrAdministrator: true for super_admin, with zero real hr_administrators rows needed', async () => {
    requireSessionMock.mockResolvedValue(session('super_admin'));
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([{ id: 'user-2', organisation_id: 'org-a' }], [{ id: 'grant-1' }]);
    const res = await grant(jsonRequest('http://localhost/api/hr/administrators', 'POST', { user_id: 'user-2' }));
    expect(res.status).toBe(201);
    expect(resolveHrAccessContextMock).toHaveBeenCalledWith(expect.objectContaining({ role: 'super_admin' }));
  });

  it('the route itself has no remaining role-based bypass — a super_admin session whose resolved context lacks isHrAdministrator is still rejected', async () => {
    requireSessionMock.mockResolvedValue(session('super_admin'));
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await grant(jsonRequest('http://localhost/api/hr/administrators', 'POST', { user_id: 'user-2' }));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
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

  it('a platform super_admin can revoke another user\'s entitlement with no existing hr_administrators row of their own', async () => {
    requireSessionMock.mockResolvedValue(session('super_admin'));
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([{ id: 'grant-1' }]);
    const res = await revoke(asNextRequest(new Request('http://localhost/api/hr/administrators?userId=user-2', { method: 'DELETE' })));
    expect(res.status).toBe(200);
  });
});

// HR Administrator Management UI — behavioral coverage for the new
// GET /api/hr/administrators, added so the management page can list
// current HR administrators and a same-org candidate pool to grant
// next. Gated identically to POST/DELETE above (canManageHrAccess(ctx)
// — HR administrator or super_admin only, no route-local role check).
// Takes no request/params, so the exported handler itself is called
// directly with no argument.

describe('GET /api/hr/administrators — authorization', () => {
  it('rejects with 401 when there is no session', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await list();
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the People module is not enabled (insufficient HR capability)', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability');
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'));
    const res = await list();
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a manager (module-entitled, non-admin) is denied', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await list();
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a linked ordinary user (self-only access) is denied', async () => {
    requireSessionMock.mockResolvedValue(session('user'));
    resolveHrAccessContextMock.mockResolvedValue(SELF_ONLY_CTX);
    const res = await list();
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('an existing HR administrator is allowed', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    const res = await list();
    expect(res.status).toBe(200);
  });

  it('a platform super_admin is allowed', async () => {
    requireSessionMock.mockResolvedValue(session('super_admin'));
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([]);
    const res = await list();
    expect(res.status).toBe(200);
  });

  it('the super_admin People-module bypass is preserved — requireCapability is never called for a super_admin caller', async () => {
    requireSessionMock.mockResolvedValue(session('super_admin'));
    const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability');
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('ENTITLEMENT_DISABLED'));
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([]);
    const res = await list();
    expect(res.status).toBe(200);
    expect(requireCapabilityMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/hr/administrators — tenant isolation', () => {
  it('scopes the query to the caller\'s active organisation', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    await list();
    expect(calls[0].text).toContain('u.organisation_id');
    expect(calls[0].values).toContain('org-a');
  });

  it('super_admin remains scoped to their currently active organisation, never a different one', async () => {
    requireSessionMock.mockResolvedValue(session('super_admin'));
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([]);
    await list();
    expect(calls[0].values).toContain('org-a');
    expect(resolveHrAccessContextMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a', role: 'super_admin' }));
  });

  it('the hr_administrators join is itself scoped to the same organisation — no cross-org grant row could be returned by this query shape', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    await list();
    expect(calls[0].text).toContain('ha.organisation_id = u.organisation_id');
  });
});

describe('GET /api/hr/administrators — response minimization', () => {
  it('response contains ONLY the approved fields — no password/role/token/security metadata', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'user-2', name: 'Emma Palmer', email: 'emma@example.com', is_hr_administrator: true }]);
    const res = await list();
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    const keys = Object.keys(body.users[0]).sort();
    expect(keys).toEqual(['email', 'id', 'is_hr_administrator', 'name'].sort());
  });

  it('never selects password, password_hash, role, email_verified, last_login_at, preferences, or org metadata from the DB', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    await list();
    const selectText = calls[0].text.toLowerCase();
    for (const forbidden of ['password', 'role', 'email_verified', 'last_login_at', 'preferences', 'token', 'mfa', 'org_name']) {
      expect(selectText).not.toContain(forbidden);
    }
  });

  it('a currently-granted user has is_hr_administrator: true and an ungranted same-org user has is_hr_administrator: false', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([
      { id: 'user-2', name: 'Emma Palmer', email: 'emma@example.com', is_hr_administrator: true },
      { id: 'user-3', name: 'Sam Lee', email: 'sam@example.com', is_hr_administrator: false },
    ]);
    const res = await list();
    const body = await res.json();
    expect(body.users.find((u: { id: string }) => u.id === 'user-2').is_hr_administrator).toBe(true);
    expect(body.users.find((u: { id: string }) => u.id === 'user-3').is_hr_administrator).toBe(false);
  });

  it('no email/name matching logic exists — the query never filters or joins by email/name at all', async () => {
    requireSessionMock.mockResolvedValue(session('manager'));
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    await list();
    expect(calls[0].text).not.toMatch(/work_email|first_name|last_name|phone/i);
  });
});
