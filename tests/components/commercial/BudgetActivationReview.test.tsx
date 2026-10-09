import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import BudgetActivationReview from '@/app/commercial/budgeting/setup/BudgetActivationReview';

afterEach(cleanup);
const reference = { budget_account_id: 'account', cost_centre_id: 'centre' };
const base = {
  financialYearStatus: 'OPEN', periodised: true,
  lines: [{ ...reference, id: 'line', annual_budget_cents: '10000' }],
  mappings: [reference],
  allocations: [{ budget_line_id: 'line', financial_period_id: 'period', amount_cents: '10000' }],
  periods: [{ id: 'period' }], accounts: [{ id: 'account', active: true }], centres: [{ id: 'centre', active: true }],
};

describe('Draft activation guidance', () => {
  it('explains empty draft requirements without describing it as ready', () => {
    render(<BudgetActivationReview {...base} lines={[]} mappings={[]} allocations={[]}/>);
    expect(screen.getByText('Add at least one Budget line.')).toBeVisible();
    expect(screen.getByText(/Add a commitment mapping and check/)).toBeVisible();
    expect(screen.queryByText('No setup issues found in the loaded draft.')).not.toBeInTheDocument();
  });
  it('identifies the missing mapping even when every amount is balanced', () => {
    render(<BudgetActivationReview {...base} mappings={[]}/>);
    expect(screen.getByRole('region', { name: 'Draft activation checks' })).toHaveTextContent('Commitment mappings:');
    expect(screen.queryByText(/line needs allocation changes/)).not.toBeInTheDocument();
  });
  it('does not guarantee activation from a balanced loaded snapshot', () => {
    render(<BudgetActivationReview {...base}/>);
    expect(screen.getByText('No setup issues found in the loaded draft.')).toBeVisible();
    expect(screen.getByText(/server checks the latest records/)).toBeVisible();
    expect(screen.getByText(/Confirm the tax basis and commitment mappings/)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it.each(['CLOSED', undefined])('warns about a closed or missing financial year %s', status => {
    render(<BudgetActivationReview {...base} financialYearStatus={status}/>);
    expect(screen.getByText('The Budget financial year must be open before activation.')).toBeVisible();
  });
  it('finds inactive mapping references even when line references are active', () => {
    render(<BudgetActivationReview {...base} mappings={[{ ...reference, budget_account_id: 'inactive' }]} accounts={[...base.accounts, { id: 'inactive', active: false }]}/>);
    expect(screen.getByText(/Reactivate or correct/)).toBeVisible();
  });
  it('keeps offsetting line imbalances visible with exact large values', () => {
    render(<BudgetActivationReview {...base} lines={[{ ...reference, id: 'a', annual_budget_cents: '9223372036854775807' }, { ...reference, id: 'b', annual_budget_cents: '10000' }]} allocations={[{ budget_line_id: 'a', financial_period_id: 'period', amount_cents: '9223372036854775806' }, { budget_line_id: 'b', financial_period_id: 'period', amount_cents: '10001' }]}/>);
    expect(screen.getByText(/2 lines need allocation changes/)).toBeVisible();
  });
  it('rejects an unavailable period despite matching allocation totals', () => {
    render(<BudgetActivationReview {...base} periods={[]}/>);
    expect(screen.getByText('Correct allocations that do not belong to a saved line and this financial year.')).toBeVisible();
  });
  it('checks annual-only allocation shape without requiring a period calendar', () => {
    const { rerender } = render(<BudgetActivationReview {...base} periodised={false} periods={[]}/>);
    expect(screen.getByText('Annual-only Budgets must not contain period allocations.')).toBeVisible();
    rerender(<BudgetActivationReview {...base} periodised={false} allocations={[]} periods={[]}/>);
    expect(within(screen.getByRole('region', { name: 'Draft activation checks' })).getByText('No setup issues found in the loaded draft.')).toBeVisible();
  });
  it('links to the mapping editor when a target is provided', () => {
    render(<BudgetActivationReview {...base} mappings={[]} mappingFormId="budget-commitment-mapping"/>);
    expect(screen.getByRole('link', { name: 'Review commitment mappings' })).toHaveAttribute('href', '#budget-commitment-mapping');
  });
});
