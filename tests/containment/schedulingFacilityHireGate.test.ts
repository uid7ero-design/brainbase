import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Independent feature-gate separation. Staff FACILITY-HIRE booking (SCHEDULING_FACILITY_HIRE + scheduling.facility_hire) and Coach squads/enrolment
// (SCHEDULING_STAFF_BOOKING + scheduling.staff_booking) are two features with two switches and two capabilities. This file runs the REAL guard
// (access.ts, route.ts), the REAL route files and the REAL visibility helpers against a fake session, a fake capability table and a database that throws
// if it is touched. It was written FAILING FIRST against the shared gate: before the separation, the Coach pair alone opened every facility-hire route.

const requireSession = vi.fn();
const entitled = new Set<string>();
const probes: string[] = [];
const world = vi.hoisted(() => ({ dbTouches: 0, runtimeLoads: 0, sessionReads: 0 }));

class CapabilityAccessError extends Error {
  reason = 'not_entitled';
  constructor() { super('Capability access denied'); this.name = 'CapabilityAccessError'; }
}
class CapabilityDatabaseError extends Error {}

vi.mock('@/lib/org', () => ({
  requireSession: () => { world.sessionReads += 1; return requireSession(); },
  unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  forbidden: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/capabilities/requireCapability', () => ({
  requireCapability: async (org: string, key: string) => {
    probes.push(`${org} ${key}`);
    if (!entitled.has(`${org} ${key}`)) throw new CapabilityAccessError();
    return { enabled: true };
  },
  checkCapability: async (org: string, key: string) => {
    probes.push(`${org} ${key}`);
    return { allowed: entitled.has(`${org} ${key}`) };
  },
  CapabilityAccessError,
  CapabilityDatabaseError,
}));
vi.mock('@/lib/organisationUsers/access', () => ({ getUserPermissions: async () => null }));
vi.mock('@/lib/db', () => {
  const boom = () => { world.dbTouches += 1; throw new Error('the database must not be touched'); };
  return { default: Object.assign(boom, { query: boom }) };
});
vi.mock('@/lib/scheduling/runtime', () => ({
  SchedulingConfigurationError: class extends Error {},
  loadSchedulingRuntime: async () => { world.runtimeLoads += 1; throw new Error('the runtime must not be loaded'); },
}));

type Handler = (request: Request, ctx?: unknown) => Promise<Response>;
const reservations = (await import('@/app/api/scheduling/reservations/route')) as unknown as Record<string, Handler>;
const byId = (await import('@/app/api/scheduling/reservations/[reservationId]/route')) as unknown as Record<string, Handler>;
const cancel = (await import('@/app/api/scheduling/reservations/[reservationId]/cancel/route')) as unknown as Record<string, Handler>;
const basis = (await import('@/app/api/scheduling/reservations/basis/route')) as unknown as Record<string, Handler>;
const { authorizeSchedulingRequest } = await import('@/lib/scheduling/access');
const { getFacilityHireVisibility } = await import('@/lib/scheduling/facilityHireVisibility');
const { getStaffBookingVisibility } = await import('@/lib/scheduling/staffBookingVisibility');

const ORG = 'org-a';
const FOREIGN = 'org-b';
const session = (role = 'manager', organisationId = ORG) => ({ userId: 'u1', organisationId, homeOrganisationId: organisationId, role, name: 'U' });
const grant = (org: string, ...keys: string[]) => keys.forEach(k => entitled.add(`${org} ${k}`));
const ctx = { params: Promise.resolve({ reservationId: '00000000-0000-4000-8000-000000000001' }) };
const url = 'http://bb.test/api/scheduling/reservations';

const SAVED = { hire: process.env.SCHEDULING_FACILITY_HIRE, coach: process.env.SCHEDULING_STAFF_BOOKING };
const env = (hire: string | undefined, coach: string | undefined) => {
  if (hire === undefined) delete process.env.SCHEDULING_FACILITY_HIRE; else process.env.SCHEDULING_FACILITY_HIRE = hire;
  if (coach === undefined) delete process.env.SCHEDULING_STAFF_BOOKING; else process.env.SCHEDULING_STAFF_BOOKING = coach;
};

