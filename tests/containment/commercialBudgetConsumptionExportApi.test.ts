import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const getReportMock = vi.fn();
vi.mock('@/lib/commercial/budgetActualCommitted', () => ({
  getBudgetActualCommittedReport: (...args: unknown[]) => getReportMock(...args),
}));

const { GET } = await import('@/app/api/commercial/budgeting/consumption/export/route');

const legacyRow = {
  budgetAccountCode: 'OPEX',
  budgetAccountName: 'Operating costs',
  costCentreCode: 'OPS',
  costCentreName: 'Operations',
  financialYearName: 'FY26',
  financialPeriodName: 'September',
  currency: 'AUD',
  budgetCents: 12000,
  actualCents: 2500,
  committedCents: 7500,
  exposureCents: 10000,
  budgetLessActualCents: 9500,
  budgetLessActualAndCommittedCents: 2000,
};

const financeRow = {
  budgetAccountCode: 'OPEX',
  budgetAccountName: 'Operating costs',
  financialYearName: 'FY26',
  financialPeriodName: 'September',
  currency: 'AUD',
  budgetCents: '12000',
  sourceActualCents: '2500',
  financeAdjustmentCents: '500',
  effectiveActualCents: '3000',
  committedCents: '7500',
  exposureCents: '10500',
  externalGlActualCents: null,
  reconciliationVarianceCents: null,
  reconciliationStatus: null,
  sourceSystemId: null,
};

function report(overrides: Record<string, unknown> = {}) {
  return {
    rows: [legacyRow],
    financeRows: [financeRow],
    exceptions: [],
    resolvedActualCount: 1,
    resolvedCommitmentCount: 1,
    unresolvedExceptionCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  authorizeMock.mockReset();
  getReportMock.mockReset();
});

describe('C7.9F — Budget consumption CSV export API', () => {
  it.each([401, 403, 503])('preserves authorization denial %s and never reads the report', async status => {
    authorizeMock.mockResolvedValue({ ok: false, response: new Response(null, { status }) });

    const response = await GET(new Request(
      'http://localhost/api/commercial/budgeting/consumption/export?view=finance',
    ));

    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'viewer');
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an unsupported export view without reading report data', async () => {
    authorizeMock.mockResolvedValue({
      ok: true,
      session: { organisationId: 'org-a', userId: 'user-a', role: 'viewer' },
    });

    const response = await GET(new Request(
      'http://localhost/api/commercial/budgeting/consumption/export?view=unknown',
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'view must be legacy or finance.' });
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it('exports financeRows as CSV with attachment headers and empty cells for null external GL evidence', async () => {
    authorizeMock.mockResolvedValue({
      ok: true,
      session: { organisationId: 'org-a', userId: 'user-a', role: 'viewer' },
    });
    getReportMock.mockResolvedValue(report());

    const response = await GET(new Request(
      'http://localhost/api/commercial/budgeting/consumption/export?view=finance&sourceSystemId=xero&organisationId=org-b',
    ));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="brainbase-budget-finance.csv"',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(getReportMock).toHaveBeenCalledWith('org-a', 'xero');
    expect(body).toContain('Source Actual cents,Finance Adjustments cents,Effective Actual cents');
    expect(body).toContain(
      'OPEX,Operating costs,FY26,September,AUD,12000,2500,500,3000,7500,10500,,,,',
    );
  });

  it('exports stale reconciliation status with its historical GL amount and variance', async () => {
    authorizeMock.mockResolvedValue({
      ok: true,
      session: { organisationId: 'org-a', userId: 'user-a', role: 'viewer' },
    });
    getReportMock.mockResolvedValue(report({
      financeRows: [{
        ...financeRow,
        externalGlActualCents: '3050',
        reconciliationVarianceCents: '-50',
        reconciliationStatus: 'STALE',
        sourceSystemId: 'xero',
      }],
    }));

    const response = await GET(new Request(
      'http://localhost/api/commercial/budgeting/consumption/export?view=finance&sourceSystemId=xero',
    ));
    const body = await response.text();

    expect(body).toContain(',3050,');
    expect(body).toContain("'-50,STALE,xero");
    expect(body).not.toContain('SIGNED_OFF');
  });

  it('preserves the legacy rows export and ignores source-system and tenant-shaped query input for that view', async () => {
    authorizeMock.mockResolvedValue({
      ok: true,
      session: { organisationId: 'org-a', userId: 'user-a', role: 'viewer' },
    });
    getReportMock.mockResolvedValue(report());

    const response = await GET(new Request(
      'http://localhost/api/commercial/budgeting/consumption/export?view=legacy&sourceSystemId=xero&organisationId=org-b',
    ));
    const body = await response.text();

    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="brainbase-budget-consumption.csv"',
    );
    expect(getReportMock).toHaveBeenCalledWith('org-a', null);
    expect(body).toContain(
      'OPEX,Operating costs,OPS,Operations,FY26,September,AUD,12000,2500,7500,10000,9500,2000',
    );
    expect(body).not.toContain('Finance Adjustments cents');
    expect(body).not.toContain('Reconciliation status');
  });
});
