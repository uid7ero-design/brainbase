import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('purchasingCommitmentPeriods.integration.test.ts requires a disposable local Postgres DATABASE_URL.');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run commitment period integration tests against a hosted database.');
}
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) {
  throw new Error('Refusing to run commitment period integration tests against a non-localhost database.');
}

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
const UUID_SHAPE_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function compileQuery(strings: TemplateStringsArray, values: unknown[]) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    const cast = typeof values[i] === 'string' && UUID_SHAPE_RE.test(values[i] as string) ? '::uuid' : '';
    text += `$${i + 1}${cast}` + strings[i + 1];
  }
  return { text, values };
}

async function neonCompatibleSql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  const query = compileQuery(strings, values);
  return prisma.$queryRawUnsafe(query.text, ...query.values);
}

vi.doMock('@/lib/db', () => ({ default: neonCompatibleSql }));

let getPurchaseCommitmentReport: typeof import('@/lib/commercial/purchasingCommitments').getPurchaseCommitmentReport;

const ORG = 'org-c76g';
const OTHER_ORG = 'org-c76g-other';
beforeAll(async () => {
  ({ getPurchaseCommitmentReport } = await import('@/lib/commercial/purchasingCommitments'));
  await prisma.$executeRawUnsafe(
    `INSERT INTO organisations (id, name, slug) VALUES
      ('${ORG}', 'C7.6G Org', 'c76g-org'),
      ('${OTHER_ORG}', 'C7.6G Other Org', 'c76g-other')
     ON CONFLICT (id) DO NOTHING`,
  );
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_financial_periods WHERE organisation_id IN ('${ORG}', '${OTHER_ORG}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_financial_years WHERE organisation_id IN ('${ORG}', '${OTHER_ORG}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_purchase_order_lines WHERE organisation_id = '${ORG}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_purchase_orders WHERE organisation_id = '${ORG}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_suppliers WHERE organisation_id = '${ORG}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_cost_centres WHERE organisation_id = '${ORG}'`);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function addIssuedPo(issuedAt: string) {
  const suppliers = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO commercial_suppliers (organisation_id, name) VALUES ($1, 'Period Test Supplier') RETURNING id`,
    ORG,
  );
  const centres = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO commercial_cost_centres (organisation_id, code, name) VALUES ($1, 'OPS', 'Operations') RETURNING id`,
    ORG,
  );
  const pos = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO commercial_purchase_orders
      (organisation_id, supplier_id, status, currency, cost_centre_id, issued_at)
     VALUES ($1, $2::uuid, 'ISSUED', 'AUD', $3::uuid, $4::timestamptz)
     RETURNING id`,
    ORG, suppliers[0].id, centres[0].id, issuedAt,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_purchase_order_lines
      (organisation_id, purchase_order_id, position, description_snapshot, quantity, unit_price_cents,
       line_subtotal_cents, line_tax_cents, line_total_cents)
     VALUES ($1, $2::uuid, 1, 'Period-attributed service', 1, 10000, 10000, 0, 10000)`,
    ORG, pos[0].id,
  );
  return pos[0].id;
}
async function addFinancialYear(
  organisationId: string,
  name = 'FY2026-27',
  startsOn = '2026-07-01',
  endsOn = '2027-06-30',
) {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO commercial_financial_years
      (organisation_id, name, starts_on, ends_on, status)
     VALUES ($1, $2, $3::date, $4::date, 'OPEN')
     RETURNING id`,
    organisationId, name, startsOn, endsOn,
  );
  return rows[0].id;
}

async function addPeriod(params: {
  organisationId?: string;
  financialYearId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status?: 'OPEN' | 'CLOSED';
}) {
  const organisationId = params.organisationId ?? ORG;
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO commercial_financial_periods
      (financial_year_id, organisation_id, name, starts_on, ends_on, status)
     VALUES ($1::uuid, $2, $3, $4::date, $5::date, $6)
     RETURNING id`,
    params.financialYearId, organisationId, params.name, params.startsOn, params.endsOn, params.status ?? 'OPEN',
  );
  return rows[0].id;
}

async function onlyPo() {
  const report = await getPurchaseCommitmentReport(ORG);
  expect(report.purchaseOrderCount).toBe(1);
  return { report, po: report.purchaseOrders[0] };
}

