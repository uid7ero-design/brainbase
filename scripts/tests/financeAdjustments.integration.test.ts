import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('financeAdjustments.integration.test.ts requires DATABASE_URL.');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error('Refusing hosted database.');
}
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) throw new Error('Refusing non-localhost database.');

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type QueryDescriptor = { strings: readonly string[]; values: unknown[] };

function compile(q: QueryDescriptor) {
  let text = q.strings[0];
  for (let i = 0; i < q.values.length; i++) {
    const value = q.values[i];
    const cast = typeof value === 'string' && UUID_RE.test(value) ? '::uuid' : '';
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
vi.doMock('@/lib/commercial/auditLog', () => ({ logFinancialPeriodStatusChanged: vi.fn() }));

const {
  createFinanceAdjustment,
  postFinanceAdjustment,
  reverseFinanceAdjustment,
  FinanceAdjustmentError,
} = await import('@/lib/commercial/financeAdjustments');
const { closeFinancialPeriod } = await import('@/lib/commercial/financeClose');
const ORG = 'org-c79b';
const OTHER = 'org-c79b-other';
const USER = 'user-c79b';
const FY = '79999998-0000-0000-0000-000000000001';
const P1 = '79999998-0000-0000-0000-000000000011';
const P2 = '79999998-0000-0000-0000-000000000012';
const P3 = '79999998-0000-0000-0000-000000000013';
const CC = '79999998-0000-0000-0000-000000000021';
const ACCOUNT = '79999998-0000-0000-0000-000000000031';
const BUDGET_AUD = '79999998-0000-0000-0000-000000000041';
const VERSION_AUD = '79999998-0000-0000-0000-000000000051';
const LINE_AUD = '79999998-0000-0000-0000-000000000061';
const BUDGET_NZD = '79999998-0000-0000-0000-000000000042';
const VERSION_NZD = '79999998-0000-0000-0000-000000000052';
const LINE_NZD = '79999998-0000-0000-0000-000000000062';

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `INSERT INTO organisations(id,name) VALUES ($1,'C7.9B'),($2,'C7.9B Other')
     ON CONFLICT (id) DO NOTHING`,
    ORG, OTHER,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO users(id,organisation_id) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
    USER, ORG,
  );
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE commercial_finance_adjustment_events,
              commercial_finance_adjustment_lines,
              commercial_finance_adjustments
       RESTART IDENTITY CASCADE`,
  );
  await prisma.$executeRawUnsafe(
    `TRUNCATE commercial_financial_period_closes CASCADE`,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE commercial_budgets SET active_version_id=NULL WHERE organisation_id=$1`, ORG,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM commercial_budget_lines WHERE organisation_id=$1`, ORG,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM commercial_budget_versions WHERE organisation_id=$1`, ORG,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM commercial_budgets WHERE organisation_id=$1`, ORG,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM commercial_budget_accounts WHERE organisation_id=$1`, ORG,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM commercial_cost_centres WHERE organisation_id=$1`, ORG,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM commercial_financial_periods WHERE organisation_id=$1`, ORG,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM commercial_financial_years WHERE organisation_id=$1`, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_years(id,organisation_id,name,starts_on,ends_on,status)
     VALUES ($1::uuid,$2,'FY26','2026-07-01','2027-06-30','OPEN')`,
    FY, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_periods(id,financial_year_id,organisation_id,name,starts_on,ends_on,status)
     VALUES
      ($1::uuid,$4::uuid,$5,'Jul','2026-07-01','2026-07-31','OPEN'),
      ($2::uuid,$4::uuid,$5,'Aug','2026-08-01','2026-08-31','OPEN'),
      ($3::uuid,$4::uuid,$5,'Sep','2026-09-01','2026-09-30','OPEN')`,
    P1, P2, P3, FY, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_cost_centres(id,organisation_id,code,name,active)
     VALUES ($1::uuid,$2,'OPS','Operations',true)`,
    CC, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_accounts(id,organisation_id,code,name,active,created_by)
     VALUES ($1::uuid,$2,'OPS','Operations',true,$3)`,
    ACCOUNT, ORG, USER,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budgets
      (id,organisation_id,financial_year_id,name,currency,tax_basis,periodisation_mode,created_by)
     VALUES
      ($1::uuid,$3,$4::uuid,'AUD Budget','AUD','INCLUSIVE','ANNUAL_ONLY',$5),
      ($2::uuid,$3,$4::uuid,'NZD Budget','NZD','EXCLUSIVE','ANNUAL_ONLY',$5)`,
    BUDGET_AUD, BUDGET_NZD, ORG, FY, USER,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_versions
      (id,organisation_id,budget_id,version_number,status,created_by,activated_by,activated_at)
     VALUES
      ($1::uuid,$3,$4::uuid,1,'ACTIVE',$5,$5,now()),
      ($2::uuid,$3,$6::uuid,1,'ACTIVE',$5,$5,now())`,
    VERSION_AUD, VERSION_NZD, ORG, BUDGET_AUD, USER, BUDGET_NZD,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_lines
      (id,organisation_id,budget_version_id,budget_account_id,cost_centre_id,annual_budget_cents)
     VALUES
      ($1::uuid,$3,$4::uuid,$5::uuid,$6::uuid,100000000000),
      ($2::uuid,$3,$7::uuid,$5::uuid,$6::uuid,100000000000)`,
    LINE_AUD, LINE_NZD, ORG, VERSION_AUD, ACCOUNT, CC, VERSION_NZD,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE commercial_budgets
     SET active_version_id=CASE WHEN id=$1::uuid THEN $2::uuid ELSE $3::uuid END
     WHERE organisation_id=$4`,
    BUDGET_AUD, VERSION_AUD, VERSION_NZD, ORG,
  );
});

afterAll(async () => prisma.$disconnect());

function manualInput(periodId = P1, currency = 'AUD') {
  return {
    organisationId: ORG,
    userId: USER,
    adjustmentType: 'MANUAL_FINANCE_ADJUSTMENT' as const,
    effectiveFinancialPeriodId: periodId,
    currency,
    description: 'Finance true-up',
    reasonCode: 'MANUAL',
    lines: [{
      budgetAccountId: ACCOUNT,
      costCentreId: CC,
      amountExclusiveCents: '9000000000',
      taxCents: '900000000',
      amountInclusiveCents: '9900000000',
    }],
  };
}
describe('C7.9B — real PostgreSQL finance adjustment journal', () => {
  it('creates a DRAFT with signed BIGINT amounts and a durable CREATED event', async () => {
    const draft = await createFinanceAdjustment(manualInput());
    expect(draft.status).toBe('DRAFT');

    const rows = await prisma.$queryRawUnsafe<{ amount_inclusive_cents: bigint }[]>(
      `SELECT amount_inclusive_cents FROM commercial_finance_adjustment_lines
       WHERE adjustment_id=$1::uuid`, draft.id,
    );
    expect(rows[0].amount_inclusive_cents.toString()).toBe('9900000000');

    const events = await prisma.$queryRawUnsafe<{ event_type: string }[]>(
      `SELECT event_type FROM commercial_finance_adjustment_events WHERE adjustment_id=$1::uuid`,
      draft.id,
    );
    expect(events).toEqual([{ event_type: 'CREATED' }]);
  });

  it('rolls back POST status and frozen classification when the transactional POSTED event write fails', async () => {
    const draft = await createFinanceAdjustment(manualInput());

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_reject_finance_adjustment_posted_event()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'POSTED' THEN
          RAISE EXCEPTION 'test posted event failure';
        END IF;
        RETURN NEW;
      END $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_test_reject_finance_adjustment_posted_event
      BEFORE INSERT ON commercial_finance_adjustment_events
      FOR EACH ROW EXECUTE FUNCTION test_reject_finance_adjustment_posted_event()
    `);

    try {
      await expect(postFinanceAdjustment({
        organisationId: ORG,
        userId: USER,
        financeAdjustmentId: draft.id,
      })).rejects.toThrow(/test posted event failure/);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS trg_test_reject_finance_adjustment_posted_event
         ON commercial_finance_adjustment_events`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS test_reject_finance_adjustment_posted_event()`,
      );
    }

    const header = await prisma.$queryRawUnsafe<{
      status: string;
      posted_by: string | null;
      posted_at: Date | null;
    }[]>(
      `SELECT status,posted_by,posted_at
       FROM commercial_finance_adjustments
       WHERE id=$1::uuid`,
      draft.id,
    );
    expect(header[0]).toEqual({
      status: 'DRAFT',
      posted_by: null,
      posted_at: null,
    });

    const lines = await prisma.$queryRawUnsafe<{
      resolved_budget_id: string | null;
      resolved_budget_version_id: string | null;
      resolved_budget_line_id: string | null;
      resolved_tax_basis: string | null;
      budget_basis_cents: bigint | null;
    }[]>(
      `SELECT resolved_budget_id,resolved_budget_version_id,resolved_budget_line_id,
              resolved_tax_basis,budget_basis_cents
       FROM commercial_finance_adjustment_lines
       WHERE adjustment_id=$1::uuid`,
      draft.id,
    );
    expect(lines[0]).toEqual({
      resolved_budget_id: null,
      resolved_budget_version_id: null,
      resolved_budget_line_id: null,
      resolved_tax_basis: null,
      budget_basis_cents: null,
    });

    const events = await prisma.$queryRawUnsafe<{ event_type: string }[]>(
      `SELECT event_type
       FROM commercial_finance_adjustment_events
       WHERE adjustment_id=$1::uuid
       ORDER BY event_at,id`,
      draft.id,
    );
    expect(events).toEqual([{ event_type: 'CREATED' }]);
  });

  it('POST freezes ACTIVE Budget classification and applies INCLUSIVE tax basis', async () => {
    const draft = await createFinanceAdjustment(manualInput());
    const posted = await postFinanceAdjustment({
      organisationId: ORG, userId: USER, financeAdjustmentId: draft.id,
    });
    expect(posted.status).toBe('POSTED');

    const lines = await prisma.$queryRawUnsafe<{
      resolved_budget_id: string;
      resolved_budget_version_id: string;
      resolved_budget_line_id: string;
      resolved_tax_basis: string;
      budget_basis_cents: bigint;
    }[]>(`SELECT resolved_budget_id,resolved_budget_version_id,resolved_budget_line_id,
                  resolved_tax_basis,budget_basis_cents
           FROM commercial_finance_adjustment_lines WHERE adjustment_id=$1::uuid`, draft.id);
    expect(lines[0]).toMatchObject({
      resolved_budget_id: BUDGET_AUD,
      resolved_budget_version_id: VERSION_AUD,
      resolved_budget_line_id: LINE_AUD,
      resolved_tax_basis: 'INCLUSIVE',
    });
    expect(lines[0].budget_basis_cents.toString()).toBe('9900000000');
  });
  it('uses EXCLUSIVE Budget tax basis without changing source amounts', async () => {
    const draft = await createFinanceAdjustment(manualInput(P1, 'NZD'));
    await postFinanceAdjustment({ organisationId: ORG, userId: USER, financeAdjustmentId: draft.id });

    const line = await prisma.$queryRawUnsafe<{
      amount_exclusive_cents: bigint;
      amount_inclusive_cents: bigint;
      budget_basis_cents: bigint;
      resolved_tax_basis: string;
    }[]>(`SELECT amount_exclusive_cents,amount_inclusive_cents,budget_basis_cents,resolved_tax_basis
           FROM commercial_finance_adjustment_lines WHERE adjustment_id=$1::uuid`, draft.id);
    expect(line[0].resolved_tax_basis).toBe('EXCLUSIVE');
    expect(line[0].amount_exclusive_cents.toString()).toBe('9000000000');
    expect(line[0].amount_inclusive_cents.toString()).toBe('9900000000');
    expect(line[0].budget_basis_cents.toString()).toBe('9000000000');
  });

  it('rejects an unbalanced reclassification but posts an exact signed zero-sum journal', async () => {
    const unbalanced = await createFinanceAdjustment({
      ...manualInput(),
      adjustmentType: 'PRIOR_PERIOD_RECLASSIFICATION',
    });
    await expect(postFinanceAdjustment({
      organisationId: ORG, userId: USER, financeAdjustmentId: unbalanced.id,
    })).rejects.toMatchObject({ code: 'UNBALANCED_RECLASSIFICATION' });

    const balanced = await createFinanceAdjustment({
      ...manualInput(),
      adjustmentType: 'BUDGET_CLASSIFICATION_CORRECTION',
      lines: [
        {
          budgetAccountId: ACCOUNT, costCentreId: CC,
          amountExclusiveCents: '1000', taxCents: '100', amountInclusiveCents: '1100',
        },
        {
          budgetAccountId: ACCOUNT, costCentreId: CC,
          amountExclusiveCents: '-1000', taxCents: '-100', amountInclusiveCents: '-1100',
        },
      ],
    });
    const posted = await postFinanceAdjustment({
      organisationId: ORG, userId: USER, financeAdjustmentId: balanced.id,
    });
    expect(posted.status).toBe('POSTED');
  });
  it('database triggers prevent mutation/deletion of posted monetary content', async () => {
    const draft = await createFinanceAdjustment(manualInput());
    await postFinanceAdjustment({ organisationId: ORG, userId: USER, financeAdjustmentId: draft.id });

    await expect(prisma.$executeRawUnsafe(
      `UPDATE commercial_finance_adjustment_lines SET amount_inclusive_cents=1
       WHERE adjustment_id=$1::uuid`, draft.id,
    )).rejects.toThrow();

    await expect(prisma.$executeRawUnsafe(
      `UPDATE commercial_finance_adjustments SET description='rewritten'
       WHERE id=$1::uuid`, draft.id,
    )).rejects.toThrow();

    await expect(prisma.$executeRawUnsafe(
      `DELETE FROM commercial_finance_adjustments WHERE id=$1::uuid`, draft.id,
    )).rejects.toThrow();
  });

  it('period close is blocked while a DRAFT adjustment exists', async () => {
    await createFinanceAdjustment(manualInput(P2));
    await expect(closeFinancialPeriod({
      organisationId: ORG, userId: USER, financialPeriodId: P2,
    })).rejects.toMatchObject({ code: 'DRAFT_ADJUSTMENTS_EXIST' });
  });

  it('posting is rejected if the target period closes after DRAFT creation', async () => {
    const draft = await createFinanceAdjustment(manualInput(P2));
    await prisma.$executeRawUnsafe(
      `DELETE FROM commercial_finance_adjustment_lines WHERE adjustment_id=$1::uuid`, draft.id,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM commercial_finance_adjustment_events WHERE adjustment_id=$1::uuid`, draft.id,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM commercial_finance_adjustments WHERE id=$1::uuid`, draft.id,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE commercial_financial_periods SET status='CLOSED' WHERE id=$1::uuid`, P2,
    );

    await expect(createFinanceAdjustment(manualInput(P2))).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
  });
  it('reverses by creating an opposite POSTED adjustment and marking the original REVERSED', async () => {
    const draft = await createFinanceAdjustment({
      ...manualInput(P1),
      lines: [{
        budgetAccountId: ACCOUNT, costCentreId: CC,
        amountExclusiveCents: '1000', taxCents: '100', amountInclusiveCents: '1100',
      }],
    });
    await postFinanceAdjustment({ organisationId: ORG, userId: USER, financeAdjustmentId: draft.id });

    const reversal = await reverseFinanceAdjustment({
      organisationId: ORG,
      userId: USER,
      financeAdjustmentId: draft.id,
      reversalFinancialPeriodId: P2,
      reason: 'Move correction to August',
    });
    expect(reversal.status).toBe('POSTED');
    expect(reversal.reversal_of_adjustment_id).toBe(draft.id);

    const headers = await prisma.$queryRawUnsafe<{ id: string; status: string }[]>(
      `SELECT id,status FROM commercial_finance_adjustments
       WHERE id IN ($1::uuid,$2::uuid) ORDER BY id`, draft.id, reversal.id,
    );
    expect(headers.find(x => x.id === draft.id)?.status).toBe('REVERSED');
    expect(headers.find(x => x.id === reversal.id)?.status).toBe('POSTED');

    const reversalLine = await prisma.$queryRawUnsafe<{
      amount_exclusive_cents: bigint;
      tax_cents: bigint;
      amount_inclusive_cents: bigint;
      budget_basis_cents: bigint;
    }[]>(`SELECT amount_exclusive_cents,tax_cents,amount_inclusive_cents,budget_basis_cents
           FROM commercial_finance_adjustment_lines WHERE adjustment_id=$1::uuid`, reversal.id);
    expect(reversalLine[0].amount_exclusive_cents.toString()).toBe('-1000');
    expect(reversalLine[0].tax_cents.toString()).toBe('-100');
    expect(reversalLine[0].amount_inclusive_cents.toString()).toBe('-1100');
    expect(reversalLine[0].budget_basis_cents.toString()).toBe('-1100');

    await expect(reverseFinanceAdjustment({
      organisationId: ORG,
      userId: USER,
      financeAdjustmentId: reversal.id,
      reversalFinancialPeriodId: P3,
      reason: 'No',
    })).rejects.toMatchObject({ code: 'REVERSAL_OF_REVERSAL' });
  });
  it('rejects reversal into a CLOSED period', async () => {
    const draft = await createFinanceAdjustment(manualInput(P1));
    await postFinanceAdjustment({ organisationId: ORG, userId: USER, financeAdjustmentId: draft.id });
    await prisma.$executeRawUnsafe(
      `UPDATE commercial_financial_periods SET status='CLOSED' WHERE id=$1::uuid`, P2,
    );

    await expect(reverseFinanceAdjustment({
      organisationId: ORG,
      userId: USER,
      financeAdjustmentId: draft.id,
      reversalFinancialPeriodId: P2,
      reason: 'Correction',
    })).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
  });

  it('serializes two concurrent POST attempts so only one succeeds', async () => {
    const draft = await createFinanceAdjustment(manualInput());
    const params = { organisationId: ORG, userId: USER, financeAdjustmentId: draft.id };
    const results = await Promise.allSettled([
      postFinanceAdjustment(params),
      postFinanceAdjustment(params),
    ]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(x => x.status === 'rejected')).toHaveLength(1);
    const rejected = results.find(x => x.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(FinanceAdjustmentError);
    expect(rejected.reason.code).toBe('NOT_DRAFT');
  });

  it('serializes two concurrent reversals and permits only one reversal adjustment', async () => {
    const draft = await createFinanceAdjustment(manualInput(P1));
    await postFinanceAdjustment({ organisationId: ORG, userId: USER, financeAdjustmentId: draft.id });
    const params = {
      organisationId: ORG,
      userId: USER,
      financeAdjustmentId: draft.id,
      reversalFinancialPeriodId: P2,
      reason: 'Correction',
    };
    const results = await Promise.allSettled([
      reverseFinanceAdjustment(params),
      reverseFinanceAdjustment(params),
    ]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(x => x.status === 'rejected')).toHaveLength(1);

    const count = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) n FROM commercial_finance_adjustments
       WHERE reversal_of_adjustment_id=$1::uuid`, draft.id,
    );
    expect(Number(count[0].n)).toBe(1);
  });
});
