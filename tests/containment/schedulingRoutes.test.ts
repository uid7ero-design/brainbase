import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 2B.1: the two Scheduling foundation routes, driven through the REAL guard, runtime, repository and audit module.
// Only the collaborators below are replaced: the session, the capability lookup, and the database (an in-memory fake that
// answers exactly the statements these code paths issue, and records every statement so "nothing was written" is provable).

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

type AuditRow = { id: string; organisation_id: string; user_id: string | null; action: string; resource_type: string; resource_id: string | null; after_state: unknown; at: string };
const world = vi.hoisted(() => ({
  orgs: {} as Record<string, { timezone: string | null; currency: string | null }>,
  audit: [] as AuditRow[],
  statements: [] as string[],
  failDb: false,
}));

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
vi.mock('@/lib/db', () => {
  const run = (text: string, values: unknown[]) => {
    world.statements.push(text.replace(/\s+/g, ' ').trim());
    if (world.failDb) throw Object.assign(new Error('boom'), { code: '08006' });
    const t = text.replace(/\s+/g, ' ').trim();
    if (/^SELECT timezone FROM organisations WHERE id = /i.test(t)) {
      const o = world.orgs[String(values[0])];
      return o ? [{ timezone: o.timezone }] : [];
    }
    if (/^SELECT organisation_id, currency FROM scheduling_settings WHERE organisation_id = /i.test(t)) {
      const o = world.orgs[String(values[0])];
      return o && o.currency ? [{ organisation_id: String(values[0]), currency: o.currency }] : [];
    }
    if (/^SELECT id, user_id, action, resource_type, resource_id, after_state, .* FROM audit_logs WHERE organisation_id = /i.test(t)) {
      // The organisation is the first bind value; the SQL itself also carries the 'scheduling.' prefix filter.
      expect(t).toMatch(/action LIKE 'scheduling\.%'/);
      const org = String(values[0]);
      const limit = Number(values[values.length - 1]);
      return world.audit.filter(r => r.organisation_id === org && r.action.startsWith('scheduling.')).slice(0, limit).map(r => ({ ...r }));
    }
    if (/^INSERT INTO audit_logs/i.test(t)) {
      world.audit.unshift({ id: String(values[0]), organisation_id: String(values[1]), user_id: values[2] as string, action: String(values[3]), resource_type: String(values[4]), resource_id: String(values[5]), after_state: JSON.parse(String(values[7])), at: '2026-10-23T00:00:00.000Z' });
      return [];
    }
    throw new Error('unexpected SQL in the fake database: ' + t.slice(0, 120));
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve().then(() => run(strings.reduce((a, s, i) => a + s + (i < values.length ? `$${i + 1}` : ''), ''), values));
  const query = (text: string, params: unknown[] = []) => Promise.resolve().then(() => run(text, [...params]));
  return { default: Object.assign(tag, { query }) };
});

const status = await import('@/app/api/scheduling/status/route');
const auditRoute = await import('@/app/api/scheduling/audit/route');
const { recordSchedulingAudit } = await import('@/lib/scheduling/audit');
const { staffTenantContext } = await import('@/lib/scheduling/adapters/brainbase');

const sessionFor = (role: string, over: Record<string, unknown> = {}) => ({ userId: 'u1', organisationId: 'org-a', homeOrganisationId: 'org-a', role, name: 'U', ...over });
const get = (route: { GET: (r: Request) => Promise<Response> }, url = 'http://bb.test/api/scheduling/status') => route.GET(new Request(url));
const writesSeen = () => world.statements.filter(s => /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(s));

async function seedAudit(org: string, userId: string, action: 'scheduling.reservation.created', resourceId: string) {
  await recordSchedulingAudit({
    tenant: staffTenantContext({ organisationId: org, userId, role: 'manager', timezone: null }),
    action,
    resourceType: 'reservation',
    resourceId,
    summary: { occurrence_id: 'occ-1', party_size: 2 },
    identity: { customerName: 'Pat Example', customerEmail: 'pat@example.test', customerPhone: '+61 400 000 000' },
  });
}

beforeEach(() => {
  requireSession.mockReset();
  requireCapability.mockReset();
  requireCapability.mockResolvedValue({ enabled: true });
  world.orgs = {
    'org-a': { timezone: 'Australia/Perth', currency: 'AUD' },
    'org-b': { timezone: null, currency: 'NZD' },
  };
  world.audit = [];
  world.statements = [];
  world.failDb = false;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('401, 403 and fail-closed behaviour', () => {
  it('401 without a session; capability, runtime and database are never reached', async () => {
    requireSession.mockRejectedValue(new Error('Unauthorized'));
    const res = await get(status);
    expect(res.status).toBe(401);
    expect(requireCapability).not.toHaveBeenCalled();
    expect(world.statements).toEqual([]);
  });

  it('403 when the organisation is not entitled; nothing is read from the organisation or its settings', async () => {
    requireSession.mockResolvedValue(sessionFor('manager'));
    requireCapability.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'));
    const res = await get(status);
    expect(res.status).toBe(403);
    expect(world.statements).toEqual([]);
  });

  it('403 for a disabled entitlement and for an inactive module (the same denial)', async () => {
    requireSession.mockResolvedValue(sessionFor('manager'));
    for (const reason of ['ENTITLEMENT_DISABLED', 'MODULE_INACTIVE', 'UNKNOWN_MODULE']) {
      requireCapability.mockRejectedValue(new CapabilityAccessError(reason));
      expect((await get(status)).status).toBe(403);
    }
  });

  it('503 when entitlement cannot be determined (the capability lookup fails)', async () => {
    requireSession.mockResolvedValue(sessionFor('manager'));
    requireCapability.mockRejectedValue(new CapabilityDatabaseError());
    expect((await get(status)).status).toBe(503);
    expect(world.statements).toEqual([]);
  });

  it('analyst and unknown roles are denied (403) even for an entitled organisation, before any scheduling data is read', async () => {
    for (const role of ['analyst', 'intern', '', 'SUPER_ADMIN']) {
      world.statements = [];
      requireSession.mockResolvedValue(sessionFor(role));
      expect((await get(status)).status, role).toBe(403);
      expect((await get(auditRoute, 'http://bb.test/api/scheduling/audit')).status, role).toBe(403);
      expect(world.statements, role).toEqual([]);
    }
  });

  it('503 and no leak when the database fails while resolving the runtime', async () => {
    requireSession.mockResolvedValue(sessionFor('manager'));
    world.failDb = true;
    const res = await get(status);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toMatch(/boom|08006|organisations|SELECT/);
  });

  it('every response, including denials, is no-store', async () => {
    requireSession.mockRejectedValue(new Error('Unauthorized'));
    expect((await get(status)).headers.get('cache-control')).toBe('no-store');
    requireSession.mockResolvedValue(sessionFor('viewer'));
    requireCapability.mockRejectedValue(new CapabilityAccessError('NO_ENTITLEMENT'));
    expect((await get(status)).headers.get('cache-control')).toBe('no-store');
    requireCapability.mockResolvedValue({ enabled: true });
    expect((await get(status)).headers.get('cache-control')).toBe('no-store');
  });
});

describe('explicit settings: a missing row is a controlled error and nothing is created', () => {
  it('an entitled organisation with no settings row gets 503 SCHEDULING_NOT_CONFIGURED and no write statement is issued', async () => {
    world.orgs['org-a'].currency = null; // organisation exists, no scheduling settings row
    requireSession.mockResolvedValue(sessionFor('manager'));
    const res = await get(status);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Scheduling is not configured for this organisation.', code: 'SCHEDULING_NOT_CONFIGURED' });
    expect(writesSeen()).toEqual([]);
    expect(world.orgs['org-a'].currency).toBeNull();
  });

  it('an unusable stored timezone is a controlled configuration error, not a silent fallback', async () => {
    world.orgs['org-a'].timezone = 'Mars/Olympus';
    requireSession.mockResolvedValue(sessionFor('manager'));
    const res = await get(status);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('SCHEDULING_NOT_CONFIGURED');
  });

  it('a NULL or blank organisation timezone resolves to Australia/Adelaide and says so', async () => {
    requireSession.mockResolvedValue(sessionFor('manager', { organisationId: 'org-b' }));
    const body = await (await get(status)).json();
    expect(body).toMatchObject({ configured: true, timezone: 'Australia/Adelaide', timezone_source: 'fallback', currency: 'NZD' });
    world.orgs['org-b'].timezone = '   ';
    expect((await (await get(status)).json()).timezone_source).toBe('fallback');
  });

  it('the organisation timezone is used when set', async () => {
    requireSession.mockResolvedValue(sessionFor('manager'));
    expect(await (await get(status)).json()).toMatchObject({ timezone: 'Australia/Perth', timezone_source: 'organisation', currency: 'AUD' });
  });
});

describe('roles: manager and above manage, viewer is read-only and privacy-reduced', () => {
  it.each(['manager', 'admin', 'super_admin'])('%s gets full scope including identity-detail permission', async role => {
    requireSession.mockResolvedValue(sessionFor(role));
    const body = await (await get(status)).json();
    expect(body.access.scope).toBe('full');
    expect(body.access.permissions).toEqual(['scheduling.view', 'scheduling.manage', 'scheduling.reserve', 'scheduling.attendance', 'scheduling.audit.identity']);
  });

  it('a viewer gets read-only scope: view only, no manage, no identity-detail permission', async () => {
    requireSession.mockResolvedValue(sessionFor('viewer'));
    const body = await (await get(status)).json();
    expect(body.access).toEqual({ scope: 'reduced', permissions: ['scheduling.view'] });
  });
});

describe('audit privacy: identity detail only for manager, admin and super_admin', () => {
  beforeEach(async () => {
    await seedAudit('org-a', 'u9', 'scheduling.reservation.created', 'res-1');
  });

  it('a viewer sees the entry and its non-sensitive summary, and no customer identity anywhere in the response', async () => {
    requireSession.mockResolvedValue(sessionFor('viewer'));
    const res = await get(auditRoute, 'http://bb.test/api/scheduling/audit');
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.identity_visible).toBe(false);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ action: 'scheduling.reservation.created', resourceId: 'res-1', summary: { occurrence_id: 'occ-1', party_size: 2 } });
    expect(body.entries[0]).not.toHaveProperty('identity');
    expect(text).not.toMatch(/Pat Example|pat@example\.test|400 000 000|customer_(name|email|phone)/);
  });

  it.each(['manager', 'admin', 'super_admin'])('%s receives the identity detail', async role => {
    requireSession.mockResolvedValue(sessionFor(role));
    const body = await (await get(auditRoute, 'http://bb.test/api/scheduling/audit')).json();
    expect(body.identity_visible).toBe(true);
    expect(body.entries[0].identity).toEqual({ customer_name: 'Pat Example', customer_email: 'pat@example.test', customer_phone: '+61 400 000 000' });
  });

  it('the identity is stripped at READ time, so a role change cannot reveal older entries to a lower role', async () => {
    requireSession.mockResolvedValue(sessionFor('manager'));
    expect((await (await get(auditRoute, 'http://bb.test/api/scheduling/audit')).json()).entries[0].identity).toBeDefined();
    requireSession.mockResolvedValue(sessionFor('viewer'));
    expect((await (await get(auditRoute, 'http://bb.test/api/scheduling/audit')).json()).entries[0].identity).toBeUndefined();
  });

  it('rejects a bad limit or before value with 400, and never takes an organisation from the query', async () => {
    requireSession.mockResolvedValue(sessionFor('manager'));
    for (const q of ['limit=0', 'limit=101', 'limit=abc', 'before=yesterday', 'before=2026-10-23']) {
      expect((await get(auditRoute, `http://bb.test/api/scheduling/audit?${q}`)).status, q).toBe(400);
    }
  });
});

