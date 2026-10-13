import { buildCsv } from '@/lib/events/csvExport';
import { budgetCentsToAmount, formatAustralianDate } from './financeSetupDisplay';
import { reviewBudgetAllocations } from './budgetAllocationReview';

export type BudgetSetupExportInput = {
  version: {
    name: string; currency: string; tax_basis: string; periodisation_mode: string; version_number: number; status: string;
    lines: { id: string; budget_account_id: string; cost_centre_id: string; annual_budget_cents: string }[];
    allocations: { budget_line_id: string; financial_period_id: string; amount_cents: string }[];
    mappings: { budget_account_id: string; cost_centre_id: string }[];
  };
  year?: { name: string; periods: { id: string; name: string; starts_on?: string; ends_on?: string }[] };
  accounts: { id: string; code: string; active: boolean }[];
  centres: { id: string; code: string; active: boolean }[];
};
export type BudgetSetupExportKind = 'lines' | 'allocations' | 'mappings';

// Match Commercial exports: protect text with whitespace before formula prefixes.
const text = (value: string) => /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;

export function buildBudgetSetupCsv(input: BudgetSetupExportInput, kind: BudgetSetupExportKind): string {
  const { version } = input;
  const accounts = new Map(input.accounts.map(row => [row.id, row]));
  const centres = new Map(input.centres.map(row => [row.id, row]));
  const account = (id: string) => text(accounts.get(id)?.code ?? 'Unavailable account');
  const centre = (id: string) => text(centres.get(id)?.code ?? 'Unavailable cost centre');
  const commonHeader = ['Budget', 'Financial year', 'Version', 'Status', 'Currency', 'Tax basis', 'Periodisation'];
  const common = [text(version.name), text(input.year?.name ?? 'Unavailable year'), String(version.version_number), version.status, version.currency, version.tax_basis, version.periodisation_mode];
  if (kind === 'lines') {
    const review = reviewBudgetAllocations(version.lines, version.allocations);
    return buildCsv([...commonHeader, 'Account', 'Cost centre', 'Annual amount', 'Allocated amount', 'Allocation check'], version.lines.map((line, index) => {
      const checked = review.lines[index];
      const periodised = version.periodisation_mode === 'PERIODISED';
      const check = !periodised ? 'Not applicable' : checked.state === 'BALANCED' ? 'Balanced'
        : checked.state === 'UNDER' ? `${budgetCentsToAmount(checked.differenceCents)} left to allocate`
          : `${budgetCentsToAmount((-BigInt(checked.differenceCents)).toString())} over allocated`;
      return [...common, account(line.budget_account_id), centre(line.cost_centre_id), budgetCentsToAmount(line.annual_budget_cents), periodised ? budgetCentsToAmount(checked.allocatedCents) : '', check];
    }));
  }
  if (kind === 'mappings') {
    return buildCsv([...commonHeader, 'Cost centre', 'Account', 'Cost centre status', 'Account status'], version.mappings.map(row => [
      ...common, centre(row.cost_centre_id), account(row.budget_account_id),
      !centres.has(row.cost_centre_id) ? 'Unavailable' : centres.get(row.cost_centre_id)?.active ? 'Active' : 'Inactive',
      !accounts.has(row.budget_account_id) ? 'Unavailable' : accounts.get(row.budget_account_id)?.active ? 'Active' : 'Inactive',
    ]));
  }
  const periods = new Map(input.year?.periods.map(row => [row.id, row]) ?? []);
  const periodOrder = new Map(input.year?.periods.map((row, index) => [row.id, index]) ?? []);
  const lines = new Map(version.lines.map(row => [row.id, row]));
  const lineOrder = new Map(version.lines.map((row, index) => [row.id, index]));
  const allocations = [...version.allocations].sort((a, b) =>
    (lineOrder.get(a.budget_line_id) ?? version.lines.length) - (lineOrder.get(b.budget_line_id) ?? version.lines.length)
    || (periodOrder.get(a.financial_period_id) ?? periods.size) - (periodOrder.get(b.financial_period_id) ?? periods.size));
  return buildCsv([...commonHeader, 'Account', 'Cost centre', 'Period', 'Period start (DD/MM/YYYY)', 'Period end (DD/MM/YYYY)', 'Amount'], allocations.map(row => {
    const line = lines.get(row.budget_line_id), period = periods.get(row.financial_period_id);
    return [...common, line ? account(line.budget_account_id) : 'Unavailable line', line ? centre(line.cost_centre_id) : 'Unavailable line',
      text(period?.name ?? 'Unavailable period'), period?.starts_on ? formatAustralianDate(period.starts_on) : '', period?.ends_on ? formatAustralianDate(period.ends_on) : '', budgetCentsToAmount(row.amount_cents)];
  }));
}
