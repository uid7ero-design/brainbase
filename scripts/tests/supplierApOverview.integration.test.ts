import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';
import { AP_AGING_BUCKETS, buildSupplierApOverview } from '../../lib/commercial/supplierApOverviewModel';
const url = process.env.DATABASE_URL;
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)) throw new Error('Requires a fresh disposable localhost database');
const sql = createNeonCompatibleSql(url);
vi.doMock('@/lib/db', () => ({ default: sql }));
const { getSupplierApOverview, getSupplierApBills } = await import('@/lib/commercial/supplierApOverview');
beforeAll(async () => {
  await sql.raw('CREATE TABLE commercial_suppliers(id text, organisation_id text, name text, active boolean)');
  await sql.raw('CREATE TABLE commercial_supplier_bills(id text, organisation_id text, supplier_id text, bill_number text, supplier_invoice_number text, due_date date, currency text, total_cents integer, status text)');
  await sql.raw('CREATE TABLE commercial_supplier_payments(id text, organisation_id text, supplier_id text, currency text, status text)');
  await sql.raw('CREATE TABLE commercial_supplier_payment_allocations(supplier_bill_id text, supplier_payment_id text, organisation_id text, supplier_id text, currency text, allocated_amount_cents integer)');
  await sql.raw("INSERT INTO commercial_suppliers VALUES ('s','a','Inactive supplier',false),('x','other','Other tenant',true)");
  await sql.raw(`INSERT INTO commercial_supplier_bills VALUES
    ('b1','a','s','SB1','INV1','2026-09-05','AUD',10000,'POSTED'),
    ('b2','a','s','SB2','INV2',NULL,'AUD',10000,'POSTED'),
    ('b3','a','s','SB3','INV3','2026-10-05','USD',10000,'POSTED'),
    ('b4','a','s','SB4','INV4','2026-01-01','AUD',10000,'DRAFT'),
    ('b5','a','s','SB5','INV5','2026-01-01','AUD',10000,'CANCELLED'),
    ('big1','a','s','BIG1','BIG1',NULL,'EUR',2147483647,'POSTED'),
    ('big2','a','s','BIG2','BIG2',NULL,'EUR',2147483647,'POSTED'),
    ('other','other','x','OTHER','OTHER','2026-01-01','AUD',10000,'POSTED')`);
  await sql.raw("INSERT INTO commercial_supplier_payments VALUES ('p1','a','s','AUD','RECORDED'),('p2','a','s','AUD','RECORDED'),('p3','a','s','AUD','REVERSED')");
  await sql.raw("INSERT INTO commercial_supplier_payment_allocations VALUES ('b1','p1','a','s','AUD',1000),('b2','p1','a','s','AUD',2000),('b1','p2','a','s','AUD',1500),('b1','p3','a','s','AUD',3000)");
});
afterAll(() => sql.end());
describe('AP overview real PostgreSQL', () => {
  it('aggregates allocations once, includes inactive suppliers and excludes unrelated bills', async () => {
    const report = await getSupplierApOverview('a', '2026-10-05');
    expect(report.bills).toHaveLength(5);
    const aud = report.currencies.find(row => row.currency === 'AUD')!;
    expect(aud.payable_cents).toBe('20000'); expect(aud.paid_cents).toBe('4500'); expect(aud.outstanding_cents).toBe('15500');
    expect(aud.buckets.DAYS_1_30).toBe('7500'); expect(aud.buckets.NO_DUE_DATE).toBe('8000');
    expect(report.currencies.find(row => row.currency === 'EUR')!.outstanding_cents).toBe('4294967294');
    expect(report.suppliers.every(row => !row.supplier_active)).toBe(true);
    expect((await getSupplierApOverview('none', '2026-10-05')).bills).toEqual([]);
  });
  it('reversal restores outstanding without changing posted payable; aging is current balance classification', async () => {
    await sql.raw("UPDATE commercial_supplier_payments SET status='REVERSED' WHERE id='p1'");
    const report = await getSupplierApOverview('a', '2026-10-06');
    const aud = report.currencies.find(row => row.currency === 'AUD')!;
    expect(aud.payable_cents).toBe('20000'); expect(aud.paid_cents).toBe('1500'); expect(aud.outstanding_cents).toBe('18500');
    expect(aud.buckets.DAYS_31_60).toBe('8500');
  });
  it('keeps full-scope totals and supplier aging identical across bounded pages, including fully paid bills', async () => {
    await sql.raw("INSERT INTO commercial_supplier_payments VALUES ('p4','a','s','AUD','RECORDED')");
    await sql.raw("INSERT INTO commercial_supplier_payment_allocations VALUES ('b2','p4','a','s','AUD',10000)");
    await sql.raw("INSERT INTO commercial_supplier_bills VALUES ('zero','a','s','ZERO','ZERO',NULL,'AUD',0,'POSTED')");
    const expected = buildSupplierApOverview(await getSupplierApBills('a'), '2026-10-05');
    const seen: string[] = [];
    for (let page = 1; page <= 5; page++) {
      const report = await getSupplierApOverview('a','2026-10-05',{ page, supplierPage: page, pageSize: 1 });
      expect(report.bills.length).toBeLessThanOrEqual(1); expect(report.suppliers.length).toBeLessThanOrEqual(1);
      expect(report.pagination).toMatchObject({ outstanding_bill_count: 4, supplier_count: 3 });
      expect(report.currencies).toEqual([...expected.currencies].sort((a,b) => a.currency.localeCompare(b.currency)));
      if (report.suppliers[0]) expect(report.suppliers[0]).toEqual(expected.suppliers.find(row => row.currency === report.suppliers[0].currency));
      expect(report.options.currencies).toEqual(['AUD','EUR','USD']); expect(report.options.suppliers).toHaveLength(1);
      seen.push(...report.bills.map(row => row.bill_id));
    }
    expect(new Set(seen).size).toBe(4); expect(seen).not.toContain('b2');
    expect((await getSupplierApOverview('a','2026-10-05',{pageSize:1})).bills[0].bill_id).toBe(seen[0]);
  });
  it('filters the complete scope before aggregating and treats search wildcards literally', async () => {
    const report = await getSupplierApOverview('a','2026-10-05',{ search:'inv1', currency:'AUD', supplierId:'s', bucket:'DAYS_1_30', pageSize:1 });
    expect(report.bills.map(row => row.bill_id)).toEqual(['b1']); expect(report.currencies[0].outstanding_cents).toBe('8500');
    expect((await getSupplierApOverview('a','2026-10-05',{search:'%'})).currencies).toEqual([]);
    expect((await getSupplierApOverview('a','2026-10-05',{supplierId:'x'})).currencies).toEqual([]);
    const paid = await getSupplierApOverview('a','2026-10-05',{search:'INV2'});
    expect(paid.bills).toEqual([]); expect(paid.currencies[0]).toMatchObject({payable_cents:'10000',paid_cents:'10000',outstanding_cents:'0'});
  });
  it('matches the independent calendar aging model at every SQL bucket boundary', async () => {
    for (const days of [-1,0,1,30,31,60,61,90,91]) {
      const due = new Date(Date.UTC(2026,9,5)-days*86400000).toISOString().slice(0,10);
      await sql.raw(`INSERT INTO commercial_supplier_bills VALUES ('boundary${days}','a','s','BOUND${days}','BOUND${days}','${due}','AUD',100,'POSTED')`);
    }
    const expected = buildSupplierApOverview((await getSupplierApBills('a')).filter(row => row.bill_number?.startsWith('BOUND')), '2026-10-05');
    for (const bucket of AP_AGING_BUCKETS) {
      const report = await getSupplierApOverview('a','2026-10-05',{search:'BOUND',bucket});
      expect(report.bills.map(row => row.bill_id).sort()).toEqual(expected.bills.filter(row => row.bucket === bucket).map(row => row.bill_id).sort());
    }
  });
  it('fails closed on a negative balance even when its bill is outside the selected page/filter', async () => {
    await sql.raw("INSERT INTO commercial_supplier_payment_allocations VALUES ('b1','p4','a','s','AUD',10000)");
    await expect(getSupplierApOverview('a','2026-10-05',{currency:'USD',page:99})).rejects.toThrow('negative outstanding');
  });
});
