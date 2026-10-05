import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getSupplier } from '@/lib/commercial/suppliers';
import { getSupplierApBills } from '@/lib/commercial/supplierApOverview';
import { recordSupplierPayment } from '@/lib/commercial/supplierPayments';
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/commercial/paymentMethods';
import { MAX_REMITTANCE_CENTS } from '@/lib/commercial/supplierRemittanceInput';
type Ctx = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'no-store' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reply(error: string, status: number) { return NextResponse.json({ error }, { status, headers }); }
export async function GET(_request: Request, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) { auth.response.headers.set('Cache-Control', 'no-store'); return auth.response; }
  const { id } = await params;
  if (!uuid.test(id)) return reply('Supplier not found.', 404);
  try {
    const supplier = await getSupplier(auth.session.organisationId, id);
    if (!supplier) return reply('Supplier not found.', 404);
    const bills = (await getSupplierApBills(auth.session.organisationId, id)).map(bill => {
      const remaining = BigInt(bill.payable_cents) - BigInt(bill.paid_cents);
      if (remaining < BigInt(0)) throw new Error('Negative balance');
      return { ...bill, outstanding_cents: remaining.toString() };
    }).filter(bill => BigInt(bill.outstanding_cents) > BigInt(0));
    return NextResponse.json({ supplier: { id: supplier.id, name: supplier.name, active: supplier.active }, bills }, { headers });
  } catch { return reply('Unable to load supplier payment candidates.', 500); }
}
export async function POST(request: Request, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.approve);
  if (!auth.ok) { auth.response.headers.set('Cache-Control', 'no-store'); return auth.response; }
  const { id } = await params;
  if (!uuid.test(id)) return reply('Supplier not found.', 404);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply('A payment object is required.', 400);
  const { currency, method, reference, paid_at: paidAt, allocations } = body;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return reply('A three-letter currency is required.', 400);
  if (!(PAYMENT_METHODS as readonly unknown[]).includes(method)) return reply('A valid payment method is required.', 400);
  if (reference != null && typeof reference !== 'string') return reply('reference must be a string.', 400);
  if (paidAt != null && (typeof paidAt !== 'string' || Number.isNaN(Date.parse(paidAt)))) return reply('paid_at must be a valid date/time.', 400);
  if (!Array.isArray(allocations) || !allocations.length || allocations.length > 100) return reply('Choose between 1 and 100 bill allocations.', 400);
  const seen = new Set<string>();
  let total = 0;
  for (const allocation of allocations) {
    if (!allocation || typeof allocation !== 'object' || typeof allocation.supplier_bill_id !== 'string' || !uuid.test(allocation.supplier_bill_id) ||
      !Number.isSafeInteger(allocation.amount_cents) || allocation.amount_cents <= 0 || seen.has(allocation.supplier_bill_id.toLowerCase())) {
      return reply('Each bill must appear once with a positive integer allocation.', 400);
    }
    seen.add(allocation.supplier_bill_id.toLowerCase()); total += allocation.amount_cents;
    if (total > MAX_REMITTANCE_CENTS) return reply('Remittance total exceeds the supported range.', 400);
  }
  try {
    if (!await getSupplier(auth.session.organisationId, id)) return reply('Supplier not found.', 404);
    const result = await recordSupplierPayment({ organisationId: auth.session.organisationId, userId: auth.session.userId,
      supplierId: id, amountCents: total, currency, method: method as PaymentMethod,
      allocations: allocations.map((allocation: { supplier_bill_id: string; amount_cents: number }) => ({ supplierBillId: allocation.supplier_bill_id, amountCents: allocation.amount_cents })),
      reference: reference ?? null, paidAt: paidAt ?? null });
    return NextResponse.json(result, { status: 201, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('could not be recorded')) return reply('Payment not recorded. Refresh balances and verify supplier, currency, POSTED status and allocations.', 409);
    return reply('Unable to confirm supplier payment. Check bill payment history before retrying.', 500);
  }
}
