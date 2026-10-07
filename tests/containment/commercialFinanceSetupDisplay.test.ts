import { describe, expect, it } from 'vitest';
import { australianDateToIso, budgetAmountToCents, formatAustralianDate, formatBudgetAmount } from '@/lib/commercial/financeSetupDisplay';

describe('Finance setup dollar inputs', () => {
  it.each([['6408.00', '640800'], ['6,408.00', '640800'], ['480', '48000'], ['0.01', '1'], ['0.1', '10'], ['0', '0']])('converts %s to exact cents', (input, cents) => {
    expect(budgetAmountToCents(input)).toBe(cents);
  });
  it.each(['', '-1', '1e3', '1.001', '6,40.00', '$100', 'NaN', '92233720368547758.08'])('rejects invalid amounts %s', input => {
    expect(() => budgetAmountToCents(input)).toThrow();
  });
  it('preserves cents beyond JavaScript safe integers through entry and display', () => {
    expect(budgetAmountToCents('90071992547409.93')).toBe('9007199254740993');
    expect(formatBudgetAmount('9007199254740993', 'AUD')).toBe('AUD 90,071,992,547,409.93');
    expect(budgetAmountToCents('92233720368547758.07')).toBe('9223372036854775807');
  });
  it('shows cents as two decimal places with the saved currency', () => {
    expect(formatBudgetAmount('640800', 'AUD')).toBe('AUD 6,408.00');
    expect(formatBudgetAmount('1', 'USD')).toBe('USD 0.01');
  });
});

describe('Australian finance calendar dates', () => {
  it('uses day first even when both numbers could be months', () => {
    expect(australianDateToIso('04/07/2026')).toBe('2026-07-04');
    expect(formatAustralianDate('2026-07-04')).toBe('04/07/2026');
  });
  it('accepts a real leap day without timezone conversion', () => {
    expect(australianDateToIso('29/02/2028')).toBe('2028-02-29');
  });
  it.each(['02/29/2028', '29/02/2027', '31/04/2026', '2026-07-01', '1/7/2026', '01/01/0000', ''])('rejects invalid or non-Australian dates %s', input => {
    expect(() => australianDateToIso(input)).toThrow();
  });
});
