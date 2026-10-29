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
    [SCHEDULING_SQLSTATE.resourceInUse, undefined, 'lifecycle_violation'],
    [SCHEDULING_SQLSTATE.allocationInUse, undefined, 'lifecycle_violation'],
    [SCHEDULING_SQLSTATE.linkRefused, undefined, 'invalid_input'],
    [SCHEDULING_SQLSTATE.partyFit, undefined, 'capacity_exceeded'],
    [SCHEDULING_SQLSTATE.notAssigned, undefined, 'offering_unavailable'],
    [SCHEDULING_SQLSTATE.archived, undefined, 'offering_unavailable'],
    [SCHEDULING_SQLSTATE.presetMismatch, undefined, 'invalid_input'],
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

  describe('55P03 lock timeout and 40P01 deadlock', () => {
    const TIMEOUT_MESSAGE = 'canceling statement due to lock timeout';
    const withWhere = (code: string, message: string, where: string) => Object.assign(pgError(code, undefined, message), { where });

    it('the lock_timeout expiring inside a scheduling statement becomes a retryable contention_timeout', () => {
      const mapped = mapPgError(pgError('55P03', undefined, TIMEOUT_MESSAGE));
      expect(mapped).toBeInstanceOf(SchedulingError);
      expect(mapped?.code).toBe('contention_timeout');
      expect(mapped?.retryable).toBe(true);
      expect(mapped?.message).toBe(TIMEOUT_MESSAGE); // the server's words are preserved for logs
    });

    it('is recognised from the PL/pgSQL context too, when the message is reworded by a driver', () => {
      const err = withWhere('55P03', 'timeout', 'PL/pgSQL function scheduling_reservation_guard() line 12 at SQL statement');
      expect(mapPgError(err)?.code).toBe('contention_timeout');
    });

    it('is NOT a business refusal: never capacity_exceeded, resource_conflict or offering_unavailable', () => {
      const mapped = mapPgError(pgError('55P03', undefined, TIMEOUT_MESSAGE));
      expect(['capacity_exceeded', 'resource_conflict', 'offering_unavailable', 'duplicate_reservation']).not.toContain(mapped?.code);
    });

    it('a 55P03 that is not our lock_timeout (NOWAIT, another system) stays raw', () => {
      expect(mapPgError(pgError('55P03', undefined, 'could not obtain lock on row in relation "ld_contacts"'))).toBeNull();
      expect(mapPgError(withWhere('55P03', 'x', 'PL/pgSQL function some_other_system() line 3'))).toBeNull();
    });

    it('a deadlock and a serialization failure are never translated or retried: they are defects to surface', async () => {
      for (const code of ['40P01', '40001']) {
        const e = pgError(code, undefined, 'deadlock detected');
        expect(mapPgError(e)).toBeNull();
        await expect(translating(async () => { throw e; })).rejects.toBe(e);
      }
    });

    it('translating() rethrows our timeout as a SchedulingError and any other 55P03 untouched', async () => {
      await expect(translating(async () => { throw pgError('55P03', undefined, TIMEOUT_MESSAGE); })).rejects.toMatchObject({ name: 'SchedulingError', code: 'contention_timeout' });
      const foreign = pgError('55P03', undefined, 'could not obtain lock on row');
      await expect(translating(async () => { throw foreign; })).rejects.toBe(foreign);
    });
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
    const sql = ['010_shared_schema.sql', '030_resource_concurrency.sql', '031_reservation_integrity.sql', '034_availability_integrity.sql', '036_availability_zones.sql'].map(f => readFileSync(path.resolve(__dirname, '../../scheduling/sql', f), 'utf8')).join(' ');
    const raised = new Set([...sql.matchAll(/ERRCODE = '([A-Z0-9]{5})'/g)].map(m => m[1]));
    expect(raised).toEqual(new Set(Object.values(SCHEDULING_SQLSTATE)));
  });
});
