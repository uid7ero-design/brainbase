import { randomUUID } from 'crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('financeReconciliation.integration.test.ts requires DATABASE_URL.');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) throw new Error('Refusing hosted database.');
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) throw new Error('Refusing non-localhost database.');

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Q = { strings: readonly string[]; values: unknown[] };
function compile(q: Q) {
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
      builder: (txn: (strings: TemplateStringsArray, ...values: unknown[]) => Q) => Q[],
      options?: { isolationLevel?: string },
    ) => prisma.$transaction(async tx => {
      const descriptors = builder((strings, ...values) => ({ strings, values }));
      const out: unknown[] = [];
      for (const descriptor of descriptors) {
        const q = compile(descriptor);
        out.push(await tx.$queryRawUnsafe(q.text, ...q.values));
      }
      return out;
    }, { isolationLevel: options?.isolationLevel as 'ReadCommitted' | 'RepeatableRead' | undefined }),
  },
);
vi.doMock('@/lib/db', () => ({ default: sqlMock }));
vi.doMock('@/lib/commercial/auditLog', () => ({
  logBudgetVersionActivated: vi.fn(),
  logBudgetVersionSuperseded: vi.fn(),
  logFinancialPeriodStatusChanged: vi.fn(),
}));

const {
  listFinanceReconciliationQueue,
  prepareFinanceReconciliation,
  reviewFinanceReconciliation,
  signOffFinanceReconciliation,
} = await import('@/lib/commercial/financeReconciliation');
const { createFinanceAdjustment, postFinanceAdjustment, reverseFinanceAdjustment } =
  await import('@/lib/commercial/financeAdjustments');
const { activateBudgetVersion } = await import('@/lib/commercial/budgetActivation');
const { closeFinancialPeriod, reopenFinancialPeriod } = await import('@/lib/commercial/financeClose');
const {
  importExternalGlEntry,
  createExternalGlAccountMapping,
  retireExternalGlAccountMapping,
  createExternalGlCostCentreMapping,
  retireExternalGlCostCentreMapping,
} = await import('@/lib/commercial/externalGl');

type Fixture = {
  org: string; user: string; fy: string; period: string; period2: string; cc: string;
  supplier: string; po: string; pol: string; bill: string; billLine: string;
  account: string; budget: string; version: string; budgetLine: string;
};
const id = () => randomUUID();

async function seedFixture(options: { sourceCents?: number; currency?: string; withSource?: boolean } = {}): Promise<Fixture> {
  const sourceCents = options.sourceCents ?? 1000;
  const currency = options.currency ?? 'AUD';
  const withSource = options.withSource ?? true;
  const f: Fixture = {
    org: `org-c79e1-${id().slice(0, 8)}`, user: `user-c79e1-${id().slice(0, 8)}`,
    fy: id(), period: id(), period2: id(), cc: id(), supplier: id(), po: id(), pol: id(),
    bill: id(), billLine: id(), account: id(), budget: id(), version: id(), budgetLine: id(),
  };
  await prisma.$executeRawUnsafe(
    `INSERT INTO organisations(id,name) VALUES ($1,'C7.9E1')`, f.org,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO users(id,organisation_id) VALUES ($1,$2)`, f.user, f.org,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_years(id,organisation_id,name,starts_on,ends_on,status)
     VALUES ($1::uuid,$2,'FY27','2026-07-01','2027-06-30','OPEN')`,
    f.fy, f.org,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_periods
      (id,financial_year_id,organisation_id,name,starts_on,ends_on,status)
     VALUES ($1::uuid,$2::uuid,$3,'Sep','2026-09-01','2026-09-30','OPEN'),
            ($4::uuid,$2::uuid,$3,'Oct','2026-10-01','2026-10-31','OPEN')`,
    f.period, f.fy, f.org, f.period2,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_cost_centres(id,organisation_id,code,name,active)
     VALUES ($1::uuid,$2,'OPS','Operations',true)`,
    f.cc, f.org,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_accounts(id,organisation_id,code,name,active,created_by)
     VALUES ($1::uuid,$2,'OPEX','Operating',true,$3)`,
    f.account, f.org, f.user,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budgets
      (id,organisation_id,financial_year_id,name,currency,tax_basis,periodisation_mode,created_by)
     VALUES ($1::uuid,$2,$3::uuid,'Budget',$4,'INCLUSIVE','ANNUAL_ONLY',$5)`,
    f.budget, f.org, f.fy, currency, f.user,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_versions
      (id,organisation_id,budget_id,version_number,status,created_by,activated_by,activated_at)
     VALUES ($1::uuid,$2,$3::uuid,1,'ACTIVE',$4,$4,now())`,
    f.version, f.org, f.budget, f.user,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_lines
      (id,organisation_id,budget_version_id,budget_account_id,cost_centre_id,annual_budget_cents)
     VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,1000000)`,
    f.budgetLine, f.org, f.version, f.account, f.cc,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_commitment_mappings
      (organisation_id,budget_version_id,cost_centre_id,budget_account_id,created_by)
     VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5)`,
    f.org, f.version, f.cc, f.account, f.user,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE commercial_budgets
     SET active_version_id=$1::uuid
     WHERE id=$2::uuid AND organisation_id=$3`,
    f.version, f.budget, f.org,
  );
  if (withSource) {
    const subtotal = sourceCents - 100;
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_suppliers(id,organisation_id,name)
       VALUES ($1::uuid,$2,'Supplier')`,
      f.supplier, f.org,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_purchase_orders
        (id,organisation_id,supplier_id,status,currency,cost_centre_id,issued_at)
       VALUES ($1::uuid,$2,$3::uuid,'ISSUED',$4,$5::uuid,'2026-09-01T00:00:00Z')`,
      f.po, f.org, f.supplier, currency, f.cc,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_purchase_order_lines
        (id,organisation_id,purchase_order_id,position,description_snapshot,cost_centre_id,
         line_subtotal_cents,line_tax_cents,line_total_cents)
       VALUES ($1::uuid,$2,$3::uuid,1,'Line',$4::uuid,$5,100,$6)`,
      f.pol, f.org, f.po, f.cc, subtotal, sourceCents,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_supplier_bills
        (id,organisation_id,supplier_id,source_purchase_order_id,bill_number,status,currency,
         bill_date,supplier_name_snapshot,posted_at)
       VALUES ($1::uuid,$2,$3::uuid,$4::uuid,'B-1','POSTED',$5,
               '2026-09-15','Supplier','2026-09-15T10:00:00Z')`,
      f.bill, f.org, f.supplier, f.po, currency,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_supplier_bill_lines
        (id,organisation_id,supplier_bill_id,source_purchase_order_line_id,position,
         line_subtotal_cents,line_tax_cents,line_total_cents)
       VALUES ($1::uuid,$2,$3::uuid,$4::uuid,1,$5,100,$6)`,
      f.billLine, f.org, f.bill, f.pol, subtotal, sourceCents,
    );
  }
  return f;
}

async function addAccount(f: Fixture, code: string) {
  const account = id();
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_accounts(id,organisation_id,code,name,active,created_by)
     VALUES ($1::uuid,$2,$3,$3,true,$4)`, account, f.org, code, f.user,
  );
  return account;
}
async function addMapping(f: Fixture, account = f.account, code = '600', from = '2026-07-01', to: string | null = null) {
  const mapping = id();
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_external_gl_account_mappings
      (id,organisation_id,source_system_id,external_gl_account_code,external_gl_account_name,budget_account_id,effective_from,effective_to,status,created_by)
     VALUES ($1::uuid,$2,'xero',$3,'GL',$4::uuid,$5::date,$6::date,'ACTIVE',$7)`,
    mapping, f.org, code, account, from, to, f.user,
  );
  return mapping;
}
async function addCostCentreMapping(
  f: Fixture,
  externalCode = 'OPS-EXT',
  from = '2026-07-01',
  to: string | null = null,
  costCentreId = f.cc,
) {
  const mapping = id();
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_external_gl_cost_centre_mappings
      (id,organisation_id,source_system_id,external_cost_centre_code,cost_centre_id,effective_from,effective_to,status,created_by)
     VALUES ($1::uuid,$2,'xero',$3,$4::uuid,$5::date,$6::date,'ACTIVE',$7)`,
    mapping, f.org, externalCode, costCentreId, from, to, f.user,
  );
  return mapping;
}

