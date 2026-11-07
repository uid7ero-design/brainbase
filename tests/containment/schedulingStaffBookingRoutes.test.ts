import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HIRE_FAILURE_CODES, HireNotReadyError, SchedulingError, hireFailure, type HireFailureCode, type Reservation } from '@scheduling/core';

// Phase 2C.3b: the staff-booking routes through the REAL guard (lib/scheduling/route.ts + access.ts), the REAL handlers and the REAL audit module. Replaced: the session, the capability
// lookup, the database (audit inserts only) and the runtime (a fake repository), so every outcome of createHire / cancel can be produced on demand. The repository's own behaviour
// (locks, versions, idempotency, DST) is proven against PostgreSQL 16/17 and Neon elsewhere; this file proves the HTTP contract, the gates and the privacy of what is returned.

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

const repo = vi.hoisted(() => ({
  createHire: vi.fn(),
  findHireByKey: vi.fn(),
  getById: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@/lib/scheduling/runtime', async () => {
  const { staffTenantContext } = await import('@/lib/scheduling/adapters/brainbase');
  class SchedulingConfigurationError extends Error { code = 'SCHEDULING_NOT_CONFIGURED'; }
  return {
    SchedulingConfigurationError,
    loadSchedulingRuntime: async (session: { organisationId: string; userId: string; role: string }) => {
      world.runtimeLoads += 1;
      return {
        tenant: staffTenantContext({ ...session, timezone: 'Australia/Adelaide' }),
        hire: { createHire: repo.createHire, findHireByKey: repo.findHireByKey },
        persistence: { reservations: { getById: repo.getById, cancel: repo.cancel } },
      };
    },
  };
});

type Handler = (request: Request, context?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
const collection = (await import('@/app/api/scheduling/reservations/route')) as { POST: Handler; GET: Handler };
const one = (await import('@/app/api/scheduling/reservations/[reservationId]/route')) as { GET: Handler };
const cancelRoute = (await import('@/app/api/scheduling/reservations/[reservationId]/cancel/route')) as { POST: Handler };

const KEY = 'hire-key-000001-abcdefgh';
const sessionFor = (role: string, over: Record<string, unknown> = {}) => ({ userId: 'u1', organisationId: 'org-a', homeOrganisationId: 'org-a', role, name: 'U', ...over });
const goodBody = () => ({ offeringId: 'off-1', resourceId: 'court-1', start: { date: '2026-11-16', time: '10:00' }, durationMinutes: 60, partySize: 2, customer: { name: 'Pat Hirer', email: 'pat.hirer@example.com', phone: '0400 000 000' }, notes: 'bring own balls' });
const SECRETS = ['Pat Hirer', 'pat.hirer', 'example.com', '0400 000 000', 'bring own balls'];

const post = (body: unknown, headers: Record<string, string> = { 'idempotency-key': KEY }, url = 'http://bb.test/api/scheduling/reservations') =>
  collection.POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const json = async (r: Response) => JSON.parse(await r.text());

const reservation = (over: Partial<Reservation> = {}): Reservation =>
  ({
    id: 'res-1', organisationId: 'org-a', scheduleId: 's1', presetKey: 'resource_hire', presetVersion: 1, offeringId: 'off-1', resourceId: 'court-1', customerId: null,
    customerSnapshot: { displayName: 'Pat Hirer', email: 'pat.hirer@example.com', emailNormalised: 'pat.hirer@example.com', phone: '0400 000 000' },
    timezone: 'Australia/Adelaide', instants: { startsAt: '2099-11-16T23:30:00Z', endsAt: '2099-11-17T00:30:00Z' }, participants: [], partySize: 2,
    span: { kind: 'slot', date: '2099-11-17', startTime: '10:00', durationMinutes: 60 }, status: 'confirmed', attendance: null, paymentStatus: 'unpaid',
    price: { amountCents: 5000, currency: 'AUD' }, seriesId: null, notes: 'bring own balls', ...over,
  }) as Reservation;

const on = () => { process.env.SCHEDULING_STAFF_BOOKING = 'on'; };
beforeEach(() => {
  process.env.SCHEDULING_STAFF_BOOKING = 'on';
  for (const m of [requireSession, requireCapability, repo.createHire, repo.findHireByKey, repo.getById, repo.cancel]) m.mockReset();
  requireSession.mockResolvedValue(sessionFor('manager'));
  requireCapability.mockResolvedValue({ enabled: true });
  world.audit = [];
  world.auditFails = false;
  world.runtimeLoads = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

// Every entry point, as a function that sends a valid request to it.
const ENTRY: Array<[string, () => Promise<Response>]> = [
  ['POST /reservations', () => post(goodBody())],
  ['GET /reservations?idempotencyKey', () => collection.GET(new Request(`http://bb.test/api/scheduling/reservations?idempotencyKey=${KEY}`))],
  ['GET /reservations/{id}', () => one.GET(new Request('http://bb.test/api/scheduling/reservations/res-1'), { params: Promise.resolve({ reservationId: 'res-1' }) })],
  ['POST /reservations/{id}/cancel', () => cancelRoute.POST(new Request('http://bb.test/api/scheduling/reservations/res-1/cancel', { method: 'POST' }), { params: Promise.resolve({ reservationId: 'res-1' }) })],
];

describe('gate 1: the environment kill switch (default OFF)', () => {
  for (const value of [undefined, '', 'off', 'ON', 'true', '1', 'yes', ' on']) {
    it(`SCHEDULING_STAFF_BOOKING=${JSON.stringify(value)} -> 404 on every route, before the session, the capability table or the database are touched`, async () => {
      if (value === undefined) delete process.env.SCHEDULING_STAFF_BOOKING;
      else process.env.SCHEDULING_STAFF_BOOKING = value;
      for (const [name, call] of ENTRY) {
        const r = await call();
        expect(r.status, name).toBe(404);
        expect(await json(r)).toEqual({ error: 'not_found' });
        expect(r.headers.get('cache-control')).toBe('no-store');
      }
      expect(requireSession).not.toHaveBeenCalled();
      expect(requireCapability).not.toHaveBeenCalled();
      expect(world.runtimeLoads).toBe(0);
      expect(repo.createHire).not.toHaveBeenCalled();
    });
  }

  it('it is read on every request, not cached at import', async () => {
    repo.createHire.mockResolvedValue({ ok: true, reservation: reservation(), replayed: false });
    process.env.SCHEDULING_STAFF_BOOKING = 'off';
    expect((await post(goodBody())).status).toBe(404);
    on();
    expect((await post(goodBody())).status).toBe(201);
    process.env.SCHEDULING_STAFF_BOOKING = 'off';
    expect((await post(goodBody())).status).toBe(404);
  });
});

describe('gate 2: the organisation capability scheduling.staff_booking (nobody has it)', () => {
  it('an organisation without the capability gets the SAME 404 as the kill switch, and nothing is loaded or written', async () => {
    requireCapability.mockImplementation(async (_org: string, key: string) => { if (key === 'scheduling.staff_booking') throw new CapabilityAccessError('NO_ENTITLEMENT'); return { enabled: true }; });
    for (const [name, call] of ENTRY) {
      const r = await call();
      expect(r.status, name).toBe(404);
      expect(await json(r)).toEqual({ error: 'not_found' });
    }
    expect(world.runtimeLoads).toBe(0);
    expect(repo.createHire).not.toHaveBeenCalled();
    expect(world.audit).toEqual([]);
  });

  for (const reason of ['UNKNOWN_CAPABILITY', 'CAPABILITY_INACTIVE', 'NO_ENTITLEMENT', 'ENTITLEMENT_DISABLED'] as const) {
    it(`${reason} -> 404 (an unregistered key, which is today's state everywhere, is simply denied)`, async () => {
      requireCapability.mockImplementation(async (_o: string, key: string) => { if (key === 'scheduling.staff_booking') throw new CapabilityAccessError(reason); return { enabled: true }; });
      expect((await post(goodBody())).status).toBe(404);
    });
  }

  it('a failure to DETERMINE the entitlement is a 503, never a pass', async () => {
    requireCapability.mockImplementation(async (_o: string, key: string) => { if (key === 'scheduling.staff_booking') throw new CapabilityDatabaseError(); return { enabled: true }; });
    expect((await post(goodBody())).status).toBe(503);
    expect(repo.createHire).not.toHaveBeenCalled();
  });

  it('the base scheduling capability is still required (403)', async () => {
    requireCapability.mockImplementation(async (_o: string, key: string) => { if (key === 'scheduling') throw new CapabilityAccessError('NO_ENTITLEMENT'); return { enabled: true }; });
    expect((await post(goodBody())).status).toBe(403);
    expect(repo.createHire).not.toHaveBeenCalled();
  });

  it('both capabilities are asked for the SESSION organisation, in that order, and the body cannot change it', async () => {
    requireSession.mockResolvedValue(sessionFor('manager', { organisationId: 'org-session' }));
    repo.createHire.mockResolvedValue({ ok: true, reservation: reservation(), replayed: false });
    await post(goodBody());
    expect(requireCapability.mock.calls).toEqual([['org-session', 'scheduling.staff_booking'], ['org-session', 'scheduling']]);
    expect(repo.createHire.mock.calls[0][0].organisationId).toBe('org-session');
  });
});

describe('who may call it: session -> role -> permission scheduling.reserve', () => {
  it('no session -> 401 on every route (the switch is on, so the session decides)', async () => {
    requireSession.mockRejectedValue(new Error('Unauthorized'));
    for (const [name, call] of ENTRY) expect((await call()).status, name).toBe(401);
    expect(repo.createHire).not.toHaveBeenCalled();
  });

  for (const role of ['viewer', 'analyst', 'nobody', '']) {
    it(`role ${JSON.stringify(role)} -> 403 on every route; the body carries no scheduling data`, async () => {
      requireSession.mockResolvedValue(sessionFor(role));
      for (const [name, call] of ENTRY) {
        const r = await call();
        expect(r.status, name).toBe(403);
        const text = await r.text();
        for (const secret of [...SECRETS, 'res-1', 'court-1']) expect(text).not.toContain(secret);
      }
      expect(repo.createHire).not.toHaveBeenCalled();
      expect(repo.getById).not.toHaveBeenCalled();
      expect(repo.cancel).not.toHaveBeenCalled();
    });
  }

  for (const role of ['manager', 'admin', 'super_admin']) {
    it(`role ${role} reaches the repository`, async () => {
      requireSession.mockResolvedValue(sessionFor(role));
      repo.createHire.mockResolvedValue({ ok: true, reservation: reservation(), replayed: false });
      expect((await post(goodBody())).status).toBe(201);
    });
  }

  it('an organisation member of ANOTHER organisation cannot name a foreign organisation: the body field is refused and the repository is never called', async () => {
    const r = await post({ ...goodBody(), organisationId: 'org-b' });
    expect(r.status).toBe(400);
    expect((await json(r)).problems).toContain('organisationId');
    expect(repo.createHire).not.toHaveBeenCalled();
  });
});

describe('POST /api/scheduling/reservations: strict validation (nothing reaches the repository)', () => {
  const bad = async (body: unknown, headers?: Record<string, string>) => { const r = await post(body, headers); expect(repo.createHire).not.toHaveBeenCalled(); return r; };

  it('the Idempotency-Key header is required and must be 16-80 of [A-Za-z0-9_-]', async () => {
    expect((await bad(goodBody(), {})).status).toBe(400);
    for (const k of ['short', 'x'.repeat(81), 'has space in it 1234567', 'unicode-é-1234567890']) {
      const r = await bad(goodBody(), { 'idempotency-key': k });
      expect(r.status).toBe(400);
      expect((await json(r)).problems).toContain('idempotencyKey');
    }
  });

  it('unknown fields are refused at every level, and a key in the BODY is not a key', async () => {
    for (const body of [{ ...goodBody(), extra: 1 }, { ...goodBody(), idempotencyKey: KEY }, { ...goodBody(), start: { date: '2026-11-16', time: '10:00', tz: 'UTC' } }, { ...goodBody(), customer: { name: 'x', id: 'c1' } }, { ...goodBody(), basis: { offeringVersion: '1', resourceVersion: '1', offeringToken: 't', scheduleToken: 't', x: 1 } }, { ...goodBody(), stepMinutes: 30 }, { ...goodBody(), startsAt: '2026-11-16T00:00:00Z' }]) {
      const r = await bad(body);
      expect(r.status).toBe(400);
      expect((await json(r)).code).toBe('VALIDATION');
    }
  });

  it('wrong types and rule violations name the FIELD, never the value', async () => {
    const cases: Array<[unknown, string]> = [
      [{ ...goodBody(), offeringId: 5 }, 'offeringId'],
      [{ ...goodBody(), start: 'monday' }, 'start'],
      [{ ...goodBody(), start: { date: '2026-13-40', time: '10:00' } }, 'start.date'],
      [{ ...goodBody(), start: { date: '2026-11-16', time: '25:99' } }, 'start.time'],
      [{ ...goodBody(), partySize: '2' }, 'partySize'],
      [{ ...goodBody(), partySize: 0 }, 'partySize'],
      [{ ...goodBody(), durationMinutes: 'long' }, 'durationMinutes'],
      [{ ...goodBody(), customer: { name: '   ' } }, 'customer.name'],
      [{ ...goodBody(), customer: { name: 'ok', email: 'not-an-email' } }, 'customer.email'],
      [{ ...goodBody(), customer: { name: 'ok', phone: 'call me' } }, 'customer.phone'],
      [{ ...goodBody(), customer: 'Pat' }, 'customer'],
      [{ ...goodBody(), notes: 'x'.repeat(1001) }, 'notes'],
      [{ ...goodBody(), notes: 7 }, 'notes'],
    ];
    for (const [body, field] of cases) {
      const r = await bad(body);
      const text = await r.text();
      expect(r.status, field).toBe(400);
      expect(JSON.parse(text).problems, field).toContain(field);
      expect(text).not.toContain('not-an-email');
      expect(text).not.toContain('call me');
    }
  });

  it('only application/json objects are read', async () => {
    expect((await bad('not json')).status).toBe(400);
    expect((await bad('[]')).status).toBe(400);
    expect((await bad('null')).status).toBe(400);
    const r = await collection.POST(new Request('http://bb.test/api/scheduling/reservations', { method: 'POST', headers: { 'content-type': 'text/plain', 'idempotency-key': KEY }, body: JSON.stringify(goodBody()) }));
    expect(r.status).toBe(415);
    expect(repo.createHire).not.toHaveBeenCalled();
  });

  it('a valid request reaches createHire with the HEADER key, the SESSION tenant and nothing else', async () => {
    repo.createHire.mockResolvedValue({ ok: true, reservation: reservation(), replayed: false });
    await post({ ...goodBody(), basis: { offeringVersion: '3', resourceVersion: '5', offeringToken: 'a', scheduleToken: 'b' } }, { 'idempotency-key': `  ${KEY}  ` });
    const [tenant, request] = repo.createHire.mock.calls[0];
    expect(tenant.organisationId).toBe('org-a');
    expect(request).toEqual({ ...goodBody(), idempotencyKey: KEY, basis: { offeringVersion: '3', resourceVersion: '5', offeringToken: 'a', scheduleToken: 'b' } });
    expect(Object.keys(request)).not.toContain('organisationId');
  });
});

describe('POST /api/scheduling/reservations: the outcomes', () => {
  it('created -> 201 with the staff view; a replay of the same key and payload -> 200 replayed', async () => {
    repo.createHire.mockResolvedValueOnce({ ok: true, reservation: reservation(), replayed: false });
    const created = await post(goodBody());
    expect(created.status).toBe(201);
    const body = await json(created);
    expect(body.replayed).toBe(false);
    expect(body.reservation).toMatchObject({ id: 'res-1', status: 'confirmed', offeringId: 'off-1', resourceId: 'court-1', partySize: 2, durationMinutes: 60, customer: { name: 'Pat Hirer', email: 'pat.hirer@example.com', phone: '0400 000 000' } });
    expect(Object.keys(body.reservation).sort()).toEqual(['customer', 'durationMinutes', 'endsAt', 'id', 'notes', 'offeringId', 'partySize', 'paymentStatus', 'price', 'resourceId', 'start', 'startsAt', 'status', 'timezone']);
    expect(JSON.stringify(body)).not.toMatch(/organisation|org-a|idempotency|customerId|seriesId|attendance|createdBy/i);
    repo.createHire.mockResolvedValueOnce({ ok: true, reservation: reservation(), replayed: true });
    const replay = await post(goodBody());
    expect(replay.status).toBe(200);
    expect((await json(replay)).replayed).toBe(true);
  });

  const EXPECTED: Record<HireFailureCode, [number, string]> = {
    validation: [400, 'VALIDATION'], duration_not_allowed: [422, 'DURATION_NOT_ALLOWED'], preset_not_supported: [422, 'OFFERING_NOT_BOOKABLE'], nonexistent_local_time: [422, 'NONEXISTENT_LOCAL_TIME'],
    resource_not_eligible: [422, 'RESOURCE_NOT_ELIGIBLE'], idempotency_conflict: [409, 'IDEMPOTENCY_CONFLICT'], not_found: [404, 'NOT_FOUND'], offering_unavailable: [409, 'OFFERING_UNAVAILABLE'],
    resource_inactive: [409, 'RESOURCE_INACTIVE'], outside_availability: [409, 'OUTSIDE_AVAILABILITY'], off_grid: [409, 'OFF_GRID'], in_the_past: [422, 'IN_THE_PAST'], resource_conflict: [409, 'RESOURCE_CONFLICT'],
    party_exceeds_resource: [422, 'PARTY_NOT_ALLOWED'], availability_changed: [409, 'AVAILABILITY_CHANGED'], contention_timeout: [503, 'CONTENTION_TIMEOUT'], outcome_unknown: [504, 'OUTCOME_UNKNOWN'],
  };
  it('every code of the hire taxonomy has exactly one stable status and code', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...HIRE_FAILURE_CODES].sort());
  });
  for (const code of HIRE_FAILURE_CODES) {
    it(`${code} -> ${EXPECTED[code][0]} ${EXPECTED[code][1]}, a fixed sentence that carries no request field, no repository text and writes no audit entry`, async () => {
      // the repository's message and problems are loaded with secrets: none of it may be echoed except field NAMES
      repo.createHire.mockResolvedValue(hireFailure(code, `leaky: ${SECRETS.join(' / ')}`, code === 'validation' ? { problems: ['partySize'] } : {}));
      const r = await post(goodBody());
      const text = await r.text();
      expect(r.status).toBe(EXPECTED[code][0]);
      expect(JSON.parse(text).code).toBe(EXPECTED[code][1]);
      for (const secret of [...SECRETS, 'leaky']) expect(text).not.toContain(secret);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(world.audit).toEqual([]);
    });
  }

  it('AVAILABILITY_CHANGED returns the fresh basis; CONTENTION_TIMEOUT carries Retry-After; OUTCOME_UNKNOWN is marked retryable with the same key', async () => {
    const basis = { offeringVersion: '4', resourceVersion: '6', offeringToken: 't1', scheduleToken: 't2' };
    repo.createHire.mockResolvedValueOnce(hireFailure('availability_changed', 'x', { basis }));
    expect((await json(await post(goodBody()))).basis).toEqual(basis);
    repo.createHire.mockResolvedValueOnce(hireFailure('contention_timeout', 'x'));
    const busy = await post(goodBody());
    expect(busy.headers.get('retry-after')).toBe('1');
    expect((await json(busy)).retryable).toBe(true);
    repo.createHire.mockResolvedValueOnce(hireFailure('outcome_unknown', 'x'));
    const unknown = await json(await post(goodBody()));
    expect(unknown).toMatchObject({ code: 'OUTCOME_UNKNOWN', retryable: true });
    expect(unknown.error).toMatch(/same idempotency key/i);
  });

  it('a repository that is not ready (no transaction, missing 037) is a generic 503 and writes nothing', async () => {
    repo.createHire.mockRejectedValue(new HireNotReadyError('internal detail: migration 037'));
    const r = await post(goodBody());
    const text = await r.text();
    expect(r.status).toBe(503);
    expect(JSON.parse(text).code).toBe('BOOKING_NOT_READY');
    expect(text).not.toMatch(/037|migration|transaction/i);
    expect(world.audit).toEqual([]);
  });

});

// Phase 2C.3c-A: an UNEXPECTED error from createHire (anything that is not a classified HireFailure) can happen before the transaction is sent, while it runs, or after it committed.
// The handler cannot tell which, so it must never answer "failed". It asks the database about the ORIGINAL tenant-scoped idempotency key (never a new one) and returns the booking if
// it exists and is this request's; a different booking under the key is the stable IDEMPOTENCY_CONFLICT; anything unresolved is 504 OUTCOME_UNKNOWN with the same-key retry contract.
describe('unexpected errors on create: reconciled by the ORIGINAL key, never reported as a definite failure, never a duplicate', () => {
  const boom = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {});
  const mine = () => reservation({ span: { kind: 'slot', date: '2026-11-16', startTime: '10:00', durationMinutes: 60 } } as never);
  const noLeak = (text: string) => { for (const s of [...SECRETS, 'deadlock', 'leaky', 'ECONNRESET', 'Internal error', '40P01']) expect(text).not.toContain(s); };

  it('BEFORE the transaction (nothing found by the key): 504 OUTCOME_UNKNOWN, retryable with the SAME key - not a 500 and not "failed"; one createHire, one lookup by the original key', async () => {
    repo.createHire.mockRejectedValue(boom('fetch failed ECONNRESET Pat Hirer leaky'));
    repo.findHireByKey.mockResolvedValue(null);
    const r = await post(goodBody());
    const text = await r.text();
    expect(r.status).toBe(504);
    expect(JSON.parse(text)).toMatchObject({ code: 'OUTCOME_UNKNOWN', retryable: true });
    expect(JSON.parse(text).error).toMatch(/same idempotency key/i);
    expect(text).not.toMatch(/nothing was booked|did not|failed|not booked/i);
    noLeak(text);
    expect(repo.createHire).toHaveBeenCalledTimes(1);
    expect(repo.createHire.mock.calls[0][1].idempotencyKey).toBe(KEY);
    expect(repo.findHireByKey).toHaveBeenCalledTimes(1);
    expect(repo.findHireByKey.mock.calls[0][1]).toBe(KEY);
    expect(repo.findHireByKey.mock.calls[0][0].organisationId).toBe('org-a'); // tenant scoped
    expect(world.audit).toEqual([]);
  });

  it('DURING the transaction (it committed but the reply or a later read failed): the booking is found by the key and returned as recovered, audited once, without a name or note', async () => {
    repo.createHire.mockRejectedValue(boom('deadlock detected: Pat Hirer', '40P01'));
    repo.findHireByKey.mockResolvedValue(mine());
    const r = await post(goodBody());
    expect(r.status).toBe(201);
    const body = await json(r);
    expect(body).toMatchObject({ replayed: false, recovered: true, reservation: { id: 'res-1', status: 'confirmed' } });
    expect(repo.createHire).toHaveBeenCalledTimes(1);
    expect(repo.findHireByKey.mock.calls.map(c => c[1])).toEqual([KEY]);
    expect(world.audit).toHaveLength(1);
    expect(world.audit[0].action).toBe('scheduling.reservation.created');
    expect(world.audit[0].afterState.summary).toMatchObject({ recovered: true, source: 'staff_form' });
    for (const secret of SECRETS) expect(JSON.stringify(world.audit[0])).not.toContain(secret);
  });

  it('AFTER the transaction (createHire returned a committed booking but building the response threw): 504 OUTCOME_UNKNOWN - never a 500 - and the same key resolves it', async () => {
    repo.createHire.mockResolvedValue({ ok: true, reservation: { ...mine(), span: null, customerSnapshot: null }, replayed: false });
    const r = await post(goodBody());
    const text = await r.text();
    expect(r.status).toBe(504);
    expect(JSON.parse(text)).toMatchObject({ code: 'OUTCOME_UNKNOWN', retryable: true });
    noLeak(text);
    expect(repo.createHire).toHaveBeenCalledTimes(1);
  });

  it('a different booking already holds the key: IDEMPOTENCY_CONFLICT (this attempt cannot have committed), not a booking and not unknown', async () => {
    repo.createHire.mockRejectedValue(boom('boom'));
    repo.findHireByKey.mockResolvedValue(reservation({ partySize: 9, span: { kind: 'slot', date: '2026-11-16', startTime: '10:00', durationMinutes: 60 } } as never));
    const r = await post(goodBody());
    expect(r.status).toBe(409);
    expect((await json(r)).code).toBe('IDEMPOTENCY_CONFLICT');
    expect(world.audit).toEqual([]);
  });

  it('a lookup that itself fails, or finds a class/other-preset booking under the key, stays 504 OUTCOME_UNKNOWN (never a guess)', async () => {
    repo.createHire.mockRejectedValue(boom('boom'));
    repo.findHireByKey.mockRejectedValueOnce(boom('lookup down'));
    const a = await post(goodBody());
    expect(a.status).toBe(504);
    repo.findHireByKey.mockResolvedValueOnce(reservation({ presetKey: 'group_class' } as never));
    const b = await post(goodBody());
    expect(b.status).toBe(504);
    expect((await json(b)).code).toBe('OUTCOME_UNKNOWN');
    expect(world.audit).toEqual([]);
  });

  it('whatever is thrown (string, undefined, plain object, a timeout) is treated the same way and leaks nothing', async () => {
    for (const thrown of ['Pat Hirer exploded', undefined, { code: '57014', message: 'leaky' }, boom('The operation was aborted', 'ABORT_ERR')]) {
      repo.createHire.mockReset();
      repo.findHireByKey.mockReset();
      repo.createHire.mockRejectedValue(thrown);
      repo.findHireByKey.mockResolvedValue(null);
      const r = await post(goodBody());
      const text = await r.text();
      expect(r.status).toBe(504);
      expect(JSON.parse(text).code).toBe('OUTCOME_UNKNOWN');
      noLeak(text);
    }
  });

  it('a failing audit store after a recovered booking never changes the successful response', async () => {
    world.auditFails = true;
    repo.createHire.mockRejectedValue(boom('reply lost'));
    repo.findHireByKey.mockResolvedValue(mine());
    const r = await post(goodBody());
    expect(r.status).toBe(201);
    expect((await json(r)).reservation.id).toBe('res-1');
  });

  it('known outcomes are preserved and trigger NO reconciliation: not-ready is 503 and permission_denied is 403', async () => {
    repo.createHire.mockRejectedValueOnce(new HireNotReadyError('x'));
    expect((await post(goodBody())).status).toBe(503);
    repo.createHire.mockRejectedValueOnce(new SchedulingError('permission_denied', 'x'));
    expect((await post(goodBody())).status).toBe(403);
    repo.createHire.mockResolvedValueOnce(hireFailure('resource_conflict', 'x'));
    expect((await post(goodBody())).status).toBe(409);
    expect(repo.findHireByKey).not.toHaveBeenCalled();
  });
});

