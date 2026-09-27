import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const getReportMock = vi.fn();
vi.mock('@/lib/commercial/budgetActualCommitted', () => ({
  getBudgetActualCommittedReport: (...args: unknown[]) => getReportMock(...args),
}));

const { GET } = await import('@/app/api/commercial/budgeting/consumption/route');

beforeEach(() => {
  authorizeMock.mockReset();
  getReportMock.mockReset();
});

describe('C7.8D — combined Budget consumption API', () => {
  it.each([401, 403, 503])('returns authorization denial %s unchanged and never reads', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });

    const response = await GET();

    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'viewer');
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it('uses only the authenticated organisation and returns source plus finance-adjusted rows', async () => {
    authorizeMock.mockResolvedValue({
      ok: true,
      session: { userId: 'user-a', organisationId: 'org-a', role: 'viewer' },
    });
    getReportMock.mockResolvedValue({
      rows: [{ budgetId: 'b-1', actualCents: 2500, committedCents: 7500, exposureCents: 10000 }],
      financeRows: [{
        budgetAccountId: 'acc-1',
        sourceActualCents: '2500',
        financeAdjustmentCents: '500',
        effectiveActualCents: '3000',
        committedCents: '7500',
        exposureCents: '10500',
        externalGlActualCents: null,
        reconciliationVarianceCents: null,
      }],
      exceptions: [{ source: 'ACTUAL', exception: { codes: ['UNMAPPED_ACCOUNT'] } }],
      resolvedActualCount: 1,
      resolvedCommitmentCount: 1,
      unresolvedExceptionCount: 1,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(getReportMock).toHaveBeenCalledWith('org-a', null);
    expect(await response.json()).toMatchObject({
      report: {
        rows: [{ actualCents: 2500, committedCents: 7500, exposureCents: 10000 }],
        financeRows: [{
          sourceActualCents: '2500',
          financeAdjustmentCents: '500',
          effectiveActualCents: '3000',
          committedCents: '7500',
          exposureCents: '10500',
          externalGlActualCents: null,
          reconciliationVarianceCents: null,
        }],
        exceptions: [{ source: 'ACTUAL', exception: { codes: ['UNMAPPED_ACCOUNT'] } }],
        unresolvedExceptionCount: 1,
      },
    });
  });

  it('passes only the requested external source identifier while ignoring tenant-shaped query input', async () => {
    authorizeMock.mockResolvedValue({
      ok: true,
      session: { userId: 'user-a', organisationId: 'org-a', role: 'viewer' },
    });
    getReportMock.mockResolvedValue({ rows: [], financeRows: [], exceptions: [] });

    const response = await GET(new Request(
      'http://localhost/api/commercial/budgeting/consumption?sourceSystemId=xero&organisationId=org-b',
    ));

    expect(response.status).toBe(200);
    expect(getReportMock).toHaveBeenCalledWith('org-a', 'xero');
  });
});
