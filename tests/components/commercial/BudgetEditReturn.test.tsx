import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import BudgetSetup from '@/app/commercial/budgeting/setup/BudgetSetup';

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const scroll = vi.fn();
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll }));
afterAll(() => {
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const cases = [
  { kind: 'line', edit: 'Edit SOFTWARE / GENERAL', field: 'Annual amount (AUD)', value: '120.00', update: 'Update line', cancel: 'Cancel editing', form: 'Budget line', review: 'Budget amount review' },
  { kind: 'allocation', edit: 'Edit allocation SOFTWARE / GENERAL / QTR 1', field: 'Period amount (AUD)', value: '90.00', update: 'Update allocation', cancel: 'Cancel allocation editing', form: 'Period allocation', review: 'Budget amount review' },
  { kind: 'mapping', edit: 'Edit mapping GENERAL', field: 'Mapping account', value: 'alternate', update: 'Update mapping', cancel: 'Cancel mapping editing', form: 'Commitment mapping', review: 'Commitment mapping review' },
] as const;
const initial = {
  budget_id: 'budget', version_id: 'version', name: 'Draft', financial_year_id: 'year', currency: 'AUD', tax_basis: 'EXCLUSIVE', periodisation_mode: 'PERIODISED', version_number: 1, status: 'DRAFT', can_edit_settings: true,
  lines: [{ id: 'line', budget_account_id: 'account', cost_centre_id: 'centre', annual_budget_cents: '10000' }],
  allocations: [{ budget_line_id: 'line', financial_period_id: 'period', amount_cents: '10000' }],
  mappings: [{ cost_centre_id: 'centre', budget_account_id: 'account' }],
};
let version = structuredClone(initial);
let failSave = false;
const mutations: Record<string, string>[] = [];
beforeEach(() => {
  version = structuredClone(initial); failSave = false; mutations.length = 0; scroll.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(String(options.body)); mutations.push(body);
      if (failSave) return Response.json({ error: 'Save rejected. Draft remains unchanged.' }, { status: 409 });
      if (body.action === 'line') version.lines[0].annual_budget_cents = body.annualBudgetCents;
      if (body.action === 'allocation') version.allocations[0].amount_cents = body.amountCents;
      if (body.action === 'mapping') version.mappings[0].budget_account_id = body.budgetAccountId;
      return Response.json({});
    }
    if (url.endsWith('/budgets')) return Response.json({ versions: [version] });
    if (url.endsWith('/financial-periods')) return Response.json({ years: [{ id: 'year', name: 'FY', status: 'OPEN', periods: [{ id: 'period', name: 'QTR 1' }] }] });
    if (url.endsWith('/accounts')) return Response.json({ records: [{ id: 'account', code: 'SOFTWARE', active: true }, { id: 'alternate', code: 'HOSTING', active: true }] });
    if (url.endsWith('/cost-centres')) return Response.json({ records: [{ id: 'centre', code: 'GENERAL', active: true }] });
    throw new Error('Unexpected setup request');
  }));
});

describe('Saved Budget editor return navigation', () => {
  it('keeps mapping creation at the form instead of returning to review', async () => {
    render(<BudgetSetup revision={0}/>);
    await screen.findByRole('button', { name: 'Edit mapping GENERAL', exact: true });
    const form = within(screen.getByRole('form', { name: 'Commitment mapping', exact: true }));
    fireEvent.change(form.getByLabelText('Mapping cost centre', { exact: false }), { target: { value: 'centre' } });
    fireEvent.change(form.getByLabelText('Mapping account', { exact: false }), { target: { value: 'alternate' } });
    const save = form.getByRole('button', { name: 'Save commitment mapping', exact: true });
    save.focus(); fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Budget setup saved.'));
    expect(save).toHaveFocus();
    expect(scroll).not.toHaveBeenCalled();
    expect(form.getByLabelText('Mapping account', { exact: false })).toHaveValue('');
  });
  it.each(cases)('$kind cancellation returns focus without saving', async item => {
    render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button', { name: item.edit, exact: true }));
    const form = within(screen.getByRole('form', { name: item.form, exact: true }));
    fireEvent.change(form.getByLabelText(item.field, { exact: false }), { target: { value: item.value } });
    fireEvent.click(form.getByRole('button', { name: item.cancel, exact: true }));
    expect(screen.getByRole('region', { name: item.review, exact: true })).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
    expect(mutations).toHaveLength(0);
    expect(version).toEqual(initial);
    expect(screen.getByRole('status')).toHaveTextContent('Saved Budget records are unchanged.');
  });
  it.each(cases)('$kind save returns focus to the refreshed review', async item => {
    render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button', { name: item.edit, exact: true }));
    const form = within(screen.getByRole('form', { name: item.form, exact: true }));
    fireEvent.change(form.getByLabelText(item.field, { exact: false }), { target: { value: item.value } });
    fireEvent.click(form.getByRole('button', { name: item.update, exact: true }));
    await waitFor(() => expect(screen.getByRole('region', { name: item.review, exact: true })).toHaveFocus());
    expect(mutations).toHaveLength(1);
    expect(mutations[0].action).toBe(item.kind);
    expect(screen.queryByRole('button', { name: item.cancel, exact: true })).not.toBeInTheDocument();
    const review = screen.getByRole('region', { name: item.review, exact: true });
    expect(review).toHaveTextContent(item.kind === 'line' ? 'AUD 120.00' : item.kind === 'allocation' ? 'AUD 90.00' : 'HOSTING');
  });
  it.each(cases)('$kind failed save retains the edit and does not return to review', async item => {
    failSave = true;
    render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button', { name: item.edit, exact: true }));
    const form = within(screen.getByRole('form', { name: item.form, exact: true }));
    fireEvent.change(form.getByLabelText(item.field, { exact: false }), { target: { value: item.value } });
    fireEvent.click(form.getByRole('button', { name: item.update, exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save rejected.');
    expect(form.getByLabelText(item.field, { exact: false })).toHaveValue(item.value);
    expect(scroll).not.toHaveBeenCalled();
    expect(version).toEqual(initial);
    fireEvent.click(form.getByRole('button', { name: item.cancel, exact: true }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: item.review, exact: true })).toHaveFocus();
  });
});
