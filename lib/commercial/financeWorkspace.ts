export const financePaths = {
  commercial: {
    expenses: '/commercial/purchasing/receipt-expenses',
    expenseApi: '/api/commercial/purchasing/receipt-expenses',
    unpaid: '/commercial/invoices/unpaid',
    back: '/commercial',
    backLabel: 'Back to Commercial',
  },
  tennis: {
    expenses: '/business/tennis/finance/expenses',
    expenseApi: '/api/business/tennis/expenses',
    unpaid: '/business/tennis/finance/unpaid',
    back: '/business/tennis/finance',
    backLabel: 'Back to LD Tennis finances',
  },
} as const;

export type FinanceWorkspace = keyof typeof financePaths;
