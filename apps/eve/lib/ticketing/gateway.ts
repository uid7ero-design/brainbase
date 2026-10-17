import type { EventStatus, OrderStatus, PaymentStatus, PublicTicketStatus, SaleStatus } from '@ticketing/core';

// The data seam between this product's UI and the shared ticketing
// backend. Phase 1 defines the contract and ships exactly one
// implementation, `unavailableGateway`, which answers every call with an
// explicit "unavailable" result. The browser never talks to a database;
// Phase 2 replaces this with a server-side client of the authenticated
// ticketing API (see apps/eve/README.md §Data). Nothing here may ever
// return invented records.

export type GatewayResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'unavailable'; reason: 'not_connected' | 'not_authorised' | 'not_found' };

export type PublicEventSummary = {
  slug: string;
  name: string;
  status: EventStatus;
  venueName: string | null;
  startsAt: string | null;
  sessions: { id: string; name: string; startsAt: string; saleStatus: SaleStatus }[];
  ticketTypes: { id: string; name: string; priceCents: number; currency: string; saleStatus: SaleStatus }[];
};

export type TicketView = {
  attendeeName: string;
  eventName: string;
  sessionName: string | null;
  ticketTypeName: string;
  status: PublicTicketStatus;
};

export type BookingWalletView = {
  purchaserName: string;
  eventName: string;
  tickets: TicketView[];
};

export type OrganiserOrderRow = {
  id: string;
  purchaserName: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  totalCents: number;
  currency: string;
  createdAt: string;
};

export interface TicketingGateway {
  getPublicEvent(eventSlug: string): Promise<GatewayResult<PublicEventSummary>>;
  getTicket(ticketToken: string): Promise<GatewayResult<TicketView>>;
  getBookingWallet(bookingToken: string): Promise<GatewayResult<BookingWalletView>>;
  listOrganiserOrders(): Promise<GatewayResult<OrganiserOrderRow[]>>;
}

const unavailable = { status: 'unavailable', reason: 'not_connected' } as const;

export const unavailableGateway: TicketingGateway = {
  async getPublicEvent() { return unavailable; },
  async getTicket() { return unavailable; },
  async getBookingWallet() { return unavailable; },
  async listOrganiserOrders() { return unavailable; },
};

export function getTicketingGateway(): TicketingGateway {
  return unavailableGateway;
}
