export type CommitmentResolution = 'RESOLVED' | 'UNRESOLVED' | 'AMBIGUOUS';

export type CommitmentFilterLine = {
  purchaseOrderLineId: string;
  effectiveCostCentreId: string | null;
  effectiveCostCentreCode: string | null;
  effectiveCostCentreName: string | null;
  orderedTotalCents: number;
  billedTotalCents: number;
  outstandingTotalCents: number;
};

export type CommitmentFilterPurchaseOrder = {
  purchaseOrderId: string;
  supplierId: string;
  supplierName: string | null;
  currency: string;
  periodResolution: CommitmentResolution;
  financialYearId: string | null;
  financialYearName: string | null;
  financialPeriodId: string | null;
  financialPeriodName: string | null;
  financialPeriodStatus: 'OPEN' | 'CLOSED' | null;
  commitmentEffectiveAt: string | null;
  lines: CommitmentFilterLine[];
};

export type CommitmentFilters = {
  financialYearId: string;
  financialPeriodId: string;
  costCentreId: string;
  supplierId: string;
  currency: string;
  resolution: 'ALL' | CommitmentResolution;
};

export type FilteredCommitmentRow = CommitmentFilterPurchaseOrder & {
  visibleLines: CommitmentFilterLine[];
  orderedTotalCents: number;
  billedTotalCents: number;
  outstandingTotalCents: number;
};

export function applyCommitmentFilters(
  purchaseOrders: CommitmentFilterPurchaseOrder[],
  filters: CommitmentFilters,
): FilteredCommitmentRow[] {
  return purchaseOrders.flatMap((po) => {
    if (filters.financialYearId !== 'ALL' && po.financialYearId !== filters.financialYearId) return [];
    if (filters.financialPeriodId !== 'ALL' && po.financialPeriodId !== filters.financialPeriodId) return [];
    if (filters.supplierId !== 'ALL' && po.supplierId !== filters.supplierId) return [];
    if (filters.currency !== 'ALL' && po.currency !== filters.currency) return [];
    if (filters.resolution !== 'ALL' && po.periodResolution !== filters.resolution) return [];

    const visibleLines = filters.costCentreId === 'ALL'
      ? po.lines
      : po.lines.filter(line => line.effectiveCostCentreId === filters.costCentreId);
    if (visibleLines.length === 0) return [];

    return [{
      ...po,
      visibleLines,
      orderedTotalCents: visibleLines.reduce((sum, line) => sum + line.orderedTotalCents, 0),
      billedTotalCents: visibleLines.reduce((sum, line) => sum + line.billedTotalCents, 0),
      outstandingTotalCents: visibleLines.reduce((sum, line) => sum + line.outstandingTotalCents, 0),
    }];
  });
}

export function summarizeFilteredCommitments(rows: FilteredCommitmentRow[]) {
  const currencies = new Map<string, { orderedTotalCents: number; billedTotalCents: number; outstandingTotalCents: number }>();
  for (const row of rows) {
    const current = currencies.get(row.currency) ?? { orderedTotalCents: 0, billedTotalCents: 0, outstandingTotalCents: 0 };
    current.orderedTotalCents += row.orderedTotalCents;
    current.billedTotalCents += row.billedTotalCents;
    current.outstandingTotalCents += row.outstandingTotalCents;
    currencies.set(row.currency, current);
  }
  return [...currencies.entries()]
    .map(([currency, totals]) => ({ currency, ...totals }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
