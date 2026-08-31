import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { resolvePublicEvent } from '@/lib/events/publicResolve';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';

type Ctx = { params: Promise<{ organisationSlug: string; eventSlug: string }> };

// Backs the post-Stripe return page (§15). Never trusts the browser's
// mere presence on this page/URL as proof of payment — it re-fetches
// the order's CURRENT payment_status from BrainBase's own database
// every time, which is only ever written by the webhook (see
// lib/events/stripe.ts) or this event's own reservation route, never
// by anything client-controlled. Looked up by
// stripe_checkout_session_id, a high-entropy Stripe-generated id —
// additionally scoped to the resolved event/organisation as defense in
// depth (an order for a different event can never be returned here,
// even though the session id alone is already effectively
// unguessable). Never returns a Stripe internal id to this
// attendee-facing response (§19).
export async function GET(req: NextRequest, { params }: Ctx) {
  const { organisationSlug, eventSlug } = await params;

  const ip = getClientIp(req);
  if (!checkRateLimit(`public-events-checkout-status:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }

  const sessionId = req.nextUrl.searchParams.get('session_id');
  if (!sessionId) return NextResponse.json({ error: 'Missing session_id.' }, { status: 400 });

  const resolved = await resolvePublicEvent(organisationSlug, eventSlug);
  if (!resolved.ok) return NextResponse.json({ error: 'Event not available.' }, { status: 404 });
  const { organisationId, event } = resolved;

  const rows = await sql`
    SELECT eo.id, eo.status, eo.payment_status, eo.total_cents, eo.currency
    FROM event_orders eo
    WHERE eo.stripe_checkout_session_id = ${sessionId} AND eo.organisation_id = ${organisationId} AND eo.event_id = ${event.id}
    LIMIT 1
  `;
  const order = rows[0] as { id: string; status: string; payment_status: string; total_cents: number; currency: string } | undefined;
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

  let tickets: { attendee_name: string; ticket_token: string }[] = [];
  if (order.payment_status === 'PAID') {
    const attendeeRows = await sql`
      SELECT attendee_name, ticket_token FROM event_attendees WHERE order_id = ${order.id} AND ticket_token IS NOT NULL
    `;
    tickets = attendeeRows as { attendee_name: string; ticket_token: string }[];
  }

  return NextResponse.json({
    payment_status: order.payment_status,
    order_status: order.status,
    amount_total_cents: order.total_cents,
    currency: order.currency,
    tickets,
  });
}
