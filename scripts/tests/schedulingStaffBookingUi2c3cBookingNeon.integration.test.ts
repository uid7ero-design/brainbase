import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { PRESETS, defaultScheduleConfig } from '@scheduling/core';
import { PostgresAvailabilityRepository, fromNeonHttpLike } from '@scheduling/postgres';
import { TZ } from '../../packages/scheduling-postgres/tests/support/builders';
import { staff, uid } from '../../packages/scheduling-postgres/tests/support/pgHarness';

// Phase 2C.3c UI slice 2: the staff booking UI's OWN client code (state machine + postReservation + lookupReservation) driven through the real routes with the REAL
// @neondatabase/serverless HTTP driver as `@/lib/db`, against a DISPOSABLE Neon branch only. Opt-in: skipped unless NEON_REHEARSAL_URL is set. Same safety guard as the 2C.3b Neon test:
// refuses to run unless NEON_REHEARSAL_HOST equals the host of NEON_REHEARSAL_URL, the login role is exactly rehearsal_037, and migration 037 is present. Only two synthetic organisations
// (neon-ui2-a, neon-ui2-b) are written and removed afterwards; every other organisation's rows (the Production-data copy, including the pilot and LD Tennis) are fingerprinted before
// and after and must be identical. No credential is stored here.

const URL_ = process.env.NEON_REHEARSAL_URL ?? '';
const EXPECTED_HOST = process.env.NEON_REHEARSAL_HOST ?? '';
const suite = URL_ !== '' ? describe : describe.skip;

const ORG = 'neon-ui2-a';
const OTHER = 'neon-ui2-b';

const state = vi.hoisted(() => ({ loseNextReply: false, failNextBeforeSend: false, unexpectedBefore: false, unexpectedAfter: false, batches: 0, session: null as null | { userId: string; organisationId: string; role: string }, noCapability: false }));

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
      if (state.unexpectedBefore) {
        state.unexpectedBefore = false;
        throw Object.assign(new Error('internal error'), { code: 'XX000' }); // an unclassified server error: nothing was written
      }
      const out = await real.transaction(queries, opts); // the REAL commit
      if (state.unexpectedAfter) {
        state.unexpectedAfter = false;
        return [...out.slice(0, -1), [null]]; // committed, but the reply cannot be read: the repository throws although the booking IS written
      }
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


const basisRoute = (await import('@/app/api/scheduling/reservations/basis/route')) as unknown as { GET: Handler };
const { fetchBasis } = await import('@/lib/scheduling/staffBooking/basisClient');
const { postReservation, lookupReservation } = await import('@/lib/scheduling/staffBooking/submitClient');
const { createMachine, initialState, recoveredState, recoverySettled, settlesAttempt, provableNotBooked } = await import('@/lib/scheduling/staffBooking/machine');
const { createBookingKeyHolder, canonicalContent } = await import('@/lib/scheduling/staffBooking/key');
const { createPendingStore } = await import('@/lib/scheduling/staffBooking/pendingStore');
type PendingStoreT = ReturnType<typeof createPendingStore>;
/** Faults injected AT THE BROWSER'S NETWORK (the route and the Neon driver run for real): the reply is lost AFTER the commit, or the reconcile lookups fail. */
const netFault = { loseReply: 0, blockLookups: false };

type Q = { query(text: string, params?: unknown[], opts?: Record<string, unknown>): Promise<unknown>; transaction: (q: unknown[], o?: Record<string, unknown>) => Promise<unknown[]> };
let sql: Q;
let avail: PostgresAvailabilityRepository;
const rows = async (text: string, params: unknown[] = []) => (await sql.query(text, params)) as Array<Record<string, unknown>>;
const as = (userId: string, organisationId: string, role = 'manager') => { state.session = { userId, organisationId, role }; };


