import { beforeEach, describe, expect, it, vi } from 'vitest';

const authorizeMock = vi.fn();
vi.mock('@/lib/commercial/authorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commercial/authorize')>();
  return { ...actual, authorizeCommercialRequest: (...args: unknown[]) => authorizeMock(...args) };
});

const getSupplierBillMock = vi.fn();
vi.mock('@/lib/commercial/supplierBills', () => ({
  getSupplierBill: (...args: unknown[]) => getSupplierBillMock(...args),
}));

const getSummaryMock = vi.fn();
const recordMock = vi.fn();
const reverseMock = vi.fn();
const listAllocationsMock = vi.fn();
vi.mock('@/lib/commercial/supplierPayments', () => ({
  getSupplierBillPaymentSummary: (...args: unknown[]) => getSummaryMock(...args),
  recordSupplierPayment: (...args: unknown[]) => recordMock(...args),
  reverseSupplierPayment: (...args: unknown[]) => reverseMock(...args),
  listSupplierPaymentAllocations: (...args: unknown[]) => listAllocationsMock(...args),
}));

const { GET: paymentsGET, POST: paymentsPOST } = await import('@/app/api/commercial/supplier-bills/[id]/payments/route');
const { POST: reversePOST } = await import('@/app/api/commercial/supplier-bills/[id]/payments/[paymentId]/reverse/route');

const VIEWER = { userId: 'user-v', organisationId: 'org-a', role: 'viewer' };
const ADMIN = { userId: 'user-a', organisationId: 'org-a', role: 'admin' };
const FORBIDDEN = { ok: false as const, response: new Response(null, { status: 403 }) };
const BILL = {
  id: 'bill-1', organisation_id: 'org-a', supplier_id: 'supplier-1', currency: 'AUD', status: 'POSTED', total_cents: 10000,
};

function req(body?: unknown, method = 'POST') {
  const request = new Request('http://localhost/x', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return Object.assign(request, { nextUrl: new URL(request.url) }) as unknown as import('next/server').NextRequest;
}
function ctx<T extends Record<string, string>>(params: T) { return { params: Promise.resolve(params) }; }

beforeEach(() => {
  authorizeMock.mockReset();
  getSupplierBillMock.mockReset();
  getSummaryMock.mockReset();
  recordMock.mockReset();
  reverseMock.mockReset();
  listAllocationsMock.mockReset();
  getSupplierBillMock.mockResolvedValue(BILL);
  getSummaryMock.mockResolvedValue({
    supplier_bill_id: 'bill-1', total_cents: 10000, amount_paid_cents: 2500,
    outstanding_balance_cents: 7500, payment_state: 'PARTIALLY_PAID', active_payment_count: 1, payments: [],
  });
});

describe('AP-3 supplier payment read route', () => {
  it('requires purchasing/view and blocks before reads when authorization fails', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN);
    const res = await paymentsGET(req(undefined, 'GET'), ctx({ id: 'bill-1' }));
    expect(res.status).toBe(403);
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'viewer');
    expect(getSupplierBillMock).not.toHaveBeenCalled();
  });

  it('uses the session organisation, returns the derived summary, and is no-store', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER });
    const res = await paymentsGET(req(undefined, 'GET'), ctx({ id: 'bill-1' }));
    expect(getSupplierBillMock).toHaveBeenCalledWith('org-a', 'bill-1');
    expect(getSummaryMock).toHaveBeenCalledWith('org-a', 'bill-1');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).supplier_bill_payment_summary.payment_state).toBe('PARTIALLY_PAID');
  });

  it('returns 404 for a missing/wrong-tenant bill', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: VIEWER });
    getSupplierBillMock.mockResolvedValue(null);
    const res = await paymentsGET(req(undefined, 'GET'), ctx({ id: 'bill-1' }));
    expect(res.status).toBe(404);
    expect(getSummaryMock).not.toHaveBeenCalled();
  });
});

