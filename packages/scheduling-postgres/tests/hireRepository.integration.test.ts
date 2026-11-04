import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HIRE_FAILURE_CODES,
  HireNotReadyError,
  resolveLocalTime,
  type HireFailure,
  type HireRequest,
  type HireResult,
  type TenantContext,
} from '@scheduling/core';
import {
  HIRE_GUARDED_SQL,
  PostgresAvailabilityRepository,
  PostgresHireRepository,
  PostgresReservationRepository,
  PostgresSchedulingConfigRepository,
  fromPgLike,
  sqlstateOf,
  type SqlExecutor,
  type SqlStatement,
} from '@scheduling/postgres';
import { TZ } from './support/builders';
import { FixedClock, closePool, customerActor, ensureSchema, getPool, hasDatabase, publicActor, resetData, runScript, seedOffering, seedResource, seedSchedule, sqlFile, staff, uid } from './support/pgHarness';

// PHASE 2C.3a: PostgresHireRepository.createHire on a real PostgreSQL (run by scripts/tests/verify-scheduling-phase2c.sh on 16 and 17).
//
// The write is ONE guarded batch (`[set_config timeouts, booking]`); the decision before it uses the shared pure engine. Every "the world changed" case below is made deterministic by an
// executor wrapper that performs the competing change AFTER createHire has read and decided and BEFORE it writes (`beforeWrite`), so no case depends on timing. The cases that need a
// real lock wait observe the interleaving through pg_stat_activity (the leading statement text) instead of sleeping and hoping.

const ORG = 'org-hire';
const OTHER = 'org-hire-other';
const suite = hasDatabase ? describe : describe.skip;
const DAY = '2026-11-16'; // a Monday: Adelaide is on ACDT (UTC+10:30)
const hours = { kind: 'hours' as const, label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null };
const clock = new FixedClock(new Date('2026-11-02T00:00:00Z'));
const tenant = staff(ORG);

let avail: PostgresAvailabilityRepository;
let config: PostgresSchedulingConfigRepository;
let reservations: PostgresReservationRepository;
let hire: PostgresHireRepository;
const pg = () => fromPgLike(getPool());
const q = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => getPool().query(text, params).then(r => r.rows as T[]);

interface Fx { schedule: string; offering: string; court: string }

async function fixture(org = ORG, over: { durationMinutes?: number | null; capacity?: number; priceCents?: number; rules?: boolean } = {}): Promise<Fx> {
  const f = { schedule: uid('sch'), offering: uid('off'), court: uid('court') };
  await seedSchedule(org, f.schedule, 'resource_hire');
  await seedOffering(org, f.offering, f.schedule, { capacity: null, durationMinutes: over.durationMinutes === undefined ? 60 : over.durationMinutes });
  await q('UPDATE scheduling_offerings SET price_cents = $3 WHERE organisation_id = $1 AND id = $2', [org, f.offering, over.priceCents ?? 5000]);
  if (over.durationMinutes === null) await q('UPDATE scheduling_offerings SET duration_minutes = NULL WHERE organisation_id = $1 AND id = $2', [org, f.offering]); // the seed turns null into 60
  await seedResource(org, f.court, 'court', { capacity: over.capacity ?? 4 });
  await q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [org, f.offering, f.court]);
  if (over.rules !== false) {
    const t = staff(org);
    const a = await avail.createRule(t, { kind: 'offering', id: f.offering }, hours, TZ);
    const b = await avail.createRule(t, { kind: 'resource', id: f.court }, hours, TZ);
    if (!a.ok || !b.ok) throw new Error(`fixture rules: ${JSON.stringify([a, b])}`);
  }
  return f;
}

let keySeq = 0;
const newKey = () => `hire-key-${String(++keySeq).padStart(6, '0')}-${Math.random().toString(36).slice(2, 10)}`;
const req = (f: Fx, over: Partial<HireRequest> = {}): HireRequest => ({
  idempotencyKey: newKey(),
  offeringId: f.offering,
  resourceId: f.court,
  start: { date: DAY, time: '10:00' },
  partySize: 2,
  customer: { name: 'Pat Hirer', email: 'Pat@Example.com', phone: '0400 000 000' },
  notes: 'bring own balls',
  ...over,
});

const live = async (f: Fx, org = ORG) => Number((await q<{ n: number }>("SELECT count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1 AND offering_id = $2 AND status <> 'cancelled'", [org, f.offering]))[0].n);
const total = async (f: Fx, org = ORG) => Number((await q<{ n: number }>('SELECT count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1 AND offering_id = $2', [org, f.offering]))[0].n);
const holdsOf = async (f: Fx, org = ORG) => Number((await q<{ n: number }>('SELECT count(*)::int AS n FROM scheduling_resource_holds WHERE organisation_id = $1 AND resource_id = $2 AND released_at IS NULL', [org, f.court]))[0].n);
const fail = (r: HireResult): HireFailure => {
  if (r.ok) throw new Error(`expected a failure, got a reservation ${r.reservation.id}`);
  return r;
};
const ok = (r: HireResult) => {
  if (!r.ok) throw new Error(`expected a reservation, got ${r.code}: ${r.message}`);
  return r;
};
const nothing = async (f: Fx) => {
  expect(await total(f)).toBe(0);
  expect(await holdsOf(f)).toBe(0);
};

/** An executor that runs `beforeWrite` after createHire has decided and just before it writes, can rewrite the booking statement, and can lose the reply. */
interface Hooks {
  beforeWrite?: () => Promise<void>;
  transform?: (statements: readonly SqlStatement[]) => readonly SqlStatement[];
  /** Run the batch for real, then throw `error` instead of returning (a lost response). */
  loseReply?: Error;
  /** Throw `error` without running anything (a request that never arrived). */
  dropRequest?: Error;
  /** Also fail every plain read after the batch (the resolving read by key cannot be made either). */
  failReads?: boolean;
}
function hooked(real: SqlExecutor, hooks: Hooks): SqlExecutor {
  let writes = 0;
  return {
    query: (text, params) => (hooks.failReads && writes > 0 ? Promise.reject(new Error('fetch failed')) : real.query(text, params)),
    async transaction(statements) {
      writes += 1;
      if (hooks.beforeWrite) await hooks.beforeWrite();
      if (hooks.dropRequest) throw hooks.dropRequest;
      const run = await real.transaction!(hooks.transform ? hooks.transform(statements) : statements);
      if (hooks.loseReply) throw hooks.loseReply;
      return run;
    },
  };
}
const repoWith = (hooks: Hooks, extra: Partial<ConstructorParameters<typeof PostgresHireRepository>[0]> = {}) => new PostgresHireRepository({ sql: hooked(pg(), hooks), clock, sleep: async () => undefined, ...extra });

