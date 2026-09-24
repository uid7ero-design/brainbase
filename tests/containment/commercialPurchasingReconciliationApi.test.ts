import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const getReconciliationMock = vi.fn();
vi.mock('@/lib/commercial/purchasingReconciliation', () => ({
  getPurchaseOrderReconciliation: (...args: unknown[]) => getReconciliationMock(...args),
}));

const { GET } = await import('@/app/api/commercial/purchase-orders/[id]/reconciliation/route');

const VIEWER_SESSION = { userId: 'user-1', organisationId: 'org-a', role: 'viewer' };
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) };

function req() {
  const request = new Request('http://localhost/x');
  return Object.assign(request, { nextUrl: new URL(request.url) }) as unknown as import('next/server').NextRequest;
}
function ctx(id = 'po-1') {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  authorizeMock.mockReset();
  getReconciliationMock.mockReset();
});

describe('Phase C7.5B — purchase-order reconciliation API', () => {
  it('requires purchasing/viewer and returns a denial unchanged', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN);
    const response = await GET(req(), ctx());
    expect(response.status).toBe(403);
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer');
    expect(getReconciliationMock).not.toHaveBeenCalled();
  });

  it('passes only the authenticated organisation and route PO id to the domain', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION });
    getReconciliationMock.mockResolvedValue({
      purchaseOrderId: 'po-1', purchaseOrderStatus: 'ISSUED', currency: 'AUD',
      lineCount: 0, fullyReceivedLineCount: 0, fullyBilledLineCount: 0, reconciledLineCount: 0,
      orderedValueCents: 0, billedValueCents: 0, status: 'OPEN', exceptions: [], lines: [],
    });

    const response = await GET(req(), ctx('po-1'));
    expect(response.status).toBe(200);
    expect(getReconciliationMock).toHaveBeenCalledWith('org-a', 'po-1');
    const body = await response.json();
    expect(body.reconciliation.purchaseOrderId).toBe('po-1');
  });

  it('collapses missing/cross-tenant PO to 404', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER_SESSION });
    getReconciliationMock.mockResolvedValue(null);
    const response = await GET(req(), ctx('po-owned-by-org-b'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found.' });
  });
});
