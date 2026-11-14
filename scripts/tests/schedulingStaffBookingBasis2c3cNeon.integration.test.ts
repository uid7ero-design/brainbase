import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { PRESETS, defaultScheduleConfig } from '@scheduling/core';
import { PostgresAvailabilityRepository, fromNeonHttpLike } from '@scheduling/postgres';
import { TZ } from '../../packages/scheduling-postgres/tests/support/builders';
import { staff, uid } from '../../packages/scheduling-postgres/tests/support/pgHarness';

// Phase 2C.3c-B: the staff availability basis (GET /api/scheduling/reservations/basis), together with the 2C.3b booking routes it feeds, with the REAL @neondatabase/serverless HTTP driver as `@/lib/db`, against a DISPOSABLE Neon branch only. Opt-in: skipped unless NEON_REHEARSAL_URL is
// set. The real guard, the real runtime, the real host SQL executor (statement recorder + forwarded transaction), the real repositories and the real driver are exercised; the session and
// the capability lookup are replaced (the rehearsal role has no access to the users or modules tables), and fault injection wraps the driver's transaction().
//
// SAFETY (the same guard as neonHttpHire): refuses to run unless NEON_REHEARSAL_HOST equals the host of NEON_REHEARSAL_URL, the login role is exactly rehearsal_037, and migration 037 is present.
// Only two synthetic organisations (neon-route-a, neon-route-b) are written, and they are removed afterwards. Every other organisation's rows (the Production-data copy, including the pilot and
// LD Tennis) are fingerprinted before and after and must be identical. No credential is stored here.

const URL_ = process.env.NEON_REHEARSAL_URL ?? '';
const EXPECTED_HOST = process.env.NEON_REHEARSAL_HOST ?? '';
const suite = URL_ !== '' ? describe : describe.skip;

const ORG = 'neon-route-a';
const OTHER = 'neon-route-b';

const state = vi.hoisted(() => ({ loseNextReply: false, failNextBeforeSend: false, batches: 0, session: null as null | { userId: string; organisationId: string; role: string }, noCapability: false }));

