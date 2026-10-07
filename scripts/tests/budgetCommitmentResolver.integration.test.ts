import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('budgetCommitmentResolver.integration.test.ts requires DATABASE_URL.');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) throw new Error('Refusing hosted database.');
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) throw new Error('Refusing non-localhost database.');

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type QueryDescriptor = { strings: readonly string[]; values: unknown[] };
function compile(q: QueryDescriptor) {
  let text = q.strings[0];
  for (let i = 0; i < q.values.length; i++) {
    const cast = typeof q.values[i] === 'string' && UUID_RE.test(q.values[i] as string) ? '::uuid' : '';
    text += `$${i + 1}${cast}` + q.strings[i + 1];
  }
  return { text, values: q.values };
}

const sqlMock = Object.assign(
  () => { throw new Error('unexpected non-transactional SQL'); },
  {
    transaction: async (
      builder: (txn: (strings: TemplateStringsArray, ...values: unknown[]) => QueryDescriptor) => QueryDescriptor[],
      options?: { isolationLevel?: string },
    ) => prisma.$transaction(async tx => {
      const descriptors = builder((strings, ...values) => ({ strings, values }));
      const results: unknown[] = [];
      for (const descriptor of descriptors) {
        const q = compile(descriptor);
        results.push(await tx.$queryRawUnsafe(q.text, ...q.values));
      }
      return results;
    }, { isolationLevel: options?.isolationLevel as 'RepeatableRead' | undefined }),
  },
);
vi.doMock('@/lib/db', () => ({ default: sqlMock }));

const getPurchaseCommitmentReportMock = vi.fn();
vi.doMock('@/lib/commercial/purchasingCommitments', () => ({
  getPurchaseCommitmentReport: (...args: unknown[]) => getPurchaseCommitmentReportMock(...args),
}));

const { getBudgetCommitmentConsumption, getActiveBudgetContext } = await import('@/lib/commercial/budgetCommitmentResolver');

const ORG = 'org-c77e';
const OTHER = 'org-c77e-other';
const USER = 'user-c77e';
const FY = '77777777-7000-0000-0000-000000000001';
const PERIOD = '77777777-7000-0000-0000-000000000002';
const CC = '77777777-7000-0000-0000-000000000003';
const ACC = '77777777-7000-0000-0000-000000000004';
const BUDGET = '77777777-7000-0000-0000-000000000005';
const VERSION = '77777777-7000-0000-0000-000000000006';
const LINE = '77777777-7000-0000-0000-000000000007';

function commitmentReport(currency = 'AUD', costCentreId: string | null = CC) {
  return {
    periodResolution: 'RESOLVED',
    purchaseOrderCount: 1,
    resolvedPurchaseOrderCount: 1,
    unresolvedPurchaseOrderCount: 0,
    ambiguousPurchaseOrderCount: 0,
    lineCount: 1,
    currencies: [],
    purchaseOrders: [{
      purchaseOrderId: 'po-1',
      purchaseOrderStatus: 'ISSUED',
      supplierId: 'sup-1',
      supplierName: 'Supplier',
      currency,
      commitmentEffectiveAt: '2026-09-15T00:00:00.000Z',
      periodResolution: 'RESOLVED',
      financialPeriodId: PERIOD,
      financialPeriodName: 'September',
      financialPeriodStatus: 'OPEN',
      financialYearId: FY,
      financialYearName: 'FY26',
      lineCount: 1,
      orderedSubtotalCents: 10000,
      orderedTaxCents: 1000,
      orderedTotalCents: 11000,
      billedSubtotalCents: 2500,
      billedTaxCents: 250,
      billedTotalCents: 2750,
      outstandingSubtotalCents: 7500,
      outstandingTaxCents: 750,
      outstandingTotalCents: 8250,
      lines: [{
        purchaseOrderLineId: 'pol-1',
        position: 1,
        description: 'Services',
        effectiveCostCentreId: costCentreId,
        effectiveCostCentreCode: 'OPS',
        effectiveCostCentreName: 'Operations',
        state: 'PARTIALLY_CONSUMED',
        orderedSubtotalCents: 10000,
        orderedTaxCents: 1000,
        orderedTotalCents: 11000,
        billedSubtotalCents: 2500,
        billedTaxCents: 250,
        billedTotalCents: 2750,
        outstandingSubtotalCents: 7500,
        outstandingTaxCents: 750,
        outstandingTotalCents: 8250,
      }],
    }],
  };
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `INSERT INTO organisations(id,name) VALUES ($1,'C7.7E Org'),($2,'C7.7E Other')
     ON CONFLICT (id) DO NOTHING`,
    ORG, OTHER,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO users(id,organisation_id) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
    USER, ORG,
  );
});

