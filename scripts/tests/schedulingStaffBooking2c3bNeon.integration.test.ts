import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { PRESETS, defaultScheduleConfig } from '@scheduling/core';
import { PostgresAvailabilityRepository, fromNeonHttpLike } from '@scheduling/postgres';
import { TZ } from '../../packages/scheduling-postgres/tests/support/builders';
import { staff, uid } from '../../packages/scheduling-postgres/tests/support/pgHarness';

// Phase 2C.3b: the staff booking routes with the REAL @neondatabase/serverless HTTP driver as `@/lib/db`, against a DISPOSABLE Neon branch only. Opt-in: skipped unless NEON_REHEARSAL_URL is
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
      if (state.noCapability && key === 'scheduling.staff_booking') throw new CapabilityAccessError('NO_ENTITLEMENT');
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
const one = (await import('@/app/api/scheduling/reservations/[reservationId]/route')) as unknown as { GET: Handler };
const cancelRoute = (await import('@/app/api/scheduling/reservations/[reservationId]/cancel/route')) as unknown as { POST: Handler };

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
const getById = (id: string) => call(one.GET, `${BASE}/${id}`, 'GET', { params: { reservationId: id } });
const getByKey = (key: string) => call(collection.GET, `${BASE}?idempotencyKey=${key}`, 'GET');
const cancel = (id: string, body?: unknown) => call(cancelRoute.POST, `${BASE}/${id}/cancel`, 'POST', { ...(body !== undefined ? { body } : {}), params: { reservationId: id } });

