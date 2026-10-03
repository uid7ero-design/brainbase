import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('financeCloseConcurrency.integration.test.ts requires DATABASE_URL.');
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
  async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = compile({ strings, values });
    return prisma.$queryRawUnsafe(q.text, ...q.values);
  },
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
    }, { isolationLevel: options?.isolationLevel as 'ReadCommitted' | undefined }),
  },
);

vi.doMock('@/lib/db', () => ({ default: sqlMock }));
const auditMock = vi.fn();
vi.doMock('@/lib/commercial/auditLog', () => ({
  logFinancialPeriodStatusChanged: (...args: unknown[]) => auditMock(...args),
  logFinancialYearStatusChanged: (...args: unknown[]) => auditMock(...args),
}));

const { closeFinancialPeriod, reopenFinancialPeriod, FinanceCloseError } =
  await import('@/lib/commercial/financeClose');
const { setFinancialYearStatus } =
  await import('@/lib/commercial/financialPeriods');

const ORG = 'org-c79a';
const OTHER = 'org-c79a-other';
const USER = 'user-c79a';
const FY = '79999999-0000-0000-0000-000000000001';
const PERIOD = '79999999-0000-0000-0000-000000000002';
const OTHER_FY = '79999999-0000-0000-0000-000000000003';
const OTHER_PERIOD = '79999999-0000-0000-0000-000000000004';
const SUP = '79999999-0000-0000-0000-000000000005';
const BILL = '79999999-0000-0000-0000-000000000006';
const BILL_LINE = '79999999-0000-0000-0000-000000000007';
const BUDGET = '79999999-0000-0000-0000-000000000008';
const ADJUSTMENT = '79999999-0000-0000-0000-000000000010';

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `INSERT INTO organisations(id,name) VALUES ($1,'C7.9A'),($2,'C7.9A Other') ON CONFLICT (id) DO NOTHING`,
    ORG, OTHER,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO users(id,organisation_id) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
    USER, ORG,
  );
});

