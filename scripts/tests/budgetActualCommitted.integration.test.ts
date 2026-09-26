import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('budgetActualCommitted.integration.test.ts requires DATABASE_URL.');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) throw new Error('Refusing hosted database.');
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) throw new Error('Refusing non-localhost database.');

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
const writer = new PrismaClient({ datasourceUrl: DATABASE_URL });
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

let afterFirstSnapshotStatement: (() => Promise<void>) | null = null;
const sqlMock = Object.assign(
  () => { throw new Error('unexpected non-transactional SQL in C7.8C integration test'); },
  {
    transaction: async (
      builder: (txn: (strings: TemplateStringsArray, ...values: unknown[]) => QueryDescriptor) => QueryDescriptor[],
      options?: { isolationLevel?: string },
    ) => prisma.$transaction(async tx => {
      const descriptors = builder((strings, ...values) => ({ strings, values }));
      const results: unknown[] = [];
      for (let i = 0; i < descriptors.length; i++) {
        const q = compile(descriptors[i]);
        results.push(await tx.$queryRawUnsafe(q.text, ...q.values));
        if (i === 0 && afterFirstSnapshotStatement) {
          const hook = afterFirstSnapshotStatement;
          afterFirstSnapshotStatement = null;
          await hook();
        }
      }
      return results;
    }, { isolationLevel: options?.isolationLevel as 'RepeatableRead' | undefined }),
  },
);
vi.doMock('@/lib/db', () => ({ default: sqlMock }));

const { getBudgetActualCommittedReport } = await import('@/lib/commercial/budgetActualCommitted');

const ORG = 'org-c78c';
const OTHER = 'org-c78c-other';
const USER = 'user-c78c';
const FY = '78888888-2000-0000-0000-000000000001';
const PERIOD = '78888888-2000-0000-0000-000000000002';
const CC = '78888888-2000-0000-0000-000000000003';
const SUP = '78888888-2000-0000-0000-000000000004';
const PO = '78888888-2000-0000-0000-000000000005';
const POL = '78888888-2000-0000-0000-000000000006';
const BILL = '78888888-2000-0000-0000-000000000007';
const BILL_LINE = '78888888-2000-0000-0000-000000000008';
const ACC = '78888888-2000-0000-0000-000000000009';
const BUDGET = '78888888-2000-0000-0000-000000000010';
const VERSION = '78888888-2000-0000-0000-000000000011';
const BUDGET_LINE = '78888888-2000-0000-0000-000000000012';

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `INSERT INTO organisations(id,name) VALUES ($1,'C7.8C Org'),($2,'C7.8C Other')
     ON CONFLICT (id) DO NOTHING`, ORG, OTHER,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO users(id,organisation_id) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
    USER, ORG,
  );
});

beforeEach(async () => {
  afterFirstSnapshotStatement = null;
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
     VALUES ($1::uuid,$2::uuid,$3,'September','2026-09-01','2026-09-30','OPEN')`,
    PERIOD, FY, ORG,
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
     VALUES ($1::uuid,$2,$3::uuid,'ISSUED','AUD',$4::uuid,'2026-09-10T00:00:00Z')`,
    PO, ORG, SUP, CC,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_purchase_order_lines
      (id,organisation_id,purchase_order_id,position,description_snapshot,cost_centre_id,line_subtotal_cents,line_tax_cents,line_total_cents)
     VALUES ($1::uuid,$2,$3::uuid,1,'Services',NULL,10000,1000,11000)`,
    POL, ORG, PO,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_supplier_bills
      (id,organisation_id,supplier_id,source_purchase_order_id,bill_number,status,currency,bill_date,supplier_name_snapshot,posted_at)
     VALUES ($1::uuid,$2,$3::uuid,$4::uuid,'BILL-1','DRAFT','AUD','2026-09-15','Supplier',NULL)`,
    BILL, ORG, SUP, PO,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_supplier_bill_lines
      (id,organisation_id,supplier_bill_id,source_purchase_order_line_id,position,line_subtotal_cents,line_tax_cents,line_total_cents)
     VALUES ($1::uuid,$2,$3::uuid,$4::uuid,1,2500,250,2750)`,
    BILL_LINE, ORG, BILL, POL,
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
     VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,240000)`,
    BUDGET_LINE, ORG, VERSION, ACC, CC,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_period_allocations
      (organisation_id,budget_line_id,financial_period_id,amount_cents)
     VALUES ($1,$2::uuid,$3::uuid,20000)`, ORG, BUDGET_LINE, PERIOD,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_commitment_mappings
      (organisation_id,budget_version_id,cost_centre_id,budget_account_id,created_by)
     VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5)`, ORG, VERSION, CC, ACC, USER,
  );
});

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), writer.$disconnect()]);
});

function onlyRow(report: Awaited<ReturnType<typeof getBudgetActualCommittedReport>>) {
  expect(report.rows).toHaveLength(1);
  return report.rows[0];
}

describe('C7.8C — real PostgreSQL snapshot-safe combined consumption', () => {
  it('POST race returns a valid before-state snapshot, then a fresh report returns the after-state', async () => {
    afterFirstSnapshotStatement = async () => {
      await writer.$executeRawUnsafe(
        `UPDATE commercial_supplier_bills
         SET status='POSTED', posted_at='2026-09-15T12:00:00Z'
         WHERE id=$1::uuid AND organisation_id=$2`,
        BILL, ORG,
      );
    };

    const racing = onlyRow(await getBudgetActualCommittedReport(ORG));
    expect(racing).toMatchObject({
      actualCents: 0,
      committedCents: 11000,
      exposureCents: 11000,
      budgetLessActualAndCommittedCents: 9000,
    });

    const fresh = onlyRow(await getBudgetActualCommittedReport(ORG));
    expect(fresh).toMatchObject({
      actualCents: 2750,
      committedCents: 8250,
      exposureCents: 11000,
      budgetLessActualAndCommittedCents: 9000,
    });
  });
  it('CANCEL race returns a valid posted-state snapshot, then a fresh report returns the cancelled state', async () => {
    await writer.$executeRawUnsafe(
      `UPDATE commercial_supplier_bills
       SET status='POSTED', posted_at='2026-09-15T12:00:00Z'
       WHERE id=$1::uuid AND organisation_id=$2`,
      BILL, ORG,
    );
    afterFirstSnapshotStatement = async () => {
      await writer.$executeRawUnsafe(
        `UPDATE commercial_supplier_bills
         SET status='CANCELLED'
         WHERE id=$1::uuid AND organisation_id=$2`,
        BILL, ORG,
      );
    };

    const racing = onlyRow(await getBudgetActualCommittedReport(ORG));
    expect(racing).toMatchObject({
      actualCents: 2750,
      committedCents: 8250,
      exposureCents: 11000,
    });

    const fresh = onlyRow(await getBudgetActualCommittedReport(ORG));
    expect(fresh).toMatchObject({
      actualCents: 0,
      committedCents: 11000,
      exposureCents: 11000,
    });
  });

  it('never exposes another tenant through the combined snapshot', async () => {
    const report = await getBudgetActualCommittedReport(OTHER);
    expect(report).toMatchObject({
      rows: [],
      exceptions: [],
      resolvedActualCount: 0,
      resolvedCommitmentCount: 0,
      unresolvedExceptionCount: 0,
    });
  });
});