function nextWeekday(dayOfWeek: number, minDaysAhead: number): string {
  const d = new Date(Date.now() + minDaysAhead * 86_400_000);
  d.setUTCHours(12, 0, 0, 0);
  while (d.getUTCDay() !== dayOfWeek) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const MONDAY = nextWeekday(1, 40);
interface Fx { schedule: string; offering: string; court: string; court2: string }
const body = (f: Fx, over: Record<string, unknown> = {}) => ({ offeringId: f.offering, resourceId: f.court, start: { date: MONDAY, time: '10:00' }, durationMinutes: 60, partySize: 2, customer: { name: 'Neon Hirer', email: 'neon.hirer@example.com', phone: '0400 555 123' }, notes: 'neon note', ...over });
const SECRETS = ['Neon Hirer', 'neon.hirer', '0400 555 123', 'neon note'];
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

suite('Staff booking routes through the REAL Neon HTTP driver', () => {
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
    process.stdout.write(`\nNEON ROUTE TIMINGS ${JSON.stringify(timings)}\n`);
    expect(othersAfter).toEqual(othersBefore); // nothing outside the two synthetic organisations changed
  }, 60_000);

  beforeEach(() => {
    process.env.SCHEDULING_STAFF_BOOKING = 'on';
    state.noCapability = false;
    state.loseNextReply = false;
    state.failNextBeforeSend = false;
    as('neon-u1', ORG);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('A: the host executor forwards the transaction to the real driver: one booking, one hold, atomically; Server-Timing counts the batch; a replay writes nothing', async () => {
    const f = await fixture();
    const batchesBefore = state.batches;
    const key = newKey();
    const first = await create(body(f), key);
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ replayed: false, reservation: { status: 'confirmed', durationMinutes: 60, customer: { name: 'Neon Hirer' } } });
    expect(state.batches - batchesBefore).toBe(1); // the booking went through sql.transaction([...]) exactly once
    expect([await total(f), await holds(f)]).toEqual([1, 1]);
    expect(first.headers.get('server-timing')).toMatch(/app;dur=\d+, db;dur=\d+;desc="\d+ statements, summed"/);
    timings.createMs = first.ms;
    timings.serverTiming = first.headers.get('server-timing') ?? '';
    const again = await create(body(f), key);
    expect(again.status).toBe(200);
    expect(again.json.replayed).toBe(true);
    expect(again.json.reservation.id).toBe(first.json.reservation.id);
    expect(state.batches - batchesBefore).toBe(1); // a replay never reaches the write
    timings.replayMs = again.ms;
    expect([await total(f), await holds(f)]).toEqual([1, 1]);
    const conflict = await create(body(f, { partySize: 3 }), key);
    expect(conflict.status).toBe(409);
    expect(conflict.json.code).toBe('IDEMPOTENCY_CONFLICT');
    for (const s of SECRETS) expect(conflict.text).not.toContain(s);
  });

  it('B: eight parallel requests for the same court and hour with different keys: one 201, seven RESOURCE_CONFLICT, one hold, no overlap', async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => create(body(f))));
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    expect(results.filter(r => r.status !== 201).map(r => r.json.code)).toEqual(Array(7).fill('RESOURCE_CONFLICT'));
    expect([await total(f), await holds(f), await overlaps(f)]).toEqual([1, 1, 0]);
  });

  it('C: six parallel calls with the same key create one reservation and are all answered with it', async () => {
    const f = await fixture();
    const key = newKey();
    const results = await Promise.all(Array.from({ length: 6 }, () => create(body(f), key)));
    for (const r of results) expect([200, 201]).toContain(r.status);
    expect(new Set(results.map(r => r.json.reservation.id)).size).toBe(1);
    expect([await total(f), await holds(f)]).toEqual([1, 1]);
  });

  it('D: cancel keeps the row, releases the hold, frees the window and is idempotent; a past-start guard and foreign ids are refused', async () => {
    const f = await fixture();
    const id = (await create(body(f))).json.reservation.id;
    const r = await cancel(id, { reason: 'phone call' });
    expect(r.status).toBe(200);
    expect(r.json.reservation.status).toBe('cancelled');
    expect([await total(f), await holds(f)]).toEqual([1, 0]);
    expect((await cancel(id)).json.alreadyCancelled).toBe(true);
    expect((await create(body(f))).status).toBe(201);
    as('neon-u2', OTHER);
    expect((await cancel(id)).status).toBe(404);
    expect((await getById(id)).status).toBe(404);
  });

  it('E: the two gates answer 404 and write nothing; a viewer is 403 without data; the other organisation cannot reach these rows', async () => {
    const f = await fixture();
    const made = await create(body(f));
    const id = made.json.reservation.id;
    process.env.SCHEDULING_STAFF_BOOKING = 'off';
    for (const r of [await create(body(f, { start: { date: MONDAY, time: '12:00' } })), await getById(id), await cancel(id)]) expect(r.status).toBe(404);
    process.env.SCHEDULING_STAFF_BOOKING = 'on';
    state.noCapability = true;
    expect((await create(body(f, { start: { date: MONDAY, time: '12:00' } }))).status).toBe(404);
    state.noCapability = false;
    as('neon-viewer', ORG, 'viewer');
    for (const r of [await create(body(f, { start: { date: MONDAY, time: '12:00' } })), await getById(id), await cancel(id)]) {
      expect(r.status).toBe(403);
      for (const s of [...SECRETS, id]) expect(r.text).not.toContain(s);
    }
    as('neon-u2', OTHER);
    const foreign = await create(body(f, { start: { date: MONDAY, time: '12:00' } }));
    expect(foreign.status).toBe(404);
    expect(await total(f)).toBe(1);
  });

  it('F: a stale basis is AVAILABILITY_CHANGED with a fresh basis, an offering edit after it is refused at commit, and the fresh basis books', async () => {
    const f = await fixture();
    const stale = await create(body(f, { basis: { offeringVersion: '0', resourceVersion: '0', offeringToken: 'x', scheduleToken: 'y' } }));
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe('AVAILABILITY_CHANGED');
    const basis = stale.json.basis;
    await sql.query("UPDATE scheduling_offerings SET name = 'edited', updated_at = clock_timestamp() WHERE id = $1", [f.offering]);
    const edited = await create(body(f, { basis }));
    expect(edited.json.code).toBe('AVAILABILITY_CHANGED');
    expect(await total(f)).toBe(0);
    expect((await create(body(f, { basis: edited.json.basis }))).status).toBe(201);
  });

  it('G: a COMMITTED batch whose reply is lost is recovered by key (once); a failure before send is OUTCOME_UNKNOWN with nothing written, and the same key then books', async () => {
    const f = await fixture();
    const lostKey = newKey();
    state.loseNextReply = true;
    const lost = await create(body(f), lostKey);
    expect(lost.status).toBe(201);
    expect(lost.json.recovered).toBe(true);
    expect([await total(f), await holds(f)]).toEqual([1, 1]);
    expect((await create(body(f), lostKey)).json.replayed).toBe(true);

    const key = newKey();
    state.failNextBeforeSend = true;
    const unknown = await create(body(f, { start: { date: MONDAY, time: '13:00' } }), key);
    expect(unknown.status).toBe(504);
    expect(unknown.json).toMatchObject({ code: 'OUTCOME_UNKNOWN', retryable: true });
    expect((await getByKey(key)).status).toBe(404);
    expect(await total(f)).toBe(1);
    expect((await create(body(f, { start: { date: MONDAY, time: '13:00' } }), key)).status).toBe(201);
    expect(await total(f)).toBe(2);
  });

  it('H: the hour that does not exist on the spring-forward Sunday is NONEXISTENT_LOCAL_TIME', async () => {
    const f = await fixture();
    for (const owner of [{ kind: 'offering' as const, id: f.offering }, { kind: 'resource' as const, id: f.court }]) {
      const r = await avail.createRule(staff(ORG), owner, { ...hours, dayOfWeek: 0, startTime: '00:00', endTime: '12:00' }, TZ);
      if (!r.ok) throw new Error(JSON.stringify(r));
    }
    let year = new Date().getUTCFullYear();
    let day = '';
    for (;;) {
      const d = new Date(Date.UTC(year, 9, 1, 12));
      while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
      day = d.toISOString().slice(0, 10);
      if (Date.parse(`${day}T00:00:00Z`) > Date.now() + 40 * 86_400_000) break;
      year += 1;
    }
    const gap = await create(body(f, { start: { date: day, time: '02:00' } }));
    expect(gap.status).toBe(422);
    expect(gap.json.code).toBe('NONEXISTENT_LOCAL_TIME');
    expect((await create(body(f, { start: { date: day, time: '03:00' } }))).status).toBe(201);
  });

  it('I: a configuration writer holding the offering row past the 2 s lock timeout gives 503 CONTENTION_TIMEOUT with nothing written; the same key books once the writer is gone', async () => {
    const f = await fixture();
    // one HTTP request = one transaction: lock the offering row, then hold it for 9 s
    const writer = sql.transaction([sql.query('UPDATE scheduling_offerings SET name = name WHERE id = $1', [f.offering]), sql.query('SELECT pg_sleep(9)')]);
    await new Promise(r => setTimeout(r, 1500));
    const key = newKey();
    const started = performance.now();
    const blocked = await create(body(f), key);
    timings.contentionMs = Math.round(performance.now() - started);
    expect(blocked.status).toBe(503);
    expect(blocked.json.code).toBe('CONTENTION_TIMEOUT');
    expect(blocked.headers.get('retry-after')).toBe('1');
    expect(await total(f)).toBe(0);
    await writer;
    expect((await create(body(f), key)).status).toBe(201);
    expect(await total(f)).toBe(1);
  }, 60_000);

  it('J: bookings racing paced configuration writers through the driver: no 500, no overlap, one hold per reservation', async () => {
    const f = await fixture();
    const stop = Date.now() + 5000;
    const writers = [
      (async () => { while (Date.now() < stop) { await sql.query("UPDATE scheduling_offerings SET name = name || 'x', updated_at = clock_timestamp() WHERE id = $1", [f.offering]).catch(() => undefined); await new Promise(r => setTimeout(r, 400)); } })(),
      (async () => { while (Date.now() < stop) { await sql.query("UPDATE scheduling_availability_versions SET version = version + 1 WHERE owner_kind = 'resource' AND owner_id = $1", [f.court]).catch(() => undefined); await new Promise(r => setTimeout(r, 300)); } })(),
    ];
    let n = 0;
    const hirers = Array.from({ length: 4 }, async () => {
      const out: Outcome[] = [];
      while (Date.now() < stop) { n += 1; out.push(await create(body(f, { resourceId: n % 2 ? f.court : f.court2, start: { date: MONDAY, time: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'][n % 8] } }))); }
      return out;
    });
    const all = (await Promise.all(hirers)).flat();
    await Promise.all(writers);
    const wins = all.filter(r => r.status === 201).length;
    timings.mixedAttempts = all.length;
    timings.mixedWins = wins;
    expect(wins).toBeGreaterThan(0);
    expect(all.filter(r => r.status >= 500 && r.json?.code !== 'CONTENTION_TIMEOUT')).toEqual([]);
    expect(console.error).not.toHaveBeenCalledWith('[scheduling] handler failed', '40P01');
    expect(await overlaps(f)).toBe(0);
    expect(await total(f)).toBe(await holds(f));
  }, 60_000);
});
