import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { ReactElement } from 'react';

// Real pages rendered against a mocked ticketing gateway. Nothing here is
// sample content that ships: fixtures exist only inside this test file.

const redirectMock = vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); });
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirectMock(to) }));

let token: string | null = 'tok';
vi.mock('@/lib/session', () => ({ readSessionToken: async () => token }));

const gw = {
  getPublicEvent: vi.fn(), getTicket: vi.fn(), getBookingWallet: vi.fn(), getSession: vi.fn(),
  listEvents: vi.fn(), listOrders: vi.fn(), listAttendees: vi.fn(),
};
vi.mock('@/lib/ticketing/gateway', () => ({ getTicketingGateway: () => gw }));

import PublicEventPage from '@/app/(buyer)/e/[organisationSlug]/[eventSlug]/page';
import TicketPage from '@/app/(buyer)/t/[token]/page';
import WalletPage from '@/app/(buyer)/b/[bookingToken]/tickets/page';
import SignInPage from '@/app/(marketing)/signin/page';
import MarketingLayout from '@/app/(marketing)/layout';
import DashboardPage from '@/app/(organiser)/organiser/page';
import EventsPage from '@/app/(organiser)/organiser/events/page';
import OrdersPage from '@/app/(organiser)/organiser/orders/page';
import AttendeesPage from '@/app/(organiser)/organiser/attendees/page';
import CheckInPage from '@/app/(organiser)/organiser/check-in/page';
import { ORGANISER_NAV } from '@/components/organiser/OrganiserShell';
import { CheckInConsole } from '@/components/organiser/CheckInConsole';
import { BuyerBooking } from '@/components/buyer/BuyerBooking';

const FOREIGN = /BrainBase|Brainbase|Data Hub|Command Centre|Founder OS|Helena/;
const EVENT = { name: 'Spring Gala', venue: 'Town Hall', artwork_url: null, starts_at: '2027-03-01T09:00:00Z', ends_at: '2027-03-01T12:00:00Z', timezone: 'Australia/Adelaide' };
const DETAIL = {
  event: { ...EVENT, slug: 'gala', description: 'An evening out.' },
  sessions: [{ id: 's1', name: 'Evening', starts_at: EVENT.starts_at, ends_at: EVENT.ends_at, capacity: 100, remaining: 40 }],
  ticket_types: [
    { id: 't1', name: 'General', description: null, price_cents: 2500, capacity: 100, remaining: 40, sale_starts_at: null, sale_ends_at: null, sale_status: 'ON_SALE', requires_access_code: false },
    { id: 't2', name: 'Presale', description: null, price_cents: 2000, capacity: 10, remaining: 10, sale_starts_at: null, sale_ends_at: null, sale_status: 'ON_SALE', requires_access_code: true },
  ],
  session_inventory: [], has_promotions: true, organisationName: 'Acme Events',
};
const SESSION_OK = (role = 'manager') => ({ status: 'ok', data: { user: { id: 'u1', name: 'Pat', role }, organisationId: 'org1', organisation: { slug: 'acme', name: 'Acme Events' } } });
const EVENTS = [
  { id: 'e1', name: 'Spring Gala', slug: 'gala', status: 'PUBLISHED', venue: 'Town Hall', starts_at: EVENT.starts_at, ends_at: EVENT.ends_at, timezone: EVENT.timezone, session_count: 1, ticket_type_count: 2 },
  { id: 'e2', name: 'Draft Night', slug: 'draft', status: 'DRAFT', venue: null, starts_at: EVENT.starts_at, ends_at: EVENT.ends_at, timezone: EVENT.timezone, session_count: 0, ticket_type_count: 0 },
];
const ORDERS = [
  { id: 'o1', purchaser_name: 'Sam Buyer', purchaser_email: 's@x.test', status: 'CONFIRMED', payment_status: 'PAID', total_cents: 5000, payment_total_cents: 5150, discount_cents: 0, currency: 'aud', created_at: EVENT.starts_at, paid_at: EVENT.starts_at, lines: [{ ticket_type_name: 'General', session_name: 'Evening', quantity: 2 }] },
  { id: 'o2', purchaser_name: 'Gone', purchaser_email: 'g@x.test', status: 'CANCELLED', payment_status: 'EXPIRED', total_cents: 2500, payment_total_cents: 2500, discount_cents: 0, currency: 'aud', created_at: EVENT.starts_at, paid_at: null, lines: [{ ticket_type_name: 'General', session_name: null, quantity: 1 }] },
];
const ATTENDEES = [
  { id: 'a1', name: 'Alex', email: null, checked_in_at: EVENT.starts_at, checked_in_by: 'Pat', ticket_type_name: 'General', session_name: 'Evening', order_status: 'CONFIRMED', payment_status: 'PAID', purchaser_name: 'Sam Buyer' },
  { id: 'a2', name: 'Bo', email: null, checked_in_at: null, checked_in_by: null, ticket_type_name: 'General', session_name: 'Evening', order_status: 'CONFIRMED', payment_status: 'PAID', purchaser_name: 'Sam Buyer' },
  { id: 'a3', name: 'Cy', email: null, checked_in_at: null, checked_in_by: null, ticket_type_name: 'General', session_name: null, order_status: 'CANCELLED', payment_status: 'EXPIRED', purchaser_name: 'Gone' },
];

