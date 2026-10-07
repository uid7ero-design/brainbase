import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

const {
  derivePurchaseOrderCommitment,
  derivePurchaseCommitmentReport,
  getPurchaseCommitmentReport,
} = await import('@/lib/commercial/purchasingCommitments');

import type { RawPurchaseCommitmentRow } from '@/lib/commercial/purchasingCommitments';

const row = (overrides: Partial<RawPurchaseCommitmentRow> = {}): RawPurchaseCommitmentRow => ({
  purchase_order_id: 'po-1',
  purchase_order_status: 'ISSUED',
  supplier_id: 'supplier-1',
  currency: 'AUD',
  issued_at: '2026-09-25T00:00:00.000Z',
  purchase_order_cost_centre_id: 'cc-1',
  line_id: 'line-1',
  position: 1,
  description_snapshot: 'Services',
  line_cost_centre_id: null,
  ordered_subtotal_cents: 10000,
  ordered_tax_cents: 1000,
  ordered_total_cents: 11000,
  billed_subtotal_cents: '0',
  billed_tax_cents: '0',
  billed_total_cents: '0',
  ...overrides,
});

beforeEach(() => {
  sqlMock.mockReset();
});
describe('Phase C7.6E — governed financial-period attribution', () => {
  it('resolves exactly one same-tenant period and carries its year/status metadata', () => {
    const result = derivePurchaseOrderCommitment([row({
      period_match_count: 1,
      financial_period_id: 'period-1',
      financial_period_name: 'September 2026',
      financial_period_status: 'CLOSED',
      financial_year_id: 'fy-1',
      financial_year_name: 'FY2026-27',
    })]);

    expect(result).toMatchObject({
      commitmentEffectiveAt: '2026-09-25T00:00:00.000Z',
      periodResolution: 'RESOLVED',
      financialPeriodId: 'period-1',
      financialPeriodName: 'September 2026',
      financialPeriodStatus: 'CLOSED',
      financialYearId: 'fy-1',
      financialYearName: 'FY2026-27',
    });
  });

  it('keeps zero matches UNRESOLVED with no invented period metadata', () => {
    const result = derivePurchaseOrderCommitment([row({ period_match_count: 0 })]);
    expect(result).toMatchObject({
      periodResolution: 'UNRESOLVED',
      financialPeriodId: null,
      financialPeriodName: null,
      financialPeriodStatus: null,
      financialYearId: null,
      financialYearName: null,
    });
  });

  it('surfaces overlapping matches as AMBIGUOUS and refuses to expose an arbitrary winner', () => {
    const result = derivePurchaseOrderCommitment([row({
      period_match_count: 2,
      financial_period_id: 'arbitrary-period',
      financial_period_name: 'Must not leak',
      financial_period_status: 'OPEN',
      financial_year_id: 'arbitrary-year',
      financial_year_name: 'Must not leak',
    })]);

    expect(result).toMatchObject({
      periodResolution: 'AMBIGUOUS',
      financialPeriodId: null,
      financialPeriodName: null,
      financialPeriodStatus: null,
      financialYearId: null,
      financialYearName: null,
    });
  });

  it('reports aggregate resolution only when every PO resolves, and AMBIGUOUS wins fail-loud', () => {
    const resolved = row({
      period_match_count: 1,
      financial_period_id: 'period-1',
      financial_period_name: 'P1',
      financial_period_status: 'OPEN',
      financial_year_id: 'fy-1',
      financial_year_name: 'FY',
    });
    const unresolved = row({ purchase_order_id: 'po-2', line_id: 'line-2', period_match_count: 0 });
    const ambiguous = row({ purchase_order_id: 'po-3', line_id: 'line-3', period_match_count: 2 });

    expect(derivePurchaseCommitmentReport([resolved])).toMatchObject({
      periodResolution: 'RESOLVED',
      resolvedPurchaseOrderCount: 1,
      unresolvedPurchaseOrderCount: 0,
      ambiguousPurchaseOrderCount: 0,
    });
    expect(derivePurchaseCommitmentReport([resolved, unresolved])).toMatchObject({
      periodResolution: 'UNRESOLVED',
      resolvedPurchaseOrderCount: 1,
      unresolvedPurchaseOrderCount: 1,
      ambiguousPurchaseOrderCount: 0,
    });
    expect(derivePurchaseCommitmentReport([resolved, ambiguous])).toMatchObject({
      periodResolution: 'AMBIGUOUS',
      resolvedPurchaseOrderCount: 1,
      unresolvedPurchaseOrderCount: 0,
      ambiguousPurchaseOrderCount: 1,
    });
  });
});
describe('Phase C7.6E — period attribution SQL governance', () => {
  it('uses issued_at calendar date, inclusive boundaries, and tenant-scoped period/year joins only', async () => {
    sqlMock.mockResolvedValueOnce([row()]);
    await getPurchaseCommitmentReport('org-a');

    const strings = sqlMock.mock.calls[0][0] as string[];
    const query = strings.join('');

    expect(query).toMatch(/commercial_financial_periods cfp/);
    expect(query).toMatch(/commercial_financial_years cfy/);
    expect(query).toMatch(/cfy\.organisation_id = cfp\.organisation_id/);
    expect(query).toMatch(/cfp\.organisation_id = cpo\.organisation_id/);
    expect(query).toMatch(/cpo\.issued_at::date BETWEEN cfp\.starts_on AND cfp\.ends_on/);
    expect(query).toMatch(/COUNT\(\*\)::int AS period_match_count/);
    expect(query).toMatch(/CASE WHEN COUNT\(\*\) = 1/);
    expect(query).not.toMatch(/delivery_date|invoice_date|service_period/i);
    expect(query).not.toMatch(/financial_models/);
  });

  it('does not add period lookup to the purchasing-local commitment reader', async () => {
    const { getPurchaseOrderCommitment } = await import('@/lib/commercial/purchasingCommitments');
    sqlMock.mockResolvedValueOnce([row()]);
    await getPurchaseOrderCommitment('org-a', 'po-1');

    const strings = sqlMock.mock.calls[0][0] as string[];
    const query = strings.join('');
    expect(query).not.toMatch(/commercial_financial_periods|commercial_financial_years/);
  });
});
