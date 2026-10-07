import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('budgetActuals.integration.test.ts requires DATABASE_URL.');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) throw new Error('Refusing hosted database.');
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) throw new Error('Refusing non-localhost database.');

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function compile(strings: TemplateStringsArray, values: unknown[]) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    const cast = typeof values[i] === 'string' && UUID_RE.test(values[i] as string) ? '::uuid' : '';
    text += `$${i + 1}${cast}` + strings[i + 1];
  }
  return { text, values };
}

async function sqlMock(strings: TemplateStringsArray, ...values: unknown[]) {
  const query = compile(strings, values);
  return prisma.$queryRawUnsafe(query.text, ...query.values);
}
vi.doMock('@/lib/db', () => ({ default: sqlMock }));

const { getBudgetActualReport } = await import('@/lib/commercial/budgetActuals');
const ORG = 'org-c78a';
const OTHER = 'org-c78a-other';
const FY = '78888888-0000-0000-0000-000000000001';
const PERIOD = '78888888-0000-0000-0000-000000000002';
const AUGUST_PERIOD = '78888888-0000-0000-0000-000000000008';
const CC_HEADER = '78888888-0000-0000-0000-000000000003';
const CC_LINE = '78888888-0000-0000-0000-000000000004';
const SUP = '78888888-0000-0000-0000-000000000005';
const PO = '78888888-0000-0000-0000-000000000006';
const POL = '78888888-0000-0000-0000-000000000007';

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `INSERT INTO organisations(id,name) VALUES ($1,'C7.8A Org'),($2,'C7.8A Other') ON CONFLICT (id) DO NOTHING`,
    ORG, OTHER,
  );
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_supplier_bill_lines WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_supplier_bills WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_purchase_order_lines WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_purchase_orders WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_suppliers WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_financial_periods WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_financial_years WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_cost_centres WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_years(id,organisation_id,name,starts_on,ends_on,status)
     VALUES ($1::uuid,$2,'FY26','2026-07-01','2027-06-30','OPEN')`, FY, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_periods(id,financial_year_id,organisation_id,name,starts_on,ends_on,status)
     VALUES ($1::uuid,$3::uuid,$4,'September','2026-09-01','2026-09-30','OPEN'),
            ($2::uuid,$3::uuid,$4,'August','2026-08-01','2026-08-31','OPEN')`,
    PERIOD, AUGUST_PERIOD, FY, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_cost_centres(id,organisation_id,code,name,active)
     VALUES ($1::uuid,$3,'HDR','Header',true),($2::uuid,$3,'LINE','Line',true)`, CC_HEADER, CC_LINE, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_suppliers(id,organisation_id,name) VALUES ($1::uuid,$2,'Supplier')`, SUP, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_purchase_orders(id,organisation_id,supplier_id,status,currency,cost_centre_id,issued_at)
     VALUES ($1::uuid,$2,$3::uuid,'ISSUED','AUD',$4::uuid,'2026-08-01T00:00:00Z')`, PO, ORG, SUP, CC_HEADER,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_purchase_order_lines
      (id,organisation_id,purchase_order_id,position,description_snapshot,cost_centre_id,line_subtotal_cents,line_tax_cents,line_total_cents)
     VALUES ($1::uuid,$2,$3::uuid,1,'Services',$4::uuid,10000,1000,11000)`, POL, ORG, PO, CC_LINE,
  );
});

afterAll(async () => { await prisma.$disconnect(); });
async function addBill(params: {
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  postedAt?: string | null;
  billDate?: string | null;
  organisationId?: string;
  poId?: string;
  poLineId?: string;
}) {
  const org = params.organisationId ?? ORG;
  const billId = crypto.randomUUID();
  const lineId = crypto.randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_supplier_bills
      (id,organisation_id,supplier_id,source_purchase_order_id,bill_number,status,currency,bill_date,supplier_name_snapshot,posted_at)
     VALUES ($1::uuid,$2,$3::uuid,$4::uuid,'BILL-X',$5,'AUD',$6::date,'Supplier',$7::timestamptz)`,
    billId, org, SUP, params.poId ?? PO, params.status, params.billDate ?? null, params.postedAt ?? null,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_supplier_bill_lines
      (id,organisation_id,supplier_bill_id,source_purchase_order_line_id,position,line_subtotal_cents,line_tax_cents,line_total_cents)
     VALUES ($1::uuid,$2,$3::uuid,$4::uuid,1,2500,250,2750)`,
    lineId, org, billId, params.poLineId ?? POL,
  );
  return { billId, lineId };
}

