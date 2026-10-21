import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';

// Launch compliance: legal routes (fail-closed in production), footers, the
// free-registration notice, the paid acceptance checkbox, the collection
// notice, bearer-link notices, and "no tracking / no new cookies".

vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/session', () => ({ readSessionToken: async () => null }));
vi.mock('@/lib/ticketing/gateway', () => ({ getTicketingGateway: () => ({ getTicket: vi.fn(), getBookingWallet: vi.fn() }) }));

import TermsPage from '@/app/(marketing)/terms/page';
import PrivacyPage from '@/app/(marketing)/privacy/page';
import RefundsPage from '@/app/(marketing)/refunds/page';
import { Footer } from '@/components/marketing/Footer';
import BuyerLayout from '@/app/(buyer)/layout';
import { BuyerBooking } from '@/components/buyer/BuyerBooking';
import { BearerLinkNotice } from '@/components/buyer/BearerLinkNotice';
import { getLegalConfig, LEGAL_FACT_KEYS, OPERATOR_FACTS, LEGAL_DOCUMENT_VERSION } from '@/config/legal';
import { refundsDoc, TERMS, PRIVACY } from '@/content/legal';
import { renderTokens } from '@/components/legal/LegalDocument';

const FOREIGN = /BrainBase|Brainbase/;
// The operator facts are code constants now; the only environment input left is
// the support address (plus the publish switch and the Vercel environment).
const FACT_ENV: Record<string, string> = { EVE_SUPPORT_EMAIL: 'support@eveevents.com.au' };
const allText = (docs = [TERMS, PRIVACY, refundsDoc(false), refundsDoc(true)]) =>
  docs.flatMap(d => [d.title, d.intro, ...d.sections.flatMap(s => [s.heading, ...s.body])]).join('\n');

function setEnv(env: Record<string, string>) {
  for (const k of [...Object.keys(FACT_ENV), 'EVE_LEGAL_PUBLISHED', 'VERCEL_ENV']) vi.stubEnv(k, '');
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}
const page = async (el: Promise<ReactElement> | ReactElement) => render(await el);
beforeEach(() => setEnv({}));
afterEach(() => vi.unstubAllEnvs());

