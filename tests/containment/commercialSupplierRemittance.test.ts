import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRemittanceAmount } from '@/lib/commercial/supplierRemittanceInput';
const authorize = vi.fn(); const supplier = vi.fn(); const bills = vi.fn(); const record = vi.fn();
vi.mock('@/lib/commercial/authorize', () => ({ authorizeCommercialRequest: (...args: unknown[]) => authorize(...args), COMMERCIAL_MIN_ROLE: { view: 'viewer', approve: 'admin' } }));
vi.mock('@/lib/commercial/suppliers', () => ({ getSupplier: (...args: unknown[]) => supplier(...args) }));
vi.mock('@/lib/commercial/supplierApOverview', () => ({ getSupplierApBills: (...args: unknown[]) => bills(...args) }));
vi.mock('@/lib/commercial/supplierPayments', () => ({ recordSupplierPayment: (...args: unknown[]) => record(...args) }));
const { GET, POST } = await import('@/app/api/commercial/suppliers/[id]/payments/route');
const id = '00000000-0000-0000-0000-000000000101';
const b1 = '00000000-0000-0000-0000-000000000201'; const b2 = '00000000-0000-0000-0000-000000000202';
const ctx = { params: Promise.resolve({ id }) };
const body = () => ({ currency: 'AUD', method: 'BANK_TRANSFER', reference: 'REM1', allocations: [{ supplier_bill_id: b1, amount_cents: 2500 }, { supplier_bill_id: b2, amount_cents: 5000 }] });
const key = '00000000-0000-0000-0000-000000000301';
const request = (value: unknown) => new Request('http://localhost/', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(value) });
beforeEach(() => { vi.clearAllMocks(); authorize.mockResolvedValue({ ok: true, session: { organisationId: 'org-a', userId: 'u1' } }); supplier.mockResolvedValue({ id, name: 'Supplier', active: false }); record.mockResolvedValue({ payment: { id: 'p1' }, allocations: [] }); });
describe('Supplier remittance inputs', () => {
  it.each([['0.01', 1], ['25.10', 2510], ['12', 1200], ['21474836.47', 2147483647]])('parses %s exactly', (value, cents) => expect(parseRemittanceAmount(String(value))).toBe(cents));
  it.each(['1.001', '1e3', '-1', '0', 'NaN', '12oops', '21474836.48'])('rejects %s', value => expect(() => parseRemittanceAmount(value)).toThrow());
});
describe('Supplier remittance API', () => {
  it('denies mutations before supplier or payment reads', async () => {
    authorize.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request(body()), ctx)).status).toBe(403);
    expect(authorize).toHaveBeenCalledWith('purchasing', 'admin'); expect(supplier).not.toHaveBeenCalled(); expect(record).not.toHaveBeenCalled();
  });
  it('derives supplier and tenant from context and total from allocations, ignoring client authority fields', async () => {
    const res = await POST(request({ ...body(), supplier_id: 'other', organisation_id: 'other', amount_cents: 1, provider: 'untrusted' }), ctx);
    expect(res.status).toBe(201); expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(record).toHaveBeenCalledWith({ organisationId: 'org-a', userId: 'u1', supplierId: id, amountCents: 7500, currency: 'AUD', method: 'BANK_TRANSFER', reference: 'REM1', paidAt: null, idempotencyKey: key,
      allocations: [{ supplierBillId: b1, amountCents: 2500 }, { supplierBillId: b2, amountCents: 5000 }] });
  });
  it.each([null, [], { ...body(), allocations: [] }, { ...body(), allocations: [{ supplier_bill_id: b1, amount_cents: 0 }] },
    { ...body(), allocations: [{ supplier_bill_id: b1, amount_cents: 2500 }, { supplier_bill_id: b1, amount_cents: 5000 }] },
    { ...body(), allocations: [{ supplier_bill_id: b1, amount_cents: 2147483648 }] }, { ...body(), method: 'FAKE' }, { ...body(), paid_at: 'nope' }])('rejects invalid request %# without mutation', async value => {
    expect((await POST(request(value), ctx)).status).toBe(400); expect(record).not.toHaveBeenCalled();
  });
  it('hides cross-tenant/missing suppliers', async () => { supplier.mockResolvedValue(null); expect((await POST(request(body()), ctx)).status).toBe(404); expect(record).not.toHaveBeenCalled(); });
  it('rejects the same UUID with different casing as a duplicate bill', async () => {
    const bill = 'aaaaaaaa-0000-0000-0000-000000000201';
    const res = await POST(request({ ...body(), allocations: [{ supplier_bill_id: bill, amount_cents: 100 }, { supplier_bill_id: bill.toUpperCase(), amount_cents: 100 }] }), ctx);
    expect(res.status).toBe(400); expect(record).not.toHaveBeenCalled();
  });
  it('maps authoritative balance conflicts to refreshable 409', async () => { record.mockRejectedValueOnce(new Error('supplier payment could not be recorded')); expect((await POST(request(body()), ctx)).status).toBe(409); });
  it.each([null, 'invalid'])('requires a UUID retry key (%s) before mutation', async value => {
    const req = request(body());
    if (value === null) req.headers.delete('Idempotency-Key'); else req.headers.set('Idempotency-Key', value);
    expect((await POST(req, ctx)).status).toBe(400); expect(record).not.toHaveBeenCalled();
  });
  it('returns a conflict when a retry key is reused with different details', async () => {
    record.mockRejectedValueOnce(new Error('Idempotency key was already used for a different payment'));
    expect((await POST(request(body()), ctx)).status).toBe(409);
  });
  it('reads only outstanding posted candidates for the session supplier, including inactive suppliers', async () => {
    bills.mockResolvedValue([{ payable_cents: '10000', paid_cents: '2500', bill_id: b1 }, { payable_cents: '5000', paid_cents: '5000', bill_id: b2 }]);
    const res = await GET(new Request('http://localhost/'), ctx);
    expect(authorize).toHaveBeenCalledWith('purchasing', 'viewer'); expect(bills).toHaveBeenCalledWith('org-a', id);
    const data = await res.json(); expect(data.bills).toHaveLength(1); expect(data.bills[0].outstanding_cents).toBe('7500'); expect(data.supplier.active).toBe(false);
  });
});
