import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
const { buildBudgetConsumptionCsvExports } = await import('@/lib/commercial/budgetConsumptionExport');
const { FinanceAdjustedTable } = await import('@/app/commercial/budgeting/commitments/page');

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
const ADJUSTMENT = '78888888-2000-0000-0000-000000000013';
const ADJUSTMENT_LINE = '78888888-2000-0000-0000-000000000014';
const CLOSE = '78888888-2000-0000-0000-000000000015';
const RECONCILIATION = '78888888-2000-0000-0000-000000000016';
const RECONCILIATION_ITEM = '78888888-2000-0000-0000-000000000017';
const ACC_2 = '78888888-2000-0000-0000-000000000018';
const VERSION_2 = '78888888-2000-0000-0000-000000000019';
const BUDGET_LINE_2 = '78888888-2000-0000-0000-000000000020';

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
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_finance_reconciliation_events WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_finance_reconciliation_items WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_finance_reconciliations WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`TRUNCATE commercial_financial_period_closes CASCADE`);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_finance_adjustment_events WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_finance_adjustment_lines WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_finance_adjustments WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
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
      financeRows: [],
      exceptions: [],
      resolvedActualCount: 0,
      resolvedCommitmentCount: 0,
      unresolvedExceptionCount: 0,
    });
  });

  it('reports Source Actual, Finance Adjustments, Effective Actual, Committed, Exposure, signed-off External GL Actual and reconciliation variance separately', async () => {
    await writer.$executeRawUnsafe(
      `UPDATE commercial_supplier_bills
       SET status='POSTED', posted_at='2026-09-15T12:00:00Z'
       WHERE id=$1::uuid AND organisation_id=$2`,
      BILL, ORG,
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_finance_adjustments(
         id,organisation_id,status,adjustment_type,effective_financial_period_id,
         currency,description,reason_code,created_by
       ) VALUES (
         $1::uuid,$2,'DRAFT','MANUAL_FINANCE_ADJUSTMENT',$3::uuid,
         'AUD','Finance reporting test','REPORTING',$4
       )`,
      ADJUSTMENT, ORG, PERIOD, USER,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_finance_adjustment_lines(
         id,organisation_id,adjustment_id,financial_period_id,position,
         budget_account_id,cost_centre_id,amount_exclusive_cents,tax_cents,
         amount_inclusive_cents,resolved_budget_id,resolved_budget_version_id,
         resolved_budget_line_id,resolved_tax_basis,budget_basis_cents
       ) VALUES (
         $1::uuid,$2,$3::uuid,$4::uuid,1,$5::uuid,$6::uuid,
         250,0,250,$7::uuid,$8::uuid,$9::uuid,'INCLUSIVE',250
       )`,
      ADJUSTMENT_LINE, ORG, ADJUSTMENT, PERIOD, ACC, CC, BUDGET, VERSION, BUDGET_LINE,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE commercial_finance_adjustments
       SET status='POSTED',posted_by=$1,posted_at=now()
       WHERE id=$2::uuid AND organisation_id=$3`,
      USER, ADJUSTMENT, ORG,
    );

    const beforeReconciliation = await getBudgetActualCommittedReport(ORG);
    expect(beforeReconciliation.financeRows).toHaveLength(1);
    expect(beforeReconciliation.financeRows[0]).toMatchObject({
      budgetCents: '20000',
      sourceActualCents: '2750',
      financeAdjustmentCents: '250',
      effectiveActualCents: '3000',
      committedCents: '8250',
      exposureCents: '11250',
      externalGlActualCents: null,
      reconciliationVarianceCents: null,
      reconciliationStatus: null,
      sourceSystemId: null,
    });

    await prisma.$executeRawUnsafe(
      `UPDATE commercial_financial_periods
       SET status='CLOSED'
       WHERE id=$1::uuid AND organisation_id=$2`,
      PERIOD, ORG,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_financial_period_closes(
         id,organisation_id,financial_period_id,close_sequence,status,closed_by,
         close_reason,control_totals,reconciliation_status
       ) VALUES (
         $1::uuid,$2,$3::uuid,1,'CLOSED',$4,
         'Finance reporting test','{}'::jsonb,'SIGNED_OFF'
       )`,
      CLOSE, ORG, PERIOD, USER,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_finance_reconciliations(
         id,organisation_id,financial_period_id,close_id,source_system_id,currency,
         status,source_actual_cents,finance_adjustment_cents,
         brainbase_effective_actual_cents,external_gl_total_cents,variance_cents,
         unresolved_item_count,snapshot_at,prepared_by,reviewed_by,reviewed_at
       ) VALUES (
         $1::uuid,$2,$3::uuid,$4::uuid,'xero','AUD',
         'SIGNED_OFF',2750,250,3000,3050,-50,
         1,now(),$5,$5,now()
       )`,
      RECONCILIATION, ORG, PERIOD, CLOSE, USER,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_finance_reconciliation_items(
         id,organisation_id,reconciliation_id,budget_account_id,currency,
         source_actual_cents,finance_adjustment_cents,brainbase_effective_actual_cents,
         external_gl_cents,variance_cents,source_actual_count,external_entry_count,outcome
       ) VALUES (
         $1::uuid,$2,$3::uuid,$4::uuid,'AUD',
         2750,250,3000,3050,-50,1,1,'VARIANCE'
       )`,
      RECONCILIATION_ITEM, ORG, RECONCILIATION, ACC,
    );

    const report = await getBudgetActualCommittedReport(ORG, 'xero');
    expect(report.financeRows).toHaveLength(1);
    expect(report.financeRows[0]).toMatchObject({
      sourceActualCents: '2750',
      financeAdjustmentCents: '250',
      effectiveActualCents: '3000',
      committedCents: '8250',
      exposureCents: '11250',
      externalGlActualCents: '3050',
      reconciliationVarianceCents: '-50',
      reconciliationId: RECONCILIATION,
      reconciliationStatus: 'SIGNED_OFF',
      sourceSystemId: 'xero',
    });

    const signedHtml = renderToStaticMarkup(createElement(FinanceAdjustedTable, {
      rows: report.financeRows,
    }));
    expect(signedHtml).toContain('Source Actual');
    expect(signedHtml).toContain('$30.50');
    expect(signedHtml).toContain('SIGNED_OFF');

    const wrongSource = await getBudgetActualCommittedReport(ORG, 'other-ledger');
    expect(wrongSource.financeRows[0]).toMatchObject({
      externalGlActualCents: null,
      reconciliationVarianceCents: null,
      reconciliationId: null,
      reconciliationStatus: null,
      sourceSystemId: 'other-ledger',
    });
    const nullGlHtml = renderToStaticMarkup(createElement(FinanceAdjustedTable, {
      rows: wrongSource.financeRows,
    }));
    expect((nullGlHtml.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(3);

    const nullGlExport = buildBudgetConsumptionCsvExports(wrongSource);
    expect(nullGlExport.legacyRowsCsv).toContain('OPEX');
    expect(nullGlExport.legacyRowsCsv).toContain(',2750,8250,11000,');
    expect(nullGlExport.financeRowsCsv).toContain(
      'OPEX,Operating,FY26,September,AUD,20000,2750,250,3000,8250,11250,,,,other-ledger',
    );

    await prisma.$executeRawUnsafe(
      `UPDATE commercial_finance_reconciliations
       SET status='STALE'
       WHERE id=$1::uuid AND organisation_id=$2`,
      RECONCILIATION, ORG,
    );
    const staleReport = await getBudgetActualCommittedReport(ORG, 'xero');
    expect(staleReport.financeRows[0].reconciliationStatus).toBe('STALE');

    const staleHtml = renderToStaticMarkup(createElement(FinanceAdjustedTable, {
      rows: staleReport.financeRows,
    }));
    expect(staleHtml).toContain('data-reconciliation-status="STALE"');
    expect(staleHtml).toContain('>STALE<');
    expect(staleHtml).toContain('$30.50');
    expect(staleHtml).toContain('-$0.50');

    const staleExport = buildBudgetConsumptionCsvExports(staleReport);
    expect(staleExport.legacyRowsCsv).toBe(nullGlExport.legacyRowsCsv);
    expect(staleExport.financeRowsCsv).toContain(',3050,');
    expect(staleExport.financeRowsCsv).toContain("'-50,STALE,xero");

    await writer.$executeRawUnsafe(
      `UPDATE commercial_supplier_bills
       SET status='CANCELLED'
       WHERE id=$1::uuid AND organisation_id=$2`,
      BILL, ORG,
    );

    const liveAfterCancellation = await getBudgetActualCommittedReport(ORG);
    expect(liveAfterCancellation.financeRows[0]).toMatchObject({
      sourceActualCents: '0',
      financeAdjustmentCents: '250',
      effectiveActualCents: '250',
      committedCents: '11000',
    });

    const snapshottedAfterCancellation = await getBudgetActualCommittedReport(ORG, 'xero');
    expect(snapshottedAfterCancellation.financeRows[0]).toMatchObject({
      sourceActualCents: '2750',
      financeAdjustmentCents: '250',
      effectiveActualCents: '3000',
      externalGlActualCents: '3050',
      reconciliationVarianceCents: '-50',
      reconciliationId: RECONCILIATION,
      reconciliationStatus: 'STALE',
      sourceSystemId: 'xero',
    });

    await writer.$executeRawUnsafe(
      `UPDATE commercial_supplier_bills
       SET status='POSTED', posted_at='2026-09-15T12:00:00Z'
       WHERE id=$1::uuid AND organisation_id=$2`,
      BILL, ORG,
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_budget_accounts(id,organisation_id,code,name,active,created_by)
       VALUES ($1::uuid,$2,'ALT','Alternative account',true,$3)`,
      ACC_2, ORG, USER,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE commercial_budget_versions
       SET status='SUPERSEDED', superseded_at=now()
       WHERE id=$1::uuid AND organisation_id=$2`,
      VERSION, ORG,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_budget_versions(
         id,organisation_id,budget_id,version_number,status,created_by,activated_by,activated_at
       ) VALUES ($1::uuid,$2,$3::uuid,2,'ACTIVE',$4,$4,now())`,
      VERSION_2, ORG, BUDGET, USER,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE commercial_budgets
       SET active_version_id=$1::uuid
       WHERE id=$2::uuid AND organisation_id=$3`,
      VERSION_2, BUDGET, ORG,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_budget_lines(
         id,organisation_id,budget_version_id,budget_account_id,cost_centre_id,annual_budget_cents
       ) VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,360000)`,
      BUDGET_LINE_2, ORG, VERSION_2, ACC_2, CC,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_budget_period_allocations(
         organisation_id,budget_line_id,financial_period_id,amount_cents
       ) VALUES ($1,$2::uuid,$3::uuid,30000)`,
      ORG, BUDGET_LINE_2, PERIOD,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_budget_commitment_mappings(
         organisation_id,budget_version_id,cost_centre_id,budget_account_id,created_by
       ) VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5)`,
      ORG, VERSION_2, CC, ACC_2, USER,
    );

    const liveAfterVersionSwitch = await getBudgetActualCommittedReport(ORG);
    expect(liveAfterVersionSwitch.financeRows.find(row => row.budgetAccountId === ACC)).toMatchObject({
      sourceActualCents: '0',
      financeAdjustmentCents: '250',
    });
    expect(liveAfterVersionSwitch.financeRows.find(row => row.budgetAccountId === ACC_2)).toMatchObject({
      sourceActualCents: '2750',
      committedCents: '8250',
      budgetCents: '30000',
    });

    const snapshottedAfterVersionSwitch = await getBudgetActualCommittedReport(ORG, 'xero');
    expect(snapshottedAfterVersionSwitch.financeRows.find(row => row.budgetAccountId === ACC)).toMatchObject({
      sourceActualCents: '2750',
      financeAdjustmentCents: '250',
      effectiveActualCents: '3000',
      externalGlActualCents: '3050',
      reconciliationVarianceCents: '-50',
      reconciliationId: RECONCILIATION,
      reconciliationStatus: 'STALE',
      sourceSystemId: 'xero',
    });
    expect(snapshottedAfterVersionSwitch.financeRows.find(row => row.budgetAccountId === ACC_2)).toMatchObject({
      sourceActualCents: '0',
      financeAdjustmentCents: '0',
      committedCents: '8250',
      budgetCents: '30000',
      externalGlActualCents: null,
      reconciliationId: null,
    });
    expect(
      snapshottedAfterVersionSwitch.financeRows.reduce(
        (sum, row) => sum + BigInt(row.sourceActualCents),
        BigInt(0),
      ),
    ).toBe(BigInt(2750));
    expect(
      snapshottedAfterVersionSwitch.financeRows.reduce(
        (sum, row) => sum + BigInt(row.financeAdjustmentCents),
        BigInt(0),
      ),
    ).toBe(BigInt(250));
  });

});