describe('audit: after the commit, without a name, a contact detail or a note', () => {
  it('a created booking writes ONE scheduling.reservation.created entry with ids, the local window, the party size and the source - and no identity', async () => {
    repo.createHire.mockResolvedValue({ ok: true, reservation: reservation(), replayed: false });
    expect((await post(goodBody())).status).toBe(201);
    expect(world.audit).toHaveLength(1);
    const entry = world.audit[0];
    expect(entry).toMatchObject({ action: 'scheduling.reservation.created', resourceType: 'scheduling.reservation', resourceId: 'res-1', org: 'org-a', userId: 'u1' });
    expect(entry.afterState.summary).toEqual({ offering_id: 'off-1', resource_id: 'court-1', local_date: '2099-11-17', local_start_time: '10:00', duration_minutes: 60, party_size: 2, source: 'staff_form' });
    expect(entry.afterState.identity).toBeUndefined();
    const stored = JSON.stringify(entry);
    for (const secret of SECRETS) expect(stored).not.toContain(secret);
  });

  it('a replay writes no second entry; a recovered booking (created by this call after an unknown outcome) is audited once', async () => {
    repo.createHire.mockResolvedValueOnce({ ok: true, reservation: reservation(), replayed: true });
    await post(goodBody());
    expect(world.audit).toEqual([]);
    repo.createHire.mockResolvedValueOnce({ ok: true, reservation: reservation(), replayed: false, recovered: true });
    const r = await post(goodBody());
    expect(r.status).toBe(201);
    expect((await json(r)).recovered).toBe(true);
    expect(world.audit).toHaveLength(1);
  });

  it('a failing audit write never undoes or hides a committed booking', async () => {
    world.auditFails = true;
    repo.createHire.mockResolvedValue({ ok: true, reservation: reservation(), replayed: false });
    const r = await post(goodBody());
    expect(r.status).toBe(201);
    expect((await json(r)).reservation.id).toBe('res-1');
    expect(console.error).toHaveBeenCalled();
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    for (const secret of SECRETS) expect(logged).not.toContain(secret);
  });

  it('the request log line carries the route template, status, duration and database numbers - no id, key, name or body', async () => {
    repo.createHire.mockResolvedValue({ ok: true, reservation: reservation(), replayed: false });
    await post(goodBody());
    one.GET(new Request('http://bb.test/api/scheduling/reservations/res-1'), { params: Promise.resolve({ reservationId: 'res-1' }) });
    repo.getById.mockResolvedValue(reservation());
    await one.GET(new Request('http://bb.test/api/scheduling/reservations/res-1'), { params: Promise.resolve({ reservationId: 'res-1' }) });
    const lines = (console.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => String(c[1]));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const secret of [...SECRETS, KEY, 'res-1', 'org-a', 'u1']) expect(line).not.toContain(secret);
      expect(JSON.parse(line)).toEqual(expect.objectContaining({ route: expect.any(String), method: expect.any(String), status: expect.any(Number), ms: expect.any(Number), dbMs: expect.any(Number) }));
    }
  });
});

