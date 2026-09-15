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
// HR-2 — the exact shape lib/hr/context.ts's resolveHrAccessContext()
// now resolves for a real super_admin caller (proven independently in
// hrContextResolution.test.ts): isHrAdministrator/hasRestrictedHrAccess
// both true, with NO hr_administrators row required. This file mocks
// resolveHrAccessContext entirely (see its own header comment), so
// these tests supply that already-proven shape directly rather than
// re-deriving it — consistent with how HR_ADMIN_CTX/NOBODY_CTX/etc. are
// already used throughout this file.
const SUPER_ADMIN_CTX = { organisationId: 'org-a', selfPersonId: null, isHrAdministrator: true, hasRestrictedHrAccess: true };
const SUPER_ADMIN_SESSION = { ...SESSION, role: 'super_admin' };

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

// Mirrors exactly what the real PersonForm client sends on every save
// (app/people/_components/PersonForm.tsx's own EDITABLE_FIELDS) — all 10
// editable fields, always, seeded from the existing row's current values
// unless overridden. This is the realistic PATCH body shape; the many
// single-key bodies used elsewhere in this file predate the discovery
// that PersonForm never actually sends a sparse body, and remain valid
// as targeted route-level checks, but this shape is what production
// traffic actually looks like and is what the actual-change-detection
// tests below deliberately exercise.
function fullShapeBody(existing: ReturnType<typeof personRow>, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    first_name: existing.first_name,
    last_name: existing.last_name,
    preferred_name: existing.preferred_name,
    work_email: existing.work_email,
    work_phone: existing.work_phone,
    job_title: existing.job_title,
    worker_type: existing.worker_type,
    employment_status: existing.employment_status,
    team_id: existing.team_id,
    manager_person_id: existing.manager_person_id,
    ...overrides,
  };
}

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

// ── HR-2 — super_admin full HR access ───────────────────────────────
//
// super_admin gets full HR authority via SUPER_ADMIN_CTX (isHrAdministrator:
// true, hasRestrictedHrAccess: true) with NO hr_administrators row —
// resolveHrAccessContext() itself is mocked in this file (see header
// comment), so these tests prove the ROUTE correctly grants every
// action once handed that context, exactly like HR_ADMIN_CTX's own
// tests prove for a real grant-backed HR administrator. Cross-org
// validation (isTeamInOrganisation/isPersonInOrganisation/
// isUserInOrganisation, and the organisation_id-scoped loadPerson WHERE
// clause) is NOT mocked anywhere in this file — it's real code calling
// the real (sql-mocked) lib/hr/validation.ts helpers — so proving it
// still rejects cross-org references under a super_admin context is a
// genuine test of the actual enforcement path, not a re-assertion of a
// mock.

