import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('budgetActualResolver.integration.test.ts requires DATABASE_URL.');
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
async function directSql(strings: TemplateStringsArray, ...values: unknown[]) {
  const q = compile({ strings, values });
  return prisma.$queryRawUnsafe(q.text, ...q.values);
}

const sqlMock = Object.assign(directSql, {
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
});
vi.doMock('@/lib/db', () => ({ default: sqlMock }));

const { getBudgetActualConsumption } = await import('@/lib/commercial/budgetActualResolver');

const ORG = 'org-c78b';
const OTHER = 'org-c78b-other';
const USER = 'user-c78b';
const FY = '78888888-1000-0000-0000-000000000001';
const PERIOD = '78888888-1000-0000-0000-000000000002';
const CC = '78888888-1000-0000-0000-000000000003';
const SUP = '78888888-1000-0000-0000-000000000004';
const PO = '78888888-1000-0000-0000-000000000005';
const POL = '78888888-1000-0000-0000-000000000006';
const BILL = '78888888-1000-0000-0000-000000000007';
const BILL_LINE = '78888888-1000-0000-0000-000000000008';
const ACC = '78888888-1000-0000-0000-000000000009';
const BUDGET = '78888888-1000-0000-0000-000000000010';
const VERSION = '78888888-1000-0000-0000-000000000011';
const BUDGET_LINE = '78888888-1000-0000-0000-000000000012';

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `INSERT INTO organisations(id,name) VALUES ($1,'C7.8B Org'),($2,'C7.8B Other')
     ON CONFLICT (id) DO NOTHING`,
    ORG, OTHER,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO users(id,organisation_id) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
    USER, ORG,
  );
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_supplier_bill_lines WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_supplier_bills WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_purchase_order_lines WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_purchase_orders WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_suppliers WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_period_allocations WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_commitment_mappings WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_lines WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`UPDATE commercial_budgets SET active_version_id=NULL WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_versions WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budgets WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_accounts WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_financial_periods WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_financial_years WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_cost_centres WHERE organisation_id IN ($1,$2)`, ORG, OTHER);

  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_years(id,organisation_id,name,starts_on,ends_on,status)
     VALUES ($1::uuid,$2,'FY26','2026-07-01','2027-06-30','OPEN')`, FY, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_periods(id,financial_year_id,organisation_id,name,starts_on,ends_on,status)
     VALUES ($1::uuid,$2::uuid,$3,'September','2026-09-01','2026-09-30','OPEN')`, PERIOD, FY, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_cost_centres(id,organisation_id,code,name,active)
     VALUES ($1::uuid,$2,'OPS','Operations',true)`, CC, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_suppliers(id,organisation_id,name) VALUES ($1::uuid,$2,'Supplier')`, SUP, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_purchase_orders(id,organisation_id,supplier_id,status,currency,cost_centre_id,issued_at)
     VALUES ($1::uuid,$2,$3::uuid,'ISSUED','AUD',$4::uuid,'2026-08-01T00:00:00Z')`, PO, ORG, SUP, CC,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_purchase_order_lines
      (id,organisation_id,purchase_order_id,position,description_snapshot,cost_centre_id,line_subtotal_cents,line_tax_cents,line_total_cents)
     VALUES ($1::uuid,$2,$3::uuid,1,'Services',NULL,10000,1000,11000)`, POL, ORG, PO,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_supplier_bills
      (id,organisation_id,supplier_id,source_purchase_order_id,bill_number,status,currency,bill_date,supplier_name_snapshot,posted_at)
     VALUES ($1::uuid,$2,$3::uuid,$4::uuid,'BILL-1','POSTED','AUD','2026-08-15','Supplier','2026-09-15T12:00:00Z')`,
    BILL, ORG, SUP, PO,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_supplier_bill_lines
      (id,organisation_id,supplier_bill_id,source_purchase_order_line_id,position,line_subtotal_cents,line_tax_cents,line_total_cents)
     VALUES ($1::uuid,$2,$3::uuid,$4::uuid,1,2500,250,2750)`, BILL_LINE, ORG, BILL, POL,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_accounts(id,organisation_id,code,name,active,created_by)
     VALUES ($1::uuid,$2,'OPEX','Operating',true,$3)`, ACC, ORG, USER,
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
    `UPDATE commercial_budgets SET active_version_id=$1::uuid WHERE id=$2::uuid`, VERSION, BUDGET,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_lines
      (id,organisation_id,budget_version_id,budget_account_id,cost_centre_id,annual_budget_cents)
     VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,120000)`,
    BUDGET_LINE, ORG, VERSION, ACC, CC,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_period_allocations
      (organisation_id,budget_line_id,financial_period_id,amount_cents)
     VALUES ($1,$2::uuid,$3::uuid,10000)`, ORG, BUDGET_LINE, PERIOD,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_commitment_mappings
      (organisation_id,budget_version_id,cost_centre_id,budget_account_id,created_by)
     VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5)`, ORG, VERSION, CC, ACC, USER,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('C7.8B — real PostgreSQL Actual classification', () => {
  it('classifies the real POSTED Actual into the ACTIVE Budget on INCLUSIVE basis', async () => {
    const result = await getBudgetActualConsumption(ORG);

    expect(result.exceptions).toEqual([]);
    expect(result.resolved).toEqual([expect.objectContaining({
      supplierBillLineId: BILL_LINE,
      budgetId: BUDGET,
      budgetVersionId: VERSION,
      budgetAccountId: ACC,
      budgetLineId: BUDGET_LINE,
      financialPeriodId: PERIOD,
      costCentreId: CC,
      taxBasis: 'INCLUSIVE',
      sourceSubtotalCents: 2500,
      sourceTaxCents: 250,
      sourceTotalCents: 2750,
      actualCents: 2750,
      periodBudgetCents: 10000,
    })]);
  });

  it('switches to EXCLUSIVE amount when the ACTIVE Budget tax basis changes', async () => {
    await prisma.$executeRawUnsafe(
      `UPDATE commercial_budgets SET tax_basis='EXCLUSIVE' WHERE id=$1::uuid`, BUDGET,
    );

    const result = await getBudgetActualConsumption(ORG);

    expect(result.resolved[0]).toMatchObject({ taxBasis: 'EXCLUSIVE', actualCents: 2500 });
  });
  it('preserves a mapped Budget-basis amount when account mapping is missing', async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM commercial_budget_commitment_mappings WHERE organisation_id=$1`, ORG,
    );

    const result = await getBudgetActualConsumption(ORG);

    expect(result.resolved).toHaveLength(0);
    expect(result.exceptions[0]).toMatchObject({
      codes: ['UNMAPPED_ACCOUNT'],
      budgetId: BUDGET,
      budgetVersionId: VERSION,
      actualCents: 2750,
    });
  });

  it('returns NO_ACTIVE_BUDGET when the exact Budget has no active pointer', async () => {
    await prisma.$executeRawUnsafe(
      `UPDATE commercial_budgets SET active_version_id=NULL WHERE id=$1::uuid`, BUDGET,
    );
    const result = await getBudgetActualConsumption(ORG);

    expect(result.resolved).toHaveLength(0);
    expect(result.exceptions[0].codes).toEqual(['NO_ACTIVE_BUDGET']);
    expect(result.exceptions[0].actualCents).toBeNull();
  });

  it('returns no Actual or Budget context from another tenant', async () => {
    const result = await getBudgetActualConsumption(OTHER);
    expect(result).toMatchObject({
      resolvedActualCount: 0,
      unresolvedExceptionCount: 0,
      resolved: [],
      rows: [],
      exceptions: [],
    });
  });
});
