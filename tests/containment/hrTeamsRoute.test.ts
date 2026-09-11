import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// HR-1 — behavioral coverage for GET/POST /api/hr/teams. Same mocking
// layering as hrPeopleRoute.test.ts.

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

const SESSION = { userId: 'user-1', organisationId: 'org-a', homeOrganisationId: 'org-a', role: 'manager', name: 'Test User' };
const HR_ADMIN_CTX = { organisationId: 'org-a', selfPersonId: null, isHrAdministrator: true, hasRestrictedHrAccess: false };
const NOBODY_CTX = { organisationId: 'org-a', selfPersonId: null, isHrAdministrator: false, hasRestrictedHrAccess: false };

const { GET: listTeams, POST: createTeam } = await import('@/app/api/hr/teams/route');

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
    const res = await listTeams();
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the People module is not enabled', async () => {
    const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability');
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'));
    const res = await listTeams();
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a non-admin user (module-entitled) can still list team names — team names are organisation structure, not sensitive HR data', async () => {
    queue([{ id: 'team-a', organisation_id: 'org-a', name: 'Engineering', description: null, manager_person_id: null }]);
    const res = await listTeams();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams).toHaveLength(1);
  });

  it('is scoped to the caller\'s own organisation', async () => {
    queue([]);
    await listTeams();
    expect(calls[0].text).toContain('organisation_id');
    expect(calls[0].values).toContain('org-a');
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
    queue([{ id: 'team-a', organisation_id: 'org-a', name: 'Engineering', manager_person_id: null }]);
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
    queue([{ id: 'team-a', organisation_id: 'org-a', name: 'Engineering', manager_person_id: null }]);
    await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Engineering' }));
    expect(logHrEventMock).toHaveBeenCalledTimes(1);
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(entry).toMatchObject({ action: 'hr_team.created', resourceType: 'hr_team', resourceId: 'team-a' });

    logHrEventMock.mockClear();
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    await createTeam(jsonRequest('http://localhost/api/hr/teams', 'POST', { name: 'Sales' }));
    expect(logHrEventMock).not.toHaveBeenCalled();
  });
});
