import { describe, expect, it } from 'vitest';
import { applyCommitmentFilters, summarizeFilteredCommitments, type CommitmentFilterPurchaseOrder } from '@/lib/commercial/commitmentReportFilters';

const po = (overrides: Partial<CommitmentFilterPurchaseOrder> = {}): CommitmentFilterPurchaseOrder => ({
  purchaseOrderId: 'po-1',
  supplierId: 'sup-1',
  supplierName: 'Acme',
  currency: 'AUD',
  periodResolution: 'RESOLVED',
  financialYearId: 'fy-1',
  financialYearName: 'FY26',
  financialPeriodId: 'p-1',
  financialPeriodName: 'September',
  financialPeriodStatus: 'OPEN',
  commitmentEffectiveAt: '2026-09-25T00:00:00.000Z',
  lines: [
    { purchaseOrderLineId: 'l1', effectiveCostCentreId: 'cc-1', effectiveCostCentreCode: 'OPS', effectiveCostCentreName: 'Operations', orderedTotalCents: 10000, billedTotalCents: 2000, outstandingTotalCents: 8000 },
    { purchaseOrderLineId: 'l2', effectiveCostCentreId: 'cc-2', effectiveCostCentreCode: 'PARKS', effectiveCostCentreName: 'Parks', orderedTotalCents: 5000, billedTotalCents: 1000, outstandingTotalCents: 4000 },
  ],
  ...overrides,
});

const all = { financialYearId: 'ALL', financialPeriodId: 'ALL', costCentreId: 'ALL', supplierId: 'ALL', currency: 'ALL', resolution: 'ALL' as const };

describe('Phase C7.6F — Budget commitment filters', () => {
  it('filters by financial year, period, supplier, currency and resolution together', () => {
    const rows = [po(), po({ purchaseOrderId: 'po-2', supplierId: 'sup-2', currency: 'USD', periodResolution: 'UNRESOLVED', financialYearId: null, financialPeriodId: null })];
    expect(applyCommitmentFilters(rows, { ...all, financialYearId: 'fy-1', financialPeriodId: 'p-1', supplierId: 'sup-1', currency: 'AUD', resolution: 'RESOLVED' })).toHaveLength(1);
  });

  it('cost-centre filtering keeps only matching lines and recalculates PO totals from those lines', () => {
    const [filtered] = applyCommitmentFilters([po()], { ...all, costCentreId: 'cc-2' });
    expect(filtered.visibleLines.map(line => line.purchaseOrderLineId)).toEqual(['l2']);
    expect(filtered).toMatchObject({ orderedTotalCents: 5000, billedTotalCents: 1000, outstandingTotalCents: 4000 });
  });

  it('drops a PO when no line matches the selected cost centre', () => {
    expect(applyCommitmentFilters([po()], { ...all, costCentreId: 'cc-missing' })).toEqual([]);
  });

  it('keeps currencies separate when recalculating filtered totals', () => {
    const rows = applyCommitmentFilters([
      po(),
      po({ purchaseOrderId: 'po-2', currency: 'USD', lines: [{ purchaseOrderLineId: 'l3', effectiveCostCentreId: 'cc-1', effectiveCostCentreCode: 'OPS', effectiveCostCentreName: 'Operations', orderedTotalCents: 7000, billedTotalCents: 0, outstandingTotalCents: 7000 }] }),
    ], all);
    expect(summarizeFilteredCommitments(rows)).toEqual([
      { currency: 'AUD', orderedTotalCents: 15000, billedTotalCents: 3000, outstandingTotalCents: 12000 },
      { currency: 'USD', orderedTotalCents: 7000, billedTotalCents: 0, outstandingTotalCents: 7000 },
    ]);
  });
});
