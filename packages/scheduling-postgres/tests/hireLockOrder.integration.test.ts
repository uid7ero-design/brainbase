import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresAvailabilityRepository, PostgresHireRepository, fromPgLike } from '@scheduling/postgres';
import { TZ, slotBooking } from './support/builders';
import { GUARDED_BOOKING_TOKEN_SQL } from './support/guardedBooking';
import { FixedClock, closePool, ensureSchema, getPool, hasDatabase, resetData, runScript, seedOffering, seedResource, seedSchedule, sqlFile, staff, uid } from './support/pgHarness';

// PHASE 2C.3a: the lock-order regression, made DETERMINISTIC (no timing luck). The stress test in hireRepository.integration.test.ts found the cycle by chance within seconds; this file
// pins it so it can never come back unnoticed.
//
// THE CYCLE. Every writer that bumps a resource's availability version (a resource closure or rule, a link, a deactivation) first takes the per-resource ADVISORY lock (030-036) and
// only then the version row, exclusively (037's AFTER trigger). The guarded booking of the 2C.3 preflight (tests/support/guardedBooking.ts, GUARDED_BOOKING_TOKEN_SQL) took the version
// rows FIRST (FOR SHARE) and the advisory lock later, inside the reservation insert trigger. Writer holds the advisory lock and waits for the version row; booking holds the version row
// and waits for the advisory lock: PostgreSQL kills one of them with 40P01.
//
//   * the OLD shape is CHARACTERISED here: it deadlocks. (This is why the preflight's "no lock cycle" claim, which was based on a stress test with bookings and bump-only writers, was
//     wrong, and it is a property of the preflight's fixture only: no application code ever ran it.)
//   * the NEW shape (HIRE_GUARDED_SQL: advisory lock before any version row) cannot: the booking waits at the advisory lock holding nothing the writer needs, and the writer proceeds.