function nextWeekday(dayOfWeek: number, minDaysAhead: number): string {
  const d = new Date(Date.now() + minDaysAhead * 86_400_000);
  d.setUTCHours(12, 0, 0, 0);
  while (d.getUTCDay() !== dayOfWeek) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const MONDAY = nextWeekday(1, 40);
interface Fx { schedule: string; offering: string; court: string; court2: string }
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

/** The UI's relative fetch() calls, served by the REAL route handlers (the session and capability lookups are the mocks above; the database is the Neon driver). */
const requests: Array<{ method: string; url: string; key: string | null }> = [];
const realFetch = globalThis.fetch.bind(globalThis); // the Neon driver itself uses fetch: only the UI's relative URLs are bridged
async function bridge(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!String(input).startsWith('/')) return realFetch(input, init);
  const url = new URL(String(input), 'http://bb.test');
  const method = init?.method ?? 'GET';
  const headers = new Headers(init?.headers);
  requests.push({ method, url: url.pathname + url.search, key: headers.get('idempotency-key') });
  const bodyText = typeof init?.body === 'string' ? init.body : undefined;
  const route = (handler: Handler, params: Record<string, string> = {}) => handler(new Request(url.toString(), { method, headers, ...(bodyText !== undefined ? { body: bodyText } : {}) }), { params: Promise.resolve(params) });
  if (url.pathname === '/api/scheduling/reservations/basis') return route(basisRoute.GET);
  if (url.pathname === '/api/scheduling/reservations' && method === 'GET' && netFault.blockLookups) throw new TypeError('network down for lookups');
  if (url.pathname === '/api/scheduling/reservations' && method === 'POST' && netFault.loseReply > 0) {
    netFault.loseReply -= 1;
    await (await route(collection.POST)).text(); // the server (and the Neon commit) finished; the reply never reaches the browser
    throw new TypeError('network lost the reply');
  }
  if (url.pathname === '/api/scheduling/reservations') return route(method === 'POST' ? collection.POST : collection.GET);
  let m: RegExpMatchArray | null;
  if ((m = url.pathname.match(/^\/api\/scheduling\/reservations\/([^/]+)\/cancel$/))) return route(cancelRoute.POST, { reservationId: decodeURIComponent(m[1]) });
  if ((m = url.pathname.match(/^\/api\/scheduling\/reservations\/([^/]+)$/))) return route(one.GET, { reservationId: decodeURIComponent(m[1]) });
  return Response.json({ error: 'not_found' }, { status: 404 });
}

// ISOLATION RULE: every synthetic organisation of every Neon suite is named 'neon-*' (this suite: neon-ui2-*). "Other organisations" means everything NOT 'neon-*', so suites can run in
// parallel or in any order without seeing each other's rows. The Production-data copy uses uuid ids and is never matched by this prefix.
const OTHERS_SNAPSHOT_SQL = `SELECT
  (SELECT count(*)::int FROM scheduling_reservations WHERE organisation_id NOT LIKE 'neon-%') AS reservations,
  (SELECT count(*)::int FROM scheduling_resource_holds WHERE organisation_id NOT LIKE 'neon-%') AS holds,
  (SELECT md5(string_agg(r::text, '|' ORDER BY id)) FROM scheduling_reservations r WHERE organisation_id NOT LIKE 'neon-%') AS reservation_rows,
  (SELECT md5(string_agg(r::text, '|' ORDER BY id)) FROM scheduling_availability_rules r WHERE organisation_id NOT LIKE 'neon-%') AS rules,
  (SELECT md5(string_agg(v::text, '|' ORDER BY organisation_id, owner_kind, owner_id)) FROM scheduling_availability_versions v WHERE organisation_id NOT LIKE 'neon-%') AS versions,
  (SELECT md5(string_agg(o::text, '|' ORDER BY id)) FROM scheduling_offerings o WHERE organisation_id NOT LIKE 'neon-%') AS offerings`;
let othersBefore: Record<string, unknown>;
const timings: Record<string, number | string> = {};

