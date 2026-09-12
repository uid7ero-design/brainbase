import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// HR-1 — behavioral coverage for GET/POST /api/hr/people and
// GET/PATCH /api/hr/people/[id]. Mocks three dependency layers directly
// (requireSession, requireCapability, resolveHrAccessContext) rather
// than re-deriving their own internals here — each is already covered
// by its own dedicated test suite (requireSessionStatusEnforcement.
// test.ts, dataEngine/capability tests, hrContextResolution.test.ts).
// This file focuses on what these routes themselves are responsible
// for: permission branching via lib/hr/access.ts, cross-org validation,
// field-tier-aware projection, and audit wiring.

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
const SELF_ONLY_CTX = (selfPersonId: string) => ({ organisationId: 'org-a', selfPersonId, isHrAdministrator: false, hasRestrictedHrAccess: false });
const NOBODY_CTX = { organisationId: 'org-a', selfPersonId: null, isHrAdministrator: false, hasRestrictedHrAccess: false };
const MANAGER_CTX = (selfPersonId: string) => ({ organisationId: 'org-a', selfPersonId, isHrAdministrator: false, hasRestrictedHrAccess: false });

function personRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'person-1', organisation_id: 'org-a', linked_user_id: null,
    first_name: 'Ada', last_name: 'Lovelace', preferred_name: null,
    work_email: 'ada@example.com', work_phone: '555-0100', job_title: 'Engineer',
    worker_type: 'employee', employment_status: 'active',
    team_id: null, manager_person_id: null, start_date: null, end_date: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    team_name: null, manager_first_name: null, manager_last_name: null,
    ...overrides,
  };
}

const { GET: listPeople, POST: createPerson } = await import('@/app/api/hr/people/route');
const { GET: getPerson, PATCH: patchPerson } = await import('@/app/api/hr/people/[id]/route');

function withParams(id: string) { return { params: Promise.resolve({ id }) }; }

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

// ── Authentication ──────────────────────────────────────────────────

