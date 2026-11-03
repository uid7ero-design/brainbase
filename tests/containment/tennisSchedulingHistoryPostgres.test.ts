import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import type { TenantContext } from '@scheduling/core';
import { readCoachingHistory } from '@/lib/scheduling/compatibility/tennis/coachingHistory';

const url = process.env.TENNIS_HISTORY_TEST_URL;
if (url && (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || new URL(url).pathname !== '/tennis_history_proof')) throw Error('Owned disposable database required');
const org = '8ecd003b-583f-4616-a830-8dbf8aa51d2c';
const tables = ['sessions', 'session_instances', 'bookings', 'booking_recurrence_pauses', 'session_types'];
describe.skipIf(!url)('Tennis full-history barrier on disposable Postgres', () => {
  const pool = new Pool({ connectionString: url });
  const sql = { async query<T>(text: string, params: readonly unknown[]) { return (await pool.query(text, [...params])).rows as T[]; } };
  const tenant: TenantContext = { organisationId: org, timezone: 'Australia/Adelaide', actor: { kind: 'staff', userId: 'synthetic' }, can: () => true };
  beforeAll(async () => {
    await pool.query('CREATE TABLE organisations(id text PRIMARY KEY,slug text,status text)');
    for (const table of tables) await pool.query(`CREATE TABLE ${table}(id text PRIMARY KEY,organisation_id text NOT NULL,notes text,paid boolean,attendance text)`);
    await pool.query(readFileSync('scripts/scheduling/tennis-history-cutover.sql', 'utf8'));
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE scheduling_tennis_history,scheduling_tennis_cutover,${tables.join(',')},organisations CASCADE`);
    await pool.query("INSERT INTO organisations VALUES($1,'ld-tennis','ACTIVE'),('other','other','ACTIVE')", [org]);
    for (const table of tables) await pool.query(`INSERT INTO ${table} VALUES($1,$2,'Synthetic original notes',true,'attending'),($3,'other','Other tenant',false,NULL)`, [table, org, `${table}-other`]);
    await pool.query('SELECT scheduling_tennis_prepare_history($1)', [org]);
  });
  afterAll(async () => { await pool.end(); });
  const freeze = () => pool.query("UPDATE scheduling_tennis_cutover SET phase='frozen' WHERE organisation_id=$1", [org]);
  const manifest = async () => (await pool.query('SELECT scheduling_tennis_manifest($1) AS hash', [org])).rows[0].hash;
  const capture = (hash: string) => pool.query('SELECT * FROM scheduling_tennis_capture_history($1,$2)', [org, hash]);

  it('retains every full source row and source id without inventing missing historical fields', async () => {
    const hash = await manifest(); await freeze();
    expect((await capture(hash)).rows).toEqual([{ manifest: hash, row_count: '5' }]);
    expect((await capture(hash)).rows).toEqual([{ manifest: hash, row_count: '5' }]);
    const saved = (await pool.query("SELECT source_row FROM scheduling_tennis_history WHERE source_table='bookings'")).rows[0].source_row;
    expect(saved).toEqual({ id: 'bookings', organisation_id: org, notes: 'Synthetic original notes', paid: true, attendance: 'attending' });
    expect(saved).not.toHaveProperty('cancelled_at'); expect(saved).not.toHaveProperty('price_cents');
    await expect(pool.query("UPDATE scheduling_tennis_history SET source_row=source_row || '{\"notes\":\"Changed\"}'")).rejects.toMatchObject({ code: 'STHIS' });
    await expect(pool.query('DELETE FROM scheduling_tennis_history')).rejects.toMatchObject({ code: 'STHIS' });
  });
  it('freezes inserts, updates and deletes across all five sources while other tenants continue', async () => {
    await freeze();
    for (const table of tables) {
      await expect(pool.query(`INSERT INTO ${table}(id,organisation_id) VALUES('new',$1)`, [org])).rejects.toMatchObject({ code: 'STFRZ' });
      await expect(pool.query(`UPDATE ${table} SET notes='Changed' WHERE organisation_id=$1`, [org])).rejects.toMatchObject({ code: 'STFRZ' });
      await expect(pool.query(`DELETE FROM ${table} WHERE organisation_id=$1`, [org])).rejects.toMatchObject({ code: 'STFRZ' });
      expect((await pool.query(`UPDATE ${table} SET notes='Allowed' WHERE organisation_id='other'`)).rowCount).toBe(1);
      await expect(pool.query(`UPDATE ${table} SET organisation_id=$1 WHERE organisation_id='other'`, [org])).rejects.toMatchObject({ code: 'STFRZ' });
      await expect(pool.query(`UPDATE ${table} SET organisation_id='other' WHERE organisation_id=$1`, [org])).rejects.toMatchObject({ code: 'STFRZ' });
    }
  });
  it('refuses stale manifests and cannot activate an unverified canonical writer', async () => {
    const stale = await manifest(); await pool.query("UPDATE bookings SET notes='Last booking change' WHERE organisation_id=$1", [org]);
    await freeze(); await expect(capture(stale)).rejects.toMatchObject({ code: 'STCHG' });
    expect((await pool.query('SELECT count(*) FROM scheduling_tennis_history')).rows[0].count).toBe('0');
    await expect(pool.query("UPDATE scheduling_tennis_cutover SET phase='scheduling'")).rejects.toMatchObject({ code: 'STCTL' });
    await capture(await manifest());
    await expect(pool.query("UPDATE scheduling_tennis_cutover SET phase='legacy'")).rejects.toMatchObject({ code: 'STCTL' });
  });
  it('allows abandoning an uncaptured freeze without deleting history or changing source rows', async () => {
    const original = await manifest(); await freeze();
    await pool.query("UPDATE scheduling_tennis_cutover SET phase='legacy'");
    expect(await manifest()).toBe(original);
    expect((await pool.query("UPDATE bookings SET notes='Resumed' WHERE organisation_id=$1", [org])).rowCount).toBe(1);
  });
  it('waits for an in-flight writer and includes its final committed row', async () => {
    const writer = await pool.connect(); const freezer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query("UPDATE bookings SET notes='Committed while switching' WHERE organisation_id=$1", [org]);
      await freezer.query("SET lock_timeout='100ms'");
      await expect(freezer.query("UPDATE scheduling_tennis_cutover SET phase='frozen'")).rejects.toMatchObject({ code: '55P03' });
      await writer.query('COMMIT'); await freeze(); await capture(await manifest());
      expect((await pool.query("SELECT source_row->>'notes' AS notes FROM scheduling_tennis_history WHERE source_table='bookings'")).rows[0].notes).toBe('Committed while switching');
    } finally { await writer.query('ROLLBACK'); writer.release(); freezer.release(); }
  });
  it('rejects repeatable-read source writes that could see an obsolete control state', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query('SELECT * FROM bookings');
      await expect(client.query("UPDATE bookings SET notes='Old snapshot' WHERE organisation_id=$1", [org])).rejects.toMatchObject({ code: 'STISO' });
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
  it('requires the fixed tenant and drained source locks for initial preparation', async () => {
    await expect(pool.query("SELECT scheduling_tennis_prepare_history('other')")).rejects.toMatchObject({ code: 'STCTL' });
    await pool.query('TRUNCATE scheduling_tennis_history,scheduling_tennis_cutover');
    await expect(pool.query('INSERT INTO scheduling_tennis_cutover(organisation_id) VALUES($1)', [org])).rejects.toMatchObject({ code: 'STCTL' });
    await pool.query('SELECT scheduling_tennis_prepare_history($1)', [org]);
    await pool.query('SELECT scheduling_tennis_prepare_history($1)', [org]);
    expect((await pool.query('SELECT count(*) FROM scheduling_tennis_cutover')).rows[0].count).toBe('1');
  });
  it('reads immutable history with bounded stable paging and without exposing another tenant', async () => {
    expect(await readCoachingHistory(sql, tenant, 'bookings')).toBeNull();
    await pool.query("INSERT INTO bookings(id,organisation_id,notes) VALUES('booking-2',$1,'Second original'),('booking-3',$1,'Third original')", [org]);
    await freeze(); await capture(await manifest());
    const first = await readCoachingHistory(sql, tenant, 'bookings', { limit: 2 });
    expect(first?.rows.map(r => r.sourceId)).toEqual(['booking-2', 'booking-3']);
    const second = await readCoachingHistory(sql, tenant, 'bookings', { limit: 2, after: first!.next! });
    expect(second?.rows.map(r => r.sourceId)).toEqual(['bookings']); expect(second?.next).toBeNull();
    expect(await readCoachingHistory(sql, { ...tenant, organisationId: 'other' }, 'bookings')).toBeNull();
    await expect(readCoachingHistory(sql, { ...tenant, can: () => false }, 'bookings')).rejects.toThrow('permission denied');
    await expect(readCoachingHistory(sql, { ...tenant, actor: { kind: 'public' } }, 'bookings')).rejects.toThrow('permission denied');
  });
});