describe('C7.6G — real Postgres governed commitment-period attribution', () => {
  it('resolves an issued PO to exactly one same-tenant OPEN period', async () => {
    await addIssuedPo('2026-09-15T12:00:00Z');
    const fy = await addFinancialYear(ORG);
    const periodId = await addPeriod({ financialYearId: fy, name: 'September 2026', startsOn: '2026-09-01', endsOn: '2026-09-30' });

    const { report, po } = await onlyPo();

    expect(report.periodResolution).toBe('RESOLVED');
    expect(report.resolvedPurchaseOrderCount).toBe(1);
    expect(po).toMatchObject({
      periodResolution: 'RESOLVED',
      financialPeriodId: periodId,
      financialPeriodName: 'September 2026',
      financialPeriodStatus: 'OPEN',
      financialYearId: fy,
      financialYearName: 'FY2026-27',
      supplierName: 'Period Test Supplier',
    });
    expect(po.lines[0]).toMatchObject({
      effectiveCostCentreCode: 'OPS',
      effectiveCostCentreName: 'Operations',
    });
  });
  it.each([
    ['start', '2026-09-01T00:00:00Z'],
    ['end', '2026-09-30T23:59:59Z'],
  ])('treats the %s date boundary as inclusive', async (_boundary, issuedAt) => {
    await addIssuedPo(issuedAt);
    const fy = await addFinancialYear(ORG);
    await addPeriod({ financialYearId: fy, name: 'September 2026', startsOn: '2026-09-01', endsOn: '2026-09-30' });

    const { po } = await onlyPo();
    expect(po.periodResolution).toBe('RESOLVED');
    expect(po.financialPeriodName).toBe('September 2026');
  });

  it('keeps a PO UNRESOLVED when no same-tenant period contains its issued date', async () => {
    await addIssuedPo('2026-10-15T12:00:00Z');
    const fy = await addFinancialYear(ORG);
    await addPeriod({ financialYearId: fy, name: 'September 2026', startsOn: '2026-09-01', endsOn: '2026-09-30' });

    const { report, po } = await onlyPo();
    expect(report).toMatchObject({
      periodResolution: 'UNRESOLVED',
      resolvedPurchaseOrderCount: 0,
      unresolvedPurchaseOrderCount: 1,
      ambiguousPurchaseOrderCount: 0,
    });
    expect(po).toMatchObject({
      periodResolution: 'UNRESOLVED',
      financialPeriodId: null,
      financialYearId: null,
    });
  });

  it('fails loud as AMBIGUOUS when overlapping periods both contain the issue date', async () => {
    await addIssuedPo('2026-09-15T12:00:00Z');
    const fy = await addFinancialYear(ORG);
    await addPeriod({ financialYearId: fy, name: 'September 2026', startsOn: '2026-09-01', endsOn: '2026-09-30' });
    await addPeriod({ financialYearId: fy, name: 'Late Q1', startsOn: '2026-09-10', endsOn: '2026-10-10' });

    const { report, po } = await onlyPo();
    expect(report).toMatchObject({
      periodResolution: 'AMBIGUOUS',
      ambiguousPurchaseOrderCount: 1,
    });
    expect(po).toMatchObject({
      periodResolution: 'AMBIGUOUS',
      financialPeriodId: null,
      financialPeriodName: null,
      financialYearId: null,
      financialYearName: null,
    });
  });
  it('resolves a CLOSED period for historical reads', async () => {
    await addIssuedPo('2026-09-15T12:00:00Z');
    const fy = await addFinancialYear(ORG);
    const periodId = await addPeriod({
      financialYearId: fy,
      name: 'September 2026',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
      status: 'CLOSED',
    });

    const { po } = await onlyPo();
    expect(po).toMatchObject({
      periodResolution: 'RESOLVED',
      financialPeriodId: periodId,
      financialPeriodStatus: 'CLOSED',
    });
  });

  it('never resolves against another tenant period even when its dates match exactly', async () => {
    await addIssuedPo('2026-09-15T12:00:00Z');
    const otherFy = await addFinancialYear(OTHER_ORG, 'FY Other');
    await addPeriod({
      organisationId: OTHER_ORG,
      financialYearId: otherFy,
      name: 'September Other',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });

    const { report, po } = await onlyPo();
    expect(report.unresolvedPurchaseOrderCount).toBe(1);
    expect(po).toMatchObject({
      periodResolution: 'UNRESOLVED',
      financialPeriodId: null,
      financialYearId: null,
    });
  });
});
