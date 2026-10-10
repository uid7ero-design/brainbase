import { describe, expect, it } from 'vitest';
import { parse } from 'csv-parse/sync';
import { buildBudgetSetupCsv, type BudgetSetupExportInput } from '@/lib/commercial/budgetSetupExport';

const input: BudgetSetupExportInput = {
  version: { name: 'Labs, Budget', currency: 'AUD', tax_basis: 'EXCLUSIVE', periodisation_mode: 'PERIODISED', version_number: 2, status: 'DRAFT',
    lines: [{ id: 'line', budget_account_id: 'a', cost_centre_id: 'c', annual_budget_cents: '9223372036854775807' }],
    allocations: [{ budget_line_id: 'line', financial_period_id: 'p2', amount_cents: '7' }, { budget_line_id: 'line', financial_period_id: 'p1', amount_cents: '9223372036854775800' }],
    mappings: [{ budget_account_id: 'a', cost_centre_id: 'c' }],
  },
  year: { name: '2026–2027', periods: [{ id: 'p1', name: 'QTR 1', starts_on: '2026-07-01', ends_on: '2026-09-30' }, { id: 'p2', name: 'QTR 2', starts_on: '2026-10-01', ends_on: '2026-12-31' }] },
  accounts: [{ id: 'a', code: 'SOFTWARE', active: true }], centres: [{ id: 'c', code: 'GENERAL', active: true }],
};
const rows = (csv: string): Record<string, string>[] => parse(csv, { columns: true, bom: true });

describe('Saved Budget CSV exports', () => {
  it('retains exact large decimal amounts and version/basis metadata', () => {
    const [row] = rows(buildBudgetSetupCsv(input, 'lines'));
    expect(row).toMatchObject({ Budget: 'Labs, Budget', Version: '2', Status: 'DRAFT', Currency: 'AUD', 'Financial year': '2026–2027', 'Tax basis': 'EXCLUSIVE', Periodisation: 'PERIODISED', 'Annual amount': '92233720368547758.07', 'Allocated amount': '92233720368547758.07', 'Allocation check': 'Balanced' });
  });
  it('shows shortages and excesses separately even when they offset', () => {
    const changed = structuredClone(input);
    changed.version.lines = [{ ...input.version.lines[0], id: 'one', annual_budget_cents: '10000' }, { ...input.version.lines[0], id: 'two', annual_budget_cents: '10000' }];
    changed.version.allocations = [{ budget_line_id: 'one', financial_period_id: 'p1', amount_cents: '9000' }, { budget_line_id: 'two', financial_period_id: 'p1', amount_cents: '11000' }];
    expect(rows(buildBudgetSetupCsv(changed, 'lines')).map(row => row['Allocation check'])).toEqual(['10.00 left to allocate', '10.00 over allocated']);
  });
  it('exports only saved allocations in calendar order with Australian dates', () => {
    const before = structuredClone(input);
    const exported = rows(buildBudgetSetupCsv(input, 'allocations'));
    expect(exported.map(row => row.Period)).toEqual(['QTR 1', 'QTR 2']);
    expect(exported[0]).toMatchObject({ 'Period start (DD/MM/YYYY)': '01/07/2026', 'Period end (DD/MM/YYYY)': '30/09/2026', Amount: '92233720368547758.00' });
    expect(exported[1].Amount).toBe('0.07');
    expect(input).toEqual(before);
  });
  it('distinguishes annual-only allocations from zero', () => {
    const changed = { ...input, version: { ...input.version, periodisation_mode: 'ANNUAL_ONLY', allocations: [] } };
    expect(rows(buildBudgetSetupCsv(changed, 'lines'))[0]).toMatchObject({ 'Allocated amount': '', 'Allocation check': 'Not applicable' });
  });
  it('retains missing references and marks inactive mapping dimensions', () => {
    const changed = { ...input, accounts: [], centres: [{ id: 'c', code: 'GENERAL', active: false }] };
    expect(rows(buildBudgetSetupCsv(changed, 'mappings'))[0]).toMatchObject({ Account: 'Unavailable account', 'Account status': 'Unavailable', 'Cost centre status': 'Inactive' });
    const orphan = { ...changed, year: undefined, version: { ...changed.version, lines: [] } };
    expect(rows(buildBudgetSetupCsv(orphan, 'allocations'))[0]).toMatchObject({ Account: 'Unavailable line', Period: 'Unavailable period', 'Financial year': 'Unavailable year', 'Period start (DD/MM/YYYY)': '' });
  });
  it('neutralises formula-like names and codes with leading controls while preserving CSV quoting', () => {
    const changed = structuredClone(input);
    changed.version.name = ' \t=SUM(1,2)'; changed.accounts[0].code = '@command'; changed.centres[0].code = 'General "HQ"\nteam';
    changed.year!.name = '+year'; changed.year!.periods[0].name = '\t-formula';
    const [row] = rows(buildBudgetSetupCsv(changed, 'allocations'));
    expect(row).toMatchObject({ Budget: "' \t=SUM(1,2)", Account: "'@command", 'Financial year': "'+year", Period: "'\t-formula", 'Cost centre': 'General "HQ"\nteam' });
  });
  it('keeps ACTIVE status explicit and emits header-only files for empty collections', () => {
    expect(rows(buildBudgetSetupCsv({ ...input, version: { ...input.version, status: 'ACTIVE' } }, 'mappings'))[0].Status).toBe('ACTIVE');
    expect(rows(buildBudgetSetupCsv({ ...input, version: { ...input.version, lines: [] } }, 'lines'))).toEqual([]);
  });
});
