import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const closeMock = vi.fn();
const reopenMock = vi.fn();
const listClosesMock = vi.fn();
const listYearsMock = vi.fn();
const listYearClosesMock = vi.fn();
const listPeriodsMock = vi.fn();
const setYearStatusMock = vi.fn();
class MockFinanceCloseError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
vi.mock('@/lib/commercial/financeClose', () => ({
  closeFinancialPeriod: (...args: unknown[]) => closeMock(...args),
  reopenFinancialPeriod: (...args: unknown[]) => reopenMock(...args),
  listFinancialPeriodCloses: (...args: unknown[]) => listClosesMock(...args),
  FinanceCloseError: MockFinanceCloseError,
}));
vi.mock('@/lib/commercial/financialPeriods', () => ({
  listFinancialYears: (...args: unknown[]) => listYearsMock(...args),
  listFinancialYearCloses: (...args: unknown[]) => listYearClosesMock(...args),
  listFinancialPeriods: (...args: unknown[]) => listPeriodsMock(...args),
  setFinancialYearStatus: (...args: unknown[]) => setYearStatusMock(...args),
  FinancialYearStatusError: MockFinanceCloseError,
}));

const listRoute = await import('@/app/api/commercial/budgeting/financial-periods/route');
const closeRoute = await import('@/app/api/commercial/budgeting/financial-periods/[id]/close/route');
const reopenRoute = await import('@/app/api/commercial/budgeting/financial-periods/[id]/reopen/route');
const yearCloseRoute = await import('@/app/api/commercial/budgeting/financial-years/[id]/close/route');
const yearReopenRoute = await import('@/app/api/commercial/budgeting/financial-years/[id]/reopen/route');

const ADMIN = { userId: 'user-a', organisationId: 'org-a', role: 'admin' };
const ctx = { params: Promise.resolve({ id: 'period-1' }) };

beforeEach(() => {
  authorizeMock.mockReset();
  closeMock.mockReset();
  reopenMock.mockReset();
  listClosesMock.mockReset();
  listYearsMock.mockReset();
  listYearClosesMock.mockReset();
  listPeriodsMock.mockReset();
  setYearStatusMock.mockReset();
});

describe('C7.9A — finance close/reopen APIs', () => {
  it.each([401, 403, 503])('preserves period-list authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });

    const response = await listRoute.GET();

    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(listYearsMock).not.toHaveBeenCalled();
    expect(listYearClosesMock).not.toHaveBeenCalled();
    expect(listPeriodsMock).not.toHaveBeenCalled();
    expect(listClosesMock).not.toHaveBeenCalled();
  });

  it('lists tenant-scoped years with periods and durable close history for admins', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    listYearsMock.mockResolvedValue([
      { id: 'fy-1', organisation_id: 'org-a', name: 'FY26', status: 'OPEN' },
      { id: 'fy-2', organisation_id: 'org-a', name: 'FY25', status: 'CLOSED' },
    ]);
    listYearClosesMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'year-close-1', organisation_id: 'org-a', financial_year_id: 'fy-2', close_sequence: 1, status: 'CLOSED' },
      ]);
    listPeriodsMock
      .mockResolvedValueOnce([
        { id: 'period-1', organisation_id: 'org-a', financial_year_id: 'fy-1', name: 'September', status: 'CLOSED' },
      ])
      .mockResolvedValueOnce([]);
    listClosesMock.mockResolvedValue([
      { id: 'close-1', organisation_id: 'org-a', financial_period_id: 'period-1', close_sequence: 1, status: 'CLOSED' },
    ]);

    const response = await listRoute.GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      years: [
        {
          id: 'fy-1',
          organisation_id: 'org-a',
          name: 'FY26',
          status: 'OPEN',
          closes: [],
          periods: [{
            id: 'period-1',
            organisation_id: 'org-a',
            financial_year_id: 'fy-1',
            name: 'September',
            status: 'CLOSED',
            closes: [{
              id: 'close-1',
              organisation_id: 'org-a',
              financial_period_id: 'period-1',
              close_sequence: 1,
              status: 'CLOSED',
            }],
          }],
        },
        {
          id: 'fy-2',
          organisation_id: 'org-a',
          name: 'FY25',
          status: 'CLOSED',
          closes: [{
            id: 'year-close-1',
            organisation_id: 'org-a',
            financial_year_id: 'fy-2',
            close_sequence: 1,
            status: 'CLOSED',
          }],
          periods: [],
        },
      ],
    });
    expect(listYearsMock).toHaveBeenCalledWith('org-a');
    expect(listYearClosesMock).toHaveBeenNthCalledWith(1, 'org-a', 'fy-1');
    expect(listYearClosesMock).toHaveBeenNthCalledWith(2, 'org-a', 'fy-2');
    expect(listPeriodsMock).toHaveBeenNthCalledWith(1, 'org-a', 'fy-1');
    expect(listPeriodsMock).toHaveBeenNthCalledWith(2, 'org-a', 'fy-2');
    expect(listClosesMock).toHaveBeenCalledWith('org-a', 'period-1');
  });


  it.each([401, 403, 503])('preserves financial-year close authorization denial %s', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const response = await yearCloseRoute.POST(
      new Request('http://localhost', { method: 'POST' }),
      { params: Promise.resolve({ id: 'fy-1' }) },
    );
    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'admin');
    expect(setYearStatusMock).not.toHaveBeenCalled();
  });

  it('uses only authenticated tenant/user for financial-year close', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    setYearStatusMock.mockResolvedValue({ id: 'fy-1', status: 'CLOSED' });
    const response = await yearCloseRoute.POST(
      new Request('http://localhost?organisationId=org-b', {
        method: 'POST',
        body: JSON.stringify({ reason: 'Year end' }),
      }),
      { params: Promise.resolve({ id: 'fy-1' }) },
    );
    expect(response.status).toBe(200);
    expect(setYearStatusMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      userId: 'user-a',
      financialYearId: 'fy-1',
      status: 'CLOSED',
      reason: 'Year end',
    });
  });

  it('requires a financial-year reopen reason and maps it to a stable 400', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    setYearStatusMock.mockRejectedValue(
      new MockFinanceCloseError('REOPEN_REASON_REQUIRED', 'A financial year reopen reason is required.'),
    );
    const response = await yearReopenRoute.POST(
      new Request('http://localhost', { method: 'POST', body: '{}' }),
      { params: Promise.resolve({ id: 'fy-1' }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'REOPEN_REASON_REQUIRED' });
  });

  it('returns 404 when the financial year is outside the authenticated tenant', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    setYearStatusMock.mockResolvedValue(null);
    const response = await yearCloseRoute.POST(
      new Request('http://localhost', { method: 'POST' }),
      { params: Promise.resolve({ id: 'fy-other' }) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found.' });
  });

  it('returns financial-year close precondition failures as 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    setYearStatusMock.mockRejectedValue(
      new MockFinanceCloseError('OPEN_PERIODS_EXIST', 'All financial periods must be CLOSED.'),
    );
    const response = await yearCloseRoute.POST(
      new Request('http://localhost', { method: 'POST' }),
      { params: Promise.resolve({ id: 'fy-1' }) },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'OPEN_PERIODS_EXIST' });
  });

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
