import type { Clock, SchedulingPersistence } from '@scheduling/core';
import { PostgresSchedulingConfigRepository } from './configRepository';
import type { SqlExecutor } from './executor';
import { PostgresReservationRepository } from './reservationRepository';

export * from './executor';
export * from './errors';
export { PostgresReservationRepository, toReservation, type ReservationRepositoryOptions } from './reservationRepository';
export { PostgresSchedulingConfigRepository, type ConfigRepositoryOptions } from './configRepository';
export { PostgresAvailabilityRepository, type AvailabilityRepositoryOptions } from './availabilityRepository';

/** Builds both repositories over one executor. The only wiring a host needs. */
export function createPostgresScheduling(options: { sql: SqlExecutor; clock: Clock; newId?: () => string }): SchedulingPersistence {
  return {
    config: new PostgresSchedulingConfigRepository({ sql: options.sql, newId: options.newId }),
    reservations: new PostgresReservationRepository(options),
  };
}
