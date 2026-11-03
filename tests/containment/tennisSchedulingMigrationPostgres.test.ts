import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { assessTennisMigration } from '@/lib/scheduling/compatibility/tennis/migrationAssessment';
import { readTennisMigrationSnapshot } from '@/lib/scheduling/compatibility/tennis/migrationSnapshot';

const url = process.env.TENNIS_MIGRATION_TEST_URL;
if (url && (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || new URL(url).pathname !== '/tennis_migration_proof')) throw new Error('Disposable loopback database required');
describe.skipIf(!url)('Tennis migration actual read-only SQL', () => {
  const client = new Client({ connectionString: url });
  const executor = { async query<T>(text: string, values: readonly unknown[]) { return (await client.query(text, [...values])).rows as T[]; } };
  beforeAll(async () => {
    await client.connect();
    await client.query(`
      CREATE TABLE organisations(id text PRIMARY KEY, slug text, status text, timezone text);
      CREATE TABLE scheduling_settings(organisation_id text PRIMARY KEY, currency text);
      CREATE TABLE sessions(id text PRIMARY KEY, organisation_id text, day_of_week integer, start_date date, end_mode text,
        end_after_weeks integer,end_date date,start_time time,duration_minutes integer,max_capacity integer,price_per_session numeric,archived_at timestamptz);
      CREATE TABLE session_instances(id text PRIMARY KEY,organisation_id text,session_id text,date date,start_time time,duration_minutes integer,max_capacity integer,status text);
      CREATE TABLE bookings(id text PRIMARY KEY,organisation_id text,session_id text,session_instance_id text,client_name text,client_email text,status text,paid boolean,attendance_status text,is_recurring boolean,recurring_group_id text);
      CREATE TABLE booking_recurrence_pauses(id text PRIMARY KEY,organisation_id text,session_id text,recurring_group_id text,pause_from date,pause_until date);
      INSERT INTO organisations VALUES('target','ld-tennis','ACTIVE','Australia/Adelaide'),('foreign','other','ACTIVE','Australia/Adelaide');
      INSERT INTO scheduling_settings VALUES('target','AUD'),('foreign','AUD');
      INSERT INTO sessions VALUES('s','target',2,'2026-11-03','ongoing',NULL,NULL,'16:00',60,2,12.50,NULL);
      INSERT INTO session_instances VALUES('i','target','s','2026-11-03','16:00',60,2,'scheduled');
      INSERT INTO bookings VALUES('b','target','s','i','Synthetic only','synthetic@example.invalid','confirmed',true,'attending',true,'g');
      INSERT INTO bookings VALUES('foreign-b','foreign','s','i','Foreign synthetic','foreign@example.invalid','confirmed',false,NULL,false,NULL);
      INSERT INTO booking_recurrence_pauses VALUES('p','target','s','g','2026-12-01','2026-12-08');
    `);
  });
  afterAll(async () => { await client.end(); });
  it('executes successfully in a READ ONLY transaction and does not join foreign children into the snapshot', async () => {
    await client.query('BEGIN READ ONLY');
    try {
      const snapshot = await readTennisMigrationSnapshot(executor, 'target');
      expect(snapshot.bookings.map(b => b.id)).toEqual(['b']);
      expect(snapshot.sessions[0].price_per_session).toBe('12.50');
      expect(snapshot.instances[0].date).toBe('2026-11-03');
      expect(snapshot.instances[0].start_time).toBe('16:00:00');
      expect(assessTennisMigration(snapshot).compatibleProjection).toBe(true);
      expect(assessTennisMigration(snapshot).preservation.paidMarkers).toBe(1);
    } finally { await client.query('ROLLBACK'); }
    expect((await client.query('SELECT count(*) FROM bookings')).rows[0].count).toBe('2');
  });
  it('refuses non-Tennis tenants and absent tenants rather than returning an empty business', async () => {
    await expect(readTennisMigrationSnapshot(executor, 'foreign')).rejects.toThrow('unavailable');
    await expect(readTennisMigrationSnapshot(executor, 'missing')).rejects.toThrow('unavailable');
  });
  it('keeps broken source relationships visible for assessment instead of dropping them in an inner join', async () => {
    await client.query("INSERT INTO bookings VALUES('orphan','target','missing','missing','Synthetic orphan',NULL,'confirmed',false,NULL,false,NULL)");
    try {
      const snapshot = await readTennisMigrationSnapshot(executor, 'target');
      expect(snapshot.bookings).toHaveLength(2);
      expect(assessTennisMigration(snapshot).problems).toContainEqual({ source: 'bookings', id: 'orphan', code: 'MISSING_PARENT' });
    } finally { await client.query("DELETE FROM bookings WHERE id='orphan'"); }
  });
  it('fails on malformed stored values without returning a partial ledger', async () => {
    await client.query("UPDATE bookings SET paid=NULL WHERE id='b'");
    try { await expect(readTennisMigrationSnapshot(executor, 'target')).rejects.toThrow('projection is invalid'); }
    finally { await client.query("UPDATE bookings SET paid=true WHERE id='b'"); }
  });
  it('detects source changes in the projection fingerprint', async () => {
    const before = assessTennisMigration(await readTennisMigrationSnapshot(executor, 'target')).projectionFingerprint;
    await client.query("UPDATE bookings SET status='cancelled' WHERE id='b'");
    try {
      const after = assessTennisMigration(await readTennisMigrationSnapshot(executor, 'target'));
      expect(after.projectionFingerprint).not.toBe(before);
      expect(after.preservation.cancelledBookings).toBe(1);
    } finally { await client.query("UPDATE bookings SET status='confirmed' WHERE id='b'"); }
  });
});
