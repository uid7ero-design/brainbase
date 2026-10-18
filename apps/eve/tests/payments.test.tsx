import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';

// Eve Phase 3.3 — organiser Payments (READ-ONLY), rendered against a mocked
// ticketing gateway. Fixtures exist only inside this file.

const redirectMock = vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); });
const notFoundMock = vi.fn(() => { throw new Error('NOT_FOUND'); });
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock('@/lib/session', () => ({ readSessionToken: async () => 'tok' }));

const gw = { getSession: vi.fn(), listEvents: vi.fn(), listPayments: vi.fn(), getPayment: vi.fn() };
vi.mock('@/lib/ticketing/gateway', () => ({ getTicketingGateway: () => gw }));

import PaymentsPage from '@/app/(organiser)/organiser/payments/page';
import PaymentDetailPage from '@/app/(organiser)/organiser/payments/[orderId]/page';

const FOREIGN = /BrainBase|Brainbase|Data Hub|Command Centre|Founder OS|Helena/;
const TZ = 'Australia/Adelaide';
const ev = { id: 'e1', name: 'Spring Gala', timezone: TZ };
const base = {
  event: ev, purchaser_name: 'Sam Buyer', purchaser_email: 's@x.test', order_status: 'CONFIRMED', currency: 'AUD',
  created_at: '2027-01-01T00:00:00.000Z', paid_at: null, refunded_at: null, discount_cents: 0,
  platform_fee_cents: 0, fee_mode: null, fee_label: null, refunded_amount_cents: null, platform_fee_refunded_cents: null,
  organiser_share_before_processing_cents: null,
};
const ORDERS = [
  { ...base, id: 'paid-hist-0001', payment_state: 'PAID', ticket_total_cents: 5000, payment_total_cents: 5000, paid_at: '2027-01-01T01:00:00.000Z', organiser_share_before_processing_cents: 5000 },
  { ...base, id: 'paid-pt-00002', payment_state: 'PAID', ticket_total_cents: 19800, platform_fee_cents: 525, fee_mode: 'PASS_THROUGH', payment_total_cents: 20325, paid_at: '2027-01-02T01:00:00.000Z', organiser_share_before_processing_cents: 19800 },
  { ...base, id: 'paid-ab-00003', payment_state: 'PAID', ticket_total_cents: 19800, platform_fee_cents: 525, fee_mode: 'ABSORB', payment_total_cents: 19800, paid_at: '2027-01-03T01:00:00.000Z', organiser_share_before_processing_cents: 19275 },
  { ...base, id: 'pend-0000004', order_status: 'PENDING', payment_state: 'PENDING', ticket_total_cents: 3000, payment_total_cents: 3000 },
  { ...base, id: 'fail-0000005', order_status: 'CANCELLED', payment_state: 'FAILED', ticket_total_cents: 3000, payment_total_cents: 3000 },
  { ...base, id: 'expi-0000006', order_status: 'CANCELLED', payment_state: 'EXPIRED', ticket_total_cents: 3000, payment_total_cents: 3000 },
  { ...base, id: 'refu-0000007', order_status: 'CANCELLED', payment_state: 'REFUNDED', ticket_total_cents: 19800, platform_fee_cents: 525, fee_mode: 'PASS_THROUGH', payment_total_cents: 20325, paid_at: '2027-01-04T01:00:00.000Z', refunded_at: '2027-01-05T01:00:00.000Z', refunded_amount_cents: 20325, platform_fee_refunded_cents: 525 },
];
const SUMMARY = [{
  currency: 'AUD', counts: { PAID: 3, PENDING: 1, FAILED: 1, EXPIRED: 1, REFUNDED: 1 },
  paid_revenue_cents: 45125, platform_fees_cents: 1050, refunded_cents: 20325, organiser_share_before_processing_cents: 44075,
}];
const CONNECT = { status: 'CONNECTED', connected: true, charges_enabled: true, payouts_enabled: true, details_submitted: true, eligible_for_paid_ticketing: true, connected_at: null, last_synced_at: null };
const payload = (over: Record<string, unknown> = {}) => ({
  status: 'ok',
  data: { organisation: { slug: 'acme', name: 'Acme Events' }, connect: CONNECT, filter: { status: null, event: null }, summary: { currencies: SUMMARY, complete: true }, orders: ORDERS, orders_truncated: false, ...over },
});
const SESSION = (role: string) => ({ status: 'ok', data: { user: { id: 'u1', name: 'Pat', role }, organisationId: 'org1', organisation: { slug: 'acme', name: 'Acme Events' } } });

