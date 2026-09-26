import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const closeMock = vi.fn();
const reopenMock = vi.fn();
class MockFinanceCloseError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
vi.mock('@/lib/commercial/financeClose', () => ({
  closeFinancialPeriod: (...args: unknown[]) => closeMock(...args),
  reopenFinancialPeriod: (...args: unknown[]) => reopenMock(...args),
  FinanceCloseError: MockFinanceCloseError,
}));

const closeRoute = await import('@/app/api/commercial/budgeting/financial-periods/[id]/close/route');
const reopenRoute = await import('@/app/api/commercial/budgeting/financial-periods/[id]/reopen/route');

const ADMIN = { userId: 'user-a', organisationId: 'org-a', role: 'admin' };
const ctx = { params: Promise.resolve({ id: 'period-1' }) };

beforeEach(() => {
  authorizeMock.mockReset();
  closeMock.mockReset();
  reopenMock.mockReset();
});

describe('C7.9A — finance close/reopen APIs', () => {
  it.each([401, 403, 503])('preserves close authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await closeRoute.POST(new Request('http://localhost', { method: 'POST' }), ctx);
    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('uses only authenticated tenant/user for close', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    closeMock.mockResolvedValue({ id: 'close-1', status: 'CLOSED' });
    const response = await closeRoute.POST(
      new Request('http://localhost?organisationId=org-b', {
        method: 'POST',
        body: JSON.stringify({ reason: 'Month end' }),
      }),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(closeMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      userId: 'user-a',
      financialPeriodId: 'period-1',
      reason: 'Month end',
    });
  });

  it('requires admin authorization for reopen and forwards mandatory reason', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    reopenMock.mockResolvedValue({ id: 'close-1', status: 'INVALIDATED' });
    const response = await reopenRoute.POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ reason: 'Correct misclassification' }),
      }),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(reopenMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      userId: 'user-a',
      financialPeriodId: 'period-1',
      reason: 'Correct misclassification',
    });
  });

  it('returns missing reopen reason as a stable 400', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    reopenMock.mockRejectedValue(new MockFinanceCloseError('REOPEN_REASON_REQUIRED', 'A reopen reason is required.'));
    const response = await reopenRoute.POST(
      new Request('http://localhost', { method: 'POST', body: '{}' }),
      ctx,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'REOPEN_REASON_REQUIRED' });
  });

  it('collapses cross-tenant/missing period to 404', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    closeMock.mockRejectedValue(new MockFinanceCloseError('NOT_FOUND', 'details'));
    const response = await closeRoute.POST(new Request('http://localhost', { method: 'POST' }), ctx);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found.' });
  });
});