describe('authentication', () => {
  it('GET /people rejects with 401 when there is no session, before any DB read', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await listPeople();
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('GET /people rejects with 401 when the session is stale (requireSession itself throws — covers INACTIVE/deleted/org-drifted users, already exhaustively tested in requireSessionStatusEnforcement.test.ts)', async () => {
    requireSessionMock.mockRejectedValue(new Error('Session invalid'));
    const res = await listPeople();
    expect(res.status).toBe(401);
  });

  it('POST /people rejects with 401 when there is no session, before any write', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B' }));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

// ── Module gating ────────────────────────────────────────────────────

describe('module gating', () => {
  it('GET /people rejects with 403 when the People module is not enabled for this organisation', async () => {
    const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability');
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'));
    const res = await listPeople();
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('POST /people rejects with 403 when the People module is not enabled, before any write', async () => {
    const { CapabilityAccessError } = await import('@/lib/capabilities/requireCapability');
    requireCapabilityMock.mockRejectedValue(new CapabilityAccessError('ENTITLEMENT_DISABLED'));
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B' }));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns 503 (not 403) when capability lookup itself fails — distinguishable from an ordinary "not entitled" denial', async () => {
    const { CapabilityDatabaseError } = await import('@/lib/capabilities/requireCapability');
    requireCapabilityMock.mockRejectedValue(new CapabilityDatabaseError());
    const res = await listPeople();
    expect(res.status).toBe(503);
  });
});

// ── Permissions ──────────────────────────────────────────────────────

describe('permissions — list (GET /people)', () => {
  it('an HR administrator sees every person in the organisation', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' }), personRow({ id: 'p2', first_name: 'Grace', last_name: 'Hopper' })]);
    const res = await listPeople();
    const body = await res.json();
    expect(body.people).toHaveLength(2);
  });

  // canManage is the ONLY signal the UI uses to decide whether to show
  // admin-only actions (e.g. "+ Add Person" in app/people/page.tsx) — it
  // must reflect the real ctx.isHrAdministrator value exactly, for both
  // true and false, and must never appear as anything but a plain
  // boolean (no user id, no grant record, nothing else about the
  // underlying entitlement).
  it('canManage is true for an HR administrator', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await listPeople();
    const body = await res.json();
    expect(body.canManage).toBe(true);
  });

  it('canManage is false for a self-only user, a manager, and a user with no HR relationship at all', async () => {
    for (const ctx of [SELF_ONLY_CTX('p1'), MANAGER_CTX('p1'), NOBODY_CTX]) {
      resolveHrAccessContextMock.mockResolvedValue(ctx);
      queue([personRow({ id: 'p1' })]);
      const res = await listPeople();
      const body = await res.json();
      expect(body.canManage).toBe(false);
    }
  });

  it('canManage carries no entitlement detail beyond the boolean itself — no user id, no grant id, no hr_administrators row shape', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await listPeople();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['canManage', 'people']);
  });

  it('a plain user with no linked person record and no admin/manager relationship sees an empty list, not an error', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    queue([personRow({ id: 'p1' }), personRow({ id: 'p2' })]);
    const res = await listPeople();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.people).toEqual([]);
  });

  it('a self-linked user (not HR admin, not anyone\'s manager) sees only their own record in the list', async () => {
    resolveHrAccessContextMock.mockResolvedValue(SELF_ONLY_CTX('p1'));
    queue([personRow({ id: 'p1' }), personRow({ id: 'p2' })]);
    const res = await listPeople();
    const body = await res.json();
    expect(body.people).toHaveLength(1);
    expect(body.people[0].id).toBe('p1');
  });

  it('a direct manager sees their own record and their direct report\'s record, but not an unrelated third person', async () => {
    resolveHrAccessContextMock.mockResolvedValue(MANAGER_CTX('p1'));
    queue([
      personRow({ id: 'p1' }),
      personRow({ id: 'p2', manager_person_id: 'p1' }),
      personRow({ id: 'p3', manager_person_id: 'someone-else' }),
    ]);
    const res = await listPeople();
    const body = await res.json();
    const ids = body.people.map((p: { id: string }) => p.id).sort();
    expect(ids).toEqual(['p1', 'p2']);
  });

  it('self-only view redacts confidential fields (work_email/work_phone) for a DIRECT MANAGER viewing a report — internal fields still show', async () => {
    resolveHrAccessContextMock.mockResolvedValue(MANAGER_CTX('p1'));
    queue([personRow({ id: 'p1' }), personRow({ id: 'p2', manager_person_id: 'p1', work_email: 'secret@x.com', work_phone: '555-9999' })]);
    const res = await listPeople();
    const body = await res.json();
    const report = body.people.find((p: { id: string }) => p.id === 'p2');
    expect(report.first_name).toBe('Ada'); // internal tier, shown
    expect(report.work_email).toBeUndefined(); // confidential tier, redacted for a manager
    expect(report.work_phone).toBeUndefined();
  });

  it('self view of one\'s OWN record includes confidential fields (work_email/work_phone)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(SELF_ONLY_CTX('p1'));
    queue([personRow({ id: 'p1', work_email: 'ada@example.com' })]);
    const res = await listPeople();
    const body = await res.json();
    expect(body.people[0].work_email).toBe('ada@example.com');
  });
});

describe('permissions — create (POST /people)', () => {
  it('a normal user (not HR administrator) cannot create a person', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B' }));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a self-linked user cannot create a person even for themself (creation is HR-administrator only, per lib/hr/access.ts having no self-creation path)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(SELF_ONLY_CTX('p1'));
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B' }));
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('an HR administrator can create a person', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'new-person' })]);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'Ada', last_name: 'Lovelace' }));
    expect(res.status).toBe(201);
  });
});

