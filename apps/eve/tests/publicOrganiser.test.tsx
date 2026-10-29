import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { BuyerBooking } from '@/components/buyer/BuyerBooking';
import { categoryNote } from '@/components/buyer/QuestionField';

// Public organiser identity on Eve buyer surfaces: only the organiser's
// configured public display name (organiser_name) is shown; with none, the
// event page omits the organiser line and the booking wording says "the event
// organiser". The internal organisation name is never rendered, even if a
// stale API response still carried it.

const gw = { getPublicEvent: vi.fn() };
vi.mock('@/lib/ticketing/gateway', () => ({ getTicketingGateway: () => gw }));
import PublicEventPage from '@/app/(buyer)/e/[organisationSlug]/[eventSlug]/page';

const INTERNAL = 'Brainbase Internal Pty Ltd';
const TYPE = { id: 't1', name: 'General', description: null, price_cents: 0, capacity: 100, remaining: 40, sale_starts_at: null, sale_ends_at: null, sale_status: 'ON_SALE', requires_access_code: false };
const Q = {
  ecName: { id: 'q-ec-name', label: 'Emergency Contact Name', help_text: null, field_type: 'SHORT_TEXT', required: true, scope: 'ORDER', options: null, sort_order: 0, data_category: 'THIRD_PARTY' },
  access: { id: 'q-access', label: 'Accessibility requirements', help_text: null, field_type: 'LONG_TEXT', required: false, scope: 'ATTENDEE', options: null, sort_order: 0, data_category: 'SENSITIVE' },
  hear: { id: 'q-hear', label: 'How did you hear about this event?', help_text: null, field_type: 'SINGLE_SELECT', required: false, scope: 'ORDER', options: ['Radio'], sort_order: 3, data_category: 'STANDARD' },
};
const detail = (extra: Record<string, unknown> = {}) => ({
  event: { name: 'Riverlights (test)', slug: 'rl', description: null, venue: null, artwork_url: null, starts_at: '2027-03-20T01:30:00Z', ends_at: '2027-03-20T12:30:00Z', timezone: 'Australia/Adelaide' },
  sessions: [], ticket_types: [TYPE], session_inventory: [], has_promotions: false, paid_checkout_available: false,
  // A stale/foreign field the page must never render.
  organisationName: INTERNAL,
  ...extra,
});

beforeEach(() => { vi.unstubAllGlobals(); gw.getPublicEvent.mockReset(); });

async function renderEventPage(data: Record<string, unknown>) {
  gw.getPublicEvent.mockResolvedValue({ status: 'ok', data });
  const el = await PublicEventPage({ params: Promise.resolve({ organisationSlug: 'brainbase', eventSlug: 'rl' }), searchParams: Promise.resolve({}) });
  return render(el as ReactElement);
}

describe('Eve event page organiser line', () => {
  it('shows the configured public display name above the title', async () => {
    const { container } = await renderEventPage(detail({ organiser_name: 'Riverlights Collective' }));
    expect(screen.getByTestId('event-organiser')).toHaveTextContent('Riverlights Collective');
    expect(container.textContent).not.toContain(INTERNAL);
  });

  it.each([['absent', {}], ['null', { organiser_name: null }], ['blank', { organiser_name: '   ' }]])('no public name (%s): the line is omitted and the internal name never appears', async (_l, extra) => {
    const { container } = await renderEventPage(detail(extra));
    expect(screen.queryByTestId('event-organiser')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Riverlights (test)');
    expect(container.textContent).not.toContain(INTERNAL);
    expect(container.textContent).not.toMatch(/Presented by/);
  });
});

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).endsWith('/quote')
    ? { subtotal_cents: 0, discount_cents: 0, total_cents: 0, currency: 'aud', pricing: 'FREE', promotion: null, promotion_error: null, access: null, access_error: null, cart_error: null }
    : {}), { status: 200, headers: { 'content-type': 'application/json' } })));
}
const view = (d: Record<string, unknown>) => render(<BuyerBooking organisationSlug="brainbase" eventSlug="rl" detail={d as never} cancelled={false} />);
async function fillQuestions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More General' }));
  await user.type(screen.getByLabelText('Full name'), 'Jane');
  await user.type(screen.getByLabelText('Email'), 'jane@example.test');
  await user.type(screen.getByLabelText('Emergency Contact Name'), 'Sam');
  await user.type(screen.getByLabelText('Accessibility requirements (optional)'), 'Step-free');
}

