import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}
function getRequest(url: string): NextRequest {
  return asNextRequest(new Request(url));
}
const BASE_URL = 'http://localhost/api/hr/linkable-users';

// HR-2 Step 1D1 — behavioral coverage for GET /api/hr/linkable-users,
// the ONLY candidate-account source for explicit HR person<->BrainBase-
// user linking. Same mocking layering as every other HR route test in
// this repo (requireSession, requireCapability, resolveHrAccessContext,
// and `sql` all fully mocked).

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
const SELF_ONLY_CTX = { organisationId: 'org-a', selfPersonId: 'person-1', isHrAdministrator: false, hasRestrictedHrAccess: false };
const SUPER_ADMIN_CTX = { organisationId: 'org-a', selfPersonId: null, isHrAdministrator: true, hasRestrictedHrAccess: true };
const SUPER_ADMIN_SESSION = { ...SESSION, role: 'super_admin' };

const { GET: listLinkableUsers } = await import('@/app/api/hr/linkable-users/route');

beforeEach(() => {
  requireSessionMock.mockReset();
  requireCapabilityMock.mockReset();
  resolveHrAccessContextMock.mockReset();
  sqlMock.mockClear();
  calls = [];
  responseQueue = [];
  callCount = 0;
  requireSessionMock.mockResolvedValue(SESSION);
  requireCapabilityMock.mockResolvedValue({ key: 'people', config: {} });
});

describe('GET /api/hr/linkable-users — authorization', () => {
  it('rejects with 401 when there is no session', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await listLinkableUsers(getRequest(BASE_URL));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the People module is not enabled (module entitlement applies)', async () => {
    const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability');
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'));
    const res = await listLinkableUsers(getRequest(BASE_URL));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('an HR administrator is allowed', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    const res = await listLinkableUsers(getRequest(BASE_URL));
    expect(res.status).toBe(200);
  });

  it('a super_admin is allowed even if the People module is disabled for the organisation', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability');
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('ENTITLEMENT_DISABLED'));
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([]);
    const res = await listLinkableUsers(getRequest(BASE_URL));
    expect(res.status).toBe(200);
    expect(requireCapabilityMock).not.toHaveBeenCalled();
  });

  it('a manager (module-entitled, non-admin) is denied', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await listLinkableUsers(getRequest(BASE_URL));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a self-linked user is denied', async () => {
    resolveHrAccessContextMock.mockResolvedValue(SELF_ONLY_CTX);
    const res = await listLinkableUsers(getRequest(BASE_URL));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('an ordinary user (no HR administrator grant) is denied', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await listLinkableUsers(getRequest(BASE_URL));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/hr/linkable-users — tenant isolation', () => {
  it('scopes the query to the caller\'s active organisation', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    await listLinkableUsers(getRequest(BASE_URL));
    expect(calls[0].text).toContain('organisation_id');
    expect(calls[0].values).toContain('org-a');
  });

  it('super_admin remains scoped to their currently active organisation, never a different one', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([]);
    await listLinkableUsers(getRequest(BASE_URL));
    expect(calls[0].values).toContain('org-a');
    expect(resolveHrAccessContextMock).toHaveBeenCalledWith(expect.objectContaining({ organisationId: 'org-a', role: 'super_admin' }));
  });

  it('only filters by the active organisation and active status — no cross-org row could be returned by this query shape', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    await listLinkableUsers(getRequest(BASE_URL));
    expect(calls[0].text).toContain("u.organisation_id = ");
    expect(calls[0].text).toContain("u.status = ");
  });
});

describe('GET /api/hr/linkable-users — response minimization', () => {
  it('response contains ONLY the approved fields — no password/role/token/security metadata', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'user-2', name: 'Emma Palmer', email: 'emma@example.com', status: 'ACTIVE', linked_person_id: null }]);
    const res = await listLinkableUsers(getRequest(BASE_URL));
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    const keys = Object.keys(body.users[0]).sort();
    expect(keys).toEqual(['already_linked', 'email', 'id', 'linked_person_id', 'name', 'selectable'].sort());
  });

  it('never returns role, password, password_hash, email_verified, last_login_at, or preferences from the DB', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    await listLinkableUsers(getRequest(BASE_URL));
    const selectText = calls[0].text.toLowerCase();
    for (const forbidden of ['password', 'role', 'email_verified', 'last_login_at', 'preferences']) {
      expect(selectText).not.toContain(forbidden);
    }
  });

  it('the raw status enum is never exposed in the response — only the derived selectable boolean', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'user-2', name: 'Emma Palmer', email: 'emma@example.com', status: 'ACTIVE', linked_person_id: null }]);
    const res = await listLinkableUsers(getRequest(BASE_URL));
    const body = await res.json();
    expect(body.users[0]).not.toHaveProperty('status');
    expect(typeof body.users[0].selectable).toBe('boolean');
  });
});

