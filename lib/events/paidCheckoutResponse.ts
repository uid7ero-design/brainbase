import { NextResponse } from 'next/server';
import type { PaidCheckoutResult } from '@/lib/events/services/paidCheckout';

// The single mapping from a paid-checkout service result to the public HTTP
// response, shared by the BrainBase public checkout route and the standalone
// ticketing API so a buyer sees the same outcome through either product.

const CHECKOUT_FAILED = 'Checkout could not be started. Please try again.';

export function paidCheckoutResultResponse(result: PaidCheckoutResult): NextResponse {
  if (result.ok) return NextResponse.json({ checkout_url: result.checkoutUrl }, { status: 201 });
  switch (result.code) {
    // Generic rejection for an anonymous purchaser — never Brainbase's
    // own internal Connect-status wording (that belongs only in the
    // authenticated backend UI).
    case 'NOT_ELIGIBLE':
      return NextResponse.json({ error: 'Paid tickets are not currently available for this event.' }, { status: 503 });
    case 'TICKET_TYPE_NOT_FOUND':
      return NextResponse.json({ error: 'Selected ticket type is not available for this event.' }, { status: 400 });
    case 'TICKET_TYPE_INACTIVE':
      return NextResponse.json({ error: 'Selected ticket type is not currently available.' }, { status: 400 });
    case 'TICKET_TYPE_FREE':
      return NextResponse.json({ error: 'This ticket type is free. Use the registration flow instead.' }, { status: 400 });
    // Phase 2 — an order is all-free or all-paid (see
    // lib/events/services/cart.ts).
    case 'MIXED_FREE_AND_PAID':
      return NextResponse.json({ error: 'Free and paid tickets must be booked in separate orders.' }, { status: 400 });
    case 'CURRENCY_MISMATCH':
      return NextResponse.json({ error: 'All tickets in one order must use the same currency.' }, { status: 400 });
    case 'SESSION_NOT_FOUND':
      return NextResponse.json({ error: 'Selected session is not available for this event.' }, { status: 400 });
    case 'RESPONSES_INVALID':
      return NextResponse.json({ error: result.message }, { status: 400 });
    // Phase 4 — see the register route's identical comment: windows are
    // enforced at submit; every code failure is one generic message;
    // "can't be applied" covers not-applicable / minimum cart / payable
    // below the currency minimum (incl. 100%) / unsupported currency.
    case 'SALE_NOT_STARTED':
      return NextResponse.json({ error: 'Tickets for this selection are not on sale yet.' }, { status: 409 });
    case 'SALE_ENDED':
      return NextResponse.json({ error: 'Sales for this selection have ended.' }, { status: 409 });
    case 'ACCESS_CODE_REQUIRED':
      return NextResponse.json({ error: 'An access code is required for this selection.' }, { status: 400 });
    case 'ACCESS_CODE_INVALID':
    case 'PROMOTION_INVALID':
      return NextResponse.json({ error: 'Code not valid.' }, { status: 400 });
    case 'PROMOTION_NOT_APPLICABLE':
    case 'PROMOTION_MIN_CART':
    case 'PROMOTION_TOTAL_TOO_LOW':
    case 'PROMOTION_CURRENCY_UNSUPPORTED':
      return NextResponse.json({ error: "This code can't be applied to this order." }, { status: 400 });
    case 'PROMOTION_UNAVAILABLE':
      return NextResponse.json({ error: 'This code is no longer available.' }, { status: 409 });
    case 'CAPACITY_UNAVAILABLE':
      return NextResponse.json(
        { error: 'This ticket type is no longer available in the requested quantity.' },
        { status: 409 },
      );
    case 'STRIPE_NOT_CONFIGURED':
      return NextResponse.json({ error: 'Paid checkout is not currently available.' }, { status: 503 });
    // Phase 5A — a platform fee policy that cannot be applied safely
    // (malformed row, another currency, an absorbed fee exceeding the
    // ticket total) is a configuration fault, never the purchaser's; the
    // same generic 503 as a missing Stripe configuration, nothing reserved.
    case 'FEE_POLICY_INVALID':
    case 'FEE_CURRENCY_MISMATCH':
    case 'FEE_EXCEEDS_TOTAL':
      return NextResponse.json({ error: 'Paid checkout is not currently available.' }, { status: 503 });
    case 'ORDER_TOTAL_MISMATCH':
    case 'RESERVATION_FAILED':
    case 'RESPONSE_WRITE_FAILED':
    case 'WRITE_BACK_RACE_LOST':
    case 'STRIPE_FAILED':
      return NextResponse.json({ error: CHECKOUT_FAILED }, { status: 500 });
  }
}