describe('HR-2 — super_admin full HR access', () => {
  it('super_admin can list people with zero hr_administrators rows', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await listPeople();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canManage).toBe(true);
  });

  it('super_admin can view a person', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await getPerson(asNextRequest(new Request('http://localhost/api/hr/people/p1')), withParams('p1'));
    expect(res.status).toBe(200);
  });

  it('super_admin can create a person', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([personRow({ id: 'new-person' })]);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'Ada', last_name: 'Lovelace' }));
    expect(res.status).toBe(201);
  });

  it('super_admin can edit identity/contact fields', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([personRow({ id: 'p1', preferred_name: null })], [personRow({ id: 'p1', preferred_name: 'Ada L.' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { preferred_name: 'Ada L.' }), withParams('p1'));
    expect(res.status).toBe(200);
  });

  it('super_admin can edit employment fields', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([personRow({ id: 'p1', employment_status: 'active' })], [personRow({ id: 'p1', employment_status: 'ended' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { employment_status: 'ended' }), withParams('p1'));
    expect(res.status).toBe(200);
  });

  it('super_admin can change linked_user_id', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([personRow({ id: 'p1', linked_user_id: null })], [{ id: 'user-2', organisation_id: 'org-a' }], [personRow({ id: 'p1', linked_user_id: 'user-2' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'user-2' }), withParams('p1'));
    expect(res.status).toBe(200);
  });

  it('super_admin still cannot access a person belonging to a DIFFERENT organisation (loadPerson\'s organisation_id WHERE clause is unaffected by role)', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([]); // organisation_id filter excludes the cross-org row entirely
    const res = await getPerson(asNextRequest(new Request('http://localhost/api/hr/people/org-b-person')), withParams('org-b-person'));
    expect(res.status).toBe(404);
    expect(calls[0].values).toContain('org-a'); // scoped to the super_admin's ACTIVE org, not a different one
  });

  it('super_admin still cannot assign a team belonging to a different organisation', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([]); // isTeamInOrganisation finds nothing for this org
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', team_id: 'org-b-team' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/team/i);
  });

  it('super_admin still cannot assign a manager belonging to a different organisation', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([]); // isPersonInOrganisation finds nothing for this org
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', manager_person_id: 'org-b-manager' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/manager/i);
  });

  it('super_admin still cannot link a user belonging to a different organisation', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([]); // isUserInOrganisation finds nothing for this org
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', linked_user_id: 'org-b-user' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/linked user/i);
  });

  it('super_admin PATCH still cannot reassign a person to a cross-org team/manager', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    queue([personRow({ id: 'p1' })], []); // loadPerson succeeds; isTeamInOrganisation finds nothing for this org
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { team_id: 'org-b-team' }), withParams('p1'));
    expect(res.status).toBe(400);
    expect(calls.some(c => c.text.includes('UPDATE hr_people'))).toBe(false);
  });

  it('super_admin does not require a People module entitlement row — requireHrCapability bypasses the module check entirely', async () => {
    requireSessionMock.mockResolvedValue(SUPER_ADMIN_SESSION);
    resolveHrAccessContextMock.mockResolvedValue(SUPER_ADMIN_CTX);
    requireCapabilityMock.mockRejectedValue(new Error('People module not enabled for this organisation'));
    queue([personRow({ id: 'p1' })]);
    const res = await listPeople();
    expect(res.status).toBe(200);
    expect(requireCapabilityMock).not.toHaveBeenCalled();
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

// ── HR-2 Step 1B — archived-team assignment rules ───────────────────
//
// Policy: a person may REMAIN on, or LEAVE, an archived team; a person
// may never be NEWLY assigned or MOVED onto an archived team. Create has
// no "existing" assignment to compare against, so any non-null team_id
// there is always treated as a new assignment. PATCH only applies the
// archived check when team_id is an ACTUAL value change — resubmitting
// the person's current (possibly archived) team_id, even alongside a
// real edit to an unrelated field, must succeed unchanged (the same
// discipline PR #212 established for changedFields/audit content,
// applied here to an authorization decision instead).

describe('archived-team assignment rules', () => {
  it('create rejects a team_id pointing at an archived team', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([{ exists: true }], []); // isTeamInOrganisation succeeds; isTeamActive finds nothing (archived)
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', team_id: 'archived-team' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('team_archived');
    expect(calls.some(c => c.text.includes('INSERT INTO hr_people'))).toBe(false);
  });

  it('PATCH rejects moving a person onto a DIFFERENT, archived team', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    // existing team_id is 'team-b' (a different, active team); the
    // request moves to 'archived-team' — an actual change, so
    // isTeamActive applies and fails.
    queue([personRow({ id: 'p1', team_id: 'team-b' })], [{ exists: true }], []);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { team_id: 'archived-team' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('team_archived');
    expect(calls.some(c => c.text.includes('UPDATE hr_people'))).toBe(false);
  });

  it('PATCH allows resubmitting the SAME (possibly archived) team_id unchanged, alongside a real edit to an unrelated field', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', team_id: 'archived-team', job_title: 'Engineer' });
    // team_id resubmitted identically to existing.team_id — isTeamActive
    // must never be called (only 3 sql calls total: loadPerson,
    // isTeamInOrganisation, UPDATE — never a 4th, archived-state call).
    queue([existing], [{ exists: true }], [personRow({ id: 'p1', team_id: 'archived-team', job_title: 'New Title' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { team_id: 'archived-team', job_title: 'New Title' }), withParams('p1'));
    expect(res.status).toBe(200);
    expect(sqlMock).toHaveBeenCalledTimes(3);
  });

  it('PATCH allows clearing team_id (moving to null) while currently on an archived team', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', team_id: 'archived-team' });
    // team_id: null skips both isTeamInOrganisation and isTeamActive
    // entirely (both guarded by `if (teamId && ...)`) — only loadPerson
    // and UPDATE run.
    queue([existing], [personRow({ id: 'p1', team_id: null })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { team_id: null }), withParams('p1'));
    expect(res.status).toBe(200);
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it('PATCH allows moving from an archived team onto a DIFFERENT, active team', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', team_id: 'archived-team' });
    queue([existing], [{ exists: true }], [{ exists: true }], [personRow({ id: 'p1', team_id: 'active-team' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { team_id: 'active-team' }), withParams('p1'));
    expect(res.status).toBe(200);
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
    // isTeamInOrganisation, then HR-2 Step 1B's isTeamActive (create has
    // no "existing" to compare against, so it always applies), then INSERT.
    queue([{ exists: true }], [{ exists: true }], [personRow({ id: 'p1', team_id: 'team-a' })]);
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
      [{ exists: true }], // HR-2 Step 1B — isTeamActive (team_id is an actual change: null -> 'team-a')
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
      [{ would_cycle: false }], // HR-2 Step 1C — wouldCreateManagerCycle (manager_person_id is an actual change: null -> 'p2')
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

// ── Actual-change detection (realistic full-shape PersonForm body) ─────
//
// Root cause this section regression-guards: the real PersonForm client
// always submits all 10 editable fields on every save (see
// fullShapeBody() above), not just the field(s) the user actually
// edited. Every test above this point used a deliberately sparse,
// single-key (or few-key) body — which happens to already be a true
// value diff by construction, so those tests never caught that the
// route's OWN change-detection was based on request-body key PRESENCE
// (providedFields), not actual DB-value differences. In production, a
// full-shape PATCH where only work_email genuinely changed produced
// audit rows containing every one of the other 9 fields' UNCHANGED
// current values, and — because `employment_status` is always present
// in that body shape — every such edit was mislabeled
// 'hr_person.employment_status_changed' regardless of what actually
// changed. Fixed via `changedFields` in app/api/hr/people/[id]/route.ts
// (a real diff against `existing`, computed after all permission/
// validation checks below have already run against the REQUESTED
// fields — see that variable's own comment).
describe('actual-change detection (full-shape PersonForm body)', () => {
  it('1. full-shape PATCH where only work_email differs: action=updated, audit state contains only work_email', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1' });
    const updated = personRow({ id: 'p1', work_email: 'new@example.com' });
    queue([existing], [updated]);
    await patchPerson(
      jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', fullShapeBody(existing, { work_email: 'new@example.com' })),
      withParams('p1'),
    );
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string; beforeState: Record<string, unknown>; afterState: Record<string, unknown> }];
    expect(entry.action).toBe('hr_person.updated');
    expect(entry.beforeState).toEqual({ work_email: 'ada@example.com' });
    expect(entry.afterState).toEqual({ work_email: 'new@example.com' });
  });

  it('2. full-shape PATCH where employment_status is present but UNCHANGED and job_title differs: action=updated, only job_title audited', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1' }); // employment_status: 'active'
    const updated = personRow({ id: 'p1', job_title: 'New title' });
    queue([existing], [updated]);
    await patchPerson(
      jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', fullShapeBody(existing, { job_title: 'New title', employment_status: 'active' })),
      withParams('p1'),
    );
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string; beforeState: Record<string, unknown>; afterState: Record<string, unknown> }];
    expect(entry.action).toBe('hr_person.updated');
    expect(entry.beforeState).toEqual({ job_title: 'Engineer' });
    expect(entry.afterState).toEqual({ job_title: 'New title' });
  });

  it('3. full-shape PATCH where only job_title differs: action=updated, only job_title in before/after', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1' });
    const updated = personRow({ id: 'p1', job_title: 'New title' });
    queue([existing], [updated]);
    await patchPerson(
      jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', fullShapeBody(existing, { job_title: 'New title' })),
      withParams('p1'),
    );
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string; beforeState: Record<string, unknown>; afterState: Record<string, unknown> }];
    expect(entry.action).toBe('hr_person.updated');
    expect(Object.keys(entry.beforeState)).toEqual(['job_title']);
    expect(Object.keys(entry.afterState)).toEqual(['job_title']);
  });

  it('4. full-shape PATCH where employment_status actually differs: action=employment_status_changed', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1' }); // employment_status: 'active'
    const updated = personRow({ id: 'p1', employment_status: 'ended' });
    queue([existing], [updated]);
    await patchPerson(
      jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', fullShapeBody(existing, { employment_status: 'ended' })),
      withParams('p1'),
    );
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string }];
    expect(entry.action).toBe('hr_person.employment_status_changed');
  });

  it('5. linked_user_id actually differs: action=linked_user_changed', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', linked_user_id: null });
    const updated = personRow({ id: 'p1', linked_user_id: 'user-2' });
    queue([existing], [{ id: 'user-2', organisation_id: 'org-a' }], [updated]);
    await patchPerson(
      jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'user-2' }),
      withParams('p1'),
    );
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string }];
    expect(entry.action).toBe('hr_person.linked_user_changed');
  });

  it('6. job_title + employment_status both actually differ: employment_status_changed wins, both actual changed fields appear in audit state', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1' });
    const updated = personRow({ id: 'p1', job_title: 'New title', employment_status: 'ended' });
    queue([existing], [updated]);
    await patchPerson(
      jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', fullShapeBody(existing, { job_title: 'New title', employment_status: 'ended' })),
      withParams('p1'),
    );
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string; beforeState: Record<string, unknown>; afterState: Record<string, unknown> }];
    expect(entry.action).toBe('hr_person.employment_status_changed');
    expect(entry.beforeState).toEqual({ job_title: 'Engineer', employment_status: 'active' });
    expect(entry.afterState).toEqual({ job_title: 'New title', employment_status: 'ended' });
  });

  it('7. linked_user_id + another field actually differ: linked_user_changed wins, all actual changed fields remain present in audit state', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', linked_user_id: null });
    const updated = personRow({ id: 'p1', linked_user_id: 'user-2', job_title: 'New title' });
    queue([existing], [{ id: 'user-2', organisation_id: 'org-a' }], [updated]);
    await patchPerson(
      jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'user-2', job_title: 'New title' }),
      withParams('p1'),
    );
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { action: string; beforeState: Record<string, unknown>; afterState: Record<string, unknown> }];
    expect(entry.action).toBe('hr_person.linked_user_changed');
    expect(entry.beforeState).toEqual({ linked_user_id: null, job_title: 'Engineer' });
    expect(entry.afterState).toEqual({ linked_user_id: 'user-2', job_title: 'New title' });
  });

  it('8. true full-shape no-op PATCH: success response, no UPDATE, no updated_at bump, no audit event', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1' });
    queue([existing]); // only loadPerson — no UPDATE should be issued
    const res = await patchPerson(
      jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', fullShapeBody(existing)),
      withParams('p1'),
    );
    expect(res.status).toBe(200);
    expect(logHrEventMock).not.toHaveBeenCalled();
    expect(calls.length).toBe(1); // loadPerson only — no UPDATE ... SET ... issued
    expect(calls.some(c => c.text.includes('UPDATE hr_people'))).toBe(false);
  });

  it('9. permission checks still use requested fields — a self-only (non-admin) caller submitting an unchanged employment_status is still rejected', async () => {
    resolveHrAccessContextMock.mockResolvedValue(SELF_ONLY_CTX('p1'));
    const existing = personRow({ id: 'p1' });
    queue([existing]); // rejected before any further query
    const res = await patchPerson(
      jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', fullShapeBody(existing)),
      withParams('p1'),
    );
    expect(res.status).toBe(403);
    expect(logHrEventMock).not.toHaveBeenCalled();
  });
});

