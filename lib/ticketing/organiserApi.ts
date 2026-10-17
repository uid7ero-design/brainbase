import 'server-only';
import type { Role } from '@/lib/session';
import {
  getOrganisationEvent,
  listEventRegistrationRows,
  listOrganisationEvents,
} from '@/lib/events/organiserReads';
import { resolveAttendee, searchAttendees, type AttendeeIdentifier } from '@/lib/events/checkIn';
import { confirmCheckInWithAudit, eventBelongsToOrganisation, undoCheckInWithAudit } from '@/lib/events/checkInOps';
import { authorizeTicketingApiRequest, type TicketingContext } from './authorize';
import { isIdentifier, readBodyText, ticketingJson } from './http';

// Organiser half of the ticketing API. Every handler:
//   1. authorizeTicketingApiRequest(req, minRole): S2S gate, Eve session
//      token, and a fresh database reload of user status, tenant,
//      organisation status, Events capability and role — on every call;
//   2. calls the shared server-side read/operation functions in
//      lib/events (the same ones the BrainBase Events routes call), scoped
//      to the organisation that step resolved from the database;
//   3. returns an allow-listed projection — never CRM ids, Stripe ids,
//      registration answers or ticket tokens.
// Minimum roles mirror the BrainBase Events routes: reads and check-in
// resolve/search are viewer; check-in confirm and undo are manager.
// Deliberately absent: event/ticket-type editing, refunds, cancellation,
// retry, resend, export and payments onboarding.

type Json = Record<string, unknown>;

async function asOrganiser(
  req: Request,
  minRole: Role,
  fn: (ctx: TicketingContext) => Promise<Response>,
): Promise<Response> {
  const auth = await authorizeTicketingApiRequest(req, minRole);
  if (!auth.ok) return auth.response;
  return fn(auth.context);
}

function pick(row: unknown, keys: readonly string[]): Json {
  const out: Json = {};
  if (!row || typeof row !== 'object') return out;
  for (const k of keys) if (k in row) out[k] = (row as Json)[k] ?? null;
  return out;
}

const notFound = () => ticketingJson({ error: 'Not found.' }, 404);

const EVENT_FIELDS = ['id', 'name', 'slug', 'status', 'venue', 'starts_at', 'ends_at', 'timezone', 'session_count', 'ticket_type_count'] as const;

function organisationOf(ctx: TicketingContext) {
  return { slug: ctx.organisationSlug, name: ctx.organisationName };
}

async function loadEvents(organisationId: string): Promise<Json[]> {
  return (await listOrganisationEvents(organisationId)).map(e => pick(e, EVENT_FIELDS));
}

export function handleOrganiserEvents(req: Request): Promise<Response> {
  return asOrganiser(req, 'viewer', async ctx => {
    return ticketingJson({ organisation: organisationOf(ctx), events: await loadEvents(ctx.organisationId) });
  });
}

// Counts derived from the same event list the Events page shows; no
// separate aggregate query.
export function handleOrganiserSummary(req: Request): Promise<Response> {
  return asOrganiser(req, 'viewer', async ctx => {
    const events = await loadEvents(ctx.organisationId);
    const byStatus: Record<string, number> = {};
    for (const e of events) byStatus[String(e.status)] = (byStatus[String(e.status)] ?? 0) + 1;
    const now = Date.now();
    const upcoming = events
      .filter(e => e.status === 'PUBLISHED' && Date.parse(String(e.ends_at)) >= now)
      .sort((a, b) => Date.parse(String(a.starts_at)) - Date.parse(String(b.starts_at)));
    return ticketingJson({
      organisation: organisationOf(ctx),
      user: { name: ctx.name, role: ctx.role },
      events: { total: events.length, by_status: byStatus },
      next_event: upcoming[0] ?? null,
    });
  });
}

export function handleOrganiserEvent(req: Request, id: string): Promise<Response> {
  return asOrganiser(req, 'viewer', async ctx => {
    if (!isIdentifier(id)) return notFound();
    const detail = await getOrganisationEvent(ctx.organisationId, id);
    if (!detail) return notFound();
    return ticketingJson({
      organisation: organisationOf(ctx),
      event: pick(detail.event, ['id', 'name', 'slug', 'status', 'description', 'venue', 'starts_at', 'ends_at', 'timezone']),
      sessions: detail.event_sessions.map(s => pick(s, ['id', 'name', 'starts_at', 'ends_at', 'capacity'])),
      ticket_types: detail.ticket_types.map(t =>
        pick(t, ['id', 'name', 'price_cents', 'currency', 'capacity', 'active', 'sale_starts_at', 'sale_ends_at', 'requires_access_code']),
      ),
    });
  });
}

// Filters the registrations reader understands (lib/events/registrationFilters.ts);
// anything else is dropped before it is applied.
const ORDER_FILTERS = ['q', 'paymentStatus', 'checkin', 'cancelled', 'ticketTypeId', 'sessionId'] as const;

function allowedFilters(req: Request): URLSearchParams {
  const incoming = new URL(req.url).searchParams;
  const out = new URLSearchParams();
  for (const k of ORDER_FILTERS) {
    const v = incoming.get(k);
    if (v && v.length <= 200) out.set(k, v);
  }
  return out;
}

type OrderRow = Json & { attendees?: unknown[] };

