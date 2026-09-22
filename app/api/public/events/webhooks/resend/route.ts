import { NextRequest, NextResponse } from 'next/server';
import {
  isResendWebhookConfigured,
  verifyResendWebhookEvent,
  ResendWebhookSignatureError,
} from '@/lib/events/resendWebhook';
import { applyResendDeliveryWebhookEvent, type ResendDeliveryOutcome } from '@/lib/events/ticketEmailDeliveryTracking';

// Resend delivery-status webhook receiver — mirrors
// app/api/public/events/webhooks/stripe/route.ts's structure exactly
// (unauthenticated by design; authenticity comes entirely from the
// provider signature). Not reachable from, and shares nothing with,
// the staff-facing /events namespace.
//
// This endpoint is configured account-wide in Resend, not scoped to
// ticket emails — auth-verification, password-reset, and lead-
// notification sends (lib/email.ts, shared across the whole app) will
// also generate events here. That is expected: an event whose
// email_id matches no row in event_ticket_email_deliveries is a safe,
// silent no-op (see applyResendDeliveryWebhookEvent's own comment) —
// never a fatal or logged-as-error condition.
//
// Raw body handling: `await req.text()` reads the exact bytes Resend
// sent, BEFORE any JSON parsing — the Svix signature is computed over
// those raw bytes. Using req.json() first would make every signature
// verification fail (same discipline as the Stripe webhook route).
//
// This route MUST NEVER trigger an email send, schedule a retry, or
// touch event_orders.ticket_email_status — see
// ticketEmailDeliveryTracking.ts's applyResendDeliveryWebhookEvent for
// the enforcement of that boundary.
const SUPPORTED_OUTCOME_BY_EVENT_TYPE: Partial<Record<string, ResendDeliveryOutcome>> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.suppressed': 'suppressed',
  'email.complained': 'complained',
  'email.failed': 'failed',
};

export async function POST(req: NextRequest) {
  if (!isResendWebhookConfigured()) {
    console.error('[resend webhook] not configured (RESEND_API_KEY / RESEND_WEBHOOK_SECRET)');
    return NextResponse.json({ error: 'Webhook not configured.' }, { status: 503 });
  }

  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing signature headers.' }, { status: 400 });
  }

  const rawBody = await req.text();

  let event;
  try {
    event = verifyResendWebhookEvent(rawBody, { id: svixId, timestamp: svixTimestamp, signature: svixSignature });
  } catch (err) {
    if (err instanceof ResendWebhookSignatureError) {
      console.error('[resend webhook] signature verification failed', err.message);
      return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
    }
    throw err;
  }

  // Malformed-but-signed payload defence: BaseEmailEventData's email_id
  // is required by the SDK's own type, but a runtime payload is never
  // fully trusted just because it passed signature verification —
  // verify() only proves Resend sent these bytes, not that every field
  // this route expects is actually present.
  const emailId = (event.data as { email_id?: unknown } | undefined)?.email_id;
  if (typeof emailId !== 'string' || !emailId) {
    return NextResponse.json({ received: true });
  }

  const outcome = SUPPORTED_OUTCOME_BY_EVENT_TYPE[event.type];
  if (!outcome) {
    // Every other supported Resend event type (email.sent, email.scheduled,
    // email.delivery_delayed, email.opened, email.clicked, email.received,
    // contact.*, domain.*) — safely ignored, not fatal. This phase only
    // tracks the outcomes named in G. DELIVERY STATES SUPPORTED.
    return NextResponse.json({ received: true });
  }

  try {
    await applyResendDeliveryWebhookEvent({
      providerMessageId: emailId,
      outcome,
      eventId: svixId,
      eventType: event.type,
      eventCreatedAt: event.created_at,
    });
  } catch (err) {
    // A transient failure here (DB hiccup) must surface as a non-2xx
    // response so Svix retries with its own backoff — applying the same
    // event twice is always safe (see the guarded UPDATE's own replay
    // protection), so a retry carries no risk of double-processing.
    console.error('[resend webhook] processing failed', event.type, err);
    return NextResponse.json({ error: 'Processing failed.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