// ── HR-2 Step 1C — manager-cycle protection ─────────────────────────
//
// wouldCreateManagerCycle() (lib/hr/reportingLines.ts) is fully mocked
// here via the same `sql` mock every other DB call in this file already
// goes through — these tests prove the ROUTE's wiring (when to call it,
// how its boolean result maps to a response, that it is skipped exactly
// when PR #212 no-op discipline requires). The recursive CTE's own
// graph-walking correctness (2/3/4+-node cycles, pre-existing corrupt
// cycles terminating safely, org scoping, a 20-hop chain) was
// independently verified against a real disposable PostgreSQL database
// — see tests/containment/hrReportingLines.test.ts's own header comment
// and this phase's report for the full scenario list.

describe('manager-cycle protection (PATCH manager_person_id)', () => {
  it('rejects an assignment that would create a 2-node cycle (B would report to A, who already reports to B)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', manager_person_id: 'p-old-manager' });
    queue([existing], [{ exists: true }], [{ would_cycle: true }]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { manager_person_id: 'p-new-manager' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('manager_cycle');
    expect(calls.some(c => c.text.includes('UPDATE hr_people'))).toBe(false);
  });

  it('rejects an assignment that would create a 3-node cycle (A->B->C, C would then report to A)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p-c', manager_person_id: null });
    queue([existing], [{ exists: true }], [{ would_cycle: true }]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p-c', 'PATCH', { manager_person_id: 'p-a' }), withParams('p-c'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('manager_cycle');
  });

  it('rejects an assignment that would create a longer (4+-node) cycle', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p-d', manager_person_id: null });
    queue([existing], [{ exists: true }], [{ would_cycle: true }]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p-d', 'PATCH', { manager_person_id: 'p-a' }), withParams('p-d'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('manager_cycle');
  });

  it('accepts a valid, non-cyclic same-org manager assignment', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', manager_person_id: 'p-old-manager' });
    queue([existing], [{ exists: true }], [{ would_cycle: false }], [personRow({ id: 'p1', manager_person_id: 'p-new-manager' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { manager_person_id: 'p-new-manager' }), withParams('p1'));
    expect(res.status).toBe(200);
  });

  it('accepts clearing the manager (-> null), with zero cycle-check queries issued', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', manager_person_id: 'p-old-manager' });
    queue([existing], [personRow({ id: 'p1', manager_person_id: null })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { manager_person_id: null }), withParams('p1'));
    expect(res.status).toBe(200);
    expect(sqlMock).toHaveBeenCalledTimes(2); // loadPerson, UPDATE only — no isPersonInOrganisation, no cycle check
  });

  it('same-manager resubmission (no actual change) does not call the cycle-check query, and true-no-ops', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', manager_person_id: 'p-same-manager' });
    queue([existing], [{ exists: true }]); // loadPerson, isPersonInOrganisation only — no 3rd (cycle) response needed
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { manager_person_id: 'p-same-manager' }), withParams('p1'));
    expect(res.status).toBe(200);
    expect(sqlMock).toHaveBeenCalledTimes(2); // no cycle query, no UPDATE (true no-op)
    expect(logHrEventMock).not.toHaveBeenCalled();
  });

  it('same-manager resubmission alongside a real, unrelated field change still succeeds and still never calls the cycle-check query', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', manager_person_id: 'p-same-manager', job_title: 'Old Title' });
    queue([existing], [{ exists: true }], [personRow({ id: 'p1', manager_person_id: 'p-same-manager', job_title: 'New Title' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { manager_person_id: 'p-same-manager', job_title: 'New Title' }), withParams('p1'));
    expect(res.status).toBe(200);
    expect(sqlMock).toHaveBeenCalledTimes(3); // loadPerson, isPersonInOrganisation, UPDATE — no cycle query
  });

  it('direct self-management remains rejected exactly as before (unchanged by this phase)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { manager_person_id: 'p1' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('A person cannot manage themselves.');
    // Only loadPerson ran (needed to know existing.id for the self-check
    // itself) — rejected before isPersonInOrganisation, before any
    // cycle-check query, and before any UPDATE, same as before this phase.
    expect(sqlMock).toHaveBeenCalledTimes(1);
    expect(calls.some(c => c.text.includes('UPDATE hr_people'))).toBe(false);
  });

  it('cross-org manager assignment remains rejected (isPersonInOrganisation unchanged, cycle check never reached)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })], []); // isPersonInOrganisation finds nothing for this org
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { manager_person_id: 'org-b-manager' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/manager/i);
    expect(calls.some(c => c.text.includes('UPDATE hr_people'))).toBe(false);
  });

  it('manager read visibility remains direct-only (isDirectManager, unaffected by cycle protection) — a skip-level manager still cannot view confidential fields', async () => {
    resolveHrAccessContextMock.mockResolvedValue(MANAGER_CTX('manager-1'));
    // p1 reports to p-middle, who reports to manager-1 — manager-1 is a
    // SKIP-LEVEL (grandparent) manager of p1, not p1's direct manager.
    queue([personRow({ id: 'p1', manager_person_id: 'p-middle', work_email: 'secret@example.com' })]);
    const res = await getPerson(asNextRequest(new Request('http://localhost/api/hr/people/p1')), withParams('p1'));
    expect(res.status).toBe(403); // canViewPerson is false: not self, not a DIRECT manager, not HR admin
  });
});

