import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import PublicEventClient from '@/app/e/[organisationSlug]/[eventSlug]/PublicEventClient';
import type { PublicEventDetail } from '@/lib/events/publicEventDetail';
import { renderBrainbase } from '../../a11y/render';

// Events Phase 4 — the public booking page rendered for real (jsdom +
// React Testing Library): sale-status labels, locked/unselectable types,
// the promotional-code and access-code inputs, server-quoted totals, and
// the submit body. The server quote is mocked at fetch level; every
// figure the page shows must come from that quote, never from the page's
// own arithmetic over the code.

const DETAIL: PublicEventDetail = {
  event: { name: 'Spring Gala', slug: 'gala', description: null, venue: null, artwork_url: null, starts_at: '2026-12-01T10:00:00.000Z', ends_at: '2026-12-01T12:00:00.000Z', timezone: 'Australia/Adelaide', has_ended: false },
  sessions: [],
  ticket_types: [
    { id: 'tt-adult', name: 'Adult', description: null, price_cents: 4000, capacity: 10, remaining: 10, sale_starts_at: null, sale_ends_at: null, sale_status: 'ON_SALE', requires_access_code: false },
    { id: 'tt-vip', name: 'VIP', description: null, price_cents: 10000, capacity: 2, remaining: 2, sale_starts_at: null, sale_ends_at: null, sale_status: 'ON_SALE', requires_access_code: true },
    { id: 'tt-early', name: 'Early Bird', description: null, price_cents: 3000, capacity: 5, remaining: 5, sale_starts_at: '2099-01-01T00:00:00.000Z', sale_ends_at: null, sale_status: 'COMING_SOON', requires_access_code: false },
    { id: 'tt-late', name: 'Late', description: null, price_cents: 3000, capacity: 5, remaining: 5, sale_starts_at: null, sale_ends_at: '2000-01-01T00:00:00.000Z', sale_status: 'SALES_ENDED', requires_access_code: false },
  ],
  session_inventory: [],
  questions: [],
  has_promotions: true,
  booking_fee: null,
  branding: { name: null, logoUrl: null, website: null, accentColor: null } as unknown as PublicEventDetail['branding'],
  organisationName: 'Org A',
};

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }));
}
function quoteFor(body: { items: { ticket_type_id: string; quantity: number }[]; promotion_code?: string; access_code?: string }) {
  const prices: Record<string, number> = { 'tt-adult': 4000, 'tt-vip': 10000, 'tt-early': 3000, 'tt-late': 3000 };
  const lines = body.items.map(it => ({ ticket_type_id: it.ticket_type_id, quantity: it.quantity, gross_cents: prices[it.ticket_type_id] * it.quantity, discount_cents: 0 }));
  const subtotal = lines.reduce((s, l) => s + l.gross_cents, 0);
  let discount = 0;
  let promotion: { code: string } | null = null;
  let promotion_error: string | null = null;
  if (body.promotion_code === 'EARLY20') {
    discount = Math.floor((subtotal * 10 + 50) / 100);
    lines.forEach(l => { l.discount_cents = Math.floor((l.gross_cents * 10 + 50) / 100); });
    promotion = { code: 'EARLY20' };
  } else if (body.promotion_code) {
    promotion_error = 'Code not valid.';
  }
  const access = body.access_code === 'MEMBERS2026' ? { unlocked_ticket_type_ids: ['tt-vip'] } : null;
  const access_error = body.access_code && !access ? 'Code not valid.' : null;
  return { subtotal_cents: subtotal, discount_cents: discount, total_cents: subtotal - discount, currency: 'AUD', pricing: subtotal > 0 ? 'PAID' : null, lines, promotion, promotion_error, access, access_error, cart_error: null };
}
function installQuoteServer() {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url.endsWith('/quote')) return json(quoteFor(JSON.parse(init!.body as string)));
    if (typeof url === 'string' && url.endsWith('/checkout')) return json({ checkout_url: 'https://checkout.stripe.test/x' }, 201);
    return json({ error: 'unexpected' }, 500);
  });
}
function row(name: string) {
  return screen.getByRole('button', { name: `Increase ${name} quantity` }).closest('.bb-ticket-row') as HTMLElement;
}
function view() {
  return <PublicEventClient organisationSlug="org-a" eventSlug="gala" detail={DETAIL} checkoutCancelled={false} />;
}

