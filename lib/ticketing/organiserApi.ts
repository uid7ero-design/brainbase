import 'server-only';
import type { Role } from '@/lib/session';
import {
  getOrganisationEvent,
  listEventRegistrationRows,
  listOrganisationEvents,
} from '@/lib/events/organiserReads';
import { resolveAttendee, searchAttendees, type AttendeeIdentifier } from '@/lib/events/checkIn';
import { confirmCheckInWithAudit, eventBelongsToOrganisation, undoCheckInWithAudit } from '@/lib/events/checkInOps';
import { listPaymentOrders, getPaymentOrder, type PaymentOrderRow } from '@/lib/events/organiserPayments';
import { getConnectAccountState, checkPaidTicketingEligibility } from '@/lib/events/stripeConnect';
import {
  brandingView, countEventFeeOverrides, feePolicyView, getOrganisationRow, getOwnEvent, resolveEffectiveFeePolicy,
} from '@/lib/events/organiserSettings';
import {
  feeModeOf, isPaymentState, organiserShareBeforeProcessingCents, paymentTotalCents, refundedAmountCents, summarisePayments,
} from '@ticketing/core';
import { authorizeTicketingApiRequest, type TicketingContext } from './authorize';
import { LIMITS, limit, type LimitPolicy } from './rateLimit';
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
// retry, resend, export and payments onboarding. Payments are READ-ONLY
// (GET only): the two payment handlers below read committed order snapshots
// and cached account columns — no provider call and no write.

type Json = Record<string, unknown>;

// Identity for the limiter comes from the VERIFIED context only (never a
// request value). `eventId` narrows the door classes to one event. A limited
// request is refused before the handler reads or writes anything.
async function asOrganiser(
  req: Request,
  minRole: Role,
  fn: (ctx: TicketingContext) => Promise<Response>,
  opts: { policy?: LimitPolicy; eventId?: string } = {},
): Promise<Response> {
  const auth = await authorizeTicketingApiRequest(req, minRole);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;
  const policy = opts.policy ?? LIMITS.organiserRead;
  const dims = opts.eventId ? [ctx.organisationId, ctx.userId, opts.eventId] : [ctx.organisationId, ctx.userId];
  const decision = await limit(policy, dims);
  if (!decision.allowed) {
    return decision.reason === 'UNAVAILABLE'
      ? ticketingJson({ error: 'Unable to verify request limits right now.' }, 503)
      : ticketingJson({ error: 'Too many requests. Please slow down.' }, 429);
  }
  return fn(ctx);
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
  }, { policy: LIMITS.checkInLookup, eventId: isIdentifier(id) ? id : 'invalid' });
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
  }, { policy: action === 'resolve' ? LIMITS.checkInLookup : LIMITS.checkInMutation, eventId: isIdentifier(id) ? id : 'invalid' });
}

// ── Payments (read-only) ────────────────────────────────────────────────

const PAYMENT_LIST_CAP = 200;

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Allow-listed projection of one payment-bearing order. Money fields are the
// order's own snapshot (never recomputed from a fee policy); no Stripe id, no
// ticket or booking token, no answers, no CRM id.
function paymentView(r: PaymentOrderRow): Json {
  const snapshot = {
    payment_status: r.payment_status,
    total_cents: r.total_cents,
    platform_fee_cents: r.platform_fee_cents,
    fee_mode: r.fee_mode,
    payment_total_cents: r.payment_total_cents,
    refunded_cents: r.refunded_cents,
  };
  return {
    id: r.id,
    event: { id: r.event_id, name: r.event_name, timezone: r.event_timezone },
    purchaser_name: r.purchaser_name,
    purchaser_email: r.purchaser_email,
    order_status: r.status,
    payment_state: r.payment_status,
    currency: (r.currency ?? 'AUD').toUpperCase(),
    created_at: iso(r.created_at),
    paid_at: iso(r.paid_at),
    refunded_at: iso(r.refunded_at),
    ticket_total_cents: r.total_cents,
    discount_cents: r.discount_cents ?? 0,
    platform_fee_cents: r.platform_fee_cents ?? 0,
    fee_mode: feeModeOf(snapshot),
    fee_label: r.fee_label,
    payment_total_cents: paymentTotalCents(snapshot),
    refunded_amount_cents: refundedAmountCents(snapshot),
    platform_fee_refunded_cents: r.payment_status === 'REFUNDED' ? (r.platform_fee_refunded_cents ?? null) : null,
    organiser_share_before_processing_cents: organiserShareBeforeProcessingCents(snapshot),
  };
}