// ── HR-2 Step 1C — date format validation ───────────────────────────

describe('date format validation (create)', () => {
  it('accepts a valid YYYY-MM-DD start_date', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', start_date: '2026-09-14' })]);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', start_date: '2026-09-14' }));
    expect(res.status).toBe(201);
  });

  it('accepts a valid leap-year date (2028-02-29)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', start_date: '2028-02-29' })]);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', start_date: '2028-02-29' }));
    expect(res.status).toBe(201);
  });

  it('rejects a non-leap-year Feb 29 (2026-02-29)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', start_date: '2026-02-29' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_start_date');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects month 13 (2026-13-01)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', start_date: '2026-13-01' }));
    expect(res.status).toBe(400);
  });

  it('rejects April 31 (2026-04-31)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', start_date: '2026-04-31' }));
    expect(res.status).toBe(400);
  });

  it('rejects a locale-style date (14/09/2026)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', start_date: '14/09/2026' }));
    expect(res.status).toBe(400);
  });

  it('rejects a timestamp string (2026-09-14T00:00:00Z)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', start_date: '2026-09-14T00:00:00Z' }));
    expect(res.status).toBe(400);
  });

  it('rejects an empty string (a clean 400, not the historical 500)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', start_date: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_start_date');
  });

  it('rejects a whitespace-only string', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', start_date: '   ' }));
    expect(res.status).toBe(400);
  });

  it('accepts null (no start_date)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', start_date: null })]);
    const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', start_date: null }));
    expect(res.status).toBe(201);
  });
});

