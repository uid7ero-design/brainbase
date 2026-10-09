import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DraftBudgetMappingForm from '@/app/commercial/budgeting/setup/DraftBudgetMappingForm';
import BudgetMappingReview from '@/app/commercial/budgeting/setup/BudgetMappingReview';

afterEach(cleanup);
const accounts = [{ id: 'software', code: 'SOFTWARE', active: true }, { id: 'hosting', code: 'HOSTING', active: true }];
const centres = [{ id: 'general', code: 'GENERAL', active: true }];
const mapping = { cost_centre_id: 'general', budget_account_id: 'software' };
const base = { busy: false, accounts, centres, onSubmit: vi.fn(event => event.preventDefault()), onCancel: vi.fn() };

describe('Commitment mapping management', () => {
  it('prefills the saved account and submits the fixed cost centre identity', () => {
    render(<DraftBudgetMappingForm {...base} mapping={mapping}/>);
    expect(screen.getByLabelText('Mapping cost centre')).toHaveValue('GENERAL');
    expect(screen.getByLabelText('Mapping cost centre')).toHaveAttribute('readonly');
    const account = screen.getByRole('combobox', { name: /Mapping account/ });
    expect(account).toHaveValue('software');
    fireEvent.change(account, { target: { value: 'hosting' } });
    expect(Object.fromEntries(new FormData(screen.getByRole('form') as HTMLFormElement))).toEqual({ costCentreId: 'general', budgetAccountId: 'hosting' });
    expect(screen.getByText(/Updating replaces its saved account/)).toBeVisible();
  });
  it('cancels without submitting and disables editing during a save', () => {
    const onSubmit = vi.fn(), onCancel = vi.fn();
    const { rerender } = render(<DraftBudgetMappingForm {...base} mapping={mapping} onSubmit={onSubmit} onCancel={onCancel}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel mapping editing' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(<DraftBudgetMappingForm {...base} mapping={mapping} busy/>);
    expect(screen.getByRole('button', { name: 'Update mapping' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel mapping editing' })).toBeDisabled();
  });
  it('preserves an inactive saved account visibly until an active replacement is chosen', () => {
    render(<DraftBudgetMappingForm {...base} mapping={mapping} accounts={[{ ...accounts[0], active: false }, accounts[1]]}/>);
    const account = screen.getByRole('combobox', { name: /Mapping account/ });
    expect(account).toHaveValue('software');
    expect(screen.getByRole('button', { name: 'Update mapping' })).toBeDisabled();
    fireEvent.change(account, { target: { value: 'hosting' } });
    expect(screen.getByRole('button', { name: 'Update mapping' })).toBeEnabled();
  });
  it('requires recovery of an inactive cost centre and never substitutes another centre', () => {
    render(<DraftBudgetMappingForm {...base} mapping={mapping} centres={[{ ...centres[0], active: false }]}/>);
    expect(screen.getByRole('button', { name: 'Update mapping' })).toBeDisabled();
    expect(screen.getByText('Reactivate this cost centre before updating its mapping.')).toBeVisible();
  });
  it('clears controlled account selection when the creation form is reset after saving', () => {
    render(<DraftBudgetMappingForm {...base}/>);
    const account = screen.getByRole('combobox', { name: /Mapping account/ });
    fireEvent.change(account, { target: { value: 'hosting' } });
    fireEvent.reset(screen.getByRole('form'));
    expect(account).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save commitment mapping' })).toBeVisible();
  });
  it('shows saved mappings, reference status and a draft-only action', () => {
    const onEdit = vi.fn();
    const { rerender } = render(<BudgetMappingReview accounts={accounts} centres={centres} mappings={[mapping]} draft busy={false} onEdit={onEdit}/>);
    const table = screen.getByRole('table', { name: 'Commitment mappings' });
    expect(within(table).getByText('Active references')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit mapping GENERAL' }));
    expect(onEdit).toHaveBeenCalledWith('general');
    rerender(<BudgetMappingReview accounts={accounts} centres={centres} mappings={[mapping]} draft busy onEdit={onEdit}/>);
    expect(screen.getByRole('button', { name: 'Edit mapping GENERAL' })).toBeDisabled();
    rerender(<BudgetMappingReview accounts={accounts} centres={centres} mappings={[mapping]} draft={false} busy={false} onEdit={onEdit}/>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('exposes inactive and unavailable references without displaying internal IDs', () => {
    render(<BudgetMappingReview accounts={[{ ...accounts[0], active: false }]} centres={[]} mappings={[mapping]} draft={false} busy={false} onEdit={vi.fn()}/>);
    expect(screen.getByText('Cost centre unavailable; Account inactive')).toBeVisible();
    expect(screen.getByText('Unavailable cost centre')).toBeVisible();
    expect(screen.queryByText('general')).not.toBeInTheDocument();
  });
  it('shows an empty saved-mapping state', () => {
    render(<BudgetMappingReview accounts={accounts} centres={centres} mappings={[]} draft busy={false} onEdit={vi.fn()}/>);
    expect(screen.getByText('No commitment mappings saved.')).toBeVisible();
  });
});
