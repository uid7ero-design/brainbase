import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  evaluateSlotBooking,
  type AvailabilityExceptionInput,
  type AvailabilityRule,
  type SlotBookingContext,
  type StoredAvailabilityException,
  type StoredAvailabilityRule,
} from '@scheduling/core';
import { neon } from '@neondatabase/serverless';
import { PostgresAvailabilityRepository, PostgresReservationRepository, PostgresSchedulingConfigRepository, fromNeonHttpLike, fromPgLike } from '@scheduling/postgres';
import { TZ, slotBooking } from './support/builders';
import { installNeonLikeFetch } from './support/neonLikeFetch';
import { FixedClock, closePool, ensureSchema, getPool, hasDatabase, resetData, runScript, seedOffering, seedResource, seedSchedule, sqlFile, staff, uid } from './support/pgHarness';

// PHASE 2C.0: availability at commit, on a real PostgreSQL (run by scripts/tests/verify-scheduling-phase2c.sh on 16 and 17).
//
// QUESTION. The availability engine is a pure TypeScript computation (so the calendar and a booking can never disagree about an offered time). A booking is one database
// write. Between "the engine said yes" and "the row is committed" the world can change: a closure is added, a rule is removed, a resource is switched off or unlinked.
// The Neon HTTP driver runs ONE statement per request, each in its own implicit transaction, so a read request and a later write request are NOT one transaction.
//
// PART A (needs nothing new) CHARACTERISES the gap with deterministic interleavings, no timing luck: what the database enforces today and what it does not.
// PART B proves the proposed remedy, option C of the design document: a per-owner availability version that every availability change bumps, and a single booking
// statement that locks the owners and requires the version it read. Its SQL is a PROTOTYPE (tests/support/prototype038AvailabilityVersion.sql), applied here to a
// disposable database only. FAILING FIRST: with SCHEDULING_SKIP_PROTOTYPE=1 part B must be RED (the version column does not exist); the recorded red and green runs are in
// docs/architecture/scheduling-phase2c-availability-at-commit.md.

const ORG = 'org-commit';
const OTHER = 'org-commit-other';
const tenant = staff(ORG);
const suite = hasDatabase ? describe : describe.skip;
const SKIP_PROTOTYPE = process.env.SCHEDULING_SKIP_PROTOTYPE === '1';

let avail: PostgresAvailabilityRepository;
let config: PostgresSchedulingConfigRepository;
let reservations: PostgresReservationRepository;
const clock = new FixedClock(new Date('2026-10-31T00:00:00Z'));

// Monday 2026-11-02, Adelaide (ACDT, UTC+10:30). Ids are per test so tests never see each other's rows.
const DAY = '2026-11-02';
const hours = { kind: 'hours' as const, label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null };

interface Fixture {
  schedule: string;
  offering: string;
  court: string;
}

async function fixture(org = ORG): Promise<Fixture> {
  const f = { schedule: uid('sch'), offering: uid('off'), court: uid('court') };
  await seedSchedule(org, f.schedule, 'resource_hire');
  await seedOffering(org, f.offering, f.schedule, { capacity: null });
  await seedResource(org, f.court, 'court');
  await getPool().query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [org, f.offering, f.court]);
  const t = staff(org);
  const a = await avail.createRule(t, { kind: 'offering', id: f.offering }, hours, TZ);
  const b = await avail.createRule(t, { kind: 'resource', id: f.court }, hours, TZ);
  if (!a.ok || !b.ok) throw new Error(`fixture rules: ${JSON.stringify([a, b])}`);
  return f;
}

const coreRule = (org: string, r: StoredAvailabilityRule): AvailabilityRule => ({
  id: r.id, organisationId: org, resourceId: r.resourceId, offeringId: r.offeringId, dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime, validFrom: r.validFrom, validTo: r.validTo,
});
const coreException = (org: string, e: StoredAvailabilityException): AvailabilityExceptionInput => ({
  id: e.id, organisationId: org, resourceId: e.resourceId, offeringId: e.offeringId, fromDate: e.fromDate, toDate: e.toDate, kind: e.kind, reason: e.reason,
  ...(e.startTime !== null && e.endTime !== null ? { windows: [{ startTime: e.startTime, endTime: e.endTime }] } : {}),
});

