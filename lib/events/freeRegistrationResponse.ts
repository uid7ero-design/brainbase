import { NextResponse } from 'next/server';
import type { FreeRegistrationResult } from '@/lib/events/services/freeRegistration';

// The single mapping from a free-registration service result to the public
// HTTP response, shared by the BrainBase public register route and the
// standalone ticketing API so a buyer sees the same outcome through either
// product (the free-flow counterpart of paidCheckoutResponse.ts).
export function freeRegistrationResultResponse(result: FreeRegistrationResult): NextResponse {
  if (result.ok) {
    // booking_token is the exact value minted and persisted by the same
    // atomic transaction (never a second token, never regenerated here) —
    // returned so a multi-attendee confirmation screen can offer the
    // booking-wallet link alongside the individual ticket links.
    return NextResponse.json(
      { confirmation_reference: result.orderId, quantity: result.quantity, tickets: result.tickets, booking_token: result.bookingToken },
      { status: 201 },
    );
  }
  switch (result.code) {
    case 'TICKET_TYPE_NOT_FOUND':
      return NextResponse.json({ error: 'Selected ticket type is not available for this event.' }, { status: 400 });
    case 'TICKET_TYPE_INACTIVE':
      return NextResponse.json({ error: 'Selected ticket type is not currently available.' }, { status: 400 });
    case 'TICKET_TYPE_REQUIRES_PAYMENT':
      return NextResponse.json({ error: 'This ticket type requires payment. Use the checkout flow instead.' }, { status: 400 });
    // An order is all-free or all-paid (see lib/events/services/cart.ts).
    case 'MIXED_FREE_AND_PAID':
      return NextResponse.json({ error: 'Free and paid tickets must be booked in separate orders.' }, { status: 400 });
    case 'SESSION_NOT_FOUND':
      return NextResponse.json({ error: 'Selected session is not available for this event.' }, { status: 400 });
    case 'RESPONSES_INVALID':
      return NextResponse.json({ error: result.message }, { status: 400 });
    // Sale windows are enforced server-side at submit; access and promotion
    // codes fail with ONE generic message regardless of why, so the public
    // API never reveals which codes exist elsewhere.
    case 'SALE_NOT_STARTED':
      return NextResponse.json({ error: 'Tickets for this selection are not on sale yet.' }, { status: 409 });
    case 'SALE_ENDED':
      return NextResponse.json({ error: 'Sales for this selection have ended.' }, { status: 409 });
    // The event itself is over: neutral wording, nothing was reserved.
    case 'EVENT_ENDED':
      return NextResponse.json({ error: 'This event has ended.' }, { status: 409 });
    case 'ACCESS_CODE_REQUIRED':
      return NextResponse.json({ error: 'An access code is required for this selection.' }, { status: 400 });
    case 'ACCESS_CODE_INVALID':
      return NextResponse.json({ error: 'Code not valid.' }, { status: 400 });
    case 'PROMOTION_NOT_APPLICABLE':
      return NextResponse.json({ error: "This code can't be applied to this order." }, { status: 400 });
    // A DB/transaction failure must fail safely — never leak SQL, lock
    // state, organisation ids, or capability internals to an anonymous caller.
    case 'TRANSACTION_FAILED':
      return NextResponse.json({ error: 'Registration could not be completed. Please try again.' }, { status: 500 });
    case 'CAPACITY_UNAVAILABLE':
      return NextResponse.json({ error: 'This ticket type is no longer available in the requested quantity.' }, { status: 409 });
  }
}
