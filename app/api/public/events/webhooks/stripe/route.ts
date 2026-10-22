import { NextRequest, NextResponse, after } from 'next/server';
import { constructWebhookEvent, processStripeWebhookEvent, StripeNotConfiguredError } from '@/lib/events/stripe';
import { attemptAutomaticTicketEmail } from '@/lib/events/ticketEmailDelivery';

// Stripe webhook receiver — the ONLY place a paid order is allowed to
// become ACTIVE (§5, §15: the browser's success-page redirect alone is
// never trusted). No session, no organisation, no Events capability
// check here — authenticity comes entirely from the Stripe signature
// (§12), which is why this route is unauthenticated by design rather
// than an oversight. It is not reachable from, and shares nothing
// with, the staff-facing /events namespace.
//
// Raw body handling: `await req.text()` reads the exact bytes Stripe
// sent, BEFORE any JSON parsing — Stripe's signature is computed over
// those raw bytes, not a re-serialized parse of them. Using req.json()
// first (which this route deliberately never does) would make every
// signature verification fail.
export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });
  }

  const rawBody = await req.text();

  let event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      console.error('[stripe webhook] not configured', err);
      return NextResponse.json({ error: 'Webhook not configured.' }, { status: 503 });
    }
    // Invalid/forged signature — reject outright, never process.
    console.error('[stripe webhook] signature verification failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  let paidOrderId: string | undefined;
  try {
    paidOrderId = (await processStripeWebhookEvent(event))?.paidOrderId;
  } catch (err) {
    // A transient failure here (DB hiccup) must surface as a non-2xx
    // response so Stripe retries with its own backoff — every handler
    // this dispatches to is independently idempotent (see
    // lib/events/stripe.ts), so a retry is always safe, never a risk
    // of double-processing.
    console.error('[stripe webhook] processing failed', event.type, err);
    return NextResponse.json({ error: 'Processing failed.' }, { status: 500 });
  }

  // Prompt ticket email for a paid order this event finalised — AFTER the response, so
  // the webhook stays fast and a slow or failing email never turns into a Stripe
  // retry. The webhook itself only scheduled the delivery (ticket_email_status =
  // 'pending'); this is one attempt through the same idempotent claim/lease/
  // idempotency-key machinery every other send uses, so a replayed webhook finds the
  // delivery already claimed or sent and sends nothing more. It never throws. If it
  // fails or the process ends first, the hourly recovery cron still delivers.
  if (paidOrderId) {
    const orderId = paidOrderId;
    after(async () => {
      try {
        await attemptAutomaticTicketEmail(orderId);
      } catch (err) {
        console.error('[stripe webhook] prompt ticket email attempt failed (the recovery cron will retry)', err, { orderId });
      }
    });
  }

  return NextResponse.json({ received: true });
}
