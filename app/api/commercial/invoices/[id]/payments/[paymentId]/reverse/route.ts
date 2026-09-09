import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { reverseInvoicePayment, getInvoicePaymentSummary } from '@/lib/commercial/payments';
import { getInvoice } from '@/lib/commercial/invoices';

type Ctx = { params: Promise<{ id: string; paymentId: string }> };

// Phase C5.2 — reverses (never deletes) exactly one RECORDED payment.
// COMMERCIAL_MIN_ROLE.approve — the same higher-trust floor
// app/api/commercial/invoices/[id]/void/route.ts already requires for
// its own "undo a committed financial action" operation; a payment
// reversal is the same class of correction, not an ordinary edit.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.approve);
  if (!auth.ok) return auth.response;
  const { id: invoiceId, paymentId } = await params;

  const body = await req.json().catch(() => ({}));
  const { reason } = body;
  if (typeof reason !== 'string' || !reason.trim()) {
    return NextResponse.json({ error: 'A reversal reason is required.' }, { status: 400 });
  }

  try {
    const payment = await reverseInvoicePayment({
      organisationId: auth.session.organisationId, userId: auth.session.userId, invoiceId, paymentId, reason,
    });
    const invoice = await getInvoice(auth.session.organisationId, invoiceId);
    const summary = invoice
      ? await getInvoicePaymentSummary(auth.session.organisationId, invoiceId, invoice.total_cents)
      : null;
    return NextResponse.json({ payment, invoice_payment_summary: summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reverse payment.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('already reversed') || message.includes('concurrently')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