beforeEach(() => {
  for (const f of Object.values(gw)) f.mockReset();
  redirectMock.mockClear(); notFoundMock.mockClear();
  gw.getSession.mockResolvedValue(SESSION('manager'));
  gw.listEvents.mockResolvedValue({ status: 'ok', data: { organisation: { slug: 'acme', name: 'A' }, events: [{ id: 'e1', name: 'Spring Gala', slug: 'gala', status: 'PUBLISHED', venue: null, starts_at: '', ends_at: '', timezone: TZ, session_count: 0, ticket_type_count: 1 }] } });
  gw.listPayments.mockResolvedValue(payload());
});

const renderPage = async (el: Promise<ReactElement>) => render(await el);
const page = (sp: { status?: string; event?: string } = {}) => PaymentsPage({ searchParams: Promise.resolve(sp) });

describe('organiser Payments page', () => {
  it('shows summary cards, states, amounts, fees and refunds from the API figures', async () => {
    const { container } = await renderPage(page());
    expect(screen.getByTestId('paid-revenue')).toHaveTextContent('$451.25');
    expect(screen.getByTestId('platform-fees')).toHaveTextContent('$10.50');
    expect(screen.getByTestId('refunds')).toHaveTextContent('$203.25');
    expect(screen.getByTestId('organiser-share')).toHaveTextContent('$440.75');
    expect(screen.getByText(/Not a payout/)).toBeInTheDocument();
    expect(screen.getByTestId('state-counts')).toHaveTextContent('Pending 1 · Failed 1 · Expired 1');
    const rows = Object.fromEntries(ORDERS.map(o => [o.id, screen.getByTestId(`row-${o.id}`)]));
    expect(within(rows['paid-hist-0001']).getByText('Paid')).toBeInTheDocument();
    expect(within(rows['paid-hist-0001']).getByText('None')).toBeInTheDocument(); // zero-fee historical order
    expect(within(rows['paid-pt-00002']).getByText('$203.25')).toBeInTheDocument();
    expect(within(rows['paid-pt-00002']).getByText('Paid by the buyer')).toBeInTheDocument();
    expect(within(rows['paid-ab-00003']).getByText('Deducted from your sales')).toBeInTheDocument();
    expect(within(rows['pend-0000004']).getByText('Pending')).toBeInTheDocument();
    expect(within(rows['fail-0000005']).getByText('Failed')).toBeInTheDocument();
    expect(within(rows['expi-0000006']).getByText('Expired')).toBeInTheDocument();
    expect(within(rows['refu-0000007']).getByText('Refunded')).toBeInTheDocument();
    expect(within(rows['refu-0000007']).getAllByText('$203.25').length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(FOREIGN);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('state filters are plain links that pass the state (and event) to the API; "All" clears it', async () => {
    gw.listPayments.mockResolvedValue(payload({ filter: { status: 'REFUNDED', event: 'e1' }, orders: [ORDERS[6]] }));
    await renderPage(page({ status: 'REFUNDED', event: 'e1' }));
    expect(gw.listPayments).toHaveBeenCalledWith('tok', { status: 'REFUNDED', event: 'e1' });
    const nav = screen.getByRole('navigation', { name: 'Payment state' });
    expect(within(nav).getByRole('link', { name: 'Refunded' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Paid' })).toHaveAttribute('href', '/organiser/payments?status=PAID&event=e1');
    expect(within(nav).getByRole('link', { name: 'All' })).toHaveAttribute('href', '/organiser/payments?event=e1');
    expect(screen.getAllByRole('row').length).toBe(2); // header + the refunded order
  });

  it('ignores an unknown status in the URL instead of passing it on', async () => {
    await renderPage(page({ status: 'NOT_REQUIRED' }));
    expect(gw.listPayments).toHaveBeenCalledWith('tok', { status: undefined, event: undefined });
  });

  it('viewer and manager both see the read-only page; neither is offered a refund or payout action', async () => {
    for (const role of ['viewer', 'manager']) {
      gw.getSession.mockResolvedValue(SESSION(role));
      const { container, unmount } = await renderPage(page());
      expect(screen.getByTestId('paid-revenue')).toBeInTheDocument();
      expect(container.querySelector('form[method="post" i], button[type="submit"][formmethod="post" i]')).toBeNull();
      expect(screen.queryByRole('button', { name: /refund|payout|connect|onboard/i })).toBeNull();
      expect(screen.queryByRole('link', { name: /issue refund|refund order|onboard|set up payouts|connect stripe/i })).toBeNull();
      expect(container.textContent).toMatch(/read-only/i);
      unmount();
    }
  });

  it('connect status: connected, not connected, and unavailable are each stated plainly', async () => {
    let r = await renderPage(page());
    expect(screen.getByTestId('connect-status')).toHaveTextContent('Connected');
    expect(screen.getByTestId('paid-eligibility')).toHaveTextContent('Paid ticketing: available.');
    r.unmount();

    gw.listPayments.mockResolvedValue(payload({ connect: { ...CONNECT, status: 'NOT_CONNECTED', connected: false, charges_enabled: false, payouts_enabled: false, details_submitted: false, eligible_for_paid_ticketing: false } }));
    r = await renderPage(page());
    expect(screen.getByTestId('connect-status')).toHaveTextContent('Not connected');
    expect(screen.getByTestId('paid-eligibility')).toHaveTextContent('not available');
    expect(within(screen.getByTestId('connect-status')).queryByRole('button')).toBeNull();
    expect(within(screen.getByTestId('connect-status')).queryByRole('link')).toBeNull();
    r.unmount();

    gw.listPayments.mockResolvedValue(payload({ connect: null }));
    r = await renderPage(page());
    expect(screen.getByTestId('connect-status')).toHaveTextContent('could not be loaded');
  });

  it('empty organisation: honest empty state, no sample numbers', async () => {
    gw.listPayments.mockResolvedValue(payload({ summary: { currencies: [], complete: true }, orders: [] }));
    const { container } = await renderPage(page());
    expect(container.querySelector('[data-eve-unavailable="true"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/\$\d/);
  });

  it('says so when totals or the list are truncated', async () => {
    gw.listPayments.mockResolvedValue(payload({ summary: { currencies: SUMMARY, complete: false }, orders_truncated: true }));
    await renderPage(page());
    expect(screen.getByText(/Totals cover only the most recent orders/)).toBeInTheDocument();
    expect(screen.getByText(/Showing the most recent 7 orders/)).toBeInTheDocument();
  });

  it('redirects to sign-in when the API says unauthorised, and surfaces an outage as an error (never fake data)', async () => {
    gw.listPayments.mockResolvedValue({ status: 'unauthorised' });
    await expect(page()).rejects.toThrow('REDIRECT:/signin?reason=session');
    gw.listPayments.mockResolvedValue({ status: 'unavailable', reason: 'upstream_unreachable' });
    await expect(page()).rejects.toThrow(/could not be reached/);
  });
});

describe('organiser payment detail page', () => {
  const detail = (o: Record<string, unknown>) => ({ status: 'ok', data: { organisation: { slug: 'acme', name: 'A' }, order: o, lines: [{ description: 'General', quantity: 2, unit_price_cents: 9900, discount_cents: 0 }] } });
  const view = (o: Record<string, unknown>) => renderPage(PaymentDetailPage({ params: Promise.resolve({ orderId: String(o.id) }) }));

  it('PASS_THROUGH: buyer charge includes the fee; organiser share is the ticket total', async () => {
    gw.getPayment.mockResolvedValue(detail(ORDERS[1]));
    const { container } = await view(ORDERS[1]);
    expect(gw.getPayment).toHaveBeenCalledWith('tok', 'paid-pt-00002');
    expect(screen.getByTestId('charged')).toHaveTextContent('$203.25');
    expect(screen.getByText(/Paid by the buyer/)).toBeInTheDocument();
    expect(screen.getByTestId('share')).toHaveTextContent('$198.00');
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('ABSORB: the fee is deducted from the organiser share', async () => {
    gw.getPayment.mockResolvedValue(detail(ORDERS[2]));
    await view(ORDERS[2]);
    expect(screen.getByTestId('charged')).toHaveTextContent('$198.00');
    expect(screen.getByText(/Deducted from your sales/)).toBeInTheDocument();
    expect(screen.getByTestId('share')).toHaveTextContent('$192.75');
  });

  it('refunded order shows the refunded amount and no share', async () => {
    gw.getPayment.mockResolvedValue(detail(ORDERS[6]));
    await view(ORDERS[6]);
    expect(screen.getByTestId('refunded')).toHaveTextContent('$203.25');
    expect(screen.getByText('Platform fee refunded')).toBeInTheDocument();
    expect(screen.queryByTestId('share')).toBeNull();
  });

  it('pending / failed / expired show their state and no refund or share', async () => {
    for (const i of [3, 4, 5]) {
      gw.getPayment.mockResolvedValue(detail(ORDERS[i]));
      const { unmount } = await view(ORDERS[i]);
      expect(screen.getByTestId(`state-${ORDERS[i].payment_state}`)).toBeInTheDocument();
      expect(screen.queryByTestId('refunded')).toBeNull();
      expect(screen.queryByTestId('share')).toBeNull();
      unmount();
    }
  });

  it('an order that is not this organisation\'s (API 404) is a not-found page', async () => {
    gw.getPayment.mockResolvedValue({ status: 'not_found' });
    await expect(PaymentDetailPage({ params: Promise.resolve({ orderId: 'foreign' }) })).rejects.toThrow('NOT_FOUND');
  });
});

describe('read-only boundary', () => {
  const ROOT = path.resolve(__dirname, '..');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  function walk(dir: string, out: string[] = []) {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === '.next' || e === 'tests') continue;
      const f = path.join(dir, e);
      if (statSync(f).isDirectory()) walk(f, out); else if (/\.(ts|tsx)$/.test(e)) out.push(f);
    }
    return out;
  }
  const files = walk(ROOT);

  it('the payments gateway methods are GET-only and there is no payment mutation call anywhere in the app', () => {
    const gateway = strip(readFileSync(path.join(ROOT, 'lib/ticketing/gateway.ts'), 'utf8'));
    const block = gateway.slice(gateway.indexOf('listPayments:'), gateway.indexOf('checkInSearch:'));
    expect(block).toContain('/organiser/payments');
    expect(block).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
    for (const f of files) {
      const src = strip(readFileSync(f, 'utf8'));
      expect(src, f).not.toMatch(/\/organiser\/payments[^`'"]*['"`][\s\S]{0,80}method:\s*'(POST|PUT|PATCH|DELETE)'/);
      expect(src, f).not.toMatch(/refund(Order|Payment)|createRefund|payments\/connect|accountLinks/i);
    }
  });

  it('Eve exposes no payments API route of its own', () => {
    expect(files.filter(f => /app[\\/]api[\\/].*payment/i.test(f))).toEqual([]);
  });

  it('payment pages never render provider identifiers', () => {
    for (const f of files.filter(f => /payments|PaymentParts/.test(f))) {
      expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/acct_|stripe_account|account_id|accountId|ticket_token|booking_token/);
    }
  });
});
