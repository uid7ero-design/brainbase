import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BudgetReview from '@/app/commercial/budgeting/setup/BudgetReview';

afterEach(cleanup);
const base = {
  currency: 'AUD', periodised: true, draft: true,
  accountCode: (id: string) => id, centreCode: (id: string) => id,
  lines: [{ id: 'a', budget_account_id: 'SOFTWARE', cost_centre_id: 'GENERAL', annual_budget_cents: '10000' }],
  periods: [{ id: 'q1', name: 'QTR 1' }, { id: 'q2', name: 'QTR 2' }],
};

describe('Budget review screen', () => {
  it('shows the exact shortage without suggesting the Budget is fully allocated', () => {
    render(<BudgetReview {...base} allocations={[{ budget_line_id: 'a', financial_period_id: 'q1', amount_cents: '9000' }]}/>);
    expect(screen.getByText('AUD 10.00 left to allocate')).toBeVisible();
    expect(screen.getByText(/1 line needs allocation changes/)).toBeVisible();
    expect(screen.queryByText(/All lines are fully allocated/)).not.toBeInTheDocument();
  });
  it('shows an excess in positive dollars and explains other checks remain when balanced', () => {
    const { rerender } = render(<BudgetReview {...base} allocations={[{ budget_line_id: 'a', financial_period_id: 'q1', amount_cents: '11000' }]}/>);
    expect(screen.getByText('AUD 10.00 over allocated')).toBeVisible();
    rerender(<BudgetReview {...base} allocations={[{ budget_line_id: 'a', financial_period_id: 'q1', amount_cents: '10000' }]}/>);
    expect(screen.getByText('Balanced')).toBeVisible();
    expect(screen.getByText('All lines are fully allocated. Check tax basis and commitment mappings before activation.')).toBeVisible();
  });
  it('orders saved allocations by the financial calendar rather than insertion order', () => {
    render(<BudgetReview {...base} allocations={[{ budget_line_id: 'a', financial_period_id: 'q2', amount_cents: '5000' }, { budget_line_id: 'a', financial_period_id: 'q1', amount_cents: '5000' }]}/>);
    const rows = within(screen.getByRole('table', { name: 'Period allocations' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('QTR 1');
    expect(rows[2]).toHaveTextContent('QTR 2');
  });
  it('keeps annual-only Budgets free of allocation warnings and period tables', () => {
    render(<BudgetReview {...base} periodised={false} allocations={[]}/>);
    expect(screen.getByText('AUD 100.00', { selector: 'dd' })).toBeVisible();
    expect(screen.queryByText('Allocated to periods')).not.toBeInTheDocument();
    expect(screen.queryByText(/allocation changes/)).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Period allocations' })).not.toBeInTheDocument();
  });
  it('does not call an empty draft fully allocated', () => {
    render(<BudgetReview {...base} lines={[]} allocations={[]}/>);
    expect(screen.getByText('No Budget lines yet.')).toBeVisible();
    expect(screen.getByText('No period allocations yet.')).toBeVisible();
    expect(screen.queryByText(/All lines are fully allocated/)).not.toBeInTheDocument();
  });
  it('does not prompt activation for an already active version', () => {
    render(<BudgetReview {...base} draft={false} allocations={[{ budget_line_id: 'a', financial_period_id: 'q1', amount_cents: '10000' }]}/>);
    expect(screen.getByText('All lines are fully allocated.')).toBeVisible();
    expect(screen.queryByText(/before activation/)).not.toBeInTheDocument();
  });
  it('edits the saved line identity only in an idle draft', () => {
    const onEditLine = vi.fn();
    const { rerender } = render(<BudgetReview {...base} allocations={[]} onEditLine={onEditLine}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit SOFTWARE / GENERAL' }));
    expect(onEditLine).toHaveBeenCalledWith('a');
    rerender(<BudgetReview {...base} allocations={[]} onEditLine={onEditLine} busy/>);
    expect(screen.getByRole('button', { name: 'Edit SOFTWARE / GENERAL' })).toBeDisabled();
    rerender(<BudgetReview {...base} allocations={[]} onEditLine={onEditLine} draft={false}/>);
    expect(screen.queryByRole('button', { name: /Edit SOFTWARE/ })).not.toBeInTheDocument();
  });
});