/** What a host's commit path does BEFORE the write: read the inputs, then ask the shared engine. Reads only. */
async function evaluate(f: Fixture, startTime = '10:00', minutes = 60) {
  const t = staff(ORG);
  const [offRules, offEx, resRules, resEx, holds] = await Promise.all([
    avail.listRules(t, { kind: 'offering', id: f.offering }),
    avail.listExceptions(t, { kind: 'offering', id: f.offering }),
    avail.listRules(t, { kind: 'resource', id: f.court }),
    avail.listExceptions(t, { kind: 'resource', id: f.court }),
    config.listLiveHoldsForResources(t, [f.court], '2026-11-01T00:00:00Z', '2026-11-04T00:00:00Z'),
  ]);
  const active = (await getPool().query('SELECT active FROM scheduling_resources WHERE organisation_id = $1 AND id = $2', [ORG, f.court])).rows[0].active as boolean;
  const ctx: SlotBookingContext = {
    timezone: TZ,
    offering: { id: f.offering, archivedAt: null },
    offeringRules: offRules.map(r => coreRule(ORG, r)),
    offeringExceptions: offEx.map(e => coreException(ORG, e)),
    resources: [{ resource: { id: f.court, active }, timezone: TZ, rules: resRules.map(r => coreRule(ORG, r)), exceptions: resEx.map(e => coreException(ORG, e)), holds }],
    stepMinutes: 60,
    now: '2026-10-31T00:00:00Z',
    presetKey: 'resource_hire',
    resourceDetails: new Map([[f.court, { capacity: 4, kind: 'court' as const }]]),
    requirePinnedZones: true,
  };
  const req = slotBooking(f.court, DAY, startTime, minutes, { schedule: f.schedule, offering: f.offering });
  return { decision: evaluateSlotBooking(ctx, { interval: req.instants, resourceId: f.court, partySize: 1 }), request: req };
}

const bookingsOf = async (f: Fixture) => Number((await getPool().query("SELECT count(*) AS n FROM scheduling_reservations WHERE organisation_id = $1 AND offering_id = $2 AND status <> 'cancelled'", [ORG, f.offering])).rows[0].n);

