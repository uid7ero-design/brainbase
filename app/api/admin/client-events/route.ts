import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireRole } from '@/lib/org';

function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

// GET /api/admin/client-events — platform-wide event oversight for
// BrainBase super admins ONLY. This is the one deliberate exception in
// this codebase to "every Events query is scoped to the caller's own
// organisation_id" — justified purely by requireRole('super_admin')
// below, never by inferring authorization from an organisation's name
// or slug. Read-only: this file exports GET only, no POST/PATCH/
// DELETE — there is no cross-tenant mutation route. Managing an
// individual event remains entirely the existing tenant-scoped Events
// module (app/events/[id]/**); a super admin reaches it by switching
// organisation context via the existing /api/admin/impersonate
// mechanism (see components/admin/OrgSwitcher.tsx, the same one this
// route's own caller — ClientEventsClient.tsx's "Open event" action —
// reuses) and then navigating to /events/{eventId} like any other
// staff member of that organisation would.
//
// Deliberately never selects purchaser_name/purchaser_email/
// purchaser_phone, attendee names, or any event_registration_responses
// row — this is a high-level oversight aggregate, not a purchaser/
// attendee data browser. See this file's own SQL below: the only
// tables touched are events, organisations, organisation_modules,
// modules, event_orders (aggregate columns only), event_order_items
// (aggregate only), and event_ticket_types (aggregate only).
export async function GET(req: NextRequest) {
  try { await requireRole('super_admin'); } catch { return forbidden(); }

  const url = new URL(req.url);
  const orgFilter = url.searchParams.get('org');
  const statusFilter = url.searchParams.get('status'); // DRAFT | PUBLISHED | CANCELLED
  const timingFilter = url.searchParams.get('timing'); // upcoming | past
  const search = url.searchParams.get('search');
  const paymentIssueOnly = url.searchParams.get('paymentIssue') === 'true';
  // Default excludes BrainBase HQ's own events (§7 — BrainBase HQ
  // already has its own /events workspace; this screen is client
  // oversight, not a duplicate of that). This is a DISPLAY filter
  // only, identified by slug — never an access-control decision (the
  // access gate above is requireRole('super_admin') alone).
  const includeBrainbase = url.searchParams.get('includeBrainbase') === 'true';

  // Only organisations with the 'events' capability CURRENTLY enabled
  // are included — an event belonging to an organisation whose
  // capability has since been disabled would otherwise appear here
  // but land on the capability-disabled message when "Open event" is
  // clicked (see app/events/[id]/page.tsx's own checkCapability call,
  // which this route deliberately mirrors the gating of).
  const events = await sql`
    WITH orders_agg AS (
      SELECT
        event_id, organisation_id,
        COUNT(*) FILTER (WHERE status <> 'CANCELLED')::int AS registration_count,
        COUNT(*) FILTER (WHERE payment_status = 'PAID')::int AS paid_count,
        COUNT(*) FILTER (WHERE payment_status = 'PENDING')::int AS pending_count,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled_count,
        -- Cast to ::int, not left as bigint — SUM(int) returns bigint in
        -- Postgres, and this driver returns bigint columns as JS
        -- strings (not numbers), which previously caused a real
        -- production bug elsewhere in this module when a caller summed
        -- two such values expecting numeric addition and silently got
        -- string concatenation instead (see lib/events/
        -- publicEventDetail.ts's own comment on the same class of
        -- defect). Casting here makes the driver return a genuine JS
        -- number for every caller, not just the one call site that
        -- happened to notice.
        COALESCE(SUM(total_cents) FILTER (WHERE payment_status = 'PAID'), 0)::int AS gross_revenue_cents,
        COALESCE(SUM(total_cents) FILTER (WHERE payment_status = 'REFUNDED'), 0)::int AS refunded_cents,
        (array_agg(currency ORDER BY created_at) FILTER (WHERE currency IS NOT NULL))[1] AS currency
      FROM event_orders
      GROUP BY event_id, organisation_id
    ),
    tickets_agg AS (
      SELECT oi.event_id, oi.organisation_id, COALESCE(SUM(oi.quantity), 0)::int AS tickets_sold
      FROM event_order_items oi
      JOIN event_orders eo ON eo.id = oi.order_id AND eo.organisation_id = oi.organisation_id
      WHERE eo.status <> 'CANCELLED'
      GROUP BY oi.event_id, oi.organisation_id
    ),
    capacity_agg AS (
      SELECT event_id, organisation_id, COALESCE(SUM(capacity), 0)::int AS total_capacity
      FROM event_ticket_types
      GROUP BY event_id, organisation_id
    )
    SELECT
      e.id, e.name, e.slug, e.status, e.starts_at, e.ends_at, e.timezone,
      o.id AS organisation_id, o.name AS organisation_name, o.slug AS organisation_slug,
      COALESCE(capacity_agg.total_capacity, 0) AS total_capacity,
      COALESCE(orders_agg.registration_count, 0) AS registration_count,
      COALESCE(orders_agg.paid_count, 0) AS paid_count,
      COALESCE(orders_agg.pending_count, 0) AS pending_count,
      COALESCE(orders_agg.cancelled_count, 0) AS cancelled_count,
      COALESCE(tickets_agg.tickets_sold, 0) AS tickets_sold,
      COALESCE(orders_agg.gross_revenue_cents, 0) AS gross_revenue_cents,
      COALESCE(orders_agg.refunded_cents, 0) AS refunded_cents,
      COALESCE(orders_agg.currency, 'AUD') AS currency
    FROM events e
    JOIN organisations o ON o.id = e.organisation_id
    JOIN organisation_modules om ON om.organisation_id = o.id AND om.module_key = 'events' AND om.enabled = true
    JOIN modules m ON m.key = om.module_key AND m.active = true
    LEFT JOIN orders_agg ON orders_agg.event_id = e.id AND orders_agg.organisation_id = e.organisation_id
    LEFT JOIN tickets_agg ON tickets_agg.event_id = e.id AND tickets_agg.organisation_id = e.organisation_id
    LEFT JOIN capacity_agg ON capacity_agg.event_id = e.id AND capacity_agg.organisation_id = e.organisation_id
    WHERE (${includeBrainbase} OR o.slug <> 'brainbase')
      AND (${orgFilter}::text IS NULL OR o.id = ${orgFilter})
      AND (${statusFilter}::text IS NULL OR e.status = ${statusFilter})
      AND (${timingFilter}::text IS NULL
           OR (${timingFilter} = 'upcoming' AND e.starts_at >= NOW())
           OR (${timingFilter} = 'past' AND e.starts_at < NOW()))
      AND (${search}::text IS NULL OR e.name ILIKE '%' || ${search} || '%')
      AND (${paymentIssueOnly} = false OR COALESCE(orders_agg.pending_count, 0) > 0)
    ORDER BY e.starts_at DESC
  `;

  // Filter-dropdown source — only organisations that could ever appear
  // in the list above (same capability gate), so the org filter never
  // offers a choice that would silently return zero rows.
  const organisations = await sql`
    SELECT DISTINCT o.id, o.name, o.slug
    FROM organisations o
    JOIN organisation_modules om ON om.organisation_id = o.id AND om.module_key = 'events' AND om.enabled = true
    JOIN modules m ON m.key = om.module_key AND m.active = true
    WHERE (${includeBrainbase} OR o.slug <> 'brainbase')
    ORDER BY o.name
  `;

  return NextResponse.json({ events, organisations });
}