const ORDER_FIELDS = [
  'id', 'purchaser_name', 'purchaser_email', 'status', 'payment_status', 'total_cents', 'payment_total_cents',
  'discount_cents', 'currency', 'created_at', 'paid_at', 'refunded_at',
] as const;
const ATTENDEE_FIELDS = ['id', 'name', 'email', 'checked_in_at', 'checked_in_by'] as const;

// The registrations reader returns one row per order line (multi-type
// carts); regroup into one order with its lines.
export function handleOrganiserOrders(req: Request, id: string): Promise<Response> {
  return asOrganiser(req, 'viewer', async ctx => {
    if (!isIdentifier(id)) return notFound();
    const rows = (await listEventRegistrationRows(ctx.organisationId, id, allowedFilters(req))) as OrderRow[] | null;
    if (!rows) return notFound();
    const orders = new Map<string, Json & { lines: Json[] }>();
    for (const row of rows) {
      const key = String(row.id);
      let order = orders.get(key);
      if (!order) {
        order = { ...pick(row, ORDER_FIELDS), lines: [] };
        orders.set(key, order);
      }
      order.lines.push({
        ticket_type_name: row.ticket_type_name ?? null,
        session_name: row.session_name ?? null,
        quantity: row.quantity ?? 0,
      });
    }
    return ticketingJson({ orders: [...orders.values()] });
  });
}

export function handleOrganiserAttendees(req: Request, id: string): Promise<Response> {
  return asOrganiser(req, 'viewer', async ctx => {
    if (!isIdentifier(id)) return notFound();
    const rows = (await listEventRegistrationRows(ctx.organisationId, id, allowedFilters(req))) as OrderRow[] | null;
    if (!rows) return notFound();
    const attendees: Json[] = [];
    for (const row of rows) {
      for (const a of row.attendees ?? []) {
        attendees.push({
          ...pick(a, ATTENDEE_FIELDS),
          ticket_type_name: row.ticket_type_name ?? null,
          session_name: row.session_name ?? null,
          order_id: row.id,
          order_status: row.status,
          payment_status: row.payment_status,
          purchaser_name: row.purchaser_name,
        });
      }
    }
    return ticketingJson({ attendees });
  });
}

export function handleOrganiserCheckInSearch(req: Request, id: string): Promise<Response> {
  return asOrganiser(req, 'viewer', async ctx => {
    if (!isIdentifier(id) || !(await eventBelongsToOrganisation(ctx.organisationId, id))) return notFound();
    const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 200);
    return ticketingJson({ attendees: await searchAttendees(ctx.organisationId, id, q) });
  });
}

function parseIdentifier(body: { ticket_token?: unknown; attendee_id?: unknown }): AttendeeIdentifier | null {
  if (typeof body.ticket_token === 'string' && body.ticket_token.trim()) return { ticket_token: body.ticket_token.trim().slice(0, 200) };
  if (typeof body.attendee_id === 'string' && body.attendee_id.trim()) return { attendee_id: body.attendee_id.trim().slice(0, 200) };
  return null;
}

// Same wording the BrainBase check-in routes return, so either product's
// operator sees the same messages.
function failure(reason: string): Response {
  const message =
    reason === 'cancelled' ? 'Ticket cancelled.'
    : reason === 'unpaid' ? 'Payment not completed.'
    : reason === 'event_cancelled' ? 'Event cancelled.'
    : 'Ticket not valid.';
  return ticketingJson({ error: message, reason }, reason === 'not_found' ? 404 : 409);
}

async function readJsonBody(req: Request): Promise<Json | null> {
  const text = await readBodyText(req);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Json) : null;
  } catch {
    return null;
  }
}

// resolve is viewer+; confirm and undo are manager+ — enforced here by
// authorizeTicketingApiRequest() against the freshly reloaded role.
export function handleOrganiserCheckIn(req: Request, id: string, action: 'resolve' | 'confirm' | 'undo'): Promise<Response> {
  return asOrganiser(req, action === 'resolve' ? 'viewer' : 'manager', async ctx => {
    if (!isIdentifier(id) || !(await eventBelongsToOrganisation(ctx.organisationId, id))) return notFound();
    const body = await readJsonBody(req);
    if (!body) return ticketingJson({ error: 'Invalid body.' }, 400);

    if (action === 'undo') {
      const attendeeId = typeof body.attendee_id === 'string' ? body.attendee_id.trim() : '';
      if (!attendeeId) return ticketingJson({ error: 'Attendee not found.' }, 404);
      const result = await undoCheckInWithAudit(ctx.organisationId, id, attendeeId, ctx.userId);
      if (!result.ok) {
        return ticketingJson(
          { error: result.reason === 'not_checked_in' ? 'This attendee is not currently checked in.' : 'Attendee not found.' },
          result.reason === 'not_checked_in' ? 409 : 404,
        );
      }
      return ticketingJson({ attendee: result.attendee });
    }

    const identifier = parseIdentifier(body);
    if (!identifier) return ticketingJson({ error: 'Ticket not valid.', reason: 'not_found' }, 404);

    if (action === 'resolve') {
      const result = await resolveAttendee(ctx.organisationId, id, identifier);
      return result.ok ? ticketingJson({ attendee: result.attendee }) : failure(result.reason);
    }

    const result = await confirmCheckInWithAudit(ctx.organisationId, id, identifier, ctx.userId);
    if (!result.ok) return failure(result.reason);
    return ticketingJson({ first: result.first, attendee: result.attendee }, result.first ? 200 : 409);
  });
}
