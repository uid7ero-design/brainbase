import { NextRequest, NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { recordInvoicePayment, isValidPaymentMethod } from '@/lib/commercial/payments';
import { isValidCents } from '@/lib/commercial/money';

type Ctx = { params: Promise<{ id: string }> };

// Phase C5.2 — records exactly one payment against an ISSUED invoice.
// Same capability + role floor as every other invoice-mutation route
// (COMMERCIAL_MIN_ROLE.createEdit) — payments remain part of the
// existing `invoicing` capability, no new capability was introduced.
// organisationId comes exclusively from the authenticated session
// (authorizeCommercialRequest) — never from the request body.
//
// provider/provider_reference are deliberately NOT read from this
// route's request body at all — those columns exist only as a
// forward-compatible slot for a future automated
// provider/accounting-import integration (see
// scripts/create-commercial-payments.sql's own header), which would
// call recordInvoicePayment() directly from a webhook handler, not
// through this ordinary manual "Record Payment" UI route. Keeping
// them server-controlled and absent from this contract now means no
// client can ever forge a provider attribution for a manually-entered
// payment.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('invoicing', COMMERCIAL_MIN_ROLE.createEdit);
  if (!auth.ok) return auth.response;
  const { id: invoiceId } = await params;

  const body = await req.json().catch(() => ({}));
  const { amount_cents: amountCents, method, reference, received_at: receivedAt } = body;

  if (typeof amountCents !== 'number' || !isValidCents(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: 'amount_cents is required and must be a positive integer.' }, { status: 400 });
  }
  if (!isValidPaymentMethod(method)) {
    return NextResponse.json({ error: 'A valid payment method is required.' }, { status: 400 });
  }
  if (reference !== undefined && reference !== null && typeof reference !== 'string') {
    return NextResponse.json({ error: 'reference must be a string.' }, { status: 400 });
  }
  if (receivedAt !== undefined && receivedAt !== null) {
    if (typeof receivedAt !== 'string' || isNaN(Date.parse(receivedAt))) {
      return NextResponse.json({ error: 'received_at must be a valid date/time.' }, { status: 400 });
    }
  }

  try {
    const { payment, summary } = await recordInvoicePayment({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      invoiceId,
      amountCents,
      method,
      reference: reference ?? null,
      receivedAt: receivedAt ?? null,
    });
    return NextResponse.json({ payment, invoice_payment_summary: summary }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to record payment.';
    if (message.includes('not found')) return NextResponse.json({ error: message }, { status: 404 });
    if (message.includes('DRAFT') || message.includes('VOID')) return NextResponse.json({ error: message }, { status: 409 });
    if (message.includes('exceeds remaining balance')) return NextResponse.json({ error: message }, { status: 409 });
    if (message.includes('concurrently') || message.includes('retry')) return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// No GET on this collection route — payment history for an invoice is
// already returned as part of GET /api/commercial/invoices/[id] (see
// that route's own extension), so a second, separate listing endpoint
// would just be a duplicate read path. Deliberately no PUT/PATCH/DELETE
// either — payments are immutable once recorded; correction is only
// via POST .../[paymentId]/reverse.
