import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const actuals = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/commercial/budgetActuals.ts'),
  'utf8',
);
const resolver = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/commercial/budgetActualResolver.ts'),
  'utf8',
);
const combined = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/commercial/budgetActualCommitted.ts'),
  'utf8',
);

describe('C7.9C — late supplier-bill reconciliation contract', () => {
  it('keeps posted_at as the governed Actual recognition date', () => {
    expect(actuals).toContain('sb.posted_at::date BETWEEN fp.starts_on AND fp.ends_on');
    expect(actuals).not.toContain('sb.bill_date BETWEEN fp.starts_on AND fp.ends_on\n    ) period ON true');
    expect(combined).toContain('sb.posted_at::date BETWEEN fp.starts_on AND fp.ends_on');
  });

  it('uses bill_date only for a separate reconciliation-period attribution', () => {
    expect(actuals).toContain('bill_period.bill_period_match_count');
    expect(actuals).toContain('sb.bill_date BETWEEN fp.starts_on AND fp.ends_on');
    expect(combined).toContain('bill_period.bill_financial_period_status');
  });

  it('defines explicit prior-period, closed-period and bill-date resolution states', () => {
    for (const code of [
      'LATE_BILL_PRIOR_PERIOD',
      'LATE_BILL_CLOSED_PERIOD',
      'BILL_DATE_UNRESOLVED',
      'BILL_DATE_AMBIGUOUS',
    ]) expect(actuals).toContain(code);
  });

  it('keeps late-bill signals non-blocking for Budget Actual classification', () => {
    expect(resolver).toContain('RECONCILIATION_ONLY_CODES');
    expect(resolver).toContain("'LATE_BILL_PRIOR_PERIOD'");
    expect(resolver).toContain("'LATE_BILL_CLOSED_PERIOD'");
    expect(resolver).toContain('resolved.push({');
    expect(resolver).toContain('exceptions.push(actualException(reconciliationCodes, actual, budget))');
  });

  it('contains no automatic period reopen or source-date rewrite path', () => {
    expect(actuals).not.toMatch(/UPDATE\s+commercial_financial_periods/i);
    expect(actuals).not.toMatch(/UPDATE\s+commercial_supplier_bills/i);
    expect(combined).not.toMatch(/UPDATE\s+commercial_financial_periods/i);
    expect(combined).not.toMatch(/UPDATE\s+commercial_supplier_bills/i);
  });
});