const ORG = 'org-hire-lockorder';
const suite = hasDatabase ? describe : describe.skip;
const DAY = '2026-11-16';
const hours = { kind: 'hours' as const, label: null, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', validFrom: null, validTo: null };
const clock = new FixedClock(new Date('2026-11-02T00:00:00Z'));
const q = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => getPool().query(text, params).then(r => r.rows as T[]);
const ADVISORY = `SELECT pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || $1::text || ':' || $2::text, 0))`;
const BUMP = `UPDATE scheduling_availability_versions SET version = version + 1 WHERE organisation_id = $1 AND owner_kind = 'resource' AND owner_id = $2`;

let avail: PostgresAvailabilityRepository;
interface Fx { schedule: string; offering: string; court: string }
async function fixture(): Promise<Fx> {
  const f = { schedule: uid('sch'), offering: uid('off'), court: uid('court') };
  await seedSchedule(ORG, f.schedule, 'resource_hire');
  await seedOffering(ORG, f.offering, f.schedule, { capacity: null, durationMinutes: 60 });
  await seedResource(ORG, f.court, 'court');
  await q('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [ORG, f.offering, f.court]);
  for (const owner of [{ kind: 'offering' as const, id: f.offering }, { kind: 'resource' as const, id: f.court }]) {
    const r = await avail.createRule(staff(ORG), owner, hours, TZ);
    if (!r.ok) throw new Error(JSON.stringify(r));
  }
  return f;
}
async function waitBlocked(marker: string) {
  for (let i = 0; i < 400; i++) {
    const r = await q<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1 AND pid <> pg_backend_pid()`, [`%${marker}%`]);
    if (Number(r[0].n) > 0) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`never observed a blocked backend for ${marker}`);
}
const settle = <T>(p: Promise<T>) => p.then(v => ({ ok: true as const, v }), e => ({ ok: false as const, code: (e as { code?: string }).code }));

suite('lock order: a resource writer and a booking (Phase 2C.3a regression)', () => {
  beforeAll(async () => {
    await ensureSchema();
    await runScript(sqlFile('035_availability_partial_closures.sql'));
    await runScript(sqlFile('037_availability_versions.sql'));
    await resetData();
    await getPool().query('INSERT INTO organisations (id, name, slug, updated_at, timezone) VALUES ($1, $1, $1, now(), $2) ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone', [ORG, TZ]);
    avail = new PostgresAvailabilityRepository({ sql: fromPgLike(getPool()) });
  });
  afterAll(async () => {
    await resetData();
    await closePool();
  });

  it('CHARACTERISATION - the preflight fixture (versions first, advisory lock later) deadlocks against a resource writer', async () => {
    const f = await fixture();
    const versions = (await q<{ owner_kind: string; v: string }>(`SELECT owner_kind, version::text AS v FROM scheduling_availability_versions WHERE organisation_id = $1 AND ((owner_kind = 'offering' AND owner_id = $2) OR (owner_kind = 'resource' AND owner_id = $3))`, [ORG, f.offering, f.court]));
    const v = { offering: versions.find(x => x.owner_kind === 'offering')!.v, resource: versions.find(x => x.owner_kind === 'resource')!.v };
    const token = (await q<{ t: string }>(`SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t FROM scheduling_offerings WHERE organisation_id = $1 AND id = $2`, [ORG, f.offering]))[0].t;
    const w = slotBooking(f.court, DAY, '10:00', 60, { schedule: f.schedule, offering: f.offering }).instants;

    const writer = await getPool().connect();
    try {
      await writer.query('BEGIN');
      await writer.query(ADVISORY, [ORG, f.court]); // the writer's first step, exactly as scheduling_availability_lock_owner / the link and deactivation guards take it
      const booking = settle(getPool().query(`/* old-shape */ ${GUARDED_BOOKING_TOKEN_SQL}`, [ORG, f.offering, v.offering, f.court, v.resource, uid('res'), uid('hold'), f.schedule, w.startsAt, w.endsAt, uid('key'), token]));
      await waitBlocked('old-shape'); // the booking now holds both version rows FOR SHARE and waits for the advisory lock
      const bump = await settle(writer.query(BUMP, [ORG, f.court])); // the writer's AFTER trigger: the version row, exclusively
      const outcome = await booking;
      const codes = [bump.ok ? 'ok' : bump.code, outcome.ok ? 'ok' : outcome.code];
      expect(codes).toContain('40P01'); // one of the two is killed: the cycle is real
      await writer.query('ROLLBACK').catch(() => undefined);
    } finally {
      writer.release();
    }
  });

  it('the corrected statement (advisory lock before any version row) cannot deadlock with the same writer: the booking waits holding nothing the writer needs, then refuses (the version moved)', async () => {
    const f = await fixture();
    const hire = new PostgresHireRepository({ sql: fromPgLike(getPool()), clock, lockTimeoutMs: 10_000, sleep: async () => undefined });
    const writer = await getPool().connect();
    try {
      await writer.query('BEGIN');
      await writer.query(ADVISORY, [ORG, f.court]);
      const booking = settle(hire.createHire(staff(ORG), { idempotencyKey: `lockorder-${uid('k')}-padding-padding`.slice(0, 60), offeringId: f.offering, resourceId: f.court, start: { date: DAY, time: '10:00' }, partySize: 1, customer: { name: 'Lock Order' } }));
      await waitBlocked('WITH ls AS');
      const bump = await settle(writer.query(BUMP, [ORG, f.court])); // not blocked: the booking holds no version row yet
      expect(bump.ok).toBe(true);
      await writer.query('COMMIT');
      const outcome = await booking;
      expect(outcome.ok).toBe(true);
      expect(outcome.ok && outcome.v.ok === false && outcome.v.code).toBe('availability_changed');
      const n = (await q<{ n: number }>('SELECT count(*)::int AS n FROM scheduling_reservations WHERE organisation_id = $1 AND offering_id = $2', [ORG, f.offering]))[0].n;
      expect(n).toBe(0);
    } finally {
      writer.release();
    }
  });
});
