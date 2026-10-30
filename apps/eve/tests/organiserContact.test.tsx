import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import type { ReactElement } from 'react';

// Organiser contact v1 on Eve: the event page and the booking wallet show a
// small "Contact the organiser" block built only from organiser_name and
// organiser_contact { email, website } — and only when one of the two is set.
// Eve support stays separate (the buyer footer). Unsafe values are dropped,
// and private fields on a (stale or hostile) response are never rendered.

vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/lib/session', () => ({ readSessionToken: async () => 'tok' }));
const gw = { getPublicEvent: vi.fn(), getBookingWallet: vi.fn(), getSession: vi.fn(), listEvents: vi.fn(), getSettings: vi.fn() };
vi.mock('@/lib/ticketing/gateway', () => ({ getTicketingGateway: () => gw }));

import PublicEventPage from '@/app/(buyer)/e/[organisationSlug]/[eventSlug]/page';
import WalletPage from '@/app/(buyer)/b/[bookingToken]/tickets/page';
import BuyerLayout from '@/app/(buyer)/layout';
import SettingsPage from '@/app/(organiser)/organiser/settings/page';
import { product } from '@/config/product';

const INTERNAL = 'Internal Holdings Pty Ltd';
// Fields a stale or hostile response might carry; none may ever render.
const STALE = { organisationName: INTERNAL, support_email: 'private-ops@internal.example', support_phone: '08 8123 4567', branding: { name: null, email: 'private-ops@internal.example', phone: '08 8123 4567' } };
const PRIVATE = [INTERNAL, 'private-ops@internal.example', '08 8123 4567'];
const EVENT = { name: 'Gala', slug: 'gala', description: null, venue: 'Hall', artwork_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', timezone: 'Australia/Adelaide' };
const TYPE = { id: 't1', name: 'General', description: null, price_cents: 0, capacity: 100, remaining: 40, sale_starts_at: null, sale_ends_at: null, sale_status: 'ON_SALE', requires_access_code: false };
const eventDetail = (extra: Record<string, unknown>) => ({ event: EVENT, sessions: [], ticket_types: [TYPE], session_inventory: [], has_promotions: false, paid_checkout_available: false, ...STALE, ...extra });
const wallet = (extra: Record<string, unknown>) => ({
  purchaser_name: 'Sam', event: EVENT, ...STALE,
  tickets: [{ attendee_name: 'Al', ticket_type_name: 'General', session: null, ticket_token: 'tok-a', checked_in_at: null, status: 'VALID' }],
  ...extra,
});

beforeEach(() => { for (const f of Object.values(gw)) f.mockReset(); });

async function eventPage(extra: Record<string, unknown>) {
  gw.getPublicEvent.mockResolvedValue({ status: 'ok', data: eventDetail(extra) });
  return render(await PublicEventPage({ params: Promise.resolve({ organisationSlug: 'acme', eventSlug: 'gala' }), searchParams: Promise.resolve({}) }) as ReactElement);
}
async function walletPage(extra: Record<string, unknown>) {
  gw.getBookingWallet.mockResolvedValue({ status: 'ok', data: wallet(extra) });
  return render(await WalletPage({ params: Promise.resolve({ bookingToken: 'book-1' }) }) as ReactElement);
}

describe.each([['event page', eventPage], ['booking wallet', walletPage]])('%s organiser contact', (_l, show) => {
  it.each([
    ['absent', {}],
    ['null', { organiser_contact: null }],
    ['both null', { organiser_contact: { email: null, website: null } }],
    ['whitespace', { organiser_contact: { email: '  ', website: ' ' } }],
    ['invalid email + unsafe website', { organiser_contact: { email: 'not-an-email', website: 'javascript:alert(1)' } }],
  ])('no usable contact (%s): no block, nothing private', async (_c, extra) => {
    const { container } = await show(extra);
    expect(screen.queryByTestId('organiser-contact')).toBeNull();
    for (const v of PRIVATE) expect(container.textContent).not.toContain(v);
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('public email only, neutral name when none is configured', async () => {
    const { container } = await show({ organiser_contact: { email: 'tickets@acme.example', website: null } });
    const block = screen.getByTestId('organiser-contact');
    expect(block).toHaveTextContent('Questions about this event? Contact the event organiser');
    expect(within(block).getByTestId('organiser-contact-email')).toHaveAttribute('href', 'mailto:tickets@acme.example');
    expect(within(block).queryByTestId('organiser-contact-website')).toBeNull();
    for (const v of PRIVATE) expect(container.textContent).not.toContain(v);
  });

  it('website only, configured display name', async () => {
    await show({ organiser_name: 'Acme Presents', organiser_contact: { email: null, website: 'https://acme.example/' } });
    const block = screen.getByTestId('organiser-contact');
    expect(block).toHaveTextContent('Contact Acme Presents');
    const link = within(block).getByTestId('organiser-contact-website');
    expect(link).toHaveAttribute('href', 'https://acme.example/');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(link).toHaveTextContent('acme.example');
    expect(within(block).queryByTestId('organiser-contact-email')).toBeNull();
  });

  it('both, with an unsafe website dropped and the email kept; text is escaped by React', async () => {
    const { container } = await show({ organiser_name: '<img src=x onerror=alert(1)>', organiser_contact: { email: 'tickets@acme.example', website: 'data:text/html,x' } });
    const block = screen.getByTestId('organiser-contact');
    expect(block).toHaveTextContent('Contact <img src=x onerror=alert(1)>');
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(within(block).getByTestId('organiser-contact-email')).toBeInTheDocument();
    expect(within(block).queryByTestId('organiser-contact-website')).toBeNull();
  });

  it('is accessible', async () => {
    const { container } = await show({ organiser_name: 'Acme Presents', organiser_contact: { email: 'tickets@acme.example', website: 'https://acme.example' } });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Eve support stays separate from the organiser', () => {
  it('the buyer footer names Eve support, not the organiser; the organiser block never shows the Eve support address', async () => {
    const footer = render(<BuyerLayout>{null}</BuyerLayout>);
    expect(footer.container.querySelector('footer')).toHaveTextContent(`Need help with a booking? ${product.supportEmail}`);
    footer.unmount();
    await eventPage({ organiser_contact: { email: 'tickets@acme.example', website: null } });
    expect(screen.getByTestId('organiser-contact')).not.toHaveTextContent(product.supportEmail);
    expect(screen.getByTestId('organiser-contact')).not.toHaveTextContent(/Eve/);
  });
});

describe('organiser settings (read-only)', () => {
  const BRANDING = { configured: true, display_name: 'Acme Presents', display_name_is_custom: true, logo_configured: false, accent_color: null, website: 'https://acme.example', support_email: 'private-ops@internal.example', support_phone: '08 8123 4567', email_footer: null, public_email: 'tickets@acme.example' };
  const settingsData = (branding: Record<string, unknown>) => ({
    status: 'ok',
    data: {
      organisation: { name: INTERNAL, slug: 'acme' }, user: { name: 'Pat', role: 'manager' }, events_capability: { enabled: true },
      ticketing: { paid_ticketing_available: false }, connect: null,
      fees: { scope: { level: 'ORGANISATION', event: null }, effective: { state: 'NO_FEE', source: 'PLATFORM_DEFAULT', reason: 'NOT_CONFIGURED' }, event_overrides_count: 0 },
      branding,
    },
  });
  async function settingsPage(branding: Record<string, unknown>) {
    gw.getSession.mockResolvedValue({ status: 'ok', data: { user: { id: 'u1', name: 'Pat', role: 'manager' }, organisationId: 'org1', organisation: { slug: 'acme', name: INTERNAL } } });
    gw.listEvents.mockResolvedValue({ status: 'ok', data: { organisation: { slug: 'acme', name: INTERNAL }, events: [] } });
    gw.getSettings.mockResolvedValue(settingsData(branding));
    return render(await (SettingsPage({ searchParams: Promise.resolve({}) }) as Promise<ReactElement>));
  }

  it('shows the public name, public email and website as what buyers see; the support email/phone as private', async () => {
    await settingsPage(BRANDING);
    const s = screen.getByTestId('section-branding');
    expect(s).toHaveTextContent('Organiser contact shown to buyers on Eve');
    expect(s).toHaveTextContent('Public contact email');
    expect(s).toHaveTextContent('tickets@acme.example');
    expect(s).toHaveTextContent('Private: never shown to buyers on Eve');
    expect(screen.getByTestId('public-contact-note')).toHaveTextContent('Buyers see a “Contact the organiser” section');
    expect(s).not.toHaveTextContent('using your organisation name');
  });

  it('nothing public set: says so, and never offers the organisation name as the display name', async () => {
    await settingsPage({ ...BRANDING, display_name: INTERNAL, display_name_is_custom: false, website: null, public_email: null });
    const s = screen.getByTestId('section-branding');
    expect(s).toHaveTextContent('Not set. Buyers see “the event organiser”.');
    expect(s).not.toHaveTextContent(INTERNAL);
    expect(screen.getByTestId('public-contact-note')).toHaveTextContent('No public contact is set, so Eve shows buyers no organiser contact details.');
  });

  it('an older API without public_email reads as not set', async () => {
    const legacy: Record<string, unknown> = { ...BRANDING };
    delete legacy.public_email;
    await settingsPage(legacy);
    expect(screen.getByTestId('section-branding')).not.toHaveTextContent('tickets@acme.example');
  });
});
