import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// HR-1 — behavioral coverage for GET/POST /api/hr/teams. Same mocking
// layering as hrPeopleRoute.test.ts.
//
// HR-2 Step 1B — extended with PATCH /api/hr/teams/[id], POST
// /api/hr/teams/[id]/archive, POST /api/hr/teams/[id]/restore, and
// GET's new default-excludes-archived / ?include_archived=1 behavior.

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}
function jsonRequest(url: string, method: string, body: unknown): NextRequest {
  return asNextRequest(new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}
function getRequest(url: string): NextRequest {
  return asNextRequest(new Request(url));
}
function postRequest(url: string): NextRequest {
  return asNextRequest(new Request(url, { method: 'POST' }));
}
function paramsFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
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

const SESSION = { userId: 'user-1', organisationId: 'org-a', homeOrganisationId: 'org-a', role: 'manager', name: 'Test User' };
const HR_ADMIN_CTX = { organisationId: 'org-a', selfPersonId: null, isHrAdministrator: true, hasRestrictedHrAccess: false };
const NOBODY_CTX = { organisationId: 'org-a', selfPersonId: null, isHrAdministrator: false, hasRestrictedHrAccess: false };
// HR-2 — same already-proven shape used in hrPeopleRoute.test.ts's own
// SUPER_ADMIN_CTX (see hrContextResolution.test.ts for the real
// resolution proof); resolveHrAccessContext is fully mocked in this
// file too, so this is supplied directly.
const SUPER_ADMIN_CTX = { organisationId: 'org-a', selfPersonId: null, isHrAdministrator: true, hasRestrictedHrAccess: true };
const SUPER_ADMIN_SESSION = { ...SESSION, role: 'super_admin' };

const ACTIVE_TEAM = { id: 'team-a', organisation_id: 'org-a', name: 'Engineering', description: 'Old desc', manager_person_id: null, archived_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
const ARCHIVED_TEAM = { ...ACTIVE_TEAM, archived_at: '2026-02-01T00:00:00Z' };

const { GET: listTeams, POST: createTeam } = await import('@/app/api/hr/teams/route');
const { PATCH: patchTeam } = await import('@/app/api/hr/teams/[id]/route');
const { POST: archiveTeam } = await import('@/app/api/hr/teams/[id]/archive/route');
const { POST: restoreTeam } = await import('@/app/api/hr/teams/[id]/restore/route');

beforeEach(() => {
  requireSessionMock.mockReset();
  requireCapabilityMock.mockReset();
  resolveHrAccessContextMock.mockReset();
  logHrEventMock.mockClear();
  sqlMock.mockClear();
  calls = [];
  responseQueue = [];
  callCount = 0;
  requireSessionMock.mockResolvedValue(SESSION);
  requireCapabilityMock.mockResolvedValue({ key: 'people', config: {} });
});

describe('GET /api/hr/teams', () => {
  it('rejects with 401 when there is no session', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await listTeams(getRequest('http://localhost/api/hr/teams'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the People module is not enabled', async () => {
    const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability');
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'));
    const res = await listTeams(getRequest('http://localhost/api/hr/teams'));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a non-admin user (module-entitled) can still list team names — team names are organisation structure, not sensitive HR data', async () => {
    queue([{ id: 'team-a', organisation_id: 'org-a', name: 'Engineering', description: null, manager_person_id: null, archived_at: null }]);
    const res = await listTeams(getRequest('http://localhost/api/hr/teams'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams).toHaveLength(1);
  });

  it('is scoped to the caller\'s own organisation (also proves a cross-org team is never returned)', async () => {
    queue([]);
    await listTeams(getRequest('http://localhost/api/hr/teams'));
    expect(calls[0].text).toContain('organisation_id');
    expect(calls[0].values).toContain('org-a');
  });

  it('HR-2 Step 1B — default excludes archived teams and requires no HR management authority lookup', async () => {
    queue([]);
    const res = await listTeams(getRequest('http://localhost/api/hr/teams'));
    expect(res.status).toBe(200);
    expect(calls[0].text).toContain('archived_at IS NULL');
    expect(calls[0].values).toContain(false);
    expect(resolveHrAccessContextMock).not.toHaveBeenCalled();
  });

  it('HR-2 Step 1B — ?include_archived=1 returns active + archived for an HR administrator', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([ACTIVE_TEAM, ARCHIVED_TEAM]);
    const res = await listTeams(getRequest('http://localhost/api/hr/teams?include_archived=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams).toHaveLength(2);
    expect(calls[0].values).toContain(true);
  });

  it('HR-2 Step 1B — ?include_archived=1 works for super_admin with no HR administrator grant', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([ACTIVE_TEAM, ARCHIVED_TEAM]);
    const res = await listTeams(getRequest('http://localhost/api/hr/teams?include_archived=1'));
    expect(res.status).toBe(200);
    expect(resolveHrAccessContextMock).toHaveBeenCalledWith(expect.objectContaining({ role: 'super_admin' }));
  });

  it('HR-2 Step 1B — a manager (module-entitled, non-admin) cannot use ?include_archived=1', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await listTeams(getRequest('http://localhost/api/hr/teams?include_archived=1'));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/hr/teams', () => {
  it('rejects with 401 when there is no session, before any write', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Engineering' }));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the People module is not enabled, before any write', async () => {
    const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability');
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('ENTITLEMENT_DISABLED'));
    const res = await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Engineering' }));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a non-admin user cannot create a team', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Engineering' }));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('an HR administrator can create a team', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'team-a', organisation_id: 'org-a', name: 'Engineering', manager_person_id: null, archived_at: null }]);
    const res = await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Engineering' }));
    expect(res.status).toBe(201);
  });

  it('rejects a name-less team', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const res = await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: '  ' }));
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects a manager_person_id belonging to a different organisation (tenant isolation)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]); // isPersonInOrganisation finds nothing for this org
    const res = await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Engineering', manager_person_id: 'org-b-person' }));
    expect(res.status).toBe(400);
  });

  it('a successful create writes exactly one hr_team.created audit event; a rejected create writes none', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'team-a', organisation_id: 'org-a', name: 'Engineering', manager_person_id: null, archived_at: null }]);
    await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Engineering' }));
    expect(logHrEventMock).toHaveBeenCalledTimes(1);
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(entry).toMatchObject({ action: 'hr_team.created', resourceType: 'hr_team', resourceId: 'team-a' });

    logHrEventMock.mockClear();
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Sales' }));
    expect(logHrEventMock).not.toHaveBeenCalled();
  });

  it('HR-2 Step 1B — a new team always starts active (archived_at null)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'team-a', organisation_id: 'org-a', name: 'Engineering', manager_person_id: null, archived_at: null }]);
    const res = await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Engineering' }));
    const body = await res.json();
    expect(body.team.archived_at).toBeNull();
  });
});

