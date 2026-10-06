import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinanceAdjustmentLineInput } from '@/lib/commercial/financeAdjustments';

const sqlMock = vi.hoisted(() => Object.assign(vi.fn(() => []), { transaction: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: sqlMock }));
const { createFinanceAdjustment } = await import('@/lib/commercial/financeAdjustments');
const base = {
  organisationId: 'org-a', userId: 'user-a', adjustmentType: 'MANUAL_FINANCE_ADJUSTMENT' as const,
  effectiveFinancialPeriodId: 'period-a', currency: 'AUD', description: 'Correction', reasonCode: 'MANUAL',
};
const line = { budgetAccountId: 'account-a', costCentreId: 'cc-a', amountExclusiveCents: '0', taxCents: '0', amountInclusiveCents: '0' };
beforeEach(() => { vi.clearAllMocks(); });
describe('finance adjustment minor-unit input types', () => {
  it.each([null, true, false, [], {}, '', '  ', 1.5, Number.MAX_SAFE_INTEGER + 1, '1.5'])('rejects coercible or non-integer amount %j before SQL', async value => {
    const input = { ...line, amountExclusiveCents: value, amountInclusiveCents: value } as unknown as FinanceAdjustmentLineInput;
    await expect(createFinanceAdjustment({ ...base, lines: [input] }))
      .rejects.toMatchObject({ code: 'INVALID_AMOUNT', name: 'FinanceAdjustmentError' });
    expect(sqlMock).not.toHaveBeenCalled();
    expect(sqlMock.transaction).not.toHaveBeenCalled();
  });
  it.each(['0', '-100', '9007199254740993', 0, -100, BigInt('9007199254740993')])('preserves valid exact amount %s', async value => {
    sqlMock.transaction.mockImplementation(async callback => {
      callback(sqlMock);
      return [[{ id: 'period-a', status: 'OPEN' }], [{ id: 'draft-a' }], [], [], [{ id: 'draft-a' }]];
    });
    const result = await createFinanceAdjustment({ ...base, lines: [{ ...line, amountExclusiveCents: value, amountInclusiveCents: value }] });
    expect(result.id).toBe('draft-a');
    expect(sqlMock.transaction).toHaveBeenCalledOnce();
  });
});