beforeEach(async () => {
  auditMock.mockReset();
  await prisma.$executeRawUnsafe(`TRUNCATE commercial_financial_period_closes CASCADE`);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_finance_adjustment_lines WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_finance_adjustments WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_period_allocations WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_commitment_mappings WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_lines WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`UPDATE commercial_budgets SET active_version_id=NULL WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_versions WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budgets WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_supplier_bill_lines WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_supplier_bills WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_financial_periods WHERE organisation_id IN ($1,$2)`, ORG, OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_financial_years WHERE organisation_id IN ($1,$2)`, ORG, OTHER);

  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_years(id,organisation_id,name,starts_on,ends_on,status)
     VALUES ($1::uuid,$2,'FY26','2026-07-01','2027-06-30','OPEN'),
            ($3::uuid,$4,'Other FY','2026-07-01','2027-06-30','OPEN')`,
    FY, ORG, OTHER_FY, OTHER,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_periods(id,financial_year_id,organisation_id,name,starts_on,ends_on,status)
     VALUES ($1::uuid,$2::uuid,$3,'September','2026-09-01','2026-09-30','OPEN'),
            ($4::uuid,$5::uuid,$6,'Other September','2026-09-01','2026-09-30','OPEN')`,
    PERIOD, FY, ORG, OTHER_PERIOD, OTHER_FY, OTHER,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_supplier_bills
      (id,organisation_id,supplier_id,source_purchase_order_id,bill_number,status,currency,bill_date,supplier_name_snapshot,posted_at)
     VALUES ($1::uuid,$2,$3::uuid,gen_random_uuid(),'BILL-1','POSTED','AUD','2026-09-10','Supplier','2026-09-15T12:00:00Z')`,
    BILL, ORG, SUP,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_supplier_bill_lines
      (id,organisation_id,supplier_bill_id,source_purchase_order_line_id,position,line_subtotal_cents,line_tax_cents,line_total_cents)
     VALUES ($1::uuid,$2,$3::uuid,gen_random_uuid(),1,2500,250,2750)`,
    BILL_LINE, ORG, BILL,
  );
});

afterAll(async () => prisma.$disconnect());

describe('C7.9A — real PostgreSQL close/reopen controls', () => {
  it('closes atomically and captures durable source-Actual controls', async () => {
    const close = await closeFinancialPeriod({
      organisationId: ORG, userId: USER, financialPeriodId: PERIOD, reason: 'Month end',
    });
    expect(close).toMatchObject({ close_sequence: 1, status: 'CLOSED', close_reason: 'Month end' });
    expect(close.control_totals).toMatchObject({
      basis: 'C7_8_SOURCE_ACTUAL',
      sourceActualByCurrency: [{
        currency: 'AUD', lineCount: 1, subtotalCents: '2500', taxCents: '250', totalCents: '2750',
      }],
    });

    const period = await prisma.$queryRawUnsafe<{ status: string }[]>(
      `SELECT status FROM commercial_financial_periods WHERE id=$1::uuid`, PERIOD,
    );
    expect(period[0].status).toBe('CLOSED');
  });

  it('rejects hard delete of durable close history at the database layer', async () => {
    const close = await closeFinancialPeriod({
      organisationId: ORG,
      userId: USER,
      financialPeriodId: PERIOD,
      reason: 'Month end',
    });

    await expect(prisma.$executeRawUnsafe(
      `DELETE FROM commercial_financial_period_closes WHERE id=$1::uuid`,
      close.id,
    )).rejects.toThrow('finance close history is immutable');

    const rows = await prisma.$queryRawUnsafe<{ id: string; status: string }[]>(
      `SELECT id,status
       FROM commercial_financial_period_closes
       WHERE id=$1::uuid AND organisation_id=$2`,
      close.id,
      ORG,
    );
    expect(rows).toEqual([{ id: close.id, status: 'CLOSED' }]);
  });

  it('keeps a close and its control evidence durable when generic audit logging fails afterwards', async () => {
    auditMock.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(closeFinancialPeriod({
      organisationId: ORG,
      userId: USER,
      financialPeriodId: PERIOD,
      reason: 'Month end',
    })).rejects.toThrow('audit unavailable');

    const period = await prisma.$queryRawUnsafe<{ status: string }[]>(
      `SELECT status FROM commercial_financial_periods WHERE id=$1::uuid`,
      PERIOD,
    );
    const closes = await prisma.$queryRawUnsafe<{
      status: string;
      close_sequence: number;
      control_totals: {
        basis: string;
        sourceActualByCurrency: Array<{ totalCents: string }>;
      };
    }[]>(
      `SELECT status,close_sequence,control_totals
       FROM commercial_financial_period_closes
       WHERE financial_period_id=$1::uuid`,
      PERIOD,
    );

    expect(period[0].status).toBe('CLOSED');
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({
      status: 'CLOSED',
      close_sequence: 1,
      control_totals: {
        basis: 'C7_8_SOURCE_ACTUAL',
        sourceActualByCurrency: [{ totalCents: '2750' }],
      },
    });
  });

  it('keeps reopen invalidation durable when generic audit logging fails afterwards', async () => {
    await closeFinancialPeriod({
      organisationId: ORG,
      userId: USER,
      financialPeriodId: PERIOD,
      reason: 'Month end',
    });
    auditMock.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(reopenFinancialPeriod({
      organisationId: ORG,
      userId: USER,
      financialPeriodId: PERIOD,
      reason: 'Correction required',
    })).rejects.toThrow('audit unavailable');

    const period = await prisma.$queryRawUnsafe<{ status: string }[]>(
      `SELECT status FROM commercial_financial_periods WHERE id=$1::uuid`,
      PERIOD,
    );
    const closes = await prisma.$queryRawUnsafe<{
      status: string;
      invalidation_reason: string | null;
    }[]>(
      `SELECT status,invalidation_reason
       FROM commercial_financial_period_closes
       WHERE financial_period_id=$1::uuid`,
      PERIOD,
    );

    expect(period[0].status).toBe('OPEN');
    expect(closes).toEqual([{
      status: 'INVALIDATED',
      invalidation_reason: 'Correction required',
    }]);
  });

  it('refuses to close a financial year while any child period remains OPEN', async () => {
    await expect(setFinancialYearStatus({
      organisationId: ORG,
      userId: USER,
      financialYearId: FY,
      status: 'CLOSED',
    })).rejects.toMatchObject({
      code: 'OPEN_PERIODS_EXIST',
    });

    const year = await prisma.$queryRawUnsafe<{ status: string }[]>(
      `SELECT status
       FROM commercial_financial_years
       WHERE id=$1::uuid AND organisation_id=$2`,
      FY,
      ORG,
    );
    expect(year[0].status).toBe('OPEN');
  });

  it('refuses year close when a CLOSED child has no current durable close record', async () => {
    await prisma.$executeRawUnsafe(
      `UPDATE commercial_financial_periods
       SET status='CLOSED'
       WHERE id=$1::uuid AND organisation_id=$2`,
      PERIOD,
      ORG,
    );

    await expect(setFinancialYearStatus({
      organisationId: ORG,
      userId: USER,
      financialYearId: FY,
      status: 'CLOSED',
    })).rejects.toMatchObject({
      code: 'MISSING_CURRENT_CLOSE',
    });
  });

  it('refuses year close while a draft finance adjustment targets a child period', async () => {
    await closeFinancialPeriod({
      organisationId: ORG,
      userId: USER,
      financialPeriodId: PERIOD,
      reason: 'Year-end prerequisite',
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_finance_adjustments(
         id,organisation_id,status,adjustment_type,effective_financial_period_id,
         currency,description,reason_code,created_by
       ) VALUES (
         $1::uuid,$2,'DRAFT','MANUAL_FINANCE_ADJUSTMENT',$3::uuid,
         'AUD','Pending year-end adjustment','YEAR_END',$4
       )`,
      ADJUSTMENT,
      ORG,
      PERIOD,
      USER,
    );

    await expect(setFinancialYearStatus({
      organisationId: ORG,
      userId: USER,
      financialYearId: FY,
      status: 'CLOSED',
    })).rejects.toMatchObject({
      code: 'DRAFT_ADJUSTMENTS_EXIST',
    });
  });

  it('refuses year close while a current child close carries stale reconciliation evidence', async () => {
    const close = await closeFinancialPeriod({
      organisationId: ORG,
      userId: USER,
      financialPeriodId: PERIOD,
      reason: 'Year-end prerequisite',
    });
    await prisma.$executeRawUnsafe(
      `UPDATE commercial_financial_period_closes
       SET reconciliation_status='STALE'
       WHERE id=$1::uuid AND organisation_id=$2`,
      close.id,
      ORG,
    );

    await expect(setFinancialYearStatus({
      organisationId: ORG,
      userId: USER,
      financialYearId: FY,
      status: 'CLOSED',
    })).rejects.toMatchObject({
      code: 'STALE_RECONCILIATION_EXISTS',
    });
  });

  it('refuses year close while a Budget for the year has no stable ACTIVE version', async () => {
    await closeFinancialPeriod({
      organisationId: ORG,
      userId: USER,
      financialPeriodId: PERIOD,
      reason: 'Year-end prerequisite',
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_budgets(
         id,organisation_id,financial_year_id,name,currency,tax_basis,periodisation_mode,created_by
       ) VALUES (
         $1::uuid,$2,$3::uuid,'FY26 Budget','AUD','INCLUSIVE','PERIODISED',$4
       )`,
      BUDGET,
      ORG,
      FY,
      USER,
    );

    await expect(setFinancialYearStatus({
      organisationId: ORG,
      userId: USER,
      financialYearId: FY,
      status: 'CLOSED',
    })).rejects.toMatchObject({
      code: 'UNSTABLE_BUDGET_VERSION',
    });
  });

  it('keeps a closed period sealed while its parent financial year is CLOSED', async () => {
    const close = await closeFinancialPeriod({
      organisationId: ORG,
      userId: USER,
      financialPeriodId: PERIOD,
      reason: 'Year-end prerequisite',
    });

    const year = await setFinancialYearStatus({
      organisationId: ORG,
      userId: USER,
      financialYearId: FY,
      status: 'CLOSED',
    });
    expect(year?.status).toBe('CLOSED');

    await expect(reopenFinancialPeriod({
      organisationId: ORG,
      userId: USER,
      financialPeriodId: PERIOD,
      reason: 'Should be blocked by closed year',
    })).rejects.toMatchObject({
      code: 'FINANCIAL_YEAR_CLOSED',
    });

    const period = await prisma.$queryRawUnsafe<{ status: string }[]>(
      `SELECT status
       FROM commercial_financial_periods
       WHERE id=$1::uuid AND organisation_id=$2`,
      PERIOD,
      ORG,
    );
    const closeRows = await prisma.$queryRawUnsafe<{ status: string }[]>(
      `SELECT status
       FROM commercial_financial_period_closes
       WHERE id=$1::uuid AND organisation_id=$2`,
      close.id,
      ORG,
    );

    expect(period[0].status).toBe('CLOSED');
    expect(closeRows[0].status).toBe('CLOSED');
  });

  it('requires a non-empty reopen reason before touching the database', async () => {
    await closeFinancialPeriod({ organisationId: ORG, userId: USER, financialPeriodId: PERIOD });
    await expect(reopenFinancialPeriod({
      organisationId: ORG, userId: USER, financialPeriodId: PERIOD, reason: '   ',
    })).rejects.toMatchObject({ code: 'REOPEN_REASON_REQUIRED' });
  });

  it('reopen invalidates history; reclose appends sequence 2 instead of deleting sequence 1', async () => {
    await closeFinancialPeriod({ organisationId: ORG, userId: USER, financialPeriodId: PERIOD });
    const invalidated = await reopenFinancialPeriod({
      organisationId: ORG, userId: USER, financialPeriodId: PERIOD, reason: 'Correction required',
    });
    expect(invalidated).toMatchObject({
      close_sequence: 1, status: 'INVALIDATED', invalidation_reason: 'Correction required',
    });

    const second = await closeFinancialPeriod({
      organisationId: ORG, userId: USER, financialPeriodId: PERIOD, reason: 'Reclosed',
    });
    expect(second).toMatchObject({ close_sequence: 2, status: 'CLOSED' });

    const history = await prisma.$queryRawUnsafe<{ close_sequence: number; status: string }[]>(
      `SELECT close_sequence,status FROM commercial_financial_period_closes
       WHERE financial_period_id=$1::uuid ORDER BY close_sequence`, PERIOD,
    );
    expect(history).toEqual([
      { close_sequence: 1, status: 'INVALIDATED' },
      { close_sequence: 2, status: 'CLOSED' },
    ]);
  });

  it('serializes concurrent close attempts so exactly one durable current close exists', async () => {
    const params = { organisationId: ORG, userId: USER, financialPeriodId: PERIOD };
    const results = await Promise.allSettled([
      closeFinancialPeriod(params),
      closeFinancialPeriod(params),
    ]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(x => x.status === 'rejected')).toHaveLength(1);
    const rejected = results.find(x => x.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(FinanceCloseError);
    expect(rejected.reason.code).toBe('PERIOD_NOT_OPEN');

    const count = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) n FROM commercial_financial_period_closes
       WHERE financial_period_id=$1::uuid AND status='CLOSED'`, PERIOD,
    );
    expect(Number(count[0].n)).toBe(1);
  });

  it('serializes concurrent reopen attempts so history is invalidated once', async () => {
    await closeFinancialPeriod({ organisationId: ORG, userId: USER, financialPeriodId: PERIOD });
    const params = { organisationId: ORG, userId: USER, financialPeriodId: PERIOD, reason: 'Correction' };
    const results = await Promise.allSettled([
      reopenFinancialPeriod(params),
      reopenFinancialPeriod(params),
    ]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(x => x.status === 'rejected')).toHaveLength(1);
    const rejected = results.find(x => x.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('PERIOD_NOT_CLOSED');
  });

  it('fails closed on overlapping periods without creating close history', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_financial_periods(financial_year_id,organisation_id,name,starts_on,ends_on,status)
       VALUES ($1::uuid,$2,'Overlap','2026-09-15','2026-10-15','OPEN')`, FY, ORG,
    );
    await expect(closeFinancialPeriod({
      organisationId: ORG, userId: USER, financialPeriodId: PERIOD,
    })).rejects.toMatchObject({ code: 'PERIOD_OVERLAP' });

    const count = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) n FROM commercial_financial_period_closes WHERE financial_period_id=$1::uuid`, PERIOD,
    );
    expect(Number(count[0].n)).toBe(0);
  });

  it('does not close another tenant period', async () => {
    await expect(closeFinancialPeriod({
      organisationId: ORG, userId: USER, financialPeriodId: OTHER_PERIOD,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
