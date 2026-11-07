import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HireNotReadyError, SchedulingError } from '@scheduling/core';

// Phase 2C.3c-B: GET /api/scheduling/reservations/basis through the REAL guard (route.ts + access.ts), the REAL handler and the REAL audit module. Replaced: the session, the capability lookup, the
// database and the runtime (a fake repository). What the repository computes (basis, engine starts, locks) is proven on PostgreSQL 16/17 and Neon elsewhere; this file proves the gates, the
// permissions, the strict validation and the exact shape of what leaves the route.

const requireSession = vi.fn();
const requireCapability = vi.fn();
vi.mock('@/lib/organisationUsers/access', () => ({ getUserPermissions: async () => null }));

class CapabilityAccessError extends Error {
  reason: string;
  constructor(reason: string) { super('Capability access denied'); this.name = 'CapabilityAccessError'; this.reason = reason; }
}
class CapabilityDatabaseError extends Error {
  constructor() { super('Capability lookup failed'); this.name = 'CapabilityDatabaseError'; }
}
vi.mock('@/lib/org', () => ({
  requireSession: () => requireSession(),
  unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  forbidden: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/capabilities/requireCapability', () => ({ requireCapability: (org: string, key: string) => requireCapability(org, key), CapabilityAccessError, CapabilityDatabaseError }));

const world = vi.hoisted(() => ({ audit: [] as Array<{ action: string; resourceType: string; resourceId: string; afterState: Record<string, unknown>; userId: string; org: string }>, auditFails: false, runtimeLoads: 0 }));
vi.mock('@/lib/db', () => {
  const run = (text: string, values: unknown[]) => {
    if (/^INSERT INTO audit_logs/i.test(text.replace(/\s+/g, ' ').trim())) {
      if (world.auditFails) throw Object.assign(new Error('audit down'), { code: '08006' });
      world.audit.push({ org: String(values[1]), userId: String(values[2]), action: String(values[3]), resourceType: String(values[4]), resourceId: String(values[5]), afterState: JSON.parse(String(values[7])) });
      return [];
    }
    throw new Error('unexpected SQL in the fake database');
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve().then(() => run(strings.reduce((a, s, i) => a + s + (i < values.length ? `$${i + 1}` : ''), ''), values));
  return { default: Object.assign(tag, { query: (t: string, p: unknown[] = []) => Promise.resolve().then(() => run(t, p)) }) };
});

const repo = vi.hoisted(() => ({ readHireOffer: vi.fn() }));
vi.mock('@/lib/scheduling/runtime', async () => {
  const { staffTenantContext } = await import('@/lib/scheduling/adapters/brainbase');
  class SchedulingConfigurationError extends Error { code = 'SCHEDULING_NOT_CONFIGURED'; }
  return {
    SchedulingConfigurationError,
    loadSchedulingRuntime: async (session: { organisationId: string; userId: string; role: string }) => {
      world.runtimeLoads += 1;
      return { tenant: staffTenantContext({ ...session, timezone: 'Australia/Adelaide' }), hire: { readHireOffer: repo.readHireOffer }, persistence: {} };
    },
  };
});

type Handler = (request: Request) => Promise<Response>;
const route = (await import('@/app/api/scheduling/reservations/basis/route')) as unknown as Record<string, Handler>;

const sessionFor = (role: string, over: Record<string, unknown> = {}) => ({ userId: 'u1', organisationId: 'org-a', homeOrganisationId: 'org-a', role, name: 'U', ...over });
const QUERY = 'offeringId=off-1&resourceId=court-1&from=2026-11-16&to=2026-11-18';
const get = (query = QUERY) => route.GET(new Request(`http://bb.test/api/scheduling/reservations/basis?${query}`));
const json = async (r: Response) => JSON.parse(await r.text());

const BASIS = { offeringVersion: '4', resourceVersion: '6', offeringToken: '2026-11-01T00:00:00.000000Z', scheduleToken: '2026-10-01T00:00:00.000000Z' };
const offer = () => ({
  ok: true,
  offer: {
    basis: BASIS, offeringId: 'off-1', resourceId: 'court-1', durationMinutes: 60, timezone: 'Australia/Adelaide', resourceCapacity: 4, price: { amountCents: 5000, currency: 'AUD' },
    range: { from: '2026-11-16', to: '2026-11-18' }, generatedAt: '2026-11-07T00:00:00Z',
    days: [{ date: '2026-11-16', starts: [{ time: '09:00', startsAt: '2026-11-15T22:30:00Z' }] }, { date: '2026-11-17', starts: [] }, { date: '2026-11-18', starts: [] }],
  },
});

const on = () => { process.env.SCHEDULING_STAFF_BOOKING = 'on'; };
beforeEach(() => {
  on();
  for (const m of [requireSession, requireCapability, repo.readHireOffer]) m.mockReset();
  requireSession.mockResolvedValue(sessionFor('manager'));
  requireCapability.mockResolvedValue({ enabled: true });
  repo.readHireOffer.mockResolvedValue(offer());
  world.audit = [];
  world.runtimeLoads = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

describe('the route is a GET only, behind both gates and scheduling.reserve', () => {
  it('exports GET and nothing else', () => {
    expect(Object.keys(route).filter(k => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k))).toEqual(['GET']);
  });
});

describe('gate 1: the environment kill switch (default OFF) - 404 before the session, the capability table or the database', () => {
  for (const value of [undefined, '', 'off', 'ON', 'true', '1', 'yes', ' on']) {
    it(`SCHEDULING_STAFF_BOOKING=${JSON.stringify(value)} -> 404 not_found, nothing touched`, async () => {
      if (value === undefined) delete process.env.SCHEDULING_STAFF_BOOKING;
      else process.env.SCHEDULING_STAFF_BOOKING = value;
      const r = await get();
      expect(r.status).toBe(404);
      expect(await json(r)).toEqual({ error: 'not_found' });
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(requireSession).not.toHaveBeenCalled();
      expect(requireCapability).not.toHaveBeenCalled();
      expect(world.runtimeLoads).toBe(0);
      expect(repo.readHireOffer).not.toHaveBeenCalled();
    });
  }
  it('it is read on every request, not cached at import', async () => {
    process.env.SCHEDULING_STAFF_BOOKING = 'off';
    expect((await get()).status).toBe(404);
    on();
    expect((await get()).status).toBe(200);
    process.env.SCHEDULING_STAFF_BOOKING = 'off';
    expect((await get()).status).toBe(404);
  });
});

describe('gate 2: the organisation capability scheduling.staff_booking', () => {
  it('an organisation without it, with it disabled or the module inactive/unregistered is 404 and reads nothing', async () => {
    for (const reason of ['NOT_ENTITLED', 'DISABLED', 'INACTIVE', 'UNKNOWN_CAPABILITY']) {
      requireCapability.mockRejectedValueOnce(new CapabilityAccessError(reason));
      const r = await get();
      expect(r.status, reason).toBe(404);
      expect(await json(r)).toEqual({ error: 'not_found' });
    }
    expect(repo.readHireOffer).not.toHaveBeenCalled();
    expect(world.runtimeLoads).toBe(0);
  });
  it('a failure to DETERMINE the entitlement is a 503, never a pass', async () => {
    requireCapability.mockRejectedValueOnce(new CapabilityDatabaseError());
    expect((await get()).status).toBe(503);
    expect(repo.readHireOffer).not.toHaveBeenCalled();
  });
  it('the key asked for is scheduling.staff_booking, for the SESSION organisation', async () => {
    requireSession.mockResolvedValue(sessionFor('manager', { organisationId: 'org-session' }));
    await get();
    expect(requireCapability.mock.calls.map(c => c.join(' '))).toContain('org-session scheduling.staff_booking');
  });
});

describe('who may read it: staff with scheduling.reserve only', () => {
  it('anonymous: 401 and nothing is read', async () => {
    requireSession.mockRejectedValue(new Error('Unauthorized'));
    expect((await get()).status).toBe(401);
    expect(repo.readHireOffer).not.toHaveBeenCalled();
  });
  for (const role of ['viewer', 'analyst', 'guest', 'customer', '']) {
    it(`role ${JSON.stringify(role)} is refused (403) with no scheduling data, and the repository is never asked`, async () => {
      requireSession.mockResolvedValue(sessionFor(role));
      const r = await get();
      const text = await r.text();
      expect(r.status).toBe(403);
      expect(text).not.toMatch(/basis|offeringVersion|durationMinutes|days/);
      expect(repo.readHireOffer).not.toHaveBeenCalled();
    });
  }
  for (const role of ['manager', 'admin', 'super_admin']) {
    it(`${role} reads it (200)`, async () => {
      requireSession.mockResolvedValue(sessionFor(role));
      expect((await get()).status).toBe(200);
    });
  }
});

describe('the tenant is the session\'s, and no organisation is accepted from the request', () => {
  it('the repository is called with the session\'s organisation and the four validated parameters only', async () => {
    requireSession.mockResolvedValue(sessionFor('manager', { organisationId: 'org-session' }));
    await get();
    expect(repo.readHireOffer).toHaveBeenCalledTimes(1);
    const [tenant, request] = repo.readHireOffer.mock.calls[0];
    expect(tenant.organisationId).toBe('org-session');
    expect(request).toEqual({ offeringId: 'off-1', resourceId: 'court-1', from: '2026-11-16', to: '2026-11-18' });
  });
  for (const extra of ['organisationId=org-b', 'organization_id=org-b', 'orgId=org-b', 'step=15', 'stepMinutes=15', 'duration=30', 'durationMinutes=30', 'partySize=2', 'limit=5', 'basis=x']) {
    it(`an unknown parameter (${extra.split('=')[0]}) is a 400 naming it, the value is never echoed, and nothing is read`, async () => {
      const r = await get(`${QUERY}&${extra}`);
      const text = await r.text();
      expect(r.status).toBe(400);
      expect(JSON.parse(text).problems).toEqual([extra.split('=')[0]]);
      expect(text).not.toContain(extra.split('=')[1] === '15' ? 'zzz' : `=${extra.split('=')[1]}`);
      expect(repo.readHireOffer).not.toHaveBeenCalled();
    });
  }
});

describe('strict validation: names only, and the repository is not asked', () => {
  const cases: Array<[string, string, string[]]> = [
    ['nothing at all', '', ['offeringId', 'resourceId', 'from', 'to']],
    ['no from', 'offeringId=o&resourceId=r&to=2026-11-18', ['from']],
    ['empty resource', 'offeringId=o&resourceId=&from=2026-11-16&to=2026-11-18', ['resourceId']],
    ['bad id', 'offeringId=../etc&resourceId=r&from=2026-11-16&to=2026-11-18', ['offeringId']],
    ['id too long', `offeringId=${'a'.repeat(101)}&resourceId=r&from=2026-11-16&to=2026-11-18`, ['offeringId']],
    ['a repeated parameter', 'offeringId=a&offeringId=b&resourceId=r&from=2026-11-16&to=2026-11-18', ['offeringId']],
    ['a duplicated date', 'offeringId=o&resourceId=r&from=2026-11-16&from=2026-11-17&to=2026-11-18', ['from']],
  ];
  for (const [name, query, problems] of cases) {
    it(`${name} -> 400 VALIDATION ${JSON.stringify(problems)}`, async () => {
      const r = await get(query);
      expect(r.status).toBe(400);
      const body = await json(r);
      expect(body.code).toBe('VALIDATION');
      expect(body.problems).toEqual(problems);
      expect(repo.readHireOffer).not.toHaveBeenCalled();
    });
  }
  it('bad dates, a reversed range and a range over 14 days reach the repository\'s own range check, which answers 400 with field names', async () => {
    repo.readHireOffer.mockResolvedValue({ ok: false, code: 'validation', message: 'x', problems: ['range'] });
    const r = await get('offeringId=o&resourceId=r&from=2026-11-01&to=2026-12-31');
    expect(r.status).toBe(400);
    expect((await json(r)).problems).toEqual(['range']);
  });
});

describe('the success contract: the basis, the configured duration, the pinned zone and the starts - and nothing else', () => {
  it('has exactly these keys, an opaque four-part basis and no organisation, customer or step', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const body = await json(r);
    expect(Object.keys(body).sort()).toEqual(['basis', 'days', 'generatedAt', 'offering', 'range', 'resource', 'timezone']);
    expect(Object.keys(body.basis).sort()).toEqual(['offeringToken', 'offeringVersion', 'resourceVersion', 'scheduleToken']);
    expect(body.offering).toEqual({ id: 'off-1', durationMinutes: 60, price: { amountCents: 5000, currency: 'AUD' } });
    expect(body.resource).toEqual({ id: 'court-1', capacity: 4 });
    expect(body.timezone).toBe('Australia/Adelaide');
    expect(body.days[0].starts[0]).toEqual({ time: '09:00', startsAt: '2026-11-15T22:30:00Z' });
    expect(JSON.stringify(body)).not.toMatch(/organi[sz]ation|customer|email|phone|notes|step/i);
  });
  it('an unexpected extra field of the repository result is NOT passed through (an explicit allow-list)', async () => {
    const o = offer();
    (o.offer as Record<string, unknown>).customerEmail = 'pat@example.com';
    (o.offer as Record<string, unknown>).organisationId = 'org-a';
    repo.readHireOffer.mockResolvedValue(o);
    const text = await (await get()).text();
    expect(text).not.toMatch(/pat@example|customerEmail|organisationId|org-a/);
  });
});

describe('refusals of the repository are stable, fixed sentences', () => {
  const EXPECTED: Record<string, [number, string]> = {
    not_found: [404, 'NOT_FOUND'], preset_not_supported: [422, 'OFFERING_NOT_BOOKABLE'], offering_unavailable: [409, 'OFFERING_UNAVAILABLE'], resource_not_eligible: [422, 'RESOURCE_NOT_ELIGIBLE'],
    resource_inactive: [409, 'RESOURCE_INACTIVE'], duration_not_allowed: [422, 'DURATION_NOT_ALLOWED'], range_too_large: [422, 'RANGE_TOO_LARGE'], availability_unreadable: [422, 'AVAILABILITY_UNREADABLE'],
  };
  for (const [code, [status, stable]] of Object.entries(EXPECTED)) {
    it(`${code} -> ${status} ${stable}, without echoing a request value or repository text`, async () => {
      repo.readHireOffer.mockResolvedValue({ ok: false, code, message: 'leaky: off-1 court-1 org-a' });
      const r = await get();
      const text = await r.text();
      expect(r.status).toBe(status);
      expect(JSON.parse(text).code).toBe(stable);
      expect(text).not.toMatch(/leaky|off-1|court-1|org-a/);
    });
  }
  it('not ready is 503, permission_denied is 403, anything else is a generic 500 with no detail (nothing was written)', async () => {
    repo.readHireOffer.mockRejectedValueOnce(new HireNotReadyError('migration 037'));
    const a = await get();
    expect([a.status, (await json(a)).code]).toEqual([503, 'BOOKING_NOT_READY']);
    repo.readHireOffer.mockRejectedValueOnce(new SchedulingError('permission_denied', 'x'));
    expect((await get()).status).toBe(403);
    repo.readHireOffer.mockRejectedValueOnce(Object.assign(new Error('boom Pat Hirer'), { code: 'XX000' }));
    const c = await get();
    const text = await c.text();
    expect(c.status).toBe(500);
    expect(text).not.toMatch(/boom|Pat|XX000/);
    expect(world.audit).toEqual([]); // a read writes no audit entry
  });
});