beforeEach(() => {
  requireSession.mockReset();
  requireSession.mockResolvedValue(session());
  entitled.clear();
  probes.length = 0;
  world.dbTouches = 0; world.runtimeLoads = 0; world.sessionReads = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => { env(SAVED.hire, SAVED.coach); });

const hireGate = () => authorizeSchedulingRequest('scheduling.reserve', { feature: 'facility_hire' });
const coachGate = () => authorizeSchedulingRequest('scheduling.reserve', { feature: 'staff_booking' });
const status = (r: { ok: boolean; response?: Response }) => (r.ok ? 200 : r.response!.status);

describe('the previous unwanted coupling is gone: the Coach pair can no longer authorise facility hire', () => {
  it('Coach switch ON + Coach capability held + base capability, facility-hire switch OFF: facility hire answers 404 before the session is read', async () => {
    env(undefined, 'on');
    grant(ORG, 'scheduling', 'scheduling.staff_booking');
    expect(status(await hireGate())).toBe(404);
    expect(world.sessionReads).toBe(0);
    expect(probes).toEqual([]);
  });

  it('Coach switch ON + Coach capability, facility-hire switch ON but NO scheduling.facility_hire capability: 404 (the Coach capability is not accepted)', async () => {
    env('on', 'on');
    grant(ORG, 'scheduling', 'scheduling.staff_booking');
    expect(status(await hireGate())).toBe(404);
    expect(probes).toEqual([`${ORG} scheduling.facility_hire`]);
  });

  it('every one of the four facility-hire routes, every method, answers 404 not_found with only the Coach pair on and entitled', async () => {
    env(undefined, 'on');
    grant(ORG, 'scheduling', 'scheduling.staff_booking');
    const calls: Array<[string, Promise<Response>]> = [
      ['POST /reservations', reservations.POST(new Request(url, { method: 'POST', body: '{}' }))],
      ['GET /reservations', reservations.GET(new Request(`${url}?key=bk_x`))],
      ['GET /reservations/basis', basis.GET(new Request(`${url}/basis?offeringId=o&resourceId=r&from=2026-11-16&to=2026-11-18`))],
      ['GET /reservations/{id}', byId.GET(new Request(`${url}/1`), ctx)],
      ['POST /reservations/{id}/cancel', cancel.POST(new Request(`${url}/1/cancel`, { method: 'POST', body: '{}' }), ctx)],
    ];
    for (const [name, p] of calls) {
      const r = await p;
      expect(r.status, name).toBe(404);
      expect(JSON.parse(await r.text()), name).toEqual({ error: 'not_found' });
    }
    expect(world.sessionReads).toBe(0);
    expect(world.dbTouches).toBe(0);
    expect(world.runtimeLoads).toBe(0);
    expect(probes).toEqual([]);
  });

  it('the routes export only the methods the gate covers (no ungated sibling method)', () => {
    for (const mod of [reservations, byId, cancel, basis]) expect(Object.keys(mod).filter(k => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k)).every(k => typeof mod[k] === 'function')).toBe(true);
    expect(Object.keys(reservations).filter(k => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k)).sort()).toEqual(['GET', 'POST']);
    expect(Object.keys(byId).filter(k => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k))).toEqual(['GET']);
    expect(Object.keys(cancel).filter(k => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k))).toEqual(['POST']);
    expect(Object.keys(basis).filter(k => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k))).toEqual(['GET']);
  });
});

describe('Coach is untouched by the separation', () => {
  it('Coach ON + entitled, facility hire OFF: Coach access still succeeds', async () => {
    env(undefined, 'on');
    grant(ORG, 'scheduling', 'scheduling.staff_booking');
    expect(status(await coachGate())).toBe(200);
    expect(probes).toEqual([`${ORG} scheduling.staff_booking`, `${ORG} scheduling`]);
  });

  it('Coach ON + entitled, facility hire ON + entitled: both features work, each on its own key', async () => {
    env('on', 'on');
    grant(ORG, 'scheduling', 'scheduling.staff_booking', 'scheduling.facility_hire');
    expect(status(await coachGate())).toBe(200);
    expect(status(await hireGate())).toBe(200);
  });

  it('Coach OFF and facility hire OFF: both 404; Coach OFF with facility hire ON: Coach 404, facility hire 200', async () => {
    env(undefined, undefined);
    grant(ORG, 'scheduling', 'scheduling.staff_booking', 'scheduling.facility_hire');
    expect(status(await coachGate())).toBe(404);
    expect(status(await hireGate())).toBe(404);
    env('on', undefined);
    expect(status(await coachGate())).toBe(404);
    expect(status(await hireGate())).toBe(200);
  });

  it('the facility-hire switch and capability alone cannot authorise Coach either', async () => {
    env('on', undefined);
    grant(ORG, 'scheduling', 'scheduling.facility_hire');
    expect(status(await coachGate())).toBe(404);
    env('on', 'on');
    expect(status(await coachGate())).toBe(404); // Coach switch on, but the organisation holds only the facility-hire capability
  });
});