describe('date format validation (patch)', () => {
  it('accepts a valid YYYY-MM-DD start_date', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })], [personRow({ id: 'p1', start_date: '2026-09-14' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '2026-09-14' }), withParams('p1'));
    expect(res.status).toBe(200);
  });

  it('accepts a valid leap-year end_date (2028-02-29)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })], [personRow({ id: 'p1', end_date: '2028-02-29' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { end_date: '2028-02-29' }), withParams('p1'));
    expect(res.status).toBe(200);
  });

  it('rejects a non-leap-year Feb 29 start_date (2026-02-29)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '2026-02-29' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_start_date');
  });

  it('rejects month 13 for end_date', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { end_date: '2026-13-01' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_end_date');
  });

  it('rejects April 31', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '2026-04-31' }), withParams('p1'));
    expect(res.status).toBe(400);
  });

  it('rejects a locale-style date', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '14/09/2026' }), withParams('p1'));
    expect(res.status).toBe(400);
  });

  it('rejects a timestamp string', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { end_date: '2026-09-14T00:00:00Z' }), withParams('p1'));
    expect(res.status).toBe(400);
  });

  it('rejects an empty string (a clean 400, not the historical 500)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_start_date');
  });

  it('rejects a whitespace-only string', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { end_date: '   ' }), withParams('p1'));
    expect(res.status).toBe(400);
  });

  it('accepts null (clearing the date)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1', start_date: '2026-01-01' })], [personRow({ id: 'p1', start_date: null })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: null }), withParams('p1'));
    expect(res.status).toBe(200);
  });
});

