import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.resolve(process.cwd(), 'app/commercial/budgeting/commitments/page.tsx'), 'utf8');
const overview = fs.readFileSync(path.resolve(process.cwd(), 'app/commercial/page.tsx'), 'utf8');

describe('C7.7F — Budget-vs-commitment reporting UI contract', () => {
  it('loads the governed C7.7E consumption endpoint rather than raw C7.6 commitments', () => {
    expect(page).toContain("fetch('/api/commercial/budgeting/consumption')");
    expect(page).not.toContain("fetch('/api/commercial/budgeting/commitments')");
  });

  it('presents resolved Budget rows with governed planning semantics', () => {
    expect(page).toContain('Budget vs Commitments');
    expect(page).toContain('Resolved Budget consumption');
    expect(page).toContain('Budget account');
    expect(page).toContain('Cost centre');
    expect(page).toContain('Budget less commitments');
    expect(page).toContain('Actuals are not included');
    expect(page).toContain('It is not remaining Budget');
  });

  it('shows resolved commitment totals separately by currency', () => {
    expect(page).toContain('const byCurrency = new Map');
    expect(page).toContain('Committed');
    expect(page).toContain('Billed (informational)');
    expect(page).toContain('summary.currency');
  });

  it('provides resolved-row financial year, period, account, cost-centre and currency filters', () => {
    for (const label of ['Financial year', 'Financial period', 'Budget account', 'Cost centre', 'Currency']) {
      expect(page).toContain(label);
    }
    expect(page).toContain("filters.budgetAccountId !== 'ALL'");
    expect(page).toContain("filters.costCentreId !== 'ALL'");
  });

  it('keeps the exception queue visible and independent of resolved-row filters', () => {
    expect(page).toContain('Exception & reconciliation queue');
    expect(page).toContain('Always shown independently of resolved-row filters.');
    expect(page).toContain('report.exceptions.map');
    expect(page).toContain('Outstanding ex tax');
    expect(page).toContain('Outstanding incl tax');
    expect(page).toContain('Unknown until Budget resolves');
  });

  it('surfaces every C7.7E fail-loud exception code in the UI type contract', () => {
    for (const code of [
      'UNATTRIBUTED_COST_CENTRE',
      'UNMAPPED_ACCOUNT',
      'AMBIGUOUS_ACCOUNT',
      'UNRESOLVED_PERIOD',
      'AMBIGUOUS_PERIOD',
      'NO_ACTIVE_BUDGET',
      'NO_BUDGET_LINE',
      'CURRENCY_MISMATCH',
      'INVALID_OVERBILLED',
    ]) expect(page).toContain(code);
  });

  it('links exception rows back to the governed purchase-order detail surface', () => {
    expect(page).toContain('/commercial/purchasing/purchase-orders/');
    expect(page).toContain('item.purchaseOrderId');
  });

  it('exposes the report from Commercial overview only when budgeting capability is enabled', () => {
    expect(overview).toContain("capabilityKeys.has('budgeting')");
    expect(overview).toContain('hasBudgeting && <StatCard label="Purchase Commitments"');
    expect(overview).toContain('href="/commercial/budgeting/commitments"');
  });
});