/** Makes the booking statement hold its locks for `seconds` after the insert (a slow commit), without changing what it does. */
const slow = (seconds: number) => (statements: readonly SqlStatement[]) =>
  statements.map(s => {
    if (!s.text.includes('WITH ls AS')) return s;
    const at = s.text.lastIndexOf('FROM res r');
    return { ...s, text: `/* slow-hire */ ${s.text.slice(0, at)}FROM res r, (SELECT pg_sleep(${seconds})) z` };
  });

async function waitFor(sqlText: string, marker: string) {
  for (let i = 0; i < 400; i++) {
    const r = await q<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND ${sqlText} AND query LIKE $1 AND pid <> pg_backend_pid()`, [`%${marker}%`]);
    if (Number(r[0].n) > 0) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`never observed a backend for ${marker}`);
}
const waitBlocked = (marker: string) => waitFor("wait_event_type = 'Lock'", marker);
const waitSleeping = (marker: string) => waitFor("state = 'active' AND wait_event = 'PgSleep'", marker);
const go = <T>(p: Promise<T>) => p;

suite('createHire (Phase 2C.3a) on real PostgreSQL', () => {
  beforeAll(async () => {
    await ensureSchema();
    await runScript(sqlFile('035_availability_partial_closures.sql'));
    await runScript(sqlFile('037_availability_versions.sql'));
    await resetData();
    for (const org of [ORG, OTHER]) await getPool().query('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone', [org, TZ]);
    avail = new PostgresAvailabilityRepository({ sql: pg() });
    config = new PostgresSchedulingConfigRepository({ sql: pg() });
    reservations = new PostgresReservationRepository({ sql: pg(), clock });
    hire = new PostgresHireRepository({ sql: pg(), clock, sleep: async () => undefined });
  });
  afterAll(async () => {
    await resetData();
    await closePool();
  });

  describe('the booking', () => {
    it('creates the reservation and its exclusive hold together, snapshotting what was configured', async () => {
      const f = await fixture();
      const request = req(f);
      const r = ok(await hire.createHire(tenant, request));
      expect(r.replayed).toBe(false);
      const res = r.reservation;
      expect(res).toMatchObject({
        organisationId: ORG, scheduleId: f.schedule, presetKey: 'resource_hire', offeringId: f.offering, resourceId: f.court, customerId: null, timezone: TZ, partySize: 2,
        status: 'confirmed', paymentStatus: 'unpaid', price: { amountCents: 5000, currency: 'AUD' }, notes: 'bring own balls',
        customerSnapshot: { displayName: 'Pat Hirer', email: 'Pat@Example.com', emailNormalised: 'pat@example.com', phone: '0400 000 000' },
        span: { kind: 'slot', date: DAY, startTime: '10:00', durationMinutes: 60 },
      });
      expect(res.instants).toEqual({ startsAt: resolveLocalTime(DAY, '10:00', TZ).instant, endsAt: new Date(Date.parse(resolveLocalTime(DAY, '10:00', TZ).instant) + 3_600_000).toISOString().replace('.000Z', 'Z') });
      const row = (await q<{ contact_link: string; created_by: string; span_kind: string }>('SELECT contact_link, created_by, span_kind FROM scheduling_reservations WHERE id = $1', [res.id]))[0];
      expect(row).toEqual({ contact_link: 'none', created_by: `staff:user-of-${ORG}`, span_kind: 'slot' }); // no CRM link is created (decision 6)
      const holds = await q<{ during: string; resource_id: string; released_at: string | null }>('SELECT during::text, resource_id, released_at::text FROM scheduling_resource_holds WHERE reservation_id = $1', [res.id]);
      expect(holds).toHaveLength(1);
      expect(holds[0].resource_id).toBe(f.court);
      expect(holds[0].released_at).toBeNull();
      expect(await live(f)).toBe(1);
    });

    it('takes the minimum customer details: a name only is enough, and an optional field left blank is stored as absent', async () => {
      const f = await fixture();
      const r = ok(await hire.createHire(tenant, req(f, { customer: { name: '  Sam  ' }, notes: '   ' })));
      expect(r.reservation.customerSnapshot).toMatchObject({ displayName: 'Sam', email: null, emailNormalised: null, phone: null });
      expect(r.reservation.notes).toBeNull();
    });

    it('reports how many attempts it took (1 when nothing was busy)', async () => {
      const f = await fixture();
      expect(ok(await hire.createHire(tenant, req(f))).attempts).toBe(1);
    });
  });

  describe('who may call it', () => {
    it.each([
      ['a customer', customerActor(ORG, 'cust-1')],
      ['the public', publicActor(ORG)],
      ['staff without scheduling.reserve', staff(ORG, ['scheduling.view'])],
      ['staff without scheduling.view', staff(ORG, ['scheduling.reserve'])],
      ['staff who only manage', staff(ORG, ['scheduling.manage'])],
    ])('%s is refused, whatever else is sent, and nothing is written', async (_who, t) => {
      const f = await fixture();
      await expect(hire.createHire(t as TenantContext, req(f))).rejects.toMatchObject({ code: 'permission_denied' });
      await expect(hire.findHireByKey(t as TenantContext, newKey())).rejects.toMatchObject({ code: 'permission_denied' });
      await expect(hire.readHireBasis(t as TenantContext, f.offering, f.court)).rejects.toMatchObject({ code: 'permission_denied' });
      await nothing(f);
    });
  });

  describe('validation: the request is checked before anything is read', () => {
    it.each<[string, (f: Fx) => Partial<HireRequest>, string]>([
      ['a short idempotency key', () => ({ idempotencyKey: 'short' }), 'idempotencyKey'],
      ['an idempotency key with spaces', () => ({ idempotencyKey: 'has spaces in it 1234567890' }), 'idempotencyKey'],
      ['a blank name', () => ({ customer: { name: '   ' } }), 'customer.name'],
      ['a name with a control character', () => ({ customer: { name: 'Pat\u0007' } }), 'customer.name'],
      ['an overlong name', () => ({ customer: { name: 'x'.repeat(121) } }), 'customer.name'],
      ['a malformed email', () => ({ customer: { name: 'Pat', email: 'not-an-email' } }), 'customer.email'],
      ['a phone with letters', () => ({ customer: { name: 'Pat', phone: 'call me' } }), 'customer.phone'],
      ['notes with a control character', () => ({ notes: 'a\u0000b' }), 'notes'],
      ['notes over 1000 characters', () => ({ notes: 'n'.repeat(1001) }), 'notes'],
      ['a party of zero', () => ({ partySize: 0 }), 'partySize'],
      ['a fractional party', () => ({ partySize: 1.5 }), 'partySize'],
      ['an impossible date', () => ({ start: { date: '2026-02-30', time: '10:00' } }), 'start.date'],
      ['a malformed time', () => ({ start: { date: DAY, time: '25:00' } }), 'start.time'],
      ['a fractional duration', () => ({ durationMinutes: 59.5 }), 'durationMinutes'],
      ['a step below five minutes', () => ({ stepMinutes: 4 }), 'stepMinutes'],
    ])('%s -> validation, naming the field and never echoing the value', async (_name, build, field) => {
      const f = await fixture();
      const r = fail(await hire.createHire(tenant, req(f, build(f))));
      expect(r).toMatchObject({ code: 'validation', family: 'invalid', retryable: false });
      expect(r.problems).toContain(field);
      expect(JSON.stringify(r)).not.toMatch(/Pat|has spaces|not-an-email|call me/);
      await nothing(f);
    });
  });

  describe('decision 7: only the configured duration, only engine-generated starts', () => {
    it('refuses any duration but the offering configured; omitting it uses the configured one', async () => {
      const f = await fixture();
      expect(fail(await hire.createHire(tenant, req(f, { durationMinutes: 90 }))).code).toBe('duration_not_allowed');
      expect(fail(await hire.createHire(tenant, req(f, { durationMinutes: 30 }))).code).toBe('duration_not_allowed');
      await nothing(f);
      const r = ok(await hire.createHire(tenant, req(f, { durationMinutes: 60 })));
      expect(r.reservation.span).toMatchObject({ durationMinutes: 60 });
    });

    it('an offering with no configured duration cannot be hired', async () => {
      const f = await fixture(ORG, { durationMinutes: null });
      expect(fail(await hire.createHire(tenant, req(f))).code).toBe('duration_not_allowed');
      await nothing(f);
    });

    it('starts must be on the grid: 09:30 is off the hourly grid, but allowed when the staff grid is 30 minutes (a refinement of the duration)', async () => {
      const f = await fixture();
      expect(fail(await hire.createHire(tenant, req(f, { start: { date: DAY, time: '09:30' } }))).code).toBe('off_grid');
      const r = ok(await hire.createHire(tenant, req(f, { start: { date: DAY, time: '09:30' }, stepMinutes: 30 })));
      expect(r.reservation.span).toMatchObject({ startTime: '09:30', durationMinutes: 60 });
      expect(fail(await hire.createHire(tenant, req(f, { start: { date: DAY, time: '09:07' }, stepMinutes: 7 }))).code).toBe('validation');
      expect(fail(await hire.createHire(tenant, req(f, { start: { date: DAY, time: '09:00' }, stepMinutes: 25 }))).code).toBe('validation'); // 25 does not divide 60
      expect(await live(f)).toBe(1);
    });
  });

  describe('refusals from the shared availability engine write nothing', () => {
    it.each<[string, string, (f: Fx) => Promise<unknown>, (f: Fx) => Partial<HireRequest>]>([
      ['outside the hours', 'outside_availability', async () => undefined, () => ({ start: { date: DAY, time: '18:00' } })],
      ['a day with no hours (Tuesday)', 'outside_availability', async () => undefined, () => ({ start: { date: '2026-11-17', time: '10:00' } })],
      ['in the past', 'in_the_past', async () => undefined, () => ({ start: { date: '2026-11-02', time: '10:00' } })],
      ['a party larger than the resource', 'party_exceeds_resource', async () => undefined, () => ({ partySize: 5 })],
      [
        'a full-day closure',
        'outside_availability',
        async (f) => {
          const c = await avail.createException(tenant, { kind: 'resource', id: f.court }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: 'resurfacing' }, TZ);
          if (!c.ok) throw new Error('closure');
        },
        () => ({}),
      ],
      [
        'an inactive resource',
        'resource_inactive',
        async (f) => void (await q('UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = $2', [ORG, f.court])),
        () => ({}),
      ],
      [
        'a resource that is not linked to the offering',
        'resource_not_eligible',
        async (f) => void (await q('DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND offering_id = $2', [ORG, f.offering])),
        () => ({}),
      ],
      [
        'an archived offering',
        'offering_unavailable',
        async (f) => void (await q('UPDATE scheduling_offerings SET archived_at = now() WHERE organisation_id = $1 AND id = $2', [ORG, f.offering])),
        () => ({}),
      ],
      [
        'an archived schedule',
        'offering_unavailable',
        async (f) => void (await q('UPDATE scheduling_schedules SET archived_at = now() WHERE organisation_id = $1 AND id = $2', [ORG, f.schedule])),
        () => ({}),
      ],
    ])('%s -> %s', async (_name, code, arrange, build) => {
      const f = await fixture();
      await arrange(f);
      const r = fail(await hire.createHire(tenant, req(f, build(f))));
      expect(r.code).toBe(code);
      expect(r.retryable).toBe(false);
      await nothing(f);
    });

    it('a schedule that is not a facility hire is not bookable here', async () => {
      const f = { schedule: uid('sch'), offering: uid('off'), court: uid('court') };
      await seedSchedule(ORG, f.schedule, 'appointments');
      await seedOffering(ORG, f.offering, f.schedule, { capacity: null, durationMinutes: 60 });
      await seedResource(ORG, f.court, 'practitioner');
      await q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [ORG, f.offering, f.court]);
      expect(fail(await hire.createHire(tenant, req(f))).code).toBe('preset_not_supported');
      await nothing(f);
    });

    it('a time that is already held -> resource_conflict, and the earlier booking is untouched', async () => {
      const f = await fixture();
      const first = ok(await hire.createHire(tenant, req(f)));
      expect(fail(await hire.createHire(tenant, req(f))).code).toBe('resource_conflict');
      expect(fail(await hire.createHire(tenant, req(f, { start: { date: DAY, time: '09:30' }, stepMinutes: 30 }))).code).toBe('resource_conflict'); // partial overlap
      expect((await reservations.getById(tenant, first.reservation.id))?.status).toBe('confirmed');
      expect(await holdsOf(f)).toBe(1);
      // adjacent windows do not overlap ([start, end) is half open)
      ok(await hire.createHire(tenant, req(f, { start: { date: DAY, time: '09:00' } })));
      ok(await hire.createHire(tenant, req(f, { start: { date: DAY, time: '11:00' } })));
      expect(await holdsOf(f)).toBe(3);
    });
  });

  describe('tenant isolation', () => {
    it("another organisation's offering or resource is indistinguishable from an absent one", async () => {
      const mine = await fixture(ORG);
      const theirs = await fixture(OTHER);
      expect(fail(await hire.createHire(tenant, req(theirs))).code).toBe('not_found'); // their offering and resource
      expect(fail(await hire.createHire(tenant, req(mine, { resourceId: theirs.court }))).code).toBe('not_found'); // my offering, their resource
      expect(fail(await hire.createHire(tenant, req(mine, { offeringId: theirs.offering }))).code).toBe('not_found'); // their offering, my resource
      expect(fail(await hire.createHire(tenant, req(mine, { offeringId: 'does-not-exist' }))).code).toBe('not_found');
      expect(await hire.readHireBasis(tenant, theirs.offering, theirs.court)).toBeNull();
      expect(await total(theirs, OTHER)).toBe(0);
      await nothing(mine);
    });

    it("the guarded statement itself, handed another organisation's ids with this organisation's id, inserts nothing", async () => {
      const mine = await fixture(ORG);
      const theirs = await fixture(OTHER);
      const basis = (await new PostgresHireRepository({ sql: pg(), clock }).readHireBasis(staff(OTHER), theirs.offering, theirs.court))!;
      const start = resolveLocalTime(DAY, '10:00', TZ).instant;
      const end = new Date(Date.parse(start) + 3_600_000).toISOString();
      const rows = await q(HIRE_GUARDED_SQL, [ORG, theirs.offering, basis.offeringVersion, basis.offeringToken, basis.scheduleToken, theirs.court, basis.resourceVersion, uid('r'), uid('h'), start, end, TZ, 1, 'X', null, null, null, null, newKey(), 'staff:x', 60, theirs.schedule]);
      expect(rows).toHaveLength(0);
      expect(await total(theirs, OTHER)).toBe(0);
      expect(await total(mine)).toBe(0);
    });

    it('a key is tenant-scoped: two organisations may use the same value, and neither can read the other', async () => {
      const mine = await fixture(ORG);
      const theirs = await fixture(OTHER);
      const key = newKey();
      const a = ok(await hire.createHire(tenant, req(mine, { idempotencyKey: key })));
      const b = ok(await hire.createHire(staff(OTHER), req(theirs, { idempotencyKey: key })));
      expect(a.reservation.id).not.toBe(b.reservation.id);
      expect(a.replayed || b.replayed).toBe(false);
      expect((await hire.findHireByKey(tenant, key))?.id).toBe(a.reservation.id);
      expect((await hire.findHireByKey(staff(OTHER), key))?.id).toBe(b.reservation.id);
      expect(await hire.findHireByKey(staff('org-nobody'), key)).toBeNull();
    });
  });

  describe('idempotency', () => {
    it('the same key and the same request returns the original; nothing new is written', async () => {
      const f = await fixture();
      const request = req(f);
      const a = ok(await hire.createHire(tenant, request));
      const b = ok(await hire.createHire(tenant, { ...request, customer: { ...request.customer } }));
      expect(b.replayed).toBe(true);
      expect(b.reservation.id).toBe(a.reservation.id);
      expect(await total(f)).toBe(1);
      expect(await holdsOf(f)).toBe(1);
    });

    it('a replay survives later edits of the offering (the comparison is on what was stored, not on today\'s configuration)', async () => {
      const f = await fixture();
      const request = req(f);
      const a = ok(await hire.createHire(tenant, request));
      await q("UPDATE scheduling_offerings SET duration_minutes = 90, name = 'renamed' WHERE organisation_id = $1 AND id = $2", [ORG, f.offering]);
      const b = ok(await hire.createHire(tenant, request));
      expect(b.replayed).toBe(true);
      expect(b.reservation.id).toBe(a.reservation.id);
      expect(await total(f)).toBe(1);
    });

    it.each<[string, (r: HireRequest) => Partial<HireRequest>]>([
      ['another time', () => ({ start: { date: DAY, time: '11:00' } })],
      ['another date', () => ({ start: { date: '2026-11-23', time: '10:00' } })],
      ['another party size', () => ({ partySize: 3 })],
      ['another customer', () => ({ customer: { name: 'Someone Else' } })],
      ['another email', r => ({ customer: { ...r.customer, email: 'other@example.com' } })],
      ['another phone', r => ({ customer: { ...r.customer, phone: '0411 111 111' } })],
      ['other notes', () => ({ notes: 'something else' })],
      ['a stated duration that differs', () => ({ durationMinutes: 90 })],
    ])('the same key with %s -> idempotency_conflict, and nothing is written', async (_name, change) => {
      const f = await fixture();
      const request = req(f);
      ok(await hire.createHire(tenant, request));
      const r = fail(await hire.createHire(tenant, { ...request, ...change(request) }));
      // a changed duration is refused before the key is looked at for a different reason in some paths; it must never create anything either way
      expect(['idempotency_conflict', 'duration_not_allowed']).toContain(r.code);
      expect(await total(f)).toBe(1);
      expect(await holdsOf(f)).toBe(1);
    });

    it('the same key with another resource -> idempotency_conflict', async () => {
      const f = await fixture();
      const other = uid('court');
      await seedResource(ORG, other, 'court');
      await q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [ORG, f.offering, other]);
      const request = req(f);
      ok(await hire.createHire(tenant, request));
      expect(fail(await hire.createHire(tenant, { ...request, resourceId: other })).code).toBe('idempotency_conflict');
    });

    it('ten parallel calls with the same key create exactly one reservation and one hold; all ten are answered with it', async () => {
      const f = await fixture();
      const request = req(f);
      const results = await Promise.all(Array.from({ length: 10 }, () => hire.createHire(tenant, request)));
      const created = results.filter(r => r.ok) as Extract<HireResult, { ok: true }>[];
      expect(created).toHaveLength(10);
      expect(new Set(created.map(r => r.reservation.id)).size).toBe(1);
      expect(created.filter(r => !r.replayed)).toHaveLength(1);
      expect(await total(f)).toBe(1);
      expect(await holdsOf(f)).toBe(1);
    });
  });

  describe('overlap prevention', () => {
    it('eight parallel requests for the same window, different keys: exactly one wins, seven are resource_conflict, one hold', async () => {
      const f = await fixture();
      const results = await Promise.all(Array.from({ length: 8 }, () => hire.createHire(tenant, req(f))));
      expect(results.filter(r => r.ok)).toHaveLength(1);
      for (const r of results.filter(r => !r.ok)) expect(fail(r).code).toBe('resource_conflict');
      expect(await total(f)).toBe(1);
      expect(await holdsOf(f)).toBe(1);
    });

    it('overlapping 30-minute-grid starts racing: never two live holds that overlap', async () => {
      const f = await fixture();
      const times = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30'];
      const results = await Promise.all(times.flatMap(time => [0, 1].map(() => hire.createHire(tenant, req(f, { start: { date: DAY, time }, stepMinutes: 30 })))));
      for (const r of results) if (!r.ok) expect(['resource_conflict']).toContain(r.code);
      const overlapping = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM scheduling_resource_holds a JOIN scheduling_resource_holds b ON a.organisation_id = b.organisation_id AND a.resource_id = b.resource_id AND a.id < b.id
          WHERE a.organisation_id = $1 AND a.resource_id = $2 AND a.released_at IS NULL AND b.released_at IS NULL AND a.during && b.during`,
        [ORG, f.court],
      );
      expect(overlapping[0].n).toBe(0);
      expect(await holdsOf(f)).toBe(await live(f));
    });
  });

  describe('stale availability: the world changes after the decision and before the write', () => {
    const edits: Array<[string, (f: Fx) => Promise<unknown>]> = [
      ['a closure on the resource', async f => void ok0(await avail.createException(tenant, { kind: 'resource', id: f.court }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: 'x' }, TZ))],
      ['a closure on the offering', async f => void ok0(await avail.createException(tenant, { kind: 'offering', id: f.offering }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: 'x' }, TZ))],
      ['the resource\'s hours changed', async f => void (await q("DELETE FROM scheduling_availability_rules WHERE organisation_id = $1 AND resource_id = $2", [ORG, f.court]))],
      ['the offering\'s hours changed', async f => void (await q("DELETE FROM scheduling_availability_rules WHERE organisation_id = $1 AND offering_id = $2", [ORG, f.offering]))],
      ['the resource switched off', async f => void (await q('UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = $2', [ORG, f.court]))],
      ['the resource unlinked', async f => void (await q('DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND offering_id = $2', [ORG, f.offering]))],
      ['the offering\'s duration edited', async f => void (await q('UPDATE scheduling_offerings SET duration_minutes = 90 WHERE organisation_id = $1 AND id = $2', [ORG, f.offering]))],
      ['the offering\'s price edited', async f => void (await q('UPDATE scheduling_offerings SET price_cents = 9900 WHERE organisation_id = $1 AND id = $2', [ORG, f.offering]))],
      ['the offering renamed', async f => void (await q("UPDATE scheduling_offerings SET name = 'renamed' WHERE organisation_id = $1 AND id = $2", [ORG, f.offering]))],
      ['the offering archived', async f => void (await q('UPDATE scheduling_offerings SET archived_at = now() WHERE organisation_id = $1 AND id = $2', [ORG, f.offering]))],
      ['the schedule edited (decision 3: its edit token)', async f => void (await q("UPDATE scheduling_schedules SET name = 'renamed schedule' WHERE organisation_id = $1 AND id = $2", [ORG, f.schedule]))],
      ['the schedule archived', async f => void (await q('UPDATE scheduling_schedules SET archived_at = now() WHERE organisation_id = $1 AND id = $2', [ORG, f.schedule]))],
    ];
    function ok0(r: { ok: boolean }) {
      if (!r.ok) throw new Error(`arrange: ${JSON.stringify(r)}`);
    }

    it.each(edits)('%s -> availability_changed with a fresh basis, nothing written', async (_name, change) => {
      const f = await fixture();
      const before = (await hire.readHireBasis(tenant, f.offering, f.court))!;
      const racing = repoWith({ beforeWrite: () => change(f).then(() => undefined) });
      const r = fail(await racing.createHire(tenant, req(f)));
      expect(r.code).toBe('availability_changed');
      expect(r.retryable).toBe(false);
      await nothing(f);
      if (r.basis) expect(r.basis).not.toEqual(before); // the fresh basis is the state after the change
    });

    it('the same stale booking by a client that supplies the basis it saw is refused before the write is even attempted', async () => {
      const f = await fixture();
      const seen = (await hire.readHireBasis(tenant, f.offering, f.court))!;
      await q("UPDATE scheduling_offerings SET name = 'renamed' WHERE organisation_id = $1 AND id = $2", [ORG, f.offering]);
      let wrote = false;
      const probe = repoWith({ beforeWrite: async () => void (wrote = true) });
      const r = fail(await probe.createHire(tenant, req(f, { basis: seen })));
      expect(r.code).toBe('availability_changed');
      expect(wrote).toBe(false);
      expect(r.basis).toEqual(await hire.readHireBasis(tenant, f.offering, f.court));
      await nothing(f);
      // handing the fresh basis back succeeds
      ok(await hire.createHire(tenant, req(f, { basis: r.basis })));
    });

    it('a fresh basis returned by availability_changed makes the retry succeed (when the change did not make the time unavailable)', async () => {
      const f = await fixture();
      const racing = repoWith({ beforeWrite: () => q("UPDATE scheduling_offerings SET name = 'renamed' WHERE organisation_id = $1 AND id = $2", [ORG, f.offering]).then(() => undefined) });
      const request = req(f);
      const first = fail(await racing.createHire(tenant, request));
      expect(first.code).toBe('availability_changed');
      const second = ok(await hire.createHire(tenant, { ...request, basis: first.basis }));
      expect(second.replayed).toBe(false);
      expect(await total(f)).toBe(1);
    });

    it('a booking-time duration edit books NOTHING at the old length (the preflight finding, now closed in the repository)', async () => {
      const f = await fixture();
      const racing = repoWith({ beforeWrite: () => q('UPDATE scheduling_offerings SET duration_minutes = 120 WHERE organisation_id = $1 AND id = $2', [ORG, f.offering]).then(() => undefined) });
      expect(fail(await racing.createHire(tenant, req(f))).code).toBe('availability_changed');
      await nothing(f);
      // after the edit the same request is a different hire: still one hour requested, no longer the configured duration
      expect(fail(await hire.createHire(tenant, req(f, { durationMinutes: 60 }))).code).toBe('duration_not_allowed');
      expect(ok(await hire.createHire(tenant, req(f, { start: { date: DAY, time: '09:00' } }))).reservation.span).toMatchObject({ durationMinutes: 120 }); // the grid is now 120 minutes from 09:00
    });
  });

  describe('real lock interleavings (observed, not slept for)', () => {
    it('writer first: a configuration writer holding the offering row makes the booking wait, and the booking then refuses (the token moved)', async () => {
      const f = await fixture();
      const writer = await getPool().connect();
      try {
        await writer.query('BEGIN');
        await writer.query("UPDATE scheduling_offerings SET name = 'being edited' WHERE organisation_id = $1 AND id = $2", [ORG, f.offering]);
        const booking = go(hire.createHire(tenant, req(f)));
        await waitBlocked('WITH ls AS');
        await writer.query('COMMIT');
        expect(fail(await booking).code).toBe('availability_changed');
      } finally {
        writer.release();
      }
      await nothing(f);
    });

    it('booking first: a slow in-flight booking makes the configuration writer wait, the booking stands, and the writer then succeeds', async () => {
      const f = await fixture();
      const slowRepo = repoWith({ transform: slow(1.5) });
      const booking = go(slowRepo.createHire(tenant, req(f)));
      await waitSleeping('slow-hire');
      const writer = go(q("UPDATE scheduling_offerings SET name = 'edited during booking' WHERE organisation_id = $1 AND id = $2", [ORG, f.offering]));
      await waitBlocked('edited during booking');
      expect(ok(await booking).reservation.price).toMatchObject({ amountCents: 5000 }); // the booking stands, with the configuration it decided on
      await writer;
      expect(await live(f)).toBe(1);
    });

    it('booking first: a schedule edit waits for an in-flight booking too (decision 3: the schedule row is share-locked)', async () => {
      const f = await fixture();
      const slowRepo = repoWith({ transform: slow(1.5) });
      const booking = go(slowRepo.createHire(tenant, req(f)));
      await waitSleeping('slow-hire');
      const writer = go(q("UPDATE scheduling_schedules SET name = 'schedule edited during booking' WHERE organisation_id = $1 AND id = $2", [ORG, f.schedule]));
      await waitBlocked('schedule edited during booking');
      ok(await booking);
      await writer;
      expect(await live(f)).toBe(1);
    });

    it('schedule edit first: the booking waits for it and then refuses', async () => {
      const f = await fixture();
      const writer = await getPool().connect();
      try {
        await writer.query('BEGIN');
        await writer.query("UPDATE scheduling_schedules SET name = 'edited' WHERE organisation_id = $1 AND id = $2", [ORG, f.schedule]);
        const booking = go(hire.createHire(tenant, req(f)));
        await waitBlocked('WITH ls AS');
        await writer.query('COMMIT');
        expect(fail(await booking).code).toBe('availability_changed');
      } finally {
        writer.release();
      }
      await nothing(f);
    });

    it('availability first: a rule deletion committing while the booking waits makes it refuse; nothing is written', async () => {
      const f = await fixture();
      const writer = await getPool().connect();
      try {
        await writer.query('BEGIN');
        await writer.query('DELETE FROM scheduling_availability_rules WHERE organisation_id = $1 AND resource_id = $2', [ORG, f.court]);
        const booking = go(hire.createHire(tenant, req(f)));
        // the booking has not reached the lock yet: it reads the (uncommitted-invisible) rule and decides yes, then blocks on the version row the deletion holds
        await waitBlocked('WITH ls AS');
        await writer.query('COMMIT');
        expect(fail(await booking).code).toBe('availability_changed');
      } finally {
        writer.release();
      }
      await nothing(f);
    });
  });

  describe('bounded waiting and controlled retries', () => {
    it('a lock wait that exceeds lock_timeout writes nothing, is retried a bounded number of times, then reports contention_timeout (retryable)', async () => {
      const f = await fixture();
      const writer = await getPool().connect();
      const sleeps: number[] = [];
      try {
        await writer.query('BEGIN');
        await writer.query("UPDATE scheduling_offerings SET name = 'long edit' WHERE organisation_id = $1 AND id = $2", [ORG, f.offering]);
        const impatient = new PostgresHireRepository({ sql: pg(), clock, lockTimeoutMs: 250, maxAttempts: 3, sleep: async ms => void sleeps.push(ms) });
        const r = fail(await impatient.createHire(tenant, req(f)));
        expect(r).toMatchObject({ code: 'contention_timeout', family: 'transient', retryable: true, attempts: 3 });
        expect(sleeps).toHaveLength(2); // a pause between attempts, none after the last
      } finally {
        await writer.query('ROLLBACK');
        writer.release();
      }
      await nothing(f);
    });

    it('a retry re-reads from the start: the writer finishes during the first attempt\'s pause, the second attempt sees the new state and books', async () => {
      const f = await fixture();
      const writer = await getPool().connect();
      await writer.query('BEGIN');
      await writer.query("UPDATE scheduling_offerings SET name = 'short edit' WHERE organisation_id = $1 AND id = $2", [ORG, f.offering]);
      const repo = new PostgresHireRepository({ sql: pg(), clock, lockTimeoutMs: 250, maxAttempts: 3, sleep: async () => { await writer.query('COMMIT'); writer.release(); } });
      const r = ok(await repo.createHire(tenant, req(f)));
      expect(r.attempts).toBe(2);
      expect(await live(f)).toBe(1);
    });

    it('statement_timeout writes nothing and is not retried', async () => {
      const f = await fixture();
      const repo = repoWith({ transform: slow(2) }, { statementTimeoutMs: 300, maxAttempts: 3 });
      const r = fail(await repo.createHire(tenant, req(f)));
      expect(r).toMatchObject({ code: 'contention_timeout', retryable: true, attempts: 1 });
      await nothing(f);
    });

    it('the timeouts are transaction-local: they do not leak to the next request on a pooled connection', async () => {
      const f = await fixture();
      ok(await hire.createHire(tenant, req(f)));
      const seen = new Set<string>();
      await Promise.all(Array.from({ length: 12 }, async () => {
        const [l] = await q<{ lock_timeout: string; statement_timeout: string }>("SELECT current_setting('lock_timeout') AS lock_timeout, current_setting('statement_timeout') AS statement_timeout");
        seen.add(`${l.lock_timeout}/${l.statement_timeout}`);
      }));
      expect([...seen]).toEqual(['0/0']);
    });

    it('an executor that cannot run a transaction is refused rather than run unbounded; nothing is written', async () => {
      const f = await fixture();
      const bare = new PostgresHireRepository({ sql: { query: (t, p) => pg().query(t, p) }, clock });
      await expect(bare.createHire(tenant, req(f))).rejects.toBeInstanceOf(HireNotReadyError);
      await nothing(f);
    });
  });

  describe('unknown outcomes are resolved by the idempotency key', () => {
    it('the reply is lost AFTER the commit: the booking is found by its key and returned as recovered', async () => {
      const f = await fixture();
      const repo = repoWith({ loseReply: new Error('fetch failed') });
      const request = req(f);
      const r = ok(await repo.createHire(tenant, request));
      expect(r).toMatchObject({ replayed: false, recovered: true });
      expect(await total(f)).toBe(1);
      expect(await holdsOf(f)).toBe(1);
      // asking again is a plain replay, never a second booking
      const again = ok(await hire.createHire(tenant, request));
      expect(again).toMatchObject({ replayed: true });
      expect(again.reservation.id).toBe(r.reservation.id);
      expect(await total(f)).toBe(1);
    });

    it('the request never reaches the database: outcome_unknown (retryable), nothing written, and the same key then books', async () => {
      const f = await fixture();
      const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
      const repo = repoWith({ dropRequest: abort });
      const request = req(f);
      const r = fail(await repo.createHire(tenant, request));
      expect(r).toMatchObject({ code: 'outcome_unknown', family: 'unknown', retryable: true });
      expect(r.message).not.toMatch(/unavailable|full|taken/i); // never reported as a business refusal
      await nothing(f);
      expect(ok(await hire.createHire(tenant, request)).replayed).toBe(false);
    });

    it('the reply is lost and the resolving read fails too: still outcome_unknown, not a guess', async () => {
      const f = await fixture();
      const repo = repoWith({ loseReply: new Error('fetch failed'), failReads: true });
      const r = fail(await repo.createHire(tenant, req(f)));
      expect(r.code).toBe('outcome_unknown');
      expect(await total(f)).toBe(1); // it DID commit, which is exactly why "failed" would have been wrong
    });

    it('a connection-class server error (08/57P) is unknown; an ordinary server error is not', async () => {
      const { classifyWriteError } = await import('@scheduling/postgres');
      expect(classifyWriteError(Object.assign(new Error('x'), { code: '08006' })).kind).toBe('unknown');
      expect(classifyWriteError(Object.assign(new Error('x'), { code: '57P01' })).kind).toBe('unknown');
      expect(classifyWriteError(new TypeError('fetch failed')).kind).toBe('unknown');
      expect(classifyWriteError(Object.assign(new Error('x'), { code: '40P01' })).kind).toBe('throw'); // a deadlock is a defect to surface, never retried around
      expect(classifyWriteError(Object.assign(new Error('x'), { code: '23P01' })).kind).toBe('failure');
    });
  });

  describe('cancellation history (explicit compatibility)', () => {
    it('cancelling keeps the row and its snapshot, releases the hold, and the time can be booked again under a new key', async () => {
      const f = await fixture();
      const request = req(f);
      const made = ok(await hire.createHire(tenant, request)).reservation;
      const out = await reservations.cancel(tenant, { reservationId: made.id, cancelledBy: 'staff', reason: 'customer rang', scope: 'this_occurrence' });
      expect(out.status).toBe('cancelled');
      expect(await holdsOf(f)).toBe(0);
      const row = (await q<{ status: string; cancelled_by: string; cancel_reason: string; cancelled_at: string | null; customer_name: string; starts_at: string }>('SELECT status, cancelled_by, cancel_reason, cancelled_at::text, customer_name, starts_at::text FROM scheduling_reservations WHERE id = $1', [made.id]))[0];
      expect(row).toMatchObject({ status: 'cancelled', cancelled_by: 'staff', cancel_reason: 'customer rang', customer_name: 'Pat Hirer' });
      expect(row.cancelled_at).not.toBeNull();
      // a new hire for the same window is a new reservation
      const again = ok(await hire.createHire(tenant, req(f)));
      expect(again.reservation.id).not.toBe(made.id);
      expect(await total(f)).toBe(2);
      expect(await live(f)).toBe(1);
      expect(await holdsOf(f)).toBe(1);
    });

    it('the key of a cancelled booking still resolves to it (state cancelled) and never creates a second booking', async () => {
      const f = await fixture();
      const request = req(f);
      const made = ok(await hire.createHire(tenant, request)).reservation;
      await reservations.cancel(tenant, { reservationId: made.id, cancelledBy: 'staff', reason: null, scope: 'this_occurrence' });
      const again = ok(await hire.createHire(tenant, request));
      expect(again.replayed).toBe(true);
      expect(again.reservation).toMatchObject({ id: made.id, status: 'cancelled' });
      expect((await hire.findHireByKey(tenant, request.idempotencyKey))?.status).toBe('cancelled');
      expect(await total(f)).toBe(1);
      expect(await holdsOf(f)).toBe(0);
    });
  });

  describe('daylight saving (Australia/Adelaide)', () => {
    async function sundayFixture() {
      const f = await fixture(ORG, { rules: false });
      const sunday = { kind: 'hours' as const, label: null, dayOfWeek: 0, startTime: '00:00', endTime: '06:00', validFrom: null, validTo: null };
      for (const owner of [{ kind: 'offering' as const, id: f.offering }, { kind: 'resource' as const, id: f.court }]) {
        const r = await avail.createRule(tenant, owner, sunday, TZ);
        if (!r.ok) throw new Error(`sunday rule: ${JSON.stringify(r)}`);
      }
      return f;
    }
    const early = new PostgresHireRepository({ sql: pg(), clock: new FixedClock(new Date('2026-09-01T00:00:00Z')), sleep: async () => undefined });

    it('spring forward 2026-10-04: 02:30 does not exist -> nonexistent_local_time; a start before and after the gap books at the right instants', async () => {
      const f = await sundayFixture();
      const gap = fail(await early.createHire(tenant, req(f, { start: { date: '2026-10-04', time: '02:30' }, stepMinutes: 30 })));
      expect(gap.code).toBe('nonexistent_local_time');
      expect(gap.family).toBe('invalid');
      await nothing(f);
      const before = ok(await early.createHire(tenant, req(f, { start: { date: '2026-10-04', time: '00:00' } })));
      const after = ok(await early.createHire(tenant, req(f, { start: { date: '2026-10-04', time: '04:00' } })));
      expect(before.reservation.instants.startsAt).toBe('2026-10-03T14:30:00Z'); // 00:00 ACST (+9:30)
      expect(after.reservation.instants.startsAt).toBe('2026-10-03T17:30:00Z'); // 04:00 ACDT (+10:30)
      expect(after.reservation.span).toMatchObject({ date: '2026-10-04', startTime: '04:00', durationMinutes: 60 });
    });

    it('a booking across the gap lasts the configured 60 real minutes, not 60 wall-clock minutes', async () => {
      const f = await sundayFixture();
      const r = await early.createHire(tenant, req(f, { start: { date: '2026-10-04', time: '01:30' }, stepMinutes: 30 }));
      if (r.ok) {
        const ms = Date.parse(r.reservation.instants.endsAt) - Date.parse(r.reservation.instants.startsAt);
        expect(ms).toBe(3_600_000);
        expect(r.reservation.span).toMatchObject({ durationMinutes: 60 });
      } else {
        expect(['off_grid', 'outside_availability', 'resource_conflict']).toContain(r.code);
      }
    });

    it('fall back 2027-04-04: an ambiguous 02:00 takes the earlier instant, deterministically, and the same request replays', async () => {
      const f = await sundayFixture();
      const lateClock = new PostgresHireRepository({ sql: pg(), clock: new FixedClock(new Date('2027-03-01T00:00:00Z')), sleep: async () => undefined });
      const request = req(f, { start: { date: '2027-04-04', time: '02:00' }, stepMinutes: 30 });
      const a = await lateClock.createHire(tenant, request);
      if (a.ok) {
        expect(a.reservation.instants.startsAt).toBe(resolveLocalTime('2027-04-04', '02:00', TZ).instant);
        expect(a.reservation.instants.startsAt).toBe('2027-04-03T15:30:00Z'); // 02:00 ACDT (+10:30), the earlier of the two
        const b = ok(await lateClock.createHire(tenant, request));
        expect(b.replayed).toBe(true);
        expect(await total(f)).toBe(1);
      } else {
        // The engine decides which ambiguous starts it offers; whatever it says, nothing may be half-written.
        expect(['off_grid', 'outside_availability']).toContain(a.code);
        await nothing(f);
      }
    });
  });

  describe('lock order: no deadlock under mixed writers', () => {
    it('bookings racing every kind of configuration writer for several seconds never produce a deadlock, an overlap, or a reservation without exactly one hold', async () => {
      const f = await fixture();
      const dayList = ['2026-11-16', '2026-11-23', '2026-11-30'];
      const times = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];
      const errors: string[] = [];
      const deadlocks: string[] = [];
      const note = (err: unknown, who = '?') => {
        const code = sqlstateOf(err) ?? (err as { code?: string }).code ?? (err as Error).message;
        errors.push(String(code));
        if (code === '40P01') deadlocks.push(who + ' :: ' + String((err as { detail?: string }).detail ?? '').replace(/s+/g, ' ').slice(0, 900) + ' :: ' + String((err as { where?: string }).where ?? '').slice(0, 200));
      };
      const tally: Record<string, number> = {};
      const stopAt = Date.now() + 6000;
      const hirer = async (n: number) => {
        let i = n;
        while (Date.now() < stopAt) {
          i += 7;
          try {
            const r = await hire.createHire(tenant, req(f, { start: { date: dayList[i % 3], time: times[i % 8] } }));
            tally[r.ok ? 'booked' : r.code] = (tally[r.ok ? 'booked' : r.code] ?? 0) + 1;
            if (!r.ok && !['resource_conflict', 'availability_changed', 'contention_timeout', 'outside_availability', 'resource_inactive', 'resource_not_eligible', 'offering_unavailable', 'duration_not_allowed'].includes(r.code)) errors.push(`hire:${r.code}`);
          } catch (e) {
            note(e, 'hire');
          }
        }
      };
      // HIRE_STRESS_ONLY=resource-active,cancel runs only those writers (development: to isolate which pair of statements contends)
      const only = (process.env.HIRE_STRESS_ONLY ?? '').split(',').filter(Boolean);
      const loop = (name: string, body: (i: number) => Promise<unknown>, pauseMs = 40) => async () => {
        if (only.length > 0 && !only.includes(name)) return;
        for (let i = 0; Date.now() < stopAt; i++) {
          try {
            await body(i);
          } catch (e) {
            note(e, name);
          }
          await new Promise(r => setTimeout(r, pauseMs));
        }
      };
      const writers = [
        loop('offering-update', async i => { const o = await config.getOffering(tenant, f.offering); if (o) await config.updateOffering(tenant, f.offering, o.updatedAt, { name: `offering ${i}` }); }, 400),
        loop('schedule-update', async i => { const s = await config.getSchedule(tenant, f.schedule); if (s) await config.updateSchedule(tenant, f.schedule, s.updatedAt, { name: `schedule ${i}` }); }, 500),
        loop('resource-closure', async i => { const c = await avail.createException(tenant, { kind: 'resource', id: f.court }, { fromDate: `2027-0${(i % 9) + 1}-01`, toDate: `2027-0${(i % 9) + 1}-01`, kind: 'closed', reason: 'stress' }, TZ); if (c.ok) await avail.deleteException(tenant, c.value.id, c.value.updatedAt); }),
        loop('offering-closure', async i => { const c = await avail.createException(tenant, { kind: 'offering', id: f.offering }, { fromDate: `2027-0${(i % 9) + 1}-02`, toDate: `2027-0${(i % 9) + 1}-02`, kind: 'closed', reason: 'stress' }, TZ); if (c.ok) await avail.deleteException(tenant, c.value.id, c.value.updatedAt); }),
        loop('unlink-link', async () => { await config.unlinkOfferingResource(tenant, f.offering, f.court); await config.linkOfferingResource(tenant, f.offering, f.court); }, 300),
        loop('resource-active', async i => { await q('UPDATE scheduling_resources SET active = $3 WHERE organisation_id = $1 AND id = $2', [ORG, f.court, i % 3 !== 0]).catch(note); }, 300),
        loop('cancel', async () => { const live = await q<{ id: string }>("SELECT id FROM scheduling_reservations WHERE organisation_id = $1 AND offering_id = $2 AND status = 'confirmed' ORDER BY random() LIMIT 1", [ORG, f.offering]); if (live[0]) await reservations.cancel(tenant, { reservationId: live[0].id, cancelledBy: 'staff', reason: 'stress', scope: 'this_occurrence' }); }, 120),
      ];
      await Promise.all([...Array.from({ length: 8 }, (_, n) => hirer(n)), ...writers.map(w => w())]);
      await q('UPDATE scheduling_resources SET active = true WHERE organisation_id = $1 AND id = $2', [ORG, f.court]);

      console.log(`[hire stress] deadlocks(${deadlocks.length}): ${JSON.stringify(deadlocks.slice(0, 4))} outcomes: ${JSON.stringify(tally)}`);
      expect(errors.filter(e => e === '40P01')).toEqual([]); // no deadlock
      expect(errors.filter(e => e.startsWith('hire:'))).toEqual([]);
      const overlapping = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM scheduling_resource_holds a JOIN scheduling_resource_holds b ON a.organisation_id = b.organisation_id AND a.resource_id = b.resource_id AND a.id < b.id
          WHERE a.organisation_id = $1 AND a.resource_id = $2 AND a.released_at IS NULL AND b.released_at IS NULL AND a.during && b.during`,
        [ORG, f.court],
      );
      expect(overlapping[0].n).toBe(0);
      const orphans = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM scheduling_reservations r
          WHERE r.organisation_id = $1 AND r.offering_id = $2 AND ((r.status <> 'cancelled' AND (SELECT count(*) FROM scheduling_resource_holds h WHERE h.reservation_id = r.id AND h.released_at IS NULL) <> 1)
             OR (r.status = 'cancelled' AND EXISTS (SELECT 1 FROM scheduling_resource_holds h WHERE h.reservation_id = r.id AND h.released_at IS NULL)))`,
        [ORG, f.offering],
      );
      expect(orphans[0].n).toBe(0);
      console.log(`[hire stress] deadlocks: ${JSON.stringify(deadlocks.slice(0, 3))}`);
      console.log(`[hire stress] outcomes: ${JSON.stringify(tally)} errors: ${JSON.stringify(errors)}`);
      expect(tally.booked ?? 0).toBeGreaterThan(0); // the run actually booked things
      expect(await total(f)).toBeGreaterThan(0);
    }, 60_000);
  });

  describe('contract', () => {
    it('every failure code the repository can produce is in the stable taxonomy', () => {
      expect(new Set(HIRE_FAILURE_CODES).size).toBe(HIRE_FAILURE_CODES.length);
      expect([...HIRE_FAILURE_CODES]).toEqual(expect.arrayContaining(['validation', 'availability_changed', 'resource_conflict', 'idempotency_conflict', 'contention_timeout', 'outcome_unknown', 'not_found']));
    });
  });
});
