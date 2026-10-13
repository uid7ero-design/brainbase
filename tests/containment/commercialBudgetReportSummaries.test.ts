import { describe, expect, it } from 'vitest';
import { buildLegacyBudgetSummaries, buildFinanceBudgetSummaries } from '@/lib/commercial/budgetReportSummaries';
import { consumptionRow, financeRow } from '../fixtures/commercialBudgetReport';

const legacy = { ...consumptionRow, taxBasis: 'EXCLUSIVE' as const };
const finance = { ...financeRow, taxBasis: 'EXCLUSIVE' as const, reconciliationStatus: null };
const evidence = { ...finance, externalGlActualCents: '0', reconciliationVarianceCents: '0', reconciliationId: 'recon', sourceSystemId: 'XERO', reconciliationStatus: 'SIGNED_OFF' as const };
describe('Exact report totals by currency and tax basis', () => {
  it('does not fabricate a group for an empty result', () => {
    expect(buildLegacyBudgetSummaries([])).toEqual([]); expect(buildFinanceBudgetSummaries([])).toEqual([]);
  });
  it('preserves an aggregate above the safe integer limit from individually safe rows', () => {
    const result = buildLegacyBudgetSummaries([{ ...legacy, budgetCents: Number.MAX_SAFE_INTEGER }, { ...legacy, budgetCents: 2 }]);
    expect(result[0].budgetCents).toBe('9007199254740993'); expect(result[0].rowCount).toBe(2);
  });
  it('keeps currencies and inclusive/exclusive tax bases separate', () => {
    const result = buildLegacyBudgetSummaries([legacy, { ...legacy, taxBasis: 'INCLUSIVE' }, { ...legacy, currency: 'USD' }]);
    expect(result).toHaveLength(3); expect(result.map(row => row.budgetCents)).toEqual(['10000', '10000', '10000']);
  });
  it.each([1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])('rejects an unsafe legacy amount %s before aggregation', amount => {
    expect(() => buildLegacyBudgetSummaries([{ ...legacy, actualCents: amount }])).toThrow('Unsafe legacy report amount');
  });
  it('totals signed exact finance strings without Number conversion', () => {
    const result = buildFinanceBudgetSummaries([{ ...finance, sourceActualCents: '900719925474099312', financeAdjustmentCents: '-100' }, { ...finance, sourceActualCents: '1', financeAdjustmentCents: '-1' }]);
    expect(result[0].sourceActualCents).toBe('900719925474099313'); expect(result[0].financeAdjustmentCents).toBe('-101');
  });
  it('separates unavailable Budget basis from both established bases', () => {
    const result = buildFinanceBudgetSummaries([finance, { ...finance, taxBasis: null }, { ...finance, taxBasis: 'INCLUSIVE' }]);
    expect(result).toHaveLength(3); expect(result.find(row => row.taxBasis === null)?.budgetCents).toBeNull();
  });
  it('preserves a known zero ledger total as zero', () => {
    const result = buildFinanceBudgetSummaries([evidence]);
    expect(result[0]).toMatchObject({ externalGlActualCents: '0', reconciliationVarianceCents: '0', evidenceRowCount: 1, signedOffRowCount: 1, staleRowCount: 0 });
  });
  it.each([{ externalGlActualCents: null }, { reconciliationVarianceCents: null }, { reconciliationStatus: null }, { reconciliationId: null }, { sourceSystemId: null }])('does not label partial provenance as complete evidence: %j', change => {
    const result = buildFinanceBudgetSummaries([evidence, { ...evidence, ...change }]);
    expect(result[0]).toMatchObject({ externalGlActualCents: null, reconciliationVarianceCents: null, evidenceRowCount: 1, rowCount: 2 });
  });
  it('separately counts signed-off and stale rows without claiming current approval', () => {
    const result = buildFinanceBudgetSummaries([evidence, { ...evidence, reconciliationStatus: 'STALE', externalGlActualCents: '123', reconciliationVarianceCents: '-123' }]);
    expect(result[0]).toMatchObject({ externalGlActualCents: '123', reconciliationVarianceCents: '-123', signedOffRowCount: 1, staleRowCount: 1 });
  });
  it('retains an identified stale status even when its monetary evidence is incomplete', () => {
    expect(buildFinanceBudgetSummaries([{ ...evidence, reconciliationStatus: 'STALE', reconciliationVarianceCents: null }])[0]).toMatchObject({ evidenceRowCount: 0, staleRowCount: 1, externalGlActualCents: null });
  });
  it('does not mutate input rows while aggregating', () => {
    const rows = [Object.freeze(legacy)]; expect(() => buildLegacyBudgetSummaries(rows)).not.toThrow();
    expect(rows[0].budgetCents).toBe(10000);
  });
});
