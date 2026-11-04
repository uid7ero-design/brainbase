import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import type { TenantContext } from '@scheduling/core';
import { CoachingBookings, type CoachingBookingInput } from '@/lib/scheduling/compatibility/tennis/coachingBookings';
import { CoachingCommands } from '@/lib/scheduling/compatibility/tennis/coachingCommands';
import { CoachingClasses } from '@/lib/scheduling/compatibility/tennis/coachingClasses';

const url = process.env.TENNIS_COACHING_TEST_URL;
if (url && (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || new URL(url).pathname !== '/tennis_coaching_proof')) throw new Error('Disposable loopback database required');
describe.skipIf(!url)('Canonical coaching booking operations on actual Scheduling schema', () => {
  const pool = new Pool({ connectionString: url, max: 15 });
  const sql = { async query<T>(text: string, values: readonly unknown[]) { return (await pool.query(text, [...values])).rows as T[]; } };
  const service = new CoachingBookings(sql);
  const commands = new CoachingCommands(sql);
  const classes = new CoachingClasses(sql);
  const tenant: TenantContext = { organisationId: 'synthetic', timezone: 'Australia/Adelaide', actor: { kind: 'staff', userId: 'synthetic-staff' }, can: () => true };
  const body = (suffix = '1'): CoachingBookingInput => ({ occurrenceId: 'occurrence', idempotencyKey: `synthetic-booking-${suffix}`, name: `Synthetic ${suffix}`, email: `synthetic${suffix}@example.invalid`, phone: null, notes: 'Synthetic only' });
  beforeAll(async () => {
    for (const file of ['010_shared_schema.sql', '030_resource_concurrency.sql', '031_reservation_integrity.sql', '032_schedule_archive_ordering.sql', '033_occurrence_integrity.sql', '034_availability_integrity.sql', '035_availability_partial_closures.sql', '036_availability_zones.sql', '037_availability_versions.sql']) {
      await pool.query(readFileSync(`packages/scheduling/sql/${file}`, 'utf8'));
    }
    await pool.query(readFileSync('scripts/scheduling/tennis-coaching-operations.sql', 'utf8'));
  }, 30000);
  beforeEach(async () => {
    await pool.query(`TRUNCATE scheduling_schedules,scheduling_resources,scheduling_coaching_commands CASCADE;
      INSERT INTO scheduling_schedules(id,organisation_id,name,preset_key,preset_version,cancellation_policy,timezone)
        VALUES('schedule','synthetic','Synthetic coaching','classes_coaching',1,'{}','Australia/Adelaide');
      INSERT INTO scheduling_offerings(id,organisation_id,schedule_id,name,price_cents,currency)
        VALUES('offering','synthetic','schedule','Synthetic class',1250,'AUD');
      INSERT INTO scheduling_occurrences(id,organisation_id,offering_id,local_date,local_start_time,timezone,starts_at,ends_at,capacity)
        VALUES('occurrence','synthetic','offering','2099-11-03','16:00','Australia/Adelaide','2099-11-03T05:30Z','2099-11-03T06:30Z',2);`);
  });
  afterAll(async () => { await pool.end(); });
  async function seedSeries() {
    await pool.query(`INSERT INTO scheduling_series(id,organisation_id,offering_id,customer_name,customer_email,customer_email_normalised,timezone)
      VALUES('g','synthetic','offering','Synthetic weekly','weekly@example.invalid','weekly@example.invalid','Australia/Adelaide');
      INSERT INTO scheduling_occurrences(id,organisation_id,offering_id,local_date,local_start_time,timezone,starts_at,ends_at,capacity)
      VALUES('next','synthetic','offering','2099-11-10','16:00','Australia/Adelaide','2099-11-10T05:30Z','2099-11-10T06:30Z',2);`);
  }
  async function recurringClass() {
    await pool.query(`UPDATE scheduling_offerings SET duration_minutes=60,capacity=2,start_time='16:00',recurrence_kind='weekly',
      recurrence_day_of_week=2,recurrence_start_date='2099-11-03',recurrence_end_mode='ongoing' WHERE id='offering'`);
  }
  it('keeps the HTTP command unavailable before a receipted cutover is installed', async () => {
    await recurringClass();
    await expect(classes.generateLive(tenant,'offering','2099-11-03','generate-before-cutover')).rejects.toMatchObject({code:'STOFF'});
    expect((await pool.query('SELECT count(*) FROM scheduling_occurrences')).rows[0].count).toBe('1');
  });
  it('generates the inclusive Tennis horizon once and recovers a lost generation response', async () => {
    await recurringClass(); let writes=0;
    const unreliable = new CoachingClasses({ async query<T>(text: string, values: readonly unknown[]) {
      const result=await sql.query<T>(text,values);
      if (text.includes('SELECT scheduling_coaching_generate_classes')) { writes++; throw Error('lost generation response'); }
      return result;
    } });
    const first=await unreliable.generate(tenant,'offering','2099-11-03','generate-horizon-first');
    expect(writes).toBe(1); expect(first.created).toHaveLength(10);
    expect(first.created.at(-1)?.date).toBe('2100-01-12');
    expect(await classes.generate(tenant,'offering','2099-11-03','generate-horizon-first')).toEqual(first);
    expect(await classes.savedGeneration(tenant,'offering','generate-horizon-first')).toEqual(first);
    expect(await classes.savedGeneration({...tenant,organisationId:'foreign'},'offering','generate-horizon-first')).toBeNull();
    expect(await classes.savedGeneration(tenant,'other-offering','generate-horizon-first')).toBeNull();
    const again=await classes.generate(tenant,'offering','2099-11-03','generate-horizon-again');
    expect(again.created).toEqual([]); expect(again.skipped).toHaveLength(11);
    expect((await pool.query('SELECT count(*) FROM scheduling_occurrences')).rows[0].count).toBe('11');
  });
  it('rejects configuration changed after planning without leaving partial dates', async () => {
    await recurringClass();
    const stale = new CoachingClasses({ async query<T>(text: string, values: readonly unknown[]) {
      if (text.includes('SELECT scheduling_coaching_generate_classes')) await pool.query("UPDATE scheduling_offerings SET capacity=3 WHERE id='offering'");
      return sql.query<T>(text, values);
    } });
    await expect(stale.generate(tenant,'offering','2099-11-03','generate-stale-class')).rejects.toMatchObject({ code:'STCHG' });
    expect((await pool.query('SELECT count(*) FROM scheduling_occurrences')).rows[0].count).toBe('1');
  });
  it('does not revive cancelled classes and denies tenant or manage-permission bypasses', async () => {
    await recurringClass(); await pool.query("UPDATE scheduling_occurrences SET status='cancelled' WHERE id='occurrence'");
    const result=await classes.generate(tenant,'offering','2099-11-03','generate-cancelled-class');
    expect(result.skipped).toContainEqual({date:'2099-11-03',startTime:'16:00',reason:'cancelled_stays_cancelled'});
    await expect(classes.generate({...tenant,can:()=>false},'offering','2099-11-03','generate-denied-class')).rejects.toThrow('permission denied');
    await expect(classes.generate({...tenant,organisationId:'foreign'},'offering','2099-11-03','generate-foreign-class')).rejects.toMatchObject({code:'STCLS'});
  });
  it('keeps local class times stable through daylight saving and reports a nonexistent local time', async () => {
    await recurringClass();
    await pool.query("UPDATE scheduling_offerings SET recurrence_day_of_week=0,recurrence_start_date='2026-09-27',start_time='02:30' WHERE id='offering'");
    const result=await classes.generate(tenant,'offering','2026-09-27','generate-dst-gap-class');
    expect(result.skipped).toContainEqual({date:'2026-10-04',startTime:'02:30',reason:'nonexistent_local_time'});
    const rows=(await pool.query("SELECT local_date::text,to_char(starts_at AT TIME ZONE 'UTC','HH24:MI') utc FROM scheduling_occurrences WHERE local_date IN ('2026-09-27','2026-10-11') ORDER BY local_date")).rows;
    expect(rows).toEqual([{local_date:'2026-09-27',utc:'17:00'},{local_date:'2026-10-11',utc:'16:00'}]);
  });
  it('atomically enrols a new weekly player and recovers a lost response without duplicating the first place or lineage', async () => {
    await seedSeries();
    let writes = 0;
    const unreliable = new CoachingCommands({ async query<T>(text: string, values: readonly unknown[]) {
      const result = await sql.query<T>(text, values);
      if (text.includes('scheduling_coaching_enrol_weekly')) { writes++; throw Error('lost weekly response'); }
      return result;
    } });
    const first = await unreliable.enrolWeekly(tenant, body(), '2099-11-10');
    expect(writes).toBe(1);
    expect(first.refill.created).toHaveLength(1);
    expect(first.refill.alreadyPresent).toBe(1);
    expect(await commands.enrolWeekly(tenant, body(), '2099-11-10')).toEqual(first);
    expect((await pool.query('SELECT count(*) FROM scheduling_reservations')).rows[0].count).toBe('2');
    expect((await pool.query('SELECT series_id FROM scheduling_coaching_series_links')).rows).toEqual([{ series_id: first.seriesId }]);
    await expect(commands.enrolWeekly(tenant, { ...body(), name: 'Different player' }, '2099-11-10')).rejects.toMatchObject({ code: 'STKEY' });
  });
  it('rolls back the initial weekly booking, links and future places if the terminal receipt cannot persist', async () => {
    await seedSeries();
    await pool.query(`CREATE FUNCTION reject_weekly_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.request->>'kind'='enrol-weekly' THEN RAISE EXCEPTION 'synthetic receipt failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_weekly_receipt BEFORE INSERT ON scheduling_coaching_commands FOR EACH ROW EXECUTE FUNCTION reject_weekly_receipt();`);
    try {
      await expect(commands.enrolWeekly(tenant, body(), '2099-11-10')).rejects.toThrow('synthetic receipt failure');
      expect((await pool.query('SELECT count(*) FROM scheduling_reservations')).rows[0].count).toBe('0');
      expect((await pool.query('SELECT count(*) FROM scheduling_coaching_series_links')).rows[0].count).toBe('0');
      expect((await pool.query('SELECT count(*) FROM scheduling_coaching_commands')).rows[0].count).toBe('0');
      expect((await pool.query("SELECT id FROM scheduling_series WHERE id<>'g'")).rows).toEqual([]);
    } finally { await pool.query('DROP TRIGGER reject_weekly_receipt ON scheduling_coaching_commands; DROP FUNCTION reject_weekly_receipt()'); }
  });
  it('serialises weekly final-place competitors without orphan lineage or a partial enrolment', async () => {
    await seedSeries(); await pool.query("UPDATE scheduling_occurrences SET capacity=1 WHERE id='occurrence'");
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, n) => commands.enrolWeekly(tenant, body(String(n)), '2099-11-10')));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(4);
    expect((await pool.query('SELECT count(*) FROM scheduling_reservations')).rows[0].count).toBe('2');
    expect((await pool.query('SELECT count(*) FROM scheduling_coaching_series_links')).rows[0].count).toBe('1');
  });
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
    expect(await service.attendance(tenant, result.booking.id, 'attended', 0, 'attendance-mark-here')).toMatchObject({ attendance: 'attended' });
    expect(await service.cancel(tenant, result.booking.id)).toEqual({ ok: false, code: 'PROTECTED_HISTORY' });
    await service.attendance(tenant, result.booking.id, null, 1, 'attendance-clear-here');
    await pool.query("UPDATE scheduling_reservations SET payment_status='paid'");
    expect(await service.cancel(tenant, result.booking.id)).toEqual({ ok: false, code: 'PROTECTED_HISTORY' });
  });
  it('recovers lost attendance responses and never replays an old correction over a newer one', async () => {
    const saved = await service.enrol(tenant, body()); if (!saved.ok) throw Error('fixture');
    let writes = 0;
    const unreliable = new CoachingBookings({ async query<T>(text: string, values: readonly unknown[]) {
      const result = await sql.query<T>(text, values);
      if (text.includes('scheduling_coaching_set_attendance')) { writes++; throw Error('lost attendance response'); }
      return result;
    } });
    expect(await unreliable.attendance(tenant, saved.booking.id, 'attended', 0, 'attendance-lost-first')).toMatchObject({ attendance: 'attended', coaching_attendance_version: 1 });
    expect(writes).toBe(1);
    await service.attendance(tenant, saved.booking.id, null, 1, 'attendance-new-clear');
    expect(await service.attendance(tenant, saved.booking.id, 'attended', 0, 'attendance-lost-first')).toMatchObject({ attendance: 'attended', coaching_attendance_version: 1 });
    await expect(service.attendance(tenant, saved.booking.id, 'absent', 0, 'attendance-stale-new')).rejects.toMatchObject({ code: 'STCHG' });
    expect((await pool.query('SELECT attendance,coaching_attendance_version FROM scheduling_reservations')).rows).toEqual([{ attendance: null, coaching_attendance_version: 2 }]);
    await expect(service.attendance(tenant, saved.booking.id, 'absent', 0, 'attendance-lost-first')).rejects.toMatchObject({ code: 'STKEY' });
  });
  it('serialises competing attendance corrections and checks the attendance capability', async () => {
    const saved = await service.enrol(tenant, body()); if (!saved.ok) throw Error('fixture');
    await expect(service.attendance({ ...tenant, can: p => p !== 'scheduling.attendance' }, saved.booking.id, 'attended', 0, 'attendance-no-grant')).rejects.toThrow('permission denied');
    const outcomes = await Promise.allSettled([
      service.attendance(tenant, saved.booking.id, 'attended', 0, 'attendance-compete-a'),
      service.attendance(tenant, saved.booking.id, 'absent', 0, 'attendance-compete-b'),
    ]);
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect((await pool.query('SELECT coaching_attendance_version FROM scheduling_reservations')).rows[0].coaching_attendance_version).toBe(1);
  });
  it('denies foreign and revoked staff without changing data', async () => {
    await expect(service.enrol({ ...tenant, can: () => false }, body())).rejects.toThrow('permission denied');
    await expect(service.enrol({ ...tenant, actor: { kind: 'public' } }, body())).rejects.toThrow('permission denied');
    expect(await service.enrol({ ...tenant, organisationId: 'foreign' }, body())).toEqual({ ok: false, code: 'NOT_FOUND' });
    const saved = await service.enrol(tenant, body()); if (!saved.ok) throw Error('fixture');
    expect(await service.cancel({ ...tenant, organisationId: 'foreign' }, saved.booking.id)).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await service.attendance({ ...tenant, organisationId: 'foreign' }, saved.booking.id, 'absent', 0, 'attendance-foreign-deny')).toBeNull();
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
      if (text.includes('scheduling_coaching_cancel_booking')) throw Error('synthetic lost cancellation');
      return rows;
    } });
    await expect(unreliable.cancel(tenant, saved.booking.id)).rejects.toThrow('lost cancellation');
    const before = (await pool.query('SELECT cancelled_at FROM scheduling_reservations')).rows[0].cancelled_at;
    expect(await service.cancel(tenant, saved.booking.id)).toMatchObject({ ok: true, replayed: true });
    expect((await pool.query('SELECT cancelled_at FROM scheduling_reservations')).rows[0].cancelled_at).toEqual(before);
    expect(await service.attendance(tenant, saved.booking.id, 'attended', 0, 'attendance-cancelled-deny')).toBeNull();
  });
  it('fills a recurring lineage once, with stable replay and no changed-payload replay', async () => {
    await seedSeries();
    const first = await commands.fill(tenant, 'g', '2099-11-03', '2099-11-10', 'fill-series-original');
    expect(first.created).toHaveLength(2); expect(first.fullDates).toEqual([]);
    expect(await commands.fill(tenant, 'g', '2099-11-03', '2099-11-10', 'fill-series-original')).toEqual(first);
    await expect(commands.fill(tenant, 'g', '2099-11-03', '2099-11-17', 'fill-series-original')).rejects.toMatchObject({ code: 'STKEY' });
    expect((await commands.fill(tenant, 'g', '2099-11-03', '2099-11-10', 'fill-series-explicit')).alreadyPresent).toBe(2);
    expect((await pool.query('SELECT count(*) FROM scheduling_reservations')).rows[0].count).toBe('2');
  });
  it('reports capacity-blocked and paused dates instead of overbooking or silently skipping them', async () => {
    await seedSeries();
    await pool.query("UPDATE scheduling_occurrences SET capacity=1 WHERE id='occurrence'");
    await service.enrol(tenant, body());
    await commands.pause(tenant, 'g', '2099-11-10', '2099-11-10', 'Synthetic pause', 'pause-before-fill');
    expect(await commands.fill(tenant, 'g', '2099-11-03', '2099-11-10', 'fill-blocked-dates')).toEqual({ created: [], fullDates: ['2099-11-03'], pausedDates: ['2099-11-10'], alreadyPresent: 0 });
  });
  it('pauses future places but preserves paid markers and original cancellation history', async () => {
    await seedSeries(); const filled = await commands.fill(tenant, 'g', '2099-11-03', '2099-11-10', 'fill-before-pause');
    const paid = filled.created.find(r => r.date === '2099-11-03')!.id;
    expect(await commands.markPaid(tenant, paid, true, 0, 'mark-coaching-paid')).toEqual({ paidMarker: true, version: 1 });
    const paused = await commands.pause(tenant, 'g', '2099-11-03', '2099-11-10', 'Synthetic pause', 'pause-the-lineage');
    expect(paused.protected).toEqual([paid]); expect(paused.cancelled).toHaveLength(1);
    expect(await commands.pause(tenant, 'g', '2099-11-03', '2099-11-10', 'Synthetic pause', 'pause-the-lineage')).toEqual(paused);
    expect(await service.cancel(tenant, paid)).toEqual({ ok: false, code: 'PROTECTED_HISTORY' });
    expect((await pool.query('SELECT DISTINCT payment_status FROM scheduling_reservations')).rows).toEqual([{ payment_status: 'unpaid' }]);
  });
  it('uses marker versions and command receipts so a stale retry never overwrites a newer marker', async () => {
    const saved = await service.enrol(tenant, body()); if (!saved.ok) throw Error('fixture');
    await commands.markPaid(tenant, saved.booking.id, true, 0, 'first-paid-marker');
    await commands.markPaid(tenant, saved.booking.id, false, 1, 'second-paid-marker');
    expect(await commands.markPaid(tenant, saved.booking.id, true, 0, 'first-paid-marker')).toEqual({ paidMarker: true, version: 1 });
    await expect(commands.markPaid(tenant, saved.booking.id, true, 0, 'stale-paid-marker')).rejects.toMatchObject({ code: 'STCHG' });
    expect((await pool.query('SELECT paid_marker,version FROM scheduling_coaching_markers')).rows).toEqual([{ paid_marker: false, version: 2 }]);
  });
  it('recovers a committed recurring command whose response was lost without refilling', async () => {
    await seedSeries(); let writes = 0;
    const unreliable = new CoachingCommands({ async query<T>(text: string, params: readonly unknown[]) {
      const rows = await sql.query<T>(text, params);
      if (text.includes('SELECT scheduling_coaching_fill_series')) { writes++; throw Error('Synthetic lost fill response'); }
      return rows;
    } });
    expect((await unreliable.fill(tenant, 'g', '2099-11-03', '2099-11-10', 'lost-fill-response')).created).toHaveLength(2);
    expect(writes).toBe(1); expect((await pool.query('SELECT count(*) FROM scheduling_coaching_commands')).rows[0].count).toBe('1');
  });
  it('rolls back every generated booking when the terminal command receipt fails', async () => {
    await seedSeries();
    await pool.query(`CREATE FUNCTION synthetic_command_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$;
      CREATE TRIGGER synthetic_command_failure BEFORE INSERT ON scheduling_coaching_commands FOR EACH ROW EXECUTE FUNCTION synthetic_command_failure();`);
    try {
      await expect(commands.fill(tenant, 'g', '2099-11-03', '2099-11-10', 'receipt-failure-fill')).rejects.toThrow('synthetic receipt failure');
      expect((await pool.query('SELECT count(*) FROM scheduling_reservations')).rows[0].count).toBe('0');
    } finally { await pool.query('DROP TRIGGER synthetic_command_failure ON scheduling_coaching_commands; DROP FUNCTION synthetic_command_failure()'); }
  });
  it('serialises simultaneous fill and pause commands for one lineage', async () => {
    await seedSeries();
    await Promise.all([
      commands.fill(tenant, 'g', '2099-11-03', '2099-11-10', 'concurrent-fill-series'),
      commands.pause(tenant, 'g', '2099-11-03', '2099-11-10', null, 'concurrent-pause-series'),
    ]);
    expect((await pool.query("SELECT count(*) FROM scheduling_reservations WHERE status<>'cancelled'")).rows[0].count).toBe('0');
  });
  it('denies foreign, viewer and public recurring commands', async () => {
    await seedSeries();
    await expect(commands.fill({ ...tenant, organisationId: 'foreign' }, 'g', '2099-11-03', '2099-11-10', 'foreign-fill-series')).rejects.toMatchObject({ code: 'STCLS' });
    await expect(commands.fill({ ...tenant, can: () => false }, 'g', '2099-11-03', '2099-11-10', 'viewer-fill-series')).rejects.toThrow('permission denied');
    await expect(commands.fill({ ...tenant, actor: { kind: 'public' } }, 'g', '2099-11-03', '2099-11-10', 'public-fill-series')).rejects.toThrow('permission denied');
    expect((await pool.query('SELECT count(*) FROM scheduling_coaching_commands')).rows[0].count).toBe('0');
  });
  it('resumes atomically with new booking identities and retains the removed pause and cancelled history', async () => {
    await seedSeries(); const first = await commands.fill(tenant, 'g', '2099-11-03', '2099-11-10', 'fill-resume-fixture');
    const paused = await commands.pause(tenant, 'g', '2099-11-03', '2099-11-10', 'Synthetic reason', 'pause-resume-fixture');
    const resumed = await commands.resume(tenant, 'g', paused.pauseId, '2099-11-03', '2099-11-10', 'resume-lineage-once');
    expect(resumed.removedPause).toMatchObject({ id: paused.pauseId, reason: 'Synthetic reason' });
    expect(resumed.refill.created).toHaveLength(2);
    expect(resumed.refill.created.some(r => first.created.some(old => old.id === r.id))).toBe(false);
    expect(await commands.resume(tenant, 'g', paused.pauseId, '2099-11-03', '2099-11-10', 'resume-lineage-once')).toEqual(resumed);
    expect((await pool.query("SELECT count(*) FROM scheduling_reservations WHERE status='cancelled'")).rows[0].count).toBe('2');
    expect((await pool.query('SELECT count(*) FROM scheduling_series_pauses')).rows[0].count).toBe('0');
  });
  it('keeps a pause and all bookings unchanged when resume cannot complete its receipt', async () => {
    await seedSeries(); const paused = await commands.pause(tenant, 'g', '2099-11-03', '2099-11-10', null, 'pause-rollback-fixture');
    await pool.query(`CREATE FUNCTION synthetic_resume_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.request->>'kind'='resume-series' THEN RAISE EXCEPTION 'synthetic resume receipt failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER synthetic_resume_failure BEFORE INSERT ON scheduling_coaching_commands FOR EACH ROW EXECUTE FUNCTION synthetic_resume_failure();`);
    try {
      await expect(commands.resume(tenant, 'g', paused.pauseId, '2099-11-03', '2099-11-10', 'resume-rollback-test')).rejects.toThrow('synthetic resume receipt failure');
      expect((await pool.query('SELECT count(*) FROM scheduling_series_pauses')).rows[0].count).toBe('1');
      expect((await pool.query('SELECT count(*) FROM scheduling_reservations')).rows[0].count).toBe('0');
    } finally { await pool.query('DROP TRIGGER synthetic_resume_failure ON scheduling_coaching_commands; DROP FUNCTION synthetic_resume_failure()'); }
  });
  it('switches Once to Weekly and back without rewriting the original booking or reviving cancelled history', async () => {
    await seedSeries(); const once = await service.enrol(tenant, body()); if (!once.ok) throw Error('fixture');
    const original = (await pool.query('SELECT row_to_json(r) data FROM scheduling_reservations r WHERE id=$1', [once.booking.id])).rows[0].data;
    const weekly = await commands.startWeekly(tenant, once.booking.id, '2099-11-03', '2099-11-10', 'once-to-weekly-command');
    expect(weekly.refill.created).toHaveLength(1); expect(weekly.refill.alreadyPresent).toBe(1);
    expect((await pool.query('SELECT row_to_json(r) data FROM scheduling_reservations r WHERE id=$1', [once.booking.id])).rows[0].data).toEqual(original);
    const stopped = await commands.stopWeekly(tenant, weekly.seriesId, '2099-11-03', 'weekly-to-once-command');
    expect(stopped.cancelled).toEqual([weekly.refill.created[0].id]);
    expect((await pool.query('SELECT status FROM scheduling_reservations WHERE id=$1', [once.booking.id])).rows[0].status).toBe('confirmed');
    await expect(commands.fill(tenant, weekly.seriesId, '2099-11-03', '2099-11-10', 'fill-stopped-lineage')).rejects.toMatchObject({ code: 'STCLS' });
    const restarted = await commands.startWeekly(tenant, once.booking.id, '2099-11-03', '2099-11-10', 'explicit-restart-weekly');
    expect(restarted.seriesId).toBe(weekly.seriesId); expect(restarted.refill.created).toHaveLength(1);
    expect(restarted.refill.created[0].id).not.toBe(weekly.refill.created[0].id);
  });
  it('serialises simultaneous Once-to-Weekly commands without creating two lineages', async () => {
    await seedSeries(); const once = await service.enrol(tenant, { ...body(), email: null }); if (!once.ok) throw Error('fixture');
    const results = await Promise.all([
      commands.startWeekly(tenant, once.booking.id, '2099-11-03', '2099-11-10', 'concurrent-weekly-one'),
      commands.startWeekly(tenant, once.booking.id, '2099-11-03', '2099-11-10', 'concurrent-weekly-two'),
    ]);
    expect(results[0].seriesId).toBe(results[1].seriesId);
    expect((await pool.query('SELECT count(*) FROM scheduling_coaching_series_links')).rows[0].count).toBe('1');
    expect((await pool.query('SELECT count(*) FROM scheduling_reservations')).rows[0].count).toBe('2');
  });
  it('preserves attended future places when stopping a weekly lineage', async () => {
    await seedSeries(); const filled = await commands.fill(tenant, 'g', '2099-11-03', '2099-11-10', 'fill-stop-protection');
    const future = filled.created.find(r => r.date === '2099-11-10')!.id;
    await service.attendance(tenant, future, 'attended', 0, 'attendance-future-mark');
    const stopped = await commands.stopWeekly(tenant, 'g', '2099-11-03', 'stop-protected-weekly');
    expect(stopped.cancelled).toEqual([]); expect(stopped.protected).toEqual([future]);
    expect((await pool.query('SELECT status FROM scheduling_series WHERE id=\'g\'')).rows[0].status).toBe('ended');
  });
  it('sees a paid marker committed while a pause waits for the booking lock', async () => {
    await seedSeries(); const filled = await commands.fill(tenant, 'g', '2099-11-03', '2099-11-10', 'fill-marker-race');
    const protectedId = filled.created[0].id;
    const client = await pool.connect();
    let pending: Promise<{ result?: { protected: string[] }; error?: unknown }> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT scheduling_coaching_set_paid_marker($1,$2,true,0,$3,$4)', ['synthetic', protectedId, 'marker-before-pause', 'synthetic-staff']);
      pending = commands.pause(tenant, 'g', '2099-11-03', '2099-11-10', null, 'pause-waiting-marker').then(result => ({ result }), error => ({ error }));
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%scheduling_coaching_pause_series%'");
        if (rows.rows[0].count > 0) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await client.query('COMMIT');
      const outcome = await pending;
      expect(outcome.error).toBeUndefined(); expect(outcome.result?.protected).toContain(protectedId);
      expect((await pool.query('SELECT status FROM scheduling_reservations WHERE id=$1', [protectedId])).rows[0].status).toBe('confirmed');
    } finally { await client.query('ROLLBACK'); client.release(); if (pending) await pending; }
  });
});