// Cached Connect state only (organisations.stripe_* columns, as the paid-
// checkout gate reads them) — no live Stripe call. The connected account id
// and every other provider identifier are deliberately NOT projected.
async function connectView(organisationId: string): Promise<Json | null> {
  try {
    const state = await getConnectAccountState(organisationId);
    const eligibility = await checkPaidTicketingEligibility(organisationId);
    return {
      status: state.status,
      connected: state.accountId !== null,
      charges_enabled: state.chargesEnabled,
      payouts_enabled: state.payoutsEnabled,
      details_submitted: state.detailsSubmitted,
      eligible_for_paid_ticketing: eligibility.eligible,
      connected_at: state.connectedAt,
      last_synced_at: state.lastSyncedAt,
    };
  } catch {
    return null;
  }
}

// GET /payments?status=&event= — viewer+. The summary covers every
// payment-bearing order of the organisation (optionally one event); the list
// applies the status filter and is capped.
export function handleOrganiserPayments(req: Request): Promise<Response> {
  return asOrganiser(req, 'viewer', async ctx => {
    const params = new URL(req.url).searchParams;
    const status = params.get('status');
    const event = params.get('event');
    if (status !== null && status !== '' && !isPaymentState(status)) return ticketingJson({ error: 'Invalid status filter.' }, 400);
    if (event !== null && event !== '' && !isIdentifier(event)) return ticketingJson({ error: 'Invalid event filter.' }, 400);

    const { rows, truncated } = await listPaymentOrders(ctx.organisationId, event || null);
    const filtered = status ? rows.filter(r => r.payment_status === status) : rows;
    return ticketingJson({
      organisation: organisationOf(ctx),
      connect: await connectView(ctx.organisationId),
      filter: { status: status || null, event: event || null },
      summary: { currencies: summarisePayments(rows), complete: !truncated },
      orders: filtered.slice(0, PAYMENT_LIST_CAP).map(paymentView),
      orders_truncated: filtered.length > PAYMENT_LIST_CAP,
    });
  });
}

// GET /payments/[orderId] — viewer+. An order of another tenant, a free
// order and an unknown id are all the same 404.
export function handleOrganiserPayment(req: Request, orderId: string): Promise<Response> {
  return asOrganiser(req, 'viewer', async ctx => {
    if (!isIdentifier(orderId)) return notFound();
    const found = await getPaymentOrder(ctx.organisationId, orderId);
    if (!found) return notFound();
    return ticketingJson({
      organisation: organisationOf(ctx),
      order: paymentView(found.order),
      lines: found.lines.map(l => ({
        description: l.description ?? 'Ticket',
        quantity: l.quantity,
        unit_price_cents: l.unit_price_cents,
        discount_cents: l.discount_cents ?? 0,
      })),
    });
  });
}

// ── Settings (read-only) ────────────────────────────────────────────────

// GET /settings[?event=<id>] — viewer+. Organisation, ticketing status,
// cached Connect state, the EFFECTIVE fee policy (organisation level, or the
// named event's when ?event= is given, using the checkout's own resolver),
// and the organiser's saved buyer branding. Entitlement 'config' is never
// returned: only that Events is enabled, which the authorisation above has
// just proved (a caller without the capability never reaches this point).
export function handleOrganiserSettings(req: Request): Promise<Response> {
  return asOrganiser(req, 'viewer', async ctx => {
    const event = new URL(req.url).searchParams.get('event');
    if (event !== null && event !== '' && !isIdentifier(event)) return ticketingJson({ error: 'Invalid event.' }, 400);

    const org = await getOrganisationRow(ctx.organisationId);
    if (!org) return notFound();
    const ownEvent = event ? await getOwnEvent(ctx.organisationId, event) : null;
    if (event && !ownEvent) return notFound();

    let fees: Json;
    try {
      const resolution = await resolveEffectiveFeePolicy(ctx.organisationId, ownEvent?.id ?? null);
      fees = {
        scope: ownEvent ? { level: 'EVENT', event: { id: ownEvent.id, name: ownEvent.name } } : { level: 'ORGANISATION', event: null },
        effective: feePolicyView(resolution),
        event_overrides_count: await countEventFeeOverrides(ctx.organisationId),
      };
    } catch {
      // A policy row this code cannot interpret (the checkout fails closed on it too).
      fees = { scope: { level: ownEvent ? 'EVENT' : 'ORGANISATION', event: ownEvent }, effective: null, event_overrides_count: null, unavailable: true };
    }

    const connect = await connectView(ctx.organisationId);
    return ticketingJson({
      organisation: { name: org.name, slug: org.slug },
      user: { name: ctx.name, role: ctx.role },
      events_capability: { enabled: true },
      ticketing: { paid_ticketing_available: connect ? connect.eligible_for_paid_ticketing === true : null },
      connect,
      fees,
      branding: brandingView(org.settings, org.name),
    });
  });
}
