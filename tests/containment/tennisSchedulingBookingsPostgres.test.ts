import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import type { TenantContext } from '@scheduling/core';
import { CoachingBookings, type CoachingBookingInput } from '@/lib/scheduling/compatibility/tennis/coachingBookings';

const url = process.env.TENNIS_COACHING_TEST_URL;
if (url && (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || new URL(url).pathname !== '/tennis_coaching_proof')) throw new Error('Disposable loopback database required');
describe.skipIf(!url)('Canonical coaching booking operations on actual Scheduling schema', () => {
  const pool = new Pool({ connectionString: url, max: 15 });
  const sql = { async query<T>(text: string, values: readonly unknown[]) { return (await pool.query(text, [...values])).rows as T[]; } };
  const service = new CoachingBookings(sql);
  const tenant: TenantContext = { organisationId: 'synthetic', timezone: 'Australia/Adelaide', actor: { kind: 'staff', userId: 'synthetic-staff' }, can: () => true };
  const body = (suffix = '1'): CoachingBookingInput => ({ occurrenceId: 'occurrence', idempotencyKey: `synthetic-booking-${suffix}`, name: `Synthetic ${suffix}`, email: `synthetic${suffix}@example.invalid`, phone: null, notes: 'Synthetic only' });
  beforeAll(async () => {
    for (const file of ['010_shared_schema.sql', '030_resource_concurrency.sql', '031_reservation_integrity.sql', '032_schedule_archive_ordering.sql', '033_occurrence_integrity.sql', '034_availability_integrity.sql', '035_availability_partial_closures.sql', '036_availability_zones.sql', '037_availability_versions.sql']) {
      await pool.query(readFileSync(`packages/scheduling/sql/${file}`, 'utf8'));
    }
  }, 30000);
  beforeEach(async () => {
    await pool.query(`TRUNCATE scheduling_schedules,scheduling_resources CASCADE;
      INSERT INTO scheduling_schedules(id,organisation_id,name,preset_key,preset_version,cancellation_policy,timezone)
        VALUES('schedule','synthetic','Synthetic coaching','classes_coaching',1,'{}','Australia/Adelaide');
      INSERT INTO scheduling_offerings(id,organisation_id,schedule_id,name,price_cents,currency)
        VALUES('offering','synthetic','schedule','Synthetic class',1250,'AUD');
      INSERT INTO scheduling_occurrences(id,organisation_id,offering_id,local_date,local_start_time,timezone,starts_at,ends_at,capacity)
        VALUES('occurrence','synthetic','offering','2099-11-03','16:00','Australia/Adelaide','2099-11-03T05:30Z','2099-11-03T06:30Z',2);`);
  });
  afterAll(async () => { await pool.end(); });
  it('writes one canonical booking with immutable price/time snapshots and no legacy tables', async () => {
    const result = await service.enrol(tenant, body()); expect(result.ok).toBe(true);
    const saved = (await pool.query('SELECT price_cents,currency,local_start_time::text,party_size FROM scheduling_reservations')).rows[0];
    expect(saved).toEqual({ price_cents: 1250, currency: 'AUD', local_start_time: '16:00:00', party_size: 1 });
    expect((await pool.query("SELECT to_regclass('public.bookings') AS legacy")).rows[0].legacy).toBeNull();
  });
  it('replays an identical key but refuses different data on that key', async () => {
    const first = await service.enrol(tenant, body()); const replay = await service.enrol(tenant, body());
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await service.enrol(tenant, { ...body(), notes: 'Changed' })).toEqual({ ok: false, code: 'KEY_CONFLICT' });
    expect((await pool.query('SELECT count(*) FROM scheduling_reservations')).rows[0].count).toBe('1');
  });
  it('recovers a committed insert whose response was lost without inserting again', async () => {
    let inserts = 0;
    const unreliable = new CoachingBookings({ async query<T>(text: string, values: readonly unknown[]) {
      const result = await sql.query<T>(text, values);
      if (text.includes('INSERT INTO scheduling_reservations')) { inserts++; throw new Error('synthetic lost response'); }
      return result;
    } });
    expect(await unreliable.enrol(tenant, body())).toMatchObject({ ok: true, replayed: true });
    expect(inserts).toBe(1);
  });
  it('does not label an unreadable outcome as failure or retry the write', async () => {
    let inserted = false; let inserts = 0;
    const unavailable = new CoachingBookings({ async query<T>(text: string, values: readonly unknown[]) {
      if (inserted) throw new Error('synthetic recovery unavailable');
      const result = await sql.query<T>(text, values);
      if (text.includes('INSERT INTO scheduling_reservations')) { inserted = true; inserts++; throw new Error('synthetic lost response'); }
      return result;
    } });
    await expect(unavailable.enrol(tenant, body())).rejects.toThrow('recovery unavailable');
    expect(inserts).toBe(1); expect(await service.recover(tenant, body().idempotencyKey)).not.toBeNull();
  });
  it('serialises ten competitors for the final place', async () => {
    await pool.query("UPDATE scheduling_occurrences SET capacity=1 WHERE id='occurrence'");
    const results = await Promise.all(Array.from({ length: 10 }, (_, n) => service.enrol(tenant, body(String(n)))));
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.filter(r => !r.ok && r.code === 'FULL')).toHaveLength(9);
  });
  it('concurrent retries of one key resolve to the same booking', async () => {
    await pool.query("UPDATE scheduling_occurrences SET capacity=1 WHERE id='occurrence'");
    const results = await Promise.all(Array.from({ length: 6 }, () => service.enrol(tenant, body())));
    expect(results.every(r => r.ok)).toBe(true);
    expect(new Set(results.flatMap(r => r.ok ? [r.booking.id] : []))).toHaveProperty('size', 1);
  });
  it('preserves cancelled history and never revives a replayed booking', async () => {
    const result = await service.enrol(tenant, body()); if (!result.ok) throw Error('fixture');
    expect(await service.cancel(tenant, result.booking.id)).toMatchObject({ ok: true, booking: { status: 'cancelled' } });
    expect(await service.enrol(tenant, body())).toMatchObject({ ok: true, replayed: true, booking: { status: 'cancelled' } });
    expect((await pool.query('SELECT customer_name,cancelled_at,cancelled_by FROM scheduling_reservations')).rows[0]).toMatchObject({ customer_name: 'Synthetic 1', cancelled_by: 'staff' });
    expect(await service.enrol(tenant, { ...body(), idempotencyKey: 'explicit-new-booking' })).toMatchObject({ ok: true, replayed: false });
  });
  it('protects attendance and paid history from routine cancellation', async () => {
    const result = await service.enrol(tenant, body()); if (!result.ok) throw Error('fixture');
    expect(await service.attendance(tenant, result.booking.id, 'attended')).toMatchObject({ attendance: 'attended' });
    expect(await service.cancel(tenant, result.booking.id)).toEqual({ ok: false, code: 'PROTECTED_HISTORY' });
    await service.attendance(tenant, result.booking.id, null);
    await pool.query("UPDATE scheduling_reservations SET payment_status='paid'");
    expect(await service.cancel(tenant, result.booking.id)).toEqual({ ok: false, code: 'PROTECTED_HISTORY' });
  });
  it('denies foreign and revoked staff without changing data', async () => {
    await expect(service.enrol({ ...tenant, can: () => false }, body())).rejects.toThrow('permission denied');
    await expect(service.enrol({ ...tenant, actor: { kind: 'public' } }, body())).rejects.toThrow('permission denied');
    expect(await service.enrol({ ...tenant, organisationId: 'foreign' }, body())).toEqual({ ok: false, code: 'NOT_FOUND' });
    const saved = await service.enrol(tenant, body()); if (!saved.ok) throw Error('fixture');
    expect(await service.cancel({ ...tenant, organisationId: 'foreign' }, saved.booking.id)).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await service.attendance({ ...tenant, organisationId: 'foreign' }, saved.booking.id, 'absent')).toBeNull();
    expect(await service.recover({ ...tenant, organisationId: 'foreign' }, body().idempotencyKey)).toBeNull();
  });
  it('refuses archived schedules and cancelled occurrences without leaving a booking', async () => {
    await pool.query("UPDATE scheduling_schedules SET archived_at=now()");
    expect(await service.enrol(tenant, body())).toEqual({ ok: false, code: 'NOT_FOUND' });
    await pool.query("UPDATE scheduling_schedules SET archived_at=NULL; UPDATE scheduling_occurrences SET status='cancelled'");
    expect(await service.enrol(tenant, body())).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect((await pool.query('SELECT count(*) FROM scheduling_reservations')).rows[0].count).toBe('0');
  });
  it('refuses a second live email place without matching different identities by name', async () => {
    expect(await service.enrol(tenant, body())).toMatchObject({ ok: true });
    expect(await service.enrol(tenant, { ...body('2'), email: ' SYNTHETIC1@example.invalid ' })).toEqual({ ok: false, code: 'DUPLICATE' });
    expect(await service.enrol(tenant, { ...body('3'), name: body().name })).toMatchObject({ ok: true });
  });
  it('recovers a lost cancellation response without reviving or cancelling twice', async () => {
    const saved = await service.enrol(tenant, body()); if (!saved.ok) throw Error('fixture');
    const unreliable = new CoachingBookings({ async query<T>(text: string, params: readonly unknown[]) {
      const rows = await sql.query<T>(text, params);
      if (text.includes("status='cancelled',cancelled_at")) throw Error('synthetic lost cancellation');
      return rows;
    } });
    await expect(unreliable.cancel(tenant, saved.booking.id)).rejects.toThrow('lost cancellation');
    const before = (await pool.query('SELECT cancelled_at FROM scheduling_reservations')).rows[0].cancelled_at;
    expect(await service.cancel(tenant, saved.booking.id)).toMatchObject({ ok: true, replayed: true });
    expect((await pool.query('SELECT cancelled_at FROM scheduling_reservations')).rows[0].cancelled_at).toEqual(before);
    expect(await service.attendance(tenant, saved.booking.id, 'attended')).toBeNull();
  });
});
