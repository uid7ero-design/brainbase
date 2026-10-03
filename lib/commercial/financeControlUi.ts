export type FinanceReconciliationControlStatus =
  | 'PREPARED'
  | 'REVIEWED'
  | 'SIGNED_OFF'
  | 'STALE';

export function financePeriodCloseHref(periodId: string) {
  return `/api/commercial/budgeting/financial-periods/${encodeURIComponent(periodId)}/close`;
}

export function financePeriodReopenHref(periodId: string) {
  return `/api/commercial/budgeting/financial-periods/${encodeURIComponent(periodId)}/reopen`;
}

export function financeReconciliationReviewHref(reconciliationId: string) {
  return `/api/commercial/budgeting/reconciliations/${encodeURIComponent(reconciliationId)}/review`;
}

export function financeReconciliationSignOffHref(reconciliationId: string) {
  return `/api/commercial/budgeting/reconciliations/${encodeURIComponent(reconciliationId)}/sign-off`;
}

export function financeReconciliationAction(
  status: FinanceReconciliationControlStatus,
  hasActiveClose: boolean,
): 'REVIEW' | 'SIGN_OFF' | 'READ_ONLY' | 'SIGN_OFF_BLOCKED' {
  if (status === 'PREPARED') return 'REVIEW';
  if (status === 'REVIEWED') return hasActiveClose ? 'SIGN_OFF' : 'SIGN_OFF_BLOCKED';
  return 'READ_ONLY';
}
