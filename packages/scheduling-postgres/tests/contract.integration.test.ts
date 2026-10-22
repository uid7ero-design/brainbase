import { afterAll, beforeAll, describe } from 'vitest';
import { PostgresReservationRepository } from '@scheduling/postgres';
import { describeReservationRepositoryContract } from '../../scheduling/tests/support/reservationRepositoryContract';
import { FixedClock, closePool, ensureSchema, hasDatabase, resetData, seedOffering, seedOccurrence, seedSchedule, sql } from './support/pgHarness';

// The SAME contract suite the in-memory reference implementation passes, now run against the
// real SQL repository on a real disposable Postgres. This is what proves tenant isolation,
// capacity under concurrency, cancellation and the snapshot semantics against the actual adapter.

describe.skipIf(!hasDatabase)('Postgres adapter', () => {
  beforeAll(ensureSchema);
  afterAll(closePool);

  describeReservationRepositoryContract('PostgresReservationRepository', async () => {
    await resetData();
    const repo = new PostgresReservationRepository({ sql: sql(), clock: new FixedClock() });
    return {
      repo,
      async seedOffering(tenant, offeringId, capacity, options) {
        const scheduleId = options?.scheduleId ?? 'sched-1';
        await seedSchedule(tenant.organisationId, scheduleId, options?.presetKey ?? 'classes_coaching');
        await seedOffering(tenant.organisationId, offeringId, scheduleId, { capacity });
        // Re-seeding with a larger capacity carries through to occurrences that already exist.
        await getPool().query('UPDATE scheduling_occurrences SET capacity = $3 WHERE organisation_id = $1 AND offering_id = $2', [tenant.organisationId, offeringId, capacity]);
      },
      async seedOccurrence(tenant, occurrenceId, offeringId, options) {
        // Reads the offering's capacity so re-seeding the offering with a larger capacity carries through.
        const { rows } = await sqlRows(tenant.organisationId, offeringId);
        await seedOccurrence({ id: occurrenceId, org: tenant.organisationId, offeringId, capacity: rows[0].capacity, ...options });
      },
    };
  });
});

import { getPool } from './support/pgHarness';
async function sqlRows(org: string, offeringId: string) {
  return getPool().query('SELECT capacity FROM scheduling_offerings WHERE organisation_id = $1 AND id = $2', [org, offeringId]);
}
