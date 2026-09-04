import sql from '@/lib/db';
import { normalizePhone } from '@/lib/crm/eventSync';

// Shared by BOTH the registrations list route
// (app/api/events/[id]/orders/route.ts) and the CSV export route
// (app/api/events/[id]/orders/export/route.ts) — the one place these
// query params are parsed and turned into SQL, so the two routes cannot
// silently drift apart in what "the same filters" means. See this
// phase's own design report for the full semantics rationale; the short
// version:
//
//   - paymentStatus/cancelled are event_orders (order-level) columns —
//     unambiguous, every row belonging to the same order shares them.
//   - ticketTypeId/sessionId are event_order_items columns — they
//     directly restrict which order_item rows are included, so an order
//     with two line items may have only one of them survive a filter.
//   - checkin is EXISTENCE-based, scoped to the current order_item's own
//     attendees (checkin=in / checkin=out both use EXISTS, never "every
//     attendee must match") — a mixed-attendee order_item legitimately
//     appears under BOTH filters when each is applied on its own. This
//     is intentional: the filter selects which REGISTRATIONS need
//     attention, it never redacts attendees within a registration that
//     already matched.
//   - q (search) covers purchaser name/email/phone and attendee name
//     (also EXISTS-scoped to the current order_item) plus an order-id
//     prefix match. It deliberately never touches registration-question
//     answers or internal notes — see the module header comments on
//     lib/crm/eventContactClassificationBackfill.ts and
//     lib/events/auditLog.ts for the established, repeated precedent
//     that registration answers are the one class of Events data never
//     duplicated/indexed outside their own table.
//
// Every caller of buildRegistrationFilterSql() MUST pass organisationId
// from its own authenticated session (never from a query param/body) —
// this module never resolves tenancy itself, it only accepts it as an
// input, matching every other Events primitive's own discipline.

export const PAYMENT_STATUS_VALUES = ['NOT_REQUIRED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS_VALUES)[number];

export interface RegistrationFilters {
  q?: string;
  paymentStatus?: PaymentStatus;
  checkin?: 'in' | 'out';
  cancelled?: boolean;
  ticketTypeId?: string;
  sessionId?: string;
}

// Read-only-list-endpoint policy (matching app/api/crm/contacts/route.ts's
// own documented precedent): an unknown/malformed filter value is simply
// ignored (treated as "no filter"), never a 400 — a stray query param
// should degrade to the unfiltered list, not break the page.
export function parseRegistrationFilters(searchParams: URLSearchParams): RegistrationFilters {
  const filters: RegistrationFilters = {};

  const q = searchParams.get('q')?.trim();
  if (q) filters.q = q;

  const paymentStatus = searchParams.get('paymentStatus');
  if (paymentStatus && (PAYMENT_STATUS_VALUES as readonly string[]).includes(paymentStatus)) {
    filters.paymentStatus = paymentStatus as PaymentStatus;
  }

  const checkin = searchParams.get('checkin');
  if (checkin === 'in' || checkin === 'out') filters.checkin = checkin;

  const cancelled = searchParams.get('cancelled');
  if (cancelled === 'true') filters.cancelled = true;
  else if (cancelled === 'false') filters.cancelled = false;

  const ticketTypeId = searchParams.get('ticketTypeId')?.trim();
  if (ticketTypeId) filters.ticketTypeId = ticketTypeId;

  const sessionId = searchParams.get('sessionId')?.trim();
  if (sessionId) filters.sessionId = sessionId;

  return filters;
}

// Returns one combined sql`` fragment to splice into a query's WHERE
// clause (immediately after the caller's own event_id/organisation_id
// scoping — this fragment adds conditions, it never establishes tenancy
// itself). The fragment assumes the surrounding query aliases the
// current event_order_items row as `oi` and event_orders as `eo` — both
// the list route and the CSV export route are structured to satisfy
// this (the list query already does; the export query joins up from
// event_attendees through event_order_items AS oi / event_orders AS eo
// specifically so this same fragment applies unmodified).
//
// Nested sql`` fragments embedded as interpolated values inside another
// sql`` template are merged (not bound as a literal parameter) by the
// Neon driver's own query-building internals — confirmed by inspecting
// node_modules/@neondatabase/serverless's compiled toParameterizedQuery
// logic, and already relied on by the existing, working
// app/api/crm/contacts/route.ts (its own classificationClause/
// companyId conditional-fragment splicing). This function extends that
// exact same pattern.
export function buildRegistrationFilterSql(filters: RegistrationFilters, organisationId: string) {
  let clause = sql``;

  if (filters.q) {
    const q = filters.q;
    const likePattern = `%${q}%`;
    const idPrefixPattern = `${q}%`;
    const normalizedPhone = normalizePhone(q);
    const phoneDigits = normalizedPhone ? normalizedPhone.replace(/\D/g, '') : '';
    const phoneCondition =
      phoneDigits.length > 0
        ? sql`OR regexp_replace(COALESCE(eo.purchaser_phone, ''), '[^0-9]', '', 'g') ILIKE ${`%${phoneDigits}%`}`
        : sql``;

    clause = sql`${clause} AND (
      eo.purchaser_name ILIKE ${likePattern}
      OR eo.purchaser_email ILIKE ${likePattern}
      ${phoneCondition}
      OR eo.id ILIKE ${idPrefixPattern}
      OR EXISTS (
        SELECT 1 FROM event_attendees ea_search
        WHERE ea_search.order_item_id = oi.id
          AND ea_search.organisation_id = ${organisationId}
          AND ea_search.attendee_name ILIKE ${likePattern}
      )
    )`;
  }

  if (filters.paymentStatus) {
    clause = sql`${clause} AND eo.payment_status = ${filters.paymentStatus}`;
  }

  if (filters.cancelled === true) {
    clause = sql`${clause} AND eo.status = 'CANCELLED'`;
  } else if (filters.cancelled === false) {
    clause = sql`${clause} AND eo.status <> 'CANCELLED'`;
  }

  if (filters.checkin === 'in') {
    clause = sql`${clause} AND EXISTS (
      SELECT 1 FROM event_attendees ea_checkin
      WHERE ea_checkin.order_item_id = oi.id
        AND ea_checkin.organisation_id = ${organisationId}
        AND ea_checkin.checked_in_at IS NOT NULL
    )`;
  } else if (filters.checkin === 'out') {
    clause = sql`${clause} AND EXISTS (
      SELECT 1 FROM event_attendees ea_checkin
      WHERE ea_checkin.order_item_id = oi.id
        AND ea_checkin.organisation_id = ${organisationId}
        AND ea_checkin.checked_in_at IS NULL
    )`;
  }

  if (filters.ticketTypeId) {
    clause = sql`${clause} AND oi.ticket_type_id = ${filters.ticketTypeId}`;
  }

  if (filters.sessionId) {
    clause = sql`${clause} AND oi.event_session_id = ${filters.sessionId}`;
  }

  return clause;
}