describe('GET: only a facility-hire booking of the session organisation, only for scheduling.reserve', () => {
  const get = (id: string) => one.GET(new Request(`http://bb.test/api/scheduling/reservations/${id}`), { params: Promise.resolve({ reservationId: id }) });
  it('returns the staff view', async () => {
    repo.getById.mockResolvedValue(reservation());
    const r = await get('res-1');
    expect(r.status).toBe(200);
    expect((await json(r)).reservation.customer.name).toBe('Pat Hirer');
    expect(repo.getById.mock.calls[0][0].organisationId).toBe('org-a');
    expect(repo.getById.mock.calls[0][1]).toBe('res-1');
  });
  it('an absent, foreign, class or malformed id is the same 404', async () => {
    repo.getById.mockResolvedValueOnce(null);
    expect((await get('res-x')).status).toBe(404);
    repo.getById.mockResolvedValueOnce(reservation({ presetKey: 'classes_coaching', span: { kind: 'occurrence', occurrenceId: 'o1' } } as never));
    expect((await get('res-2')).status).toBe(404);
    expect((await get('bad id!')).status).toBe(404);
    expect(repo.getById).toHaveBeenCalledTimes(2);
  });
  it('lookup by idempotency key: one booking or 404, never a list, and no other query parameter', async () => {
    const byKey = (q: string) => collection.GET(new Request(`http://bb.test/api/scheduling/reservations${q}`));
    repo.findHireByKey.mockResolvedValueOnce(reservation());
    expect((await byKey(`?idempotencyKey=${KEY}`)).status).toBe(200);
    expect(repo.findHireByKey.mock.calls[0][1]).toBe(KEY);
    repo.findHireByKey.mockResolvedValueOnce(null);
    expect((await byKey(`?idempotencyKey=${KEY}`)).status).toBe(404);
    expect((await byKey('')).status).toBe(400);
    expect((await byKey(`?idempotencyKey=${KEY}&organisationId=org-b`)).status).toBe(400);
    expect((await byKey('?limit=50')).status).toBe(400);
  });
});

