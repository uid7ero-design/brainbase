import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const getWorkspaceMock = vi.fn();
const createAllocationMock = vi.fn();
const reverseAllocationMock = vi.fn();
vi.mock('@/lib/commercial/purchaseMatchAllocations', () => ({
  getPurchaseMatchWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
  createPurchaseMatchAllocation: (...args: unknown[]) => createAllocationMock(...args),
  reversePurchaseMatchAllocation: (...args: unknown[]) => reverseAllocationMock(...args),
}));

const { GET, POST } = await import('@/app/api/commercial/purchase-orders/[id]/matches/route');
const { POST: reversePOST } = await import('@/app/api/commercial/purchase-orders/[id]/matches/[allocationId]/reverse/route');

const VIEWER = { userId: 'viewer-1', organisationId: 'org-a', role: 'viewer' };
const MANAGER = { userId: 'manager-1', organisationId: 'org-a', role: 'manager' };
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) };
function req(body?: unknown, method = 'GET') {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const request = new Request('http://localhost/x', init);
  return Object.assign(request, { nextUrl: new URL(request.url) }) as unknown as import('next/server').NextRequest;
}
function ctx(id = 'po-1') { return { params: Promise.resolve({ id }) }; }
function reverseCtx(id = 'po-1', allocationId = 'alloc-1') {
  return { params: Promise.resolve({ id, allocationId }) };
}

beforeEach(() => {
  authorizeMock.mockReset();
  getWorkspaceMock.mockReset();
  createAllocationMock.mockReset();
  reverseAllocationMock.mockReset();
});

describe('Phase C7.5D3 — purchase match API authorization and tenancy', () => {
  it('GET uses purchasing/viewer while create and reverse use purchasing/manager', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN);
    await GET(req(), ctx());
    expect(authorizeMock).toHaveBeenLastCalledWith('purchasing', 'viewer');
    await POST(req({ purchaseReceiptLineId: 'r1', supplierBillLineId: 'b1', quantity: '1' }, 'POST'), ctx());
    expect(authorizeMock).toHaveBeenLastCalledWith('purchasing', 'manager');
    await reversePOST(req({ reason: 'Correction' }, 'POST'), reverseCtx());
    expect(authorizeMock).toHaveBeenLastCalledWith('purchasing', 'manager');
    expect(getWorkspaceMock).not.toHaveBeenCalled();
    expect(createAllocationMock).not.toHaveBeenCalled();
    expect(reverseAllocationMock).not.toHaveBeenCalled();
  });

  it('GET passes only authenticated org + route PO id and collapses missing/cross-tenant to 404', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER });
    getWorkspaceMock.mockResolvedValueOnce({ receiptLines: [], billLines: [], allocations: [] });
    expect((await GET(req(), ctx('po-1'))).status).toBe(200);
    expect(getWorkspaceMock).toHaveBeenCalledWith('org-a', 'po-1');

    getWorkspaceMock.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx('po-owned-by-b'))).status).toBe(404);
  });

  it('create binds authenticated org/user and URL parent PO to the mutation', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER });
    createAllocationMock.mockResolvedValue({ id: 'alloc-1', quantity_allocated: '1.2500' });
    const response = await POST(req({ purchaseReceiptLineId: 'receipt-line-1', supplierBillLineId: 'bill-line-1', quantity: '1.25' }, 'POST'), ctx('po-1'));
    expect(response.status).toBe(201);
    expect(createAllocationMock).toHaveBeenCalledWith({
      organisationId: 'org-a', userId: 'manager-1', purchaseOrderId: 'po-1',
      purchaseReceiptLineId: 'receipt-line-1', supplierBillLineId: 'bill-line-1', quantity: '1.25',
    });
  });

  it('reverse binds authenticated org/user and both URL ids to the mutation', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: MANAGER });
    reverseAllocationMock.mockResolvedValue({ id: 'alloc-1', reversed_at: 'now' });
    const response = await reversePOST(req({ reason: '  Wrong bill  ' }, 'POST'), reverseCtx('po-1', 'alloc-1'));
    expect(response.status).toBe(200);
    expect(reverseAllocationMock).toHaveBeenCalledWith({
      organisationId: 'org-a', userId: 'manager-1', purchaseOrderId: 'po-1', allocationId: 'alloc-1', reason: '  Wrong bill  ',
    });
  });
});

describe('Phase C7.5D3 — purchase match API validation/outcomes', () => {
  beforeEach(() => authorizeMock.mockResolvedValue({ ok: true, session: MANAGER }));

  it('rejects incomplete create bodies before the domain', async () => {
    expect((await POST(req({ quantity: '1' }, 'POST'), ctx())).status).toBe(400);
    expect((await POST(req({ purchaseReceiptLineId: 'r1', supplierBillLineId: 'b1' }, 'POST'), ctx())).status).toBe(400);
    expect(createAllocationMock).not.toHaveBeenCalled();
  });
  it('maps cross-line/cross-parent candidate lookup to 404 and active/concurrent conflicts to 409', async () => {
    createAllocationMock.mockRejectedValueOnce(new Error('receipt line and supplier bill line must exist in this organisation and reference the same purchase order line'));
    expect((await POST(req({ purchaseReceiptLineId: 'r1', supplierBillLineId: 'b1', quantity: '1' }, 'POST'), ctx())).status).toBe(404);

    createAllocationMock.mockRejectedValueOnce(new Error('an active allocation already exists for this receipt line and supplier bill line'));
    expect((await POST(req({ purchaseReceiptLineId: 'r1', supplierBillLineId: 'b1', quantity: '1' }, 'POST'), ctx())).status).toBe(409);
  });

  it('requires reversal reason and returns 404 for missing/cross-parent/already-reversed allocation', async () => {
    expect((await reversePOST(req({ reason: '   ' }, 'POST'), reverseCtx())).status).toBe(400);
    expect(reverseAllocationMock).not.toHaveBeenCalled();

    reverseAllocationMock.mockResolvedValueOnce(null);
    expect((await reversePOST(req({ reason: 'Correction' }, 'POST'), reverseCtx('po-wrong', 'alloc-1'))).status).toBe(404);
  });
});
