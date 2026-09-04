import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { parseRegistrationFilters, buildRegistrationFilterSql } from '@/lib/events/registrationFilters';
import { buildCsv } from '@/lib/events/csvExport';

type Ctx = { params: Promise<{ id: string }> };

const CSV_HEADER = [
  'Order reference',
  'Purchaser name',
  'Purchaser email',
  'Purchaser phone',
  'Payment status',
  'Order total',
  'Currency',
  'Ticket type',
  'Attendee name',
  'Session',
  'Checked in',
  'Check-in timestamp',
  'Cancelled',
  'Created',
];

// manager+ (tighter than the viewer+ list route, app/api/events/[id]/
// orders/route.ts) — a downloadable artifact is easier to walk out the
// door with than an on-screen view; see this phase's own design report
// for the full reasoning behind gating export more strictly than the
// list it's built from.
//
// CSV grain: ONE ROW PER ATTENDEE — a different (finer) grain than the
// list route's one-row-per-order_item, because several required columns
// (attendee name, checked-in state, check-in timestamp) are only
// meaningful per attendee. Filters/search are parsed and applied via the
// SAME shared module the list route uses
// (lib/events/registrationFilters.ts) — never a second, hand-copied
// filter implementation — so list and export cannot diverge in what
// "the same filters" means, even though their row grains differ.
//
// Because buildRegistrationFilterSql()'s checkin=in/out condition is an
// EXISTS scoped to the current order_item (not the individual attendee
// row), a matching order_item's attendee rows ALL appear in this export
// together, even ones whose own checked_in_at doesn't itself satisfy the
// filter — e.g. checkin=in can legitimately include a not-yet-checked-in
// attendee if a sibling attendee in the same order_item IS checked in.
// This mirrors the list route's own documented behavior exactly (a
// filter selects which registrations need attention, it never redacts
// attendees within one that already matched) and is intentional — do
// not "fix" this into per-attendee filtering without revisiting the
// list route's semantics at the same time, or the two will diverge.
//
// Registration-question answers are NEVER included in this phase — no
// includeAnswers parameter exists here at all; this is a deliberately
// separate, separately-reviewed privacy fast-follow, not implemented in
// this phase.
//
// DATA SAFETY: only the columns listed in CSV_HEADER above are ever
// selected below — no event_order_notes, no ticket_token, no QR URL, no
// Stripe identifiers (stripe_checkout_session_id/stripe_payment_intent_id/
// stripe_account_id), no crm_contact_id, no checked_in_by_user_id, no
// registration-question answers, no raw metadata.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const eventRows = await sql`
    SELECT id, name FROM events WHERE id = ${id} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (!eventRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const filters = parseRegistrationFilters(searchParams);
  const filterClause = buildRegistrationFilterSql(filters, session.organisationId);

  const rows = (await sql`
    SELECT
      eo.id AS order_reference,
      eo.purchaser_name,
      eo.purchaser_email,
      eo.purchaser_phone,
      eo.payment_status,
      eo.total_cents,
      eo.currency,
      tt.name AS ticket_type_name,
      ea.attendee_name,
      es.name AS session_name,
      ea.checked_in_at,
      eo.status AS order_status,
      eo.created_at
    FROM event_attendees ea
    JOIN event_order_items oi ON oi.id = ea.order_item_id AND oi.organisation_id = ea.organisation_id
    JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
    LEFT JOIN event_ticket_types tt ON tt.id = oi.ticket_type_id AND tt.organisation_id = oi.organisation_id
    LEFT JOIN event_sessions es ON es.id = oi.event_session_id AND es.organisation_id = oi.organisation_id
    WHERE eo.event_id = ${id}
      AND eo.organisation_id = ${session.organisationId}
      AND ea.organisation_id = ${session.organisationId}
      ${filterClause}
    ORDER BY eo.created_at DESC, ea.attendee_name ASC
  `) as {
    order_reference: string;
    purchaser_name: string;
    purchaser_email: string;
    purchaser_phone: string | null;
    payment_status: string;
    total_cents: number;
    currency: string;
    ticket_type_name: string | null;
    attendee_name: string;
    session_name: string | null;
    checked_in_at: string | null;
    order_status: string;
    created_at: string;
  }[];

  const csvRows = rows.map(r => [
    r.order_reference,
    r.purchaser_name,
    r.purchaser_email,
    r.purchaser_phone ?? '',
    r.payment_status,
    (r.total_cents / 100).toFixed(2),
    r.currency,
    r.ticket_type_name ?? '',
    r.attendee_name,
    r.session_name ?? '',
    r.checked_in_at ? 'Yes' : 'No',
    r.checked_in_at ?? '',
    r.order_status === 'CANCELLED' ? 'Yes' : 'No',
    r.created_at,
  ]);

  const csv = buildCsv(CSV_HEADER, csvRows);

  // Filename derived from the event name but stripped to a safe
  // character set — never interpolate the raw event name into a
  // response header.
  const eventName = (eventRows[0] as { name: string }).name;
  const filenameSafe = eventName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-') || 'event';

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filenameSafe}-registrations.csv"`,
    },
  });
}
