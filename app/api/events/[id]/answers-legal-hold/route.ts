import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { logAnswersLegalHoldChanged } from '@/lib/events/auditLog';

type Ctx = { params: Promise<{ id: string }> };

const REASONS = ['COMPLAINT', 'INCIDENT', 'DISPUTE', 'LEGAL_OBLIGATION'] as const;

// PATCH — legal hold on registration-answer retention (ADR 0013 §4b).
// Body: { reason: 'COMPLAINT' | 'INCIDENT' | 'DISPUTE' | 'LEGAL_OBLIGATION' | null, order_id?: string }
//   - without order_id: the hold applies to every answer for the event;
//   - with order_id: only that order's answers.
// reason: null clears the hold. While held, the retention job skips those
// answers; it resumes on its normal timers once cleared (an answer already
// past due is then removed at the next run).
//
// admin+ — a hold keeps personal information longer than the policy, so it
// is a deliberate, audited decision, only where a complaint, incident,
// dispute or legal obligation requires it. Only a reason CODE is stored;
// no free text (which could itself carry personal details).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('admin');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const reason = body.reason ?? null;
  if (reason !== null && !(typeof reason === 'string' && (REASONS as readonly string[]).includes(reason))) {
    return NextResponse.json({ error: `reason must be one of ${REASONS.join(', ')}, or null to clear.` }, { status: 400 });
  }
  const orderId = body.order_id === undefined || body.order_id === null ? null : body.order_id;
  if (orderId !== null && (typeof orderId !== 'string' || !orderId.trim())) {
    return NextResponse.json({ error: 'order_id must be a string.' }, { status: 400 });
  }

  // Tenant-scoped read of the current value, then the update.
  const current = orderId
    ? await sql`
        SELECT answers_legal_hold FROM event_orders
        WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId} LIMIT 1
      `
    : await sql`
        SELECT answers_legal_hold FROM events
        WHERE id = ${eventId} AND organisation_id = ${session.organisationId} LIMIT 1
      `;
  if (!current.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const before = (current[0] as { answers_legal_hold: string | null }).answers_legal_hold ?? null;

  if (orderId) {
    await sql`
      UPDATE event_orders SET answers_legal_hold = ${reason as string | null}
      WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId}
    `;
  } else {
    await sql`
      UPDATE events SET answers_legal_hold = ${reason as string | null}
      WHERE id = ${eventId} AND organisation_id = ${session.organisationId}
    `;
  }
  if (before !== reason) {
    await logAnswersLegalHoldChanged({
      organisationId: session.organisationId, userId: session.userId, eventId, orderId: orderId as string | null,
      before, after: reason as string | null,
    });
  }
  return NextResponse.json({ answers_legal_hold: reason, order_id: orderId });
}
