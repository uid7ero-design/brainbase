import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DraftBudgetAllocationForm from '@/app/commercial/budgeting/setup/DraftBudgetAllocationForm';

afterEach(cleanup);
const base = {
  currency: 'AUD', busy: false, lines: [{ id: 'line-id', label: 'SOFTWARE / GENERAL' }],
  periods: [{ id: 'period-id', label: 'QTR 1' }],
  onSubmit: vi.fn(event => event.preventDefault()), onCancel: vi.fn(),
};
const allocation = { budget_line_id: 'line-id', financial_period_id: 'period-id', amount_cents: '9223372036854775807' };

describe('Draft Budget allocation editing', () => {
  it('prefills exact currency units and submits fixed line and period IDs', () => {
    render(<DraftBudgetAllocationForm {...base} allocation={allocation}/>);
    const form = screen.getByRole('form', { name: 'Period allocation' }) as HTMLFormElement;
    expect(screen.getByLabelText('Period amount (AUD)', { exact: false })).toHaveValue('92233720368547758.07');
    expect(screen.getByLabelText('Allocation line')).toHaveValue('SOFTWARE / GENERAL');
    expect(screen.getByLabelText('Allocation line')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Allocation period')).toHaveValue('QTR 1');
    expect(screen.getByLabelText('Allocation period')).toHaveAttribute('readonly');
    expect(Object.fromEntries(new FormData(form))).toEqual({ budgetLineId: 'line-id', financialPeriodId: 'period-id', amountCents: '92233720368547758.07' });
    expect(screen.getByText(/annual amount and other period allocations will be retained/)).toBeVisible();
  });
  it('cancels without submitting and disables controls during a pending save', () => {
    const onCancel = vi.fn(), onSubmit = vi.fn(event => event.preventDefault());
    const { rerender } = render(<DraftBudgetAllocationForm {...base} allocation={allocation} onCancel={onCancel} onSubmit={onSubmit}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel allocation editing' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(<DraftBudgetAllocationForm {...base} allocation={allocation} busy/>);
    expect(screen.getByRole('button', { name: 'Update allocation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel allocation editing' })).toBeDisabled();
    expect(screen.getByLabelText('Period amount (AUD)', { exact: false })).toBeDisabled();
  });
  it('retains line and period selection when adding an allocation', () => {
    render(<DraftBudgetAllocationForm {...base}/>);
    expect(screen.getByRole('combobox', { name: /Allocation line/ })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: /Allocation period/ })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save allocation' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Update allocation' })).not.toBeInTheDocument();
  });
});
