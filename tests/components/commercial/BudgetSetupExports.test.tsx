import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BudgetSetupExports from '@/app/commercial/budgeting/setup/BudgetSetupExports';
import type { BudgetSetupExportInput } from '@/lib/commercial/budgetSetupExport';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const input: BudgetSetupExportInput = {
  version: { name: 'Draft', currency: 'AUD', tax_basis: 'EXCLUSIVE', periodisation_mode: 'PERIODISED', version_number: 1, status: 'DRAFT',
    lines: [{ id: 'l', budget_account_id: 'a', cost_centre_id: 'c', annual_budget_cents: '10000' }],
    allocations: [{ budget_line_id: 'l', financial_period_id: 'p', amount_cents: '10000' }], mappings: [{ budget_account_id: 'a', cost_centre_id: 'c' }],
  }, accounts: [{ id: 'a', code: 'SOFTWARE', active: true }], centres: [{ id: 'c', code: 'GENERAL', active: true }],
};
describe('Saved Budget export controls', () => {
  it('downloads a local file and releases its temporary URL without a server request', () => {
    const create = vi.fn<(blob: Blob) => string>(() => 'blob:budget-export'), revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    let filename = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { filename = this.download; });
    render(<BudgetSetupExports input={input} busy={false}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Export Budget lines CSV' }));
    expect(filename).toBe('budget-v1-lines.csv');
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(revoke).toHaveBeenCalledWith('blob:budget-export');
    expect(request).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
    expect(screen.getByText(/Unsaved edits are excluded/)).toBeVisible();
  });
  it('disables absent collections, annual-only allocations and busy exports', () => {
    const empty = { ...input, version: { ...input.version, lines: [], allocations: [], mappings: [] } };
    const { rerender } = render(<BudgetSetupExports input={empty} busy={false}/>);
    screen.getAllByRole('button').forEach(button => expect(button).toBeDisabled());
    rerender(<BudgetSetupExports input={{ ...input, version: { ...input.version, periodisation_mode: 'ANNUAL_ONLY' } }} busy={false}/>);
    expect(screen.getByRole('button', { name: 'Export period allocations CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export Budget lines CSV' })).toBeEnabled();
    rerender(<BudgetSetupExports input={input} busy/>);
    screen.getAllByRole('button').forEach(button => expect(button).toBeDisabled());
  });
  it('reports export failures without saving or submitting a form', () => {
    vi.stubGlobal('URL', { createObjectURL: () => { throw new Error('Download unavailable'); }, revokeObjectURL: vi.fn() });
    render(<BudgetSetupExports input={input} busy={false}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Export commitment mappings CSV' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to export this saved Budget.');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
});