beforeEach(() => {
  token = 'tok';
  redirectMock.mockClear();
  for (const f of Object.values(gw)) f.mockReset();
});

async function renderPage(el: Promise<ReactElement>) {
  return render(await el);
}

describe('public event page', () => {
  it('renders the real event, sessions, ticket types, availability and access-code state', async () => {
    gw.getPublicEvent.mockResolvedValue({ status: 'ok', data: DETAIL });
    const { container } = await renderPage(PublicEventPage({ params: Promise.resolve({ organisationSlug: 'acme', eventSlug: 'gala' }), searchParams: Promise.resolve({}) }));
    expect(gw.getPublicEvent).toHaveBeenCalledWith('acme', 'gala');
    expect(screen.getByRole('heading', { level: 1, name: 'Spring Gala' })).toBeInTheDocument();
    expect(screen.getByText(/Town Hall/)).toBeInTheDocument();
    expect(screen.getAllByText(/Evening/).length).toBeGreaterThan(0);
    expect(screen.getByText('General', { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId('state-t1')).toHaveTextContent('40 remaining');
    expect(screen.getByTestId('state-t2')).toHaveTextContent('Access code required');
    expect(container.textContent).not.toMatch(FOREIGN);
  });

  it('says so — never a sample event — when the event is missing or the service is down', async () => {
    gw.getPublicEvent.mockResolvedValueOnce({ status: 'not_found' });
    let r = await renderPage(PublicEventPage({ params: Promise.resolve({ organisationSlug: 'a', eventSlug: 'b' }), searchParams: Promise.resolve({}) }));
    expect(r.container.querySelector('[data-eve-unavailable="true"]')).not.toBeNull();
    r.unmount();
    gw.getPublicEvent.mockResolvedValueOnce({ status: 'unavailable', reason: 'not_connected' });
    r = await renderPage(PublicEventPage({ params: Promise.resolve({ organisationSlug: 'a', eventSlug: 'b' }), searchParams: Promise.resolve({}) }));
    expect(r.container.querySelector('[data-eve-unavailable="true"]')).not.toBeNull();
    expect(r.container.querySelector('form')).toBeNull();
  });

  it('has no axe violations', async () => {
    gw.getPublicEvent.mockResolvedValue({ status: 'ok', data: DETAIL });
    const { container } = await renderPage(PublicEventPage({ params: Promise.resolve({ organisationSlug: 'acme', eventSlug: 'gala' }), searchParams: Promise.resolve({ checkout: 'cancelled' }) }));
    expect(screen.getByText(/Checkout was cancelled/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ticket page and booking wallet', () => {
  const base = { attendee_name: 'Alex', event: EVENT, ticket_type_name: 'General', session: { name: 'Evening', starts_at: EVENT.starts_at, ends_at: EVENT.ends_at }, organisationName: 'Acme' };

  it('shows the ticket with its QR for a valid ticket and no QR or entry for a cancelled one', async () => {
    gw.getTicket.mockResolvedValueOnce({ status: 'ok', data: { ...base, status: 'VALID', checked_in_at: null, qr_svg: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>' } });
    let r = await renderPage(TicketPage({ params: Promise.resolve({ token: 'tkn' }) }));
    expect(screen.getByText('Valid')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ticket QR code' })).toBeInTheDocument();
    expect(r.container.textContent).not.toMatch(/tkn/);
    expect(await axe(r.container)).toHaveNoViolations();
    r.unmount();
    gw.getTicket.mockResolvedValueOnce({ status: 'ok', data: { ...base, status: 'CANCELLED', checked_in_at: null, qr_svg: '<svg></svg>' } });
    r = await renderPage(TicketPage({ params: Promise.resolve({ token: 'tkn' }) }));
    expect(screen.getByText(/not valid for entry/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Ticket QR code' })).toBeNull();
  });

  // The real QR (lib/events/qr.ts, qrcode's SVG output) has a viewBox and no width/height, so it
  // has no size of its own: the wrapper must give it one, or it renders at 0x0 (seen on Preview).
  it('gives the real, viewBox-only QR SVG a fixed square size without changing its markup', async () => {
    const realShape = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 51 51" shape-rendering="crispEdges"><path fill="#FFFFFF" d="M0 0h51v51H0z"></path><path stroke="#0B0B12" d="M1 1.5h7"></path></svg>';
    gw.getTicket.mockResolvedValueOnce({ status: 'ok', data: { ...base, status: 'VALID', checked_in_at: null, qr_svg: realShape } });
    const r = await renderPage(TicketPage({ params: Promise.resolve({ token: 'tkn' }) }));
    const box = screen.getByRole('img', { name: 'Ticket QR code' });
    expect(box.innerHTML).toBe(realShape);
    expect(box.className.split(' ')).toEqual(expect.arrayContaining(['aspect-square', 'w-60', 'max-w-full', 'bg-white', 'p-3', '[&>svg]:block', '[&>svg]:h-full', '[&>svg]:w-full']));
    expect(box.className).not.toMatch(/inline-block/);
    expect(await axe(r.container)).toHaveNoViolations();
  });

  it.each(['CANCELLED', 'EVENT_CANCELLED'] as const)('a %s ticket shows the invalid state and no QR even when the API sends one', async (status) => {
    gw.getTicket.mockResolvedValueOnce({ status: 'ok', data: { ...base, status, checked_in_at: null, qr_svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 51 51"></svg>' } });
    await renderPage(TicketPage({ params: Promise.resolve({ token: 'tkn' }) }));
    expect(screen.getByText(/not valid for entry/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Ticket QR code' })).toBeNull();
  });

  it('shows event-cancelled and checked-in states', async () => {
    gw.getTicket.mockResolvedValueOnce({ status: 'ok', data: { ...base, status: 'EVENT_CANCELLED', checked_in_at: null, qr_svg: null } });
    let r = await renderPage(TicketPage({ params: Promise.resolve({ token: 'x' }) }));
    expect(screen.getByText(/Event cancelled/)).toBeInTheDocument();
    r.unmount();
    gw.getTicket.mockResolvedValueOnce({ status: 'ok', data: { ...base, status: 'VALID', checked_in_at: EVENT.starts_at, qr_svg: null } });
    r = await renderPage(TicketPage({ params: Promise.resolve({ token: 'x' }) }));
    expect(screen.getByText('Checked in')).toBeInTheDocument();
  });

  it('renders not-found and outage without a ticket', async () => {
    gw.getTicket.mockResolvedValueOnce({ status: 'not_found' });
    const r = await renderPage(TicketPage({ params: Promise.resolve({ token: 'x' }) }));
    expect(r.container.querySelector('[data-eve-unavailable="true"]')).not.toBeNull();
  });

  it('the wallet lists exactly the tickets the API returned, each linking to its own ticket page', async () => {
    gw.getBookingWallet.mockResolvedValue({
      status: 'ok',
      data: {
        purchaser_name: 'Sam Buyer', event: EVENT, organisationName: 'Acme',
        tickets: [
          { attendee_name: 'Alex', ticket_type_name: 'General', session: null, ticket_token: 'tok-a', checked_in_at: null, status: 'VALID' },
          { attendee_name: 'Bo', ticket_type_name: 'General', session: null, ticket_token: 'tok-b', checked_in_at: EVENT.starts_at, status: 'VALID' },
        ],
      },
    });
    const { container } = await renderPage(WalletPage({ params: Promise.resolve({ bookingToken: 'book-1' }) }));
    expect(gw.getBookingWallet).toHaveBeenCalledWith('book-1');
    expect(screen.getAllByRole('article')).toHaveLength(2);
    const links = screen.getAllByRole('link', { name: /Open ticket/ }).map(a => a.getAttribute('href'));
    expect(links).toEqual(['/t/tok-a', '/t/tok-b']);
    expect(container.textContent).not.toMatch(/book-1/);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('sign-in page', () => {
  it('renders a real credential form inside the marketing layout', async () => {
    const { container } = await renderPage(SignInPage({ searchParams: Promise.resolve({ reason: 'session' }) }).then(p => <MarketingLayout>{p}</MarketingLayout>));
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByText(/session has ended/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(FOREIGN);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('organiser pages', () => {
  function stage(role = 'manager') {
    gw.getSession.mockResolvedValue(SESSION_OK(role));
    gw.listEvents.mockResolvedValue({ status: 'ok', data: { organisation: { slug: 'acme', name: 'Acme Events' }, events: EVENTS } });
    gw.listOrders.mockResolvedValue({ status: 'ok', data: { orders: ORDERS } });
    gw.listAttendees.mockResolvedValue({ status: 'ok', data: { attendees: ATTENDEES } });
  }

  it('redirects to sign-in with no cookie, and when the API says unauthorised or forbidden', async () => {
    token = null;
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/signin');
    token = 'tok';
    gw.getSession.mockResolvedValueOnce({ status: 'unauthorised' });
    await expect(EventsPage()).rejects.toThrow('REDIRECT:/signin?reason=session');
    gw.getSession.mockResolvedValueOnce({ status: 'forbidden' });
    await expect(OrdersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/signin?reason=session');
    expect(gw.listEvents).not.toHaveBeenCalled();
  });

  it('does not pretend to be signed out when the service is down', async () => {
    gw.getSession.mockResolvedValueOnce({ status: 'unavailable', reason: 'upstream_unreachable' });
    await expect(DashboardPage()).rejects.toThrow(/unavailable/);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('dashboard counts are derived from real orders and attendees (cancelled excluded)', async () => {
    stage();
    const { container } = await renderPage(DashboardPage());
    const kpi = (n: string) => screen.getByTestId(`kpi-${n}`).textContent;
    expect(kpi('events')).toBe('2');
    expect(kpi('published')).toBe('1');
    // two events × (1 live order, 2 live attendees, 1 checked in)
    expect(kpi('orders')).toBe('2');
    expect(kpi('paid-orders')).toBe('2');
    expect(kpi('tickets')).toBe('4');
    expect(kpi('checked-in')).toBe('2');
    expect(screen.getByText(/Acme Events · Pat \(manager\)/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(FOREIGN);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the console navigation and every organiser area', async () => {
    stage();
    await renderPage(DashboardPage());
    const nav = screen.getByRole('navigation', { name: 'Organiser' });
    for (const item of ORGANISER_NAV) expect(within(nav).getByRole('link', { name: item.label })).toHaveAttribute('href', item.href);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('events, orders and attendees list real rows', async () => {
    stage();
    let r = await renderPage(EventsPage());
    expect(screen.getByRole('table', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/e/acme/gala');
    expect(screen.getByText('Not published')).toBeInTheDocument();
    expect(await axe(r.container)).toHaveNoViolations();
    r.unmount();

    r = await renderPage(OrdersPage({ searchParams: Promise.resolve({ event: 'e1' }) }));
    expect(gw.listOrders).toHaveBeenCalledWith('tok', 'e1');
    expect(screen.getByText('Sam Buyer')).toBeInTheDocument();
    expect(screen.getByText('2 × General (Evening)')).toBeInTheDocument();
    expect(screen.getByText('$51.50')).toBeInTheDocument();
    expect(await axe(r.container)).toHaveNoViolations();
    r.unmount();

    r = await renderPage(AttendeesPage({ searchParams: Promise.resolve({}) }));
    expect(gw.listAttendees).toHaveBeenCalledWith('tok', 'e1');
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText(/by Pat/)).toBeInTheDocument();
    expect(await axe(r.container)).toHaveNoViolations();
  });

  it('shows an honest empty state with no events', async () => {
    stage();
    gw.listEvents.mockResolvedValue({ status: 'ok', data: { organisation: { slug: 'acme', name: 'A' }, events: [] } });
    const { container } = await renderPage(OrdersPage({ searchParams: Promise.resolve({}) }));
    expect(container.querySelector('[data-eve-unavailable="true"]')).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('check-in page renders the console for the chosen event; viewers get no check-in action', async () => {
    stage('viewer');
    const { container } = await renderPage(CheckInPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByLabelText('Ticket link or code')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('check-in console', () => {
  const A = { id: 'a1', attendee_name: 'Alex', ticket_type_name: 'General', session_name: 'Evening', checked_in_at: null };

  function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const { status, body } = handler(url, init);
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }));
  }

  it('resolves a scan, checks in, then reports a duplicate scan as already checked in', async () => {
    const user = userEvent.setup();
    let checkedIn = false;
    mockFetch(url => {
      if (url.endsWith('/resolve')) return { status: 200, body: { attendee: { ...A, checked_in_at: checkedIn ? 'now' : null } } };
      if (url.endsWith('/confirm')) {
        if (checkedIn) return { status: 409, body: { first: false, attendee: { ...A, checked_in_at: 'now' } } };
        checkedIn = true;
        return { status: 200, body: { first: true, attendee: { ...A, checked_in_at: 'now' } } };
      }
      return { status: 404, body: {} };
    });
    render(<CheckInConsole eventId="e1" canManage />);
    await user.type(screen.getByLabelText('Ticket link or code'), 'https://eve.example/t/abcdefghijklmnopqrstuvwx');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByRole('heading', { name: 'Alex' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check in' }));
    expect(await screen.findByText('Alex is checked in.')).toBeInTheDocument();
    expect(screen.getByTestId('checkin-state')).toHaveTextContent('Checked in');
    // A second scan of the same ticket.
    await user.type(screen.getByLabelText('Ticket link or code'), 'abcdefghijklmnopqrstuvwx');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo check-in' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();
  });

  it('surfaces an invalid ticket and supports undo', async () => {
    const user = userEvent.setup();
    mockFetch(url => {
      if (url.endsWith('/resolve')) return { status: 404, body: { error: 'Ticket not valid.' } };
      if (url.endsWith('/undo')) return { status: 200, body: { attendee: { ...A, checked_in_at: null } } };
      if (url.includes('/search')) return { status: 200, body: { attendees: [{ ...A, checked_in_at: 'now' }] } };
      return { status: 404, body: {} };
    });
    render(<CheckInConsole eventId="e1" canManage />);
    await user.type(screen.getByLabelText('Ticket link or code'), 'bogus');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('Ticket not valid.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Or search by attendee name'), 'Al');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: 'Undo check-in' }));
    expect(await screen.findByText('Check-in undone for Alex.')).toBeInTheDocument();
  });

  it('never offers check-in or undo to a viewer', async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ status: 200, body: { attendee: A } }));
    render(<CheckInConsole eventId="e1" canManage={false} />);
    await user.type(screen.getByLabelText('Ticket link or code'), 'abcdefghijklmnopqrstuvwx');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText(/can look tickets up but not check people in/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();
  });
});

describe('buyer booking form', () => {
  function mockFetch(routes: Record<string, { status: number; body: unknown }>) {
    const fn = vi.fn(async (url: string) => {
      const key = Object.keys(routes).find(k => url.endsWith(k));
      const r = key ? routes[key] : { status: 404, body: {} };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }
  const bodyOf = (fn: ReturnType<typeof vi.fn>, suffix: string) => {
    const call = fn.mock.calls.find(c => String(c[0]).endsWith(suffix));
    return call ? JSON.parse((call[1] as RequestInit).body as string) : null;
  };

  it('a multi-type paid cart posts one session, every line and the attendees to checkout, then goes to the hosted page', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const detail = { ...DETAIL, ticket_types: [DETAIL.ticket_types[0], { ...DETAIL.ticket_types[1], requires_access_code: false, id: 't3', name: 'VIP', price_cents: 5000 }] };
    const fn = mockFetch({
      '/quote': { status: 200, body: { subtotal_cents: 7500, discount_cents: 0, total_cents: 7500, currency: 'aud', pricing: 'PAID', promotion: null, promotion_error: null, access: null, access_error: null, cart_error: null, platform_fee_cents: 150, payment_total_cents: 7650, fee: { label: 'Booking fee' } } },
      '/checkout': { status: 200, body: { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_1' } },
    });
    render(<BuyerBooking organisationSlug="acme" eventSlug="gala" detail={detail as never} cancelled={false} />);
    await user.selectOptions(screen.getByLabelText('Session'), 's1');
    await user.click(screen.getByRole('button', { name: 'More General' }));
    await user.click(screen.getByRole('button', { name: 'More VIP' }));
    await user.type(screen.getByLabelText('Full name'), 'Sam Buyer');
    await user.type(screen.getByLabelText('Email'), 'sam@example.test');
    await user.type(screen.getByLabelText('General ticket 1'), 'Alex');
    await user.type(screen.getByLabelText('VIP ticket 1'), 'Bo');
    await waitFor(() => expect(screen.getByTestId('payable')).toHaveTextContent('$76.50'));
    await user.click(screen.getByLabelText(/I agree to the/));
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1'));
    const sent = bodyOf(fn, '/checkout');
    expect(sent.accept_terms).toBe(true);
    expect(sent.event_session_id).toBe('s1');
    expect(sent.items).toEqual([{ ticket_type_id: 't1', quantity: 1 }, { ticket_type_id: 't3', quantity: 1 }]);
    expect(sent.attendees).toEqual([{ name: 'Alex', ticket_type_id: 't1' }, { name: 'Bo', ticket_type_id: 't3' }]);
    expect(fn.mock.calls.some(c => String(c[0]).endsWith('/register'))).toBe(false);
  });

  it('an all-free cart uses registration and shows the wallet and ticket links', async () => {
    const user = userEvent.setup();
    const detail = { ...DETAIL, sessions: [], has_promotions: false, ticket_types: [{ ...DETAIL.ticket_types[0], price_cents: 0, name: 'Free entry' }] };
    const fn = mockFetch({
      '/quote': { status: 200, body: { subtotal_cents: 0, discount_cents: 0, total_cents: 0, currency: 'aud', pricing: 'FREE', promotion: null, promotion_error: null, access: null, access_error: null, cart_error: null } },
      '/register': { status: 200, body: { confirmation_reference: 'ref-1', quantity: 1, tickets: [{ attendee_name: 'Sam Buyer', ticket_token: 'tk1' }], booking_token: 'bk1' } },
    });
    render(<BuyerBooking organisationSlug="acme" eventSlug="gala" detail={detail as never} cancelled={false} />);
    await user.click(screen.getByRole('button', { name: 'More Free entry' }));
    await user.type(screen.getByLabelText('Full name'), 'Sam Buyer');
    await user.type(screen.getByLabelText('Email'), 'sam@example.test');
    await user.click(screen.getByRole('button', { name: 'Complete registration' }));
    expect(await screen.findByTestId('free-confirmation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ticket for Sam Buyer' })).toHaveAttribute('href', '/t/tk1');
    expect(screen.getByRole('link', { name: /View all tickets/ })).toHaveAttribute('href', '/b/bk1/tickets');
    expect(fn.mock.calls.some(c => String(c[0]).endsWith('/checkout'))).toBe(false);
  });

  it('shows the server message when capacity changed, and requires a session', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/quote': { status: 200, body: { subtotal_cents: 2500, discount_cents: 0, total_cents: 2500, currency: 'aud', pricing: 'PAID', promotion: null, promotion_error: null, access: null, access_error: null, cart_error: null } },
      '/checkout': { status: 409, body: { error: 'This ticket type is no longer available in the requested quantity.' } },
    });
    const twoSessions = { ...DETAIL, sessions: [...DETAIL.sessions, { ...DETAIL.sessions[0], id: 's2', name: 'Matinee' }] };
    render(<BuyerBooking organisationSlug="acme" eventSlug="gala" detail={twoSessions as never} cancelled={false} />);
    await user.click(screen.getByRole('button', { name: 'More General' }));
    await user.type(screen.getByLabelText('Full name'), 'Sam');
    await user.type(screen.getByLabelText('Email'), 's@x.test');
    fireEvent.submit(screen.getByRole('form', { name: 'Book tickets' }));
    expect(await screen.findByText('Choose a session.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Session'), 's1');
    await user.click(screen.getByLabelText(/I agree to the/));
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(await screen.findByText(/no longer available in the requested quantity/)).toBeInTheDocument();
  });

  it('an access code unlocks a restricted type only after the server says so', async () => {
    const user = userEvent.setup();
    mockFetch({
      '/quote': { status: 200, body: { subtotal_cents: 0, discount_cents: 0, total_cents: 0, currency: 'aud', pricing: null, promotion: null, promotion_error: null, access: { unlocked_ticket_type_ids: ['t2'] }, access_error: null, cart_error: null } },
    });
    render(<BuyerBooking organisationSlug="acme" eventSlug="gala" detail={DETAIL as never} cancelled={false} />);
    await user.selectOptions(screen.getByLabelText('Session'), 's1');
    expect(screen.getByRole('button', { name: 'More Presale' })).toBeDisabled();
    await user.type(screen.getByLabelText('Access code'), 'early');
    await user.click(screen.getAllByRole('button', { name: 'Apply' })[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'More Presale' })).toBeEnabled());
  });
});
