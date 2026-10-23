import { NextResponse } from 'next/server';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { listEventRegistrationRows } from '@/lib/events/organiserReads';
import { roleGte } from '@/lib/session';

type Ctx = { params: Promise<{ id: string }> };

// Staff-authenticated read of an event's registrations (orders + items
// + attendees) — viewer+, same authorizeEventsRequest() gate as every
// other Events route (session + 'events' capability + role). Tenant-
// scoped: every query below is explicitly filtered by the caller's own
// organisation_id, resolved only from the authenticated session.
//
// Registration operations phase — search/filter query params (q,
// paymentStatus, checkin, cancelled, ticketTypeId, sessionId), all
// optional and all parsed/applied via the SAME shared module
// (lib/events/registrationFilters.ts) the CSV export route
// (app/api/events/[id]/orders/export/route.ts) also uses — so list and
// export cannot silently diverge in what "the same filters" means. No
// params supplied = the exact previous unfiltered behavior, unchanged.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const { searchParams } = new URL(req.url);
  const orders = await listEventRegistrationRows(session.organisationId, id, searchParams);
  if (!orders) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  // Phase 5 — whether the "View CRM Contact" action may render at all is
  // decided server-side, once, here: crm_enabled reflects this
  // organisation's OWN CRM capability entitlement (not a global
  // modules-row check — see lib/capabilities/requireCapability.ts).
  // Never exposed on any public endpoint — this route is viewer+
  // staff-authenticated only (see this file's own header comment).
  const crmCapability = await checkCapability(session.organisationId, 'crm');

  // Registration operations phase — orders.length is the ROW count
  // (one row per order_item, unchanged grain from before this phase),
  // not the unique-order count. order_count is computed here,
  // explicitly, so the UI can label a result count honestly rather than
  // presenting a row count as if it were a registration count (an order
  // with two ticket types would otherwise silently look like two
  // registrations).
  const orderIds = new Set((orders as { id: string }[]).map(o => o.id));

  // Registration answers are personal and may be sensitive (health/
  // accessibility, a third party's details): manager+ only, the same rule
  // as the Eve organiser API (ADR 0013 §4). Below manager the keys are
  // removed entirely, not emptied, so nothing hints at whether answers exist.
  const rows = roleGte(session.role, 'manager')
    ? orders
    : (orders as Record<string, unknown>[]).map(row => {
        const out: Record<string, unknown> = { ...row };
        delete out.order_responses;
        if (Array.isArray(row.attendees)) {
          out.attendees = row.attendees.map(a => {
            const att: Record<string, unknown> = { ...((a ?? {}) as Record<string, unknown>) };
            delete att.responses;
            return att;
          });
        }
        return out;
      });

  return NextResponse.json({ orders: rows, crm_enabled: crmCapability.allowed, order_count: orderIds.size });
}
