import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { BuyerBooking } from '@/components/buyer/BuyerBooking';
import { RecordedAnswers } from '@/components/organiser/RecordedAnswers';

// Eve registration questions (ADR 0013 §4a) on the buyer form. Display and
// UX checks only — the ticketing API re-validates everything server-side
// (see tests/containment/eveRegistrationQuestions*.test.ts in the repo root).
// The question set below is Riverlights-STYLE TEST DATA only.

const TYPE = { id: 't1', name: 'General', description: null, price_cents: 0, capacity: 100, remaining: 40, sale_starts_at: null, sale_ends_at: null, sale_status: 'ON_SALE', requires_access_code: false };
const Q = {
  ecName: { id: 'q-ec-name', label: 'Emergency Contact Name', help_text: null, field_type: 'SHORT_TEXT', required: true, scope: 'ORDER', options: null, sort_order: 0, sensitive: true },
  ecPhone: { id: 'q-ec-phone', label: 'Emergency Contact Phone Number', help_text: null, field_type: 'SHORT_TEXT', required: true, scope: 'ORDER', options: null, sort_order: 1, sensitive: true },
  photo: { id: 'q-photo', label: 'Consent to event photography/videography', help_text: 'Photos may be used in event promotion.', field_type: 'YES_NO', required: true, scope: 'ORDER', options: null, sort_order: 2, sensitive: false },
  hear: { id: 'q-hear', label: 'How did you hear about this event?', help_text: null, field_type: 'SINGLE_SELECT', required: false, scope: 'ORDER', options: ['Social media', 'Friend', 'Radio'], sort_order: 3, sensitive: false },
  interests: { id: 'q-int', label: 'Interests', help_text: null, field_type: 'MULTI_SELECT', required: false, scope: 'ORDER', options: ['Music', 'Art'], sort_order: 4, sensitive: false },
  notes: { id: 'q-notes', label: 'Anything else?', help_text: null, field_type: 'LONG_TEXT', required: false, scope: 'ORDER', options: null, sort_order: 5, sensitive: false },
  access: { id: 'q-access', label: 'Accessibility requirements', help_text: 'Tell us anything that helps you attend.', field_type: 'LONG_TEXT', required: false, scope: 'ATTENDEE', options: null, sort_order: 0, sensitive: true },
  over18: { id: 'q-18', label: 'Are you over 18 years of age?', help_text: null, field_type: 'YES_NO', required: true, scope: 'ATTENDEE', options: null, sort_order: 1, sensitive: false },
};
const ALL = Object.values(Q);
const detail = (extra: Record<string, unknown> = {}) => ({
  event: { name: 'Riverlights (test)', slug: 'rl', description: null, venue: null, artwork_url: null, starts_at: '2027-03-20T01:30:00Z', ends_at: '2027-03-20T12:30:00Z', timezone: 'Australia/Adelaide' },
  sessions: [], ticket_types: [TYPE], session_inventory: [], has_promotions: false, organisationName: 'Acme Events', paid_checkout_available: true,
  ...extra,
});

