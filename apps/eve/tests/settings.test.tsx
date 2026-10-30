import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';

// Eve Phase 3.4 — organiser Settings (READ-ONLY) against a mocked gateway.

const redirectMock = vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); });
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirectMock(to), notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/lib/session', () => ({ readSessionToken: async () => 'tok' }));

const gw = { getSession: vi.fn(), listEvents: vi.fn(), getSettings: vi.fn() };
vi.mock('@/lib/ticketing/gateway', () => ({ getTicketingGateway: () => gw }));

import SettingsPage from '@/app/(organiser)/organiser/settings/page';

const FOREIGN = /BrainBase|Brainbase|Data Hub|Command Centre|Founder OS|Helena/;
const CONNECT = (status: string, over: Record<string, unknown> = {}) => ({
  status, connected: status !== 'NOT_CONNECTED', charges_enabled: status === 'CONNECTED', payouts_enabled: status === 'CONNECTED', details_submitted: status === 'CONNECTED' || status === 'RESTRICTED' || status === 'ACTION_REQUIRED',
  eligible_for_paid_ticketing: status === 'CONNECTED', connected_at: null, last_synced_at: null, ...over,
});
const BRANDING_EMPTY = { configured: false, display_name: 'Acme Events', display_name_is_custom: false, logo_configured: false, accent_color: null, website: null, support_email: null, support_phone: null, email_footer: null };
const FEE_PT = { state: 'FEE', source: 'ORGANISATION', fee_mode: 'PASS_THROUGH', paid_by: 'BUYER', percent_bps: 250, fixed_per_order_cents: 30, fixed_per_ticket_cents: 0, min_fee_cents: null, max_fee_cents: null, currency: 'AUD', label: 'Booking fee' };
const settings = (over: Record<string, unknown> = {}) => ({
  status: 'ok',
  data: {
    organisation: { name: 'Acme Events', slug: 'acme' },
    user: { name: 'Pat', role: 'manager' },
    events_capability: { enabled: true },
    ticketing: { paid_ticketing_available: true },
    connect: CONNECT('CONNECTED'),
    fees: { scope: { level: 'ORGANISATION', event: null }, effective: { state: 'NO_FEE', source: 'PLATFORM_DEFAULT', reason: 'NOT_CONFIGURED' }, event_overrides_count: 0 },
    branding: BRANDING_EMPTY,
    ...over,
  },
});
const SESSION = (role: string) => ({ status: 'ok', data: { user: { id: 'u1', name: 'Pat', role }, organisationId: 'org1', organisation: { slug: 'acme', name: 'Acme Events' } } });

beforeEach(() => {
  for (const f of Object.values(gw)) f.mockReset();
  redirectMock.mockClear();
  gw.getSession.mockResolvedValue(SESSION('manager'));
  gw.listEvents.mockResolvedValue({ status: 'ok', data: { organisation: { slug: 'acme', name: 'A' }, events: [{ id: 'e1', name: 'Spring Gala', slug: 'gala', status: 'PUBLISHED', venue: null, starts_at: '', ends_at: '', timezone: 'Australia/Adelaide', session_count: 0, ticket_type_count: 1 }] } });
  gw.getSettings.mockResolvedValue(settings());
});

const page = async (sp: { event?: string } = {}) => render(await (SettingsPage({ searchParams: Promise.resolve(sp) }) as Promise<ReactElement>));

