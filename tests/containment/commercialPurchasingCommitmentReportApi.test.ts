import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const getReportMock = vi.fn();
vi.mock('@/lib/commercial/purchasingCommitments', () => ({
  getPurchaseCommitmentReport: (...args: unknown[]) => getReportMock(...args),
}));

const { GET } = await import('@/app/api/commercial/budgeting/commitments/route');

const VIEWER_SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'viewer' };
const UNAUTHENTICATED = { ok: false as const, response: new Response(null, { status: 401 }) };
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) };
const UNAVAILABLE = { ok: false as const, response: new Response(null, { status: 503 }) };

function req(url = 'http://localhost/api/commercial/budgeting/commitments') {
  const request = new Request(url);
  return Object.assign(request, { nextUrl: new URL(request.url) }) as unknown as import('next/server').NextRequest;
}
beforeEach(() => {
  authorizeMock.mockReset();
  getReportMock.mockReset();
});

describe('Phase C7.6D — budgeting commitment report API', () => {
  it.each([
    ['unauthenticated', UNAUTHENTICATED, 401],
    ['forbidden', FORBIDDEN, 403],
    ['capability service unavailable', UNAVAILABLE, 503],
  ])('returns %s authorization denial unchanged and never reads the report', async (_label, denial, status) => {
    authorizeMock.mockResolvedValue(denial);

    const response = await GET(req());

    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('budgeting', 'viewer');
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it('uses only the authenticated organisation for the cross-PO report', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION });
    getReportMock.mockResolvedValue({
      periodResolution: 'UNRESOLVED',
      purchaseOrderCount: 1,
      lineCount: 1,
      currencies: [{
        currency: 'AUD',
        purchaseOrderCount: 1,
        lineCount: 1,
        orderedTotalCents: 10000,
        billedTotalCents: 2500,
        outstandingTotalCents: 7500,
      }],
      purchaseOrders: [],
    });

    const response = await GET(req('http://localhost/api/commercial/budgeting/commitments?organisationId=org-b'));

    expect(response.status).toBe(200);
    expect(getReportMock).toHaveBeenCalledTimes(1);
    expect(getReportMock).toHaveBeenCalledWith('org-a');
    const body = await response.json();
    expect(body.report).toMatchObject({
      periodResolution: 'UNRESOLVED',
      purchaseOrderCount: 1,
    });
  });

  it('returns an empty report as 200 rather than leaking tenant existence through 404 semantics', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION });
    getReportMock.mockResolvedValue({
      periodResolution: 'UNRESOLVED',
      purchaseOrderCount: 0,
      lineCount: 0,
      currencies: [],
      purchaseOrders: [],
    });

    const response = await GET(req());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      report: {
        periodResolution: 'UNRESOLVED',
        purchaseOrderCount: 0,
        lineCount: 0,
        currencies: [],
        purchaseOrders: [],
      },
    });
  });
});
