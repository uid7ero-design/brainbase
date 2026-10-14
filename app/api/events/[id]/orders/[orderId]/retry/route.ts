import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { retryPendingOrderCheckout, type RetryCheckoutResult } from '@/lib/events/services/retryCheckout';

type Ctx = { params: Promise<{ id: string; orderId: string }> };

// User-facing text for every non-SAFE classifyRetrySafety() outcome —
// deliberately no Stripe object ids, status enums, or raw error text
// (see the double-charge-guard comment in
// lib/events/services/retryCheckout.ts).
const RETRY_BLOCKED_MESSAGES: Record<string, string> = {
  UNSAFE_ALREADY_PAID: 'Stripe reports this payment has already succeeded. Retry was blocked to prevent a duplicate charge.',
  UNSAFE_STILL_ACTIVE: 'The existing payment attempt is still active. Retry is not available yet.',
  UNSAFE_PROCESSING: 'Stripe is still processing this payment. Retry is not available yet.',
  UNSAFE_AMBIGUOUS: 'Payment status could not be verified with Stripe. Retry was blocked for safety.',
};

function toResponse(result: RetryCheckoutResult): NextResponse {
  if (result.ok) return NextResponse.json({ checkout_url: result.checkoutUrl });
  switch (result.code) {
    case 'EVENT_NOT_FOUND':
    case 'ORDER_NOT_FOUND':
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    case 'EVENT_CANCELLED':
      return NextResponse.json({ error: 'This event has been cancelled.' }, { status: 409 });
    case 'NOT_PENDING':
      return NextResponse.json({ error: 'Only a pending payment can be retried.' }, { status: 409 });
    case 'NO_STRIPE_ACCOUNT':
      return NextResponse.json({ error: 'This order has no associated Stripe account to retry against.' }, { status: 409 });
    case 'NO_LINE_ITEM':
      return NextResponse.json({ error: 'Order has no ticket line item.' }, { status: 409 });
    case 'TICKET_TYPE_UNAVAILABLE':
      return NextResponse.json({ error: 'The ticket type for this order is no longer available.' }, { status: 409 });
    case 'RETRY_BLOCKED':
      return NextResponse.json({ error: RETRY_BLOCKED_MESSAGES[result.decision] }, { status: 409 });
    case 'REACQUISITION_FAILED':
      return NextResponse.json({ error: 'Could not retry payment. Please try again.' }, { status: 500 });
    case 'CAPACITY_UNAVAILABLE':
      return NextResponse.json({ error: 'This ticket type is no longer available in the requested quantity.' }, { status: 409 });
    case 'STRIPE_NOT_CONFIGURED':
      return NextResponse.json({ error: 'Stripe is not currently configured.' }, { status: 503 });
    case 'WRITE_BACK_RACE_LOST':
    case 'STRIPE_FAILED':
      return NextResponse.json({ error: 'Could not create a new checkout session. Please try again.' }, { status: 500 });
  }
}

// POST — retry payment for a PENDING order (§A.2). manager+.
//
// HTTP adapter only. The double-charge guard, the atomic capacity
// reacquisition, both compare-and-set concurrency guards and the
// guarded Stripe write-back live in lib/events/services/retryCheckout.ts
// (extracted unchanged — Eve Phase 1), together with the full design
// notes that previously headed this file. This route authorises,
// builds the branded return URLs from the tenant-scoped slugs the
// service supplies (never from client input — there is deliberately no
// slug input read anywhere in this route), and maps the result to the
// exact same status codes and response bodies as before.
export async function POST(_req: Request, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId } = await params;

  const result = await retryPendingOrderCheckout({
    organisationId: session.organisationId,
    eventId,
    orderId,
    buildReturnUrls: async (orgSlug, eventSlug) => {
      const h = await headers();
      const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
      const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
      const origin = `${proto}://${host}`;
      return {
        successUrl: `${origin}/e/${orgSlug}/${eventSlug}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/e/${orgSlug}/${eventSlug}?checkout=cancelled`,
      };
    },
  });

  return toResponse(result);
}
