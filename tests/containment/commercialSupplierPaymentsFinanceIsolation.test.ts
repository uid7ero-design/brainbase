import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const actuals = read('lib/commercial/budgetActuals.ts');
const combined = read('lib/commercial/budgetActualCommitted.ts');
const reconciliation = read('lib/commercial/financeReconciliation.ts');
const settlement = read('lib/commercial/supplierPayments.ts');

describe('AP-5 finance isolation boundary', () => {
  it('C7.8 Budget Actual does not read supplier settlement tables or domain code', () => {
    for (const source of [actuals, combined]) {
      expect(source).not.toContain('commercial_supplier_payments');
      expect(source).not.toContain('commercial_supplier_payment_allocations');
      expect(source).not.toMatch(/supplierPayments/);
    }
  });

  it('C7.9 reconciliation does not read supplier settlement tables or domain code', () => {
    expect(reconciliation).not.toContain('commercial_supplier_payments');
    expect(reconciliation).not.toContain('commercial_supplier_payment_allocations');
    expect(reconciliation).not.toMatch(/supplierPayments/);
  });

  it('supplier settlement does not mutate or stale C7.8/C7.9 finance evidence', () => {
    expect(settlement).not.toMatch(/budgetActual|financeReconciliation|financeAdjustment|financialPeriodClose|financialYearClose/);
    expect(settlement).not.toContain('commercial_finance_reconciliations');
    expect(settlement).not.toContain('commercial_finance_reconciliation_items');
  });
});
