import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const getReportMock = vi.fn();
vi.mock('@/lib/commercial/budgetCommitmentResolver', () => ({
  getBudgetCommitmentConsumption: (...args: unknown[]) => getReportMock(...args),
}));

const { GET } = await import('@/app/api/commercial/budgeting/consumption/route');

beforeEach(() => {
  authorizeMock.mockReset();
  getReportMock.mockReset();
});

describe('C7.7E — Budget commitment consumption API', () => {
  it.each([401, 403, 503])('returns authorization denial %s unchanged and never resolves', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });

    const response = await GET();

    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'viewer');
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it('uses only the authenticated organisation and exposes explicit exceptions', async () => {
    authorizeMock.mockResolvedValue({
      ok: true,
      session: { userId: 'user-a', organisationId: 'org-a', role: 'viewer' },
    });
    getReportMock.mockResolvedValue({
      resolved: [],
      rows: [],
      exceptions: [{ code: 'UNMAPPED_ACCOUNT', purchaseOrderLineId: 'pol-1' }],
      resolvedCommitmentCount: 0,
      unresolvedExceptionCount: 1,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(getReportMock).toHaveBeenCalledWith('org-a');
    expect(await response.json()).toMatchObject({
      report: {
        unresolvedExceptionCount: 1,
        exceptions: [{ code: 'UNMAPPED_ACCOUNT' }],
      },
    });
  });
});
