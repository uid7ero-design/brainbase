import { Pool as NeonPool, neon, neonConfig } from '@neondatabase/serverless';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateReservationResult } from '@scheduling/core';
import { PostgresReservationRepository, PostgresSchedulingConfigRepository, fromNeonHttpLike, fromPgLike, type SqlExecutor } from '@scheduling/postgres';
import { describeReservationRepositoryContract } from '../../scheduling/tests/support/reservationRepositoryContract';
import { FixedClock, closePool, ensureSchema, getPool, hasDatabase, resetData, seedClass, seedOccurrence, seedOffering, seedSchedule, staff } from './support/pgHarness';
import { classBooking, liveHolds, makeWorld, slotBooking } from './support/builders';

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