describe('legal routes', () => {
  const routes = [['terms', TermsPage, 'Terms of Use and Ticket Purchase Terms'], ['privacy', PrivacyPage, 'Privacy Policy'], ['refunds', RefundsPage, 'Refunds & cancellations']] as const;

  it.each(routes)('/%s renders in Preview with a DRAFT banner, the supplied operator facts and no placeholders', async (_slug, Page, title) => {
    setEnv({ VERCEL_ENV: 'preview', ...FACT_ENV });
    const { container } = await page(Page());
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByTestId('legal-draft-banner')).toBeInTheDocument();
    expect(container.querySelectorAll('mark[data-placeholder="true"]').length).toBe(0);
    expect(container.textContent).not.toMatch(/\[[A-Z/ ]+\]|\{\{/);
    expect(container.textContent).toMatch(/Last updated: \d{4}-\d{2}-\d{2}/);
    expect(container.textContent).not.toMatch(FOREIGN);
  });

  it.each(routes)('/%s FAILS CLOSED in production while the support address is not real: no legal text at all', async (_slug, Page, title) => {
    setEnv({ VERCEL_ENV: 'production', EVE_SUPPORT_EMAIL: 'support@eve.invalid', EVE_LEGAL_PUBLISHED: 'true' });
    const { container } = await page(Page());
    expect(screen.getByTestId('legal-not-published')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(container.querySelectorAll('section section, [data-placeholder]').length).toBe(0);
    expect(container.textContent).not.toMatch(/Australian Consumer Law|Privacy Principles/);
  });

  it('production with every fact set but NOT explicitly published also stays closed (EVE_LEGAL_PUBLISHED unset)', async () => {
    setEnv({ VERCEL_ENV: 'production', ...FACT_ENV });
    await page(TermsPage());
    expect(screen.getByTestId('legal-not-published')).toBeInTheDocument();
  });

  it('an unresolved operator fact keeps the pages draft and, in production, closed, even if published', () => {
    const missing = { ...OPERATOR_FACTS, entityIdentifier: null };
    const cfg = getLegalConfig({ VERCEL_ENV: 'production', EVE_SUPPORT_EMAIL: 'support@eveevents.com.au', EVE_LEGAL_PUBLISHED: 'true' }, missing);
    expect(cfg.unresolved).toEqual(['entityIdentifier']);
    expect(cfg.isFinal).toBe(false);
    expect(cfg.showDocuments).toBe(false);
  });

  it('the supplied operator facts are exactly the approved ones, with no residential address', () => {
    expect(OPERATOR_FACTS).toEqual({
      operatorLegalName: 'James Ronald Palmer', entityType: 'sole trader', entityIdentifier: 'ABN 32 207 559 504',
      operatorLocation: 'Adelaide, South Australia', governingState: 'South Australia',
    });
    expect(getLegalConfig({ EVE_SUPPORT_EMAIL: 'support@eveevents.com.au' }).unresolved).toEqual([]);
  });

  it('the legal version stays a DRAFT version, the publish switch stays off and Preview is never final', () => {
    expect(LEGAL_DOCUMENT_VERSION).toMatch(/draft/i);
    const cfg = getLegalConfig({ VERCEL_ENV: 'preview', EVE_SUPPORT_EMAIL: 'support@eveevents.com.au' });
    expect(cfg.published).toBe(false);
    expect(cfg.isFinal).toBe(false);
  });

  it('production with every fact set and published renders final text: no banner, no placeholders, the real values', async () => {
    setEnv({ VERCEL_ENV: 'production', ...FACT_ENV, EVE_LEGAL_PUBLISHED: 'true' });
    for (const Page of [TermsPage, PrivacyPage, RefundsPage]) {
      const { container, unmount } = await page(Page());
      expect(screen.queryByTestId('legal-draft-banner')).toBeNull();
      expect(screen.queryByTestId('legal-not-published')).toBeNull();
      expect(container.querySelectorAll('[data-placeholder]').length).toBe(0);
      expect(container.textContent).not.toMatch(/\[[A-Z/ ]+\]|\{\{/);
      unmount();
    }
    await page(TermsPage());
    expect(document.body.textContent).toContain('James Ronald Palmer');
    expect(document.body.textContent).toContain('ABN 32 207 559 504');
    expect(document.body.textContent).toContain('Adelaide, South Australia');
    expect(document.body.textContent).toContain('support@eveevents.com.au');
  });

  it('the support placeholder address is never treated as a real address', () => {
    setEnv({ EVE_SUPPORT_EMAIL: 'support@eve.invalid' });
    const cfg = getLegalConfig();
    expect(cfg.supportEmailResolved).toBe(false);
    expect(cfg.unresolved).toEqual([]);
    expect(renderTokens('{{supportEmail}}', cfg)).toEqual([{ text: '[SUPPORT EMAIL]', placeholder: true }]);
  });

  it('every {{token}} used in the documents is a known fact, so none can leak out raw', () => {
    const known = new Set<string>([...LEGAL_FACT_KEYS, 'supportEmail', 'lastUpdated']);
    for (const doc of [TERMS, PRIVACY, refundsDoc(false), refundsDoc(true)]) {
      for (const s of doc.sections) for (const p of s.body) for (const m of p.matchAll(/\{\{(\w+)\}\}/g)) expect(known.has(m[1]), `${doc.slug}: ${m[1]}`).toBe(true);
    }
  });

  it('the documents make no charity / not-for-profit / public-benefit claim, no blanket "no refunds", and preserve consumer law', () => {
    const all = [TERMS, PRIVACY, refundsDoc(false), refundsDoc(true)].flatMap(d => [d.intro, ...d.sections.flatMap(s => [s.heading, ...s.body])]).join('\n');
    expect(all).not.toMatch(/charit|not[- ]for[- ]profit|non-?profit|social (enterprise|purpose)|public benefit|donat|no refunds/i);
    expect(TERMS.sections.map(s => s.body.join(' ')).join(' ')).toMatch(/Australian Consumer Law/);
    expect(refundsDoc(false).sections.map(s => s.body.join(' ')).join(' ')).toMatch(/Australian Consumer Law|Australian law/);
  });

  it('the event-change section never promises a notice unless the notice feature is on', () => {
    const changes = (c: boolean) => refundsDoc(c).sections.find(x => /changes significantly/.test(x.heading))!.body.join(' ');
    const off = changes(false);
    const on = changes(true);
    expect(off).toMatch(/Event Organiser is responsible for telling you/);
    expect(off).not.toMatch(/we (aim to )?email/i);
    expect(on).toMatch(/we aim to email/i);
    // Delivery is never guaranteed.
    expect(on).toMatch(/cannot guarantee that an email will be delivered/i);
    expect(on).not.toMatch(/we email people/i);
  });

  it('operator identity appears only where it is needed: Terms and Privacy, not the Refunds policy', () => {
    const body = (d: { sections: { body: string[] }[] }) => d.sections.flatMap(s => s.body).join(' ');
    for (const t of ['{{operatorLegalName}}', '{{entityIdentifier}}', '{{operatorLocation}}']) {
      expect(body(TERMS)).toContain(t);
    }
    expect(body(PRIVACY)).toContain('{{operatorLegalName}}');
    expect(body(PRIVACY)).toContain('{{entityIdentifier}}');
    expect(body(refundsDoc(true))).not.toMatch(/\{\{(operatorLegalName|entityIdentifier|operatorLocation)\}\}/);
  });

  it('approved wording: support is not an SLA, privacy requests aim for 30 days, no response-time or privacy-contact placeholders', () => {
    const all = allText([TERMS, PRIVACY, refundsDoc(true)]);
    const reply = 'We read every message and will reply as soon as we reasonably can. We do not guarantee a response time.';
    expect(all).toContain(reply);
    expect(all.split(reply).length - 1).toBe(2); // Terms contact + Refunds help (both refer to support)
    expect(PRIVACY.sections.flatMap(s => s.body).join(' ')).toContain('We will respond within a reasonable time, and we aim to do so within 30 days.');
    expect(all).not.toMatch(/supportResponseTime|privacyContact|retentionPeriods|aim to respond within|business days|within \d+ (business )?(days|hours)(?!\.)(?<!30 days)/i);
  });

  it('retention is principle-based: the exact principle sentence, no promised period (7 years etc.), no implied automatic deletion', () => {
    const s8 = PRIVACY.sections.find(x => x.heading.startsWith('8.'))!.body.join(' ');
    expect(s8).toContain('We keep personal information only for as long as reasonably required for the purposes described in this policy, our operational needs, dispute handling and any applicable legal obligations. When it is no longer reasonably required, we may delete or de-identify it.');
    expect(s8).toMatch(/do not currently delete information automatically/);
    expect(allText()).not.toMatch(/\b(7|seven) years?\b|financial (and tax )?record-keeping|for 7 years/i);
    expect(s8).not.toMatch(/\b\d+ (days|weeks|months|years)\b/); // no fixed period is published
    expect(s8).not.toMatch(/automatically (delete|remove)s?(?! )|are deleted after|is deleted after|we delete .* after \d/i);
  });

  it('private beta: states the limited availability, free-booking position and that the operator may be the Event Organiser', () => {
    const note = 'Eve is currently being made available on a limited basis. Some features, including paid ticketing and access for third-party organisers, may not yet be available.';
    const terms = TERMS.sections.flatMap(x => x.body).join(' ');
    const refunds = refundsDoc(true).sections.flatMap(x => x.body).join(' ');
    expect(terms).toContain(note);
    expect(refunds).toContain(note);
    expect(terms).toMatch(/During the private beta the Event Organiser may be the operator of Eve/);
    expect(refunds).toMatch(/Free bookings have no ticket price, so there is nothing to refund/);
    expect(refunds).toMatch(/Paid ticketing is not currently available/);
    expect(terms).toMatch(/Paid ticketing is not currently available/);
  });

  it('the documents do not imply third-party organisers are onboarded, paid ticketing is live, legal review, or settled Privacy Act coverage', () => {
    const all = allText();
    expect(all).not.toMatch(/independent Event Organisers|run by independent|Events on Eve are run by/i);
    expect(all).not.toMatch(/(reviewed|approved|checked|endorsed|certified) by (a |our )?(lawyer|solicitor|counsel|attorney)|legally (reviewed|approved)|legal advice|lawyer|solicitor/i);
    expect(all).not.toMatch(/we comply with|fully compliant|compliant with the (Privacy Act|APPs|Australian Privacy)/i);
    const priv = PRIVACY.sections.flatMap(x => x.body).join(' ');
    expect(priv).toContain('to the extent the Australian Privacy Principles and the Privacy Act 1988 (Cth) apply to us');
    // Stripe appears only as a future / conditional processor.
    for (const doc of [TERMS, PRIVACY, refundsDoc(true)]) {
      for (const sec of doc.sections) for (const para of sec.body) {
        if (/Stripe/.test(para)) expect(para, `${doc.slug}: ${para.slice(0, 60)}`).toMatch(/future|if paid ticketing|Paid ticketing is not currently available|expected to be/i);
      }
    }
  });

  it('liability wording is minimal: no waiver, indemnity, consequential-loss, foreseeability or cap language', () => {
    const all = allText();
    expect(all).not.toMatch(/indemnif|waive|waiver|consequential|indirect loss|not reasonably foreseeable|maximum liability|liability is limited|limit(ed)? our liability|exclude all|to the fullest extent|not responsible for/i);
    const s10 = TERMS.sections.find(x => x.heading.startsWith('10.'))!;
    expect(s10.heading).toBe('10. Responsibility for events');
    expect(s10.body.join(' ')).toMatch(/Nothing in these terms limits any right or remedy you have under Australian law/);
  });

  it('governing law is kept only in its safe form: non-exclusive jurisdiction, subject to statutory rights', () => {
    const s12 = TERMS.sections.find(x => x.heading.startsWith('12.'))!.body.join(' ');
    expect(s12).toMatch(/non-exclusive jurisdiction, without limiting your statutory rights/);
    expect(s12).not.toMatch(/exclusive jurisdiction(?!,)/);
    expect(s12).not.toMatch(/waive|submit irrevocably|sole jurisdiction/i);
  });

  it('the Terms and Refunds documents do not promise delivery, an outcome or a response time', () => {
    const all = allText();
    expect(all).not.toMatch(/we (will|must) (email|notify|tell) (you|people)|guarantee (that )?(an email|delivery)(?! will)/i);
    expect(all).not.toMatch(/within \d+ ?(business )?(hours|days)(?!\.)(?<!30 days)|24 hours|same day|instantly/i);
  });

  it('approved wording: no organiser agreement claim, no consent-like overseas wording, no registration-answer contradiction', () => {
    const all = allText();
    expect(all).not.toMatch(/separate agreement/i);
    expect(all).not.toMatch(/By using Eve you understand/i);
    const priv = PRIVACY.sections.flatMap(s => s.body).join(' ');
    expect(priv).not.toMatch(/answers to registration questions that the Event Organiser asks/);
    expect(priv).toMatch(/does not currently ask registration questions, so we do not currently collect answers to them/);
    expect(priv).not.toMatch(/attendee.s name and optional email/); // Eve collects attendee names only
    expect(priv).toMatch(/This means some personal information may be handled outside Australia/);
  });

  it('approved wording: softened refund, correction, help and marketing statements; ACL non-exclusion and bearer warning kept', () => {
    const all = allText();
    expect(all).not.toMatch(/You are entitled to a refund of what you paid/);
    expect(all).toMatch(/generally entitled to a remedy under Australian law/);
    expect(all).not.toMatch(/Charges made in error will be corrected/);
    expect(all).toMatch(/If we find a charge was made in error, we will correct it/);
    expect(all).not.toMatch(/right outcome/);
    expect(all).toMatch(/will try to help/);
    expect(all).not.toMatch(/We do not send marketing email/);
    expect(all).toMatch(/We do not currently send marketing email/);
    expect(all).toMatch(/Nothing in these terms limits those guarantees/);
    expect(all).toMatch(/does not limit your rights under the Australian Consumer Law/);
    expect(TERMS.sections.find(s => s.heading.startsWith('5.'))!.body.join(' ')).toMatch(/Anyone who has a ticket or booking link can view and use that ticket/);
  });

  it('no GST wording on platform fees while the operator is not registered for GST, and no street address', () => {
    const all = allText();
    expect(all).not.toMatch(/\bGST\b|tax invoice|inclusive of (gst|tax)/i);
    expect(JSON.stringify(OPERATOR_FACTS)).not.toMatch(/\d+\s+\w+\s+(street|st\b|road|rd\b|avenue|ave\b|drive|dr\b|terrace|court|crescent)/i);
  });

  it('the Refunds document is named the same in the page title, metadata, footer links, acceptance label and policy references', async () => {
    expect(refundsDoc(true).title).toBe('Refunds & cancellations');
    expect((await (await import('@/app/(marketing)/refunds/page')).generateMetadata()).title).toBe('Refunds & cancellations');
    const { LEGAL_LINKS } = await import('@/config/legal');
    expect(LEGAL_LINKS.find(l => l.href === '/refunds')!.label).toBe('Refunds & cancellations');
    expect(allText()).not.toMatch(/Refunds, Cancellations/);
    expect(TERMS.intro).toContain('Refunds & cancellations policy');
  });

  it('the draft pages are not indexable; final pages are', async () => {
    setEnv({ VERCEL_ENV: 'preview' });
    expect((await (await import('@/app/(marketing)/terms/page')).generateMetadata()).robots).toEqual({ index: false, follow: false });
    setEnv({ VERCEL_ENV: 'production', ...FACT_ENV, EVE_LEGAL_PUBLISHED: 'true' });
    expect((await (await import('@/app/(marketing)/terms/page')).generateMetadata()).robots).toBeUndefined();
  });

  it('has no accessibility violations (draft and not-published states)', async () => {
    setEnv({ VERCEL_ENV: 'preview' });
    let r = await page(PrivacyPage());
    expect(await axe(r.container)).toHaveNoViolations();
    r.unmount();
    setEnv({ VERCEL_ENV: 'production' });
    r = await page(PrivacyPage());
    expect(await axe(r.container)).toHaveNoViolations();
  });
});

describe('footers', () => {
  const expectLinks = (root: HTMLElement) => {
    const legal = within(root).getAllByRole('navigation', { name: 'Legal' })[0];
    expect(within(legal).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(legal).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(within(legal).getByRole('link', { name: 'Refunds & cancellations' })).toHaveAttribute('href', '/refunds');
    expect(within(legal).getByRole('link', { name: 'Support' }).getAttribute('href')).toMatch(/^mailto:/);
  };
  it('the marketing footer links Terms, Privacy, Refunds & cancellations and Support', () => {
    const { container } = render(<Footer />);
    expectLinks(container);
  });
  it('the buyer layout footer links the same', () => {
    const { container } = render(<BuyerLayout>{null}</BuyerLayout>);
    expectLinks(container);
  });
});

describe('registration and checkout notices', () => {
  const TYPE = { id: 't1', name: 'General', description: null, price_cents: 2500, capacity: 100, remaining: 40, sale_starts_at: null, sale_ends_at: null, sale_status: 'ON_SALE', requires_access_code: false };
  const detail = (price: number) => ({
    event: { name: 'Gala', slug: 'gala', description: null, venue: null, artwork_url: null, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', timezone: 'Australia/Adelaide' },
    sessions: [], ticket_types: [{ ...TYPE, price_cents: price }], session_inventory: [], has_promotions: false, organisationName: 'Acme',
  });
  function mockFetch() {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      const u = String(url);
      const body = u.endsWith('/quote') ? { subtotal_cents: 0, discount_cents: 0, total_cents: 0, currency: 'aud', pricing: null, promotion: null, promotion_error: null, access: null, access_error: null, cart_error: null }
        : u.endsWith('/checkout') ? { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_1' }
        : { confirmation_reference: 'r', quantity: 1, tickets: [{ attendee_name: 'Sam', ticket_token: 'tk' }], booking_token: 'bk' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }
  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'More General' }));
    await user.type(screen.getByLabelText('Full name'), 'Sam');
    await user.type(screen.getByLabelText('Email'), 'sam@x.test');
  };

  it('FREE: shows the linked Terms/Privacy notice and has NO checkbox', async () => {
    const user = userEvent.setup(); mockFetch();
    render(<BuyerBooking organisationSlug="acme" eventSlug="gala" detail={detail(0) as never} cancelled={false} />);
    await fill(user);
    const n = screen.getByTestId('free-terms-notice');
    expect(n).toHaveTextContent('By registering you agree to the Terms and acknowledge the Privacy Policy.');
    expect(within(n).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(n).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('PAID: a required, UNTICKED checkbox with links to Terms and Refunds; submit is refused until ticked and nothing is sent', async () => {
    const user = userEvent.setup(); const fn = mockFetch();
    render(<BuyerBooking organisationSlug="acme" eventSlug="gala" detail={detail(2500) as never} cancelled={false} />);
    await fill(user);
    const box = screen.getByRole('checkbox', { name: /I agree to the Terms and Refunds & cancellations policy/ });
    expect(box).not.toBeChecked();
    expect(box).toBeRequired();
    expect(screen.queryByTestId('free-terms-notice')).toBeNull();
    const label = box.closest('div')!;
    expect(within(label).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(label).getByRole('link', { name: 'Refunds & cancellations' })).toHaveAttribute('href', '/refunds');
    expect(within(label).getByRole('link', { name: 'Terms' })).toHaveAttribute('target', '_blank');
    const form = screen.getByRole('form', { name: 'Book tickets' });
    (await import('@testing-library/react')).fireEvent.submit(form); // bypasses the native required check
    expect(await screen.findByText(/agree to the Terms and the Refunds/)).toBeInTheDocument();
    expect(fn.mock.calls.some(c => String(c[0]).endsWith('/checkout'))).toBe(false);
  });

  it('PAID: once ticked the request carries accept_terms: true; FREE never sends it', async () => {
    const user = userEvent.setup(); const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    let fn = mockFetch();
    const paid = render(<BuyerBooking organisationSlug="acme" eventSlug="gala" detail={detail(2500) as never} cancelled={false} />);
    await fill(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    const call = fn.mock.calls.find(c => String(c[0]).endsWith('/checkout'))!;
    expect(JSON.parse((call[1] as RequestInit).body as string).accept_terms).toBe(true);
    paid.unmount();
    fn = mockFetch();
    render(<BuyerBooking organisationSlug="acme" eventSlug="gala" detail={detail(0) as never} cancelled={false} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Complete registration' }));
    const reg = fn.mock.calls.find(c => String(c[0]).endsWith('/register'))!;
    expect(JSON.parse((reg[1] as RequestInit).body as string)).not.toHaveProperty('accept_terms');
  });

  it('COLLECTION NOTICE: booking details go to the organiser, may appear in the organiser\'s contact records, and this is not marketing consent', async () => {
    const user = userEvent.setup(); mockFetch();
    render(<BuyerBooking organisationSlug="acme" eventSlug="gala" detail={detail(0) as never} cancelled={false} />);
    expect(screen.queryByTestId('collection-notice')).toBeNull(); // only once tickets are chosen
    await fill(user);
    const n = screen.getByTestId('collection-notice');
    expect(n).toHaveTextContent(/provided to the event organiser/);
    expect(n).toHaveTextContent(/event contact records/);
    expect(n).toHaveTextContent(/not consent to marketing/);
    expect(within(n).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    // And no marketing opt-in of any kind.
    expect(screen.queryByLabelText(/marketing|newsletter|updates|promotions/i)).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('bearer-link notices', () => {
  it('the notice component states the warning for tickets and bookings', () => {
    const a = render(<BearerLinkNotice what="ticket" />);
    expect(screen.getByTestId('bearer-link-notice')).toHaveTextContent('Anyone with this link can access this ticket. Keep it private.');
    a.unmount();
    render(<BearerLinkNotice what="booking" />);
    expect(screen.getByTestId('bearer-link-notice')).toHaveTextContent('Anyone with this link can access these tickets. Keep it private.');
  });
  it('both the ticket page and the booking wallet render it', () => {
    const root = path.resolve(__dirname, '..');
    for (const f of ['app/(buyer)/t/[token]/page.tsx', 'app/(buyer)/b/[bookingToken]/tickets/page.tsx']) {
      expect(readFileSync(path.join(root, f), 'utf8')).toContain('<BearerLinkNotice');
    }
  });
});

describe('privacy and tracking state', () => {
  const ROOT = path.resolve(__dirname, '..');
  function walk(dir: string, out: string[] = []) {
    for (const e of readdirSync(dir)) {
      if (['node_modules', '.next', 'tests'].includes(e)) continue;
      const f = path.join(dir, e);
      if (statSync(f).isDirectory()) walk(f, out); else if (/\.(ts|tsx|json)$/.test(e)) out.push(f);
    }
    return out;
  }
  const files = walk(ROOT);

  it('Eve loads no analytics, tracker, pixel or third-party script', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['lucide-react', 'next', 'react', 'react-dom']);
    for (const f of files.filter(x => /\.(ts|tsx)$/.test(x))) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/@vercel\/(analytics|speed-insights)|googletagmanager|google-analytics|gtag\(|fbq\(|plausible|posthog|hotjar|mixpanel|segment\.com|<script[^>]*src=/i);
    }
  });

  it('the only cookie Eve touches is the organiser session cookie, through its one module; no browser storage', () => {
    for (const f of files.filter(x => /\.(ts|tsx)$/.test(x))) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      const src = readFileSync(f, 'utf8');
      expect(src, rel).not.toMatch(/document\.cookie|localStorage|sessionStorage|indexedDB/);
      if (rel !== 'lib/session.ts') expect(src, rel).not.toMatch(/cookies\(\)|\.cookies\.set|Set-Cookie/i);
    }
    const session = readFileSync(path.join(ROOT, 'lib/session.ts'), 'utf8');
    expect([...session.matchAll(/jar\.set\(/g)].length).toBe(1);
  });

  it('no cookie banner or consent widget exists', () => {
    for (const f of files.filter(x => /\.(tsx)$/.test(x))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/cookie (banner|consent)|accept (all )?cookies/i);
  });
});
