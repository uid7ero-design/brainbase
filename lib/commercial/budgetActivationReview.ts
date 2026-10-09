import { reviewBudgetAllocations } from './budgetAllocationReview';

type Reference = { budget_account_id: string; cost_centre_id: string };
type Input = {
  financialYearStatus?: string;
  periodised: boolean;
  lines: (Reference & { id: string; annual_budget_cents: string })[];
  mappings: Reference[];
  allocations: { budget_line_id: string; financial_period_id: string; amount_cents: string }[];
  periods: { id: string }[];
  accounts: { id: string; active: boolean }[];
  centres: { id: string; active: boolean }[];
};

// Guidance from the loaded setup snapshot. Activation still validates current
// tenant-scoped records on the server, including changes made by another user.
export function reviewBudgetActivation(input: Input) {
  const accounts = new Set(input.accounts.filter(row => row.active).map(row => row.id));
  const centres = new Set(input.centres.filter(row => row.active).map(row => row.id));
  const lines = new Set(input.lines.map(row => row.id));
  const periods = new Set(input.periods.map(row => row.id));
  const invalidReferences = [...input.lines, ...input.mappings].some(row => !accounts.has(row.budget_account_id) || !centres.has(row.cost_centre_id));
  const invalidPeriods = input.allocations.some(row => !lines.has(row.budget_line_id) || !periods.has(row.financial_period_id));
  const unbalanced = input.periodised ? reviewBudgetAllocations(input.lines, input.allocations).unbalancedLines : 0;
  return [
    { label: 'Financial year', issue: input.financialYearStatus === 'OPEN' ? null : 'The Budget financial year must be open before activation.' },
    { label: 'Budget lines', issue: input.lines.length ? null : 'Add at least one Budget line.' },
    { label: 'Commitment mappings', issue: input.mappings.length ? null : 'Add a commitment mapping and check that it routes costs to the intended account.' },
    { label: 'Accounts and cost centres', issue: invalidReferences ? 'Reactivate or correct the inactive or unavailable accounts and cost centres used by this draft.' : null },
    { label: 'Period allocations', issue: input.periodised
      ? unbalanced ? `${unbalanced} ${unbalanced === 1 ? 'line needs' : 'lines need'} allocation changes. Use the Budget review to resolve each shortage or excess.` : invalidPeriods ? 'Correct allocations that do not belong to a saved line and this financial year.' : null
      : input.allocations.length ? 'Annual-only Budgets must not contain period allocations.' : null },
  ];
}