describe('permissions — edit (PATCH /people/[id])', () => {
  it('a normal user cannot edit another person\'s record', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { preferred_name: 'Hacked' }), withParams('p1'));
    expect(res.status).toBe(403);
  });

  it('a self-linked user CAN edit their own basic identity/contact fields', async () => {
    resolveHrAccessContextMock.mockResolvedValue(SELF_ONLY_CTX('p1'));
    queue([personRow({ id: 'p1' })], [personRow({ id: 'p1', preferred_name: 'Ada L.' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { preferred_name: 'Ada L.' }), withParams('p1'));
    expect(res.status).toBe(200);
  });

  it('a self-linked user CANNOT change their own employment_status/team/manager (HR-administrator-only fields)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(SELF_ONLY_CTX('p1'));
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { employment_status: 'ended' }), withParams('p1'));
    expect(res.status).toBe(403);
  });

  it('a self-linked user CANNOT change linked_user_id — linking is always HR-administrator-only', async () => {
    resolveHrAccessContextMock.mockResolvedValue(SELF_ONLY_CTX('p1'));
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'some-other-user' }), withParams('p1'));
    expect(res.status).toBe(403);
  });

  it('an HR administrator CAN change employment_status/team/manager', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })], [personRow({ id: 'p1', employment_status: 'ended' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { employment_status: 'ended' }), withParams('p1'));
    expect(res.status).toBe(200);
  });

  it('a direct manager cannot edit their report\'s record directly (canEditPerson excludes plain manager relationship)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(MANAGER_CTX('manager-1'));
    queue([personRow({ id: 'p1', manager_person_id: 'manager-1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { preferred_name: 'X' }), withParams('p1'));
    expect(res.status).toBe(403);
  });
});

// ── Field allowlist (regression guard for the exact production bug: the
// edit UI was sending the full fetched person object — including `id` —
// straight into the PATCH body; fixed in PersonForm.tsx, not here. These
// tests lock in that PATCH's own strict rejection is the reason that bug
// surfaced as a clean 400 rather than a silent no-op or a 500, and that
// this backend behavior must not be weakened as part of fixing it. ──────

describe('field allowlist (PATCH /people/[id]) — must not be weakened', () => {
  it('rejects `id` in the body exactly as it did in production (the client-side bug this phase fixes)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { id: 'p1', job_title: 'New Title' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Unknown or unsupported field: id');
  });

  it('still rejects other non-editable metadata fields (organisation_id, created_at, team_name) the same way', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    for (const field of ['organisation_id', 'created_at', 'team_name']) {
      queue([personRow({ id: 'p1' })]);
      const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { [field]: 'x' }), withParams('p1'));
      expect(res.status, `expected ${field} to be rejected`).toBe(400);
    }
  });

  it('a request with ONLY the allowlisted fields (no id/metadata) succeeds — the shape PersonForm now sends', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })], [personRow({ id: 'p1', job_title: 'New Title' })]);
    const res = await patchPerson(
      jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', {
        first_name: 'Ada', last_name: 'Lovelace', preferred_name: null,
        work_email: 'ada@example.com', work_phone: '555-0100', job_title: 'New Title',
        worker_type: 'employee', employment_status: 'active', team_id: null, manager_person_id: null,
      }),
      withParams('p1'),
    );
    expect(res.status).toBe(200);
  });
});

