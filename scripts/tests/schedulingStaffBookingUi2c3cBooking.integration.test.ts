import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { PostgresAvailabilityRepository, fromPgLike } from '@scheduling/postgres';
import { closePool, seedOffering, seedResource, seedSchedule, staff } from '../../packages/scheduling-postgres/tests/support/pgHarness';

// Phase 2C.3c UI slice 2: the staff booking UI's OWN client code (machine + postReservation + lookupReservation) driven against the REAL routes (middleware -> route ->
// schedulingRoute -> runtime -> PostgresHireRepository) over a DISPOSABLE PostgreSQL (scripts/tests/verify-scheduling-phase2c.sh, 16 and 17). No browser: fetch is bridged to the
// real route handlers. Proves the database-level properties the dialog relies on: one booking = one reservation + one exclusive hold, double submission and same-key retries create
// nothing new, overlaps and stale availability are refused, a lost reply after commit resolves to the original booking, tenants and roles are isolated, and no customer
// detail reaches the audit log or the console.

const TEST_URL = process.env.SCHEDULING_TEST_DATABASE_URL ?? '';
const suite = TEST_URL ? describe : describe.skip;

const state = vi.hoisted(() => {
  process.env.SESSION_SECRET = 'test-only-session-secret-for-the-disposable-staff-booking-ui-0123456789abcdef';
  return { cookie: null as string | null };
});
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'session' && state.cookie ? { name, value: state.cookie } : undefined),
    set: () => undefined,
    delete: () => undefined,
  }),
}));
vi.mock('@/lib/db', async () => {
  const { Pool: P } = await import('pg');
  const p = new P({ connectionString: process.env.SCHEDULING_TEST_DATABASE_URL, max: 20 });
  p.on('error', () => undefined);
  const run = (text: string, params: unknown[]) => p.query(text, params).then(r => r.rows);
  type Lazy = { text: string; params: unknown[]; then: (a: (v: unknown[]) => unknown, b?: (e: unknown) => unknown) => Promise<unknown> };
  const query = (text: string, params: unknown[] = []): Lazy => ({ text, params, then: (a, b) => run(text, params).then(a, b) });
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => run(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values);
  const transaction = async (queries: Lazy[]) => {
    const c = await p.connect();
    try {
      await c.query('BEGIN');
      const out: unknown[] = [];
      for (const q of queries) out.push((await c.query(q.text, q.params)).rows);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  };
  return { default: Object.assign(tag, { query, transaction }) };
});

const { middleware } = await import('@/middleware');
const { encrypt } = await import('@/lib/session');
const { fetchBasis } = await import('@/lib/scheduling/staffBooking/basisClient');
const { postReservation, lookupReservation } = await import('@/lib/scheduling/staffBooking/submitClient');
const { createMachine, initialState, bodyOf } = await import('@/lib/scheduling/staffBooking/machine');
const { createBookingKeyHolder } = await import('@/lib/scheduling/staffBooking/key');
type Handler = (request: Request, context?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
const basisRoute = (await import('@/app/api/scheduling/reservations/basis/route')) as unknown as { GET: Handler };
const reservationsRoute = (await import('@/app/api/scheduling/reservations/route')) as unknown as { POST: Handler; GET: Handler };
const oneRoute = (await import('@/app/api/scheduling/reservations/[reservationId]/route')) as unknown as { GET: Handler };
const cancelRoute = (await import('@/app/api/scheduling/reservations/[reservationId]/cancel/route')) as unknown as { POST: Handler };

let pool: Pool;
const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const sqlFile = (name: string) => readFileSync(path.resolve(__dirname, '../../packages/scheduling/sql', name), 'utf8').replace(/\r/g, '');

const TABLES = [
  'scheduling_schedules', 'scheduling_offerings', 'scheduling_resources', 'scheduling_offering_resources', 'scheduling_availability_rules', 'scheduling_availability_exceptions',
  'scheduling_availability_zones', 'scheduling_availability_versions', 'scheduling_reservations', 'scheduling_resource_holds', 'scheduling_occurrences', 'scheduling_series',
  'scheduling_series_pauses', 'scheduling_settings', 'organisations', 'organisation_modules', 'users', 'organisation_user_access', 'audit_logs',
];
const hashAll = async () => {
  const out: string[] = [];
  for (const t of TABLES) out.push((await q<{ h: string }>(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), 'empty') AS h FROM ${t} t`))[0].h);
  return out;
};

type Person = { id: string; org: string; role: string; access: Record<string, string> | null };
const PEOPLE: Record<string, Person> = {
  manager: { id: 'u-manager', org: 'org-a', role: 'manager', access: { scheduling: 'use' } },
  admin: { id: 'u-admin', org: 'org-a', role: 'admin', access: { scheduling: 'use' } },
  unmanaged: { id: 'u-unmanaged', org: 'org-a', role: 'manager', access: null },
  managerViewOnly: { id: 'u-manager-view', org: 'org-a', role: 'manager', access: { scheduling: 'view' } },
  managerNone: { id: 'u-manager-none', org: 'org-a', role: 'manager', access: { scheduling: 'none' } },
  viewer: { id: 'u-viewer', org: 'org-a', role: 'viewer', access: { scheduling: 'view' } },
  viewerUse: { id: 'u-viewer-use', org: 'org-a', role: 'viewer', access: { scheduling: 'use' } },
  analyst: { id: 'u-analyst', org: 'org-a', role: 'analyst', access: { scheduling: 'view' } },
  noCap: { id: 'u-nocap', org: 'org-c', role: 'manager', access: { scheduling: 'use' } },
  other: { id: 'u-other', org: 'org-b', role: 'manager', access: { scheduling: 'use' } },
};
const signIn = async (p: Person) => {
  state.cookie = await encrypt({ userId: p.id, organisationId: p.org, role: p.role as never, name: p.id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
};
const signOut = () => { state.cookie = null; };

/** Bridges the UI's relative fetch() calls to the REAL route handlers, behind the REAL middleware, as the signed-in person. Records every request. */
const requests: Array<{ method: string; path: string; key: string | null }> = [];
const fault = { loseReply: 0, failBefore: 0 }; // fault injection AT THE NETWORK: the request is processed for real, then the reply is lost
async function bridge(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'http://bb.test');
  const method = init?.method ?? 'GET';
  const incoming = new Headers(init?.headers);
  requests.push({ method, path: url.pathname, key: incoming.get('idempotency-key') });
  if (method === 'POST' && url.pathname === '/api/scheduling/reservations' && fault.failBefore > 0) {
    fault.failBefore -= 1;
    throw new TypeError('network down before send');
  }
  const headers: Record<string, string> = {};
  incoming.forEach((v, k) => { headers[k] = v; });
  if (state.cookie) headers.cookie = `session=${state.cookie}`;
  const full = url.toString();
  const body = typeof init?.body === 'string' ? init.body : undefined;
  const gate = await middleware(new NextRequest(full, { method, headers, ...(body !== undefined ? { body } : {}) }));
  let response: Response;
  if (gate.headers.get('x-middleware-next') !== '1') response = new Response(await gate.text(), { status: gate.status, headers: { 'content-type': 'application/json' } });
  else {
    const route = (handler: Handler, params: Record<string, string> = {}) => handler(new Request(full, { method, headers, ...(body !== undefined ? { body } : {}) }), { params: Promise.resolve(params) });
    const p = url.pathname;
    let m: RegExpMatchArray | null;
    if (p === '/api/scheduling/reservations/basis') response = await route(basisRoute.GET);
    else if (p === '/api/scheduling/reservations') response = await route(method === 'POST' ? reservationsRoute.POST : reservationsRoute.GET);
    else if ((m = p.match(/^\/api\/scheduling\/reservations\/([^/]+)\/cancel$/))) response = await route(cancelRoute.POST, { reservationId: decodeURIComponent(m[1]) });
    else if ((m = p.match(/^\/api\/scheduling\/reservations\/([^/]+)$/))) response = await route(oneRoute.GET, { reservationId: decodeURIComponent(m[1]) });
    else response = Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (method === 'POST' && url.pathname === '/api/scheduling/reservations' && fault.loseReply > 0) {
    fault.loseReply -= 1;
    await response.text(); // the server finished; the reply never reaches the browser
    throw new TypeError('network lost the reply');
  }
  return response;
}

const hours = (dayOfWeek: number, start = '09:00', end = '17:00') => ({ kind: 'hours' as const, label: null, dayOfWeek, startTime: start, endTime: end, validFrom: null, validTo: null });
const TZ = 'Australia/Adelaide';
let avail: PostgresAvailabilityRepository;

function nextWeekday(dayOfWeek: number, minDaysAhead: number): string {
  const d = new Date(Date.now() + minDaysAhead * 86_400_000);
  d.setUTCHours(12, 0, 0, 0);
  while (d.getUTCDay() !== dayOfWeek) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const MONDAY = nextWeekday(1, 3);

suite('Scheduling 2C.3c UI slice 2: customer details, submit, recovery and confirmation through the real chain', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_URL, max: 10 });
    pool.on('error', () => undefined);
    for (const f of ['034_availability_integrity.sql', '035_availability_partial_closures.sql', '036_availability_zones.sql']) await pool.query(sqlFile(f));
    if (!(await q<{ r: string | null }>("SELECT to_regclass('scheduling_availability_versions')::text AS r"))[0].r) await pool.query(sqlFile('037_availability_versions.sql'));
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE'");
    await pool.query(
      `CREATE TABLE IF NOT EXISTS organisation_user_access (user_id TEXT PRIMARY KEY REFERENCES users(id), organisation_id TEXT NOT NULL REFERENCES organisations(id),
         permissions JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(permissions) = 'object'), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL REFERENCES users(id))`,
    );
    avail = new PostgresAvailabilityRepository({ sql: fromPgLike(pool) });
  }, 90_000);
  afterAll(async () => {
    await pool?.query('DROP TABLE IF EXISTS organisation_user_access').catch(() => undefined);
    await pool?.end();
    await closePool();
  });

  async function seedHire(org: string, p: string) {
    await seedSchedule(org, `${p}-hire`, 'resource_hire');
    await seedOffering(org, `${p}-off`, `${p}-hire`, { capacity: null, durationMinutes: 60 });
    await seedResource(org, `${p}-court-1`, 'court');
    await q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [org, `${p}-off`, `${p}-court-1`]);
    await seedResource(org, `${p}-court-free`, 'court'); // never linked
    for (const owner of [{ kind: 'offering' as const, id: `${p}-off` }, { kind: 'resource' as const, id: `${p}-court-1` }]) {
      const r = await avail.createRule(staff(org), owner, hours(1), TZ);
      if (!r.ok) throw new Error(`seed rule: ${JSON.stringify(r)}`);
    }
  }

  beforeEach(async () => {
    process.env.SCHEDULING_STAFF_BOOKING = 'on';
    signOut();
    requests.length = 0;
    fault.loseReply = 0;
    fault.failBefore = 0;
    vi.stubGlobal('fetch', bridge);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await q('TRUNCATE scheduling_resource_holds, scheduling_reservations, scheduling_occurrences, scheduling_series_pauses, scheduling_series, scheduling_offering_resources, scheduling_offerings, scheduling_resources, scheduling_schedules, scheduling_availability_zones, scheduling_availability_exceptions, scheduling_availability_rules, scheduling_availability_versions, scheduling_settings CASCADE');
    await q('DELETE FROM organisation_user_access');
    await q('DELETE FROM organisation_modules');
    await q('DELETE FROM audit_logs');
    await q('DELETE FROM users');
    await q('DELETE FROM organisations');
    await q("INSERT INTO modules (key, name, description, active) VALUES ('scheduling.staff_booking', 'Scheduling staff booking (test)', 'test', true) ON CONFLICT (key) DO UPDATE SET active = true");
    for (const id of ['org-a', 'org-b', 'org-c']) {
      await q('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $2, $1, now(), $3)', [id, `Org ${id}`, TZ]);
      await q('INSERT INTO scheduling_settings (organisation_id, currency) VALUES ($1, $2)', [id, 'AUD']);
      await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'scheduling', true)", [id]);
    }
    for (const org of ['org-a', 'org-b']) await q("INSERT INTO organisation_modules (organisation_id, module_key, enabled) VALUES ($1, 'scheduling.staff_booking', true)", [org]); // org-c does not hold it
    for (const p of Object.values(PEOPLE)) await q('INSERT INTO users (id, organisation_id, email, name, role) VALUES ($1, $2, $3, $1, $4)', [p.id, p.org, `${p.id}@example.test`, p.role]);
    for (const p of Object.values(PEOPLE)) if (p.access) await q('INSERT INTO organisation_user_access (user_id, organisation_id, permissions, updated_by) VALUES ($1, $2, $3::jsonb, $1)', [p.id, p.org, JSON.stringify(p.access)]);
    await seedHire('org-a', 'a');
    await seedHire('org-b', 'b');
    await signIn(PEOPLE.manager);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });


  // ── helpers: the dialog's effects, run for real ──────────────────────────────────────────────────────────────────────────────

  const PII = { name: 'Zelda Quartermain', email: 'zelda.q@example.test', phone: '0411 222 333', notes: 'Ask for the red racquets' };
  const SECRETS = ['Zelda', 'Quartermain', 'zelda.q', 'example.test', '0411 222 333', 'red racquets'];
  const details = (over: Partial<{ name: string; email: string; phone: string; partySize: string; notes: string }> = {}) => ({ ...PII, partySize: '2', ...over });
  const reservationCount = (org = 'org-a') => q<{ n: number }>('SELECT count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1', [org]).then(r => r[0].n);
  const liveHolds = (org = 'org-a') => q<{ n: number }>('SELECT count(*)::int AS n FROM scheduling_resource_holds WHERE organisation_id = $1 AND released_at IS NULL', [org]).then(r => r[0].n);
  const overlappingLiveHolds = async () =>
    (await q<{ n: number }>('SELECT count(*)::int AS n FROM scheduling_resource_holds a JOIN scheduling_resource_holds b ON a.organisation_id = b.organisation_id AND a.resource_id = b.resource_id AND a.id < b.id AND a.during && b.during WHERE a.released_at IS NULL AND b.released_at IS NULL'))[0].n;
  const posts = () => requests.filter(r => r.method === 'POST' && r.path === '/api/scheduling/reservations');

  /** Reads the basis exactly as the dialog does and builds the chosen start from the ENGINE's own list. */
  async function offered(time = '10:00', date = MONDAY, p = 'a') {
    const r = await fetchBasis({ offeringId: `${p}-off`, resourceId: `${p}-court-1`, from: date, to: date });
    if (!r.ok) throw new Error(`basis refused: ${JSON.stringify(r.problem)}`);
    const start = r.data.days[0].starts.find(s => s.time === time);
    if (!start) throw new Error(`${time} not offered`);
    return {
      offeringId: `${p}-off`, offeringName: 'Hire', resourceId: `${p}-court-1`, resourceName: 'Court 1', date, time, startsAt: start.startsAt,
      durationMinutes: r.data.offering.durationMinutes, timezone: r.data.timezone, capacity: r.data.resource.capacity, price: r.data.offering.price, basis: r.data.basis,
    };
  }
  type Target = Awaited<ReturnType<typeof offered>>;

  /** The state machine plus the dialog's effects (POST on `submitting`, lookups on `checking`/`conflict`), minus the timers. */
  function ui() {
    const holder = createBookingKeyHolder();
    const reduce = createMachine(holder);
    let state = initialState();
    const send = (a: Parameters<typeof reduce>[1]) => (state = reduce(state, a));
    const run = async () => {
      let lookedUpConflict = false;
      for (let i = 0; i < 60; i += 1) {
        if (state.step === 'submitting') send({ type: 'RESPONSE', outcome: await postReservation(state.attempt!.body, state.attempt!.key) });
        else if (state.step === 'checking') send({ type: 'POLL', outcome: await lookupReservation(state.attempt!.key) });
        else if (state.step === 'conflict' && !lookedUpConflict) {
          lookedUpConflict = true;
          send({ type: 'CONFLICT_LOOKUP', outcome: await lookupReservation(state.attempt!.key) });
        } else return;
      }
      throw new Error('the machine did not settle');
    };
    const fill = (d: ReturnType<typeof details>) => {
      for (const [field, value] of Object.entries(d)) send({ type: 'FIELD', field: field as 'name', value });
    };
    const toSubmit = (target: Target, d = details()) => {
      send({ type: 'START', target });
      fill(d);
      send({ type: 'REVIEW' });
      send({ type: 'SUBMIT' });
    };
    const book = async (target: Target, d = details()) => {
      toSubmit(target, d);
      await run();
      return state;
    };
    return { holder, send, run, fill, toSubmit, book, get state() { return state; } };
  }

  // ── one booking, one hold ───────────────────────────────────────────────────────────────────────────────────────────────────────

  describe('a booking made through the UI’s own client code', () => {
    it('creates ONE reservation and ONE exclusive hold, and the Booked state shows exactly what was saved', async () => {
      const target = await offered('10:00');
      const u = ui();
      const s = await u.book(target);
      expect(s.step).toBe('done');
      const r = s.reservation!;
      expect(r.id).toMatch(/\S{8,}/);
      expect(r).toMatchObject({ resourceId: 'a-court-1', offeringId: 'a-off', start: { date: MONDAY, time: '10:00' }, durationMinutes: 60, partySize: 2, status: 'confirmed', timezone: TZ });
      expect(r.customer).toEqual({ name: PII.name, email: PII.email, phone: PII.phone });
      expect(r.notes).toBe(PII.notes);
      expect(r.startsAt).toBe(target.startsAt); // the engine's own start instant, not one the UI computed
      expect(await reservationCount()).toBe(1);
      expect(await liveHolds()).toBe(1);
      expect((await q<{ reservation_id: string }>('SELECT reservation_id FROM scheduling_resource_holds'))[0].reservation_id).toBe(r.id);
      expect(await overlappingLiveHolds()).toBe(0);
      expect(posts()).toHaveLength(1);
      expect(posts()[0].key).toMatch(/^bk_[0-9a-f]{32}$/);
      expect(s.mismatch).toBe(false);
      expect(JSON.stringify(r)).not.toContain(posts()[0].key!); // the key is not part of the reservation
    });

    it('another tenant cannot see it: the booking is invisible to org-b by id and by key, and org-b cannot book org-a’s court', async () => {
      const u = ui();
      const s = await u.book(await offered('10:00'));
      expect(s.step).toBe('done');
      const key = s.attempt!.key;
      const id = s.reservation!.id;
      await signIn(PEOPLE.other);
      const before = await hashAll();
      expect(await lookupReservation(key)).toEqual({ kind: 'missing' });
      expect((await bridge(`http://bb.test/api/scheduling/reservations/${id}`)).status).toBe(404);
      const forged = await ui().book({ ...(await offered('10:00', MONDAY, 'b')), offeringId: 'a-off', resourceId: 'a-court-1' });
      expect(forged.step).not.toBe('done');
      expect(await hashAll()).toEqual(before); // nothing written anywhere
      const own = await ui().book(await offered('10:00', MONDAY, 'b')); // org-b's own court at the same time: no clash
      expect(own.step).toBe('done');
      expect(await reservationCount('org-b')).toBe(1);
      expect(await reservationCount('org-a')).toBe(1);
    });
  });

  describe('double submission and same-key retries create nothing new', () => {
    it('five identical sends in flight at once produce one reservation and one hold (one created, the rest replays)', async () => {
      const u = ui();
      u.toSubmit(await offered('11:00'));
      const { key, body } = u.state.attempt!;
      const outcomes = await Promise.all(Array.from({ length: 5 }, () => postReservation(body, key)));
      const created = outcomes.filter((o): o is Extract<typeof o, { kind: 'created' }> => o.kind === 'created');
      expect(created).toHaveLength(5);
      expect(new Set(created.map(o => o.reservation.id)).size).toBe(1);
      expect(created.filter(o => !o.replayed)).toHaveLength(1);
      expect(await reservationCount()).toBe(1);
      expect(await liveHolds()).toBe(1);
    });

    it('a later retry with the same key and the same frozen body replays the original booking', async () => {
      const u = ui();
      const first = await u.book(await offered('09:00'));
      const again = await postReservation(first.attempt!.body, first.attempt!.key);
      expect(again).toMatchObject({ kind: 'created', replayed: true });
      expect(again.kind === 'created' && again.reservation.id).toBe(first.reservation!.id);
      expect(await reservationCount()).toBe(1);
      expect(await liveHolds()).toBe(1);
    });

    it('the same key with a DIFFERENT booking is IDEMPOTENCY_CONFLICT: nothing is overwritten or created, and the UI shows what exists', async () => {
      const first = await ui().book(await offered('09:00'));
      const other = { ...first.attempt!.body, start: { date: MONDAY, time: '14:00' } };
      expect(await postReservation(other, first.attempt!.key)).toMatchObject({ kind: 'refused', code: 'IDEMPOTENCY_CONFLICT' });
      // through the machine, with a holder forced onto the taken key
      const taken = first.attempt!.key.slice(3);
      const holder = createBookingKeyHolder(() => taken);
      const reduce = createMachine(holder);
      let st = initialState();
      st = reduce(st, { type: 'START', target: await offered('14:00') });
      for (const [field, value] of Object.entries(details())) st = reduce(st, { type: 'FIELD', field: field as 'name', value });
      st = reduce(st, { type: 'REVIEW' });
      st = reduce(st, { type: 'SUBMIT' });
      expect(st.attempt!.key).toBe(first.attempt!.key);
      st = reduce(st, { type: 'RESPONSE', outcome: await postReservation(st.attempt!.body, st.attempt!.key) });
      expect(st.step).toBe('conflict');
      st = reduce(st, { type: 'CONFLICT_LOOKUP', outcome: await lookupReservation(st.attempt!.key) });
      expect(st.conflictFound?.id).toBe(first.reservation!.id);
      expect(await reservationCount()).toBe(1);
      expect(await liveHolds()).toBe(1);
    });
  });

  describe('overlaps and stale availability', () => {
    it('two staff members booking the same court and time at once: exactly one wins; the other is returned to time selection with their details kept, and no overlap exists', async () => {
      const target = await offered('13:00');
      const a = ui();
      const b = ui();
      await Promise.all([a.book(target, details({ name: 'First Person' })), b.book(target, details({ name: 'Second Person' }))]);
      expect([a.state.step, b.state.step].sort()).toEqual(['done', 'idle']);
      const loser = a.state.step === 'idle' ? a : b;
      expect(loser.state.notice).toMatch(/just taken|available times changed/i);
      expect(loser.state.details.partySize).toBe('2');
      expect(loser.state.details.name).toMatch(/Person/);
      expect(loser.state.attempt).toBeNull();
      expect(await reservationCount()).toBe(1);
      expect(await liveHolds()).toBe(1);
      expect(await overlappingLiveHolds()).toBe(0);
      const fresh = await fetchBasis({ offeringId: 'a-off', resourceId: 'a-court-1', from: MONDAY, to: MONDAY });
      expect(fresh.ok && fresh.data.days[0].starts.some(s => s.time === '13:00')).toBe(false); // the re-read no longer offers the taken time
    });

    it('a start that overlaps a held hour is refused by the server even if the UI were bypassed', async () => {
      await ui().book(await offered('10:00'));
      const body = { ...bodyOf(await offered('11:00'), details()), start: { date: MONDAY, time: '10:30' } };
      const refused = await postReservation(body, `bk_${'1'.repeat(32)}`);
      expect(refused.kind).toBe('refused');
      expect(await reservationCount()).toBe(1);
      expect(await overlappingLiveHolds()).toBe(0);
    });

    it.each([
      ['an offering edit', "UPDATE scheduling_offerings SET name = 'Edited', updated_at = clock_timestamp() WHERE id = 'a-off'"],
      ['the court’s hours changing', "UPDATE scheduling_availability_versions SET version = version + 1 WHERE owner_kind = 'resource' AND owner_id = 'a-court-1'"],
      ['the offering’s hours changing', "UPDATE scheduling_availability_versions SET version = version + 1 WHERE owner_kind = 'offering' AND owner_id = 'a-off'"],
    ])('stale availability (%s after the times were read) cannot be booked: AVAILABILITY_CHANGED, nothing written, details kept, then the fresh basis books', async (_name, edit) => {
      const target = await offered('15:00');
      await q(edit);
      const u = ui();
      const s = await u.book(target);
      expect(s.step).toBe('idle');
      expect(s.notice).toMatch(/available times changed/i);
      expect(s.preferTime).toEqual({ date: MONDAY, time: '15:00' });
      expect(s.details.name).toBe(PII.name);
      expect(s.refetch).toBe(1);
      expect(await reservationCount()).toBe(0);
      expect(await liveHolds()).toBe(0);
      // the dialog re-reads the basis, offers 15:00 again, and the SAME details book it
      u.send({ type: 'START', target: await offered('15:00') });
      u.send({ type: 'REVIEW' });
      u.send({ type: 'SUBMIT' });
      await u.run();
      expect(u.state.step).toBe('done');
      expect(await reservationCount()).toBe(1);
    });
  });

  describe('a lost or uncertain reply never creates a duplicate and resolves to the original booking', () => {
    it('the reply is lost AFTER the commit: the UI shows "checking", finds the booking by the ORIGINAL key and ends in the normal Booked state', async () => {
      fault.loseReply = 1;
      const s = await ui().book(await offered('10:00'));
      expect(s.step).toBe('done');
      expect(posts()).toHaveLength(1); // one POST ever sent
      expect(requests.filter(r => r.method === 'GET' && r.path === '/api/scheduling/reservations').length).toBeGreaterThanOrEqual(1);
      expect(await reservationCount()).toBe(1);
      expect(await liveHolds()).toBe(1);
      expect(s.reservation!.customer.name).toBe(PII.name);
      expect(s.mismatch).toBe(false);
    });

    it('the request never reaches the server, repeatedly: the lookups find nothing, only a SAME-key retry is offered, every send carries one key, and exactly one booking results', async () => {
      fault.failBefore = 3;
      const u = ui();
      u.toSubmit(await offered('10:00'));
      await u.run();
      expect(u.state.step).toBe('unsure');
      expect(await reservationCount()).toBe(0);
      for (let i = 0; i < 2; i += 1) {
        u.send({ type: 'RETRY' });
        await u.run();
        expect(u.state.step).toBe('unsure');
      }
      u.send({ type: 'RETRY' });
      await u.run();
      expect(u.state.step).toBe('done');
      const keys = posts().map(p => p.key);
      expect(keys).toHaveLength(4);
      expect(new Set(keys).size).toBe(1);
      expect(await reservationCount()).toBe(1);
      expect(await liveHolds()).toBe(1);
    });

    it('a 504 after the booking committed is recovered by the key, never shown as a failure', async () => {
      const u = ui();
      u.toSubmit(await offered('09:00'));
      const { body, key } = u.state.attempt!;
      expect((await postReservation(body, key)).kind).toBe('created'); // the server committed
      u.send({ type: 'RESPONSE', outcome: { kind: 'uncertain' } }); // but the browser was told 504 / lost it
      await u.run();
      expect(u.state.step).toBe('done');
      expect(u.state.reservation!.start).toEqual({ date: MONDAY, time: '09:00' });
      expect(await reservationCount()).toBe(1);
    });
  });

  describe('roles', () => {
    it.each(['viewer', 'analyst', 'managerViewOnly', 'noCap'] as const)('%s cannot read the basis or book: the UI is told "denied" or "not available" and nothing is written', async who => {
      const target = await offered('10:00'); // read as the manager
      await signIn(PEOPLE[who]);
      const before = await hashAll();
      const outcome = await postReservation(bodyOf(target, details()), `bk_${'a'.repeat(32)}`);
      expect(['denied', 'gate_off']).toContain(outcome.kind);
      expect((await fetchBasis({ offeringId: 'a-off', resourceId: 'a-court-1', from: MONDAY, to: MONDAY })).ok).toBe(false);
      expect(await hashAll()).toEqual(before);
    });

    it('no session at all is denied', async () => {
      const target = await offered('10:00');
      signOut();
      expect((await postReservation(bodyOf(target, details()), `bk_${'b'.repeat(32)}`)).kind).toBe('denied');
      expect(await reservationCount()).toBe(0);
    });

    it('with the kill switch off every booking call is a plain 404 (a gate), the UI is told so, and nothing is written', async () => {
      const target = await offered('10:00');
      delete process.env.SCHEDULING_STAFF_BOOKING;
      const before = await hashAll();
      expect(await postReservation(bodyOf(target, details()), `bk_${'c'.repeat(32)}`)).toEqual({ kind: 'gate_off' });
      expect(await lookupReservation(`bk_${'c'.repeat(32)}`)).toEqual({ kind: 'missing' });
      expect(await hashAll()).toEqual(before);
    });
  });

  describe('cancellation history stays intact', () => {
    it('a cancelled booking keeps its row, frees its hold, its key still resolves to the cancelled booking (no new booking), and the slot can be booked again with a new key', async () => {
      const first = await ui().book(await offered('10:00'));
      const id = first.reservation!.id;
      expect((await bridge(`http://bb.test/api/scheduling/reservations/${id}/cancel`, { method: 'POST' })).status).toBe(200);
      expect(await liveHolds()).toBe(0);
      expect(await reservationCount()).toBe(1);
      const replay = await postReservation(first.attempt!.body, first.attempt!.key);
      expect(replay.kind === 'created' && replay.reservation.status).toBe('cancelled');
      expect(await reservationCount()).toBe(1);
      expect(await liveHolds()).toBe(0);
      const second = await ui().book(await offered('10:00'));
      expect(second.step).toBe('done');
      expect(second.reservation!.id).not.toBe(id);
      expect(await reservationCount()).toBe(2);
      expect(await liveHolds()).toBe(1);
      expect((await q<{ status: string }>('SELECT status FROM scheduling_reservations WHERE id = $1', [id]))[0].status).toBe('cancelled');
    });
  });

  describe('privacy: no customer detail reaches the audit log, the console or an error body', () => {
    it('after bookings, refusals, a lost reply and a cancel, the audit rows, every console call and every error body contain none of the customer details', async () => {
      const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => undefined));
      const errorBodies: string[] = [];
      const inner = bridge;
      vi.stubGlobal('fetch', async (i: RequestInfo | URL, init?: RequestInit) => {
        const res = await inner(i, init);
        if (!res.ok) errorBodies.push(await res.clone().text());
        return res;
      });
      await ui().book(await offered('09:00')); // a success
      const taken = await ui().book(await offered('11:00')); // another, then a clash on it
      expect(taken.step).toBe('done');
      const clash = ui();
      clash.toSubmit(await offered('13:00'));
      await ui().book(await offered('13:00'));
      await clash.run(); // refused: RESOURCE_CONFLICT
      expect(clash.state.step).toBe('idle');
      fault.loseReply = 1;
      expect((await ui().book(await offered('14:00'))).step).toBe('done'); // a lost reply, recovered
      const stale = ui(); // a stale basis
      await stale.book({ ...(await offered('15:00')), basis: { offeringVersion: '0', resourceVersion: '0', offeringToken: 'x', scheduleToken: 'y' } });
      expect(stale.state.step).toBe('idle');
      await bridge(`http://bb.test/api/scheduling/reservations/${taken.reservation!.id}/cancel`, { method: 'POST' });
      await postReservation({ ...bodyOf(await offered('16:00'), details()), customer: { name: 'Zelda Quartermain', email: 'zelda.q@bad' } }, `bk_${'d'.repeat(32)}`); // a validation refusal

      const audit = JSON.stringify(await q('SELECT * FROM audit_logs'));
      expect(errorBodies.length).toBeGreaterThanOrEqual(3);
      for (const secret of SECRETS) {
        expect(audit, `audit leaks ${secret}`).not.toContain(secret);
        expect(errorBodies.join(' '), `an error body leaks ${secret}`).not.toContain(secret);
        for (const spy of consoleSpies) expect(JSON.stringify(spy.mock.calls), `console leaks ${secret}`).not.toContain(secret);
      }
      expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'scheduling.reservation.created'"))[0].n).toBe(4);
    });
  });
});
