import { Pool as NeonPool, neon, neonConfig } from '@neondatabase/serverless';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateReservationResult } from '@scheduling/core';
import { PostgresReservationRepository, PostgresSchedulingConfigRepository, fromNeonHttpLike, fromPgLike, type SqlExecutor } from '@scheduling/postgres';
import { describeReservationRepositoryContract } from '../../scheduling/tests/support/reservationRepositoryContract';
import { FixedClock, closePool, count, ensureSchema, getPool, hasDatabase, resetData, seedClass, seedOccurrence, seedOffering, seedResource, seedSchedule, staff } from './support/pgHarness';
import { appointmentBooking, classBooking, liveHolds, makeWorld, slotBooking } from './support/builders';

// Driver and connection-mode compatibility on a real Neon branch. The SAME repositories run over
// every way the application could reach the database:
//   * Neon HTTP driver  (what BrainBase uses today: one statement = one implicit transaction)
//   * Neon WebSocket Pool
//   * node-postgres
// each against the DIRECT host and the POOLED (PgBouncer, transaction mode) host.
// Needs SCHEDULING_TEST_DATABASE_URL (direct, also used for seeding) and SCHEDULING_TEST_POOLED_URL.

const POOLED = process.env.SCHEDULING_TEST_POOLED_URL ?? '';
const DIRECT = process.env.SCHEDULING_TEST_DATABASE_URL ?? '';
const enabled = hasDatabase && POOLED !== '' && /neon\.tech/.test(DIRECT);