describe('HR-2 Step 1A — super_admin full HR access (teams create)', () => {
  it('a super_admin can create a team with no HR administrator grant', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([{ id: 'team-a', organisation_id: 'org-a', name: 'Engineering', manager_person_id: null, archived_at: null }]);
    const res = await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Engineering' }));
    expect(res.status).toBe(201);
    expect(resolveHrAccessContextMock).toHaveBeenCalledWith(expect.objectContaining({ role: 'super_admin' }));
  });

  it('existing HR administrator behavior is unchanged by the super_admin policy', async () => {
    requireSessionMock.mockResolvedValue(SESSION);
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'team-a', organisation_id: 'org-a', name: 'Engineering', manager_person_id: null, archived_at: null }]);
    const res = await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Engineering' }));
    expect(res.status).toBe(201);
  });

  it('an ordinary user remains denied even though super_admin now has full access', async () => {
    requireSessionMock.mockResolvedValue(SESSION);
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Engineering' }));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a super_admin creating a team still cannot assign a cross-organisation manager (tenant integrity)', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([]); // isPersonInOrganisation finds nothing for org-a
    const res = await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Engineering', manager_person_id: 'org-b-person' }));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/hr/teams/[id]', () => {
  it('an HR administrator can edit an active same-org team', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([ACTIVE_TEAM], [{ ...ACTIVE_TEAM, name: 'Platform Engineering' }]);
    const res = await patchTeam(jsonRequest('http://localhost/api/hr/teams/team-a', 'PATCH', { name: 'Platform Engineering' }), paramsFor('team-a'));
    expect(res.status).toBe(200);
  });

  it('a super_admin can edit an active same-org team with no HR administrator grant', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([ACTIVE_TEAM], [{ ...ACTIVE_TEAM, name: 'Platform Engineering' }]);
    const res = await patchTeam(jsonRequest('http://localhost/api/hr/teams/team-a', 'PATCH', { name: 'Platform Engineering' }), paramsFor('team-a'));
    expect(res.status).toBe(200);
    expect(resolveHrAccessContextMock).toHaveBeenCalledWith(expect.objectContaining({ role: 'super_admin' }));
  });

  it('an ordinary/manager user is denied, before any lookup', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await patchTeam(jsonRequest('http://localhost/api/hr/teams/team-a', 'PATCH', { name: 'X' }), paramsFor('team-a'));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a cross-organisation (or nonexistent) target returns 404 without existence leakage', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]); // loadTeam finds nothing for this org
    const res = await patchTeam(jsonRequest('http://localhost/api/hr/teams/team-b', 'PATCH', { name: 'X' }), paramsFor('team-b'));
    expect(res.status).toBe(404);
  });

  it('rejects a manager_person_id belonging to a different organisation (tenant isolation)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([ACTIVE_TEAM], []); // loadTeam succeeds, isPersonInOrganisation finds nothing
    const res = await patchTeam(jsonRequest('http://localhost/api/hr/teams/team-a', 'PATCH', { manager_person_id: 'org-b-person' }), paramsFor('team-a'));
    expect(res.status).toBe(400);
  });

  it('rejects a blank name', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([ACTIVE_TEAM]);
    const res = await patchTeam(jsonRequest('http://localhost/api/hr/teams/team-a', 'PATCH', { name: '   ' }), paramsFor('team-a'));
    expect(res.status).toBe(400);
  });

  it('HR-2 Step 1B — an archived team rejects PATCH with 409 team_archived, no write', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([ARCHIVED_TEAM]);
    const res = await patchTeam(jsonRequest('http://localhost/api/hr/teams/team-a', 'PATCH', { name: 'New Name' }), paramsFor('team-a'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('team_archived');
    expect(sqlMock).toHaveBeenCalledTimes(1); // loadTeam only, no UPDATE
  });

  it('a true no-op PATCH (resubmitting the current value) writes no UPDATE, bumps no timestamp, and logs no audit', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([ACTIVE_TEAM]);
    const res = await patchTeam(jsonRequest('http://localhost/api/hr/teams/team-a', 'PATCH', { name: ACTIVE_TEAM.name }), paramsFor('team-a'));
    expect(res.status).toBe(200);
    expect(sqlMock).toHaveBeenCalledTimes(1); // loadTeam only
    expect(logHrEventMock).not.toHaveBeenCalled();
  });

  it('an actual change writes exactly one hr_team.updated audit event containing ONLY the fields that actually changed', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([ACTIVE_TEAM], [{ ...ACTIVE_TEAM, description: 'New desc' }]);
    // name resubmitted UNCHANGED alongside a real description change —
    // must not appear in the audit payload (PR #212 discipline).
    await patchTeam(jsonRequest('http://localhost/api/hr/teams/team-a', 'PATCH', { name: ACTIVE_TEAM.name, description: 'New desc' }), paramsFor('team-a'));
    expect(logHrEventMock).toHaveBeenCalledTimes(1);
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(entry).toMatchObject({ action: 'hr_team.updated', resourceType: 'hr_team', resourceId: 'team-a' });
    expect(entry.beforeState).toEqual({ description: 'Old desc' });
    expect(entry.afterState).toEqual({ description: 'New desc' });
  });
});