vi.mock('@/lib/org', () => ({
  requireSession: async () => {
    if (!state.session) throw new Error('Unauthorized');
    return { ...state.session, homeOrganisationId: state.session.organisationId, name: 'Neon Tester' };
  },
  unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  forbidden: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/organisationUsers/access', () => ({ getUserPermissions: async () => null }));
vi.mock('@/lib/capabilities/requireCapability', () => {
  class CapabilityAccessError extends Error {
    reason: string;
    constructor(reason: string) { super('Capability access denied'); this.name = 'CapabilityAccessError'; this.reason = reason; }
  }
  class CapabilityDatabaseError extends Error {}
  return {
    CapabilityAccessError,
    CapabilityDatabaseError,
    requireCapability: async (_org: string, key: string) => {
      if (state.noCapability && key === 'scheduling.facility_hire') throw new CapabilityAccessError('NO_ENTITLEMENT');
      return { enabled: true };
    },
  };
});
vi.mock('@/lib/db', async () => {
  const { neon: n } = await import('@neondatabase/serverless');
  const real = n(process.env.NEON_REHEARSAL_URL || 'postgres://u:p@localhost.invalid/db') as unknown as {
    (s: TemplateStringsArray, ...v: unknown[]): Promise<unknown>;
    query: (text: string, params?: unknown[], opts?: unknown) => unknown;
    transaction: (queries: unknown[], opts?: unknown) => Promise<unknown[]>;
  };
  const wrapped = Object.assign((s: TemplateStringsArray, ...v: unknown[]) => real(s, ...v), {
    query: (text: string, params?: unknown[], opts?: unknown) => real.query(text, params, opts), // the driver's own lazy query object, untouched
    transaction: async (queries: unknown[], opts?: unknown) => {
      state.batches += 1;
      if (state.failNextBeforeSend) {
        state.failNextBeforeSend = false;
        throw Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' }); // nothing reaches the database
      }
      const out = await real.transaction(queries, opts); // the REAL commit
      if (state.loseNextReply) {
        state.loseNextReply = false;
        throw Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' }); // ... and the reply is lost
      }
      return out;
    },
  });
  return { default: wrapped };
});

type Handler = (request: Request, context?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
const collection = (await import('@/app/api/scheduling/reservations/route')) as unknown as { POST: Handler; GET: Handler };
const basisRoute = (await import('@/app/api/scheduling/reservations/basis/route')) as unknown as { GET: Handler };

type Q = { query(text: string, params?: unknown[], opts?: Record<string, unknown>): Promise<unknown>; transaction: (q: unknown[], o?: Record<string, unknown>) => Promise<unknown[]> };
let sql: Q;
let avail: PostgresAvailabilityRepository;
const rows = async (text: string, params: unknown[] = []) => (await sql.query(text, params)) as Array<Record<string, unknown>>;
const as = (userId: string, organisationId: string, role = 'manager') => { state.session = { userId, organisationId, role }; };

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Outcome { status: number; json: Json; text: string; headers: Headers; ms: number }
const safe = (t: string) => { try { return JSON.parse(t); } catch { return null; } };
async function call(h: Handler, url: string, method: 'GET' | 'POST', init: { body?: unknown; key?: string; params?: Record<string, string> } = {}): Promise<Outcome> {
  const started = performance.now();
  const response = await h(new Request(url, { method, headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.key ? { 'idempotency-key': init.key } : {}) }, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) }), { params: Promise.resolve(init.params ?? {}) });
  const text = await response.text();
  return { status: response.status, json: text ? safe(text) : null, text, headers: response.headers, ms: Math.round(performance.now() - started) };
}
const BASE = 'http://bb.test/api/scheduling/reservations';
let keySeq = 0;
const newKey = () => `neon-route-${String(++keySeq).padStart(5, '0')}-${Math.random().toString(36).slice(2, 10)}`;
const create = (body: unknown, key: string | null = newKey()) => call(collection.POST, BASE, 'POST', { body, ...(key ? { key } : {}) });

function nextWeekday(dayOfWeek: number, minDaysAhead: number): string {
  const d = new Date(Date.now() + minDaysAhead * 86_400_000);
  d.setUTCHours(12, 0, 0, 0);
  while (d.getUTCDay() !== dayOfWeek) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const MONDAY = nextWeekday(1, 40);
interface Fx { schedule: string; offering: string; court: string; court2: string }
const body = (f: Fx, over: Record<string, unknown> = {}) => ({ offeringId: f.offering, resourceId: f.court, start: { date: MONDAY, time: '10:00' }, durationMinutes: 60, partySize: 2, customer: { name: 'Neon Hirer', email: 'neon.hirer@example.com', phone: '0400 555 123' }, notes: 'neon note', ...over });
const hours = { kind: 'hours' as const, label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null };

async function fixture(org = ORG): Promise<Fx> {
  const f = { schedule: uid('nsch'), offering: uid('noff'), court: uid('ncourt'), court2: uid('ncourt') };
  const cfg = defaultScheduleConfig({ id: f.schedule, organisationId: org, name: 'neon route hire', presetKey: 'resource_hire' });
  await sql.query(
    `INSERT INTO scheduling_schedules (id, organisation_id, name, preset_key, preset_version, public_slug, terminology, cancellation_policy, timezone) VALUES ($1, $2, $3, 'resource_hire', $4, NULL, $5::jsonb, $6::jsonb, NULL)`,
    [f.schedule, org, cfg.name, PRESETS.resource_hire.version, JSON.stringify(cfg.terminology), JSON.stringify(cfg.cancellationPolicy)],
  );
  await sql.query(`INSERT INTO scheduling_offerings (id, organisation_id, schedule_id, name, capacity, duration_minutes, price_cents, currency) VALUES ($1, $2, $3, 'neon route offering', NULL, 60, 5000, 'AUD')`, [f.offering, org, f.schedule]);
  for (const c of [f.court, f.court2]) {
    await sql.query(`INSERT INTO scheduling_resources (id, organisation_id, kind, name, capacity, active) VALUES ($1, $2, 'court', 'neon route court', 4, true)`, [c, org]);
    await sql.query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [org, f.offering, c]);
  }
  const t = staff(org);
  for (const owner of [{ kind: 'offering' as const, id: f.offering }, { kind: 'resource' as const, id: f.court }, { kind: 'resource' as const, id: f.court2 }]) {
    const r = await avail.createRule(t, owner, hours, TZ);
    if (!r.ok) throw new Error(`fixture rule: ${JSON.stringify(r)}`);
  }
  return f;
}
const total = async (f: Fx, org = ORG) => Number((await rows('SELECT count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1 AND offering_id = $2', [org, f.offering]))[0].n);
const holds = async (f: Fx, org = ORG) => Number((await rows('SELECT count(*)::int AS n FROM scheduling_resource_holds h WHERE h.organisation_id = $1 AND h.released_at IS NULL AND h.resource_id IN ($2, $3)', [org, f.court, f.court2]))[0].n);
const overlaps = async (f: Fx) => Number((await rows('SELECT count(*)::int AS n FROM scheduling_resource_holds a JOIN scheduling_resource_holds b ON a.organisation_id = b.organisation_id AND a.resource_id = b.resource_id AND a.id < b.id AND a.during && b.during WHERE a.released_at IS NULL AND b.released_at IS NULL AND a.organisation_id = $1 AND a.resource_id IN ($2, $3)', [ORG, f.court, f.court2]))[0].n);

const OTHERS_SNAPSHOT_SQL = `SELECT
  (SELECT count(*)::int FROM scheduling_reservations WHERE organisation_id NOT IN ($1, $2)) AS reservations,
  (SELECT count(*)::int FROM scheduling_resource_holds WHERE organisation_id NOT IN ($1, $2)) AS holds,
  (SELECT md5(string_agg(r::text, '|' ORDER BY id)) FROM scheduling_reservations r WHERE organisation_id NOT IN ($1, $2)) AS reservation_rows,
  (SELECT md5(string_agg(r::text, '|' ORDER BY id)) FROM scheduling_availability_rules r WHERE organisation_id NOT IN ($1, $2)) AS rules,
  (SELECT md5(string_agg(v::text, '|' ORDER BY organisation_id, owner_kind, owner_id)) FROM scheduling_availability_versions v WHERE organisation_id NOT IN ($1, $2)) AS versions,
  (SELECT md5(string_agg(o::text, '|' ORDER BY id)) FROM scheduling_offerings o WHERE organisation_id NOT IN ($1, $2)) AS offerings`;
let othersBefore: Record<string, unknown>;
const timings: Record<string, number | string> = {};

suite('Staff availability basis through the REAL Neon HTTP driver', () => {
  beforeAll(async () => {
    const u = new URL(URL_);
    if (EXPECTED_HOST === '' || u.host !== EXPECTED_HOST || u.username !== 'rehearsal_037') throw new Error('refusing to run: NEON_REHEARSAL_HOST must name the endpoint, and the role must be rehearsal_037');
    sql = neon(URL_) as unknown as Q;
    const who = await rows(`SELECT current_user AS u, to_regclass('public.scheduling_availability_versions') IS NOT NULL AS has`);
    if (who[0].u !== 'rehearsal_037' || who[0].has !== true) throw new Error('refusing to run: not the rehearsal role, or 037 not applied');
    avail = new PostgresAvailabilityRepository({ sql: fromNeonHttpLike(sql as never) });
    for (const org of [ORG, OTHER]) {
      await sql.query('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO NOTHING', [org, TZ]);
      await sql.query("INSERT INTO scheduling_settings (organisation_id, currency) VALUES ($1, 'AUD') ON CONFLICT DO NOTHING", [org]);
    }
    othersBefore = (await rows(OTHERS_SNAPSHOT_SQL, [ORG, OTHER]))[0];
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    const othersAfter = (await rows(OTHERS_SNAPSHOT_SQL, [ORG, OTHER]))[0];
    for (const org of [ORG, OTHER]) {
      await sql.query("DELETE FROM audit_logs WHERE organisation_id = $1 AND action LIKE 'scheduling.%'", [org]).catch(() => undefined);
      for (const t of ['scheduling_resource_holds', 'scheduling_reservations', 'scheduling_availability_rules', 'scheduling_availability_exceptions', 'scheduling_availability_zones', 'scheduling_offering_resources', 'scheduling_offerings', 'scheduling_resources', 'scheduling_schedules', 'scheduling_settings']) {
        await sql.query(`DELETE FROM ${t} WHERE organisation_id = $1`, [org]).catch(() => undefined);
      }
      await sql.query('DELETE FROM organisations WHERE id = $1', [org]).catch(() => undefined);
    }
    process.stdout.write(`\nNEON BASIS TIMINGS ${JSON.stringify(timings)}\n`);
    expect(othersAfter).toEqual(othersBefore); // nothing outside the two synthetic organisations changed
  }, 60_000);

  beforeEach(() => {
    process.env.SCHEDULING_FACILITY_HIRE = 'on';
    state.noCapability = false;
    state.loseNextReply = false;
    state.failNextBeforeSend = false;
    as('neon-u1', ORG);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });


  const BASIS = `${BASE}/basis`;
  const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const basisGet = (f: Fx, query: Record<string, string> = {}) =>
    call(basisRoute.GET, `${BASIS}?${new URLSearchParams({ offeringId: f.offering, resourceId: f.court, from: MONDAY, to: MONDAY, ...query }).toString()}`, 'GET');
  const timesOf = (r: Outcome, date = MONDAY): string[] => ((r.json.days as Array<{ date: string; starts: Array<{ time: string }> }>).find(d => d.date === date)?.starts ?? []).map(s => s.time);

  it('P: the contract over the real driver: a read of the basis and the engine inputs, no transaction, nothing written; the configured duration, the pinned zone, the price and the starts', async () => {
    const f = await fixture();
    const batchesBefore = state.batches;
    const countsBefore = [await total(f), await holds(f)];
    const r = await basisGet(f, { to: addDays(MONDAY, 6) });
    expect(r.status).toBe(200);
    expect(state.batches - batchesBefore).toBe(0); // a read: no sql.transaction
    expect(Object.keys(r.json).sort()).toEqual(['basis', 'days', 'generatedAt', 'offering', 'range', 'resource', 'timezone']);
    expect(Object.keys(r.json.basis).sort()).toEqual(['offeringToken', 'offeringVersion', 'resourceVersion', 'scheduleToken']);
    expect(r.json.offering).toEqual({ id: f.offering, durationMinutes: 60, price: { amountCents: 5000, currency: 'AUD' } });
    expect(r.json.timezone).toBe(TZ);
    expect(timesOf(r)).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
    expect(r.json.days).toHaveLength(7);
    expect(r.headers.get('server-timing')).toMatch(/app;dur=\d+, db;dur=\d+;desc="\d+ statements, summed"/);
    expect(r.text).not.toMatch(new RegExp(`${ORG}|organi[sz]ation|customer|email|phone|notes|step`, 'i'));
    expect([await total(f), await holds(f)]).toEqual(countsBefore);
    timings.basisMs = r.ms;
    timings.basisServerTiming = r.headers.get('server-timing') ?? '';
  });

  it('Q: every offered start books through the real driver, nothing else on the grid does, and the booked starts leave the offer', async () => {
    const f = await fixture();
    const offered = timesOf(await basisGet(f));
    expect(offered).toHaveLength(8);
    for (const time of [offered[0], offered[3], offered[7]]) {
      const offer = await basisGet(f);
      const r = await create(body(f, { start: { date: MONDAY, time }, basis: offer.json.basis }));
      expect(r.status, time).toBe(201);
    }
    const after = timesOf(await basisGet(f));
    expect(after).toEqual(offered.filter(t => ![offered[0], offered[3], offered[7]].includes(t)));
    for (const time of ['08:00', '09:30', '17:00']) {
      const r = await create(body(f, { start: { date: MONDAY, time }, basis: (await basisGet(f)).json.basis }));
      expect(r.status, time).toBe(409);
      expect(['OFF_GRID', 'OUTSIDE_AVAILABILITY']).toContain(r.json.code);
    }
    expect(await total(f)).toBe(3);
    expect(await overlaps(f)).toBe(0);
  });

  it('R: a stale or forged basis cannot book: AVAILABILITY_CHANGED with exactly the basis the endpoint now returns; the new basis books', async () => {
    const f = await fixture();
    const old = (await basisGet(f)).json.basis;
    await sql.query("UPDATE scheduling_offerings SET name = 'edited over neon', updated_at = clock_timestamp() WHERE id = $1", [f.offering]);
    const fresh = (await basisGet(f)).json.basis;
    expect(fresh.offeringToken).not.toEqual(old.offeringToken);
    const stale = await create(body(f, { start: { date: MONDAY, time: '11:00' }, basis: old }));
    expect([stale.status, stale.json.code]).toEqual([409, 'AVAILABILITY_CHANGED']);
    expect(stale.json.basis).toEqual(fresh);
    const forged = await create(body(f, { start: { date: MONDAY, time: '11:00' }, basis: { offeringVersion: '999', resourceVersion: '999', offeringToken: 'x', scheduleToken: 'y' } }));
    expect([forged.status, forged.json.code]).toEqual([409, 'AVAILABILITY_CHANGED']);
    expect(await total(f)).toBe(0);
    expect((await create(body(f, { start: { date: MONDAY, time: '11:00' }, basis: fresh }))).status).toBe(201);
  });

  it('S: gates and permissions over the real driver: switch off and no capability are 404, a viewer is 403, another organisation is the same 404 as an absent id, bad input is 400', async () => {
    const f = await fixture();
    for (const value of [undefined, 'off', 'ON']) {
      if (value === undefined) delete process.env.SCHEDULING_FACILITY_HIRE;
      else process.env.SCHEDULING_FACILITY_HIRE = value;
      const r = await basisGet(f);
      expect([r.status, r.json]).toEqual([404, { error: 'not_found' }]);
    }
    process.env.SCHEDULING_FACILITY_HIRE = 'on';
    state.noCapability = true;
    expect((await basisGet(f)).status).toBe(404);
    state.noCapability = false;
    as('neon-viewer', ORG, 'viewer');
    const viewer = await basisGet(f);
    expect(viewer.status).toBe(403);
    expect(viewer.text).not.toMatch(/basis|offeringVersion|days/);
    as('neon-u2', OTHER);
    const foreign = await basisGet(f);
    const absent = await call(basisRoute.GET, `${BASIS}?offeringId=nope&resourceId=nope&from=${MONDAY}&to=${MONDAY}`, 'GET');
    expect([foreign.status, absent.status]).toEqual([404, 404]);
    expect(foreign.json).toEqual(absent.json);
    as('neon-u1', ORG);
    for (const query of [{ step: '15' }, { organisationId: OTHER }, { to: addDays(MONDAY, 14) }]) expect((await basisGet(f, query)).status).toBe(400);
    expect((await basisGet(f, { to: addDays(MONDAY, 13) })).status).toBe(200);
  });

  it('T: ten parallel readers agree, and a configuration writer racing the read can only make the booking AVAILABILITY_CHANGED or succeed - never an error, never an overlap', async () => {
    const f = await fixture();
    const readers = await Promise.all(Array.from({ length: 10 }, () => basisGet(f, { to: addDays(MONDAY, 6) })));
    expect(readers.map(r => r.status)).toEqual(Array(10).fill(200));
    expect(new Set(readers.map(r => JSON.stringify({ b: r.json.basis, d: r.json.days }))).size).toBe(1);
    for (let i = 0; i < 6; i += 1) {
      const time = `${String(9 + i).padStart(2, '0')}:00`;
      const [read] = await Promise.all([basisGet(f), sql.query("UPDATE scheduling_availability_versions SET version = version + 1 WHERE owner_kind = 'resource' AND owner_id = $1", [f.court])]);
      expect(read.status).toBe(200);
      const r = await create(body(f, { start: { date: MONDAY, time }, basis: read.json.basis }));
      expect([201, 409], `${i} ${r.text}`).toContain(r.status);
    }
    expect(await overlaps(f)).toBe(0);
  });
});
