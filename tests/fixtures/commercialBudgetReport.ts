export const consumptionRow = {
  budgetId: 'budget', budgetVersionId: 'version', budgetAccountId: 'account', budgetAccountCode: 'SOFTWARE', budgetAccountName: 'Software',
  costCentreId: 'centre', costCentreCode: 'GENERAL', costCentreName: 'General', financialYearId: 'year', financialYearName: 'FY27',
  financialPeriodId: 'period', financialPeriodName: 'QTR 1', currency: 'AUD', taxBasis: 'EXCLUSIVE', periodisationMode: 'PERIODISED',
  annualBudgetCents: 10000, periodBudgetCents: 10000, budgetCents: 10000, actualCents: 0, committedCents: 0, exposureCents: 0,
  budgetLessActualCents: 10000, budgetLessActualAndCommittedCents: 10000, actualLineCount: 0, commitmentCount: 0,
};
export const financeRow = {
  budgetId: 'budget', budgetVersionId: 'version', budgetAccountId: 'account', budgetAccountCode: 'SOFTWARE', budgetAccountName: 'Software',
  financialYearId: 'year', financialYearName: 'FY27', financialPeriodId: 'period', financialPeriodName: 'QTR 1', currency: 'AUD',
  taxBasis: 'EXCLUSIVE', periodisationMode: 'PERIODISED', budgetCents: '10000', sourceActualCents: '0', financeAdjustmentCents: '0',
  effectiveActualCents: '0', committedCents: '0', exposureCents: '0', externalGlActualCents: null, reconciliationVarianceCents: null,
  reconciliationId: null, reconciliationStatus: null, sourceSystemId: null,
};
export const commitmentException = { source: 'COMMITMENT', exception: {
  code: 'UNRESOLVED', purchaseOrderId: 'po', purchaseOrderLineId: 'line', currency: 'AUD', financialYearId: null,
  financialPeriodId: null, effectiveCostCentreId: null, outstandingSubtotalCents: 100, outstandingTotalCents: 110, committedCents: null,
} };
export const actualException = { source: 'ACTUAL', exception: {
  codes: ['UNRESOLVED'], supplierBillLineId: 'bill-line', supplierBillId: 'bill', supplierBillNumber: null,
  sourcePurchaseOrderId: 'po', sourcePurchaseOrderLineId: 'line', currency: 'AUD', financialYearId: null, financialPeriodId: null,
  financialPeriodName: null, effectiveCostCentreId: null, sourceSubtotalCents: 100, sourceTotalCents: 110, actualCents: null,
  billDate: '2026-07-04', billDateFinancialPeriodId: null, billDateFinancialPeriodName: null, billDateFinancialPeriodStatus: null,
} };
export const queueItem = {
  id: 'item', budgetAccountId: null, budgetAccountCode: null, budgetAccountName: null, externalGlAccountCode: '600', costCentreId: null,
  costCentreCode: null, costCentreName: null, externalCostCentreCode: null, currency: 'AUD', sourceActualCents: '900719925474099312',
  financeAdjustmentCents: '0', brainbaseEffectiveActualCents: '900719925474099312', externalGlCents: '0', varianceCents: '900719925474099312',
  sourceActualCount: 1, externalEntryCount: 0, outcome: 'MISSING_EXTERNAL_ENTRY',
};
export const queueEntry = {
  id: 'recon', financialYearId: 'year', financialYearName: 'FY27', financialPeriodId: 'period', financialPeriodName: 'QTR 1',
  sourceSystemId: 'XERO', currency: 'AUD', status: 'PREPARED', closeId: null, sourceActualCents: '900719925474099312',
  financeAdjustmentCents: '0', brainbaseEffectiveActualCents: '900719925474099312', externalGlTotalCents: '0', varianceCents: '900719925474099312',
  unresolvedItemCount: 1, snapshotAt: '2026-07-04T00:00:00Z', preparedAt: '2026-07-04T00:00:00Z', reviewedAt: null, notes: null,
  items: [queueItem],
};
export const completeReport = { rows: [consumptionRow], financeRows: [financeRow], exceptions: [commitmentException, actualException], resolvedActualCount: 0, resolvedCommitmentCount: 0, unresolvedExceptionCount: 2 };