describe('C7.8A — real PostgreSQL derived Actuals', () => {
  it('includes only POSTED bills and recognises by posted_at, not bill_date', async () => {
    await addBill({ status: 'DRAFT', billDate: '2026-09-15' });
    await addBill({ status: 'CANCELLED', postedAt: '2026-09-15T12:00:00Z', billDate: '2026-09-15' });
    const posted = await addBill({ status: 'POSTED', postedAt: '2026-09-20T12:00:00Z', billDate: '2026-12-01' });

    const report = await getBudgetActualReport(ORG);
    expect(report.lineCount).toBe(1);
    expect(report.lines[0]).toMatchObject({
      supplierBillLineId: posted.lineId,
      recognisedAt: '2026-09-20T12:00:00.000Z',
      periodResolution: 'RESOLVED',
      financialPeriodId: PERIOD,
      financialPeriodName: 'September',
      subtotalCents: 2500,
      taxCents: 250,
      totalCents: 2750,
    });
  });
  it('flags a prior-period late bill but keeps recognition in the posted_at period', async () => {
    const posted = await addBill({
      status: 'POSTED',
      postedAt: '2026-09-20T12:00:00Z',
      billDate: '2026-08-20',
    });

    const report = await getBudgetActualReport(ORG);
    expect(report.lines[0]).toMatchObject({
      supplierBillLineId: posted.lineId,
      financialPeriodId: PERIOD,
      billDateFinancialPeriodId: AUGUST_PERIOD,
      billDateFinancialPeriodStatus: 'OPEN',
    });
    expect(report.lines[0].exceptionCodes).toContain('LATE_BILL_PRIOR_PERIOD');
    expect(report.lines[0].exceptionCodes).not.toContain('LATE_BILL_CLOSED_PERIOD');
  });

  it('flags a prior CLOSED bill-date period without reopening or moving recognition', async () => {
    await prisma.$executeRawUnsafe(
      `UPDATE commercial_financial_periods SET status='CLOSED' WHERE id=$1::uuid`,
      AUGUST_PERIOD,
    );
    await addBill({
      status: 'POSTED',
      postedAt: '2026-09-20T12:00:00Z',
      billDate: '2026-08-20',
    });

    const report = await getBudgetActualReport(ORG);
    expect(report.lines[0]).toMatchObject({
      financialPeriodId: PERIOD,
      billDateFinancialPeriodId: AUGUST_PERIOD,
      billDateFinancialPeriodStatus: 'CLOSED',
    });
    expect(report.lines[0].exceptionCodes).toEqual(expect.arrayContaining([
      'LATE_BILL_PRIOR_PERIOD',
      'LATE_BILL_CLOSED_PERIOD',
    ]));

    const august = await prisma.$queryRawUnsafe<{ status: string }[]>(
      `SELECT status FROM commercial_financial_periods WHERE id=$1::uuid`,
      AUGUST_PERIOD,
    );
    expect(august[0].status).toBe('CLOSED');
  });

  it('keeps an unresolved bill-date period as reconciliation-only when posted_at resolves', async () => {
    await addBill({
      status: 'POSTED',
      postedAt: '2026-09-20T12:00:00Z',
      billDate: '2026-06-20',
    });

    const report = await getBudgetActualReport(ORG);
    expect(report.lines[0]).toMatchObject({
      periodResolution: 'RESOLVED',
      financialPeriodId: PERIOD,
      billDatePeriodResolution: 'UNRESOLVED',
      billDateFinancialPeriodId: null,
    });
    expect(report.lines[0].exceptionCodes).toContain('BILL_DATE_UNRESOLVED');
  });

  it('uses PO-line cost centre override and falls back to the PO header when the line is null', async () => {
    await addBill({ status: 'POSTED', postedAt: '2026-09-15T00:00:00Z' });
    let report = await getBudgetActualReport(ORG);
    expect(report.lines[0]).toMatchObject({ effectiveCostCentreId: CC_LINE, effectiveCostCentreCode: 'LINE' });

    await prisma.$executeRawUnsafe(`UPDATE commercial_purchase_order_lines SET cost_centre_id=NULL WHERE id=$1::uuid`, POL);
    report = await getBudgetActualReport(ORG);
    expect(report.lines[0]).toMatchObject({ effectiveCostCentreId: CC_HEADER, effectiveCostCentreCode: 'HDR' });
  });

  it('fails loud as AMBIGUOUS when posted_at matches overlapping periods', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_financial_periods(financial_year_id,organisation_id,name,starts_on,ends_on,status)
       VALUES ($1::uuid,$2,'Overlap','2026-09-10','2026-09-25','OPEN')`, FY, ORG,
    );
    await addBill({ status: 'POSTED', postedAt: '2026-09-15T12:00:00Z' });

    const report = await getBudgetActualReport(ORG);
    expect(report.lines[0]).toMatchObject({
      periodResolution: 'AMBIGUOUS',
      financialPeriodId: null,
      financialYearId: null,
    });
    expect(report.lines[0].exceptionCodes).toContain('AMBIGUOUS_PERIOD');
  });

  it('never resolves another tenant financial period', async () => {
    const otherFy = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_financial_years(id,organisation_id,name,starts_on,ends_on,status)
       VALUES ($1::uuid,$2,'Other FY','2026-07-01','2027-06-30','OPEN')`, otherFy, OTHER,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_financial_periods(financial_year_id,organisation_id,name,starts_on,ends_on,status)
       VALUES ($1::uuid,$2,'Other September','2026-09-01','2026-09-30','OPEN')`, otherFy, OTHER,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM commercial_financial_periods WHERE organisation_id=$1`, ORG);
    await addBill({ status: 'POSTED', postedAt: '2026-09-15T12:00:00Z' });

    const report = await getBudgetActualReport(ORG);
    expect(report.lines[0].periodResolution).toBe('UNRESOLVED');
    expect(report.lines[0].exceptionCodes).toContain('UNRESOLVED_PERIOD');
  });
});