// ── Tenant isolation ─────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('GET /people/[id] returns 404 (not 403) for a valid person id belonging to a DIFFERENT organisation — the WHERE clause excludes it entirely', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]); // organisation_id filter means the cross-org row never comes back
    const res = await getPerson(asNextRequest(new Request('http://localhost/api/hr/people/org-b-person')), withParams('org-b-person'));
    expect(res.status).toBe(404);
    // Confirms organisation scoping was actually applied in the query.
    expect(calls[0].text).toContain('organisation_id');
    expect(calls[0].values).toContain('org-a');
  });

  it('PATCH /people/[id] cannot edit a person belonging to a different organisation (same 404-before-403 shape)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/org-b-person', 'PATCH', { preferred_name: 'X' }), withParams('org-b-person'));
    expect(res.status).toBe(404);
  });

  it('cannot assign a team belonging to a different organisation — isTeamInOrganisation\'s own org-scoped query returns no match', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]); // isTeamInOrganisation query finds nothing for this org
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', team_id: 'org-b-team' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/team/i);
  });

  it('cannot assign a manager belonging to a different organisation', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]); // isPersonInOrganisation query finds nothing for this org
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', manager_person_id: 'org-b-manager' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/manager/i);
  });

  it('cannot link a user belonging to a different organisation', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([]); // isUserInOrganisation query finds nothing for this org
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', linked_user_id: 'org-b-user' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/linked user/i);
  });

  // PATCH is a genuinely separate route/code path from POST — even
  // though both call the same lib/hr/validation.ts helpers, each write
  // path must be proven independently, not assumed covered by POST's
  // own tests. The database itself does NOT reject any of these three
  // (see scripts/tests/verify-hr-people-foundation-migration.sh's own
  // "DOCUMENTED LIMITATION" section) — same-organisation enforcement
  // for team_id/manager_person_id/linked_user_id is entirely this
  // application-layer validation, so these PATCH-path tests are what
  // actually close the gap a direct-SQL bypass would otherwise leave.

  it('PATCH cannot reassign a person to a team belonging to a different organisation', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })], []); // loadPerson succeeds; isTeamInOrganisation finds nothing for this org
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { team_id: 'org-b-team' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/team/i);
    expect(calls.some(c => c.text.includes('UPDATE hr_people'))).toBe(false);
  });

  it('PATCH cannot reassign a person to a manager belonging to a different organisation', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })], []); // loadPerson succeeds; isPersonInOrganisation finds nothing for this org
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { manager_person_id: 'org-b-manager' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/manager/i);
    expect(calls.some(c => c.text.includes('UPDATE hr_people'))).toBe(false);
  });

  it('PATCH cannot link a person to a user belonging to a different organisation', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })], []); // loadPerson succeeds; isUserInOrganisation finds nothing for this org
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'org-b-user' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/linked user/i);
    expect(calls.some(c => c.text.includes('UPDATE hr_people'))).toBe(false);
  });
});

// ── Data behaviour ───────────────────────────────────────────────────

describe('data behaviour', () => {
  it('create requires first_name and last_name', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: '  ' }));
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('create defaults worker_type to employee and employment_status to active when omitted', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', worker_type: 'employee', employment_status: 'active' })]);
    await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B' }));
    const insertCall = calls.find(c => c.text.includes('INSERT INTO hr_people'));
    expect(insertCall!.values).toContain('employee');
    expect(insertCall!.values).toContain('active');
  });

  it('create rejects an invalid worker_type', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', worker_type: 'ceo' }));
    expect(res.status).toBe(400);
  });

  it('create rejects an invalid employment_status', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', employment_status: 'retired' }));
    expect(res.status).toBe(400);
  });

  it('a valid team assignment succeeds', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ exists: true }], [personRow({ id: 'p1', team_id: 'team-a' })]);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', team_id: 'team-a' }));
    expect(res.status).toBe(201);
  });

  it('a valid manager assignment succeeds', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ exists: true }], [personRow({ id: 'p2', manager_person_id: 'p1' })]);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', manager_person_id: 'p1' }));
    expect(res.status).toBe(201);
  });

  it('a valid explicit user link succeeds', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ exists: true }], [personRow({ id: 'p1', linked_user_id: 'user-2' })]);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', linked_user_id: 'user-2' }));
    expect(res.status).toBe(201);
  });

  it('no automatic email/name matching ever occurs — creating a person with an email matching an existing user does NOT set linked_user_id unless explicitly provided', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', linked_user_id: null, work_email: 'existing-user@example.com' })]);
    await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', work_email: 'existing-user@example.com' }));
    const insertCall = calls.find(c => c.text.includes('INSERT INTO hr_people'));
    expect(insertCall!.values).toContain(null); // linked_user_id bound as null
    // No lookup-by-email query of any kind was ever issued.
    expect(calls.some(c => c.text.toLowerCase().includes('work_email') && c.text.toUpperCase().includes('SELECT'))).toBe(false);
  });

  it('PATCH rejects manager_person_id equal to the person\'s own id (self-management), before hitting the database CHECK constraint', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { manager_person_id: 'p1' }), withParams('p1'));
    expect(res.status).toBe(400);
  });

  it('unlinking a user (linked_user_id: null) does not delete the person record — it is an ordinary field update', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', linked_user_id: 'user-2' })], [personRow({ id: 'p1', linked_user_id: null })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: null }), withParams('p1'));
    expect(res.status).toBe(200);
    expect(calls.some(c => c.text.includes('DELETE'))).toBe(false);
  });
});

