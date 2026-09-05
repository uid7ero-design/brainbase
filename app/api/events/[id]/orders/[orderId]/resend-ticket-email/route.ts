import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { isOrderEligibleForTicketEmail, sendTicketEmail, maskEmailForAudit } from '@/lib/events/ticketEmail';
import { logTicketEmailResent } from '@/lib/events/auditLog';

type Ctx = { params: Promise<{ id: string; orderId: string }> };

const COOLDOWN_SECONDS = 60;
const RESEND_ACTION = 'event_order.ticket_email_resent';

// POST — Phase 7. First manager-triggered ticket email Events has ever
// sent. manager+, matching every other Events mutation's role
// convention (see the cancel/refund routes' identical
// authorizeEventsRequest('manager') gate). Empty request body by
// design: recipient, ticket tokens, and eligibility are all re-derived
// fresh from event_orders/event_attendees on every call — nothing is
// ever accepted from the client here (§5's explicit "do NOT parse
// email/recipient/ticket-token/eligibility-flags from client input").
//
// Tenancy/not-found: mirrors the cancel/refund routes exactly — a
// wrong-organisation event or a wrong event/order relationship both
// collapse to the same 404, never distinguishing "exists in another
// tenant" from "doesn't exist at all".
export async function POST(_req: Request, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId } = await params;

  const eventRows = await sql`SELECT id FROM events WHERE id = ${eventId} AND organisation_id = ${session.organisationId} LIMIT 1`;
  if (!eventRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  // Single fresh read of everything eligibility + the email itself
  // need: order state, purchaser email, event name, and every
  // attendee's name + EXISTING ticket_token (never generated here).
  const orderRows = await sql`
    SELECT
      eo.id, eo.status, eo.payment_status, eo.purchaser_name, eo.purchaser_email,
      e.name AS event_name,
      COALESCE(
        json_agg(json_build_object('name', ea.attendee_name, 'ticket_token', ea.ticket_token)) FILTER (WHERE ea.id IS NOT NULL),
        '[]'
      ) AS attendees
    FROM event_orders eo
    JOIN events e ON e.id = eo.event_id AND e.organisation_id = eo.organisation_id
    JOIN event_order_items oi ON oi.order_id = eo.id AND oi.organisation_id = eo.organisation_id
    LEFT JOIN event_attendees ea ON ea.order_item_id = oi.id AND ea.organisation_id = oi.organisation_id
    WHERE eo.id = ${orderId} AND eo.event_id = ${eventId} AND eo.organisation_id = ${session.organisationId}
    GROUP BY eo.id, e.name
    LIMIT 1
  `;
  const order = orderRows[0] as {
    id: string; status: string; payment_status: string; purchaser_name: string; purchaser_email: string | null;
    event_name: string; attendees: { name: string; ticket_token: string | null }[];
  } | undefined;
  if (!order) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  // Eligibility re-derived immediately before send, from this same
  // fresh read — never trusts any state the client might already have
  // rendered (§4/§5).
  if (!isOrderEligibleForTicketEmail(order)) {
    return NextResponse.json({ error: 'This booking is not eligible for a ticket email.' }, { status: 409 });
  }

  // Cooldown (§7): 60 seconds per event order, counting every prior
  // attempt regardless of outcome (sent/failed/unknown) — the point is
  // stopping double-click/repeat-click spam, not just gating
  // successful sends. Reuses the existing audit_logs table; no new
  // mechanism.
  const cooldownRows = await sql`
    SELECT EXTRACT(EPOCH FROM (now() - created_at))::int AS seconds_since
    FROM audit_logs
    WHERE organisation_id = ${session.organisationId} AND resource_type = 'event_order' AND resource_id = ${orderId} AND action = ${RESEND_ACTION}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const lastAttempt = cooldownRows[0] as { seconds_since: number } | undefined;
  if (lastAttempt !== undefined && lastAttempt.seconds_since < COOLDOWN_SECONDS) {
    return NextResponse.json(
      {
        error: 'A ticket email was already sent for this booking recently. Please wait before trying again.',
        retry_after_seconds: COOLDOWN_SECONDS - lastAttempt.seconds_since,
      },
      { status: 429 },
    );
  }

  const eligibleAttendees = order.attendees.filter(
    (a): a is { name: string; ticket_token: string } => !!a.ticket_token,
  );
  const recipient = order.purchaser_email as string; // non-null — guaranteed by isOrderEligibleForTicketEmail above
  const recipientMasked = maskEmailForAudit(recipient);

  const sendResult = await sendTicketEmail(recipient, {
    eventName: order.event_name,
    purchaserName: order.purchaser_name,
    attendees: eligibleAttendees.map(a => ({ name: a.name, ticketToken: a.ticket_token })),
  });

  // Pre-push hardening — RESEND_API_KEY is absent (typical in Preview
  // environments): sendTicketEmail() never called the network at all,
  // so this MUST NOT be reported as 'sent'. Still an actual
  // manager-triggered attempt, so it still gets an audit row (counts
  // toward cooldown like every other outcome) and a non-2xx status.
  // Message deliberately names no env var / secret.
  if (sendResult.result === 'not_configured') {
    await logTicketEmailResent({
      organisationId: session.organisationId, userId: session.userId, orderId,
      result: 'not_configured', recipientMasked, attendeeCount: eligibleAttendees.length, providerMessageId: null,
    }).catch(err => console.error('[events] ticket-email audit write failed after not_configured outcome', err, { orderId }));
    return NextResponse.json(
      { ok: false, result: 'not_configured', error: 'Email sending is not configured for this environment.' },
      { status: 503 },
    );
  }

  // Case A — provider definitely rejected the request. Order/ticket
  // data unchanged; no success response. Audit written best-effort
  // (a failure here does not change the response — the provider
  // failure is already the primary fact being reported).
  if (sendResult.result === 'failed') {
    await logTicketEmailResent({
      organisationId: session.organisationId, userId: session.userId, orderId,
      result: 'failed', recipientMasked, attendeeCount: eligibleAttendees.length, providerMessageId: null,
    }).catch(err => console.error('[events] ticket-email audit write failed after provider failure', err, { orderId }));
    return NextResponse.json({ ok: false, result: 'failed', error: 'The email could not be sent. Please try again.' }, { status: 502 });
  }

  // Case C — provider timeout/ambiguous network outcome. No automatic
  // retry. Returned as a non-2xx (504 — this route's own request to
  // OUR server DID complete; it's the downstream provider's own
  // outcome that timed out/never resolved definitively, matching 504's
  // usual "upstream did not respond in time" semantics) rather than the
  // 200 an earlier draft of this route used — an unknown delivery
  // outcome is not an ordinary successful request. The frontend
  // branches on the structured `result` field, not on status code
  // alone, so this is still distinguishable from Case A's 502.
  if (sendResult.result === 'unknown') {
    await logTicketEmailResent({
      organisationId: session.organisationId, userId: session.userId, orderId,
      result: 'unknown', recipientMasked, attendeeCount: eligibleAttendees.length, providerMessageId: null,
    }).catch(err => console.error('[events] ticket-email audit write failed after unknown provider outcome', err, { orderId }));
    return NextResponse.json(
      { ok: false, result: 'unknown', error: 'Delivery status unknown — do not immediately resend.' },
      { status: 504 },
    );
  }

  // Case B / Case D — the provider accepted the send. Provider+DB
  // audit can never be made transactionally atomic, so these two cases
  // are handled explicitly rather than pretended away: if the audit
  // write below fails, we must NOT call the provider again (the
  // provider has already been called exactly once, above, for this
  // request) and must NOT report an ordinary success (§8 Case D) — the
  // caller needs to know the email may already be out even though we
  // failed to record it.
  //
  // Residual failure mode, documented rather than "solved" with new
  // schema this phase: the 60-second cooldown (see above) is enforced
  // entirely by reading this same audit_logs table. If the INSERT below
  // fails, THIS attempt leaves no row — so the cooldown genuinely
  // cannot see that a send just happened, and an immediate second
  // manager click would not be blocked by it. This is a real, known gap
  // in this specific edge case (provider accepted, our own DB write
  // then failed) — not a false protection we are pretending exists. The
  // 500 response and its UI copy below tell the manager not to
  // immediately resend precisely because this route cannot rely on its
  // own cooldown mechanism in this one scenario.
  try {
    await logTicketEmailResent({
      organisationId: session.organisationId, userId: session.userId, orderId,
      result: 'sent', recipientMasked, attendeeCount: eligibleAttendees.length, providerMessageId: sendResult.providerMessageId,
    });
  } catch (err) {
    console.error('[events] CRITICAL: ticket email sent but audit write failed', err, { orderId });
    return NextResponse.json(
      {
        ok: false,
        result: 'sent_audit_failed',
        error: 'The email may have been sent, but BrainBase could not record the send. Do not immediately resend.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, result: 'sent', attendee_count: eligibleAttendees.length });
}