describe('organiser Settings page', () => {
  it('renders every section from the API with no Save or mutation control', async () => {
    const { container } = await page();
    for (const id of ['organisation', 'ticketing', 'payments', 'fees', 'branding', 'access']) expect(screen.getByTestId(`section-${id}`)).toBeInTheDocument();
    expect(within(screen.getByTestId('section-organisation')).getByText('Acme Events')).toBeInTheDocument();
    expect(within(screen.getByTestId('section-organisation')).getByText('acme')).toBeInTheDocument();
    expect(screen.getByTestId('events-chip')).toHaveTextContent('Events enabled');
    expect(screen.getByText(/read-only here/i)).toBeInTheDocument();
    // The only form is the GET event picker.
    expect(Array.from(container.querySelectorAll('form')).map(f => f.getAttribute('method')?.toLowerCase())).toEqual(['get']);
    expect(screen.queryByRole('button', { name: /save|update|edit|change|connect|upload|delete|remove|refund/i })).toBeNull();
    expect(container.querySelectorAll('input:not([type="hidden"]), textarea').length).toBe(0);
    expect(container.textContent).not.toMatch(FOREIGN);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Events enabled / not enabled chip', async () => {
    gw.getSettings.mockResolvedValue(settings({ events_capability: { enabled: false }, ticketing: { paid_ticketing_available: false } }));
    await page();
    expect(screen.getByTestId('events-chip')).toHaveTextContent('Events not enabled');
  });

  it.each([
    ['NOT_CONNECTED', 'Not connected'],
    ['ONBOARDING', 'Setup in progress'],
    ['ACTION_REQUIRED', 'Action required'],
    ['CONNECTED', 'Connected'],
    ['RESTRICTED', 'Restricted'],
  ])('Connect %s is presented as "%s" with no onboarding action', async (status, label) => {
    gw.getSettings.mockResolvedValue(settings({ connect: CONNECT(status), ticketing: { paid_ticketing_available: status === 'CONNECTED' } }));
    await page();
    const panel = screen.getByTestId('connect-status');
    expect(panel).toHaveTextContent(label);
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(within(panel).queryByRole('link')).toBeNull();
    expect(screen.getByTestId('section-ticketing')).toHaveTextContent(status === 'CONNECTED' ? 'Available' : 'Not available until a Stripe account');
  });

  it('Connect state unavailable is stated, not invented', async () => {
    gw.getSettings.mockResolvedValue(settings({ connect: null, ticketing: { paid_ticketing_available: null } }));
    await page();
    expect(screen.getByTestId('connect-status')).toHaveTextContent('could not be loaded');
    expect(screen.getByTestId('section-ticketing')).toHaveTextContent('Unavailable right now');
  });

  it('no fee configured (platform default) says so plainly', async () => {
    await page();
    expect(screen.getByTestId('fee-chip')).toHaveTextContent('No fee configured');
    expect(screen.getByTestId('fee-none')).toHaveTextContent(/platform default applies: no fee/i);
    expect(screen.queryByTestId('fee-policy')).toBeNull();
  });

  it('pass-through policy: components, label, and that the buyer pays', async () => {
    gw.getSettings.mockResolvedValue(settings({ fees: { scope: { level: 'ORGANISATION', event: null }, effective: FEE_PT, event_overrides_count: 2 } }));
    await page();
    const p = screen.getByTestId('fee-policy');
    expect(p).toHaveTextContent('2.5% + $0.30 per order');
    expect(p).toHaveTextContent('Booking fee');
    expect(p).toHaveTextContent('The buyer pays it on top of the ticket price');
    expect(screen.getByTestId('fee-chip')).toHaveTextContent('Fee configured');
    expect(screen.getByTestId('fee-overrides')).toHaveTextContent('2 events have its own fee policy');
    expect(screen.getByText(/Existing orders keep the fee they were placed with/)).toBeInTheDocument();
  });

  it('absorb policy: the organiser absorbs it; min/max/per-ticket shown', async () => {
    gw.getSettings.mockResolvedValue(settings({ fees: { scope: { level: 'ORGANISATION', event: null }, effective: { ...FEE_PT, fee_mode: 'ABSORB', paid_by: 'ORGANISER', percent_bps: 100, fixed_per_order_cents: 0, fixed_per_ticket_cents: 50, min_fee_cents: 100, max_fee_cents: 2000 }, event_overrides_count: 0 } }));
    await page();
    const p = screen.getByTestId('fee-policy');
    expect(p).toHaveTextContent('1% + $0.50 per ticket · minimum $1.00 · maximum $20.00');
    expect(p).toHaveTextContent('You absorb it: it is deducted from your ticket sales');
  });

  it('inherited vs event-level policy and the disabled case are distinguished', async () => {
    const scope = { level: 'EVENT', event: { id: 'e1', name: 'Spring Gala' } };
    gw.getSettings.mockResolvedValue(settings({ fees: { scope, effective: FEE_PT, event_overrides_count: 0 } }));
    let r = await page({ event: 'e1' });
    expect(gw.getSettings).toHaveBeenCalledWith('tok', { event: 'e1' });
    expect(screen.getByTestId('fee-policy')).toHaveTextContent('Spring Gala (inherited from the organisation policy)');
    r.unmount();

    gw.getSettings.mockResolvedValue(settings({ fees: { scope, effective: { ...FEE_PT, source: 'EVENT' }, event_overrides_count: 1 } }));
    r = await page({ event: 'e1' });
    expect(screen.getByTestId('fee-policy')).toHaveTextContent("this event's own policy");
    r.unmount();

    gw.getSettings.mockResolvedValue(settings({ fees: { scope, effective: { state: 'NO_FEE', source: 'EVENT', reason: 'DISABLED' }, event_overrides_count: 1 } }));
    r = await page({ event: 'e1' });
    expect(screen.getByTestId('fee-none')).toHaveTextContent('switched off');
  });

  it('an unreadable fee policy is reported unavailable, never guessed', async () => {
    gw.getSettings.mockResolvedValue(settings({ fees: { scope: { level: 'ORGANISATION', event: null }, effective: null, event_overrides_count: null, unavailable: true } }));
    await page();
    expect(screen.getByTestId('fee-unavailable')).toBeInTheDocument();
  });

  it('historical/default organisation: branding not configured, organisation name used', async () => {
    gw.getSettings.mockResolvedValue(settings());
    await page();
    expect(screen.getByTestId('branding-chip')).toHaveTextContent('Not configured');
    // Organiser contact v1: Eve never shows the organisation name as the
    // organiser, so the settings no longer claim it is used.
    expect(screen.getByTestId('section-branding')).not.toHaveTextContent('using your organisation name');
    expect(screen.getByTestId('section-branding')).not.toHaveTextContent('Acme Events');
    expect(screen.getByTestId('section-branding')).toHaveTextContent('Not set. Buyers see “the event organiser”.');
    expect(screen.getByTestId('section-branding')).toHaveTextContent('Logo');
  });

  it('configured branding: safe fields shown, logo only as Set/Not set', async () => {
    gw.getSettings.mockResolvedValue(settings({ branding: { configured: true, display_name: 'Acme Presents', display_name_is_custom: true, logo_configured: true, accent_color: '#112233', website: 'https://acme.example', support_email: 'help@acme.example', support_phone: '0400 000 000', email_footer: 'Thanks!' } }));
    const { container } = await page();
    const s = screen.getByTestId('section-branding');
    expect(s).toHaveTextContent('Acme Presents');
    expect(s).toHaveTextContent('help@acme.example');
    expect(s).toHaveTextContent('Set');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('branding-chip')).toHaveTextContent('Configured');
  });

  it('explains that orders placed through Eve are branded as Eve', async () => {
    await page();
    expect(screen.getByTestId('product-identity-note')).toHaveTextContent(/placed through Eve are sent to buyers as Eve/);
    expect(screen.getByTestId('product-identity-note').textContent).not.toMatch(/product_surface|BRAINBASE/);
  });

  it('shows the signed-in role and what it allows (viewer, manager)', async () => {
    gw.getSettings.mockResolvedValue(settings({ user: { name: 'Vi', role: 'viewer' } }));
    let r = await page();
    expect(screen.getByTestId('section-access')).toHaveTextContent('Check-in actions need a manager');
    r.unmount();
    gw.getSettings.mockResolvedValue(settings({ user: { name: 'Pat', role: 'manager' } }));
    r = await page();
    expect(screen.getByTestId('section-access')).toHaveTextContent('run check-in');
  });

  it('no provider identifier is rendered', async () => {
    const { container } = await page();
    expect(container.innerHTML).not.toMatch(/acct_|sk_|whsec_|stripe_account|ticket_token|booking_token/);
  });

  it('redirects to sign-in when the API says unauthorised/forbidden; an outage is an error, never fake data', async () => {
    gw.getSettings.mockResolvedValue({ status: 'forbidden' });
    await expect(SettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/signin?reason=session');
    gw.getSettings.mockResolvedValue({ status: 'unavailable', reason: 'upstream_unreachable' });
    await expect(SettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/could not be reached/);
  });

  it('a malformed event id (API 400) also falls back to the organisation-level view instead of an error page', async () => {
    gw.getSettings.mockResolvedValueOnce({ status: 'error', httpStatus: 400, message: 'Invalid event.', body: {} }).mockResolvedValueOnce(settings());
    await page({ event: 'a b' });
    expect(gw.getSettings).toHaveBeenNthCalledWith(2, 'tok', {});
    expect(screen.getByTestId('fee-none')).toBeInTheDocument();
  });

  it('an event id that is not this organisation\'s falls back to the organisation-level view', async () => {
    gw.getSettings.mockResolvedValueOnce({ status: 'not_found' }).mockResolvedValueOnce(settings());
    await page({ event: 'foreign' });
    expect(gw.getSettings).toHaveBeenNthCalledWith(1, 'tok', { event: 'foreign' });
    expect(gw.getSettings).toHaveBeenNthCalledWith(2, 'tok', {});
    expect(screen.getByTestId('fee-none')).toBeInTheDocument();
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

  it('the settings gateway method is a single GET and nothing in Eve mutates settings', () => {
    const gateway = strip(readFileSync(path.join(ROOT, 'lib/ticketing/gateway.ts'), 'utf8'));
    const block = gateway.slice(gateway.indexOf('getSettings:'), gateway.indexOf('getPayment:'));
    expect(block).toContain('/organiser/settings');
    expect(block).not.toMatch(/method:/);
    for (const f of files) {
      const src = strip(readFileSync(f, 'utf8'));
      expect(src, f).not.toMatch(/\/organiser\/settings[^`'"]*['"`][\s\S]{0,80}method:\s*'(POST|PUT|PATCH|DELETE)'/);
      expect(src, f).not.toMatch(/setOrganisationBranding|updateSettings|saveSettings|feePolicy(Update|Edit)|accountLinks/);
    }
  });

  it('Eve exposes no settings API route and the settings page has no Save/submit-to-change control', () => {
    expect(files.filter(f => /app[\\/]api[\\/].*settings/i.test(f))).toEqual([]);
    for (const f of files.filter(f => /organiser[\\/]settings|SettingsParts/.test(f))) {
      const src = strip(readFileSync(f, 'utf8'));
      expect(src, f).not.toMatch(/method=["']post["']|>\s*Save\s*<|Save changes|<textarea|type=["']file["']|formAction|use server/i);
      expect(src, f).not.toMatch(/acct_|stripe_account|accountId|ticket_token|booking_token|product_surface/);
    }
  });
});