// ── Audit ────────────────────────────────────────────────────────────

describe('audit', () => {
  it('create generates exactly one hr_person.created audit event', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'Ada', last_name: 'Lovelace' }));
    expect(logHrEventMock).toHaveBeenCalledTimes(1);
    const [actor, entry] = logHrEventMock.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(actor).toMatchObject({ organisationId: 'org-a', userId: 'user-1' });
    expect(entry).toMatchObject({ action: 'hr_person.created', resourceType: 'hr_person', resourceId: 'p1' });
  });

  it('update generates exactly one audit event with before/after state for the changed fields only', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', preferred_name: null })], [personRow({ id: 'p1', preferred_name: 'Ada L.' })]);
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { preferred_name: 'Ada L.' }), withParams('p1'));
    expect(logHrEventMock).toHaveBeenCalledTimes(1);
    const [, entry] = logHrEventMock.mock.calls[0] as [Record<string, unknown>, { beforeState: Record<string, unknown>; afterState: Record<string, unknown> }];
    expect(entry.beforeState).toEqual({ preferred_name: null });
    expect(entry.afterState).toEqual({ preferred_name: 'Ada L.' });
  });

  it('a rejected create (permission denied) writes NO audit event', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B' }));
    expect(logHrEventMock).not.toHaveBeenCalled();
  });

  it('a rejected update (permission denied) writes NO audit event', async () => {
    resolveHrAccessContextMock.mockResolvedValue(NOBODY_CTX);
    queue([personRow({ id: 'p1' })]);
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { preferred_name: 'X' }), withParams('p1'));
    expect(logHrEventMock).not.toHaveBeenCalled();
  });

  it('an authentication failure writes NO audit event', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));
    await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B' }));
    expect(logHrEventMock).not.toHaveBeenCalled();
  });

  it('no sensitive payload (e.g. work_email/work_phone) appears in the audit call for a plain identity-field update', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', preferred_name: null })], [personRow({ id: 'p1', preferred_name: 'Ada L.' })]);
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { preferred_name: 'Ada L.' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(JSON.stringify(entry)).not.toMatch(/work_email|work_phone/);
  });

  // HR-1 addition — these tests exercise the REAL PATCH/POST route logic
  // (field-diff construction, action-name branching), but this file mocks
  // logHrEvent itself (see vi.mock('@/lib/hr/auditLog', ...) above), so the
  // actual redaction of work_email/work_phone (which happens inside the
  // REAL logHrEvent's redactState(), not here) is proven separately in
  // tests/containment/hrAuditLog.test.ts against the unmocked
  // implementation. What's proven here is that the route itself still
  // builds the correct field-diff and picks the correct action name —
  // i.e. that fixing the redaction did not require or accidentally cause
  // any change to route-level payload construction or naming.

  // Action-naming fix: a PATCH touching ANY of the 7 EMPLOYMENT_FIELDS
  // (job_title, worker_type, team_id, manager_person_id, start_date,
  // end_date, employment_status) used to resolve to
  // 'hr_person.employment_status_changed' as a group, even when
  // employment_status itself wasn't the field that changed — e.g. a
  // job_title-only PATCH incorrectly logged as an "employment status
  // changed" event. Corrected in app/api/hr/people/[id]/route.ts: only
  // an actual employment_status change (or linked_user_id, which takes
  // precedence — see the mixed-PATCH tests below) uses a specific
  // action name; every other single-field change resolves to the
  // generic 'hr_person.updated'. permission enforcement
  // (canManageEmployment gating ALL 7 fields) is unaffected — these
  // tests only assert the resulting action name.

  it('a job_title-only PATCH logs only job_title in before/after state and resolves to hr_person.updated (job_title alone is NOT an employment_status change)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', job_title: 'Old title' })], [personRow({ id: 'p1', job_title: 'New title' })]);
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { job_title: 'New title' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string; beforeState: Record<string, unknown>; afterState: Record<string, unknown> }];
    expect(entry.beforeState).toEqual({ job_title: 'Old title' });
    expect(entry.afterState).toEqual({ job_title: 'New title' });
    expect(entry.action).toBe('hr_person.updated');
  });

  it('a worker_type-only PATCH resolves to hr_person.updated', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', worker_type: 'employee' })], [personRow({ id: 'p1', worker_type: 'contractor' })]);
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { worker_type: 'contractor' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string }];
    expect(entry.action).toBe('hr_person.updated');
  });

  it('a team_id-only PATCH resolves to hr_person.updated', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue(
      [personRow({ id: 'p1', team_id: null })],
      [{ exists: true }], // isTeamInOrganisation
      [personRow({ id: 'p1', team_id: 'team-a' })],
    );
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { team_id: 'team-a' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string }];
    expect(entry.action).toBe('hr_person.updated');
  });

  it('a manager_person_id-only PATCH resolves to hr_person.updated', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue(
      [personRow({ id: 'p1', manager_person_id: null })],
      [{ exists: true }], // isPersonInOrganisation
      [personRow({ id: 'p1', manager_person_id: 'p2' })],
    );
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { manager_person_id: 'p2' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string }];
    expect(entry.action).toBe('hr_person.updated');
  });

  it('a start_date-only PATCH resolves to hr_person.updated', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', start_date: null })], [personRow({ id: 'p1', start_date: '2026-01-01' })]);
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '2026-01-01' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string }];
    expect(entry.action).toBe('hr_person.updated');
  });

  it('an end_date-only PATCH resolves to hr_person.updated', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', end_date: null })], [personRow({ id: 'p1', end_date: '2026-06-30' })]);
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { end_date: '2026-06-30' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string }];
    expect(entry.action).toBe('hr_person.updated');
  });

  it('a preferred_name-only PATCH resolves to hr_person.updated', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', preferred_name: null })], [personRow({ id: 'p1', preferred_name: 'Ada L.' })]);
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { preferred_name: 'Ada L.' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string }];
    expect(entry.action).toBe('hr_person.updated');
  });

  it('employment_status action naming remains correct after the redaction fix', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', employment_status: 'active' })], [personRow({ id: 'p1', employment_status: 'ended' })]);
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { employment_status: 'ended' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string }];
    expect(entry.action).toBe('hr_person.employment_status_changed');
  });

  it('linked_user_id action naming remains correct after the redaction fix', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', linked_user_id: null })], [{ id: 'user-2', organisation_id: 'org-a' }], [personRow({ id: 'p1', linked_user_id: 'user-2' })]);
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'user-2' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string }];
    expect(entry.action).toBe('hr_person.linked_user_changed');
  });

  // Mixed-field precedence: one action per audit row, so when several
  // field groups change in the same PATCH, the route must pick a single
  // label. Precedence (most to least specific): linked_user_id >
  // employment_status > everything else ('updated'). beforeState/
  // afterState always include every changed field regardless of which
  // label wins — precedence only affects the `action` string, never
  // which fields are recorded.

  it('mixed PATCH: employment_status + job_title resolves to hr_person.employment_status_changed (employment_status wins over an ordinary employment field)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue(
      [personRow({ id: 'p1', employment_status: 'active', job_title: 'Old title' })],
      [personRow({ id: 'p1', employment_status: 'ended', job_title: 'New title' })],
    );
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { employment_status: 'ended', job_title: 'New title' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string; afterState: Record<string, unknown> }];
    expect(entry.action).toBe('hr_person.employment_status_changed');
    expect(entry.afterState).toEqual({ employment_status: 'ended', job_title: 'New title' });
  });

  it('mixed PATCH: employment_status + preferred_name resolves to hr_person.employment_status_changed (employment_status wins over an identity field too)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue(
      [personRow({ id: 'p1', employment_status: 'active', preferred_name: null })],
      [personRow({ id: 'p1', employment_status: 'ended', preferred_name: 'Ada L.' })],
    );
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { employment_status: 'ended', preferred_name: 'Ada L.' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string; afterState: Record<string, unknown> }];
    expect(entry.action).toBe('hr_person.employment_status_changed');
    expect(entry.afterState).toEqual({ employment_status: 'ended', preferred_name: 'Ada L.' });
  });

  it('mixed PATCH: employment_status + linked_user_id resolves to hr_person.linked_user_changed (linked_user_id outranks employment_status)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue(
      [personRow({ id: 'p1', employment_status: 'active', linked_user_id: null })],
      [{ id: 'user-2', organisation_id: 'org-a' }], // isUserInOrganisation
      [personRow({ id: 'p1', employment_status: 'ended', linked_user_id: 'user-2' })],
    );
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { employment_status: 'ended', linked_user_id: 'user-2' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string; afterState: Record<string, unknown> }];
    expect(entry.action).toBe('hr_person.linked_user_changed');
    expect(entry.afterState).toEqual({ employment_status: 'ended', linked_user_id: 'user-2' });
  });

  it('mixed PATCH: linked_user_id + job_title resolves to hr_person.linked_user_changed (linked_user_id outranks an ordinary employment field too)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue(
      [personRow({ id: 'p1', linked_user_id: null, job_title: 'Old title' })],
      [{ id: 'user-2', organisation_id: 'org-a' }], // isUserInOrganisation
      [personRow({ id: 'p1', linked_user_id: 'user-2', job_title: 'New title' })],
    );
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'user-2', job_title: 'New title' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string; afterState: Record<string, unknown> }];
    expect(entry.action).toBe('hr_person.linked_user_changed');
    expect(entry.afterState).toEqual({ linked_user_id: 'user-2', job_title: 'New title' });
  });

  it('a mixed PATCH (job_title + work_email together) still includes job_title in the diff handed to logHrEvent — the route never drops other changed fields because a sensitive one changed too', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue(
      [personRow({ id: 'p1', job_title: 'Old title', work_email: 'old@example.com' })],
      [personRow({ id: 'p1', job_title: 'New title', work_email: 'new@example.com' })],
    );
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { job_title: 'New title', work_email: 'new@example.com' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { beforeState: Record<string, unknown>; afterState: Record<string, unknown> }];
    expect(entry.afterState.job_title).toBe('New title');
    expect(entry.afterState.work_email).toBe('new@example.com'); // raw here — this layer is pre-redaction; see hrAuditLog.test.ts
  });

  it('hr_person.created still never includes work_email/work_phone in afterState, even when both are supplied on create', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', work_email: 'ada@example.com', work_phone: '555-0100' })]);
    await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', {
      first_name: 'Ada', last_name: 'Lovelace', work_email: 'ada@example.com', work_phone: '555-0100',
    }));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { afterState: Record<string, unknown> }];
    expect(entry.afterState).not.toHaveProperty('work_email');
    expect(entry.afterState).not.toHaveProperty('work_phone');
  });
});