describe('POST /api/hr/teams/[id]/archive', () => {
  it('archives an active team and returns { archived: true }', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'team-a', archived_at: null }], [{ archived_at: '2026-03-01T00:00:00Z' }]);
    const res = await archiveTeam(postRequest('http://localhost/api/hr/teams/team-a/archive'), paramsFor('team-a'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archived).toBe(true);
  });

  it('writes exactly one hr_team.archived audit event, beforeState archived_at null -> afterState the real persisted timestamp', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'team-a', archived_at: null }], [{ archived_at: '2026-03-01T00:00:00Z' }]);
    await archiveTeam(postRequest('http://localhost/api/hr/teams/team-a/archive'), paramsFor('team-a'));
    expect(logHrEventMock).toHaveBeenCalledTimes(1);
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(entry).toMatchObject({ action: 'hr_team.archived', resourceType: 'hr_team', resourceId: 'team-a' });
    expect(entry.beforeState).toEqual({ archived_at: null });
    expect(entry.afterState).toEqual({ archived_at: '2026-03-01T00:00:00Z' });
  });

  it('archiving an already-archived team returns 409 already_archived, no UPDATE, no audit', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'team-a', archived_at: '2026-02-01T00:00:00Z' }]);
    const res = await archiveTeam(postRequest('http://localhost/api/hr/teams/team-a/archive'), paramsFor('team-a'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('already_archived');
    expect(sqlMock).toHaveBeenCalledTimes(1); // lookup only
    expect(logHrEventMock).not.toHaveBeenCalled();
  });

  it('a cross-organisation (or nonexistent) target returns 404', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    const res = await archiveTeam(postRequest('http://localhost/api/hr/teams/team-b/archive'), paramsFor('team-b'));
    expect(res.status).toBe(404);
  });

  it('an ordinary/manager user is denied, before any lookup', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await archiveTeam(postRequest('http://localhost/api/hr/teams/team-a/archive'), paramsFor('team-a'));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a super_admin can archive with no People module enabled and no HR administrator grant', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability');
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('ENTITLEMENT_DISABLED'));
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([{ id: 'team-a', archived_at: null }], [{ archived_at: '2026-03-01T00:00:00Z' }]);
    const res = await archiveTeam(postRequest('http://localhost/api/hr/teams/team-a/archive'), paramsFor('team-a'));
    expect(res.status).toBe(200);
    expect(requireCapabilityMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/hr/teams/[id]/restore', () => {
  it('restores an archived team and returns { restored: true }', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'team-a', archived_at: '2026-02-01T00:00:00Z' }], []);
    const res = await restoreTeam(postRequest('http://localhost/api/hr/teams/team-a/restore'), paramsFor('team-a'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.restored).toBe(true);
  });

  it('writes exactly one hr_team.restored audit event, beforeState the real prior timestamp -> afterState archived_at null', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'team-a', archived_at: '2026-02-01T00:00:00Z' }], []);
    await restoreTeam(postRequest('http://localhost/api/hr/teams/team-a/restore'), paramsFor('team-a'));
    expect(logHrEventMock).toHaveBeenCalledTimes(1);
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(entry).toMatchObject({ action: 'hr_team.restored', resourceType: 'hr_team', resourceId: 'team-a' });
    expect(entry.beforeState).toEqual({ archived_at: '2026-02-01T00:00:00Z' });
    expect(entry.afterState).toEqual({ archived_at: null });
  });

  it('restoring an already-active team returns 409 not_archived, no UPDATE, no audit', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'team-a', archived_at: null }]);
    const res = await restoreTeam(postRequest('http://localhost/api/hr/teams/team-a/restore'), paramsFor('team-a'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('not_archived');
    expect(sqlMock).toHaveBeenCalledTimes(1); // lookup only
    expect(logHrEventMock).not.toHaveBeenCalled();
  });

  it('a cross-organisation (or nonexistent) target returns 404', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    const res = await restoreTeam(postRequest('http://localhost/api/hr/teams/team-b/restore'), paramsFor('team-b'));
    expect(res.status).toBe(404);
  });

  it('an ordinary/manager user is denied, before any lookup', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await restoreTeam(postRequest('http://localhost/api/hr/teams/team-a/restore'), paramsFor('team-a'));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a super_admin can restore with no People module enabled and no HR administrator grant', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability');
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('ENTITLEMENT_DISABLED'));
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([{ id: 'team-a', archived_at: '2026-02-01T00:00:00Z' }], []);
    const res = await restoreTeam(postRequest('http://localhost/api/hr/teams/team-a/restore'), paramsFor('team-a'));
    expect(res.status).toBe(200);
    expect(requireCapabilityMock).not.toHaveBeenCalled();
  });
});
