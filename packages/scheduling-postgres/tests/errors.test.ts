import { describe, expect, it } from 'vitest';
import { SchedulingError } from '@scheduling/core';
import { SCHEDULING_SQLSTATE, mapPgError, sqlstateOf, translating } from '@scheduling/postgres';

const pgError = (code: string, constraint?: string, message = 'boom') => Object.assign(new Error(message), { code, constraint });

describe('mapPgError: Postgres errors raised by the scheduling schema become domain errors', () => {
  const table: Array<[string, string | undefined, string]> = [
    [SCHEDULING_SQLSTATE.capacity, undefined, 'capacity_exceeded'],
    [SCHEDULING_SQLSTATE.isolation, undefined, 'unsafe_isolation'],
    [SCHEDULING_SQLSTATE.occurrenceClosed, undefined, 'offering_unavailable'],
    [SCHEDULING_SQLSTATE.resourceInactive, undefined, 'offering_unavailable'],
    [SCHEDULING_SQLSTATE.windowMismatch, undefined, 'invalid_input'],
    [SCHEDULING_SQLSTATE.lifecycle, undefined, 'lifecycle_violation'],
    [SCHEDULING_SQLSTATE.immutable, undefined, 'lifecycle_violation'],
    [SCHEDULING_SQLSTATE.holdReactivation, undefined, 'lifecycle_violation'],
    [SCHEDULING_SQLSTATE.missingHold, undefined, 'lifecycle_violation'],
    ['23P01', 'scheduling_holds_no_overlap', 'resource_conflict'],
    ['23505', 'scheduling_reservations_dup_email_uk', 'duplicate_reservation'],
    ['23505', 'scheduling_reservations_dup_customer_uk', 'duplicate_reservation'],
    ['23505', 'scheduling_reservations_dup_series_uk', 'duplicate_reservation'],
    ['23505', 'scheduling_reservations_idem_uk', 'duplicate_reservation'],
    ['23505', 'scheduling_schedules_slug_uk', 'conflict'],
    ['23505', 'scheduling_occurrences_slot_uk', 'conflict'],
    ['23503', 'scheduling_holds_resource_fk', 'not_found'],
    ['23514', 'scheduling_holds_halfopen_ck', 'invalid_input'],
    ['23502', undefined, 'invalid_input'],
    ['22P02', undefined, 'invalid_input'],
  ];
  for (const [code, constraint, expected] of table) {
    it(`${code}${constraint ? ` (${constraint})` : ''} -> ${expected}`, () => {
      const mapped = mapPgError(pgError(code, constraint));
      expect(mapped).toBeInstanceOf(SchedulingError);
      expect(mapped?.code).toBe(expected);
      expect(mapped?.constraint).toBe(constraint ?? null);
    });
  }

  it('leaves operational failures UNMAPPED so they are never disguised as business refusals', () => {
    for (const code of ['40P01' /* deadlock */, '40001' /* serialization */, '55P03' /* lock timeout */, '57014' /* statement timeout */, '08006' /* connection */, '42P01' /* undefined table */]) {
      expect(mapPgError(pgError(code)), code).toBeNull();
    }
  });

  it('ignores anything that is not a Postgres error', () => {
    expect(mapPgError(new Error('plain'))).toBeNull();
    expect(mapPgError(null)).toBeNull();
    expect(mapPgError('SCCAP')).toBeNull();
    expect(mapPgError({ code: 'not-a-sqlstate' })).toBeNull();
    expect(sqlstateOf({ code: 'SCCAP' })).toBe('SCCAP');
  });

  it('translating() maps schema errors, passes success through and rethrows unknown errors unchanged', async () => {
    expect(await translating(async () => 7)).toBe(7);
    await expect(translating(async () => { throw pgError('SCCAP'); })).rejects.toMatchObject({ name: 'SchedulingError', code: 'capacity_exceeded' });
    const deadlock = pgError('40P01');
    await expect(translating(async () => { throw deadlock; })).rejects.toBe(deadlock);
  });

  it('the custom SQLSTATEs are exactly the ones the migration raises', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const sql = readFileSync(path.resolve(__dirname, '../../scheduling/sql/010_shared_schema.sql'), 'utf8');
    const raised = new Set([...sql.matchAll(/ERRCODE = '([A-Z0-9]{5})'/g)].map(m => m[1]));
    expect(raised).toEqual(new Set(Object.values(SCHEDULING_SQLSTATE)));
  });
});
