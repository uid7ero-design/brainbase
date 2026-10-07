import { beforeEach, describe, expect, it, vi } from 'vitest';
const { sqlMock, transactionMock } = vi.hoisted(() => ({ sqlMock: vi.fn(), transactionMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: Object.assign(sqlMock, { transaction: transactionMock }) }));
const { importExternalGlEntry } = await import('@/lib/commercial/externalGl');
const base = { organisationId: 'org-a', userId: 'user-a', sourceSystemId: 'xero', externalEntryId: 'entry-a',
  externalAccountCode: '600', transactionDate: '2026-09-01', currency: 'AUD', sourcePayloadHash: 'hash', sourceLineageId: 'batch-a' };
beforeEach(() => { sqlMock.mockReset(); transactionMock.mockReset(); });
describe('external GL domain exact minor-unit boundary', () => {
  it.each([null, true, false, [], {}, '', '  ', '1.5', '1e3', '0x10', 1.5, Infinity,
    Number.MAX_SAFE_INTEGER + 1, '9223372036854775808', '-9223372036854775809'])('rejects malformed, rounded or overflowing amount %j before SQL', async value => {
    await expect(importExternalGlEntry({ ...base, amountMinorUnits: value as unknown as string }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', name: 'ExternalGlError' });
    expect(sqlMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
  it.each([
    [0, '0'], [-100, '-100'], ['9007199254740993', '9007199254740993'],
    ['9223372036854775807', '9223372036854775807'], ['-9223372036854775808', '-9223372036854775808'],
    [BigInt('9007199254740993'), '9007199254740993'], [' +00100 ', '100'],
  ] as const)('binds supported amount %s as exact decimal %s', async (amountMinorUnits, expected) => {
    transactionMock.mockImplementation(async builder => {
      const queries = builder((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }));
      expect(queries[1].values).toContain(expected);
      return [[{ locked: 1 }], [{ id: 'entry-a', amount_minor_units: expected, import_outcome: 'IMPORTED', stale_reconciliation_count: 0 }]];
    });
    const result = await importExternalGlEntry({ ...base, amountMinorUnits });
    expect(result.entry.amount_minor_units).toBe(expected);
    expect(result.outcome).toBe('IMPORTED');
    expect(transactionMock).toHaveBeenCalledOnce();
  });
});
