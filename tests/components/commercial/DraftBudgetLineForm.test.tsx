import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DraftBudgetLineForm from '@/app/commercial/budgeting/setup/DraftBudgetLineForm';
import { budgetAmountToCents, budgetCentsToAmount } from '@/lib/commercial/financeSetupDisplay';

afterEach(cleanup);
const base = {
  currency: 'AUD', busy: false, accounts: [{ id: 'account-id', label: 'SOFTWARE' }],
  centres: [{ id: 'centre-id', label: 'GENERAL' }],
  accountCode: () => 'SOFTWARE', centreCode: () => 'GENERAL',
  onSubmit: vi.fn(event => event.preventDefault()), onCancel: vi.fn(),
};
const line = { budget_account_id: 'account-id', cost_centre_id: 'centre-id', annual_budget_cents: '9223372036854775807' };

describe('Draft Budget line editing', () => {
  it.each(['0', '1', '640800', '9223372036854775807'])('round-trips exact cents %s into a decimal input', cents => {
    expect(budgetAmountToCents(budgetCentsToAmount(cents))).toBe(cents);
  });
  it('prefills the exact saved amount and submits fixed IDs, rather than display codes', () => {
    render(<DraftBudgetLineForm {...base} line={line}/>);
    const form = screen.getByRole('form', { name: 'Budget line' }) as HTMLFormElement;
    expect(screen.getByLabelText('Annual amount (AUD)', { exact: false })).toHaveValue('92233720368547758.07');
    expect(screen.getByLabelText('Line account')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Line cost centre')).toHaveAttribute('readonly');
    expect(Object.fromEntries(new FormData(form))).toEqual({ budgetAccountId: 'account-id', costCentreId: 'centre-id', annualBudgetCents: '92233720368547758.07' });
    expect(screen.getByText(/Existing period allocations will be retained/)).toBeVisible();
  });
  it('cancels without submitting and prevents changes while a save is pending', () => {
    const onCancel = vi.fn(), onSubmit = vi.fn(event => event.preventDefault());
    const { rerender } = render(<DraftBudgetLineForm {...base} line={line} onCancel={onCancel} onSubmit={onSubmit}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(<DraftBudgetLineForm {...base} line={line} busy/>);
    expect(screen.getByRole('button', { name: 'Update line' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel editing' })).toBeDisabled();
    expect(screen.getByLabelText('Annual amount (AUD)', { exact: false })).toBeDisabled();
  });
  it('retains dimension selection and Save line for new lines', () => {
    render(<DraftBudgetLineForm {...base}/>);
    expect(screen.getByRole('combobox', { name: /Line account/ })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save line' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cancel editing' })).not.toBeInTheDocument();
  });
});