suite('availability at commit (Phase 2C.0) on real PostgreSQL', () => {
  beforeAll(async () => {
    await ensureSchema();
    await runScript(sqlFile('035_availability_partial_closures.sql'));
    await resetData();
    for (const org of [ORG, OTHER]) await getPool().query('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone', [org, 'Australia/Adelaide']);
    avail = new PostgresAvailabilityRepository({ sql: fromPgLike(getPool()) });
    config = new PostgresSchedulingConfigRepository({ sql: fromPgLike(getPool()) });
    reservations = new PostgresReservationRepository({ sql: fromPgLike(getPool()), clock });
    // The red run (SKIP_PROTOTYPE=1) must start from a database WITHOUT the prototype, even one a previous green run left behind.
    if (SKIP_PROTOTYPE) {
      await runScript('DROP TABLE IF EXISTS scheduling_availability_versions CASCADE; DROP FUNCTION IF EXISTS scheduling_bump_availability_version() CASCADE; DROP FUNCTION IF EXISTS scheduling_resource_active_bump() CASCADE; DROP FUNCTION IF EXISTS scheduling_version_row_for_owner() CASCADE; DROP FUNCTION IF EXISTS scheduling_bump_one(text, text, text) CASCADE;');
    } else {
      await runScript(readFileSync(path.join(__dirname, 'support/prototype038AvailabilityVersion.sql'), 'utf8'));
    }
  });
  afterAll(async () => {
    await resetData();
    await closePool();
  });

  // ─── PART A: what happens today, with check-then-insert as separate requests ────────────────────────────────────────────────────

  describe('part A: application check, then insert (option A) is not atomic', () => {
    it('the engine accepts a time, a closure is committed in between, and the insert still succeeds: the booking lands inside a closed day', async () => {
      const f = await fixture();
      const before = await evaluate(f);
      expect(before.decision.ok).toBe(true);

      // The world changes after the check and before the write (a different request, a different transaction).
      const closure = await avail.createException(tenant, { kind: 'offering', id: f.offering }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: 'maintenance' }, TZ);
      expect(closure.ok).toBe(true);

      const written = await reservations.create(tenant, before.request);
      expect(written.ok).toBe(true); // the database has no opinion about opening hours: only exclusivity, capacity and lifecycle
      expect(await bookingsOf(f)).toBe(1);
      // A fresh evaluation of the same time now refuses it, which is the disagreement an atomic guard must prevent.
      const after = await evaluate(f);
      expect(after.decision).toMatchObject({ ok: false, refusal: { code: 'outside_availability' } });
    });

    it('the exclusion constraint is still the only authority on double booking, whatever the engine said', async () => {
      const f = await fixture();
      const one = await evaluate(f);
      const two = await evaluate(f);
      expect(one.decision.ok && two.decision.ok).toBe(true); // both checks pass: they ran before either write
      const results = await Promise.all([reservations.create(tenant, one.request), reservations.create(tenant, two.request)]);
      expect(results.filter(r => r.ok)).toHaveLength(1);
      expect(results.filter(r => !r.ok)).toEqual([{ ok: false, reason: 'resource_conflict' }]);
    });

    it('a booking made after the resource was switched off: what does the database say?', async () => {
      const f = await fixture();
      const checked = await evaluate(f);
      expect(checked.decision.ok).toBe(true);
      await getPool().query('UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = $2', [ORG, f.court]);
      let outcome: 'booked' | 'refused';
      try {
        const r = await reservations.create(tenant, checked.request);
        outcome = r.ok ? 'booked' : 'refused';
      } catch {
        outcome = 'refused';
      }
      // Recorded finding (see the design document): 010's reservation guard refuses an INACTIVE resource, so this particular race is closed by the database today.
      expect(outcome).toBe('refused');
    });
  });

  // ─── PART B: the proposed guard (prototype) ─────────────────────────────────────────────────────────────────────────────────────

  describe('part B: a per-owner availability version, locked and compared inside the booking statement (option C)', () => {
    const versions = async (f: Fixture) => {
      const read = async (kind: string, id: string) => (await getPool().query('SELECT version AS v FROM scheduling_availability_versions WHERE organisation_id = $1 AND owner_kind = $2 AND owner_id = $3', [ORG, kind, id])).rows[0].v;
      const o = await read('offering', f.offering);
      const r = await read('resource', f.court);
      return { offering: String(o), resource: String(r) };
    };

    // The prototype of the guarded write. ONE statement: lock the offering's version row and the offering, lock the resource's version row and the resource, require both versions, insert the reservation and its hold.
    // $1 org, $2 offering, $3 offering version, $4 resource, $5 resource version, $6 reservation id, $7 hold id, $8 schedule, $9 starts, $10 ends.
    const GUARDED = `
      WITH lov AS (
        SELECT 1 FROM scheduling_availability_versions v
         WHERE v.organisation_id = $1 AND v.owner_kind = 'offering' AND v.owner_id = $2 AND v.version = $3::bigint
           FOR SHARE OF v
      ), lo AS (
        SELECT o.id, o.organisation_id, o.schedule_id FROM scheduling_offerings o, lov
         WHERE o.organisation_id = $1 AND o.id = $2 AND o.archived_at IS NULL
           FOR SHARE OF o
      ), lrv AS (
        SELECT 1 FROM scheduling_availability_versions v, lo
         WHERE v.organisation_id = $1 AND v.owner_kind = 'resource' AND v.owner_id = $4 AND v.version = $5::bigint
           FOR SHARE OF v
      ), lr AS (
        SELECT r.id FROM scheduling_resources r, lrv
         WHERE r.organisation_id = $1 AND r.id = $4 AND r.active
           FOR SHARE OF r
      ), res AS (
        INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, occurrence_id, resource_id, series_id, customer_id,
          customer_name, customer_email, customer_email_normalised, customer_phone, contact_link, timezone, local_start_date, local_start_time, local_end_date, local_end_time,
          starts_at, ends_at, party_size, price_cents, currency, notes, idempotency_key, created_by)
        SELECT $6, lo.organisation_id, lo.schedule_id, 'resource_hire', 1, lo.id, 'slot', NULL, lr.id, NULL, NULL,
               'Hirer', NULL, NULL, NULL, 'none', 'Australia/Adelaide',
               ($9::timestamptz AT TIME ZONE 'Australia/Adelaide')::date, ($9::timestamptz AT TIME ZONE 'Australia/Adelaide')::time,
               ($10::timestamptz AT TIME ZONE 'Australia/Adelaide')::date, ($10::timestamptz AT TIME ZONE 'Australia/Adelaide')::time,
               $9::timestamptz, $10::timestamptz, 1, 0, 'AUD', NULL, NULL, 'staff:test'
          FROM lo, lr WHERE $8::text = lo.schedule_id
        RETURNING id, organisation_id, resource_id, starts_at, ends_at
      ), hold AS (
        INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, reservation_id)
        SELECT $7, organisation_id, resource_id, tstzrange(starts_at, ends_at, '[)'), id FROM res
        RETURNING id
      )
      SELECT id FROM res`;
    const guardedParams = (f: Fixture, v: { offering: string; resource: string }, startsAt: string, endsAt: string) => [ORG, f.offering, v.offering, f.court, v.resource, uid('res'), uid('hold'), f.schedule, startsAt, endsAt];
    const guarded = (f: Fixture, v: { offering: string; resource: string }, startsAt: string, endsAt: string, client: { query: (t: string, p: unknown[]) => Promise<{ rows: unknown[] }> } = getPool()) =>
      client.query(GUARDED, guardedParams(f, v, startsAt, endsAt));
    const slot = async (f: Fixture, time = '10:00') => {
      const r = slotBooking(f.court, DAY, time, 60, { schedule: f.schedule, offering: f.offering });
      return r.instants;
    };
    const settled = async (p: Promise<unknown>, ms = 400) => {
      let done = false;
      void p.then(() => (done = true), () => (done = true));
      await new Promise(r => setTimeout(r, ms));
      return done;
    };

    it('every change to what decides availability bumps the owner version, in the same transaction', async () => {
      const f = await fixture();
      const v0 = await versions(f);
      const rule = await avail.createRule(tenant, { kind: 'offering', id: f.offering }, { ...hours, dayOfWeek: 2 }, TZ);
      if (!rule.ok) throw new Error('rule');
      const v1 = await versions(f);
      expect(BigInt(v1.offering)).toBeGreaterThan(BigInt(v0.offering));
      expect(v1.resource).toBe(v0.resource); // the resource's own availability did not change
      await avail.createException(tenant, { kind: 'resource', id: f.court }, { fromDate: '2026-12-01', toDate: '2026-12-01', kind: 'closed', reason: null }, TZ);
      const v2 = await versions(f);
      expect(BigInt(v2.resource)).toBeGreaterThan(BigInt(v1.resource));
      await avail.deleteRule(tenant, rule.value.id, rule.value.updatedAt);
      const v3 = await versions(f);
      expect(BigInt(v3.offering)).toBeGreaterThan(BigInt(v2.offering));
      await getPool().query('UPDATE scheduling_resources SET active = true, name = name || $3 WHERE organisation_id = $1 AND id = $2', [ORG, f.court, '!']); // active unchanged: no bump
      expect((await versions(f)).resource).toBe(v3.resource);
      await getPool().query("UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = $2", [ORG, f.court]);
      expect(BigInt((await versions(f)).resource)).toBeGreaterThan(BigInt(v3.resource));
      await getPool().query("UPDATE scheduling_resources SET active = true WHERE organisation_id = $1 AND id = $2", [ORG, f.court]);
      const v4 = await versions(f);
      await getPool().query('DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND offering_id = $2 AND resource_id = $3', [ORG, f.offering, f.court]);
      const v5 = await versions(f);
      expect(BigInt(v5.offering)).toBeGreaterThan(BigInt(v4.offering));
      expect(BigInt(v5.resource)).toBeGreaterThan(BigInt(v4.resource));
    });

    it('current versions: the guarded statement writes the reservation and its hold; stale versions: it writes nothing', async () => {
      const f = await fixture();
      const v = await versions(f);
      const w = await slot(f);
      const ok = await guarded(f, v, w.startsAt, w.endsAt);
      expect(ok.rows).toHaveLength(1);
      expect(await bookingsOf(f)).toBe(1);

      const f2 = await fixture();
      const stale = await versions(f2);
      await avail.createException(tenant, { kind: 'offering', id: f2.offering }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: null }, TZ);
      const w2 = await slot(f2);
      const refused = await guarded(f2, stale, w2.startsAt, w2.endsAt);
      expect(refused.rows).toHaveLength(0);
      expect(await bookingsOf(f2)).toBe(0);
      expect(Number((await getPool().query('SELECT count(*) AS n FROM scheduling_resource_holds WHERE organisation_id = $1 AND resource_id = $2', [ORG, f2.court])).rows[0].n)).toBe(0);
    });

    it('RACE 1: a closure is mid-commit when the booking arrives; the booking waits for it and then writes nothing', async () => {
      const f = await fixture();
      const v = await versions(f); // read BEFORE the inputs, as the host must
      const w = await slot(f);
      const writer = await getPool().connect();
      try {
        await writer.query('BEGIN');
        await writer.query("INSERT INTO scheduling_availability_exceptions (id, organisation_id, offering_id, from_date, to_date, kind) VALUES ($1, $2, $3, $4, $4, 'closed')", [uid('ex'), ORG, f.offering, DAY]);
        const booking = guarded(f, v, w.startsAt, w.endsAt);
        expect(await settled(booking)).toBe(false); // blocked on the owner row the writer has updated
        await writer.query('COMMIT');
        expect((await booking).rows).toHaveLength(0); // woke up, re-read the owner row, the version had moved
        expect(await bookingsOf(f)).toBe(0);
      } finally {
        await writer.query('ROLLBACK').catch(() => undefined);
        writer.release();
      }
    });

    it('RACE 2: a booking is mid-commit when the closure arrives; the closure waits, the booking stands (existing bookings survive availability changes)', async () => {
      const f = await fixture();
      const v = await versions(f);
      const w = await slot(f);
      const booker = await getPool().connect();
      try {
        await booker.query('BEGIN');
        const first = await guarded(f, v, w.startsAt, w.endsAt, booker);
        expect(first.rows).toHaveLength(1);
        const closure = avail.createException(tenant, { kind: 'offering', id: f.offering }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: null }, TZ);
        expect(await settled(closure)).toBe(false); // the bump needs the offering row the booking holds FOR SHARE
        await booker.query('COMMIT');
        expect((await closure).ok).toBe(true);
        expect(await bookingsOf(f)).toBe(1); // never auto-cancelled
      } finally {
        await booker.query('ROLLBACK').catch(() => undefined);
        booker.release();
      }
    });

    it('RACE 3: the resource is switched off mid-flight; a booking that read the old version writes nothing', async () => {
      const f = await fixture();
      const v = await versions(f);
      const w = await slot(f);
      const writer = await getPool().connect();
      try {
        await writer.query('BEGIN');
        await writer.query('UPDATE scheduling_resources SET active = false WHERE organisation_id = $1 AND id = $2', [ORG, f.court]);
        const booking = guarded(f, v, w.startsAt, w.endsAt);
        expect(await settled(booking)).toBe(false);
        await writer.query('COMMIT');
        expect((await booking).rows).toHaveLength(0);
      } finally {
        await writer.query('ROLLBACK').catch(() => undefined);
        writer.release();
      }
    });

    it('RACE 4: the offering-resource link is removed mid-flight; the booking writes nothing', async () => {
      const f = await fixture();
      const v = await versions(f);
      const w = await slot(f);
      const writer = await getPool().connect();
      try {
        await writer.query('BEGIN');
        await writer.query('DELETE FROM scheduling_offering_resources WHERE organisation_id = $1 AND offering_id = $2 AND resource_id = $3', [ORG, f.offering, f.court]);
        const booking = guarded(f, v, w.startsAt, w.endsAt);
        expect(await settled(booking)).toBe(false);
        await writer.query('COMMIT');
        expect((await booking).rows).toHaveLength(0);
      } finally {
        await writer.query('ROLLBACK').catch(() => undefined);
        writer.release();
      }
    });

    it('the version is read BEFORE the inputs: reading it after them would accept stale inputs (the ordering rule the host must follow)', async () => {
      const f = await fixture();
      const inputsFirst = await evaluate(f); // reads the rules and closures
      expect(inputsFirst.decision.ok).toBe(true);
      await avail.createException(tenant, { kind: 'offering', id: f.offering }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: null }, TZ);
      const versionAfter = await versions(f); // WRONG ORDER: the version now already includes the closure the inputs missed
      const w = await slot(f);
      expect((await guarded(f, versionAfter, w.startsAt, w.endsAt)).rows).toHaveLength(1); // accepted against stale inputs
      // RIGHT ORDER is what RACE 1 proves: the version captured first is the stale one and the guard refuses.
    });

    it('many bookings of one slot with current versions: exactly one wins and the others get the exclusion conflict, not a version failure', async () => {
      const f = await fixture();
      const v = await versions(f);
      const w = await slot(f);
      const results = await Promise.allSettled(Array.from({ length: 12 }, () => guarded(f, v, w.startsAt, w.endsAt)));
      const won = results.filter(r => r.status === 'fulfilled' && r.value.rows.length === 1);
      const lost = results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason as { code?: string });
      expect(won).toHaveLength(1);
      expect(lost.every(e => e.code === '23P01')).toBe(true);
      expect(await bookingsOf(f)).toBe(1);
    });

    it('other tenants: a version of another organisation never matches, and a foreign offering id writes nothing', async () => {
      const f = await fixture();
      const v = await versions(f);
      const w = await slot(f);
      const wrongOrg = await getPool().query(GUARDED, [OTHER, f.offering, v.offering, f.court, v.resource, uid('res'), uid('hold'), f.schedule, w.startsAt, w.endsAt]);
      expect(wrongOrg.rows).toHaveLength(0);
      expect(await bookingsOf(f)).toBe(0);
    });

    // The same guarantees through the REAL @neondatabase/serverless driver code (see support/neonLikeFetch.ts): one statement per request, each its own implicit
    // transaction on its own connection, so a "writer" and a "booking" are genuinely concurrent requests. No interactive transaction is available here, which is the point:
    // the writer holds its lock by being ONE statement that sleeps after its write.
    describe('through the real Neon HTTP driver code', () => {
      let sqlNeon: { query(text: string, params?: unknown[]): Promise<unknown> };
      let uninstall: () => void;
      let seen: string[];
      beforeAll(() => {
        const fake = installNeonLikeFetch(getPool());
        seen = fake.statements;
        uninstall = fake.restore;
        sqlNeon = neon('postgres://driver:driver@ep-test.example.neon.tech/neondb') as unknown as typeof sqlNeon;
      });
      afterAll(() => uninstall());
      // The driver's query objects are LAZY thenables: nothing is sent until they are awaited or .then is called. A test (or a host) that wants a request in flight while it
      // does something else must start it explicitly.
      const go = <T,>(q: PromiseLike<T>) => new Promise<T>((resolve, reject) => q.then(resolve, reject));

      it('the guarded statement is ONE request and writes the reservation and its hold', async () => {
        const f = await fixture();
        const v = await versions(f);
        const w = await slot(f);
        seen.length = 0;
        const rows = (await sqlNeon.query(GUARDED, guardedParams(f, v, w.startsAt, w.endsAt))) as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(1);
        expect(seen).toHaveLength(1);
        expect(await bookingsOf(f)).toBe(1);
      });

      it('a stale version through the driver writes nothing', async () => {
        const f = await fixture();
        const v = await versions(f);
        await avail.createException(tenant, { kind: 'offering', id: f.offering }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: null }, TZ);
        const w = await slot(f);
        expect(await sqlNeon.query(GUARDED, guardedParams(f, v, w.startsAt, w.endsAt))).toEqual([]);
        expect(await bookingsOf(f)).toBe(0);
      });

      it('RACE through the driver: a closure request that is still committing makes the concurrent booking request wait and then write nothing', async () => {
        const f = await fixture();
        const v = await versions(f);
        const w = await slot(f);
        // One statement: take the owner row (the lock a closure's version bump takes), then sleep before the statement, and its implicit transaction, ends.
        const writer = go(sqlNeon.query(
          `WITH bump AS (UPDATE scheduling_availability_versions SET version = version + 1 WHERE organisation_id = $1 AND owner_kind = 'offering' AND owner_id = $2 RETURNING 1) SELECT pg_sleep(0.8) FROM bump`,
          [ORG, f.offering],
        ));
        await new Promise(r => setTimeout(r, 250));
        const started = Date.now();
        const rows = (await sqlNeon.query(GUARDED, guardedParams(f, v, w.startsAt, w.endsAt))) as unknown[];
        const waited = Date.now() - started;
        await writer;
        expect(rows).toHaveLength(0);
        expect(waited).toBeGreaterThan(300); // it really waited for the writer rather than racing past it
        expect(await bookingsOf(f)).toBe(0);
      });

      it('RACE through the driver, other way round: a booking request still committing makes the closure wait, and the booking stands', async () => {
        const f = await fixture();
        const v = await versions(f);
        const w = await slot(f);
        const params = guardedParams(f, v, w.startsAt, w.endsAt);
        // The same guarded statement with a sleep after the insert, so the booking holds its owner locks across the sleep.
        const slow = go(sqlNeon.query(GUARDED.replace('SELECT id FROM res', 'SELECT id, pg_sleep(0.8) FROM res'), params) as PromiseLike<unknown[]>);
        await new Promise(r => setTimeout(r, 250));
        const started = Date.now();
        const closure = await avail.createException(tenant, { kind: 'offering', id: f.offering }, { fromDate: DAY, toDate: DAY, kind: 'closed', reason: null }, TZ);
        const waited = Date.now() - started;
        expect(((await slow) as unknown[]).length).toBe(1);
        expect(closure.ok).toBe(true);
        expect(waited).toBeGreaterThan(300);
        expect(await bookingsOf(f)).toBe(1);
      });

      it('SQLSTATE arrives as .code: a lost exclusion race is 23P01, and exactly one request wins', async () => {
        const f = await fixture();
        const v = await versions(f);
        const w = await slot(f);
        const results = await Promise.allSettled(Array.from({ length: 8 }, () => sqlNeon.query(GUARDED, guardedParams(f, v, w.startsAt, w.endsAt))));
        expect(results.filter(r => r.status === 'fulfilled' && (r.value as unknown[]).length === 1)).toHaveLength(1);
        const lost = results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason as { code?: string; name?: string });
        expect(lost.length).toBe(7);
        expect(lost.every(e => e.code === '23P01')).toBe(true);
        expect(lost[0].name).toBe('NeonDbError');
      });

      it('the existing reservation repository works unchanged over the driver (same statements, same results)', async () => {
        const f = await fixture();
        const repo = new PostgresReservationRepository({ sql: fromNeonHttpLike(sqlNeon), clock });
        const r = await repo.create(tenant, slotBooking(f.court, DAY, '12:00', 60, { schedule: f.schedule, offering: f.offering }));
        expect(r.ok).toBe(true);
        const clash = await repo.create(tenant, slotBooking(f.court, DAY, '12:30', 60, { schedule: f.schedule, offering: f.offering }));
        expect(clash).toEqual({ ok: false, reason: 'resource_conflict' });
      });
    });
  });
});