describe('AP-3 supplier payment record route', () => {
  it('requires purchasing/admin', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN);
    await paymentsPOST(req({ amount_cents: 100, method: 'CASH' }), ctx({ id: 'bill-1' }));
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'admin');
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('validates amount, method, reference and paid_at before recording', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    expect((await paymentsPOST(req({ amount_cents: 0, method: 'CASH' }), ctx({ id: 'bill-1' }))).status).toBe(400);
    expect((await paymentsPOST(req({ amount_cents: 100.5, method: 'CASH' }), ctx({ id: 'bill-1' }))).status).toBe(400);
    expect((await paymentsPOST(req({ amount_cents: 100, method: 'STRIPE' }), ctx({ id: 'bill-1' }))).status).toBe(400);
    expect((await paymentsPOST(req({ amount_cents: 100, method: 'CASH', reference: 7 }), ctx({ id: 'bill-1' }))).status).toBe(400);
    expect((await paymentsPOST(req({ amount_cents: 100, method: 'CASH', paid_at: 'bad' }), ctx({ id: 'bill-1' }))).status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('rejects a non-POSTED bill before the payment domain write', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    getSupplierBillMock.mockResolvedValue({ ...BILL, status: 'DRAFT' });
    const res = await paymentsPOST(req({ amount_cents: 100, method: 'CASH' }), ctx({ id: 'bill-1' }));
    expect(res.status).toBe(409);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('derives tenant, supplier and currency from trusted server state and ignores hostile body fields', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    recordMock.mockResolvedValue({ payment: { id: 'sp-1', status: 'RECORDED' }, allocations: [] });
    const res = await paymentsPOST(req({
      amount_cents: 2500, method: 'BANK_TRANSFER', organisation_id: 'org-hostile', supplier_id: 'supplier-hostile',
      currency: 'USD', provider: 'fake', provider_reference: 'fake-1',
    }), ctx({ id: 'bill-1' }));
    expect(res.status).toBe(201);
    const args = recordMock.mock.calls[0][0];
    expect(args).toMatchObject({
      organisationId: 'org-a', userId: 'user-a', supplierId: 'supplier-1', currency: 'AUD', amountCents: 2500,
      allocations: [{ supplierBillId: 'bill-1', amountCents: 2500 }],
    });
    expect(args).not.toHaveProperty('provider');
    expect(args).not.toHaveProperty('providerReference');
  });

  it('maps guarded domain conflicts to 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    recordMock.mockRejectedValue(new Error('supplier payment could not be recorded; verify every bill is POSTED, belongs to this supplier/currency, and has enough remaining balance'));
    const res = await paymentsPOST(req({ amount_cents: 9000, method: 'CASH' }), ctx({ id: 'bill-1' }));
    expect(res.status).toBe(409);
  });
});

describe('AP-3 supplier payment reversal route', () => {
  it('requires purchasing/admin and a non-empty reason', async () => {
    authorizeMock.mockResolvedValue(FORBIDDEN);
    await reversePOST(req({ reason: 'x' }), ctx({ id: 'bill-1', paymentId: 'sp-1' }));
    expect(authorizeMock).toHaveBeenCalledWith('purchasing', 'admin');

    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    const res = await reversePOST(req({ reason: '   ' }), ctx({ id: 'bill-1', paymentId: 'sp-1' }));
    expect(res.status).toBe(400);
    expect(listAllocationsMock).not.toHaveBeenCalled();
  });

  it('proves the payment belongs to the bill before reversing it', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    listAllocationsMock.mockResolvedValue([{ supplier_bill_id: 'different-bill' }]);
    const res = await reversePOST(req({ reason: 'Correction' }), ctx({ id: 'bill-1', paymentId: 'sp-1' }));
    expect(res.status).toBe(404);
    expect(reverseMock).not.toHaveBeenCalled();
  });

  it('reverses an allocated payment and returns the refreshed bill summary', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    listAllocationsMock.mockResolvedValue([{ supplier_bill_id: 'bill-1' }]);
    reverseMock.mockResolvedValue({ id: 'sp-1', status: 'REVERSED' });
    const res = await reversePOST(req({ reason: ' Correction ' }), ctx({ id: 'bill-1', paymentId: 'sp-1' }));
    expect(res.status).toBe(200);
    expect(reverseMock).toHaveBeenCalledWith(expect.objectContaining({
      organisationId: 'org-a', userId: 'user-a', supplierPaymentId: 'sp-1', reason: ' Correction ',
    }));
    expect(getSummaryMock).toHaveBeenCalledWith('org-a', 'bill-1');
  });

  it('maps an already-reversed/concurrent transition to 409', async () => {
    authorizeMock.mockResolvedValue({ ok: true, session: ADMIN });
    listAllocationsMock.mockResolvedValue([{ supplier_bill_id: 'bill-1' }]);
    reverseMock.mockRejectedValue(new Error('supplier payment already reversed, or changed concurrently'));
    const res = await reversePOST(req({ reason: 'Again' }), ctx({ id: 'bill-1', paymentId: 'sp-1' }));
    expect(res.status).toBe(409);
  });
});