async function addEntry(f: Fixture, amount: number, code = '600', date = '2026-09-20', currency = 'AUD', costCentre: string | null = null) {
  const entry = id();
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_external_gl_entries
      (id,organisation_id,source_system_id,external_entry_id,external_account_code,external_cost_centre_code,transaction_date,currency,amount_minor_units,source_payload_hash,source_lineage_id,imported_by)
     VALUES ($1::uuid,$2,'xero',$3,$4,$5,$6::date,$7,$8,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',$9,$10)`,
    entry, f.org, `entry-${entry}`, code, costCentre, date, currency, amount, `batch-${entry}`, f.user,
  );
  return entry;
}
async function prepare(f: Fixture, period = f.period, currency = 'AUD') {
  return prepareFinanceReconciliation({
    organisationId: f.org, userId: f.user, financialPeriodId: period, sourceSystemId: 'xero', currency,
  });
}
async function postAdjustment(f: Fixture, cents: number, period = f.period) {
  const draft = await createFinanceAdjustment({
    organisationId: f.org, userId: f.user, adjustmentType: 'MANUAL_FINANCE_ADJUSTMENT',
    effectiveFinancialPeriodId: period, currency: 'AUD', description: 'Recon adjustment', reasonCode: 'RECON',
    lines: [{ budgetAccountId: f.account, costCentreId: f.cc, amountExclusiveCents: cents, taxCents: 0, amountInclusiveCents: cents }],
  });
  await postFinanceAdjustment({ organisationId: f.org, userId: f.user, financeAdjustmentId: draft.id });
  return draft;
}

async function signOffPeriod(f: Fixture, preparedId: string) {
  await reviewFinanceReconciliation({
    organisationId: f.org,
    userId: f.user,
    reconciliationId: preparedId,
  });
  const close = await closeFinancialPeriod({
    organisationId: f.org,
    userId: f.user,
    financialPeriodId: f.period,
    reason: 'Month end',
  });
  await signOffFinanceReconciliation({
    organisationId: f.org,
    userId: f.user,
    reconciliationId: preparedId,
    closeId: close.id,
  });
  return close;
}

