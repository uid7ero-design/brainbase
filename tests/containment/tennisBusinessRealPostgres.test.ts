import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import pg from 'pg';
const fixture = vi.hoisted(() => ({ pool: null as pg.Pool | null, signed: true, org: 'a', role: 'admin' }));
vi.mock('@/lib/db', () => ({ default: (parts: TemplateStringsArray, ...values: unknown[]) => fixture.pool!.query(parts.reduce((text, part, index) => text + (index ? '$' + index : '') + part, ''), values).then(result => result.rows) }));
vi.mock('@/lib/org', () => ({ requireSession: async () => {
  if (!fixture.signed) throw new Error('No session');
  return { organisationId: fixture.org, userId: 'u', role: fixture.role, name: 'Synthetic' };
} }));
const suite = process.env.TENNIS_BUSINESS_TEST_URL ? describe : describe.skip;
const { readTennisBusiness } = await import('@/lib/tennisBusiness/overview');
const { coachingCapacityReady } = await import('@/lib/tennisBusiness/coachingSafety');
const { GET } = await import('@/app/api/business/tennis/route');
const { NextRequest } = await import('next/server');
suite('Tennis business actual routes and SQL in an owned disposable database', () => {
  beforeAll(async () => {
    const url = new URL(process.env.TENNIS_BUSINESS_TEST_URL!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/tennisbusiness') throw new Error('Owned loopback database required');
    fixture.pool = new pg.Pool({ connectionString: url.href });
    await fixture.pool.query(`
      CREATE TABLE organisations(id text PRIMARY KEY,slug text);
      CREATE TABLE modules(key text PRIMARY KEY,name text,active boolean);
      CREATE TABLE organisation_modules(organisation_id text,module_key text,enabled boolean);
      CREATE TABLE organisation_user_access(user_id text PRIMARY KEY,organisation_id text,permissions jsonb);
      CREATE TABLE sessions(id uuid PRIMARY KEY,organisation_id text);
      CREATE TABLE session_instances(id uuid PRIMARY KEY,session_id uuid,date date,status text,max_capacity int);
      CREATE TABLE bookings(id uuid PRIMARY KEY,session_instance_id uuid,status text);
      CREATE TABLE contacts(id text,organisation_id text,status text);
      CREATE TABLE crm_contacts(id text,organisation_id text);
      CREATE TABLE crm_deals(id text,organisation_id text,stage text);
      CREATE TABLE commercial_invoices(id text,organisation_id text,status text,currency text,total_cents int,issue_date date);
      CREATE TABLE commercial_payments(id text,organisation_id text,status text,currency text,amount_cents int,received_at timestamptz);
      CREATE TABLE commercial_payment_allocations(organisation_id text,payment_id text,invoice_id text,allocated_amount_cents int);
      CREATE TABLE commercial_supplier_bills(organisation_id text,status text,currency text,total_cents int,bill_date date);
      CREATE TABLE commercial_supplier_payments(organisation_id text,status text,currency text,amount_cents int,paid_at timestamptz);
    `);
  });
  afterAll(async () => { await fixture.pool?.end(); });
  beforeEach(async () => {
    fixture.signed = true; fixture.org = 'a'; fixture.role = 'admin';
    await fixture.pool!.query(`TRUNCATE organisations,modules,organisation_modules,organisation_user_access,sessions,session_instances,bookings,contacts,crm_contacts,crm_deals,commercial_invoices,commercial_payments,commercial_payment_allocations,commercial_supplier_bills,commercial_supplier_payments;
      DROP TRIGGER IF EXISTS bookings_capacity_guard ON bookings;
      INSERT INTO organisations VALUES('a','ld-tennis'),('b','other');
      INSERT INTO modules VALUES('scheduling','Scheduling',true),('crm','CRM',true),('invoicing','Invoicing',true),('purchasing','Purchasing',true);
      INSERT INTO organisation_modules SELECT 'a',key,true FROM modules;
      INSERT INTO sessions VALUES('10000000-0000-4000-8000-000000000001','a'),('20000000-0000-4000-8000-000000000001','b');
      INSERT INTO session_instances VALUES('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',(now() AT TIME ZONE 'Australia/Adelaide')::date,'scheduled',1),('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',(now() AT TIME ZONE 'Australia/Adelaide')::date,'scheduled',1);
      INSERT INTO contacts VALUES('p1','a','active'),('p2','b','active'),('p3','a','inactive');
      INSERT INTO crm_contacts VALUES('c1','a'),('c2','b');
      INSERT INTO crm_deals VALUES('d1','a','lead'),('d2','a','closed_won'),('d3','b','lead');
      INSERT INTO commercial_invoices VALUES('i1','a','ISSUED','AUD',10000,'2026-11-01'),('i2','a','ISSUED','AUD',5000,'2026-10-01'),('i3','a','ISSUED','USD',2000,'2026-11-01'),('i4','a','DRAFT','AUD',99999,'2026-11-01'),('i5','a','VOID','AUD',88888,'2026-11-01'),('i6','b','ISSUED','CAD',123456,'2026-11-01');
      INSERT INTO commercial_payments VALUES('p1','a','RECORDED','AUD',3000,'2026-10-31T13:30:00Z'),('p2','a','REVERSED','AUD',8000,'2026-11-03T00:00:00Z'),('p3','a','RECORDED','AUD',1000,'2026-10-31T13:29:59Z'),('p4','b','RECORDED','CAD',123456,'2026-11-03T00:00:00Z');
      INSERT INTO commercial_payment_allocations VALUES('a','p1','i1',3000),('a','p2','i1',8000),('a','p3','i2',1000),('b','p4','i1',10000);
      INSERT INTO commercial_supplier_bills VALUES('a','POSTED','AUD',4000,'2026-11-01'),('a','DRAFT','AUD',8000,'2026-11-01'),('a','CANCELLED','AUD',7000,'2026-11-01'),('b','POSTED','CAD',99999,'2026-11-01');
      INSERT INTO commercial_supplier_payments VALUES('a','RECORDED','AUD',1000,'2026-11-02T00:00:00Z'),('a','REVERSED','AUD',3000,'2026-11-02T00:00:00Z'),('a','RECORDED','AUD',1500,'2026-10-01T00:00:00Z');`);
  });
  it('keeps currencies and periods separate, excludes reversals/drafts and foreign allocations', async () => {
    const overview = await readTennisBusiness('a', ['scheduling','crm','invoicing','purchasing'], '2026-11');
    expect(overview.coaching).toMatchObject({ state: 'ready', value: { sessions: 1, players: 1 } });
    expect(overview.crm).toEqual({ state: 'ready', value: { contacts: 1, openDeals: 1 } });
    expect(overview.income).toEqual({ state: 'ready', value: [
      { currency: 'AUD', invoiced_cents: '10000', received_cents: '3000', outstanding_cents: '11000' },
      { currency: 'USD', invoiced_cents: '2000', received_cents: '0', outstanding_cents: '2000' },
    ] });
    expect(overview.costs).toEqual({ state: 'ready', value: [{ currency: 'AUD', billed_cents: '4000', paid_cents: '1000' }] });
  });
  it('never reads a module section after its managed grant is removed', async () => {
    await fixture.pool!.query(`INSERT INTO organisation_user_access VALUES('u','a','{"scheduling":"view"}')`);
    const response = await GET(new NextRequest('http://localhost/api/business/tennis?month=2026-11'));
    expect(response.status).toBe(200); const body = await response.json();
    expect(body.modules).toEqual(['scheduling']); expect(body.income).toEqual({ state: 'not_enabled' }); expect(body.crm).toEqual({ state: 'not_enabled' });
    await fixture.pool!.query(`UPDATE organisation_user_access SET permissions='{}'`);
    expect((await GET(new NextRequest('http://localhost/api/business/tennis'))).status).toBe(403);
  });
  it('denies anonymous, foreign-tenant, unknown-role and disabled-entitlement requests', async () => {
    fixture.signed = false; expect((await GET(new NextRequest('http://localhost/api/business/tennis'))).status).toBe(401);
    fixture.signed = true; fixture.org = 'b'; expect((await GET(new NextRequest('http://localhost/api/business/tennis'))).status).toBe(404);
    fixture.org = 'a'; fixture.role = 'analyst'; expect((await GET(new NextRequest('http://localhost/api/business/tennis'))).status).toBe(403);
    fixture.role = 'admin'; await fixture.pool!.query('UPDATE organisation_modules SET enabled=false');
    expect((await GET(new NextRequest('http://localhost/api/business/tennis'))).status).toBe(403);
  });
  it('rejects caller-supplied scope and repeated/malformed month input', async () => {
    for (const query of ['organisationId=b','month=2026-11&month=2026-12','month=2026-13']) {
      expect((await GET(new NextRequest('http://localhost/api/business/tennis?' + query))).status).toBe(400);
    }
  });
  it('reports unavailable source data instead of zero and keeps unrelated sections usable', async () => {
    await fixture.pool!.query('ALTER TABLE commercial_payments RENAME TO unavailable_payments');
    try { const body = await readTennisBusiness('a', ['crm','invoicing'], '2026-11'); expect(body.income).toEqual({ state: 'unavailable' }); expect(body.crm.state).toBe('ready'); }
    finally { await fixture.pool!.query('ALTER TABLE unavailable_payments RENAME TO commercial_payments'); }
  });
  it('requires an enabled capacity guard before coaching writes, with real concurrent refusal proof', async () => {
    expect(await coachingCapacityReady()).toBe(false);
    const source = process.env.TENNIS_CAPACITY_GUARD_SQL;
    if (!source) throw new Error('The dedicated runner must supply PR #462 guard SQL');
    await fixture.pool!.query(source); expect(await coachingCapacityReady()).toBe(true);
    const writes = await Promise.allSettled(Array.from({length: 12}, (_, index) => fixture.pool!.query(`INSERT INTO bookings VALUES($1,'10000000-0000-4000-8000-000000000002','confirmed')`, [`30000000-0000-4000-8000-${String(index).padStart(12,'0')}`])));
    expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(writes.filter(result => result.status === 'rejected').every(result => result.status === 'rejected' && result.reason.code === 'BKCAP')).toBe(true);
    await fixture.pool!.query('ALTER TABLE bookings DISABLE TRIGGER bookings_capacity_guard'); expect(await coachingCapacityReady()).toBe(false);
  });
});