// ── HR-2 Step 1C — effective-state date ordering ────────────────────

describe('effective-state date ordering (PATCH)', () => {
  it('accepts start before end', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })], [personRow({ id: 'p1', start_date: '2026-01-01', end_date: '2026-12-31' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '2026-01-01', end_date: '2026-12-31' }), withParams('p1'));
    expect(res.status).toBe(200);
  });

  it('accepts start == end (same-day)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })], [personRow({ id: 'p1', start_date: '2026-06-01', end_date: '2026-06-01' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '2026-06-01', end_date: '2026-06-01' }), withParams('p1'));
    expect(res.status).toBe(200);
  });

  it('rejects end before start', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue([personRow({ id: 'p1' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '2026-12-31', end_date: '2026-01-01' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_employment_dates');
    expect(calls.some(c => c.text.includes('UPDATE hr_people'))).toBe(false);
  });

  it('rejects a PATCH changing ONLY start_date into an invalid resulting order against the person\'s existing end_date', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', start_date: '2026-01-01', end_date: '2026-12-31' });
    queue([existing]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '2027-01-01' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_employment_dates');
  });

  it('rejects a PATCH changing ONLY end_date into an invalid resulting order against the person\'s existing start_date', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', start_date: '2026-06-01', end_date: '2026-12-31' });
    queue([existing]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { end_date: '2026-01-01' }), withParams('p1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid_employment_dates');
  });

  it('accepts clearing end_date even when start_date remains set', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', start_date: '2026-06-01', end_date: '2026-12-31' });
    queue([existing], [personRow({ id: 'p1', start_date: '2026-06-01', end_date: null })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { end_date: null }), withParams('p1'));
    expect(res.status).toBe(200);
  });

  it('accepts end_date without start_date', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', start_date: null, end_date: null });
    queue([existing], [personRow({ id: 'p1', end_date: '2026-12-31' })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { end_date: '2026-12-31' }), withParams('p1'));
    expect(res.status).toBe(200);
  });
});

// ── HR-2 Step 1C — date no-op and audit correctness ─────────────────

