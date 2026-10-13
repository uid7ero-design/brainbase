import { isFinanceAuditTimestamp, isFinanceCalendarDate } from './financeSetupDisplay';

type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string';
const identity = (value: unknown) => text(value) && (value as string).trim() !== '';
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
// Legacy consumption deliberately retains its existing numeric wire contract.
const numericCents = (value: unknown) => Number.isSafeInteger(value);
const exactCents = (value: unknown) => typeof value === 'string' && /^-?(0|[1-9]\d*)$/.test(value);
const currency = (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const nullable = (check: (value: unknown) => boolean) => (value: unknown) => value === null || check(value);
const fields = (row: Row, names: string[], check: (value: unknown) => boolean) => names.every(name => check(row[name]));
const oneOf = (values: unknown[]) => (value: unknown) => values.includes(value);
const basis = oneOf(['EXCLUSIVE', 'INCLUSIVE']);
const mode = oneOf(['ANNUAL_ONLY', 'PERIODISED']);
const outcomes = oneOf(['VARIANCE', 'UNMAPPED_BRAINBASE_ACCOUNT', 'UNMAPPED_EXTERNAL_GL_ACCOUNT', 'UNMAPPED_COST_CENTRE', 'MISSING_EXTERNAL_ENTRY', 'EXTERNAL_ONLY_ENTRY']);

function consumption(value: unknown): boolean {
  return object(value)
    && fields(value, ['budgetId', 'budgetVersionId', 'budgetAccountId', 'costCentreId', 'financialYearId'], identity)
    && fields(value, ['budgetAccountCode', 'budgetAccountName', 'financialYearName'], text)
    && fields(value, ['costCentreCode', 'costCentreName', 'financialPeriodId', 'financialPeriodName'], nullable(text))
    && currency(value.currency) && basis(value.taxBasis) && mode(value.periodisationMode)
    && fields(value, ['annualBudgetCents', 'budgetCents', 'actualCents', 'committedCents', 'exposureCents', 'budgetLessActualCents', 'budgetLessActualAndCommittedCents'], numericCents)
    && nullable(numericCents)(value.periodBudgetCents)
    && fields(value, ['actualLineCount', 'commitmentCount'], count);
}
function finance(value: unknown, source: string | null): boolean {
  return object(value)
    && fields(value, ['budgetAccountId', 'financialYearId', 'financialPeriodId'], identity)
    && fields(value, ['budgetAccountCode', 'budgetAccountName', 'financialYearName', 'financialPeriodName'], text)
    && fields(value, ['budgetId', 'budgetVersionId', 'reconciliationId', 'sourceSystemId'], nullable(identity))
    && currency(value.currency) && nullable(basis)(value.taxBasis) && nullable(mode)(value.periodisationMode)
    && fields(value, ['budgetCents', 'sourceActualCents', 'financeAdjustmentCents', 'effectiveActualCents', 'committedCents', 'exposureCents'], exactCents)
    && fields(value, ['externalGlActualCents', 'reconciliationVarianceCents'], nullable(exactCents))
    && oneOf([null, 'SIGNED_OFF', 'STALE'])(value.reconciliationStatus)
    && (value.sourceSystemId === null || (source !== null && value.sourceSystemId === source));
}
function exception(value: unknown): boolean {
  if (!object(value) || !object(value.exception)) return false;
  const row = value.exception;
  if (!currency(row.currency) || !fields(row, ['financialYearId', 'financialPeriodId', 'effectiveCostCentreId'], nullable(text))) return false;
  if (value.source === 'COMMITMENT') return fields(row, ['code', 'purchaseOrderId', 'purchaseOrderLineId'], identity)
    && fields(row, ['outstandingSubtotalCents', 'outstandingTotalCents'], numericCents) && nullable(numericCents)(row.committedCents);
  return value.source === 'ACTUAL' && Array.isArray(row.codes) && row.codes.every(identity)
    && fields(row, ['supplierBillLineId', 'supplierBillId', 'sourcePurchaseOrderId', 'sourcePurchaseOrderLineId'], identity)
    && fields(row, ['supplierBillNumber', 'financialPeriodName', 'billDateFinancialPeriodId', 'billDateFinancialPeriodName'], nullable(text))
    && fields(row, ['sourceSubtotalCents', 'sourceTotalCents'], numericCents) && nullable(numericCents)(row.actualCents)
    && nullable(isFinanceCalendarDate)(row.billDate) && oneOf([null, 'OPEN', 'CLOSED'])(row.billDateFinancialPeriodStatus);
}

export function validBudgetReport(value: unknown, source: string | null): boolean {
  return object(value) && Array.isArray(value.rows) && value.rows.every(consumption)
    && Array.isArray(value.financeRows) && value.financeRows.every(row => finance(row, source))
    && Array.isArray(value.exceptions) && value.exceptions.every(exception)
    && fields(value, ['resolvedActualCount', 'resolvedCommitmentCount', 'unresolvedExceptionCount'], count);
}

function queueItem(value: unknown, parent: Row): boolean {
  return object(value) && identity(value.id) && value.currency === parent.currency
    && fields(value, ['budgetAccountId', 'budgetAccountCode', 'budgetAccountName', 'externalGlAccountCode', 'costCentreId', 'costCentreCode', 'costCentreName', 'externalCostCentreCode'], nullable(text))
    && fields(value, ['sourceActualCents', 'financeAdjustmentCents', 'brainbaseEffectiveActualCents', 'externalGlCents', 'varianceCents'], exactCents)
    && fields(value, ['sourceActualCount', 'externalEntryCount'], count) && outcomes(value.outcome);
}
export function validFinanceQueue(value: unknown, source: string | null): boolean {
  return Array.isArray(value) && value.every(entry => object(entry)
    && fields(entry, ['id', 'financialYearId', 'financialPeriodId', 'sourceSystemId'], identity)
    && fields(entry, ['financialYearName', 'financialPeriodName'], text) && currency(entry.currency)
    && (!source || entry.sourceSystemId === source)
    && oneOf(['PREPARED', 'REVIEWED', 'SIGNED_OFF', 'STALE'])(entry.status)
    && nullable(identity)(entry.closeId) && nullable(text)(entry.notes)
    && fields(entry, ['sourceActualCents', 'financeAdjustmentCents', 'brainbaseEffectiveActualCents', 'externalGlTotalCents', 'varianceCents'], exactCents)
    && count(entry.unresolvedItemCount) && isFinanceAuditTimestamp(entry.snapshotAt) && isFinanceAuditTimestamp(entry.preparedAt)
    && nullable(isFinanceAuditTimestamp)(entry.reviewedAt)
    && Array.isArray(entry.items) && entry.items.every(item => queueItem(item, entry)));
}


export function validFinanceSources(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(source => typeof source === 'string' && source !== '' && source.trim() === source) && new Set(value).size === value.length;
}
