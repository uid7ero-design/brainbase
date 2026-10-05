import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.resolve(process.cwd(), 'app/commercial/budgeting/commitments/BudgetCommitmentsPage.tsx'), 'utf8');
const overview = fs.readFileSync(path.resolve(process.cwd(), 'app/commercial/page.tsx'), 'utf8');

describe('C7.8D — Budget vs Actual vs Committed UI contract', () => {
  it('loads the governed combined consumption endpoint with only an explicit finance-source query', () => {
    expect(page).toContain('fetch(`/api/commercial/budgeting/consumption${suffix}`)');
    expect(page).toContain('?sourceSystemId=${encodeURIComponent(activeSourceSystemId)}');
    expect(page).not.toContain("fetch('/api/commercial/budgeting/commitments')");
  });

  it('presents true combined Budget reporting and the operational payable basis disclosure', () => {
    expect(page).toContain('Budget vs Actual vs Committed');
    expect(page).toContain('operational payable basis');
    expect(page).toContain('POSTED supplier-bill lines');
    expect(page).toContain('not statutory ledger or cash accounting');
    expect(page).not.toContain('Actuals are not included');
  });

  it('shows Budget, Actual, Committed, exposure and both remaining planning measures', () => {
    for (const label of [
      'Budget', 'Actual', 'Committed', 'Actual + Committed',
      'Budget less Actual', 'Budget less Actual + Committed',
    ]) expect(page).toContain(label);
    expect(page).toContain('row.exposureCents');
    expect(page).toContain('row.budgetLessActualAndCommittedCents');
  });

  it('formats finance minor-unit strings without unsafe Number coercion', () => {
    expect(page).toContain('formatMoneyCentsExact(cents, currency)');
    expect(page).not.toContain('formatMoneyCents(Number(cents), currency)');
  });

  it('keeps monetary summaries separated by currency', () => {
    expect(page).toContain('const byCurrency = new Map');
    expect(page).toContain('summary.currency');
    expect(page).toContain('summary.actualCents');
    expect(page).toContain('summary.committedCents');
    expect(page).toContain('summary.exposureCents');
  });

  it('retains financial year, period, account, cost-centre and currency filters', () => {
    for (const label of ['Financial year', 'Financial period', 'Budget account', 'Cost centre', 'Currency']) {
      expect(page).toContain(label);
    }
  });

  it('keeps the reconciliation queue independent of resolved-row filters and exposes source provenance', () => {
    expect(page).toContain('Actual & commitment exception queue');
    expect(page).toContain('Finance reconciliation queue');
    expect(page).toContain('Always shown independently of resolved-row filters.');
    expect(page).toContain("source: 'COMMITMENT'");
    expect(page).toContain("source: 'ACTUAL'");
    expect(page).toContain('<SourceBadge source={item.source} />');
    expect(page).toContain('Unknown until Budget resolves');
  });

  it('links both Actual and Commitment exceptions back to the purchase order', () => {
    expect(page).toContain('/commercial/purchasing/purchase-orders/');
    expect(page).toContain('x.sourcePurchaseOrderId');
    expect(page).toContain('x.purchaseOrderId');
  });

  it('shows separate resolved Actual and Commitment counts', () => {
    expect(page).toContain('Resolved Actual lines');
    expect(page).toContain('Resolved commitment lines');
    expect(page).toContain('report.resolvedActualCount');
    expect(page).toContain('report.resolvedCommitmentCount');
  });

  it('exposes the report from Commercial overview only when budgeting is enabled', () => {
    expect(overview).toContain("capabilityKeys.has('budgeting')");
    expect(overview).toContain('hasBudgeting && <StatCard label="Budget vs Actual"');
    expect(overview).toContain('href="/commercial/budgeting/commitments"');
  });
});
