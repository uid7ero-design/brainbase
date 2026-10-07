import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';
import { buildSupplierApCsv } from '../../lib/commercial/supplierApCsv';
const url = process.env.DATABASE_URL;
if (!url || !['127.0.0.1','localhost'].includes(new URL(url).hostname)) throw new Error('Requires a fresh disposable localhost database');
const sql = createNeonCompatibleSql(url);
vi.doMock('@/lib/db', () => ({default:sql}));
const { getSupplierApOverview, getSupplierApExport } = await import('@/lib/commercial/supplierApOverview');
const basis = 'HISTORICAL_RECORDED_BALANCE';
const history = (date: string, options = {}) => getSupplierApOverview('a', date, options, basis);
beforeAll(async () => {
  await sql.raw('CREATE TABLE commercial_suppliers(id text,organisation_id text,name text,active boolean)');
  await sql.raw('CREATE TABLE commercial_supplier_bills(id text,organisation_id text,supplier_id text,bill_number text,supplier_invoice_number text,due_date date,currency text,total_cents integer,status text,posted_at timestamptz,cancelled_at timestamptz)');
  await sql.raw('CREATE TABLE commercial_supplier_payments(id text,organisation_id text,supplier_id text,currency text,status text,paid_at timestamptz,created_at timestamptz,reversed_at timestamptz)');
  await sql.raw('CREATE TABLE commercial_supplier_payment_allocations(supplier_bill_id text,supplier_payment_id text,organisation_id text,supplier_id text,currency text,allocated_amount_cents integer,created_at timestamptz)');
  await sql.raw("INSERT INTO commercial_suppliers VALUES ('s','a','Supplier',false),('x','other','Foreign supplier',true)");
});
beforeEach(async () => {
  await sql.raw('TRUNCATE commercial_supplier_payment_allocations,commercial_supplier_payments,commercial_supplier_bills');
  await sql.raw(`INSERT INTO commercial_supplier_bills VALUES
    ('b1','a','s','SB1','INV1','2026-09-01','AUD',10000,'POSTED','2026-10-01T10:00:00Z',NULL),
    ('b2','a','s','SB2','INV2',NULL,'AUD',5000,'CANCELLED','2026-10-02T10:00:00Z','2026-10-04T00:00:00Z'),
    ('future','a','s','FUTURE','FUTURE',NULL,'AUD',999,'POSTED','2026-10-08T00:00:00Z',NULL),
    ('draft','a','s',NULL,'DRAFT',NULL,'AUD',999,'DRAFT',NULL,NULL),
    ('foreign','other','x','OTHER','OTHER',NULL,'AUD',999,'POSTED',NULL,NULL)`);
  await sql.raw("INSERT INTO commercial_supplier_payments VALUES ('p1','a','s','AUD','REVERSED','2026-10-02T11:00:00Z','2026-10-02T12:00:00Z','2026-10-05T15:00:00Z')");
  await sql.raw("INSERT INTO commercial_supplier_payment_allocations VALUES ('b1','p1','a','s','AUD',2500,'2026-10-02T12:00:00Z')");
});
afterAll(() => sql.end());
describe('Historical AP real PostgreSQL', () => {
  it('reconstructs posting, payment, reversal and cancellation rather than filtering current statuses', async () => {
    expect((await history('2026-09-30')).bills).toEqual([]);
    expect((await history('2026-10-01')).currencies[0]).toMatchObject({payable_cents:'10000',paid_cents:'0',outstanding_cents:'10000'});
    const earlier = await history('2026-10-03');
    expect(earlier).toMatchObject({balance_basis:basis,as_of_timezone:'UTC'});
    expect(earlier.currencies[0]).toMatchObject({payable_cents:'15000',paid_cents:'2500',outstanding_cents:'12500',overdue_cents:'7500'});
    expect(earlier.bills.map(row => row.bill_id).sort()).toEqual(['b1','b2']);
    expect((await history('2026-10-04')).currencies[0]).toMatchObject({payable_cents:'10000',paid_cents:'2500',outstanding_cents:'7500'});
    expect((await history('2026-10-05')).currencies[0]).toMatchObject({paid_cents:'0',outstanding_cents:'10000'});
    expect((await getSupplierApOverview('a','2026-10-03')).currencies[0]).toMatchObject({payable_cents:'10999',paid_cents:'0'});
  });
  it('uses exclusive next midnight UTC irrespective of session timezone and handles exact-boundary events', async () => {
    await sql.raw("UPDATE commercial_supplier_bills SET posted_at='2026-10-04T00:00:00Z' WHERE id='b1'");
    for (const timezone of ['Australia/Adelaide','America/Los_Angeles','UTC']) {
      await sql.raw(`SET TIME ZONE '${timezone}'`);
      expect((await history('2026-10-03')).bills.map(row => row.bill_id)).toEqual(['b2']);
      expect((await history('2026-10-04')).bills.map(row => row.bill_id)).toEqual(['b1']);
    }
    await sql.raw("UPDATE commercial_supplier_bills SET posted_at='2026-10-01T10:00:00Z' WHERE id='b1'");
    await sql.raw("UPDATE commercial_supplier_payments SET reversed_at='2026-10-04T00:00:00Z' WHERE id='p1'");
    expect((await history('2026-10-03')).currencies[0].paid_cents).toBe('2500');
    expect((await history('2026-10-04')).currencies[0].paid_cents).toBe('0');
  });
  it('does not let late-entered backdated payments or later allocations rewrite earlier balances', async () => {
    await sql.raw("INSERT INTO commercial_supplier_payments VALUES ('late','a','s','AUD','RECORDED','2026-10-01T00:00:00Z','2026-10-04T00:00:00Z',NULL),('late-allocation','a','s','AUD','RECORDED','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z',NULL)");
    await sql.raw("INSERT INTO commercial_supplier_payment_allocations VALUES ('b1','late','a','s','AUD',1000,'2026-10-04T00:00:00Z'),('b1','late-allocation','a','s','AUD',500,'2026-10-04T00:00:00Z')");
    expect((await history('2026-10-03')).currencies[0].paid_cents).toBe('2500');
    expect((await history('2026-10-04')).currencies[0].paid_cents).toBe('4000');
  });
  it('waits for a future paid date even when a payment was recorded earlier', async () => {
    await sql.raw("INSERT INTO commercial_supplier_payments VALUES ('future-pay','a','s','AUD','RECORDED','2026-10-07T00:00:00Z','2026-10-03T00:00:00Z',NULL)");
    await sql.raw("INSERT INTO commercial_supplier_payment_allocations VALUES ('b1','future-pay','a','s','AUD',1000,'2026-10-03T00:00:00Z')");
    expect((await history('2026-10-06')).currencies[0].paid_cents).toBe('0');
    expect((await history('2026-10-07')).currencies[0].paid_cents).toBe('1000');
  });
  it('retains exact currency totals across pages, filters and all-row historical CSVs', async () => {
    await sql.raw(`INSERT INTO commercial_supplier_bills VALUES ('big1','a','s','BIG1','BIG1',NULL,'EUR',2147483647,'POSTED','2026-10-01T00:00:00Z',NULL),('big2','a','s','BIG2','BIG2',NULL,'EUR',2147483647,'POSTED','2026-10-01T00:00:00Z',NULL)`);
    const one = await history('2026-10-03',{pageSize:1}); const two = await history('2026-10-03',{pageSize:1,page:2});
    expect(one.currencies).toEqual(two.currencies); expect(one.currencies.find(row => row.currency==='EUR')!.payable_cents).toBe('4294967294');
    const exported = await getSupplierApExport('a','2026-10-03',{pageSize:1,page:99,supplierPage:99},basis);
    expect(exported.bills).toHaveLength(4); expect(exported.suppliers).toHaveLength(2);
    expect(buildSupplierApCsv(exported,'bills')).toContain('HISTORICAL_RECORDED_BALANCE'); expect(buildSupplierApCsv(exported,'aging')).toContain('4294967294');
    expect(buildSupplierApCsv(exported,'bills')).toContain('NO_DUE_DATE,UTC');
    expect((await history('2026-10-03',{search:'INV2',currency:'AUD'})).currencies[0].outstanding_cents).toBe('5000');
    expect((await history('2026-10-03',{supplierId:'x'})).bills).toEqual([]);
  });
  it('includes fully paid bills in historical exports while outstanding pages exclude them', async () => {
    await sql.raw("UPDATE commercial_supplier_payment_allocations SET allocated_amount_cents=10000 WHERE supplier_payment_id='p1'");
    expect((await history('2026-10-03')).bills.map(row => row.bill_id)).toEqual(['b2']);
    const exported = await getSupplierApExport('a','2026-10-03',{},basis);
    expect(exported.bills.find(row => row.bill_id==='b1')).toMatchObject({paid_cents:'10000',outstanding_cents:'0'});
  });
  it.each(["UPDATE commercial_supplier_bills SET posted_at=NULL WHERE id='b1'", "UPDATE commercial_supplier_bills SET cancelled_at=NULL WHERE id='b2'", "UPDATE commercial_supplier_bills SET cancelled_at='2026-09-01T00:00:00Z' WHERE id='b2'", "UPDATE commercial_supplier_payments SET reversed_at=NULL WHERE id='p1'"])
    ('fails closed on incomplete history outside a filter: %s', async update => {
      await sql.raw(update); await expect(history('2026-10-03',{currency:'EUR'})).rejects.toThrow('history is incomplete');
      await expect(getSupplierApExport('a','2026-10-03',{},basis)).rejects.toThrow('history is incomplete');
      await expect(getSupplierApOverview('a','2026-10-03')).resolves.toBeDefined();
    });
});
