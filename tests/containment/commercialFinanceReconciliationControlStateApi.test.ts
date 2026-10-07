import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
const listMock = vi.fn();

vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return {
    ...actual,
    authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args),
  };
});

class MockFinanceReconciliationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

vi.mock('@/lib/commercial/financeReconciliation', () => ({
  listLatestFinanceReconciliations: (...args: unknown[]) => listMock(...args),
  FinanceReconciliationError: MockFinanceReconciliationError,
}));

const route = await import(
  '@/app/api/commercial/budgeting/reconciliations/control-state/route'
);

const ADMIN = { userId: 'admin-a', organisationId: 'org-a', role: 'admin' };

beforeEach(() => {
  authorizeMock.mockReset();
  listMock.mockReset();
});

describe('C7.9E — reconciliation control-state API', () => {
  it.each([401, 403, 503])('preserves admin authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({
      ok: false,
      response: new Response(null, { status }),
    });

    const response = await route.GET(new Request('http://localhost'));

    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(listMock).not.toHaveBeenCalled();
  });

  it('uses only the session tenant and forwards explicit control filters', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    listMock.mockResolvedValue([{
      id: 'recon-1',
      financialPeriodId: '78888888-0000-0000-0000-000000000001',
      sourceSystemId: 'xero',
      currency: 'AUD',
      status: 'REVIEWED',
      unresolvedItemCount: 0,
    }]);

    const response = await route.GET(new Request(
      'http://localhost?organisationId=org-b'
      + '&sourceSystemId=xero'
      + '&status=REVIEWED'
      + '&financialPeriodId=78888888-0000-0000-0000-000000000001'
      + '&currency=aud',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      reconciliations: [{
        id: 'recon-1',
        financialPeriodId: '78888888-0000-0000-0000-000000000001',
        sourceSystemId: 'xero',
        currency: 'AUD',
        status: 'REVIEWED',
        unresolvedItemCount: 0,
      }],
    });
    expect(listMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      sourceSystemId: 'xero',
      status: 'REVIEWED',
      financialPeriodId: '78888888-0000-0000-0000-000000000001',
      currency: 'aud',
    });
  });

  it('returns clean PREPARED or REVIEWED states even when unresolved count is zero', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    listMock.mockResolvedValue([
      { id: 'clean-prepared', status: 'PREPARED', unresolvedItemCount: 0 },
      { id: 'clean-reviewed', status: 'REVIEWED', unresolvedItemCount: 0 },
    ]);

    const response = await route.GET(new Request('http://localhost'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reconciliations: [
        { id: 'clean-prepared', status: 'PREPARED', unresolvedItemCount: 0 },
        { id: 'clean-reviewed', status: 'REVIEWED', unresolvedItemCount: 0 },
      ],
    });
  });

  it('rejects invalid status without querying control state', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });

    const response = await route.GET(new Request('http://localhost?status=UNKNOWN'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid reconciliation status.' });
    expect(listMock).not.toHaveBeenCalled();
  });

  it('maps invalid period or currency filters to 400', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    listMock.mockRejectedValue(
      new MockFinanceReconciliationError(
        'INVALID_INPUT',
        'Financial period must be a valid UUID.',
      ),
    );

    const response = await route.GET(
      new Request('http://localhost?financialPeriodId=bad-id'),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Financial period must be a valid UUID.',
    });
  });
});