async function expectMappingStale(
  f: Fixture,
  reconciliationId: string,
  closeId: string,
  cause: string,
) {
  const state = await prisma.$queryRawUnsafe<{
    reconciliation_status: string;
    close_reconciliation_status: string;
    close_status: string;
  }[]>(
    `SELECT reconciliation.status AS reconciliation_status,
            close_record.reconciliation_status AS close_reconciliation_status,
            close_record.status AS close_status
     FROM commercial_finance_reconciliations reconciliation
     JOIN commercial_financial_period_closes close_record
       ON close_record.id=reconciliation.close_id
      AND close_record.organisation_id=reconciliation.organisation_id
     WHERE reconciliation.id=$1::uuid
       AND reconciliation.organisation_id=$2`,
    reconciliationId,
    f.org,
  );
  expect(state[0]).toEqual({
    reconciliation_status: 'STALE',
    close_reconciliation_status: 'STALE',
    close_status: 'CLOSED',
  });

  const events = await prisma.$queryRawUnsafe<{ details: { cause?: string } }[]>(
    `SELECT details
     FROM commercial_finance_reconciliation_events
     WHERE reconciliation_id=$1::uuid
       AND organisation_id=$2
       AND event_type='STALE'
     ORDER BY event_at DESC,id DESC
     LIMIT 1`,
    reconciliationId,
    f.org,
  );
  expect(events[0].details).toMatchObject({ cause });

  const close = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM commercial_financial_period_closes
     WHERE id=$1::uuid AND organisation_id=$2`,
    closeId,
    f.org,
  );
  expect(close[0]?.id).toBe(closeId);
}

afterAll(async () => prisma.$disconnect());

describe('C7.9E1 — prepared finance reconciliation snapshots', () => {
  it('lists the latest unresolved reconciliation snapshot with tenant-scoped labels and exact evidence', async () => {
    const f = await seedFixture();
    await addEntry(f, 1000);

    const prepared = await prepare(f);
    expect(prepared.unresolvedItemCount).toBeGreaterThan(0);

    const queue = await listFinanceReconciliationQueue({
      organisationId: f.org,
      sourceSystemId: 'xero',
      financialPeriodId: f.period,
      currency: 'aud',
    });

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id: prepared.id,
      financialYearName: 'FY27',
      financialPeriodId: f.period,
      financialPeriodName: 'Sep',
      sourceSystemId: 'xero',
      currency: 'AUD',
      status: 'PREPARED',
      unresolvedItemCount: prepared.unresolvedItemCount,
    });
    expect(queue[0].items).toHaveLength(prepared.unresolvedItemCount);
    expect(queue[0].items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        budgetAccountId: f.account,
        budgetAccountCode: 'OPEX',
        budgetAccountName: 'Operating',
        outcome: 'UNMAPPED_BRAINBASE_ACCOUNT',
      }),
      expect.objectContaining({
        budgetAccountId: null,
        externalGlAccountCode: '600',
        outcome: 'UNMAPPED_EXTERNAL_GL_ACCOUNT',
        externalGlCents: '1000',
      }),
    ]));

    expect(await listFinanceReconciliationQueue({
      organisationId: 'missing-' + id(),
    })).toEqual([]);
  });

  it('drops an older unresolved snapshot from the queue when a newer snapshot for the same grain reconciles cleanly', async () => {
    const f = await seedFixture();
    await addEntry(f, 1000);

    const unresolved = await prepare(f);
    expect(unresolved.unresolvedItemCount).toBeGreaterThan(0);

    await createExternalGlAccountMapping({
      organisationId: f.org,
      userId: f.user,
      sourceSystemId: 'xero',
      externalAccountCode: '600',
      externalAccountName: 'GL',
      budgetAccountId: f.account,
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
    });

    const resolved = await prepare(f);
    expect(resolved.unresolvedItemCount).toBe(0);

    expect(await listFinanceReconciliationQueue({
      organisationId: f.org,
      sourceSystemId: 'xero',
      financialPeriodId: f.period,
      currency: 'AUD',
    })).toEqual([]);
  });
  it('reconciles exact mapped totals at zero-cent tolerance', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000);
    const result = await prepare(f);
    expect(result.varianceCents).toBe('0');
    expect(result.unresolvedItemCount).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].outcome).toBe('RECONCILED');
  });

  it('surfaces a mapped variance without tolerance', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 900);
    const result = await prepare(f);
    expect(result.varianceCents).toBe('100');
    expect(result.items[0].outcome).toBe('VARIANCE');
  });

  it('adds POSTED finance adjustments to source Actual', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await postAdjustment(f, 200);
    await addEntry(f, 1200);
    const result = await prepare(f);
    expect(result.sourceActualCents).toBe('1000');
    expect(result.financeAdjustmentCents).toBe('200');
    expect(result.brainbaseEffectiveActualCents).toBe('1200');
    expect(result.items[0].outcome).toBe('RECONCILED');
  });

  it('preserves reversed original value in its period and applies the opposite reversal in the later period', async () => {
    const f = await seedFixture();
    await addMapping(f);
    const original = await postAdjustment(f, 200, f.period);
    await reverseFinanceAdjustment({
      organisationId: f.org, userId: f.user, financeAdjustmentId: original.id,
      reversalFinancialPeriodId: f.period2, reason: 'Move correction forward',
    });
    await addEntry(f, 1200, '600', '2026-09-20');
    await addEntry(f, -200, '600', '2026-10-20');
    const september = await prepare(f, f.period);
    const october = await prepare(f, f.period2);
    expect(september.financeAdjustmentCents).toBe('200');
    expect(september.varianceCents).toBe('0');
    expect(october.financeAdjustmentCents).toBe('-200');
    expect(october.varianceCents).toBe('0');
  });

  it('selects external account mapping by the external entry transaction date', async () => {
    const f = await seedFixture({ withSource: false });
    const account2 = await addAccount(f, 'ALT');
    await addMapping(f, f.account, '600', '2026-09-01', '2026-09-15');
    const second = await addMapping(f, account2, '600', '2026-09-16', '2026-09-30');
    await addEntry(f, 777, '600', '2026-09-20');
    const result = await prepare(f);
    const item = result.items.find(x => x.externalEntryCount === 1);
    expect(item).toMatchObject({
      externalGlAccountMappingId: second,
      budgetAccountId: account2,
      externalGlCents: '777',
      outcome: 'EXTERNAL_ONLY_ENTRY',
    });
  });

  it('surfaces unmapped external accounts explicitly', async () => {
    const f = await seedFixture({ withSource: false });
    await addEntry(f, 500, '999');
    const result = await prepare(f);
    expect(result.items[0]).toMatchObject({
      budgetAccountId: null,
      externalGlAccountCode: '999',
      outcome: 'UNMAPPED_EXTERNAL_GL_ACCOUNT',
    });
  });

  it('surfaces BrainBase accounts that have no external mapping', async () => {
    const f = await seedFixture();
    const result = await prepare(f);
    expect(result.items[0]).toMatchObject({
      budgetAccountId: f.account,
      externalGlAccountMappingId: null,
      sourceActualCents: '1000',
      outcome: 'UNMAPPED_BRAINBASE_ACCOUNT',
    });
  });

  it('does not guess external cost-centre mappings', async () => {
    const f = await seedFixture({ withSource: false });
    await addMapping(f);
    await addEntry(f, 400, '600', '2026-09-20', 'AUD', 'OPS-EXT');
    const result = await prepare(f);
    expect(result.items[0]).toMatchObject({
      externalCostCentreCode: 'OPS-EXT',
      costCentreId: null,
      outcome: 'UNMAPPED_COST_CENTRE',
    });
  });

  it('reconciles an explicitly mapped external cost centre at account + cost-centre grain', async () => {
    const f = await seedFixture();
    const accountMapping = await addMapping(f);
    const costCentreMapping = await addCostCentreMapping(f, 'OPS-EXT', '2026-09-15');
    await addEntry(f, 1000, '600', '2026-09-20', 'AUD', 'OPS-EXT');

    const result = await prepare(f);

    expect(result.unresolvedItemCount).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      budgetAccountId: f.account,
      externalGlAccountMappingId: accountMapping,
      externalGlAccountCode: '600',
      externalCostCentreMappingId: costCentreMapping,
      costCentreId: f.cc,
      externalCostCentreCode: 'OPS-EXT',
      sourceActualCents: '1000',
      financeAdjustmentCents: '0',
      brainbaseEffectiveActualCents: '1000',
      externalGlCents: '1000',
      varianceCents: '0',
      outcome: 'RECONCILED',
    });
  });

  it('keeps mapped external cost-centre evidence as external-only when BrainBase has no matching grain', async () => {
    const f = await seedFixture({ withSource: false });
    const accountMapping = await addMapping(f);
    const costCentreMapping = await addCostCentreMapping(f);
    await addEntry(f, 400, '600', '2026-09-20', 'AUD', 'OPS-EXT');

    const result = await prepare(f);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      budgetAccountId: f.account,
      externalGlAccountMappingId: accountMapping,
      externalCostCentreMappingId: costCentreMapping,
      costCentreId: f.cc,
      externalCostCentreCode: 'OPS-EXT',
      sourceActualCents: '0',
      externalGlCents: '400',
      varianceCents: '-400',
      outcome: 'EXTERNAL_ONLY_ENTRY',
    });
  });

  it('keeps identical external identities and mappings isolated by tenant', async () => {
    const a = await seedFixture();
    const b = await seedFixture();
    await addMapping(a); await addMapping(b);
    await addEntry(a, 1000); await addEntry(b, 2500);
    const result = await prepare(a);
    expect(result.externalGlTotalCents).toBe('1000');
    expect(result.varianceCents).toBe('0');
  });

  it('never combines currencies in one reconciliation snapshot', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000, '600', '2026-09-20', 'AUD');
    await addEntry(f, 9999, '600', '2026-09-20', 'USD');
    const result = await prepare(f, f.period, 'AUD');
    expect(result.currency).toBe('AUD');
    expect(result.externalGlTotalCents).toBe('1000');
  });

  it('never combines external entries from a different financial period', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000, '600', '2026-09-20', 'AUD');
    await addEntry(f, 9999, '600', '2026-10-02', 'AUD');

    const result = await prepare(f, f.period, 'AUD');

    expect(result.externalGlTotalCents).toBe('1000');
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        externalGlAccountCode: '600',
        externalGlCents: '1000',
      }),
    ]));
    expect(result.items.some(item => item.externalGlCents === '9999')).toBe(false);
  });

  it('persists parent totals that exactly equal its item evidence', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 900);
    const result = await prepare(f);
    const sums = await prisma.$queryRawUnsafe<{
      source: bigint; adjustments: bigint; effective: bigint; external: bigint; variance: bigint;
    }[]>(
      `SELECT COALESCE(SUM(source_actual_cents),0) source,
              COALESCE(SUM(finance_adjustment_cents),0) adjustments,
              COALESCE(SUM(brainbase_effective_actual_cents),0) effective,
              COALESCE(SUM(external_gl_cents),0) external,
              COALESCE(SUM(variance_cents),0) variance
       FROM commercial_finance_reconciliation_items
       WHERE reconciliation_id=$1::uuid AND organisation_id=$2`,
      result.id, f.org,
    );
    expect(sums[0].source.toString()).toBe(result.sourceActualCents);
    expect(sums[0].adjustments.toString()).toBe(result.financeAdjustmentCents);
    expect(sums[0].effective.toString()).toBe(result.brainbaseEffectiveActualCents);
    expect(sums[0].external.toString()).toBe(result.externalGlTotalCents);
    expect(sums[0].variance.toString()).toBe(result.varianceCents);
  });

  it('keeps a prepared snapshot unchanged after a later ACTIVE Budget version replaces classification', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000);
    const prepared = await prepare(f);
    const account2 = await addAccount(f, 'NEW');
    const version2 = id();
    const line2 = id();
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_budget_versions
        (id,organisation_id,budget_id,version_number,status,created_by)
       VALUES ($1::uuid,$2,$3::uuid,2,'DRAFT',$4)`,
      version2, f.org, f.budget, f.user,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_budget_lines
        (id,organisation_id,budget_version_id,budget_account_id,cost_centre_id,annual_budget_cents)
       VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,1000000)`,
      line2, f.org, version2, account2, f.cc,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO commercial_budget_commitment_mappings
        (organisation_id,budget_version_id,cost_centre_id,budget_account_id,created_by)
       VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5)`,
      f.org, version2, f.cc, account2, f.user,
    );
    await activateBudgetVersion({
      organisationId: f.org, userId: f.user, budgetId: f.budget, budgetVersionId: version2,
    });
    const persisted = await prisma.$queryRawUnsafe<{ budget_account_id: string | null; source_actual_cents: bigint }[]>(
      `SELECT budget_account_id,source_actual_cents
       FROM commercial_finance_reconciliation_items
       WHERE reconciliation_id=$1::uuid AND organisation_id=$2`, prepared.id, f.org,
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0].budget_account_id).toBe(f.account);
    expect(persisted[0].source_actual_cents.toString()).toBe('1000');
  });

  it('rolls back PREPARED snapshot and items when the transactional PREPARED event write fails', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000);

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_reject_finance_reconciliation_prepared_event()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'PREPARED' THEN
          RAISE EXCEPTION 'test prepared event failure';
        END IF;
        RETURN NEW;
      END $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_test_reject_finance_reconciliation_prepared_event
      BEFORE INSERT ON commercial_finance_reconciliation_events
      FOR EACH ROW EXECUTE FUNCTION test_reject_finance_reconciliation_prepared_event()
    `);

    try {
      await expect(prepare(f)).rejects.toThrow(/test prepared event failure/);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS trg_test_reject_finance_reconciliation_prepared_event
         ON commercial_finance_reconciliation_events`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS test_reject_finance_reconciliation_prepared_event()`,
      );
    }

    const reconciliationCount = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count
       FROM commercial_finance_reconciliations
       WHERE organisation_id=$1
         AND financial_period_id=$2::uuid
         AND source_system_id='xero'
         AND currency='AUD'`,
      f.org,
      f.period,
    );
    expect(reconciliationCount[0].count.toString()).toBe('0');

    const itemCount = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count
       FROM commercial_finance_reconciliation_items
       WHERE organisation_id=$1`,
      f.org,
    );
    expect(itemCount[0].count.toString()).toBe('0');

    const eventCount = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count
       FROM commercial_finance_reconciliation_events
       WHERE organisation_id=$1`,
      f.org,
    );
    expect(eventCount[0].count.toString()).toBe('0');
  });

  it('rolls back REVIEW state when the transactional REVIEWED event write fails', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000);
    const prepared = await prepare(f);

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_reject_finance_reconciliation_reviewed_event()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'REVIEWED' THEN
          RAISE EXCEPTION 'test reviewed event failure';
        END IF;
        RETURN NEW;
      END $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_test_reject_finance_reconciliation_reviewed_event
      BEFORE INSERT ON commercial_finance_reconciliation_events
      FOR EACH ROW EXECUTE FUNCTION test_reject_finance_reconciliation_reviewed_event()
    `);

    try {
      await expect(reviewFinanceReconciliation({
        organisationId: f.org,
        userId: f.user,
        reconciliationId: prepared.id,
      })).rejects.toThrow(/test reviewed event failure/);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS trg_test_reject_finance_reconciliation_reviewed_event
         ON commercial_finance_reconciliation_events`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS test_reject_finance_reconciliation_reviewed_event()`,
      );
    }

    const state = await prisma.$queryRawUnsafe<{
      status: string;
      reviewed_by: string | null;
      reviewed_at: Date | null;
    }[]>(
      `SELECT status,reviewed_by,reviewed_at
       FROM commercial_finance_reconciliations
       WHERE id=$1::uuid AND organisation_id=$2`,
      prepared.id,
      f.org,
    );
    expect(state[0]).toEqual({
      status: 'PREPARED',
      reviewed_by: null,
      reviewed_at: null,
    });

    const events = await prisma.$queryRawUnsafe<{ event_type: string }[]>(
      `SELECT event_type
       FROM commercial_finance_reconciliation_events
       WHERE reconciliation_id=$1::uuid AND organisation_id=$2
       ORDER BY event_at,id`,
      prepared.id,
      f.org,
    );
    expect(events).toEqual([{ event_type: 'PREPARED' }]);
  });

  it('writes durable PREPARED and REVIEWED events and permits PREPARED -> REVIEWED exactly once', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000);
    const prepared = await prepare(f);

    const preparedEvents = await prisma.$queryRawUnsafe<{
      event_type: string; actor_user_id: string;
    }[]>(
      `SELECT event_type,actor_user_id
       FROM commercial_finance_reconciliation_events
       WHERE reconciliation_id=$1::uuid AND organisation_id=$2
       ORDER BY event_at,id`,
      prepared.id, f.org,
    );
    expect(preparedEvents).toEqual([{ event_type: 'PREPARED', actor_user_id: f.user }]);

    const reviewed = await reviewFinanceReconciliation({
      organisationId: f.org,
      userId: f.user,
      reconciliationId: prepared.id,
    });
    expect(reviewed).toMatchObject({
      id: prepared.id,
      organisationId: f.org,
      status: 'REVIEWED',
      reviewedBy: f.user,
    });

    const events = await prisma.$queryRawUnsafe<{
      event_type: string; actor_user_id: string;
    }[]>(
      `SELECT event_type,actor_user_id
       FROM commercial_finance_reconciliation_events
       WHERE reconciliation_id=$1::uuid AND organisation_id=$2
       ORDER BY event_at,id`,
      prepared.id, f.org,
    );
    expect(events.map(event => event.event_type)).toEqual(['PREPARED', 'REVIEWED']);

    await expect(reviewFinanceReconciliation({
      organisationId: f.org,
      userId: f.user,
      reconciliationId: prepared.id,
    })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('collapses cross-tenant review to NOT_FOUND and preserves PREPARED state', async () => {
    const f = await seedFixture();
    const other = await seedFixture({ withSource: false });
    await addMapping(f);
    await addEntry(f, 1000);
    const prepared = await prepare(f);

    await expect(reviewFinanceReconciliation({
      organisationId: other.org,
      userId: other.user,
      reconciliationId: prepared.id,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const state = await prisma.$queryRawUnsafe<{ status: string; reviewed_by: string | null }[]>(
      `SELECT status,reviewed_by
       FROM commercial_finance_reconciliations
       WHERE id=$1::uuid AND organisation_id=$2`,
      prepared.id, f.org,
    );
    expect(state[0]).toEqual({ status: 'PREPARED', reviewed_by: null });
  });

  it('rejects lifecycle jumps that bypass REVIEWED', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000);
    const prepared = await prepare(f);

    await expect(prisma.$executeRawUnsafe(
      `UPDATE commercial_finance_reconciliations
       SET status='SIGNED_OFF'
       WHERE id=$1::uuid AND organisation_id=$2`,
      prepared.id, f.org,
    )).rejects.toThrow(/invalid finance reconciliation lifecycle transition/);
  });

  it('rolls back reconciliation and close state when the transactional SIGNED_OFF event write fails', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000);
    const prepared = await prepare(f);

    await reviewFinanceReconciliation({
      organisationId: f.org,
      userId: f.user,
      reconciliationId: prepared.id,
    });
    const close = await closeFinancialPeriod({
      organisationId: f.org,
      userId: f.user,
      financialPeriodId: f.period,
      reason: 'Month end',
    });

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_reject_finance_reconciliation_signed_off_event()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'SIGNED_OFF' THEN
          RAISE EXCEPTION 'test signed-off event failure';
        END IF;
        RETURN NEW;
      END $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_test_reject_finance_reconciliation_signed_off_event
      BEFORE INSERT ON commercial_finance_reconciliation_events
      FOR EACH ROW EXECUTE FUNCTION test_reject_finance_reconciliation_signed_off_event()
    `);

    try {
      await expect(signOffFinanceReconciliation({
        organisationId: f.org,
        userId: f.user,
        reconciliationId: prepared.id,
        closeId: close.id,
      })).rejects.toThrow(/test signed-off event failure/);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS trg_test_reject_finance_reconciliation_signed_off_event
         ON commercial_finance_reconciliation_events`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS test_reject_finance_reconciliation_signed_off_event()`,
      );
    }

    const reconciliationState = await prisma.$queryRawUnsafe<{
      status: string;
      close_id: string | null;
    }[]>(
      `SELECT status,close_id
       FROM commercial_finance_reconciliations
       WHERE id=$1::uuid AND organisation_id=$2`,
      prepared.id,
      f.org,
    );
    expect(reconciliationState[0]).toEqual({
      status: 'REVIEWED',
      close_id: null,
    });

    const closeState = await prisma.$queryRawUnsafe<{
      status: string;
      reconciliation_status: string;
    }[]>(
      `SELECT status,reconciliation_status
       FROM commercial_financial_period_closes
       WHERE id=$1::uuid AND organisation_id=$2`,
      close.id,
      f.org,
    );
    expect(closeState[0]).toEqual({
      status: 'CLOSED',
      reconciliation_status: 'NOT_CONFIGURED',
    });

    const events = await prisma.$queryRawUnsafe<{ event_type: string }[]>(
      `SELECT event_type
       FROM commercial_finance_reconciliation_events
       WHERE reconciliation_id=$1::uuid AND organisation_id=$2
       ORDER BY event_at,id`,
      prepared.id,
      f.org,
    );
    expect(events.map(event => event.event_type)).toEqual(['PREPARED', 'REVIEWED']);
  });

  it('signs off only a REVIEWED reconciliation against the current CLOSED record for the same period', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000);
    const prepared = await prepare(f);

    await reviewFinanceReconciliation({
      organisationId: f.org,
      userId: f.user,
      reconciliationId: prepared.id,
    });
    const close = await closeFinancialPeriod({
      organisationId: f.org,
      userId: f.user,
      financialPeriodId: f.period,
      reason: 'Month end',
    });

    const signed = await signOffFinanceReconciliation({
      organisationId: f.org,
      userId: f.user,
      reconciliationId: prepared.id,
      closeId: close.id,
    });

    expect(signed).toMatchObject({
      id: prepared.id,
      organisationId: f.org,
      financialPeriodId: f.period,
      status: 'SIGNED_OFF',
      closeId: close.id,
    });

    const closeState = await prisma.$queryRawUnsafe<{ reconciliation_status: string }[]>(
      `SELECT reconciliation_status
       FROM commercial_financial_period_closes
       WHERE id=$1::uuid AND organisation_id=$2`,
      close.id, f.org,
    );
    expect(closeState[0].reconciliation_status).toBe('SIGNED_OFF');

    const events = await prisma.$queryRawUnsafe<{ event_type: string }[]>(
      `SELECT event_type
       FROM commercial_finance_reconciliation_events
       WHERE reconciliation_id=$1::uuid AND organisation_id=$2
       ORDER BY event_at,id`,
      prepared.id, f.org,
    );
    expect(events.map(event => event.event_type)).toEqual(['PREPARED', 'REVIEWED', 'SIGNED_OFF']);
  });

  it('rejects sign-off before review and rejects a close from a different financial period', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000);
    const prepared = await prepare(f);
    const currentClose = await closeFinancialPeriod({
      organisationId: f.org,
      userId: f.user,
      financialPeriodId: f.period,
    });

    await expect(signOffFinanceReconciliation({
      organisationId: f.org,
      userId: f.user,
      reconciliationId: prepared.id,
      closeId: currentClose.id,
    })).rejects.toMatchObject({ code: 'INVALID_STATE' });

    await reopenFinancialPeriod({
      organisationId: f.org,
      userId: f.user,
      financialPeriodId: f.period,
      reason: 'Continue test',
    });
    await reviewFinanceReconciliation({
      organisationId: f.org,
      userId: f.user,
      reconciliationId: prepared.id,
    });

    const otherClose = await closeFinancialPeriod({
      organisationId: f.org,
      userId: f.user,
      financialPeriodId: f.period2,
    });
    await expect(signOffFinanceReconciliation({
      organisationId: f.org,
      userId: f.user,
      reconciliationId: prepared.id,
      closeId: otherClose.id,
    })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('reopen makes the attached sign-off STALE without deleting snapshot, items, or lifecycle evidence', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000);
    const prepared = await prepare(f);
    await reviewFinanceReconciliation({
      organisationId: f.org,
      userId: f.user,
      reconciliationId: prepared.id,
    });
    const close = await closeFinancialPeriod({
      organisationId: f.org,
      userId: f.user,
      financialPeriodId: f.period,
    });
    await signOffFinanceReconciliation({
      organisationId: f.org,
      userId: f.user,
      reconciliationId: prepared.id,
      closeId: close.id,
    });

    const beforeCounts = await prisma.$queryRawUnsafe<{ items: bigint; events: bigint }[]>(
      `SELECT
         (SELECT COUNT(*) FROM commercial_finance_reconciliation_items
          WHERE reconciliation_id=$1::uuid AND organisation_id=$2) AS items,
         (SELECT COUNT(*) FROM commercial_finance_reconciliation_events
          WHERE reconciliation_id=$1::uuid AND organisation_id=$2) AS events`,
      prepared.id, f.org,
    );

    const invalidated = await reopenFinancialPeriod({
      organisationId: f.org,
      userId: f.user,
      financialPeriodId: f.period,
      reason: 'Correction required',
    });
    expect(invalidated).toMatchObject({
      id: close.id,
      status: 'INVALIDATED',
      reconciliation_status: 'STALE',
    });

    const reconciliation = await prisma.$queryRawUnsafe<{
      status: string; close_id: string | null;
    }[]>(
      `SELECT status,close_id
       FROM commercial_finance_reconciliations
       WHERE id=$1::uuid AND organisation_id=$2`,
      prepared.id, f.org,
    );
    expect(reconciliation[0]).toEqual({ status: 'STALE', close_id: close.id });

    const afterCounts = await prisma.$queryRawUnsafe<{ items: bigint; events: bigint }[]>(
      `SELECT
         (SELECT COUNT(*) FROM commercial_finance_reconciliation_items
          WHERE reconciliation_id=$1::uuid AND organisation_id=$2) AS items,
         (SELECT COUNT(*) FROM commercial_finance_reconciliation_events
          WHERE reconciliation_id=$1::uuid AND organisation_id=$2) AS events`,
      prepared.id, f.org,
    );
    expect(afterCounts[0].items.toString()).toBe(beforeCounts[0].items.toString());
    expect(Number(afterCounts[0].events)).toBe(Number(beforeCounts[0].events) + 1);

    const events = await prisma.$queryRawUnsafe<{ event_type: string; details: { cause?: string } }[]>(
      `SELECT event_type,details
       FROM commercial_finance_reconciliation_events
       WHERE reconciliation_id=$1::uuid AND organisation_id=$2
       ORDER BY event_at,id`,
      prepared.id, f.org,
    );
    expect(events.map(event => event.event_type)).toEqual([
      'PREPARED', 'REVIEWED', 'SIGNED_OFF', 'STALE',
    ]);
    expect(events.at(-1)?.details).toMatchObject({ cause: 'PERIOD_REOPENED' });

    await expect(prisma.$executeRawUnsafe(
      `DELETE FROM commercial_finance_reconciliation_events
       WHERE reconciliation_id=$1::uuid AND event_type='SIGNED_OFF'`,
      prepared.id,
    )).rejects.toThrow(/events are immutable/);

    await expect(prisma.$executeRawUnsafe(
      `DELETE FROM commercial_finance_reconciliation_items
       WHERE reconciliation_id=$1::uuid`,
      prepared.id,
    )).rejects.toThrow(/items are immutable/);

    await expect(prisma.$executeRawUnsafe(
      `DELETE FROM commercial_finance_reconciliations
       WHERE id=$1::uuid`,
      prepared.id,
    )).rejects.toThrow(/snapshots cannot be deleted/);
  });

  it('does not disclose or attach a close belonging to another tenant', async () => {
    const f = await seedFixture();
    const other = await seedFixture({ withSource: false });
    await addMapping(f);
    await addEntry(f, 1000);
    const prepared = await prepare(f);
    await reviewFinanceReconciliation({
      organisationId: f.org,
      userId: f.user,
      reconciliationId: prepared.id,
    });
    const otherClose = await closeFinancialPeriod({
      organisationId: other.org,
      userId: other.user,
      financialPeriodId: other.period,
    });

    await expect(signOffFinanceReconciliation({
      organisationId: f.org,
      userId: f.user,
      reconciliationId: prepared.id,
      closeId: otherClose.id,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const state = await prisma.$queryRawUnsafe<{ status: string; close_id: string | null }[]>(
      `SELECT status,close_id
       FROM commercial_finance_reconciliations
       WHERE id=$1::uuid AND organisation_id=$2`,
      prepared.id, f.org,
    );
    expect(state[0]).toEqual({ status: 'REVIEWED', close_id: null });
  });

  it('marks a signed-off closed reconciliation STALE when a new external GL fact is imported for that period', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000);
    const prepared = await prepare(f);
    const close = await signOffPeriod(f, prepared.id);

    const imported = await importExternalGlEntry({
      organisationId: f.org,
      userId: f.user,
      sourceSystemId: 'xero',
      externalEntryId: `late-${id()}`,
      externalAccountCode: '600',
      transactionDate: '2026-09-25',
      currency: 'AUD',
      amountMinorUnits: '50',
      sourcePayloadHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceLineageId: `late-batch-${id()}`,
    });

    expect(imported.outcome).toBe('IMPORTED');
    expect(imported.staleReconciliationCount).toBe(1);

    const state = await prisma.$queryRawUnsafe<{
      reconciliation_status: string;
      close_status: string;
    }[]>(
      `SELECT reconciliation.status AS reconciliation_status,
              close_record.reconciliation_status AS close_status
       FROM commercial_finance_reconciliations reconciliation
       JOIN commercial_financial_period_closes close_record
         ON close_record.id=reconciliation.close_id
        AND close_record.organisation_id=reconciliation.organisation_id
       WHERE reconciliation.id=$1::uuid
         AND reconciliation.organisation_id=$2`,
      prepared.id, f.org,
    );
    expect(state[0]).toEqual({
      reconciliation_status: 'STALE',
      close_status: 'STALE',
    });

    const events = await prisma.$queryRawUnsafe<{ event_type: string; details: { cause?: string } }[]>(
      `SELECT event_type,details
       FROM commercial_finance_reconciliation_events
       WHERE reconciliation_id=$1::uuid AND organisation_id=$2
       ORDER BY event_at,id`,
      prepared.id, f.org,
    );
    expect(events.map(event => event.event_type)).toEqual([
      'PREPARED', 'REVIEWED', 'SIGNED_OFF', 'STALE',
    ]);
    expect(events.at(-1)?.details).toMatchObject({
      cause: 'EXTERNAL_GL_NEW_ENTRY',
    });

    const storedClose = await prisma.$queryRawUnsafe<{ id: string; status: string }[]>(
      `SELECT id,status
       FROM commercial_financial_period_closes
       WHERE id=$1::uuid AND organisation_id=$2`,
      close.id, f.org,
    );
    expect(storedClose[0]).toEqual({ id: close.id, status: 'CLOSED' });
  });

  it('keeps an exact duplicate import idempotent and does not stale a signed-off reconciliation', async () => {
    const f = await seedFixture();
    await addMapping(f);
    const existingEntryId = await addEntry(f, 1000);
    const prepared = await prepare(f);
    await signOffPeriod(f, prepared.id);

    const duplicate = await importExternalGlEntry({
      organisationId: f.org,
      userId: f.user,
      sourceSystemId: 'xero',
      externalEntryId: `entry-${existingEntryId}`,
      externalAccountCode: '600',
      transactionDate: '2026-09-20',
      currency: 'AUD',
      amountMinorUnits: '1000',
      sourcePayloadHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceLineageId: `batch-${existingEntryId}`,
    });

    expect(duplicate.outcome).toBe('IDEMPOTENT');
    expect(duplicate.staleReconciliationCount).toBe(0);

    const state = await prisma.$queryRawUnsafe<{ status: string }[]>(
      `SELECT status
       FROM commercial_finance_reconciliations
       WHERE id=$1::uuid AND organisation_id=$2`,
      prepared.id, f.org,
    );
    expect(state[0].status).toBe('SIGNED_OFF');

    const staleEvents = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count
       FROM commercial_finance_reconciliation_events
       WHERE reconciliation_id=$1::uuid
         AND organisation_id=$2
         AND event_type='STALE'`,
      prepared.id, f.org,
    );
    expect(staleEvents[0].count.toString()).toBe('0');
  });

  it('rolls back account-mapping creation when its transactional STALE event write fails', async () => {
    const f = await seedFixture();
    await addEntry(f, 1000);
    const prepared = await prepare(f);
    const close = await signOffPeriod(f, prepared.id);

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_reject_account_mapping_stale_event()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'STALE' THEN
          RAISE EXCEPTION 'test account mapping stale event failure';
        END IF;
        RETURN NEW;
      END $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_test_reject_account_mapping_stale_event
      BEFORE INSERT ON commercial_finance_reconciliation_events
      FOR EACH ROW EXECUTE FUNCTION test_reject_account_mapping_stale_event()
    `);

    try {
      await expect(createExternalGlAccountMapping({
        organisationId: f.org,
        userId: f.user,
        sourceSystemId: 'xero',
        externalAccountCode: '600',
        externalAccountName: 'GL',
        budgetAccountId: f.account,
        effectiveFrom: '2026-07-01',
        effectiveTo: null,
      })).rejects.toThrow(/test account mapping stale event failure/);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS trg_test_reject_account_mapping_stale_event
         ON commercial_finance_reconciliation_events`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS test_reject_account_mapping_stale_event()`,
      );
    }

    const mappings = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count
       FROM commercial_external_gl_account_mappings
       WHERE organisation_id=$1
         AND source_system_id='xero'
         AND external_gl_account_code='600'`,
      f.org,
    );
    expect(mappings[0].count.toString()).toBe('0');

    const reconciliation = await prisma.$queryRawUnsafe<{
      status: string;
      close_id: string | null;
    }[]>(
      `SELECT status,close_id
       FROM commercial_finance_reconciliations
       WHERE id=$1::uuid AND organisation_id=$2`,
      prepared.id,
      f.org,
    );
    expect(reconciliation[0]).toEqual({
      status: 'SIGNED_OFF',
      close_id: close.id,
    });

    const closeState = await prisma.$queryRawUnsafe<{
      status: string;
      reconciliation_status: string;
    }[]>(
      `SELECT status,reconciliation_status
       FROM commercial_financial_period_closes
       WHERE id=$1::uuid AND organisation_id=$2`,
      close.id,
      f.org,
    );
    expect(closeState[0]).toEqual({
      status: 'CLOSED',
      reconciliation_status: 'SIGNED_OFF',
    });

    const staleEvents = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count
       FROM commercial_finance_reconciliation_events
       WHERE reconciliation_id=$1::uuid
         AND organisation_id=$2
         AND event_type='STALE'`,
      prepared.id,
      f.org,
    );
    expect(staleEvents[0].count.toString()).toBe('0');
  });

  it('stales a signed reconciliation when a missing GL account mapping is created for existing evidence', async () => {
    const f = await seedFixture();
    await addEntry(f, 1000);
    const prepared = await prepare(f);
    expect(prepared.unresolvedItemCount).toBeGreaterThan(0);
    const close = await signOffPeriod(f, prepared.id);

    await createExternalGlAccountMapping({
      organisationId: f.org,
      userId: f.user,
      sourceSystemId: 'xero',
      externalAccountCode: '600',
      externalAccountName: 'GL',
      budgetAccountId: f.account,
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
    });

    await expectMappingStale(
      f,
      prepared.id,
      close.id,
      'EXTERNAL_GL_ACCOUNT_MAPPING_CREATED',
    );
  });

  it('stales a signed reconciliation when a missing cost-centre mapping is created for existing evidence', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000, '600', '2026-09-20', 'AUD', 'OPS-EXT');
    const prepared = await prepare(f);
    expect(prepared.unresolvedItemCount).toBeGreaterThan(0);
    const close = await signOffPeriod(f, prepared.id);

    await createExternalGlCostCentreMapping({
      organisationId: f.org,
      userId: f.user,
      sourceSystemId: 'xero',
      externalCostCentreCode: 'OPS-EXT',
      costCentreId: f.cc,
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
    });

    await expectMappingStale(
      f,
      prepared.id,
      close.id,
      'EXTERNAL_GL_COST_CENTRE_MAPPING_CREATED',
    );
  });

  it('stales a signed reconciliation when an account mapping retirement cuts off existing GL evidence', async () => {
    const f = await seedFixture();
    const mappingId = await addMapping(f);
    await addEntry(f, 1000, '600', '2026-09-20');
    const prepared = await prepare(f);
    const close = await signOffPeriod(f, prepared.id);

    await retireExternalGlAccountMapping({
      organisationId: f.org,
      userId: f.user,
      mappingId,
      effectiveTo: '2026-09-15',
    });

    await expectMappingStale(
      f,
      prepared.id,
      close.id,
      'EXTERNAL_GL_ACCOUNT_MAPPING_RETIRED',
    );
  });

  it('rolls back cost-centre mapping retirement when its transactional STALE event write fails', async () => {
    const f = await seedFixture();
    await addMapping(f);
    const mappingId = await addCostCentreMapping(f);
    await addEntry(f, 1000, '600', '2026-09-20', 'AUD', 'OPS-EXT');
    const prepared = await prepare(f);
    const close = await signOffPeriod(f, prepared.id);

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_reject_cost_centre_mapping_stale_event()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'STALE' THEN
          RAISE EXCEPTION 'test cost-centre mapping stale event failure';
        END IF;
        RETURN NEW;
      END $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_test_reject_cost_centre_mapping_stale_event
      BEFORE INSERT ON commercial_finance_reconciliation_events
      FOR EACH ROW EXECUTE FUNCTION test_reject_cost_centre_mapping_stale_event()
    `);

    try {
      await expect(retireExternalGlCostCentreMapping({
        organisationId: f.org,
        userId: f.user,
        mappingId,
        effectiveTo: '2026-09-15',
      })).rejects.toThrow(/test cost-centre mapping stale event failure/);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS trg_test_reject_cost_centre_mapping_stale_event
         ON commercial_finance_reconciliation_events`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS test_reject_cost_centre_mapping_stale_event()`,
      );
    }

    const mapping = await prisma.$queryRawUnsafe<{
      status: string;
      effective_to: Date | null;
      retired_by: string | null;
      retired_at: Date | null;
    }[]>(
      `SELECT status,effective_to,retired_by,retired_at
       FROM commercial_external_gl_cost_centre_mappings
       WHERE id=$1::uuid AND organisation_id=$2`,
      mappingId,
      f.org,
    );
    expect(mapping[0]).toEqual({
      status: 'ACTIVE',
      effective_to: null,
      retired_by: null,
      retired_at: null,
    });

    const reconciliation = await prisma.$queryRawUnsafe<{
      status: string;
      close_id: string | null;
    }[]>(
      `SELECT status,close_id
       FROM commercial_finance_reconciliations
       WHERE id=$1::uuid AND organisation_id=$2`,
      prepared.id,
      f.org,
    );
    expect(reconciliation[0]).toEqual({
      status: 'SIGNED_OFF',
      close_id: close.id,
    });

    const closeState = await prisma.$queryRawUnsafe<{
      status: string;
      reconciliation_status: string;
    }[]>(
      `SELECT status,reconciliation_status
       FROM commercial_financial_period_closes
       WHERE id=$1::uuid AND organisation_id=$2`,
      close.id,
      f.org,
    );
    expect(closeState[0]).toEqual({
      status: 'CLOSED',
      reconciliation_status: 'SIGNED_OFF',
    });

    const staleEvents = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count
       FROM commercial_finance_reconciliation_events
       WHERE reconciliation_id=$1::uuid
         AND organisation_id=$2
         AND event_type='STALE'`,
      prepared.id,
      f.org,
    );
    expect(staleEvents[0].count.toString()).toBe('0');
  });

  it('stales a signed reconciliation when a cost-centre mapping retirement cuts off existing GL evidence', async () => {
    const f = await seedFixture();
    await addMapping(f);
    const mappingId = await addCostCentreMapping(f);
    await addEntry(f, 1000, '600', '2026-09-20', 'AUD', 'OPS-EXT');
    const prepared = await prepare(f);
    const close = await signOffPeriod(f, prepared.id);

    await retireExternalGlCostCentreMapping({
      organisationId: f.org,
      userId: f.user,
      mappingId,
      effectiveTo: '2026-09-15',
    });

    await expectMappingStale(
      f,
      prepared.id,
      close.id,
      'EXTERNAL_GL_COST_CENTRE_MAPPING_RETIRED',
    );
  });

  it('rejects retirement dates that would extend a finite mapping without mutating it', async () => {
    const f = await seedFixture();
    const accountMappingId = await addMapping(f, f.account, '600', '2026-07-01', '2026-09-30');
    const costCentreMappingId = await addCostCentreMapping(
      f,
      'OPS-EXT',
      '2026-07-01',
      '2026-09-30',
    );

    await expect(retireExternalGlAccountMapping({
      organisationId: f.org,
      userId: f.user,
      mappingId: accountMappingId,
      effectiveTo: '2026-10-31',
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    await expect(retireExternalGlCostCentreMapping({
      organisationId: f.org,
      userId: f.user,
      mappingId: costCentreMappingId,
      effectiveTo: '2026-10-31',
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const accountMapping = await prisma.$queryRawUnsafe<{ status: string; effective_to: Date }[]>(
      `SELECT status,effective_to
       FROM commercial_external_gl_account_mappings
       WHERE id=$1::uuid AND organisation_id=$2`,
      accountMappingId,
      f.org,
    );
    const costCentreMapping = await prisma.$queryRawUnsafe<{ status: string; effective_to: Date }[]>(
      `SELECT status,effective_to
       FROM commercial_external_gl_cost_centre_mappings
       WHERE id=$1::uuid AND organisation_id=$2`,
      costCentreMappingId,
      f.org,
    );

    expect(accountMapping[0].status).toBe('ACTIVE');
    expect(accountMapping[0].effective_to.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(costCentreMapping[0].status).toBe('ACTIVE');
    expect(costCentreMapping[0].effective_to.toISOString().slice(0, 10)).toBe('2026-09-30');
  });

  it('rolls back a late GL import and stale transition when the transactional STALE event write fails', async () => {
    const f = await seedFixture();
    await addMapping(f);
    await addEntry(f, 1000);
    const prepared = await prepare(f);
    const close = await signOffPeriod(f, prepared.id);
    const lateEntryId = `late-${id()}`;

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_reject_finance_reconciliation_stale_event()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'STALE' THEN
          RAISE EXCEPTION 'test stale event failure';
        END IF;
        RETURN NEW;
      END $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trg_test_reject_finance_reconciliation_stale_event
      BEFORE INSERT ON commercial_finance_reconciliation_events
      FOR EACH ROW EXECUTE FUNCTION test_reject_finance_reconciliation_stale_event()
    `);

    try {
      await expect(importExternalGlEntry({
        organisationId: f.org,
        userId: f.user,
        sourceSystemId: 'xero',
        externalEntryId: lateEntryId,
        externalAccountCode: '600',
        transactionDate: '2026-09-25',
        currency: 'AUD',
        amountMinorUnits: '250',
        sourcePayloadHash: 'dddddddddddddddddddddddddddddddd',
        sourceLineageId: `late-batch-${lateEntryId}`,
      })).rejects.toThrow(/test stale event failure/);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS trg_test_reject_finance_reconciliation_stale_event
         ON commercial_finance_reconciliation_events`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS test_reject_finance_reconciliation_stale_event()`,
      );
    }

    const imported = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count
       FROM commercial_external_gl_entries
       WHERE organisation_id=$1
         AND source_system_id='xero'
         AND external_entry_id=$2`,
      f.org,
      lateEntryId,
    );
    expect(imported[0].count.toString()).toBe('0');

    const reconciliation = await prisma.$queryRawUnsafe<{
      status: string;
      close_id: string | null;
    }[]>(
      `SELECT status,close_id
       FROM commercial_finance_reconciliations
       WHERE id=$1::uuid AND organisation_id=$2`,
      prepared.id,
      f.org,
    );
    expect(reconciliation[0]).toEqual({
      status: 'SIGNED_OFF',
      close_id: close.id,
    });

    const closeState = await prisma.$queryRawUnsafe<{
      status: string;
      reconciliation_status: string;
    }[]>(
      `SELECT status,reconciliation_status
       FROM commercial_financial_period_closes
       WHERE id=$1::uuid AND organisation_id=$2`,
      close.id,
      f.org,
    );
    expect(closeState[0]).toEqual({
      status: 'CLOSED',
      reconciliation_status: 'SIGNED_OFF',
    });

    const events = await prisma.$queryRawUnsafe<{ event_type: string }[]>(
      `SELECT event_type
       FROM commercial_finance_reconciliation_events
       WHERE reconciliation_id=$1::uuid AND organisation_id=$2
       ORDER BY event_at,id`,
      prepared.id,
      f.org,
    );
    expect(events.map(event => event.event_type)).toEqual([
      'PREPARED', 'REVIEWED', 'SIGNED_OFF',
    ]);
  });

  it('stales on changed external identity while preserving the original immutable GL fact', async () => {
    const f = await seedFixture();
    await addMapping(f);
    const existingEntryId = await addEntry(f, 1000);
    const prepared = await prepare(f);
    await signOffPeriod(f, prepared.id);

    const before = await prisma.$queryRawUnsafe<{
      amount_minor_units: bigint;
      source_payload_hash: string;
      source_lineage_id: string;
    }[]>(
      `SELECT amount_minor_units,source_payload_hash,source_lineage_id
       FROM commercial_external_gl_entries
       WHERE organisation_id=$1
         AND source_system_id='xero'
         AND external_entry_id=$2`,
      f.org, `entry-${existingEntryId}`,
    );

    await expect(importExternalGlEntry({
      organisationId: f.org,
      userId: f.user,
      sourceSystemId: 'xero',
      externalEntryId: `entry-${existingEntryId}`,
      externalAccountCode: '600',
      transactionDate: '2026-09-20',
      currency: 'AUD',
      amountMinorUnits: '1250',
      sourcePayloadHash: 'cccccccccccccccccccccccccccccccc',
      sourceLineageId: `changed-batch-${existingEntryId}`,
    })).rejects.toMatchObject({ code: 'EXTERNAL_IDENTITY_CONFLICT' });

    const after = await prisma.$queryRawUnsafe<{
      amount_minor_units: bigint;
      source_payload_hash: string;
      source_lineage_id: string;
    }[]>(
      `SELECT amount_minor_units,source_payload_hash,source_lineage_id
       FROM commercial_external_gl_entries
       WHERE organisation_id=$1
         AND source_system_id='xero'
         AND external_entry_id=$2`,
      f.org, `entry-${existingEntryId}`,
    );
    expect(after[0].amount_minor_units.toString()).toBe(before[0].amount_minor_units.toString());
    expect(after[0].source_payload_hash).toBe(before[0].source_payload_hash);
    expect(after[0].source_lineage_id).toBe(before[0].source_lineage_id);

    const reconciliation = await prisma.$queryRawUnsafe<{ status: string }[]>(
      `SELECT status
       FROM commercial_finance_reconciliations
       WHERE id=$1::uuid AND organisation_id=$2`,
      prepared.id, f.org,
    );
    expect(reconciliation[0].status).toBe('STALE');

    const staleEvent = await prisma.$queryRawUnsafe<{ details: { cause?: string } }[]>(
      `SELECT details
       FROM commercial_finance_reconciliation_events
       WHERE reconciliation_id=$1::uuid
         AND organisation_id=$2
         AND event_type='STALE'
       ORDER BY event_at DESC,id DESC
       LIMIT 1`,
      prepared.id, f.org,
    );
    expect(staleEvent[0].details).toMatchObject({
      cause: 'EXTERNAL_GL_CHANGED_IDENTITY',
    });
  });
});