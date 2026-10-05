import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { isValidCents } from '@/lib/commercial/money';
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/commercial/paymentMethods';
import { getSupplierBill } from '@/lib/commercial/supplierBills';
import { getSupplierBillPaymentSummary, recordSupplierPayment } from '@/lib/commercial/supplierPayments';

type Ctx = { params: Promise<{ id: string }> };

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const bill = await getSupplierBill(auth.session.organisationId, id);
  if (!bill) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

  const summary = await getSupplierBillPaymentSummary(auth.session.organisationId, id);
  if (!summary) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

  return NextResponse.json(
    { supplier_bill_payment_summary: summary },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.approve);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const bill = await getSupplierBill(auth.session.organisationId, id);
  if (!bill) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { amount_cents: amountCents, method, reference, paid_at: paidAt } = body;

  if (typeof amountCents !== 'number' || !isValidCents(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: 'amount_cents is required and must be a positive integer.' }, { status: 400 });
  }
  if (!isPaymentMethod(method)) {
    return NextResponse.json({ error: 'A valid payment method is required.' }, { status: 400 });
  }
  if (reference !== undefined && reference !== null && typeof reference !== 'string') {
    return NextResponse.json({ error: 'reference must be a string.' }, { status: 400 });
  }
  if (paidAt !== undefined && paidAt !== null && (typeof paidAt !== 'string' || Number.isNaN(Date.parse(paidAt)))) {
    return NextResponse.json({ error: 'paid_at must be a valid date/time.' }, { status: 400 });
  }

  if (bill.status !== 'POSTED') {
    return NextResponse.json({ error: 'Supplier bill must be POSTED before recording a payment.' }, { status: 409 });
  }

  try {
    const { payment } = await recordSupplierPayment({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      supplierId: bill.supplier_id,
      amountCents,
      currency: bill.currency,
      method,
      allocations: [{ supplierBillId: id, amountCents }],
      reference: reference ?? null,
      paidAt: paidAt ?? null,
    });
    const summary = await getSupplierBillPaymentSummary(auth.session.organisationId, id);
    return NextResponse.json({ payment, supplier_bill_payment_summary: summary }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to record supplier payment.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('could not be recorded') || message.includes('remaining balance') || message.includes('POSTED')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