suite('Staff booking UI slice 2 through the REAL Neon HTTP driver', () => {
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
    othersBefore = (await rows(OTHERS_SNAPSHOT_SQL))[0];
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    const othersAfter = (await rows(OTHERS_SNAPSHOT_SQL))[0];
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
    state.unexpectedBefore = false;
    state.unexpectedAfter = false;
    as('neon-ui2-u1', ORG);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });


  // ── the UI's own client code, driven through the same Neon-backed routes ──────────────────────────────────────────────────────────

  const PII = { name: 'Neon Quartermain', email: 'neon.q@example.test', phone: '0411 999 888', notes: 'neon ui note' };
  const UI_SECRETS = ['Neon Quartermain', 'neon.q', '0411 999 888', 'neon ui note'];
  const details = (over: Partial<{ name: string; email: string; phone: string; partySize: string; notes: string }> = {}) => ({ ...PII, partySize: '2', ...over });

  async function offered(f: Fx, time = '10:00') {
    const r = await fetchBasis({ offeringId: f.offering, resourceId: f.court, from: MONDAY, to: MONDAY });
    if (!r.ok) throw new Error(`basis refused: ${JSON.stringify(r.problem)}`);
    const start = r.data.days[0].starts.find(s => s.time === time);
    if (!start) throw new Error(`${time} not offered`);
    return {
      offeringId: f.offering, offeringName: 'Neon hire', resourceId: f.court, resourceName: 'Court', date: MONDAY, time, startsAt: start.startsAt,
      durationMinutes: r.data.offering.durationMinutes, timezone: r.data.timezone, capacity: r.data.resource.capacity, price: r.data.offering.price, basis: r.data.basis,
    };
  }
  type Target = Awaited<ReturnType<typeof offered>>;

  function ui(opts: { store?: PendingStoreT; pending?: { key: string; fp: string } } = {}) {
    const holder = createBookingKeyHolder();
    const reduce = createMachine(holder, opts.store ? { fingerprint: c => opts.store!.fingerprint(c) } : {});
    let st = opts.pending ? recoveredState(opts.pending) : initialState(); // a reopened or reloaded dialog: a FRESH holder, started from the record alone
    const send = (a: Parameters<typeof reduce>[1]) => (st = reduce(st, a));
    const run = async () => {
      for (let i = 0; i < 60; i += 1) {
        if (st.step === 'submitting') {
          if (opts.store && !opts.store.ensure(st.attempt!.key, canonicalContent(st.attempt!.content)).ok) send({ type: 'STORE_FAILED' }); // write-ahead, as the dialog does
          else {
            const uncertainBefore = !provableNotBooked(st);
            const outcome = await postReservation(st.attempt!.body, st.attempt!.key);
            if (opts.store && settlesAttempt(outcome, uncertainBefore)) opts.store.clear();
            send({ type: 'RESPONSE', outcome });
          }
        } else if (st.step === 'recovering' && !recoverySettled(st)) {
          send({ type: 'POLL', outcome: await lookupReservation(st.pending!.key) });
          if (opts.store && st.step === 'done') opts.store.clear();
        } else if (st.step === 'checking') send({ type: 'POLL', outcome: await lookupReservation(st.attempt!.key) });
        else {
          if (opts.store && st.step === 'done') opts.store.clear();
          return;
        }
      }
      throw new Error('the machine did not settle');
    };
    const toSubmit = (target: Target, d = details()) => {
      send({ type: 'START', target });
      for (const [field, value] of Object.entries(d)) send({ type: 'FIELD', field: field as 'name', value });
      send({ type: 'REVIEW' });
      send({ type: 'SUBMIT' });
    };
    const book = async (target: Target, d = details()) => {
      toSubmit(target, d);
      await run();
      return st;
    };
    const fill = (d: ReturnType<typeof details>) => {
      for (const [field, value] of Object.entries(d)) send({ type: 'FIELD', field: field as 'name', value });
    };
    return { send, run, toSubmit, book, fill, get state() { return st; } };
  }

  describe('UI slice 2: the dialog’s machine and client over the Neon driver', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', bridge);
      requests.length = 0;
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('U1: one booking through the UI client = one reservation + one exclusive hold in ONE driver batch; the key travels only in the header', async () => {
      const f = await fixture();
      const target = await offered(f);
      const batches = state.batches;
      const s = await ui().book(target);
      expect(s.step).toBe('done');
      expect(s.reservation).toMatchObject({ resourceId: f.court, offeringId: f.offering, start: { date: MONDAY, time: '10:00' }, durationMinutes: 60, partySize: 2 });
      expect(s.reservation!.startsAt).toBe(target.startsAt);
      expect(state.batches - batches).toBe(1);
      expect([await total(f), await holds(f), await overlaps(f)]).toEqual([1, 1, 0]);
      const posts = requests.filter(r => r.method === 'POST');
      expect(posts).toHaveLength(1);
      expect(posts[0].key).toMatch(/^bk_[0-9a-f]{32}$/);
      expect(posts[0].url).toBe('/api/scheduling/reservations');
    });

    it('U2: six identical sends in flight (a double submit, five times over) create one booking; the replays never reach the write', async () => {
      const f = await fixture();
      const u = ui();
      u.toSubmit(await offered(f, '11:00'));
      const { body: b, key } = u.state.attempt!;
      const batches = state.batches;
      const outcomes = await Promise.all(Array.from({ length: 6 }, () => postReservation(b, key)));
      const created = outcomes.filter((o): o is Extract<typeof o, { kind: 'created' }> => o.kind === 'created');
      expect(created).toHaveLength(6);
      expect(new Set(created.map(o => o.reservation.id)).size).toBe(1);
      expect(created.filter(o => !o.replayed)).toHaveLength(1);
      expect(state.batches - batches).toBeLessThanOrEqual(6);
      expect([await total(f), await holds(f)]).toEqual([1, 1]);
    });

    it('U3: a reply lost after the real commit ends in the normal Booked state (the route recovers it by the key); one POST, one booking', async () => {
      const f = await fixture();
      state.loseNextReply = true;
      const s = await ui().book(await offered(f));
      expect(s.step).toBe('done');
      expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
      // the route itself reconciles by the key and answers 201 recovered (2C.3c-A), so the UI needs no lookup here; the lookup path is covered by U4 and the PostgreSQL suite
      expect([await total(f), await holds(f)]).toEqual([1, 1]);
    });

    it('U4: a request that never reaches the database, repeatedly: only same-key retries, one key on every send, exactly one booking at the end', async () => {
      const f = await fixture();
      const u = ui();
      state.failNextBeforeSend = true;
      u.toSubmit(await offered(f));
      await u.run();
      expect(u.state.step).toBe('unsure');
      expect(await total(f)).toBe(0);
      u.send({ type: 'RETRY' });
      await u.run();
      expect(u.state.step).toBe('done');
      const keys = requests.filter(r => r.method === 'POST').map(r => r.key);
      expect(keys).toHaveLength(2);
      expect(new Set(keys).size).toBe(1);
      expect([await total(f), await holds(f)]).toEqual([1, 1]);
    });

    // ── reload recovery over the real Neon driver ────────────────────────────────────────────────────────────────────────────────
    const memory = (): Storage => {
      const m = new Map<string, string>();
      return { get length() { return m.size; }, clear: () => m.clear(), getItem: k => m.get(k) ?? null, key: i => [...m.keys()][i] ?? null, removeItem: k => void m.delete(k), setItem: (k, v) => void m.set(k, v) };
    };
    const SECRET = 'rs_neon_recovery_secret_012345678901234567890';
    const keysSent = () => [...new Set(requests.filter(r => r.method === 'POST').map(r => r.key))];
    async function firstLife(storage: Storage, target: Target) {
      const store = createPendingStore(SECRET, storage);
      netFault.loseReply = 1;
      netFault.blockLookups = true;
      const u = ui({ store });
      u.toSubmit(target);
      await u.run();
      netFault.blockLookups = false;
      expect(['unsure', 'checking']).toContain(u.state.step);
      const record = store.read();
      expect(record?.key).toBe(u.state.attempt!.key);
      return { store, record: record!, key: u.state.attempt!.key };
    }
    afterEach(() => {
      netFault.loseReply = 0;
      netFault.blockLookups = false;
    });

    it('U9 (D1): committed write, lost reply, lookups failing; close and reopen from the record RECOVERS the original booking by its key. One POST, one key, one reservation, one hold', async () => {
      const f = await fixture();
      const storage = memory();
      const first = await firstLife(storage, await offered(f));
      expect(await total(f)).toBe(1); // it DID commit
      const u = ui({ store: first.store, pending: { key: first.record.key, fp: first.record.fp } });
      expect(u.state.step).toBe('recovering');
      await u.run();
      expect(u.state.step).toBe('done');
      expect(u.state.reservation!.customer.name).toBe(PII.name);
      expect(keysSent()).toEqual([first.key]);
      expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
      expect([await total(f), await holds(f), await overlaps(f)]).toEqual([1, 1, 0]);
      expect(storage.length).toBe(0);
    });

    it('U10: committed, lookups failing: the booked time is no longer offered, so retyping cannot create a second booking; "Check again" then finds the ORIGINAL; a wrong retype is refused before any send', async () => {
      const f = await fixture();
      const storage = memory();
      const first = await firstLife(storage, await offered(f));
      netFault.blockLookups = true;
      const u = ui({ store: first.store, pending: { key: first.record.key, fp: first.record.fp } });
      await u.run();
      expect(recoverySettled(u.state)).toBe(true);
      u.send({ type: 'ENTER_AGAIN' });
      await expect(offered(f, '10:00')).rejects.toThrow(/not offered/); // the engine no longer offers the held hour
      u.send({ type: 'START', target: await offered(f, '11:00') });
      u.fill(details());
      u.send({ type: 'REVIEW' });
      expect(u.state.step).toBe('details'); // a different start time is a different booking
      expect(requests.filter(r => r.method === 'POST')).toHaveLength(1);
      netFault.blockLookups = false;
      const again = ui({ store: first.store, pending: { key: first.record.key, fp: first.record.fp } }); // Check again, on a fresh page
      await again.run();
      expect(again.state.step).toBe('done');
      expect(keysSent()).toEqual([first.key]);
      expect([await total(f), await holds(f), await overlaps(f)]).toEqual([1, 1, 0]);
      expect(storage.length).toBe(0);
    });

    it('U10b: the request never reached the database: the lookup finds nothing, "Enter the booking again" replays the ORIGINAL key and creates the booking once', async () => {
      const f = await fixture();
      const storage = memory();
      const store = createPendingStore(SECRET, storage);
      state.failNextBeforeSend = true;
      netFault.blockLookups = true;
      const first = ui({ store });
      first.toSubmit(await offered(f));
      await first.run();
      netFault.blockLookups = false;
      expect(await total(f)).toBe(0);
      const record = store.read()!;
      const u = ui({ store, pending: { key: record.key, fp: record.fp } });
      await u.run();
      expect(recoverySettled(u.state)).toBe(true);
      u.send({ type: 'ENTER_AGAIN' });
      u.send({ type: 'START', target: await offered(f, '10:00') });
      u.fill(details());
      u.send({ type: 'REVIEW' });
      expect(u.state.reviewKey).toBe(record.key);
      u.send({ type: 'SUBMIT' });
      await u.run();
      expect(u.state.step).toBe('done');
      expect(keysSent()).toEqual([record.key]);
      expect([await total(f), await holds(f), await overlaps(f)]).toEqual([1, 1, 0]);
      expect(storage.length).toBe(0);
    });

    it('U11: the record holds no customer detail, resource, offering, date or secret, and another user\'s secret cannot see it', async () => {
      const f = await fixture();
      const storage = memory();
      const first = await firstLife(storage, await offered(f));
      const raw = JSON.stringify(Object.fromEntries(Array.from({ length: storage.length }, (_, i) => [storage.key(i)!, storage.getItem(storage.key(i)!)])));
      for (const s of [...UI_SECRETS, f.court, f.offering, MONDAY, SECRET]) expect(raw).not.toContain(s);
      expect(createPendingStore('rs_another_users_secret_0123456789012345678', storage).read()).toBeNull();
      expect(first.store.read()?.key).toBe(first.key);
      as('neon-ui2-u2', OTHER); // another organisation cannot find the booking by the recovered key either
      expect(await lookupReservation(first.key)).toEqual({ kind: 'missing' });
    });

    it('U5: stale availability cannot be booked (AVAILABILITY_CHANGED, nothing written, details kept); the fresh basis books the same details', async () => {
      const f = await fixture();
      const target = await offered(f, '15:00');
      await rows("UPDATE scheduling_offerings SET name = 'Edited', updated_at = clock_timestamp() WHERE id = $1", [f.offering]);
      const u = ui();
      const s = await u.book(target);
      expect(s.step).toBe('idle');
      expect(s.notice).toMatch(/available times changed/i);
      expect(s.details.name).toBe(PII.name);
      expect([await total(f), await holds(f)]).toEqual([0, 0]);
      u.send({ type: 'START', target: await offered(f, '15:00') });
      u.send({ type: 'REVIEW' });
      u.send({ type: 'SUBMIT' });
      await u.run();
      expect(u.state.step).toBe('done');
      expect(await total(f)).toBe(1);
    });

    it('U6: two staff racing for one court and hour: one Booked, the other returned to time selection with details kept; one hold, no overlap', async () => {
      const f = await fixture();
      const target = await offered(f, '13:00');
      const a = ui();
      const b = ui();
      await Promise.all([a.book(target, details({ name: 'First Person' })), b.book(target, details({ name: 'Second Person' }))]);
      expect([a.state.step, b.state.step].sort()).toEqual(['done', 'idle']);
      const loser = a.state.step === 'idle' ? a : b;
      expect(loser.state.notice).toMatch(/just taken|available times changed/i);
      expect(loser.state.details.name).toMatch(/Person/);
      expect([await total(f), await holds(f), await overlaps(f)]).toEqual([1, 1, 0]);
    });

    it('U7: the other organisation can neither find nor book it; a viewer is denied; the kill switch makes every call a 404; nothing is written by any of them', async () => {
      const f = await fixture();
      const s = await ui().book(await offered(f));
      expect(s.step).toBe('done');
      const key = s.attempt!.key;
      const before = await total(f);
      as('neon-ui2-u2', OTHER);
      expect(await lookupReservation(key)).toEqual({ kind: 'missing' });
      expect((await postReservation(s.attempt!.body, `bk_${'e'.repeat(32)}`)).kind).toBe('refused'); // org-b cannot book org-a's court: NOT_FOUND family
      as('neon-ui2-viewer', ORG, 'viewer');
      expect((await postReservation(s.attempt!.body, `bk_${'f'.repeat(32)}`)).kind).toBe('denied');
      as('neon-ui2-u1', ORG);
      process.env.SCHEDULING_STAFF_BOOKING = 'off';
      expect(await postReservation(s.attempt!.body, `bk_${'9'.repeat(32)}`)).toEqual({ kind: 'gate_off' });
      process.env.SCHEDULING_STAFF_BOOKING = 'on';
      expect(await total(f)).toBe(before);
      expect(await holds(f)).toBe(1);
    });

    it('U8: no customer detail reaches the audit rows, an error body or the console, through the Neon driver', async () => {
      const f = await fixture();
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => undefined));
      const bodies: string[] = [];
      vi.stubGlobal('fetch', async (i: RequestInfo | URL, init?: RequestInit) => {
        const res = await bridge(i, init);
        if (!res.ok) bodies.push(await res.clone().text());
        return res;
      });
      await ui().book(await offered(f, '09:00'));
      const clash = ui();
      clash.toSubmit(await offered(f, '10:00'));
      await ui().book(await offered(f, '10:00'));
      await clash.run();
      expect(clash.state.step).toBe('idle');
      const lost = ui();
      state.loseNextReply = true;
      expect((await lost.book(await offered(f, '14:00'))).step).toBe('done');
      const audit = JSON.stringify(await rows("SELECT * FROM audit_logs WHERE organisation_id = $1 AND action LIKE 'scheduling.%'", [ORG]));
      expect(bodies.length).toBeGreaterThanOrEqual(1);
      for (const secret of UI_SECRETS) {
        expect(audit, `audit leaks ${secret}`).not.toContain(secret);
        expect(bodies.join(' '), `an error body leaks ${secret}`).not.toContain(secret);
        for (const spy of spies) expect(JSON.stringify(spy.mock.calls), `console leaks ${secret}`).not.toContain(secret);
      }
    });
  });
});
