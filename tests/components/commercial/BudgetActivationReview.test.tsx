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
  it('offers corrective navigation only for current issues and removes it when resolved', () => {
    const { rerender } = render(<BudgetActivationReview {...base} setupNavigation financialYearStatus="CLOSED" lines={[]} allocations={[]} mappings={[{...reference, budget_account_id:'missing'}]}/>);
    expect(screen.getByRole('link', { name: 'Review financial year controls' })).toHaveAttribute('href', '/commercial/budgeting/finance-controls');
    expect(screen.getByRole('link', { name: 'Add Budget lines' })).toHaveAttribute('href', '#budget-line-setup');
    expect(screen.getByRole('link', { name: 'Review Budget accounts' })).toHaveAttribute('href', '#dimension-accounts');
    expect(screen.getByRole('link', { name: 'Review cost centres' })).toHaveAttribute('href', '#dimension-cost-centres');
    expect(screen.queryByRole('link', { name: 'Review allocation amounts' })).not.toBeInTheDocument();
    rerender(<BudgetActivationReview {...base} setupNavigation/>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('routes an allocation shortage to the per-line review', () => {
    render(<BudgetActivationReview {...base} setupNavigation allocations={[{...base.allocations[0],amount_cents:'9000'}]}/>);
    expect(screen.getByRole('link', { name: 'Review allocation amounts' })).toHaveAttribute('href', '#budget-allocation-review');
    expect(screen.queryByRole('link', { name: 'Add Budget lines' })).not.toBeInTheDocument();
  });
  it('does not advertise setup targets when the caller has not supplied the setup workflow', () => {
    render(<BudgetActivationReview {...base} financialYearStatus="CLOSED" lines={[]} accounts={[]}/>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
