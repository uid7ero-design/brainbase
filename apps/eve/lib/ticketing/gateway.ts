import type { PublicTicketStatus } from '@ticketing/core';
import { readApiConfig } from './serverConfig';

// The data seam between this product's UI and the shared ticketing backend:
// a server-side client of the authenticated /api/ticketing surface. The
// browser never reaches it — only server components and this app's own
// route handlers import it. It holds the server-to-server credential and
// returns what the API returned, or an explicit non-ok result; it never
// fabricates records.

export type GatewayResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'unavailable'; reason: 'not_connected' | 'upstream_unreachable' }
  | { status: 'unauthorised' }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'error'; httpStatus: number; message: string; body: Record<string, unknown> };

type CallOptions = { method?: 'GET' | 'POST'; body?: unknown; session?: string | null; clientIp?: string | null };

async function call<T>(path: string, opts: CallOptions = {}): Promise<GatewayResult<T>> {
  const config = readApiConfig();
  if (!config) {
    console.error('[ticketing-gateway] API connection is not configured');
    return { status: 'unavailable', reason: 'not_connected' };
  }

  const headers: Record<string, string> = { 'x-ticketing-api-key': config.secret, accept: 'application/json' };
  if (config.protectionBypass) headers['x-vercel-protection-bypass'] = config.protectionBypass;
  if (opts.session) headers['x-ticketing-session'] = opts.session;
  if (opts.clientIp) headers['x-ticketing-client-ip'] = opts.clientIp;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/api/ticketing${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    console.error(`[ticketing-gateway] ${opts.method ?? 'GET'} ${path.split('?')[0]} unreachable`);
    return { status: 'unavailable', reason: 'upstream_unreachable' };
  }

  // Operational signal only: method, path (no query) and status. Never headers or bodies.
  if (res.status >= 300 && res.status !== 404 && res.status !== 409) {
    console.error(`[ticketing-gateway] ${opts.method ?? 'GET'} ${path.split('?')[0]} -> ${res.status}`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { status: 'ok', data: body as T };
  if (res.status === 401) return { status: 'unauthorised' };
  if (res.status === 403) return { status: 'forbidden' };
  if (res.status === 404) return { status: 'not_found' };
  return { status: 'error', httpStatus: res.status, message: typeof body.error === 'string' ? body.error : 'Request failed.', body };
}

// ── Shapes: the subset of the API's allow-listed responses this UI reads ──

export type PublicEventDetail = {
  event: { name: string; slug: string; description: string | null; venue: string | null; artwork_url: string | null; starts_at: string; ends_at: string; timezone: string };
  sessions: { id: string; name: string; starts_at: string; ends_at: string; capacity: number; remaining: number }[];
  ticket_types: {
    id: string; name: string; description: string | null; price_cents: number; capacity: number; remaining: number;
    sale_starts_at: string | null; sale_ends_at: string | null; sale_status: 'COMING_SOON' | 'ON_SALE' | 'SALES_ENDED'; requires_access_code: boolean;
  }[];
  session_inventory: { ticket_type_id: string; event_session_id: string; capacity: number; remaining: number }[];
  has_promotions: boolean;
  organisationName: string;
};

export type TicketDetail = {
  attendee_name: string;
  checked_in_at: string | null;
  status: PublicTicketStatus;
  event: { name: string; venue: string | null; artwork_url: string | null; starts_at: string; ends_at: string; timezone: string };
  ticket_type_name: string | null;
  session: { name: string; starts_at: string; ends_at: string } | null;
  organisationName: string;
  qr_svg: string | null;
};

export type BookingDetail = {
  purchaser_name: string;
  event: TicketDetail['event'];
  tickets: { attendee_name: string; ticket_type_name: string | null; session: TicketDetail['session']; ticket_token: string; checked_in_at: string | null; status: PublicTicketStatus }[];
  organisationName: string;
};

export type CheckoutStatus = {
  payment_status: string;
  order_status: string;
  amount_total_cents: number;
  currency: string;
  tickets: { attendee_name: string; ticket_token: string }[];
};

export type OrganiserSession = { user: { id: string; name: string; role: string }; organisationId: string; organisation: { slug: string; name: string } };
export type OrganiserEvent = { id: string; name: string; slug: string; status: string; venue: string | null; starts_at: string; ends_at: string; timezone: string; session_count: number; ticket_type_count: number };
export type OrganiserOrder = {
  id: string; purchaser_name: string; purchaser_email: string; status: string; payment_status: string;
  total_cents: number; payment_total_cents: number | null; discount_cents: number | null; currency: string; created_at: string; paid_at: string | null;
  lines: { ticket_type_name: string | null; session_name: string | null; quantity: number }[];
};
export type OrganiserAttendee = {
  id: string; name: string; email: string | null; checked_in_at: string | null; checked_in_by: string | null;
  ticket_type_name: string | null; session_name: string | null; order_status: string; payment_status: string; purchaser_name: string;
};
export type CheckInAttendee = { id: string; attendee_name: string; ticket_type_name: string | null; session_name: string | null; checked_in_at: string | null };

export type LoginResult = { token: string; expiresAt: number; user: { id: string; name: string; role: string }; organisationId: string };

const enc = encodeURIComponent;
const ev = (o: string, e: string) => `/public/events/${enc(o)}/${enc(e)}`;

export function createGateway() {
  return {
    // Public (anonymous buyer) calls.
    getPublicEvent: (o: string, e: string) => call<PublicEventDetail>(ev(o, e)),
    getTicket: (token: string) => call<TicketDetail>(`/public/tickets/${enc(token)}`),
    getBookingWallet: (token: string) => call<BookingDetail>(`/public/bookings/${enc(token)}`),
    getCheckoutStatus: (o: string, e: string, sessionId: string, clientIp?: string | null) =>
      call<CheckoutStatus>(`${ev(o, e)}/checkout/status?session_id=${enc(sessionId)}`, { clientIp }),
    buyerAction: (o: string, e: string, action: 'quote' | 'register' | 'checkout', body: unknown, clientIp?: string | null) =>
      call<Record<string, unknown>>(`${ev(o, e)}/${action}`, { method: 'POST', body, clientIp }),

    // Auth.
    login: (body: { username: string; password: string; organisationId?: string }, clientIp?: string | null) =>
      call<LoginResult>('/auth/login', { method: 'POST', body, clientIp }),
    logout: (session: string | null) => call<{ ok: true }>('/auth/logout', { method: 'POST', session }),
    getSession: (session: string | null) => call<OrganiserSession>('/auth/session', { session }),
    listOrganisations: (session: string | null) => call<{ organisations: { id: string; name: string }[] }>('/auth/organisation', { session }),
    switchOrganisation: (session: string | null, organisationId: string) =>
      call<{ token: string; expiresAt: number; organisationId: string }>('/auth/organisation', { method: 'POST', session, body: { organisationId } }),

    // Organiser (session required).
    listEvents: (session: string | null) => call<{ organisation: { slug: string; name: string }; events: OrganiserEvent[] }>('/organiser/events', { session }),
    listOrders: (session: string | null, eventId: string) => call<{ orders: OrganiserOrder[] }>(`/organiser/events/${enc(eventId)}/orders`, { session }),
    listAttendees: (session: string | null, eventId: string) => call<{ attendees: OrganiserAttendee[] }>(`/organiser/events/${enc(eventId)}/attendees`, { session }),
    checkInSearch: (session: string | null, eventId: string, q: string) =>
      call<{ attendees: CheckInAttendee[] }>(`/organiser/events/${enc(eventId)}/check-in/search?q=${enc(q)}`, { session }),
    checkInAction: (session: string | null, eventId: string, action: 'resolve' | 'confirm' | 'undo', body: unknown) =>
      call<{ attendee?: CheckInAttendee; first?: boolean }>(`/organiser/events/${enc(eventId)}/check-in/${action}`, { method: 'POST', session, body }),
  };
}

export type TicketingGateway = ReturnType<typeof createGateway>;

export function getTicketingGateway(): TicketingGateway {
  return createGateway();
}