describe('sale-window and access status on the public page', () => {
  it('labels Coming soon / Sales ended / Access code required and disables their steppers; an on-sale type is selectable', () => {
    installQuoteServer();
    renderBrainbase(view());
    expect(within(row('Early Bird')).getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase Early Bird quantity' })).toBeDisabled();
    expect(within(row('Late')).getByText('Sales ended')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase Late quantity' })).toBeDisabled();
    expect(within(row('VIP')).getByText('Access code required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase VIP quantity' })).toBeDisabled();
    expect(within(row('Adult')).getByText('10 places remaining')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase Adult quantity' })).toBeEnabled();
    // Default selection is the first ON_SALE, unrestricted type (Adult × 1).
    expect(screen.getByRole('button', { name: 'Pay $40.00' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled(); // no code -> no quote
  });

  it('offers both code inputs (the event has live promotions and a restricted type)', () => {
    installQuoteServer();
    renderBrainbase(view());
    expect(screen.getByLabelText('Access code')).toBeInTheDocument();
    expect(screen.getByLabelText('Promotional code')).toBeInTheDocument();
    expect(screen.getByText('Codes')).toBeInTheDocument();
  });
});

describe('ended event', () => {
  it('the server says has_ended: a neutral "This event has ended." and no booking, code or payment controls', () => {
    installQuoteServer();
    renderBrainbase(<PublicEventClient organisationSlug="org-a" eventSlug="gala" detail={{ ...DETAIL, event: { ...DETAIL.event, has_ended: true } }} checkoutCancelled={false} />);
    expect(screen.getByTestId('event-ended')).toHaveTextContent('This event has ended.');
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Pay |Register|Complete/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Increase Adult quantity' })).toBeNull();
    expect(screen.queryByLabelText('Promotional code')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// The availability badge beside the event details. Ended-ness is the
// server's has_ended verdict only — the page never compares dates itself,
// so each case below sets has_ended explicitly and the fixture dates are
// deliberately irrelevant to the outcome.
describe('availability badge', () => {
  const ADULT = DETAIL.ticket_types[0];
  function badgeFor(event: Partial<PublicEventDetail['event']>, ticketTypes = DETAIL.ticket_types) {
    installQuoteServer();
    renderBrainbase(<PublicEventClient organisationSlug="org-a" eventSlug="gala" detail={{ ...DETAIL, event: { ...DETAIL.event, ...event }, ticket_types: ticketTypes }} checkoutCancelled={false} />);
    return screen.getByTestId('availability-badge');
  }

  it('upcoming event with places left: "Tickets available"', () => {
    expect(badgeFor({ starts_at: '2099-12-01T10:00:00.000Z', ends_at: '2099-12-01T12:00:00.000Z', has_ended: false })).toHaveTextContent('Tickets available');
  });

  it('event in progress (started, not ended per the server): still "Tickets available"', () => {
    expect(badgeFor({ starts_at: '2000-01-01T00:00:00.000Z', ends_at: '2099-12-01T12:00:00.000Z', has_ended: false })).toHaveTextContent('Tickets available');
  });

  it('sold-out event that has not ended: "Sold out" (unchanged)', () => {
    expect(badgeFor({ has_ended: false }, [{ ...ADULT, remaining: 0 }])).toHaveTextContent('Sold out');
  });

  it('NULL ends_at (never ended): existing behaviour', () => {
    expect(badgeFor({ ends_at: null as unknown as string, has_ended: false })).toHaveTextContent('Tickets available');
  });

  it('ended event: a neutral "Event ended" — never "Tickets available"', () => {
    const badge = badgeFor({ has_ended: true });
    expect(badge).toHaveTextContent('Event ended');
    expect(screen.queryByText('Tickets available')).toBeNull();
    expect(screen.queryByText('Sold out')).toBeNull();
    expect(screen.getByTestId('event-ended')).toHaveTextContent('This event has ended.');
  });

  it('ended event with no places left still reads "Event ended", not "Sold out"', () => {
    expect(badgeFor({ has_ended: true }, [{ ...ADULT, remaining: 0 }])).toHaveTextContent('Event ended');
    expect(screen.queryByText('Sold out')).toBeNull();
  });

  it('the server verdict decides, not the dates: a past ends_at with has_ended false keeps the normal badge', () => {
    expect(badgeFor({ ends_at: '2000-01-01T00:00:00.000Z', has_ended: false })).toHaveTextContent('Tickets available');
  });
});

describe('promotional code → server-quoted totals', () => {
  it('applies EARLY20: shows subtotal / discount / total from the quote and the CTA pays the quoted total', async () => {
    installQuoteServer();
    const { user } = renderBrainbase(view());
    await user.click(screen.getByRole('button', { name: 'Increase Adult quantity' })); // 2 × Adult = $80
    await user.type(screen.getByLabelText('Promotional code'), 'early20');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('EARLY20 applied — $8.00 off');
    const totals = screen.getByTestId('cart-totals');
    expect(totals).toHaveTextContent('Subtotal $80.00');
    expect(totals).toHaveTextContent('Discount (EARLY20) −$8.00');
    expect(totals).toHaveTextContent('Total $72.00');
    expect(screen.getByRole('button', { name: 'Pay $72.00' })).toBeEnabled();
    const quoteCall = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/quote'))!;
    expect(JSON.parse(quoteCall[1].body)).toEqual({ items: [{ ticket_type_id: 'tt-adult', quantity: 2 }], promotion_code: 'EARLY20' });
  });

  it('re-quotes when the cart changes, and removing the code restores the plain total without a further request', async () => {
    installQuoteServer();
    const { user } = renderBrainbase(view());
    await user.type(screen.getByLabelText('Promotional code'), 'EARLY20');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('EARLY20 applied — $4.00 off');
    await user.click(screen.getByRole('button', { name: 'Increase Adult quantity' }));
    await screen.findByText('EARLY20 applied — $8.00 off');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pay $72.00' })).toBeInTheDocument());
    const before = fetchMock.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Remove promotional code EARLY20' }));
    expect(screen.getByRole('button', { name: 'Pay $80.00' })).toBeInTheDocument();
    expect(screen.queryByTestId('cart-totals')).not.toBeInTheDocument();
    await new Promise(r => setTimeout(r, 350));
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('an invalid code shows the server\'s generic message and leaves the total untouched', async () => {
    installQuoteServer();
    const { user } = renderBrainbase(view());
    await user.type(screen.getByLabelText('Promotional code'), 'NOPE123');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Code not valid.');
    expect(screen.getByRole('button', { name: 'Pay $40.00' })).toBeInTheDocument();
    expect(screen.queryByTestId('cart-totals')).not.toBeInTheDocument();
  });
});

describe('access code → unlocks a restricted type', () => {
  it('unlocks VIP after the server confirms, locks it again on Remove (dropping it from the cart)', async () => {
    installQuoteServer();
    const { user } = renderBrainbase(view());
    await user.type(screen.getByLabelText('Access code'), 'members2026');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByText('MEMBERS2026 applied — 1 ticket type unlocked');
    expect(within(row('VIP')).getByText('2 places remaining')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Increase VIP quantity' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pay $140.00' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Remove access code MEMBERS2026' }));
    expect(within(row('VIP')).getByText('Access code required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay $40.00' })).toBeInTheDocument(); // VIP dropped, Adult × 1 remains
  });

  it('submits code TEXT only (no discount or total) alongside the cart, and redirects to the server-issued checkout URL', async () => {
    installQuoteServer();
    const { user } = renderBrainbase(view());
    await user.type(screen.getByLabelText('Access code'), 'MEMBERS2026');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByText('MEMBERS2026 applied — 1 ticket type unlocked');
    await user.type(screen.getByLabelText('Promotional code'), 'EARLY20');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('EARLY20 applied — $4.00 off');
    await user.type(screen.getByLabelText('Name'), 'Pat');
    await user.type(screen.getByLabelText('Email'), 'pat@example.com');
    await user.type(screen.getByLabelText('Attendee 1'), 'Pat');
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, set href(v: string) { assign(v); } }, writable: true });
    await user.click(screen.getByRole('button', { name: 'Pay $36.00' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/x'));
    const checkoutCall = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/checkout'))!;
    const body = JSON.parse(checkoutCall[1].body);
    expect(body).toMatchObject({ items: [{ ticket_type_id: 'tt-adult', quantity: 1 }], promotion_code: 'EARLY20', access_code: 'MEMBERS2026', purchaser_email: 'pat@example.com' });
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['total_cents', 'discount_cents', 'subtotal_cents']));
  });
});
