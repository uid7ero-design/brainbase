import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const getCommitmentMock = vi.fn();
vi.mock('@/lib/commercial/purchasingCommitments', () => ({
  getPurchaseOrderCommitment: (...args: unknown[]) => getCommitmentMock(...args),
}));

const { GET } = await import('@/app/api/commercial/purchase-orders/[id]/commitment/route');

const VIEWER_SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'viewer' };
const UNAUTHENTICATED = { ok: false as const, response: new Response(null, { status: 401 }) };
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) };
const UNAVAILABLE = { ok: false as const, response: new Response(null, { status: 503 }) };

function req() {
  const request = new Request('http://localhost/x');
  return Object.assign(request, { nextUrl: new URL(request.url) }) as unknown as import('next/server').NextRequest;
}
function ctx(id = 'po-1') {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  authorizeMock.mockReset();
  getCommitmentMock.mockReset();
});

describe('Phase C7.6C — purchase-order commitment API', () => {
  it.each([
    ['unauthenticated', UNAUTHENTICATED, 401],
    ['forbidden', FORBIDDEN, 403],
    ['capability service unavailable', UNAVAILABLE, 503],
  ])('returns %s authorization denial unchanged and never calls the domain', async (_label, denial, status) => {
    authorizeMock.mockResolvedValue(denial);

    const response = await GET(req(), ctx());

    expect(response.status).toBe(status);
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer');
    expect(getCommitmentMock).not.toHaveBeenCalled();
  });

  it('passes only the authenticated organisation and route PO id to the commitment reader', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION });
    getCommitmentMock.mockResolvedValue({
      purchaseOrderId: 'po-1',
      purchaseOrderStatus: 'ISSUED',
      supplierId: 'supplier-1',
      currency: 'AUD',
      commitmentEffectiveAt: '2026-09-25T00:00:00.000Z',
      periodResolution: 'UNRESOLVED',
      lineCount: 1,
      orderedSubtotalCents: 10000,
      orderedTaxCents: 0,
      orderedTotalCents: 10000,
      billedSubtotalCents: 4000,
      billedTaxCents: 0,
      billedTotalCents: 4000,
      outstandingSubtotalCents: 6000,
      outstandingTaxCents: 0,
      outstandingTotalCents: 6000,
      lines: [],
    });

    const response = await GET(req(), ctx('po-1'));

    expect(response.status).toBe(200);
    expect(getCommitmentMock).toHaveBeenCalledTimes(1);
    expect(getCommitmentMock).toHaveBeenCalledWith('org-a', 'po-1');
    const body = await response.json();
    expect(body.commitment).toMatchObject({
      purchaseOrderId: 'po-1',
      periodResolution: 'UNRESOLVED',
      outstandingTotalCents: 6000,
    });
  });

  it('collapses a missing or cross-tenant purchase order to the same 404', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION });
    getCommitmentMock.mockResolvedValue(null);

    const response = await GET(req(), ctx('po-owned-by-org-b'));

    expect(response.status).toBe(404);
    expect(getCommitmentMock).toHaveBeenCalledWith('org-a', 'po-owned-by-org-b');
    expect(await response.json()).toEqual({ error: 'Not found.' });
  });
});
