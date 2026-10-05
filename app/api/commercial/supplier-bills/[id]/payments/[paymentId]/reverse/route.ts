import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import {
  getSupplierBillPaymentSummary,
  listSupplierPaymentAllocations,
  reverseSupplierPayment,
} from '@/lib/commercial/supplierPayments';

type Ctx = { params: Promise<{ id: string; paymentId: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.approve);
  if (!auth.ok) return auth.response;
  const { id: supplierBillId, paymentId } = await params;

  const body = await req.json().catch(() => ({}));
  const { reason } = body;
  if (typeof reason !== 'string' || !reason.trim()) {
    return NextResponse.json({ error: 'A reversal reason is required.' }, { status: 400 });
  }

  const allocations = await listSupplierPaymentAllocations(auth.session.organisationId, paymentId);
  if (!allocations.some(allocation => allocation.supplier_bill_id === supplierBillId)) {
    return NextResponse.json({ error: 'Supplier payment not found for this bill.' }, { status: 404 });
  }

  try {
    const payment = await reverseSupplierPayment({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      supplierPaymentId: paymentId,
      reason,
    });
    const summary = await getSupplierBillPaymentSummary(auth.session.organisationId, supplierBillId);
    return NextResponse.json({ payment, supplier_bill_payment_summary: summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reverse supplier payment.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('already reversed') || message.includes('concurrently')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