describe('POST /api/scheduling/reservations/{id}/cancel', () => {
  const cancel = (id = 'res-1', body?: unknown) =>
    cancelRoute.POST(new Request(`http://bb.test/api/scheduling/reservations/${id}/cancel`, { method: 'POST', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }) }), { params: Promise.resolve({ reservationId: id }) });
  const cancelled = () => reservation({ status: 'cancelled' } as never);

  it('a failure AFTER the cancel committed (the re-read) is still a 200 cancelled with the booking, audited once - never a 500', async () => {
    repo.getById.mockResolvedValueOnce(reservation()).mockRejectedValueOnce(Object.assign(new Error('read failed'), { code: '08006' }));
    repo.cancel.mockResolvedValue({ status: 'cancelled', cancelledReservationIds: ['res-1'], charge: null });
    const r = await cancel('res-1');
    expect(r.status).toBe(200);
    expect((await json(r)).reservation).toMatchObject({ id: 'res-1', status: 'cancelled' });
    expect(world.audit).toHaveLength(1);
  });

  it('cancels a future hire as staff (this occurrence only), audits it without the reason text, and returns the cancelled row', async () => {
    repo.getById.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(cancelled());
    repo.cancel.mockResolvedValue({ status: 'cancelled', cancelledReservationIds: ['res-1'], charge: null });
    const r = await cancel('res-1', { reason: 'Customer rang to cancel' });
    expect(r.status).toBe(200);
    expect((await json(r)).reservation.status).toBe('cancelled');
    expect(repo.cancel.mock.calls[0][1]).toEqual({ reservationId: 'res-1', cancelledBy: 'staff', reason: 'Customer rang to cancel', scope: 'this_occurrence' });
    expect(world.audit).toHaveLength(1);
    expect(world.audit[0].action).toBe('scheduling.reservation.cancelled');
    expect(world.audit[0].afterState.summary).toMatchObject({ has_reason: true, source: 'staff_form' });
    expect(JSON.stringify(world.audit[0])).not.toMatch(/Customer rang|Pat Hirer|pat\.hirer/);
  });

  it('a body is optional; an empty reason is no reason', async () => {
    repo.getById.mockResolvedValue(reservation());
    repo.cancel.mockResolvedValue({ status: 'cancelled', cancelledReservationIds: ['res-1'], charge: null });
    expect((await cancel('res-1')).status).toBe(200);
    expect(repo.cancel.mock.calls[0][1].reason).toBeNull();
    expect((await cancel('res-1', { reason: '   ' })).status).toBe(200);
    expect(repo.cancel.mock.calls[1][1].reason).toBeNull();
  });

  it('an already-cancelled booking answers 200 with its state and does not cancel or audit again', async () => {
    repo.getById.mockResolvedValue(cancelled());
    const r = await cancel();
    expect(r.status).toBe(200);
    expect((await json(r)).alreadyCancelled).toBe(true);
    expect(repo.cancel).not.toHaveBeenCalled();
    expect(world.audit).toEqual([]);
  });

  it('losing a race to another cancel is the same idempotent 200', async () => {
    repo.getById.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(cancelled());
    repo.cancel.mockResolvedValue({ status: 'rejected', reason: 'already_cancelled' });
    const r = await cancel();
    expect(r.status).toBe(200);
    expect((await json(r)).alreadyCancelled).toBe(true);
    expect(world.audit).toEqual([]);
  });

  it('a booking that has already started is 422 IN_THE_PAST and is not touched', async () => {
    repo.getById.mockResolvedValue(reservation({ instants: { startsAt: '2020-01-01T00:00:00Z', endsAt: '2020-01-01T01:00:00Z' } }));
    const r = await cancel();
    expect(r.status).toBe(422);
    expect((await json(r)).code).toBe('IN_THE_PAST');
    expect(repo.cancel).not.toHaveBeenCalled();
  });

  it('absent, foreign, class and malformed ids are the same 404', async () => {
    repo.getById.mockResolvedValueOnce(null);
    expect((await cancel('res-x')).status).toBe(404);
    repo.getById.mockResolvedValueOnce(reservation({ presetKey: 'classes_coaching', span: { kind: 'occurrence', occurrenceId: 'o' } } as never));
    expect((await cancel('res-y')).status).toBe(404);
    expect((await cancel('bad id!')).status).toBe(404);
    expect(repo.cancel).not.toHaveBeenCalled();
  });

  it('the body is strict: unknown fields, markup, control characters and overlong reasons are refused before any read', async () => {
    for (const body of [{ reason: 'ok', status: 'confirmed' }, { organisationId: 'org-b' }, { reason: '<b>x</b>' }, { reason: 'x'.repeat(201) }, { reason: 'a\u0000b' }, { reason: 5 }, '[]', 'nope']) {
      const r = await cancel('res-1', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(repo.getById).not.toHaveBeenCalled();
    expect(repo.cancel).not.toHaveBeenCalled();
  });

  it('an unknown outcome is settled by reading: cancelled -> recovered 200 (audited once); not cancelled or unreadable -> 504 OUTCOME_UNKNOWN', async () => {
    repo.getById.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(cancelled());
    repo.cancel.mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' }));
    const recovered = await cancel();
    expect(recovered.status).toBe(200);
    expect((await json(recovered)).recovered).toBe(true);
    expect(world.audit).toHaveLength(1);

    repo.getById.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(reservation());
    repo.cancel.mockRejectedValueOnce(new Error('fetch failed'));
    expect((await cancel()).status).toBe(504);

    repo.getById.mockResolvedValueOnce(reservation()).mockRejectedValueOnce(new Error('down'));
    repo.cancel.mockRejectedValueOnce(new Error('fetch failed'));
    const unknown = await cancel();
    expect(unknown.status).toBe(504);
    expect((await json(unknown)).code).toBe('OUTCOME_UNKNOWN');
    expect(world.audit).toHaveLength(1);
  });

  it('a failing audit write never turns a committed cancellation into an error', async () => {
    world.auditFails = true;
    repo.getById.mockResolvedValueOnce(reservation()).mockResolvedValueOnce(cancelled());
    repo.cancel.mockResolvedValue({ status: 'cancelled', cancelledReservationIds: ['res-1'], charge: null });
    expect((await cancel()).status).toBe(200);
  });
});