function mockFetch() {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    void init;
    const u = String(url);
    const body = u.endsWith('/quote') ? { subtotal_cents: 0, discount_cents: 0, total_cents: 0, currency: 'aud', pricing: 'FREE', promotion: null, promotion_error: null, access: null, access_error: null, cart_error: null }
      : u.endsWith('/checkout') ? { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_1' }
      : { confirmation_reference: 'ref-1', quantity: 1, tickets: [{ attendee_name: 'Jane', ticket_token: 'tk1' }], booking_token: 'bk1' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const sent = (fn: ReturnType<typeof mockFetch>, suffix: string) => {
  const call = fn.mock.calls.find(c => String(c[0]).endsWith(suffix));
  return call ? JSON.parse(call[1]!.body as string) : null;
};
const view = (d: Record<string, unknown>) => render(<BuyerBooking organisationSlug="acme" eventSlug="rl" detail={d as never} cancelled={false} />);
async function start(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More General' }));
  await user.type(screen.getByLabelText('Full name'), 'Jane');
  await user.type(screen.getByLabelText('Email'), 'jane@example.test');
}

beforeEach(() => { vi.unstubAllGlobals(); });

describe('no-question events render and submit exactly as before', () => {
  it.each([['no questions key', {}], ['empty questions', { questions: [] }], ['not opted in (empty + not blocked)', { questions: [], questions_block_booking: false }]])('%s', async (_l, extra) => {
    const user = userEvent.setup(); const fn = mockFetch();
    view(detail(extra));
    await start(user);
    expect(screen.queryByTestId('order-questions')).toBeNull();
    expect(screen.queryByTestId('sensitive-consent')).toBeNull();
    expect(screen.getByTestId('collection-notice')).toHaveTextContent("Your booking details (your name, email and phone, and the attendees' names) are provided to the event organiser");
    await user.click(screen.getByRole('button', { name: 'Complete registration' }));
    await screen.findByTestId('free-confirmation');
    const body = sent(fn, '/register');
    expect(Object.keys(body).sort()).toEqual(['attendees', 'items', 'purchaser_email', 'purchaser_name'].concat(body.event_session_id !== undefined ? ['event_session_id'] : []).sort());
    expect(body.attendees[0]).toEqual({ name: 'Jane', ticket_type_id: 't1' });
  });
});

describe('rendering each supported type', () => {
  it('short text, long text, yes/no (no default), single select (placeholder), multi select, help text, optional labels; axe-clean', async () => {
    const user = userEvent.setup(); mockFetch();
    const { container } = view(detail({ questions: ALL }));
    await start(user);
    const order = screen.getByTestId('order-questions');
    expect(within(order).getByLabelText('Emergency Contact Name')).toHaveAttribute('maxlength', '300');
    expect(within(order).getByLabelText('Emergency Contact Name')).toBeRequired();
    expect(within(order).getByLabelText('Anything else? (optional)').tagName).toBe('TEXTAREA');
    const photo = within(order).getByRole('group', { name: 'Consent to event photography/videography' });
    const radios = within(photo).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const r of radios) expect(r).not.toBeChecked(); // never pre-selected
    expect(within(order).getByText('Photos may be used in event promotion.')).toBeInTheDocument();
    const hear = within(order).getByLabelText('How did you hear about this event? (optional)') as HTMLSelectElement;
    expect(hear.value).toBe('');
    expect(within(hear).getAllByRole('option').map(o => o.textContent)).toEqual(['Choose…', 'Social media', 'Friend', 'Radio']);
    const interests = within(order).getByRole('group', { name: 'Interests (optional)' });
    for (const c of within(interests).getAllByRole('checkbox')) expect(c).not.toBeChecked();
    const attendee = screen.getByTestId('attendee-t1-0');
    expect(within(attendee).getByLabelText('Accessibility requirements (optional)')).toHaveAccessibleDescription('Tell us anything that helps you attend.');
    expect(within(attendee).getByRole('group', { name: 'Are you over 18 years of age?' })).toBeInTheDocument();
    // Native fields are not duplicated: one name, one email, one phone.
    expect(screen.getAllByLabelText('Full name')).toHaveLength(1);
    expect(screen.getAllByLabelText('Email')).toHaveLength(1);
    expect(screen.getByTestId('collection-notice')).toHaveTextContent("your answers to the organiser's questions");
    expect(await axe(container)).toHaveNoViolations();
  });

  it('attendee questions are asked once per ticket, with the attendee name per ticket when there are several', async () => {
    const user = userEvent.setup(); mockFetch();
    view(detail({ questions: [Q.over18] }));
    await user.click(screen.getByRole('button', { name: 'More General' }));
    await user.click(screen.getByRole('button', { name: 'More General' }));
    for (const key of ['t1-0', 't1-1']) {
      const fs = screen.getByTestId(`attendee-${key}`);
      expect(within(fs).getByLabelText('Attendee name')).toBeRequired();
      expect(within(fs).getByRole('group', { name: 'Are you over 18 years of age?' })).toBeInTheDocument();
    }
  });
});

describe('required, optional and consent behaviour', () => {
  it('a required question left unanswered blocks submit client-side; nothing is sent', async () => {
    const user = userEvent.setup(); const fn = mockFetch();
    view(detail({ questions: [Q.photo] }));
    await start(user);
    fireEvent.submit(screen.getByRole('form', { name: 'Book tickets' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Consent to event photography/videography is required.');
    expect(fn.mock.calls.some(c => /\/(register|checkout)$/.test(String(c[0])))).toBe(false);
  });

  it('"No" to a consent-style yes/no question is a real answer and is sent as false', async () => {
    const user = userEvent.setup(); const fn = mockFetch();
    view(detail({ questions: [Q.photo] }));
    await start(user);
    await user.click(within(screen.getByRole('group', { name: Q.photo.label })).getByRole('radio', { name: 'No' }));
    await user.click(screen.getByRole('button', { name: 'Complete registration' }));
    await screen.findByTestId('free-confirmation');
    expect(sent(fn, '/register').order_responses).toEqual([{ question_id: 'q-photo', answer: false }]);
  });

  it('optional questions left blank are not sent at all', async () => {
    const user = userEvent.setup(); const fn = mockFetch();
    view(detail({ questions: [Q.hear, Q.notes, Q.interests, Q.access] }));
    await start(user);
    await user.click(screen.getByRole('button', { name: 'Complete registration' }));
    await screen.findByTestId('free-confirmation');
    const body = sent(fn, '/register');
    expect(body).not.toHaveProperty('order_responses');
    expect(body.attendees[0]).not.toHaveProperty('responses');
    expect(body).not.toHaveProperty('sensitive_consent');
  });

  it('sensitive: the acknowledgement appears only once a sensitive question is answered, is never pre-ticked, and blocks submit until ticked', async () => {
    const user = userEvent.setup(); const fn = mockFetch();
    view(detail({ questions: [Q.access, Q.hear] }));
    await start(user);
    expect(screen.queryByTestId('sensitive-consent')).toBeNull();
    await user.selectOptions(screen.getByLabelText('How did you hear about this event? (optional)'), 'Radio');
    expect(screen.queryByTestId('sensitive-consent')).toBeNull(); // non-sensitive answer
    await user.type(screen.getByLabelText('Accessibility requirements (optional)'), 'Step-free access');
    const box = within(screen.getByTestId('sensitive-consent')).getByRole('checkbox');
    expect(box).not.toBeChecked();
    // Exact DOM text (toHaveTextContent normalises whitespace, which would hide a dropped space).
    expect(screen.getByTestId('sensitive-consent').querySelector('label')!.textContent).toBe(
      "I agree to Acme Events collecting my answers to Accessibility requirements for this event. These answers may include health, accessibility or another person's details. Only answer what you are comfortable sharing.",
    );
    fireEvent.submit(screen.getByRole('form', { name: 'Book tickets' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/confirm you agree/);
    expect(fn.mock.calls.some(c => String(c[0]).endsWith('/register'))).toBe(false);
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Complete registration' }));
    await screen.findByTestId('free-confirmation');
    const body = sent(fn, '/register');
    expect(body.sensitive_consent).toBe(true);
    expect(body.attendees[0].responses).toEqual([{ question_id: 'q-access', answer: 'Step-free access' }]);
    expect(body.order_responses).toEqual([{ question_id: 'q-hear', answer: 'Radio' }]);
  });

  it('clearing the sensitive answer removes the acknowledgement and it is not sent', async () => {
    const user = userEvent.setup(); const fn = mockFetch();
    view(detail({ questions: [Q.access] }));
    await start(user);
    await user.type(screen.getByLabelText('Accessibility requirements (optional)'), 'x');
    await user.click(within(screen.getByTestId('sensitive-consent')).getByRole('checkbox'));
    await user.clear(screen.getByLabelText('Accessibility requirements (optional)'));
    expect(screen.queryByTestId('sensitive-consent')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Complete registration' }));
    await screen.findByTestId('free-confirmation');
    expect(sent(fn, '/register')).not.toHaveProperty('sensitive_consent');
  });
});

describe('Riverlights-style set: free and paid flows submit every answer', () => {
  async function fillAll(user: ReturnType<typeof userEvent.setup>) {
    await start(user);
    await user.type(screen.getByLabelText('Emergency Contact Name'), 'Sam Contact');
    await user.type(screen.getByLabelText('Emergency Contact Phone Number'), '0400 000 000');
    await user.click(within(screen.getByRole('group', { name: Q.photo.label })).getByRole('radio', { name: 'Yes' }));
    await user.selectOptions(screen.getByLabelText('How did you hear about this event? (optional)'), 'Friend');
    await user.click(within(screen.getByRole('group', { name: 'Interests (optional)' })).getByRole('checkbox', { name: 'Art' }));
    await user.click(within(screen.getByRole('group', { name: Q.over18.label })).getByRole('radio', { name: 'Yes' }));
    await user.click(within(screen.getByTestId('sensitive-consent')).getByRole('checkbox'));
  }
  const EXPECTED_ORDER = [
    { question_id: 'q-ec-name', answer: 'Sam Contact' }, { question_id: 'q-ec-phone', answer: '0400 000 000' },
    { question_id: 'q-photo', answer: true }, { question_id: 'q-hear', answer: 'Friend' }, { question_id: 'q-int', answer: ['Art'] },
  ];

  it('free registration', async () => {
    const user = userEvent.setup(); const fn = mockFetch();
    view(detail({ questions: ALL }));
    await fillAll(user);
    await user.click(screen.getByRole('button', { name: 'Complete registration' }));
    await screen.findByTestId('free-confirmation');
    const body = sent(fn, '/register');
    expect(body.order_responses).toEqual(EXPECTED_ORDER);
    expect(body.attendees[0].responses).toEqual([{ question_id: 'q-18', answer: true }]);
    expect(body.sensitive_consent).toBe(true);
  });

  it('paid checkout (answers travel with the paid request, terms still required)', async () => {
    const user = userEvent.setup(); const fn = mockFetch();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    view(detail({ questions: ALL, ticket_types: [{ ...TYPE, price_cents: 8900 }] }));
    await fillAll(user);
    await user.click(screen.getByLabelText(/I agree to the Terms/));
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    const body = sent(fn, '/checkout');
    expect(body.order_responses).toEqual(EXPECTED_ORDER);
    expect(body.sensitive_consent).toBe(true);
    expect(body.accept_terms).toBe(true);
  });
});

describe('event with a required question that is not opted in on Eve', () => {
  it('shows a neutral message, offers nothing, posts nothing', async () => {
    const user = userEvent.setup(); const fn = mockFetch();
    const { container } = view(detail({ questions: [], questions_block_booking: true }));
    expect(screen.getByTestId('not-on-sale')).toHaveTextContent('Online registration isn’t available for this event.');
    expect(screen.getByRole('button', { name: 'More General' })).toBeDisabled();
    expect(screen.getByTestId('state-t1')).toHaveTextContent('40 remaining');
    expect(screen.queryByRole('button', { name: 'Complete registration' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More General' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Book tickets' }));
    expect(fn.mock.calls.some(c => /\/(register|checkout)$/.test(String(c[0])))).toBe(false);
    expect(container.textContent).not.toMatch(/sold out|error|question/i);
  });
});

describe('organiser: recorded answers', () => {
  it('renders answers as recorded (yes/no, lists) and labels sensitive ones; renders nothing when the API sent none', () => {
    const { container, rerender } = render(<RecordedAnswers answers={[
      { label: 'Consent to event photography/videography', field_type: 'YES_NO', help_text: null, answer: false, sensitive: false, sensitive_consent_at: null },
      { label: 'Interests', field_type: 'MULTI_SELECT', help_text: null, answer: ['Music', 'Art'], sensitive: false, sensitive_consent_at: null },
      { label: 'Accessibility requirements', field_type: 'LONG_TEXT', help_text: null, answer: 'Step-free access', sensitive: true, sensitive_consent_at: '2026-10-23T10:00:00Z' },
    ]} />);
    const dl = screen.getByTestId('recorded-answers');
    expect(dl).toHaveTextContent('Consent to event photography/videographyNo');
    expect(dl).toHaveTextContent('InterestsMusic, Art');
    expect(dl).toHaveTextContent('Accessibility requirementsSensitiveStep-free access');
    rerender(<RecordedAnswers answers={undefined} />);
    expect(container.innerHTML).toBe('');
  });
});
