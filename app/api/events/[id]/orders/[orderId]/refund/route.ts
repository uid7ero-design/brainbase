import { NextResponse } from 'next/server';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { refundPaidOrder } from '@/lib/events/services/orderTransitions';
import { recordEventBookingActivityForOrder } from '@/lib/crm/eventSync';

type Ctx = { params: Promise<{ id: string; orderId: string }> };

// POST — full refund only (§22). manager+, matching every other
// Events mutation's role convention (see the check-in confirm route's
// identical rationale, which applies unchanged here).
//
// HTTP adapter only — the refund transition itself (historical
// connected-account refund, PAID-gated state UPDATE written only after
// Stripe confirms, audit entry) lives in
// lib/events/services/orderTransitions.ts's refundPaidOrder (extracted
// unchanged — Eve Phase 1).
//
// §23 "cancellation does not silently imply refund; if refund also
// cancels tickets, make that explicit" — this route DOES also cancel
// the order (`status = 'CANCELLED'`) as part of the same refund
// action, deliberately: a refunded paid ticket must not remain a valid
// scannable ticket (§24), and this codebase has no separate concept of
// "refunded but still admits the holder". A manager wanting to cancel
// an order WITHOUT refunding a payment that was never taken (i.e. a
// free order, or before ever charging) has no need for this route at
// all — cancellation-without-refund is not implemented in Phase 4
// because nothing in the current product model creates a paid,
// non-refundable, cancellable order; this route is the only paid-order
// cancellation path that exists, and it is unconditionally also a
// refund.
export async function POST(_req: Request, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId } = await params;

  const result = await refundPaidOrder({
    organisationId: session.organisationId,
    userId: session.userId,
    eventId,
    orderId,
    // Events -> CRM sync (Phase 5) — best-effort, never throws (see
    // lib/crm/eventSync.ts). Reads the order's own now-REFUNDED row and
    // updates its existing booking activity, if one exists, to reflect
    // that — never deletes the CRM contact, and no-ops silently if CRM
    // is disabled or the order was never linked to a contact.
    onTransitioned: recordEventBookingActivityForOrder,
  });

  if (result.ok) {
    if (result.alreadyResolved) {
      return NextResponse.json({ ok: true, note: 'Refund processed by Stripe; order state was already updated by a concurrent request.' });
    }
    return NextResponse.json({ ok: true });
  }
  switch (result.code) {
    case 'NOT_FOUND':
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    case 'NOT_REFUNDABLE':
      return NextResponse.json({ error: 'Only a paid order can be refunded.' }, { status: 409 });
    case 'STRIPE_REFUND_FAILED':
      return NextResponse.json({ error: result.error }, { status: 502 });
  }
}
