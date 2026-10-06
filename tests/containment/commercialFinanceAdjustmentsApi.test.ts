import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const createMock = vi.fn();
const postMock = vi.fn();
const reverseMock = vi.fn();
class MockFinanceAdjustmentError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
vi.mock('@/lib/commercial/financeAdjustments', () => ({
  createFinanceAdjustment: (...args: unknown[]) => createMock(...args),
  postFinanceAdjustment: (...args: unknown[]) => postMock(...args),
  reverseFinanceAdjustment: (...args: unknown[]) => reverseMock(...args),
  FinanceAdjustmentError: MockFinanceAdjustmentError,
}));

const createRoute = await import('@/app/api/commercial/budgeting/finance-adjustments/route');
const postRoute = await import('@/app/api/commercial/budgeting/finance-adjustments/[id]/post/route');
const reverseRoute = await import('@/app/api/commercial/budgeting/finance-adjustments/[id]/reverse/route');

const MANAGER = { userId: 'manager-a', organisationId: 'org-a', role: 'manager' };
const ADMIN = { userId: 'admin-a', organisationId: 'org-a', role: 'admin' };
const ctx = { params: Promise.resolve({ id: 'adjustment-1' }) };

beforeEach(() => {
  authorizeMock.mockReset();
  createMock.mockReset();
  postMock.mockReset();
  reverseMock.mockReset();
});

describe('C7.9B — finance adjustment APIs', () => {
  it('gates DRAFT creation at budgeting/createEdit and uses session tenant/user only', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER });
    createMock.mockResolvedValue({ id: 'adjustment-1', status: 'DRAFT' });

    const response = await createRoute.POST(new Request('http://localhost?organisationId=org-b', {
      method: 'POST',
      body: JSON.stringify({
        adjustmentType: 'MANUAL_FINANCE_ADJUSTMENT',
        effectiveFinancialPeriodId: 'period-1',
        currency: 'AUD',
        description: 'True up',
        reasonCode: 'MANUAL',
        lines: [{
          budgetAccountId: 'account-1',
          costCentreId: 'cc-1',
          amountExclusiveCents: '1000',
          taxCents: '100',
          amountInclusiveCents: '1100',
        }],
      }),
    }));

    expect(response.status).toBe(201);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'manager');
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      organisationId: 'org-a',
      userId: 'manager-a',
      effectiveFinancialPeriodId: 'period-1',
    }));
  });

  it.each([401, 403, 503])('preserves posting authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await postRoute.POST(new Request('http://localhost', { method: 'POST' }), ctx);
    expect(response.status).toBe(status);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('requires budgeting/administer for POST and trusts only the session tenant', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    postMock.mockResolvedValue({ id: 'adjustment-1', status: 'POSTED' });
    const response = await postRoute.POST(
      new Request('http://localhost?organisationId=org-b', { method: 'POST' }),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(postMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      userId: 'admin-a',
      financeAdjustmentId: 'adjustment-1',
    });
  });

  it('requires budgeting/administer for reversal and forwards period + reason', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    reverseMock.mockResolvedValue({ id: 'reversal-1', status: 'POSTED' });
    const response = await reverseRoute.POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ reversalFinancialPeriodId: 'period-2', reason: 'Correction' }),
    }), ctx);

    expect(response.status).toBe(200);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(reverseMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      userId: 'admin-a',
      financeAdjustmentId: 'adjustment-1',
      reversalFinancialPeriodId: 'period-2',
      reason: 'Correction',
    });
  });

  it('returns missing/cross-tenant adjustment as tenant-safe 404', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    postMock.mockRejectedValue(new MockFinanceAdjustmentError('NOT_FOUND', 'details'));
    const response = await postRoute.POST(new Request('http://localhost', { method: 'POST' }), ctx);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found.' });
  });

  it('returns lifecycle/closed-period posting conflicts as 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    postMock.mockRejectedValue(new MockFinanceAdjustmentError('PERIOD_CLOSED', 'Closed.'));
    const response = await postRoute.POST(new Request('http://localhost', { method: 'POST' }), ctx);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PERIOD_CLOSED' });
  });

  it('requires a reversal period and reason at the route boundary', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    const response = await reverseRoute.POST(
      new Request('http://localhost', { method: 'POST', body: '{}' }),
      ctx,
    );
    expect(response.status).toBe(400);
    expect(reverseMock).not.toHaveBeenCalled();
  });
});

const validDraft = {
  adjustmentType: 'MANUAL_FINANCE_ADJUSTMENT', effectiveFinancialPeriodId: 'period-1',
  currency: 'AUD', description: 'Correction', reasonCode: 'MANUAL',
  lines: [{ budgetAccountId: 'account-1', costCentreId: 'cc-1', amountExclusiveCents: '100', taxCents: '0', amountInclusiveCents: '100' }],
};
describe('finance adjustment field boundaries', () => {
  const invalidFields = [
    ...['adjustmentType', 'effectiveFinancialPeriodId', 'currency', 'description', 'reasonCode',
      'referenceFinancialPeriodId', 'sourceType', 'sourceId'].map(field => ({ ...validDraft, [field]: 42 })),
    { ...validDraft, adjustmentType: 'UNKNOWN' },
    ...[null, [], true, 'line'].map(line => ({ ...validDraft, lines: [line] })),
    ...['budgetAccountId', 'costCentreId', 'sourceSupplierBillLineId', 'narrative'].map(field => ({
      ...validDraft, lines: [{ ...validDraft.lines[0], [field]: 42 }],
    })),
    ...['amountExclusiveCents', 'taxCents', 'amountInclusiveCents'].flatMap(field =>
      [null, true, [], {}].map(value => ({ ...validDraft, lines: [{ ...validDraft.lines[0], [field]: value }] }))),
  ];
  it.each(invalidFields)('rejects malformed fields before creating a draft %#', async body => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER });
    const response = await createRoute.POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }));
    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
  it('rejects a non-string reversal period before domain access', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    const response = await reverseRoute.POST(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ reversalFinancialPeriodId: 42, reason: 'Correction' }),
    }), ctx);
    expect(response.status).toBe(400);
    expect(reverseMock).not.toHaveBeenCalled();
  });
  it('preserves optional null text and integer zero fields in a valid draft', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER });
    createMock.mockResolvedValue({ id: 'adjustment-1' });
    const body = { ...validDraft, referenceFinancialPeriodId: null, sourceType: null, sourceId: null,
      lines: [{ ...validDraft.lines[0], taxCents: 0, narrative: null }] };
    const response = await createRoute.POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }));
    expect(response.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ lines: body.lines }));
  });
});
