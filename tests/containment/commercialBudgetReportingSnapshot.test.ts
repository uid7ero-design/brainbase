import { describe, expect, it } from 'vitest';
import { validBudgetReport, validFinanceQueue } from '@/lib/commercial/budgetReportingSnapshot';
import { completeReport, queueEntry } from '../fixtures/commercialBudgetReport';

describe('Complete Budget report wire snapshots', () => {
  it('accepts complete rows, nullable unknown amounts and empty reports', () => {
    expect(validBudgetReport(completeReport, null)).toBe(true);
    expect(validBudgetReport({ ...completeReport, rows: [], financeRows: [], exceptions: [] }, null)).toBe(true);
  });
  it.each(['rows', 'financeRows', 'exceptions'])('rejects null or incomplete entries in %s', key => {
    for (const row of [null, {}, []]) expect(validBudgetReport({ ...completeReport, [key]: [row] }, null)).toBe(false);
  });
  it.each([null, '100', 1.5, 9007199254740992, Infinity])('rejects malformed legacy amount %s', amount => {
    expect(validBudgetReport({ ...completeReport, rows: [{ ...completeReport.rows[0], actualCents: amount }] }, null)).toBe(false);
  });
  it.each(['', '1e3', '1.5', '01', 9007199254740992])('rejects malformed exact finance amount %s', amount => {
    expect(validBudgetReport({ ...completeReport, financeRows: [{ ...completeReport.financeRows[0], sourceActualCents: amount }] }, null)).toBe(false);
  });
  it('preserves signed large exact amounts and nullable finance measures', () => {
    expect(validBudgetReport({ ...completeReport, financeRows: [{ ...completeReport.financeRows[0], financeAdjustmentCents: '-900719925474099312' }] }, null)).toBe(true);
  });
  it('rejects a finance result from a different selected source', () => {
    expect(validBudgetReport({ ...completeReport, financeRows: [{ ...completeReport.financeRows[0], sourceSystemId: 'OTHER' }] }, 'XERO')).toBe(false);
    expect(validBudgetReport({ ...completeReport, financeRows: [{ ...completeReport.financeRows[0], sourceSystemId: 'XERO' }] }, null)).toBe(false);
  });
  it.each([-1, 0.5, '2', null])('rejects malformed report count %s', count => {
    expect(validBudgetReport({ ...completeReport, resolvedActualCount: count }, null)).toBe(false);
  });
  it('rejects malformed Actual provenance, dates and exception discriminator', () => {
    const actual = completeReport.exceptions[1];
    for (const exception of [{ ...actual, source: 'OTHER' }, { ...actual, exception: { ...actual.exception, codes: [null] } }, { ...actual, exception: { ...actual.exception, billDate: '2026-02-30' } }]) {
      expect(validBudgetReport({ ...completeReport, exceptions: [exception] }, null)).toBe(false);
    }
  });
});
describe('Complete finance queue snapshots', () => {
  it('accepts exact amounts beyond safe integers, empty queues and all-source scope', () => {
    expect(validFinanceQueue([queueEntry], 'XERO')).toBe(true);
    expect(validFinanceQueue([queueEntry], null)).toBe(true);
    expect(validFinanceQueue([], 'XERO')).toBe(true);
  });
  it.each([{ id: '' }, { sourceSystemId: 'OTHER' }, { status: 'UNKNOWN' }, { preparedAt: 'invalid' }, { unresolvedItemCount: -1 }, { sourceActualCents: 9007199254740992 }, { items: [null] }])('rejects invalid parent %j', change => {
    expect(validFinanceQueue([{ ...queueEntry, ...change }], 'XERO')).toBe(false);
  });
  it.each([{ currency: 'USD' }, { varianceCents: '1e3' }, { outcome: 'RECONCILED' }, { sourceActualCount: -1 }, { budgetAccountName: {} }])('rejects invalid item %j', change => {
    expect(validFinanceQueue([{ ...queueEntry, items: [{ ...queueEntry.items[0], ...change }] }], 'XERO')).toBe(false);
  });
});
