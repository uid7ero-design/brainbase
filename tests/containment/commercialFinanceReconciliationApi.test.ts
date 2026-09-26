import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const prepareMock = vi.fn();
const reviewMock = vi.fn();
class MockFinanceReconciliationError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
vi.mock('@/lib/commercial/financeReconciliation', () => ({
  prepareFinanceReconciliation: (...args: unknown[]) => prepareMock(...args),
  reviewFinanceReconciliation: (...args: unknown[]) => reviewMock(...args),
  FinanceReconciliationError: MockFinanceReconciliationError,
}));

const prepareRoute = await import('@/app/api/commercial/budgeting/reconciliations/prepare/route');
const reviewRoute = await import('@/app/api/commercial/budgeting/reconciliations/[id]/review/route');

const MANAGER = { userId: 'manager-a', organisationId: 'org-a', role: 'manager' };
const ADMIN = { userId: 'admin-a', organisationId: 'org-a', role: 'admin' };
const ctx = { params: Promise.resolve({ id: 'recon-1' }) };

beforeEach(() => {
  authorizeMock.mockReset();
  prepareMock.mockReset();
  reviewMock.mockReset();
});

describe('C7.9E2 — reconciliation prepare/review APIs', () => {
  it.each([401, 403, 503])('preserves prepare authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await prepareRoute.POST(new Request('http://localhost', { method: 'POST' }));
    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'manager');
    expect(prepareMock).not.toHaveBeenCalled();
  });

  it('prepares with manager authorization and authenticated tenant/user only', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER });
    prepareMock.mockResolvedValue({ id: 'recon-1', status: 'PREPARED' });

    const response = await prepareRoute.POST(new Request(
      'http://localhost?organisationId=org-b',
      {
        method: 'POST',
        body: JSON.stringify({
          financialPeriodId: 'period-1',
          sourceSystemId: 'xero',
          currency: 'aud',
          notes: 'Month-end preparation',
          organisationId: 'org-b',
        }),
      },
    ));

    expect(response.status).toBe(201);
    expect(prepareMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      userId: 'manager-a',
      financialPeriodId: 'period-1',
      sourceSystemId: 'xero',
      currency: 'aud',
      notes: 'Month-end preparation',
    });
  });

  it.each([401, 403, 503])('preserves review authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await reviewRoute.POST(
      new Request('http://localhost', { method: 'POST' }),
      ctx,
    );
    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(reviewMock).not.toHaveBeenCalled();
  });

  it('reviews with admin authorization and authenticated tenant/user only', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    reviewMock.mockResolvedValue({ id: 'recon-1', status: 'REVIEWED' });

    const response = await reviewRoute.POST(
      new Request('http://localhost?organisationId=org-b', { method: 'POST' }),
      ctx,
    );

    expect(response.status).toBe(200);
    expect(reviewMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      userId: 'admin-a',
      reconciliationId: 'recon-1',
    });
  });

  it('maps prepare invalid input to 400 and collapses missing/cross-tenant state to 404', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER });
    prepareMock.mockRejectedValueOnce(new MockFinanceReconciliationError('INVALID_INPUT', 'bad'));
    const invalid = await prepareRoute.POST(new Request('http://localhost', {
      method: 'POST',
      body: '{}',
    }));
    expect(invalid.status).toBe(400);

    prepareMock.mockRejectedValueOnce(new MockFinanceReconciliationError('NOT_FOUND', 'tenant detail'));
    const notFound = await prepareRoute.POST(new Request('http://localhost', {
      method: 'POST',
      body: '{}',
    }));
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: 'Not found.' });
  });

  it('maps review lifecycle conflict to 409 and missing/cross-tenant reconciliation to generic 404', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    reviewMock.mockRejectedValueOnce(
      new MockFinanceReconciliationError('INVALID_STATE', 'Only PREPARED can be reviewed.'),
    );
    const conflict = await reviewRoute.POST(
      new Request('http://localhost', { method: 'POST' }),
      ctx,
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'INVALID_STATE' });

    reviewMock.mockRejectedValueOnce(new MockFinanceReconciliationError('NOT_FOUND', 'tenant detail'));
    const notFound = await reviewRoute.POST(
      new Request('http://localhost', { method: 'POST' }),
      ctx,
    );
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: 'Not found.' });
  });
});