describe('booking / registration-question wording', () => {
  it('configured public name: used in the notice, notes and both acknowledgements', async () => {
    const user = userEvent.setup(); mockFetch();
    const { container } = view(detail({ organiser_name: 'Riverlights Collective', questions: [Q.ecName, Q.access, Q.hear] }));
    await fillQuestions(user);
    expect(screen.getByTestId('questions-notice').textContent).toBe('Riverlights Collective asks these questions to help run this event. Your answers go to Riverlights Collective for this event. You can leave optional questions blank. How we handle your answers');
    expect(screen.getByTestId('note-SENSITIVE').textContent).toBe('This may include health, disability or accessibility information. Riverlights Collective asks so they can make arrangements for you at this event. Only share what you’re comfortable with.');
    expect(screen.getByTestId('note-THIRD_PARTY').textContent).toBe('Please make sure this person knows you’re giving their details to Riverlights Collective for this event.');
    expect(screen.getByTestId('agree-sensitive').querySelector('label')!.textContent).toBe('I agree to Riverlights Collective collecting my answers to Accessibility requirements for this event, including health, disability or accessibility information. Only answer what you are comfortable sharing.');
    expect(screen.getByTestId('confirm-third-party').querySelector('label')!.textContent).toBe('I confirm that the person whose details I have given (Emergency Contact Name) knows I am giving them to Riverlights Collective for this event, or that I am allowed to give them.');
    expect(container.textContent).not.toContain(INTERNAL);
  });

  it.each([['absent', {}], ['null', { organiser_name: null }], ['blank', { organiser_name: '  ' }]])('no public name (%s): neutral "the event organiser" wording, same meaning and structure', async (_l, extra) => {
    const user = userEvent.setup(); mockFetch();
    const { container } = view(detail({ ...extra, questions: [Q.ecName, Q.access, Q.hear] }));
    await fillQuestions(user);
    expect(screen.getByTestId('questions-notice').textContent).toBe('The event organiser asks these questions to help run this event. Your answers go to the event organiser for this event. You can leave optional questions blank. How we handle your answers');
    expect(screen.getByTestId('note-SENSITIVE').textContent).toBe('This may include health, disability or accessibility information. The event organiser asks so they can make arrangements for you at this event. Only share what you’re comfortable with.');
    expect(screen.getByTestId('note-THIRD_PARTY').textContent).toBe('Please make sure this person knows you’re giving their details to the event organiser for this event.');
    expect(screen.getByTestId('agree-sensitive').querySelector('label')!.textContent).toBe('I agree to the event organiser collecting my answers to Accessibility requirements for this event, including health, disability or accessibility information. Only answer what you are comfortable sharing.');
    expect(screen.getByTestId('confirm-third-party').querySelector('label')!.textContent).toBe('I confirm that the person whose details I have given (Emergency Contact Name) knows I am giving them to the event organiser for this event, or that I am allowed to give them.');
    expect(container.textContent).not.toContain(INTERNAL);
    expect(container.textContent).not.toContain('undefined');
    expect(container.textContent).not.toContain('null');
  });

  it('categoryNote: null organiser gives the neutral wording; STANDARD and CONSENT notes never name anyone', () => {
    expect(categoryNote(Q.access as never, null)).toContain('The event organiser asks so they can make arrangements');
    expect(categoryNote(Q.ecName as never, null)).toContain('giving their details to the event organiser for this event');
    expect(categoryNote(Q.hear as never, null)).toBeNull();
  });
});
