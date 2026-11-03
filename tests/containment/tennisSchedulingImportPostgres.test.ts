import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { PostgresReservationRepository } from '@scheduling/postgres';
import { getPreset, validateReservationForPreset, type TenantContext } from '@scheduling/core';
import { importTennisHistory } from '@/lib/scheduling/compatibility/tennis/importHistory';
import { readCoachingRoster } from '@/lib/scheduling/compatibility/tennis/coachingHistory';

const url = process.env.TENNIS_IMPORT_TEST_URL;
if (url && (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || new URL(url).pathname !== '/tennis_import_proof')) throw Error('Owned disposable database required');
const org = '8ecd003b-583f-4616-a830-8dbf8aa51d2c';
describe.skipIf(!url)('Frozen Tennis history import into actual Scheduling tables', () => {
  const pool = new Pool({ connectionString: url });
  const sql = { async query<T>(text: string, params: readonly unknown[] = []) { return (await pool.query(text, [...params])).rows as T[]; } };
  const tenant: TenantContext = { organisationId: org, timezone: 'Australia/Adelaide', actor: { kind: 'staff', userId: 'synthetic' }, can: () => true };
  let hash: string;
  beforeAll(async () => {
    for (const file of ['010_shared_schema.sql', '030_resource_concurrency.sql', '031_reservation_integrity.sql', '032_schedule_archive_ordering.sql', '033_occurrence_integrity.sql', '034_availability_integrity.sql', '035_availability_partial_closures.sql', '036_availability_zones.sql', '037_availability_versions.sql']) await pool.query(readFileSync(`packages/scheduling/sql/${file}`, 'utf8'));
    await pool.query(`CREATE TABLE organisations(id text PRIMARY KEY,slug text,status text,timezone text);
      CREATE TABLE sessions(id text PRIMARY KEY,organisation_id text,name text,session_type text,session_colour_key text,day_of_week int,start_date date,end_mode text,end_after_weeks int,end_date date,start_time time,duration_minutes int,max_capacity int,price_per_session numeric,archived_at timestamptz);
      CREATE TABLE session_instances(id text PRIMARY KEY,organisation_id text,session_id text,date date,start_time time,duration_minutes int,max_capacity int,status text);
      CREATE TABLE bookings(id text PRIMARY KEY,organisation_id text,session_id text,session_instance_id text,client_name text,client_email text,status text,paid boolean,attendance_status text,is_recurring boolean,recurring_group_id text,notes text,created_at timestamp);
      CREATE TABLE booking_recurrence_pauses(id text PRIMARY KEY,organisation_id text,session_id text,recurring_group_id text,pause_from date,pause_until date,reason text);
      CREATE TABLE session_types(id text PRIMARY KEY,organisation_id text,name text,slug text,colour_key text,active boolean);`);
    await pool.query(readFileSync('scripts/scheduling/tennis-coaching-operations.sql', 'utf8'));
    await pool.query(readFileSync('scripts/scheduling/tennis-history-cutover.sql', 'utf8'));
    const migration = readFileSync('scripts/scheduling/tennis-canonical-import.sql', 'utf8');
    try { await pool.query(migration); }
    catch (error) {
      const position = Number((error as { position?: string }).position);
      throw Error(`Import migration failed at line ${migration.slice(0, position).split('\n').length}: ${(error as Error).message}`, { cause: error });
    }
  }, 30000);
  beforeEach(async () => {
    await pool.query(`TRUNCATE scheduling_schedules,scheduling_resources,scheduling_settings,scheduling_coaching_commands,scheduling_tennis_import_receipts,scheduling_tennis_booking_origins,scheduling_tennis_history,scheduling_tennis_cutover,organisations,sessions,session_instances,bookings,booking_recurrence_pauses,session_types CASCADE`);
    await pool.query("INSERT INTO organisations VALUES($1,'ld-tennis','ACTIVE','Australia/Adelaide'),('other','other','ACTIVE','Australia/Adelaide')", [org]);
    await pool.query("INSERT INTO scheduling_settings(organisation_id,currency) VALUES($1,'AUD')", [org]);
    await pool.query("INSERT INTO sessions VALUES('s',$1,'Synthetic coaching','junior','blue',2,'2099-11-03','ongoing',NULL,NULL,'16:00',60,2,12.50,NULL)", [org]);
    await pool.query("INSERT INTO session_instances VALUES('i',$1,'s','2099-11-03','16:00',60,2,'scheduled'),('closed',$1,'s','2099-11-10','16:00',60,2,'cancelled')", [org]);
    await pool.query("INSERT INTO bookings VALUES('b',$1,'s','i','Synthetic player','synthetic@example.invalid','confirmed',true,'attending',true,'g','Original notes','2026-01-01'),('cancelled',$1,'s','closed','Synthetic player','synthetic@example.invalid','cancelled',false,NULL,false,'g','Cancellation history','2026-01-02')", [org]);
    await pool.query("INSERT INTO booking_recurrence_pauses VALUES('p',$1,'s','g','2099-12-01','2099-12-08','Original pause reason')", [org]);
    await pool.query("INSERT INTO session_types VALUES('t',$1,'Junior coaching','junior','blue',true)", [org]);
    await pool.query('SELECT scheduling_tennis_prepare_history($1)', [org]);
    hash = (await pool.query('SELECT scheduling_tennis_manifest($1) hash', [org])).rows[0].hash;
  });
  afterAll(async () => { await pool.end(); });
  async function freezeAndCapture() {
    hash = (await pool.query('SELECT scheduling_tennis_manifest($1) hash', [org])).rows[0].hash;
    await pool.query("UPDATE scheduling_tennis_cutover SET phase='frozen' WHERE organisation_id=$1", [org]);
    await pool.query('SELECT * FROM scheduling_tennis_capture_history($1,$2)', [org, hash]);
  }
  it('imports offerings, dated occurrences, lineage and pauses while preserving complete cancelled history', async () => {
    await freezeAndCapture(); const receipt = await importTennisHistory(sql, org, hash);
    expect(receipt.counts).toEqual({ sourceBookings: 2, canonicalBookings: 1, cancelledHistory: 1 });
    expect((await pool.query('SELECT id,name,price_cents,type_key,colour_key FROM scheduling_offerings')).rows).toEqual([{ id: 's', name: 'Synthetic coaching', price_cents: 1250, type_key: 'junior', colour_key: 'blue' }]);
    expect((await pool.query('SELECT id,status FROM scheduling_occurrences ORDER BY id')).rows).toEqual([{ id: 'closed', status: 'cancelled' }, { id: 'i', status: 'scheduled' }]);
    expect((await pool.query('SELECT id,status FROM scheduling_series')).rows).toEqual([{ id: 'g', status: 'active' }]);
    expect((await pool.query('SELECT id,reason FROM scheduling_series_pauses')).rows).toEqual([{ id: 'p', reason: 'Original pause reason' }]);
    expect((await pool.query("SELECT source_row->>'notes' notes,source_row ? 'cancelled_at' fabricated FROM scheduling_tennis_history WHERE source_id='cancelled'")).rows).toEqual([{ notes: 'Cancellation history', fabricated: false }]);
    expect((await pool.query('SELECT phase FROM scheduling_tennis_cutover')).rows[0].phase).toBe('frozen');
  });
  it('reads the canonical roster and cancelled history with explicit unknown facts and stable paging', async () => {
    await pool.query("UPDATE bookings SET session_instance_id='i' WHERE id='cancelled'");
    await freezeAndCapture(); await importTennisHistory(sql, org, hash);
    const first = await readCoachingRoster(sql, tenant, 'i', { limit: 1 });
    expect(first).toMatchObject({ occurrence: { id: 'i', name: 'Synthetic coaching', capacity: 2 }, next: 'b', rows: [
      { id: 'b', historyOnly: false, priceCents: null, paidMarker: true, markerVersion: 1, attendance: 'attended', attendanceVersion: 0, originalCreatedAt: '2026-01-01T00:00:00' },
    ] });
    expect(await readCoachingRoster(sql, tenant, 'i', { after: first!.next!, limit: 1 })).toMatchObject({ next: null, rows: [
      { id: 'cancelled', historyOnly: true, status: 'cancelled', priceCents: null, cancelledAt: null, markerVersion: null, attendanceVersion: null, notes: 'Cancellation history' },
    ] });
    const whole = await readCoachingRoster(sql, tenant, 'i');
    expect(whole!.rows.map(r => r.id)).toEqual(['b', 'cancelled']);
    expect(whole!.rows.every(r => !('original' in r) && !('source_row' in r))).toBe(true);
  });
  it('refuses roster disclosure without staff permission, tenant ownership or a complete import receipt', async () => {
    expect(await readCoachingRoster(sql, tenant, 'i')).toBeNull();
    await freezeAndCapture(); await importTennisHistory(sql, org, hash);
    expect(await readCoachingRoster(sql, { ...tenant, organisationId: 'other' }, 'i')).toBeNull();
    await expect(readCoachingRoster(sql, { ...tenant, actor: { kind: 'public' } }, 'i')).rejects.toThrow('permission denied');
    await expect(readCoachingRoster(sql, { ...tenant, can: () => false }, 'i')).rejects.toThrow('permission denied');
    await expect(readCoachingRoster(sql, tenant, 'i', { limit: 101 })).rejects.toThrow('Invalid');
  });
  it('keeps unknown historical price distinct from free and paid markers distinct from payments', async () => {
    await freezeAndCapture(); await importTennisHistory(sql, org, hash);
    const repo = new PostgresReservationRepository({ sql, clock: { now: () => new Date(), today: () => '2026-11-03' } });
    const booking = await repo.getById(tenant, 'b');
    expect(booking).toMatchObject({ price: null, paymentStatus: 'unpaid', attendance: 'attended', seriesId: 'g', notes: 'Original notes' });
    expect(validateReservationForPreset(booking!, getPreset('classes_coaching'), { asSnapshotted: true })).toEqual([]);
    expect(validateReservationForPreset(booking!, getPreset('classes_coaching'))).toContain('price must be a non-negative integer number of cents');
    expect((await pool.query('SELECT original_paid_marker FROM scheduling_tennis_booking_origins')).rows[0].original_paid_marker).toBe(true);
  });
  it('replays the same import exactly without changing either source or target hashes', async () => {
    await freezeAndCapture(); const first = await importTennisHistory(sql, org, hash);
    expect(await importTennisHistory(sql, org, hash)).toEqual(first);
    expect((await pool.query('SELECT scheduling_tennis_manifest($1) hash', [org])).rows[0].hash).toBe(hash);
    expect((await pool.query('SELECT count(*) FROM scheduling_reservations')).rows[0].count).toBe('1');
  });
  it('refuses unfrozen, stale or foreign imports without creating a schedule', async () => {
    await expect(importTennisHistory(sql, org, hash)).rejects.toMatchObject({ code: 'STFRZ' });
    await freezeAndCapture();
    await expect(importTennisHistory(sql, org, '0'.repeat(64))).rejects.toMatchObject({ code: 'STCHG' });
    await expect(importTennisHistory(sql, 'other', hash)).rejects.toThrow('unavailable');
    expect((await pool.query('SELECT count(*) FROM scheduling_schedules')).rows[0].count).toBe('0');
  });
  it('rolls back the whole import if an offering id collides with unrelated Scheduling work', async () => {
    await pool.query("INSERT INTO scheduling_schedules(id,organisation_id,name,preset_key,preset_version,cancellation_policy) VALUES('other-schedule',$1,'Other','classes_coaching',1,'{}')", [org]);
    await pool.query("INSERT INTO scheduling_offerings(id,organisation_id,schedule_id,name,currency) VALUES('s',$1,'other-schedule','Other','AUD')", [org]);
    await freezeAndCapture(); await expect(importTennisHistory(sql, org, hash)).rejects.toMatchObject({ code: '23505' });
    expect((await pool.query("SELECT count(*) FROM scheduling_schedules WHERE id='tennis-coaching'")).rows[0].count).toBe('0');
    expect((await pool.query("SELECT name FROM scheduling_offerings WHERE id='s'")).rows[0].name).toBe('Other');
    expect((await pool.query('SELECT count(*) FROM scheduling_tennis_import_receipts')).rows[0].count).toBe('0');
  });
  it('rejects source mismatches before any target writes', async () => {
    await pool.query("UPDATE bookings SET session_instance_id='missing' WHERE id='b'"); await freezeAndCapture();
    await expect(importTennisHistory(sql, org, hash)).rejects.toThrow('MISSING_PARENT');
    expect((await pool.query('SELECT count(*) FROM scheduling_schedules')).rows[0].count).toBe('0');
  });
  it('keeps both ledgers frozen after import and rejects receipt edits', async () => {
    await freezeAndCapture(); const receipt = await importTennisHistory(sql, org, hash);
    for (const statement of [
      "UPDATE scheduling_schedules SET name='Changed' WHERE id='tennis-coaching'",
      "UPDATE scheduling_offerings SET price_cents=999 WHERE id='s'",
      "UPDATE scheduling_occurrences SET capacity=3 WHERE id='i'",
      "UPDATE scheduling_reservations SET attendance='absent' WHERE id='b'",
      "UPDATE scheduling_series SET status='ended' WHERE id='g'",
      "DELETE FROM scheduling_series_pauses WHERE id='p'",
      "UPDATE bookings SET notes='Changed' WHERE id='b'",
    ]) await expect(pool.query(statement)).rejects.toMatchObject({ code: 'STFRZ' });
    await expect(pool.query("UPDATE scheduling_tennis_import_receipts SET target_hash='forged'")).rejects.toMatchObject({ code: 'STHIS' });
    expect(await importTennisHistory(sql, org, hash)).toEqual(receipt);
  });
  it('detects timezone and currency changes after history capture', async () => {
    await freezeAndCapture(); await pool.query("UPDATE scheduling_settings SET currency='USD'");
    await expect(importTennisHistory(sql, org, hash)).rejects.toMatchObject({ code: 'STCHG' });
    await pool.query("UPDATE scheduling_settings SET currency='AUD'; UPDATE organisations SET timezone='Australia/Sydney'");
    await expect(importTennisHistory(sql, org, hash)).rejects.toMatchObject({ code: 'STCHG' });
    expect((await pool.query('SELECT count(*) FROM scheduling_schedules')).rows[0].count).toBe('0');
  });
  it('does not resurrect a stopped recurring lineage', async () => {
    await pool.query('UPDATE bookings SET is_recurring=false'); await freezeAndCapture(); await importTennisHistory(sql, org, hash);
    expect((await pool.query('SELECT status FROM scheduling_series')).rows[0].status).toBe('ended');
  });
  it('rejects unknown prices for ordinary bookings without captured provenance', async () => {
    await pool.query("INSERT INTO scheduling_schedules(id,organisation_id,name,preset_key,preset_version,cancellation_policy) VALUES('ordinary',$1,'Ordinary','classes_coaching',1,'{}')", [org]);
    await pool.query("INSERT INTO scheduling_offerings(id,organisation_id,schedule_id,name,currency) VALUES('ordinary-offer',$1,'ordinary','Ordinary','AUD')", [org]);
    await pool.query("INSERT INTO scheduling_occurrences(id,organisation_id,offering_id,local_date,local_start_time,timezone,starts_at,ends_at,capacity) VALUES('ordinary-occ',$1,'ordinary-offer','2099-11-03','16:00','Australia/Adelaide','2099-11-03T05:30Z','2099-11-03T06:30Z',2)", [org]);
    await expect(pool.query(`INSERT INTO scheduling_reservations(id,organisation_id,schedule_id,preset_key,preset_version,offering_id,span_kind,occurrence_id,customer_name,timezone,
      local_start_date,local_start_time,local_end_date,local_end_time,starts_at,ends_at,party_size,price_cents,currency)
      VALUES('ordinary-booking',$1,'ordinary','classes_coaching',1,'ordinary-offer','occurrence','ordinary-occ','Synthetic','Australia/Adelaide',
      '2099-11-03','16:00','2099-11-03','17:00','2099-11-03T05:30Z','2099-11-03T06:30Z',1,NULL,'AUD')`, [org])).rejects.toMatchObject({ code: 'STPRC' });
    expect((await pool.query("SELECT count(*) FROM scheduling_reservations WHERE id='ordinary-booking'")).rows[0].count).toBe('0');
  });
  it('imports protected bookings within a pause without cancelling them or suppressing the warning', async () => {
    await pool.query("UPDATE booking_recurrence_pauses SET pause_from='2099-11-03',pause_until='2099-11-03'");
    await freezeAndCapture(); const receipt = await importTennisHistory(sql, org, hash);
    expect(receipt.warnings).toContainEqual({ source: 'bookings', id: 'b', code: 'LIVE_BOOKING_IN_PAUSE' });
    expect((await pool.query("SELECT status,attendance FROM scheduling_reservations WHERE id='b'")).rows[0]).toEqual({ status: 'confirmed', attendance: 'attended' });
    expect((await pool.query("SELECT paid_marker FROM scheduling_coaching_markers WHERE reservation_id='b'")).rows[0].paid_marker).toBe(true);
  });
});