describe('date no-op and audit correctness', () => {
  it('identical date resubmission causes no UPDATE, no updated_at bump, and no audit event', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', start_date: '2026-01-01', end_date: '2026-12-31' });
    queue([existing]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '2026-01-01', end_date: '2026-12-31' }), withParams('p1'));
    expect(res.status).toBe(200);
    expect(calls.length).toBe(1); // loadPerson only
    expect(calls.some(c => c.text.includes('UPDATE hr_people'))).toBe(false);
    expect(logHrEventMock).not.toHaveBeenCalled();
  });

  it('an actual start_date change audits only start_date, in canonical form', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', start_date: '2026-01-01', end_date: '2026-12-31' });
    queue([existing], [personRow({ id: 'p1', start_date: '2026-02-01', end_date: '2026-12-31' })]);
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '2026-02-01', end_date: '2026-12-31' }), withParams('p1'));
    expect(logHrEventMock).toHaveBeenCalledTimes(1);
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { beforeState: Record<string, unknown>; afterState: Record<string, unknown> }];
    expect(entry.beforeState).toEqual({ start_date: '2026-01-01' });
    expect(entry.afterState).toEqual({ start_date: '2026-02-01' });
  });

  it('an actual end_date change audits only end_date, in canonical form', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', start_date: '2026-01-01', end_date: '2026-12-31' });
    queue([existing], [personRow({ id: 'p1', start_date: '2026-01-01', end_date: '2026-11-30' })]);
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '2026-01-01', end_date: '2026-11-30' }), withParams('p1'));
    expect(logHrEventMock).toHaveBeenCalledTimes(1);
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { beforeState: Record<string, unknown>; afterState: Record<string, unknown> }];
    expect(entry.beforeState).toEqual({ end_date: '2026-12-31' });
    expect(entry.afterState).toEqual({ end_date: '2026-11-30' });
  });

  it('date audit state uses canonical YYYY-MM-DD string values, never a raw Date/timestamp shape', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', start_date: '2026-01-01' });
    queue([existing], [personRow({ id: 'p1', start_date: '2026-03-15' })]);
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { start_date: '2026-03-15' }), withParams('p1'));
    const [, entry] = logHrEventMock.mock.calls[0] as [unknown, { afterState: Record<string, unknown> }];
    expect(entry.afterState.start_date).toBe('2026-03-15');
    expect(entry.afterState.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── HR-2 Step 1D1 — explicit BrainBase account linking ──────────────
//
// Cross-org rejection, HR-admin/super_admin permission, self-linked-
// user denial, unlink, and audit-precedence coverage for
// linked_user_id already exist earlier in this file (see the "self-
// linked user CANNOT change", "super_admin can change linked_user_id",
// and action-naming-precedence describe blocks). This block covers the
// remaining explicit scenarios HR-2 Step 1D1 requires: manager denial,
// relink, same-value no-op, and the new duplicate-link 409 translation.

describe('HR-2 Step 1D1 — explicit account linking', () => {
  it('a manager (module-entitled, non-admin, non-self) cannot link', async () => {
    resolveHrAccessContextMock.mockResolvedValue(MANAGER_CTX('manager-1'));
    queue([personRow({ id: 'p1', linked_user_id: null })]);
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'user-2' }), withParams('p1'));
    expect(res.status).toBe(403);
    expect(calls.some(c => c.text.includes('UPDATE hr_people'))).toBe(false);
  });

  it('relink A -> B succeeds when B is free (same-org, not already linked elsewhere)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue(
      [personRow({ id: 'p1', linked_user_id: 'user-a' })],
      [{ id: 'user-b', organisation_id: 'org-a' }], // isUserInOrganisation(user-b)
      [personRow({ id: 'p1', linked_user_id: 'user-b' })],
    );
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'user-b' }), withParams('p1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.person.linked_user_id).toBe('user-b');
  });

  it('resubmitting the same linked_user_id (no actual change) writes no UPDATE, bumps no updated_at, and logs no audit', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    const existing = personRow({ id: 'p1', linked_user_id: 'user-a' });
    queue([existing], [{ id: 'user-a', organisation_id: 'org-a' }]); // loadPerson, isUserInOrganisation only
    const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'user-a' }), withParams('p1'));
    expect(res.status).toBe(200);
    expect(calls.some(c => c.text.includes('UPDATE hr_people'))).toBe(false);
    expect(logHrEventMock).not.toHaveBeenCalled();
  });

  it('linking never grants HR-administrator authority — ctx.isHrAdministrator resolution is untouched by this write (resolveHrAccessContext is called once, up front, and never re-derived from the just-written linked_user_id)', async () => {
    resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
    queue(
      [personRow({ id: 'p1', linked_user_id: null })],
      [{ id: 'user-2', organisation_id: 'org-a' }],
      [personRow({ id: 'p1', linked_user_id: 'user-2' })],
    );
    await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'user-2' }), withParams('p1'));
    expect(resolveHrAccessContextMock).toHaveBeenCalledTimes(1);
  });

  describe('duplicate-link conflict (race-time DB unique violation)', () => {
    it('the exact hr_people_organisation_id_linked_user_id_key violation returns 409 linked_user_already_linked, with no raw Postgres message leaked', async () => {
      const { NeonDbError } = await import('@neondatabase/serverless');
      resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
      sqlMock.mockImplementationOnce((strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ text: strings.join('?'), values });
        return Promise.resolve([personRow({ id: 'p1', linked_user_id: null })]); // loadPerson
      });
      sqlMock.mockImplementationOnce((strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ text: strings.join('?'), values });
        return Promise.resolve([{ id: 'user-2', organisation_id: 'org-a' }]); // isUserInOrganisation
      });
      sqlMock.mockImplementationOnce(() => {
        const err = new NeonDbError('duplicate key value violates unique constraint "hr_people_organisation_id_linked_user_id_key"');
        err.code = '23505';
        err.constraint = 'hr_people_organisation_id_linked_user_id_key';
        throw err;
      });
      const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'user-2' }), withParams('p1'));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toEqual({ error: 'That BrainBase account is already linked to another person.', code: 'linked_user_already_linked' });
      expect(JSON.stringify(body)).not.toMatch(/duplicate key|constraint|hr_people_organisation_id/);
    });

    it('an unrelated 23505 (a different constraint) is NOT mislabeled as linked_user_already_linked — falls through to the generic 500', async () => {
      const { NeonDbError } = await import('@neondatabase/serverless');
      resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
      sqlMock.mockImplementationOnce((strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ text: strings.join('?'), values });
        return Promise.resolve([personRow({ id: 'p1', linked_user_id: null })]);
      });
      sqlMock.mockImplementationOnce((strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ text: strings.join('?'), values });
        return Promise.resolve([{ id: 'user-2', organisation_id: 'org-a' }]);
      });
      sqlMock.mockImplementationOnce(() => {
        const err = new NeonDbError('duplicate key value violates unique constraint "some_other_table_pkey"');
        err.code = '23505';
        err.constraint = 'some_other_table_pkey';
        throw err;
      });
      const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'user-2' }), withParams('p1'));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.code).not.toBe('linked_user_already_linked');
      expect(body.error).toBe('Could not update person.');
    });

    it('an unrelated DB error (not a 23505 at all) preserves the existing generic 500 handling', async () => {
      resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
      sqlMock.mockImplementationOnce((strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ text: strings.join('?'), values });
        return Promise.resolve([personRow({ id: 'p1', linked_user_id: null })]);
      });
      sqlMock.mockImplementationOnce((strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ text: strings.join('?'), values });
        return Promise.resolve([{ id: 'user-2', organisation_id: 'org-a' }]);
      });
      sqlMock.mockImplementationOnce(() => {
        throw new Error('connection reset');
      });
      const res = await patchPerson(jsonRequest('http://localhost/api/hr/people/p1', 'PATCH', { linked_user_id: 'user-2' }), withParams('p1'));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Could not update person.');
    });
  });

  // HR-2 Step 1D1 (corrective pass) — POST /api/hr/people's INSERT also
  // explicitly assigns linked_user_id (see this file's own header
  // comment on POST body handling below), so it is subject to the
  // exact same race-time duplicate-link constraint violation as PATCH
  // above. These three tests mirror the PATCH block's own three cases
  // exactly, now routed through the shared isLinkedUserUniqueViolation()
  // helper (lib/hr/validation.ts) rather than duplicated inline logic.
  describe('duplicate-link conflict (race-time DB unique violation) — POST /people', () => {
    it('the exact hr_people_organisation_id_linked_user_id_key violation returns 409 linked_user_already_linked, with no raw Postgres message leaked, no audit event, and no partially-created person', async () => {
      const { NeonDbError } = await import('@neondatabase/serverless');
      resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
      sqlMock.mockImplementationOnce((strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ text: strings.join('?'), values });
        return Promise.resolve([{ id: 'user-2', organisation_id: 'org-a' }]); // isUserInOrganisation
      });
      sqlMock.mockImplementationOnce(() => {
        const err = new NeonDbError('duplicate key value violates unique constraint "hr_people_organisation_id_linked_user_id_key"');
        err.code = '23505';
        err.constraint = 'hr_people_organisation_id_linked_user_id_key';
        throw err; // INSERT
      });
      const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', linked_user_id: 'user-2' }));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toEqual({ error: 'That BrainBase account is already linked to another person.', code: 'linked_user_already_linked' });
      expect(JSON.stringify(body)).not.toMatch(/duplicate key|constraint|hr_people_organisation_id/);
      expect(logHrEventMock).not.toHaveBeenCalled();
      // isUserInOrganisation (recorded in `calls`) then the INSERT
      // attempt itself (throws before it can push to `calls`, but
      // sqlMock's own call count still proves it was actually
      // attempted) — exactly two sql invocations, no retry, no
      // partially-created row possible since a single INSERT statement
      // either fully commits or throws.
      expect(calls).toHaveLength(1);
      expect(sqlMock).toHaveBeenCalledTimes(2);
    });

    it('an unrelated 23505 (a different constraint) is NOT mislabeled as linked_user_already_linked — falls through to the existing generic 500', async () => {
      const { NeonDbError } = await import('@neondatabase/serverless');
      resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
      sqlMock.mockImplementationOnce((strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ text: strings.join('?'), values });
        return Promise.resolve([{ id: 'user-2', organisation_id: 'org-a' }]);
      });
      sqlMock.mockImplementationOnce(() => {
        const err = new NeonDbError('duplicate key value violates unique constraint "some_other_table_pkey"');
        err.code = '23505';
        err.constraint = 'some_other_table_pkey';
        throw err;
      });
      const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', linked_user_id: 'user-2' }));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.code).not.toBe('linked_user_already_linked');
      expect(body.error).toBe('Could not create person.');
    });

    it('an unrelated DB error (not a 23505 at all) preserves the existing generic 500 handling', async () => {
      resolveHrAccessContextMock.mockResolvedValue(HR_ADMIN_CTX);
      sqlMock.mockImplementationOnce((strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ text: strings.join('?'), values });
        return Promise.resolve([{ id: 'user-2', organisation_id: 'org-a' }]);
      });
      sqlMock.mockImplementationOnce(() => {
        throw new Error('connection reset');
      });
      const res = await createPerson(jsonRequest('http://localhost/api/hr/people', 'POST', { first_name: 'A', last_name: 'B', linked_user_id: 'user-2' }));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Could not create person.');
    });
  });
});
