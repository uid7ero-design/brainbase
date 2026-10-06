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

    const response = await GET(new Request('http://localhost/api/commercial/budgeting/consumption'));

    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'viewer');
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it('preserves backward-compatible rows and returns the complete financeRows contract with null external GL values', async () => {
    authorizeMock.mockResolvedValue({
      ok: true,
      session: { userId: 'user-a', organisationId: 'org-a', role: 'viewer' },
    });
    const legacyRow = {
      budgetId: 'b-1',
      budgetVersionId: 'v-1',
      budgetAccountId: 'acc-1',
      budgetAccountCode: 'OPEX',
      budgetAccountName: 'Operating',
      costCentreId: 'cc-1',
      financialPeriodId: 'fp-1',
      currency: 'AUD',
      budgetCents: 12000,
      actualCents: 2500,
      committedCents: 7500,
      exposureCents: 10000,
      budgetLessActualCents: 9500,
      budgetLessActualAndCommittedCents: 2000,
    };
    const financeRow = {
      budgetId: 'b-1',
      budgetVersionId: 'v-1',
      budgetAccountId: 'acc-1',
      budgetAccountCode: 'OPEX',
      budgetAccountName: 'Operating',
      financialYearId: 'fy-1',
      financialYearName: 'FY26',
      financialPeriodId: 'fp-1',
      financialPeriodName: 'September',
      currency: 'AUD',
      taxBasis: 'INCLUSIVE',
      periodisationMode: 'PERIODISED',
      budgetCents: '12000',
      sourceActualCents: '2500',
      financeAdjustmentCents: '500',
      effectiveActualCents: '3000',
      committedCents: '7500',
      exposureCents: '10500',
      externalGlActualCents: null,
      reconciliationVarianceCents: null,
      reconciliationId: null,
      reconciliationStatus: null,
      sourceSystemId: null,
    };
    getReportMock.mockResolvedValue({
      rows: [legacyRow],
      financeRows: [financeRow],
      exceptions: [{ source: 'ACTUAL', exception: { codes: ['UNMAPPED_ACCOUNT'] } }],
      resolvedActualCount: 1,
      resolvedCommitmentCount: 1,
      unresolvedExceptionCount: 1,
    });

    const response = await GET(new Request('http://localhost/api/commercial/budgeting/consumption'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getReportMock).toHaveBeenCalledWith('org-a', null);
    expect(body.report.rows).toEqual([legacyRow]);
    expect(body.report.financeRows).toEqual([financeRow]);
    expect(body.report.exceptions).toEqual([
      { source: 'ACTUAL', exception: { codes: ['UNMAPPED_ACCOUNT'] } },
    ]);
    expect(body.report.unresolvedExceptionCount).toBe(1);
  });

  it('keeps stale reconciliation evidence visible in financeRows without rewriting it as signed off', async () => {
    authorizeMock.mockResolvedValue({
      ok: true,
      session: { userId: 'user-a', organisationId: 'org-a', role: 'viewer' },
    });
    getReportMock.mockResolvedValue({
      rows: [],
      financeRows: [{
        budgetId: 'b-1',
        budgetVersionId: 'v-1',
        budgetAccountId: 'acc-1',
        budgetAccountCode: 'OPEX',
        budgetAccountName: 'Operating',
        financialYearId: 'fy-1',
        financialYearName: 'FY26',
        financialPeriodId: 'fp-1',
        financialPeriodName: 'September',
        currency: 'AUD',
        taxBasis: 'INCLUSIVE',
        periodisationMode: 'PERIODISED',
        budgetCents: '12000',
        sourceActualCents: '2500',
        financeAdjustmentCents: '500',
        effectiveActualCents: '3000',
        committedCents: '7500',
        exposureCents: '10500',
        externalGlActualCents: '3050',
        reconciliationVarianceCents: '-50',
        reconciliationId: 'recon-stale-1',
        reconciliationStatus: 'STALE',
        sourceSystemId: 'xero',
      }],
      exceptions: [],
      resolvedActualCount: 0,
      resolvedCommitmentCount: 0,
      unresolvedExceptionCount: 0,
    });

    const response = await GET(new Request(
      'http://localhost/api/commercial/budgeting/consumption?sourceSystemId=xero',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getReportMock).toHaveBeenCalledWith('org-a', 'xero');
    expect(body.report.financeRows).toEqual([expect.objectContaining({
      externalGlActualCents: '3050',
      reconciliationVarianceCents: '-50',
      reconciliationId: 'recon-stale-1',
      reconciliationStatus: 'STALE',
      sourceSystemId: 'xero',
    })]);
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