neonConfig.webSocketConstructor = (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket as never;

const closers: Array<() => Promise<void>> = [];
function executors(): Array<[string, SqlExecutor]> {
  const out: Array<[string, SqlExecutor]> = [];
  for (const [mode, url] of [['direct', DIRECT], ['pooled', POOLED]] as const) {
    out.push([`neon-http/${mode}`, fromNeonHttpLike(neon(url) as unknown as { query(t: string, p?: unknown[]): Promise<unknown> })]);
    const ws = new NeonPool({ connectionString: url, max: 20 });
    closers.push(() => ws.end());
    out.push([`neon-websocket/${mode}`, fromPgLike(ws as unknown as Parameters<typeof fromPgLike>[0])]);
  }
  return out;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const wins = (rs: CreateReservationResult[]) => rs.filter(r => r.ok).length;
const ORG = 'org-neon';

describe.skipIf(!enabled)('Neon drivers and connection modes', () => {
  beforeAll(ensureSchema);
  afterAll(async () => {
    await Promise.all(closers.map(c => c()));
    await closePool();
  });

  for (const [name, exec] of enabled ? executors() : []) {
    describe(name, () => {
      // The shared contract suite (tenant isolation, capacity, snapshot, duplicates) over this driver.
      describeReservationRepositoryContract(name, async () => {
        await resetData();
        return {
          repo: new PostgresReservationRepository({ sql: exec, clock: new FixedClock() }),
          async seedOffering(tenant, offeringId, capacity, options) {
            const scheduleId = options?.scheduleId ?? 'sched-1';
            await seedSchedule(tenant.organisationId, scheduleId, options?.presetKey ?? 'classes_coaching');
            await seedOffering(tenant.organisationId, offeringId, scheduleId, { capacity });
            await getPool().query('UPDATE scheduling_occurrences SET capacity = $3 WHERE organisation_id = $1 AND offering_id = $2', [tenant.organisationId, offeringId, capacity]);
          },
          async seedOccurrence(tenant, occurrenceId, offeringId, options) {
            const cap = (await getPool().query('SELECT capacity FROM scheduling_offerings WHERE organisation_id = $1 AND id = $2', [tenant.organisationId, offeringId])).rows[0].capacity;
            await seedOccurrence({ id: occurrenceId, org: tenant.organisationId, offeringId, capacity: cap, ...options });
          },
        };
      });

      it('30 racers for 5 places: exactly 5 confirmed', async () => {
        await resetData();
        const w = await makeWorld(ORG, staff(ORG));
        await seedClass(ORG, { schedule: 'sc', offering: 'of', occurrence: 'oc' }, 5);
        const repo = new PostgresReservationRepository({ sql: exec, clock: new FixedClock() });
        const results = await Promise.all(range(30).map(() => repo.create(w.staff, classBooking('oc', { schedule: 'sc', offering: 'of' }))));
        expect(wins(results)).toBe(5);
        expect(results.filter(r => !r.ok).every(r => !r.ok && r.reason === 'capacity_exceeded')).toBe(true);
      });

      it('30 racers for one court slot: exactly one winner, no raw error', async () => {
        await resetData();
        const w = await makeWorld(ORG, staff(ORG));
        const repo = new PostgresReservationRepository({ sql: exec, clock: new FixedClock() });
        const settled = await Promise.allSettled(range(30).map(() => repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire))));
        expect(settled.filter(s => s.status === 'rejected')).toEqual([]);
        expect(settled.filter(s => s.status === 'fulfilled' && s.value.ok)).toHaveLength(1);
        expect(await liveHolds(ORG, 'court-1')).toBe(1);
      });

      it('overlapping-but-different ranges raise no deadlock (the per-resource lock works through this driver)', async () => {
        await resetData();
        const w = await makeWorld(ORG, staff(ORG));
        const repo = new PostgresReservationRepository({ sql: exec, clock: new FixedClock() });
        const raw: string[] = [];
        for (let round = 0; round < 8; round++) {
          const date = `2027-03-${String(round + 1).padStart(2, '0')}`;
          const settled = await Promise.allSettled(range(16).map(i => repo.create(w.staff, slotBooking('court-1', date, `${String(8 + (i % 4)).padStart(2, '0')}:00`, 90, w.hire))));
          for (const s of settled) if (s.status === 'rejected') raw.push((s.reason as { code?: string }).code ?? String(s.reason));
        }
        expect(raw).toEqual([]);
      });

      it('a stuck lock surfaces as the retryable contention_timeout through this driver and this host (never full / unavailable), and writes nothing', async () => {
        await resetData();
        const w = await makeWorld(ORG, staff(ORG));
        const repo = new PostgresReservationRepository({ sql: exec, clock: new FixedClock() });
        const holder = new Client({ connectionString: DIRECT, ssl: { rejectUnauthorized: false } });
        await holder.connect();
        try {
          await holder.query('BEGIN');
          await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('scheduling_resource:' || $1 || ':court-1', 0))", [ORG]);
          const started = Date.now();
          await expect(repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire))).rejects.toMatchObject({ name: 'SchedulingError', code: 'contention_timeout', retryable: true });
          expect(Date.now() - started).toBeGreaterThan(4000);
          expect(Date.now() - started).toBeLessThan(15000);
          await holder.query('ROLLBACK');
          expect(await count('SELECT count(*) FROM scheduling_reservations')).toBe(0);
          expect((await repo.create(w.staff, slotBooking('court-1', '2026-12-07', '16:00', 60, w.hire))).ok).toBe(true); // recovers at once
        } finally {
          await holder.end().catch(() => undefined);
        }
      }, 40000);

      it('automatic assignment through this driver: 8 racers, 2 linked practitioners, exactly 2 winners on distinct resources (array parameters work)', async () => {
        await resetData();
        const w = await makeWorld(ORG, staff(ORG));
        const repo = new PostgresReservationRepository({ sql: exec, clock: new FixedClock() });
        for (const r of ['dr-a', 'dr-b']) {
          await seedResource(ORG, r, 'practitioner', { capacity: 1 });
          await getPool().query('INSERT INTO scheduling_offering_resources (organisation_id, offering_id, resource_id) VALUES ($1, $2, $3)', [ORG, w.appt.offering, r]);
        }
        const settled = await Promise.allSettled(range(8).map(() => repo.createAssigned(w.staff, appointmentBooking(null, '2026-12-08', '10:00', 30, w.appt))));
        expect(settled.filter(s => s.status === 'rejected')).toEqual([]);
        const ok = settled.flatMap(s => (s.status === 'fulfilled' && s.value.ok ? [s.value.reservation.resourceId] : []));
        expect(ok.sort()).toEqual(['dr-a', 'dr-b']);
      });

      it('idempotent retries return one reservation; cancel releases the hold; the repositories round-trip config', async () => {
        await resetData();
        const w = await makeWorld(ORG, staff(ORG));
        const repo = new PostgresReservationRepository({ sql: exec, clock: new FixedClock() });
        const config = new PostgresSchedulingConfigRepository({ sql: exec });
        const input = slotBooking('court-1', '2026-12-08', '09:00', 60, w.hire, { idempotencyKey: `k-${name}` });
        const rs = await Promise.all(range(6).map(() => repo.create(w.staff, input)));
        expect(rs.every(r => r.ok)).toBe(true);
        const first = rs.find(r => r.ok && !r.replayed);
        expect(first).toBeDefined();
        const id = first!.ok ? first!.reservation.id : '';
        expect((await repo.cancel(w.staff, { reservationId: id, cancelledBy: 'staff', reason: null, scope: 'this_occurrence' })).status).toBe('cancelled');
        expect((await config.listHoldsForReservation(w.staff, id))[0].releasedAt).not.toBeNull();
        expect((await repo.create(w.staff, slotBooking('court-1', '2026-12-08', '09:00', 60, w.hire))).ok).toBe(true);
      });
    });
  }
});
