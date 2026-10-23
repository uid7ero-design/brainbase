import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 2B.0 — the fail-closed Scheduling gate (session -> 'scheduling' capability -> role permission).
// Mocks the two collaborators, and asserts that the organisation always comes from the DB-backed session and that
// every uncertain or denied path ends in a refusal.

const requireSession = vi.fn();
const requireCapability = vi.fn();

class CapabilityAccessError extends Error {
  reason: string;
  constructor(reason: string) {
    super('Capability access denied');
    this.name = 'CapabilityAccessError';
    this.reason = reason;
  }
}
class CapabilityDatabaseError extends Error {
  constructor() {
    super('Capability lookup failed');
    this.name = 'CapabilityDatabaseError';
  }
}

vi.mock('@/lib/org', () => ({
  requireSession: () => requireSession(),
  unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  forbidden: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/capabilities/requireCapability', () => ({
  requireCapability: (org: string, key: string) => requireCapability(org, key),
  CapabilityAccessError,
  CapabilityDatabaseError,
}));

const { authorizeSchedulingRequest } = await import('@/lib/scheduling/access');

const session = (role: string, over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  organisationId: 'org-1',
  homeOrganisationId: 'org-1',
  role,
  name: 'U',
  ...over,
});
const ALL = ['scheduling.view', 'scheduling.manage', 'scheduling.reserve', 'scheduling.attendance', 'scheduling.audit.identity'] as const;

beforeEach(() => {
  requireSession.mockReset();
  requireCapability.mockReset();
});

describe('authorizeSchedulingRequest: order and fail-closed behaviour', () => {
  it('401 without a session, and never looks at the capability', async () => {
    requireSession.mockRejectedValue(new Error('Unauthorized'));
    const r = await authorizeSchedulingRequest('scheduling.view');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
    expect(requireCapability).not.toHaveBeenCalled();
  });

  it('401 for a session that is missing its organisation or user', async () => {
    for (const bad of [{ organisationId: '' }, { userId: '' }, { organisationId: undefined }]) {
      requireSession.mockResolvedValue(session('admin', bad));
      const r = await authorizeSchedulingRequest('scheduling.view');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(401);
    }
    expect(requireCapability).not.toHaveBeenCalled();
  });

  it.each(['UNKNOWN_CAPABILITY', 'CAPABILITY_INACTIVE', 'NO_ENTITLEMENT', 'ENTITLEMENT_DISABLED'])(
    '403 for the denial %s, with no distinguishable body',
    async reason => {
      requireSession.mockResolvedValue(session('super_admin'));
      requireCapability.mockRejectedValue(new CapabilityAccessError(reason));
      const r = await authorizeSchedulingRequest('scheduling.view');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.response.status).toBe(403);
        expect(await r.response.json()).toEqual({ error: 'Forbidden' });
      }
    },
  );

  it('503 (still closed) when entitlement cannot be determined, and for any unexpected throw', async () => {
    requireSession.mockResolvedValue(session('admin'));
    for (const err of [new CapabilityDatabaseError(), new Error('boom'), 'string thrown']) {
      requireCapability.mockRejectedValue(err);
      const r = await authorizeSchedulingRequest('scheduling.view');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(503);
    }
  });

  it('checks the capability for the session organisation only, under the key "scheduling"', async () => {
    requireSession.mockResolvedValue(session('manager'));
    requireCapability.mockResolvedValue({ key: 'scheduling', config: {} });
    await authorizeSchedulingRequest('scheduling.view');
    expect(requireCapability).toHaveBeenCalledTimes(1);
    expect(requireCapability).toHaveBeenCalledWith('org-1', 'scheduling');
  });

  it('while a super_admin impersonates, the IMPERSONATED organisation is the one checked and returned', async () => {
    requireSession.mockResolvedValue(session('super_admin', { organisationId: 'org-impersonated', homeOrganisationId: 'org-home' }));
    requireCapability.mockResolvedValue({ key: 'scheduling', config: {} });
    const r = await authorizeSchedulingRequest('scheduling.manage');
    expect(requireCapability).toHaveBeenCalledWith('org-impersonated', 'scheduling');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tenant.organisationId).toBe('org-impersonated');
  });

  it('the function takes no organisation argument: a second argument cannot redirect the check', async () => {
    requireSession.mockResolvedValue(session('manager'));
    requireCapability.mockResolvedValue({ key: 'scheduling', config: {} });
    const call = authorizeSchedulingRequest as unknown as (p: string, org?: string) => Promise<unknown>;
    await call('scheduling.view', 'org-attacker');
    expect(requireCapability).toHaveBeenCalledWith('org-1', 'scheduling');
    expect(authorizeSchedulingRequest.length).toBe(1);
  });

  it('refuses an unknown permission string before any I/O', async () => {
    const call = authorizeSchedulingRequest as unknown as (p: string) => ReturnType<typeof authorizeSchedulingRequest>;
    for (const p of ['', 'scheduling.delete', 'scheduling', 'view', 'SCHEDULING.VIEW']) {
      const r = await call(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(403);
    }
    expect(requireSession).not.toHaveBeenCalled();
    expect(requireCapability).not.toHaveBeenCalled();
  });
});

describe('authorizeSchedulingRequest: role matrix (entitled organisation)', () => {
  beforeEach(() => requireCapability.mockResolvedValue({ key: 'scheduling', config: {} }));

  const expected: Record<string, readonly string[]> = {
    viewer: ['scheduling.view'],
    manager: ALL,
    admin: ALL,
    super_admin: ALL,
    analyst: [],
    '': [],
    owner: [],
    ADMIN: [],
  };

  for (const [role, allowed] of Object.entries(expected)) {
    for (const permission of ALL) {
      const should = allowed.includes(permission);
      it(`${role || '(empty role)'} + ${permission} -> ${should ? 'allowed' : '403'}`, async () => {
        requireSession.mockResolvedValue(session(role));
        const r = await authorizeSchedulingRequest(permission);
        expect(r.ok).toBe(should);
        if (!r.ok) expect(r.response.status).toBe(403);
        if (r.ok) {
          expect(r.tenant.can(permission)).toBe(true);
          expect(r.tenant.actor).toEqual({ kind: 'staff', userId: 'u1' });
          expect(r.tenant.organisationId).toBe('org-1');
        }
      });
    }
  }

  it('a viewer cannot reserve, manage or take attendance', async () => {
    requireSession.mockResolvedValue(session('viewer'));
    for (const p of ['scheduling.manage', 'scheduling.reserve', 'scheduling.attendance'] as const) {
      const r = await authorizeSchedulingRequest(p);
      expect(r.ok).toBe(false);
    }
  });

  it('the tenant carries the platform fallback timezone: no organisation column is read in 2B.0', async () => {
    requireSession.mockResolvedValue(session('admin'));
    const r = await authorizeSchedulingRequest('scheduling.view');
    expect(r.ok && r.tenant.timezone).toBe('Australia/Adelaide');
  });
});