describe('facility hire is permitted only when everything holds, and fails closed otherwise', () => {
  const ready = () => { env('on', undefined); grant(ORG, 'scheduling', 'scheduling.facility_hire'); };

  it('all conditions met: allowed, tenant from the session', async () => {
    ready();
    const r = await hireGate();
    expect(r.ok).toBe(true);
    expect(probes).toEqual([`${ORG} scheduling.facility_hire`, `${ORG} scheduling`]);
  });

  it.each([['off', 'off'], ['ON', 'ON'], ['true', 'true'], ['1', '1'], ['', ''], [' on', ' on'], ['on ', 'on ']])('SCHEDULING_FACILITY_HIRE=%j is not exactly "on": 404, nothing touched', async (_n, value) => {
    ready();
    env(value, undefined);
    expect(status(await hireGate())).toBe(404);
    expect(world.sessionReads).toBe(0);
  });

  it('the base scheduling entitlement is still required (403) even with the facility-hire capability', async () => {
    env('on', undefined);
    grant(ORG, 'scheduling.facility_hire');
    expect(status(await hireGate())).toBe(403);
  });

  it('no session: 401 (the switch is on, so the session decides)', async () => {
    ready();
    requireSession.mockRejectedValue(new Error('no session'));
    expect(status(await hireGate())).toBe(401);
  });

  it.each(['viewer', 'analyst', 'nobody', ''])('role %j lacks scheduling.reserve: 403', async role => {
    ready();
    requireSession.mockResolvedValue(session(role));
    expect(status(await hireGate())).toBe(403);
  });

  it.each(['manager', 'admin', 'super_admin'])('role %s reaches the repository', async role => {
    ready();
    requireSession.mockResolvedValue(session(role));
    expect(status(await hireGate())).toBe(200);
  });

  it('cross-tenant: the capability is asked for the SESSION organisation only, so an organisation that holds it cannot lend it to another', async () => {
    env('on', undefined);
    grant(FOREIGN, 'scheduling', 'scheduling.facility_hire'); // the OTHER organisation is entitled; the session organisation is not
    expect(status(await hireGate())).toBe(404);
    expect(probes).toEqual([`${ORG} scheduling.facility_hire`]);
    expect(probes.some(p => p.startsWith(FOREIGN))).toBe(false);
  });

  it('a failure to DETERMINE the facility-hire entitlement is a 503, never a pass', async () => {
    ready();
    const mod = await import('@/lib/capabilities/requireCapability');
    const spy = vi.spyOn(mod, 'requireCapability').mockRejectedValue(new Error('database down'));
    expect(status(await hireGate())).toBe(503);
    spy.mockRestore();
  });
});

describe('the page-level visibility helpers share nothing', () => {
  it('only the Coach pair on and entitled: the Book button is NOT shown (facility hire visibility false), Coach visibility true', async () => {
    env(undefined, 'on');
    grant(ORG, 'scheduling', 'scheduling.staff_booking');
    expect(await getFacilityHireVisibility()).toBe(false);
    expect(await getStaffBookingVisibility()).toBe(true);
  });

  it('switch off: no session read and no capability read at all', async () => {
    env(undefined, undefined);
    grant(ORG, 'scheduling', 'scheduling.staff_booking', 'scheduling.facility_hire');
    expect(await getFacilityHireVisibility()).toBe(false);
    expect(world.sessionReads).toBe(0);
    expect(probes).toEqual([]);
  });

  it('facility hire on and entitled: shown; the same state cannot show the Coach controls', async () => {
    env('on', undefined);
    grant(ORG, 'scheduling', 'scheduling.facility_hire');
    expect(await getFacilityHireVisibility()).toBe(true);
    expect(await getStaffBookingVisibility()).toBe(false);
  });

  it('facility hire on, capability held for ANOTHER organisation: not shown; a viewer: not shown; a thrown session read: not shown', async () => {
    env('on', undefined);
    grant(FOREIGN, 'scheduling', 'scheduling.facility_hire');
    expect(await getFacilityHireVisibility()).toBe(false);
    grant(ORG, 'scheduling', 'scheduling.facility_hire');
    requireSession.mockResolvedValue(session('viewer'));
    expect(await getFacilityHireVisibility()).toBe(false);
    requireSession.mockRejectedValue(new Error('x'));
    expect(await getFacilityHireVisibility()).toBe(false);
  });
});
