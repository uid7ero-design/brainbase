import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';

// Disposable localhost-only database. No environment connection string used.
const name = `eve-overview-${process.pid}`;
const port = 64900 + process.pid % 300;
const db = vi.hoisted(() => ({ pool: null as unknown as Pool }));
vi.mock('@/lib/db', () => ({ default: (parts: TemplateStringsArray, ...values: unknown[]) => db.pool.query(parts.reduce((s, p, i) => s + p + (i < values.length ? `$${i + 1}` : ''), ''), values).then(r => r.rows) }));
import { readOrganiserOverview, readWorkspaceEvents } from '@/lib/events/organiserOverview';

describe('Dashboard counts on real disposable PostgreSQL', () => {
  beforeAll(async () => {
    execFileSync('docker', ['run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=local-fixture-only', '-p', `127.0.0.1:${port}:5432`, 'postgres:17-alpine'], { stdio: 'pipe' });
    db.pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', password: 'local-fixture-only', database: 'postgres' });
    for (let attempt = 0; ; attempt++) {
      try { await db.pool.query('SELECT 1'); break; } catch (error) { if (attempt >= 40) throw error; await new Promise(r => setTimeout(r, 250)); }
    }
    await db.pool.query(`CREATE TABLE events(id text PRIMARY KEY,organisation_id text,name text,slug text,status text,venue text,starts_at timestamptz,ends_at timestamptz,timezone text);
      CREATE TABLE event_orders(id text PRIMARY KEY,organisation_id text,event_id text,status text,payment_status text);
      CREATE TABLE event_order_items(id text PRIMARY KEY,organisation_id text,order_id text);
      CREATE TABLE event_attendees(id text PRIMARY KEY,organisation_id text,order_item_id text,checked_in_at timestamptz);
      CREATE TABLE event_sessions(id text PRIMARY KEY,organisation_id text,event_id text);
      CREATE TABLE event_ticket_types(id text PRIMARY KEY,organisation_id text,event_id text);`);
  }, 60000);
  afterAll(async () => {
    if (db.pool) await db.pool.end();
    try { execFileSync('docker', ['stop', name], { stdio: 'pipe' }); } catch { /* container never started */ }
  }, 30000);
  beforeEach(async () => { await db.pool.query('TRUNCATE events,event_orders,event_order_items,event_attendees,event_sessions,event_ticket_types'); });
  it('matches list semantics without item fanout, cancelled rows or foreign tenants', async () => {
    await db.pool.query(`INSERT INTO events(id,organisation_id) VALUES ('selected','org-a'),('other','org-a'),('foreign','org-b');
      INSERT INTO event_orders VALUES
       ('paid','org-a','selected','CONFIRMED','PAID'),('cancelled','org-a','selected','CANCELLED','PAID'),
       ('refunded','org-a','selected','CONFIRMED','REFUNDED'),('no-items','org-a','selected','CONFIRMED','PAID'),
       ('other-order','org-a','other','CONFIRMED','PAID'),('foreign-order','org-b','foreign','CONFIRMED','PAID');
      INSERT INTO event_order_items VALUES ('line-1','org-a','paid'),('line-2','org-a','paid'),('line-c','org-a','cancelled'),
       ('line-r','org-a','refunded'),('line-o','org-a','other-order'),('line-f','org-b','foreign-order'),('bad-line','org-b','paid');
      INSERT INTO event_attendees VALUES ('a1','org-a','line-1',now()),('a2','org-a','line-2',NULL),
       ('a3','org-a','line-c',now()),('a4','org-a','line-r',NULL),('a5','org-a','line-o',now()),
       ('a6','org-b','line-f',now()),('bad-a','org-b','line-1',now()),('bad-b','org-a','bad-line',now());`);
    expect(await readOrganiserOverview('org-a', ['selected','foreign'])).toEqual({ orderCount: 2, paidOrderCount: 1, ticketCount: 3, checkedInCount: 1 });
    expect(await readOrganiserOverview('org-b', ['selected','foreign'])).toEqual({ orderCount: 1, paidOrderCount: 1, ticketCount: 1, checkedInCount: 1 });
    expect((await readWorkspaceEvents('org-a')).map(e => e.id).sort()).toEqual(['other','selected']);
    expect((await readWorkspaceEvents('org-b')).map(e => e.id)).toEqual(['foreign']);
  });
  it('returns genuine zeroes for an empty selection', async () => {
    expect(await readOrganiserOverview('org-a', [])).toEqual({ orderCount: 0, paidOrderCount: 0, ticketCount: 0, checkedInCount: 0 });
  });
  it('retains the established 25-event scope even if supplied more IDs', async () => {
    const ids = Array.from({ length: 26 }, (_, i) => `event-${i}`);
    for (const id of ids) {
      await db.pool.query("INSERT INTO events(id,organisation_id) VALUES ($1,'org-a')", [id]);
      await db.pool.query("INSERT INTO event_orders VALUES ($1,'org-a',$1,'CONFIRMED','PAID')", [id]);
      await db.pool.query("INSERT INTO event_order_items VALUES ($1,'org-a',$1)", [id]);
    }
    expect((await readOrganiserOverview('org-a', ids)).orderCount).toBe(25);
  });
  it('counts sessions and ticket types independently and scopes both to the tenant', async () => {
    await db.pool.query(`INSERT INTO events(id,organisation_id) VALUES ('selected','org-a'),('foreign','org-b');
      INSERT INTO event_sessions VALUES ('s1','org-a','selected'),('s2','org-a','selected'),('bad-s','org-b','selected');
      INSERT INTO event_ticket_types VALUES ('t1','org-a','selected'),('t2','org-a','selected'),('t3','org-a','selected'),('bad-t','org-b','selected');`);
    const rows = await readWorkspaceEvents('org-a');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'selected', session_count: 2, ticket_type_count: 3 });
    expect(Object.keys(rows[0]).sort()).toEqual(['id','name','slug','status','venue','starts_at','ends_at','timezone','session_count','ticket_type_count'].sort());
  });
});
