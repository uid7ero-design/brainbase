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

export type BudgetExportView = keyof typeof BUDGET_EXPORT_CONTROLS;