describe('tenant isolation and impersonation', () => {
  beforeEach(async () => {
    await seedAudit('org-a', 'u1', 'scheduling.reservation.created', 'a-res');
    await seedAudit('org-b', 'u2', 'scheduling.reservation.created', 'b-res');
  });

  it("an organisation's audit trail never contains another organisation's entries", async () => {
    requireSession.mockResolvedValue(sessionFor('manager', { organisationId: 'org-a' }));
    const a = await (await get(auditRoute, 'http://bb.test/api/scheduling/audit')).json();
    expect(a.entries.map((e: { resourceId: string }) => e.resourceId)).toEqual(['a-res']);
    requireSession.mockResolvedValue(sessionFor('manager', { organisationId: 'org-b', homeOrganisationId: 'org-b' }));
    const b = await (await get(auditRoute, 'http://bb.test/api/scheduling/audit')).json();
    expect(b.entries.map((e: { resourceId: string }) => e.resourceId)).toEqual(['b-res']);
  });

  it('an organisation named in the query string, or in a header, is ignored', async () => {
    requireSession.mockResolvedValue(sessionFor('manager', { organisationId: 'org-a' }));
    const res = await auditRoute.GET(new Request('http://bb.test/api/scheduling/audit?organisation_id=org-b&organisationId=org-b&org=org-b', { headers: { 'x-organisation-id': 'org-b' } }));
    expect((await res.json()).entries.map((e: { resourceId: string }) => e.resourceId)).toEqual(['a-res']);
    const s = await (await status.GET(new Request('http://bb.test/api/scheduling/status?organisation_id=org-b'))).json();
    expect(s.currency).toBe('AUD'); // org-a's, not org-b's NZD
  });

  it('the capability is checked for the SESSION organisation; while a super_admin impersonates, that is the impersonated one', async () => {
    requireSession.mockResolvedValue(sessionFor('super_admin', { organisationId: 'org-b', homeOrganisationId: 'org-a' }));
    const body = await (await get(status)).json();
    expect(requireCapability).toHaveBeenCalledWith('org-b', 'scheduling');
    expect(body.currency).toBe('NZD'); // the impersonated organisation's settings, not the home organisation's
    const audit = await (await get(auditRoute, 'http://bb.test/api/scheduling/audit')).json();
    expect(audit.entries.map((e: { resourceId: string }) => e.resourceId)).toEqual(['b-res']);
  });

  it('entitlement of the home organisation does not carry over to the impersonated one', async () => {
    requireSession.mockResolvedValue(sessionFor('super_admin', { organisationId: 'org-b', homeOrganisationId: 'org-a' }));
    requireCapability.mockImplementation(async (org: string) => {
      if (org !== 'org-a') throw new CapabilityAccessError('NO_ENTITLEMENT');
      return { enabled: true };
    });
    expect((await get(status)).status).toBe(403);
  });
});

describe('the status route reads configuration only and writes nothing', () => {
  it('issues no write statement for a successful call by any role', async () => {
    for (const role of ['viewer', 'manager', 'admin', 'super_admin']) {
      requireSession.mockResolvedValue(sessionFor(role));
      expect((await get(status)).status).toBe(200);
    }
    expect(writesSeen()).toEqual([]);
  });
});
