import { describe, expect, it } from 'vitest';
import { reviewBudgetAllocations } from '@/lib/commercial/budgetAllocationReview';

describe('Budget allocation review', () => {
  it('keeps empty drafts empty rather than treating them as ready', () => {
    expect(reviewBudgetAllocations([], [])).toEqual({ annualTotalCents: '0', allocatedTotalCents: '0', unbalancedLines: 0, lines: [] });
  });
  it('reconciles four quarters for the software and hosting Budget', () => {
    const lines = [{ id: 'software', annual_budget_cents: '640800' }, { id: 'hosting', annual_budget_cents: '48000' }];
    const allocations = Array.from({ length: 4 }, () => [{ budget_line_id: 'software', amount_cents: '160200' }, { budget_line_id: 'hosting', amount_cents: '12000' }]).flat();
    expect(reviewBudgetAllocations(lines, allocations)).toEqual({ annualTotalCents: '688800', allocatedTotalCents: '688800', unbalancedLines: 0, lines: [
      { id: 'software', allocatedCents: '640800', differenceCents: '0', state: 'BALANCED' },
      { id: 'hosting', allocatedCents: '48000', differenceCents: '0', state: 'BALANCED' },
    ] });
  });
  it('flags offsetting excess and shortage even when the overall totals match', () => {
    const result = reviewBudgetAllocations([{ id: 'a', annual_budget_cents: '10000' }, { id: 'b', annual_budget_cents: '10000' }], [{ budget_line_id: 'a', amount_cents: '9000' }, { budget_line_id: 'b', amount_cents: '11000' }]);
    expect(result.annualTotalCents).toBe(result.allocatedTotalCents);
    expect(result.unbalancedLines).toBe(2);
    expect(result.lines.map(line => [line.state, line.differenceCents])).toEqual([['UNDER', '1000'], ['OVER', '-1000']]);
  });
  it('shows missing allocations and zero-value lines correctly', () => {
    expect(reviewBudgetAllocations([{ id: 'a', annual_budget_cents: '1' }, { id: 'b', annual_budget_cents: '0' }], []).lines.map(line => line.state)).toEqual(['UNDER', 'BALANCED']);
  });
  it('preserves exact aggregate totals beyond a single database BIGINT', () => {
    const amount = '9223372036854775807';
    const result = reviewBudgetAllocations([{ id: 'a', annual_budget_cents: amount }, { id: 'b', annual_budget_cents: amount }], [{ budget_line_id: 'a', amount_cents: amount }, { budget_line_id: 'b', amount_cents: amount }]);
    expect(result.annualTotalCents).toBe('18446744073709551614');
    expect(result.allocatedTotalCents).toBe(result.annualTotalCents);
    expect(result.unbalancedLines).toBe(0);
  });
  it('does not include allocations from another version in totals', () => {
    expect(reviewBudgetAllocations([{ id: 'a', annual_budget_cents: '100' }], [{ budget_line_id: 'foreign-line', amount_cents: '100' }]).allocatedTotalCents).toBe('0');
  });
});
