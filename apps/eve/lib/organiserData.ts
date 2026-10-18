import { getTicketingGateway, type OrganiserAttendee, type OrganiserEvent, type OrganiserOrder, type OrganiserPaymentDetail, type OrganiserPayments } from './ticketing/gateway';
import { redirect } from 'next/navigation';

// Loads for the organiser pages. A non-ok API answer is surfaced as an
// error the page renders honestly; an unauthorised answer (the session or
// entitlement was revoked) sends the organiser back to sign-in.

export class OrganiserDataError extends Error {}

function failOrRedirect(status: string): never {
  if (status === 'unauthorised' || status === 'forbidden') redirect('/signin?reason=session');
  throw new OrganiserDataError('The ticketing service could not be reached.');
}

export async function loadEvents(token: string): Promise<OrganiserEvent[]> {
  const r = await getTicketingGateway().listEvents(token);
  if (r.status !== 'ok') failOrRedirect(r.status);
  return r.data.events;
}

export async function loadOrders(token: string, eventId: string): Promise<OrganiserOrder[]> {
  const r = await getTicketingGateway().listOrders(token, eventId);
  if (r.status === 'not_found') return [];
  if (r.status !== 'ok') failOrRedirect(r.status);
  return r.data.orders;
}

export async function loadPayments(token: string, filter: { status?: string; event?: string }): Promise<OrganiserPayments> {
  const r = await getTicketingGateway().listPayments(token, filter);
  if (r.status !== 'ok') failOrRedirect(r.status);
  return r.data;
}

export async function loadPayment(token: string, orderId: string): Promise<OrganiserPaymentDetail | null> {
  const r = await getTicketingGateway().getPayment(token, orderId);
  if (r.status === 'not_found') return null;
  if (r.status !== 'ok') failOrRedirect(r.status);
  return r.data;
}

export async function loadAttendees(token: string, eventId: string): Promise<OrganiserAttendee[]> {
  const r = await getTicketingGateway().listAttendees(token, eventId);
  if (r.status === 'not_found') return [];
  if (r.status !== 'ok') failOrRedirect(r.status);
  return r.data.attendees;
}

// Picks the event named by ?event=, else the first listed. Never invents one.
export function pickEvent(events: OrganiserEvent[], requested: string | undefined): OrganiserEvent | null {
  return events.find(e => e.id === requested) ?? events[0] ?? null;
}

const OVERVIEW_EVENT_CAP = 25;

export type Overview = {
  eventCount: number;
  publishedCount: number;
  orderCount: number;
  paidOrderCount: number;
  ticketCount: number;
  checkedInCount: number;
  truncated: boolean;
};

// Counts are derived from the same lists the Orders and Attendees pages
// show, for at most OVERVIEW_EVENT_CAP events (reported when exceeded).
export async function loadOverview(token: string, events: OrganiserEvent[]): Promise<Overview> {
  const subset = events.slice(0, OVERVIEW_EVENT_CAP);
  const perEvent = await Promise.all(subset.map(async e => ({ orders: await loadOrders(token, e.id), attendees: await loadAttendees(token, e.id) })));
  let orderCount = 0, paidOrderCount = 0, ticketCount = 0, checkedInCount = 0;
  for (const { orders, attendees } of perEvent) {
    const live = orders.filter(o => o.status !== 'CANCELLED');
    orderCount += live.length;
    paidOrderCount += live.filter(o => o.payment_status === 'PAID').length;
    const liveAttendees = attendees.filter(a => a.order_status !== 'CANCELLED');
    ticketCount += liveAttendees.length;
    checkedInCount += liveAttendees.filter(a => a.checked_in_at).length;
  }
  return {
    eventCount: events.length,
    publishedCount: events.filter(e => e.status === 'PUBLISHED').length,
    orderCount, paidOrderCount, ticketCount, checkedInCount,
    truncated: events.length > OVERVIEW_EVENT_CAP,
  };
}
