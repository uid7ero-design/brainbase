import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { logPurchaserEdited } from '@/lib/events/auditLog';

type Ctx = { params: Promise<{ id: string; orderId: string }> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// PATCH — Phase 6 §4: edit purchaser_name/purchaser_email/purchaser_phone
// on an existing order. manager+, matching every other Events mutation's
// role convention (see check-in confirm's own comment for the full
// rationale, which applies unchanged here).
//
// Tenant safety: the UPDATE's own WHERE clause requires id = orderId AND
// event_id = id (the event this route is nested under) AND
// organisation_id = session.organisationId, all three together — an
// orderId that exists but belongs to a different event or a different
// organisation matches zero rows and returns 404, never a partial or
// cross-tenant update. organisation_id is never read from the request
// body or the URL; it comes only from the authenticated session.
//
// CRM behaviour (Phase 5/6 boundary, deliberate): this route NEVER
// touches event_orders.crm_contact_id. Editing a purchaser's name/
// email/phone here does not relink, re-dedupe, or overwrite any
// existing CRM contact — the order's CRM link (if any) is left exactly
// as Phase 5's own sync originally resolved it, at booking time. This
// is the explicitly preferred, safe default (Phase 6 brief §4): an
// event order remains independently editable, and a linked CRM contact
// is never silently mutated as a side effect of a booking-detail
// correction. Automatic relinking/dedupe-on-identity-change is a
// separate, not-yet-approved feature — see this phase's own final
// report.
//
// What this route deliberately does NOT do: it does not touch
// attendees, responses, payment state, or check-in state — each of
// those has (or will have) its own narrowly-scoped route, matching this
// module's existing one-concern-per-route convention (see cancel/
// refund/retry, each its own file).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id: eventId, orderId } = await params;

  let body: { purchaser_name?: unknown; purchaser_email?: unknown; purchaser_phone?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  // At least one field, all fields optional per-request (a manager
  // correcting only the phone number should not be forced to resend
  // the name/email too) — but any field that IS present must validate.
  const updates: { purchaser_name?: string; purchaser_email?: string; purchaser_phone?: string | null } = {};

  if (body.purchaser_name !== undefined) {
    if (typeof body.purchaser_name !== 'string' || !body.purchaser_name.trim()) {
      return NextResponse.json({ error: 'Purchaser name cannot be empty.' }, { status: 400 });
    }
    updates.purchaser_name = body.purchaser_name.trim();
  }
  if (body.purchaser_email !== undefined) {
    if (typeof body.purchaser_email !== 'string' || !EMAIL_RE.test(body.purchaser_email.trim())) {
      return NextResponse.json({ error: 'A valid purchaser email is required.' }, { status: 400 });
    }
    // Normalized (trim + lowercase) for storage — matches this
    // codebase's own established normalization convention for stored
    // emails (see lib/crm/eventSync.ts's normalizeEmail, applied here
    // independently since this route intentionally never imports from
    // the CRM boundary — see this file's own CRM-behaviour comment).
    updates.purchaser_email = body.purchaser_email.trim().toLowerCase();
  }
  if (body.purchaser_phone !== undefined) {
    if (body.purchaser_phone !== null && typeof body.purchaser_phone !== 'string') {
      return NextResponse.json({ error: 'Invalid phone number.' }, { status: 400 });
    }
    const trimmed = typeof body.purchaser_phone === 'string' ? body.purchaser_phone.trim() : null;
    updates.purchaser_phone = trimmed && trimmed.length > 0 ? trimmed : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update.' }, { status: 400 });
  }

  const beforeRows = await sql`
    SELECT purchaser_name, purchaser_email, purchaser_phone FROM event_orders
    WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  const before = beforeRows[0] as { purchaser_name: string; purchaser_email: string; purchaser_phone: string | null } | undefined;
  if (!before) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const updated = await sql`
    UPDATE event_orders
    SET
      purchaser_name = COALESCE(${updates.purchaser_name ?? null}, purchaser_name),
      purchaser_email = COALESCE(${updates.purchaser_email ?? null}, purchaser_email),
      purchaser_phone = CASE WHEN ${'purchaser_phone' in updates} THEN ${updates.purchaser_phone ?? null} ELSE purchaser_phone END,
      updated_at = now()
    WHERE id = ${orderId} AND event_id = ${eventId} AND organisation_id = ${session.organisationId}
    RETURNING id, purchaser_name, purchaser_email, purchaser_phone, crm_contact_id
  `;
  if (!updated.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const after = updated[0] as { id: string; purchaser_name: string; purchaser_email: string; purchaser_phone: string | null; crm_contact_id: string | null };

  // Phase 6 §11 — best-effort, never throws, always after the real
  // mutation has already committed (see lib/events/auditLog.ts).
  await logPurchaserEdited({
    organisationId: session.organisationId, userId: session.userId, orderId,
    before: { purchaser_name: before.purchaser_name, purchaser_email: before.purchaser_email, purchaser_phone: before.purchaser_phone },
    after: { purchaser_name: after.purchaser_name, purchaser_email: after.purchaser_email, purchaser_phone: after.purchaser_phone },
  });

  return NextResponse.json({ order: after });
}