describe('GET /api/hr/linkable-users — person_id (currently-linked-inactive-user legibility)', () => {
  it('with no person_id, the main query runs directly (no existence check call), still degrading to ACTIVE-only', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    await listLinkableUsers(getRequest(BASE_URL));
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("u.status = 'ACTIVE'");
  });

  it('a person_id belonging to another organisation is rejected with a 404 and never reaches the main query', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]); // isPersonInOrganisation() lookup returns no rows
    const res = await listLinkableUsers(getRequest(`${BASE_URL}?person_id=person-other-org`));
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(1); // only the isPersonInOrganisation() check ran, never the main SELECT
  });

  it('editing a person whose current linked user is still ACTIVE: that user is returned and selectable', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue(
      [{ exists: 1 }], // isPersonInOrganisation()
      [{ id: 'user-2', name: 'Emma Palmer', email: 'emma@example.com', status: 'ACTIVE', linked_person_id: 'person-1' }],
    );
    const res = await listLinkableUsers(getRequest(`${BASE_URL}?person_id=person-1`));
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0].selectable).toBe(true);
  });

  it('editing a person whose current linked user is now INACTIVE: that user is still returned, but not selectable as a new candidate', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue(
      [{ exists: 1 }],
      [{ id: 'user-2', name: 'Emma Palmer', email: 'emma@example.com', status: 'INACTIVE', linked_person_id: 'person-1' }],
    );
    const res = await listLinkableUsers(getRequest(`${BASE_URL}?person_id=person-1`));
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0].id).toBe('user-2');
    expect(body.users[0].selectable).toBe(false);
  });

  it('an unrelated INACTIVE user (not linked to the person being edited) is never returned', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ exists: 1 }], []); // the DB query itself excludes it; simulated here by an empty result
    const res = await listLinkableUsers(getRequest(`${BASE_URL}?person_id=person-1`));
    const body = await res.json();
    expect(body.users).toHaveLength(0);
    expect(calls[1].text).toContain('hp.id =');
  });

  it('an unrelated INVITED user is never returned', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ exists: 1 }], []);
    const res = await listLinkableUsers(getRequest(`${BASE_URL}?person_id=person-1`));
    const body = await res.json();
    expect(body.users).toHaveLength(0);
  });

  it('the person_id existence check is scoped to the caller\'s own organisation', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ exists: 1 }], []);
    await listLinkableUsers(getRequest(`${BASE_URL}?person_id=person-1`));
    expect(calls[0].text).toContain('organisation_id');
    expect(calls[0].values).toContain('org-a');
  });
});

describe('GET /api/hr/linkable-users — linkability', () => {
  it('an unlinked same-org active user has already_linked: false', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'user-2', name: 'Emma Palmer', email: 'emma@example.com', linked_person_id: null }]);
    const res = await listLinkableUsers(getRequest(BASE_URL));
    const body = await res.json();
    expect(body.users[0].already_linked).toBe(false);
    expect(body.users[0].linked_person_id).toBeNull();
  });

  it('a user already linked to a person has already_linked: true and the linked_person_id', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'user-2', name: 'Emma Palmer', email: 'emma@example.com', linked_person_id: 'person-9' }]);
    const res = await listLinkableUsers(getRequest(BASE_URL));
    const body = await res.json();
    expect(body.users[0].already_linked).toBe(true);
    expect(body.users[0].linked_person_id).toBe('person-9');
  });

  it('the query filters on active status, excluding inactive/invited users', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    await listLinkableUsers(getRequest(BASE_URL));
    expect(calls[0].text).toContain("'ACTIVE'");
  });

  it('no email/name/phone auto-matching logic exists — the query never joins or filters hr_people by email/name at all', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    await listLinkableUsers(getRequest(BASE_URL));
    expect(calls[0].text).not.toMatch(/work_email|first_name|last_name|phone/i);
  });

  it('the currently-linked user for the person being edited is still returned (never silently removed) so the UI can represent it', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ id: 'user-2', name: 'Emma Palmer', email: 'emma@example.com', linked_person_id: 'person-1' }]);
    const res = await listLinkableUsers(getRequest(BASE_URL));
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0].id).toBe('user-2');
  });
});