beforeEach(async () => {
  getPurchaseCommitmentReportMock.mockReset();

  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_period_allocations WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_commitment_mappings WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_lines WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`UPDATE commercial_budgets SET active_version_id=NULL WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_versions WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budgets WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_accounts WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_cost_centres WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_financial_periods WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_financial_years WHERE organisation_id IN ($1,$2)`, ORG, OTHER);

  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_years(id,organisation_id,name,starts_on,ends_on,status)
     VALUES ($1::uuid,$2,'FY26','2026-07-01','2027-06-30','OPEN')`,
    FY, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_periods(id,financial_year_id,organisation_id,name,starts_on,ends_on,status)
     VALUES ($1::uuid,$2::uuid,$3,'September','2026-09-01','2026-09-30','OPEN')`,
    PERIOD, FY, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_cost_centres(id,organisation_id,code,name,active)
     VALUES ($1::uuid,$2,'OPS','Operations',true)`,
    CC, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_accounts(id,organisation_id,code,name,active,created_by)
     VALUES ($1::uuid,$2,'OPEX','Operating',true,$3)`,
    ACC, ORG, USER,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budgets
      (id,organisation_id,financial_year_id,name,currency,tax_basis,periodisation_mode,created_by)
     VALUES ($1::uuid,$2,$3::uuid,'FY Budget','AUD','INCLUSIVE','PERIODISED',$4)`,
    BUDGET, ORG, FY, USER,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_versions
      (id,organisation_id,budget_id,version_number,status,created_by,activated_by,activated_at)
     VALUES ($1::uuid,$2,$3::uuid,1,'ACTIVE',$4,$4,now())`,
    VERSION, ORG, BUDGET, USER,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE commercial_budgets SET active_version_id=$1::uuid WHERE id=$2::uuid`,
    VERSION, BUDGET,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_lines
      (id,organisation_id,budget_version_id,budget_account_id,cost_centre_id,annual_budget_cents)
     VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,120000)`,
    LINE, ORG, VERSION, ACC, CC,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_period_allocations
      (organisation_id,budget_line_id,financial_period_id,amount_cents)
     VALUES ($1,$2::uuid,$3::uuid,10000)`,
    ORG, LINE, PERIOD,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_commitment_mappings
      (organisation_id,budget_version_id,cost_centre_id,budget_account_id,created_by)
     VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5)`,
    ORG, VERSION, CC, ACC, USER,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('C7.7E — real PostgreSQL Budget commitment resolver', () => {
  it('reads the ACTIVE pointer-backed Budget context and resolves tax-inclusive commitment', async () => {
    getPurchaseCommitmentReportMock.mockResolvedValue(commitmentReport());

    const result = await getBudgetCommitmentConsumption(ORG);

    expect(result.exceptions).toEqual([]);
    expect(result.rows).toEqual([expect.objectContaining({
      budgetId: BUDGET,
      budgetVersionId: VERSION,
      budgetAccountId: ACC,
      costCentreId: CC,
      financialPeriodId: PERIOD,
      annualBudgetCents: 120000,
      periodBudgetCents: 10000,
      committedCents: 8250,
      billedCents: 2750,
      budgetLessCommitmentsCents: 1750,
    })]);
  });

  it('does not read another tenant context', async () => {
    const otherContext = await getActiveBudgetContext(OTHER);
    expect(otherContext).toEqual({ budgetIdentities: [], budgets: [], mappings: [], lines: [], periodAllocations: [] });
  });

  it('surfaces foreign-currency commitment without conversion', async () => {
    getPurchaseCommitmentReportMock.mockResolvedValue(commitmentReport('USD'));

    const result = await getBudgetCommitmentConsumption(ORG);

    expect(result.resolved).toHaveLength(0);
    expect(result.exceptions[0]).toMatchObject({
      code: 'CURRENCY_MISMATCH',
      currency: 'USD',
      committedCents: null,
    });
  });

  it('surfaces missing effective cost centre instead of forcing an account', async () => {
    getPurchaseCommitmentReportMock.mockResolvedValue(commitmentReport('AUD', null));

    const result = await getBudgetCommitmentConsumption(ORG);

    expect(result.resolved).toHaveLength(0);
    expect(result.exceptions[0]).toMatchObject({
      code: 'UNATTRIBUTED_COST_CENTRE',
      budgetId: BUDGET,
      committedCents: 8250,
    });
  });
});
