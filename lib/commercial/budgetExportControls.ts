export const BUDGET_EXPORT_CONTROLS = {
  legacy: {
    key: 'legacy',
    label: 'Download legacy CSV',
    href: '/api/commercial/budgeting/consumption/export?view=legacy',
    filename: 'brainbase-budget-consumption.csv',
  },
  finance: {
    key: 'finance',
    label: 'Download finance CSV',
    href: '/api/commercial/budgeting/consumption/export?view=finance',
    filename: 'brainbase-budget-finance.csv',
  },
} as const;

export function budgetFinanceExportHref(sourceSystemId?: string | null) {
  const clean = sourceSystemId?.trim();
  return clean
    ? `${BUDGET_EXPORT_CONTROLS.finance.href}&sourceSystemId=${encodeURIComponent(clean)}`
    : BUDGET_EXPORT_CONTROLS.finance.href;
}

export type BudgetExportView = keyof typeof BUDGET_EXPORT_CONTROLS;
