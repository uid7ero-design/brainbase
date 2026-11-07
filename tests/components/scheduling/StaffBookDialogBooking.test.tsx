import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StaffBookDialog from '@/app/scheduling/_components/StaffBookDialog';
import { expectNoAxeViolations } from '../../a11y/axe';

// Phase 2C.3c UI slice 2: customer details, review, submit, recovery and confirmation, against a stubbed fetch. Synthetic data only.

const TODAY = '2027-01-11'; // a Monday
const RES_ID = 'res_0123456789abcdef0123456789abcdef0123';
const BASIS = { offeringVersion: '4', resourceVersion: '6', offeringToken: '2027-01-01T00:00:00.000000Z', scheduleToken: '2026-12-01T00:00:00.000000Z' };
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const day = (date: string, times: string[]) => ({ date, starts: times.map(time => ({ time, startsAt: new Date(Date.parse(`${date}T${time}:00Z`) - 10.5 * 3_600_000).toISOString() })) });
let todayTimes = ['09:00', '10:00', '11:00'];
const basisFor = (from: string) => ({
  basis: BASIS,
  offering: { id: 'off-1', durationMinutes: 60, price: { amountCents: 5000, currency: 'AUD' } },
  resource: { id: 'court-1', capacity: 4 },
  timezone: 'Australia/Adelaide',
  range: { from, to: addDays(from, 13) },
  generatedAt: '2027-01-10T23:00:00Z',
  days: Array.from({ length: 14 }, (_, i) => day(addDays(from, i), i === 0 ? todayTimes : [])),
});
const reservation = (over: Record<string, unknown> = {}) => ({
  id: RES_ID,
  status: 'confirmed',
  offeringId: 'off-1',
  resourceId: 'court-1',
  timezone: 'Australia/Adelaide',
  start: { date: TODAY, time: '10:00' },
  durationMinutes: 60,
  startsAt: day(TODAY, ['10:00']).starts[0].startsAt,
  endsAt: day(TODAY, ['11:00']).starts[0].startsAt,
  partySize: 2,
  customer: { name: 'Pat Customer', email: 'pat@example.test', phone: '0400 000 000' },
  notes: 'Bring a ball hopper',
  price: { amountCents: 5000, currency: 'AUD' },
  paymentStatus: 'unpaid',
  ...over,
});

type Call = { url: URL; method: string; headers: Headers; body: unknown };
let calls: Call[] = [];
type Reply = Response | Promise<Response> | (() => Response | Promise<Response>);
let posts: Reply[] = [];
let lookups: Reply[] = [];
const resolve = (r: Reply | undefined): Promise<Response> => Promise.resolve(typeof r === 'function' ? r() : (r ?? Response.json({ error: 'not_found' }, { status: 404 })));
function stub() {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';
      calls.push({ url, method, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (url.pathname === '/api/scheduling/schedules') return Response.json({ schedules: [{ id: 'sch-1', presetKey: 'resource_hire', archivedAt: null }] });
      if (url.pathname === '/api/scheduling/schedules/sch-1/offerings') return Response.json({ offerings: [{ id: 'off-1', name: 'Court hire', durationMinutes: 60, price: { amountCents: 5000, currency: 'AUD' }, archivedAt: null }] });
      if (url.pathname === '/api/scheduling/offerings/off-1/resources') return Response.json({ resources: [{ id: 'court-1', active: true }] });
      if (url.pathname === '/api/scheduling/reservations/basis') return Response.json(basisFor(url.searchParams.get('from') ?? TODAY));
      if (url.pathname === '/api/scheduling/reservations' && method === 'POST') return resolve(posts.length > 1 ? posts.shift() : posts[0]);
      if (url.pathname === '/api/scheduling/reservations' && method === 'GET') return resolve(lookups.length > 1 ? lookups.shift() : lookups[0]);
      return Response.json({ error: 'not_found' }, { status: 404 });
    }),
  );
}
const created = (over: Record<string, unknown> = {}) => () => Response.json({ reservation: reservation(over), replayed: false }, { status: 201 });
const refusal = (status: number, code: string, extra: Record<string, unknown> = {}) => () => Response.json({ error: 'SERVER WORDING MUST NOT SHOW', code, ...extra }, { status });
const postCalls = () => calls.filter(c => c.method === 'POST');
const bookingKeys = () => postCalls().map(c => c.headers.get('idempotency-key'));

function mount(props: Partial<React.ComponentProps<typeof StaffBookDialog>> = {}) {
  const onClose = vi.fn();
  const onBooked = vi.fn();
  const onUnavailable = vi.fn();
  const user = userEvent.setup();
  render(<StaffBookDialog resourceId="court-1" resourceName="Court 1" today={TODAY} onClose={onClose} onBooked={onBooked} onUnavailable={onUnavailable} {...props} />);
  return { user, onClose, onBooked, onUnavailable };
}
type U = ReturnType<typeof userEvent.setup>;

async function chooseTime(user: U, time = '10:00') {
  await screen.findByText('Choose a date');
  await user.click(screen.getByRole('button', { name: /Mon 11 Jan, \d times/ }));
  await user.click(await screen.findByRole('radio', { name: time }));
}
async function toDetails(user: U, time = '10:00') {
  await chooseTime(user, time);
  await user.click(screen.getByRole('button', { name: 'Continue to customer details' }));
  await screen.findByRole('heading', { name: 'Customer details' });
}
async function fillDetails(user: U, over: { name?: string; email?: string; phone?: string; party?: string; notes?: string } = {}) {
  const v = { name: 'Pat Customer', email: 'pat@example.test', phone: '0400 000 000', party: '2', notes: 'Bring a ball hopper', ...over };
  const set = async (label: string | RegExp, value: string) => {
    const el = screen.getByLabelText(label);
    await user.clear(el);
    if (value) await user.type(el, value);
  };
  await set(/Customer name/, v.name);
  await set(/Customer email/, v.email);
  await set(/Customer phone/, v.phone);
  await set(/Party size/, v.party);
  await set(/Notes/, v.notes);
}
async function toReview(user: U, time = '10:00') {
  await toDetails(user, time);
  await fillDetails(user);
  await user.click(screen.getByRole('button', { name: 'Review booking' }));
  await screen.findByRole('heading', { name: 'Review the booking' });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  todayTimes = ['09:00', '10:00', '11:00'];
  posts = [created()];
  lookups = [];
  stub();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('customer details', () => {
  it('opens after a start is chosen, with labelled fields, autocomplete off everywhere and no staff-member data', async () => {
    const { user } = mount();
    await toDetails(user);
    const form = document.getElementById('sb-details-form')!;
    expect(form).toHaveAttribute('autocomplete', 'off');
    for (const el of form.querySelectorAll('input, textarea')) expect(el).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText(/Customer name/)).toHaveValue('');
    expect(screen.getByLabelText(/Customer email/)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(/Customer phone/)).toHaveAttribute('type', 'tel');
    expect(screen.getByLabelText(/Party size/)).toHaveValue('1');
    expect(screen.getByText(/Up to 4 for Court 1/)).toBeInTheDocument();
    expect(screen.getByText(/Enter the customer’s details, not your own/)).toBeInTheDocument();
    expect(postCalls()).toHaveLength(0);
  });

  it('refuses an empty name and an over-capacity party with an error summary that takes focus, links to the fields and echoes no value', async () => {
    const { user } = mount();
    await toDetails(user);
    await user.clear(screen.getByLabelText(/Party size/));
    await user.type(screen.getByLabelText(/Party size/), '9');
    await user.type(screen.getByLabelText(/Customer email/), 'SECRET-not-an-email');
    await user.click(screen.getByRole('button', { name: 'Review booking' }));
    const summary = await screen.findByTestId('error-summary');
    expect(summary).toHaveAttribute('role', 'alert');
    expect(summary).toHaveFocus();
    expect(summary).toHaveTextContent('There are 3 problems to fix.');
    expect(summary).not.toHaveTextContent(/SECRET/);
    expect(screen.getByLabelText(/Customer name/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Party size/)).toHaveAttribute('aria-describedby', expect.stringContaining('error'));
    await user.click(within(summary).getByRole('link', { name: /Name:/ }));
    expect(screen.getByLabelText(/Customer name/)).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Customer details' })).toBeInTheDocument(); // still here: nothing advanced
    expect(postCalls()).toHaveLength(0);
  });

  it('keeps nothing in storage, the URL or the page outside the form', async () => {
    const { user } = mount();
    await toReview(user);
    expect(JSON.stringify([...Object.entries(sessionStorage), ...Object.entries(localStorage)])).toBe('[]');
    expect(document.cookie).toBe('');
    expect(calls.every(c => !/pat@example|0400|Customer/i.test(c.url.href))).toBe(true);
  });
});

describe('review', () => {
  it('summarises everything, states that no payment is collected, and sends nothing yet', async () => {
    const { user } = mount();
    await toReview(user);
    const s = screen.getByTestId('review-summary');
    const text = s.textContent ?? '';
    for (const part of ['Court hire', 'Court 1', 'Monday 11 January 2027', '10:00', '11:00', '1 hour', 'Australia/Adelaide time', 'Pat Customer', 'pat@example.test', '0400 000 000', 'Bring a ball hopper', '50.00']) expect(text).toContain(part);
    expect(within(s).getByText('Party size').nextSibling).toHaveTextContent('2');
    expect(screen.getByText(/No payment is collected through this window/)).toBeInTheDocument();
    expect(screen.queryByText(/card|pay now|stripe/i)).not.toBeInTheDocument();
    expect(postCalls()).toHaveLength(0);
  });
});

describe('submit', () => {
  it('POSTs the engine start, the configured duration, the basis and one stable key, then shows the full reference, Copy and the summary', async () => {
    const { user, onBooked, onClose } = mount();
    await toReview(user);
    await user.click(screen.getByTestId('confirm-booking'));
    const confirmation = await screen.findByTestId('confirmation');
    expect(postCalls()).toHaveLength(1);
    const post = postCalls()[0];
    expect(post.headers.get('idempotency-key')).toMatch(/^bk_[0-9a-f]{32}$/);
    expect(post.headers.get('content-type')).toBe('application/json');
    expect(post.body).toEqual({
      offeringId: 'off-1',
      resourceId: 'court-1',
      start: { date: TODAY, time: '10:00' },
      durationMinutes: 60,
      partySize: 2,
      customer: { name: 'Pat Customer', email: 'pat@example.test', phone: '0400 000 000' },
      notes: 'Bring a ball hopper',
      basis: BASIS,
    });
    expect(post.url.search).toBe('');
    // The Booked state
    const heading = within(confirmation).getByRole('heading', { name: 'Booked' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByTestId('reservation-id')).toHaveValue(RES_ID); // the FULL id, not shortened
    expect(screen.getByTestId('reservation-id')).toHaveAttribute('readonly');
    const summary = screen.getByTestId('confirmation-summary').textContent ?? '';
    for (const part of ['Court 1', 'Monday 11 January 2027', '10:00', '11:00', 'Pat Customer', 'pat@example.test', '50.00']) expect(summary).toContain(part);
    expect(screen.getByTestId('booking-live')).toHaveTextContent(/Booked\. The booking reference is shown below/);
    expect(screen.getByText(/No payment was collected/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pay|charge/i })).not.toBeInTheDocument();
    expect(onBooked).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('booking-done'));
    expect(onBooked).toHaveBeenCalledTimes(1); // the calendar re-reads
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...Object.entries(sessionStorage), ...Object.entries(localStorage)])).toBe('[]');
  });

  it('Copy reference puts the full id on the clipboard and announces it; a blocked clipboard selects the field and says so', async () => {
    const { user } = mount();
    await toReview(user);
    await user.click(screen.getByTestId('confirm-booking'));
    await screen.findByTestId('confirmation');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByTestId('copy-reference'));
    expect(writeText).toHaveBeenCalledWith(RES_ID);
    expect(await screen.findByText('Reference copied.')).toBeInTheDocument();
    expect(screen.getByTestId('copy-status')).toHaveAttribute('role', 'status');
    writeText.mockRejectedValue(new Error('denied'));
    await user.click(screen.getByTestId('copy-reference'));
    expect(await screen.findByText(/Copying was blocked/)).toBeInTheDocument();
    expect(screen.getByTestId('reservation-id')).toHaveFocus();
  });

  it('a double submission sends ONE request: the button is disabled and busy, and Escape cannot close the window while it runs', async () => {
    let release!: () => void;
    posts = [() => new Promise<Response>(r => { release = () => r(Response.json({ reservation: reservation(), replayed: false }, { status: 201 })); }) as unknown as Response];
    const { user, onClose } = mount();
    await toReview(user);
    const confirm = screen.getByTestId('confirm-booking');
    await user.dblClick(confirm);
    await user.click(confirm).catch(() => undefined);
    const busy = await screen.findByRole('button', { name: 'Booking…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('booking-live')).toHaveTextContent(/Please wait/);
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(postCalls()).toHaveLength(1);
    await act(async () => release());
    await screen.findByTestId('confirmation');
    expect(postCalls()).toHaveLength(1);
  });

  it.each([
    ['AVAILABILITY_CHANGED', 409, /available times changed/i],
    ['RESOURCE_CONFLICT', 409, /just taken/i],
  ])('%s: nothing was booked, the basis is re-read, the customer details are kept and the user is returned to time selection', async (code, status, wording) => {
    posts = [refusal(status, code)];
    const { user } = mount();
    await toReview(user);
    const basisBefore = calls.filter(c => c.url.pathname.endsWith('/basis')).length;
    await user.click(screen.getByTestId('confirm-booking'));
    const heading = await screen.findByRole('heading', { name: /Choose a start time/ });
    await waitFor(() => expect(heading).toHaveFocus());
    const live = screen.getByTestId('booking-live');
    expect(live).toHaveTextContent(wording);
    expect(live).toHaveTextContent(/Nothing was booked|just taken/);
    expect(live).not.toHaveTextContent(/SERVER WORDING/);
    await waitFor(() => expect(calls.filter(c => c.url.pathname.endsWith('/basis')).length).toBe(basisBefore + 1));
    expect(screen.queryByTestId('confirmation')).not.toBeInTheDocument();
    // the staff member picks a time again and the details they typed are still there
    await user.click(await screen.findByRole('radio', { name: '11:00' }));
    await user.click(screen.getByRole('button', { name: 'Continue to customer details' }));
    expect(screen.getByLabelText(/Customer name/)).toHaveValue('Pat Customer');
    expect(screen.getByLabelText(/Customer email/)).toHaveValue('pat@example.test');
    expect(screen.getByLabelText(/Party size/)).toHaveValue('2');
    expect(screen.getByLabelText(/Notes/)).toHaveValue('Bring a ball hopper');
  });

  it('AVAILABILITY_CHANGED preselects the previous time only if the fresh read still offers it', async () => {
    posts = [refusal(409, 'AVAILABILITY_CHANGED')];
    const first = mount();
    await toReview(first.user);
    await first.user.click(screen.getByTestId('confirm-booking'));
    expect(await screen.findByRole('radio', { name: '10:00' })).toBeChecked(); // still offered: preselected
    cleanup();

    posts = [refusal(409, 'AVAILABILITY_CHANGED')];
    todayTimes = ['09:00', '10:00', '11:00'];
    const second = mount();
    await toReview(second.user);
    todayTimes = ['09:00', '11:00']; // 10:00 vanished in the meantime
    await second.user.click(screen.getByTestId('confirm-booking'));
    await screen.findByRole('radio', { name: '11:00' });
    expect(screen.queryByRole('radio', { name: '10:00' })).not.toBeInTheDocument();
    for (const r of screen.getAllByRole('radio')) expect(r).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Continue to customer details' })).not.toBeInTheDocument();
  });

  it('CONTENTION_TIMEOUT offers a safe retry with the SAME key and the same body', async () => {
    posts = [refusal(503, 'CONTENTION_TIMEOUT'), created()];
    const { user } = mount();
    await toReview(user);
    await user.click(screen.getByTestId('confirm-booking'));
    expect(await screen.findByText('Nothing was booked.')).toBeInTheDocument();
    await user.click(screen.getByTestId('retry-booking'));
    await screen.findByTestId('confirmation');
    expect(postCalls()).toHaveLength(2);
    expect(bookingKeys()[0]).toBe(bookingKeys()[1]);
    expect(postCalls()[0].body).toEqual(postCalls()[1].body);
  });

  it('IDEMPOTENCY_CONFLICT shows what exists, books nothing and starts a new booking only on request', async () => {
    posts = [refusal(409, 'IDEMPOTENCY_CONFLICT')];
    lookups = [() => Response.json({ reservation: reservation({ id: 'res_other', customer: { name: 'Someone Else', email: null, phone: null } }) })];
    const { user } = mount();
    await toReview(user);
    await user.click(screen.getByTestId('confirm-booking'));
    expect(await screen.findByRole('heading', { name: 'This reference is already used' })).toBeInTheDocument();
    expect(await screen.findByTestId('conflict-summary')).toHaveTextContent('Someone Else');
    expect(screen.queryByTestId('retry-booking')).not.toBeInTheDocument();
    expect(postCalls()).toHaveLength(1);
    const firstKey = bookingKeys()[0];
    await user.click(screen.getByTestId('new-attempt'));
    await user.click(await screen.findByRole('radio', { name: '10:00' }));
    await user.click(screen.getByRole('button', { name: 'Continue to customer details' }));
    await user.click(screen.getByRole('button', { name: 'Review booking' }));
    posts = [created()];
    await user.click(await screen.findByTestId('confirm-booking'));
    await screen.findByTestId('confirmation');
    expect(bookingKeys()[1]).not.toBe(firstKey);
  });

  it('a 404 without a code (a gate closed under the user) says nothing was booked and hides the button', async () => {
    posts = [() => Response.json({ error: 'not_found' }, { status: 404 })];
    const { user, onUnavailable } = mount();
    await toReview(user);
    await user.click(screen.getByTestId('confirm-booking'));
    expect(await screen.findByRole('heading', { name: 'Booking is not available' })).toBeInTheDocument();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(postCalls()).toHaveLength(1);
  });

  it('server validation names the field and returns to the form with the details kept', async () => {
    posts = [refusal(400, 'VALIDATION', { problems: ['customer.email'] })];
    const { user } = mount();
    await toReview(user);
    await user.click(screen.getByTestId('confirm-booking'));
    const summary = await screen.findByTestId('error-summary');
    expect(summary).toHaveTextContent(/Email:/);
    expect(summary).not.toHaveTextContent(/SERVER WORDING/);
    expect(screen.getByLabelText(/Customer name/)).toHaveValue('Pat Customer');
  });
});

describe('uncertain outcomes', () => {
  it.each([
    ['OUTCOME_UNKNOWN 504', () => Response.json({ error: 'x', code: 'OUTCOME_UNKNOWN', retryable: true }, { status: 504 })],
    ['a bare 500', () => Response.json({}, { status: 500 })],
    ['an HTML 502', () => new Response('<html>Bad gateway</html>', { status: 502 })],
    ['a network error', () => { throw new TypeError('network'); }],
  ])('%s shows "Checking whether your booking was saved", never a failure, and recovers the booking by the ORIGINAL key', async (_name, reply) => {
    posts = [reply as Reply];
    lookups = [() => Response.json({ reservation: reservation() })];
    const { user, onBooked } = mount();
    await toReview(user);
    await user.click(screen.getByTestId('confirm-booking'));
    expect(await screen.findByRole('heading', { name: 'Checking whether your booking was saved' })).toBeInTheDocument();
    expect(screen.getByTestId('booking-live')).toHaveTextContent(/Do not book again/);
    expect(screen.queryByText(/failed|could not be booked|not booked/i)).not.toBeInTheDocument();
    const confirmation = await screen.findByTestId('confirmation', undefined, { timeout: 3000 }); // recovered: the SAME confirmation
    expect(within(confirmation).getByRole('heading', { name: 'Booked' })).toBeInTheDocument();
    expect(screen.getByTestId('reservation-id')).toHaveValue(RES_ID);
    expect(postCalls()).toHaveLength(1); // no second POST
    const lookup = calls.find(c => c.method === 'GET' && c.url.pathname === '/api/scheduling/reservations')!;
    expect(lookup.url.searchParams.get('idempotencyKey')).toBe(bookingKeys()[0]);
    expect([...lookup.url.searchParams.keys()]).toEqual(['idempotencyKey']);
    await user.click(screen.getByTestId('booking-done'));
    expect(onBooked).toHaveBeenCalledTimes(1);
  });

  it('cannot be closed or edited while checking; after the bounded lookups only a same-key retry is offered, and it books exactly once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    posts = [refusal(504, 'OUTCOME_UNKNOWN'), created()];
    lookups = [() => Response.json({ error: 'not_found' }, { status: 404 })];
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onBooked = vi.fn();
    render(<StaffBookDialog resourceId="court-1" resourceName="Court 1" today={TODAY} onClose={onClose} onBooked={onBooked} onUnavailable={vi.fn()} />);
    await toReview(user);
    await user.click(screen.getByTestId('confirm-booking'));
    await screen.findByRole('heading', { name: 'Checking whether your booking was saved' });
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm booking|Review booking|Back/ })).not.toBeInTheDocument();
    for (const ms of [500, 1500, 3000, 6000]) await act(async () => { await vi.advanceTimersByTimeAsync(ms + 50); });
    expect(await screen.findByRole('heading', { name: /could not confirm whether the booking was saved/ })).toBeInTheDocument();
    expect(calls.filter(c => c.method === 'GET' && c.url.pathname === '/api/scheduling/reservations')).toHaveLength(4);
    expect(postCalls()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /start over|new booking/i })).not.toBeInTheDocument();
    await user.click(screen.getByTestId('retry-booking'));
    await screen.findByTestId('confirmation');
    expect(postCalls()).toHaveLength(2);
    expect(bookingKeys()[0]).toBe(bookingKeys()[1]);
    expect(postCalls()[0].body).toEqual(postCalls()[1].body);
    expect(new Set(bookingKeys()).size).toBe(1);
  });

  it('closing from the "could not confirm" state is allowed, warns, and tells the calendar to re-read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    posts = [refusal(504, 'OUTCOME_UNKNOWN')];
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onClose = vi.fn();
    const onBooked = vi.fn();
    render(<StaffBookDialog resourceId="court-1" resourceName="Court 1" today={TODAY} onClose={onClose} onBooked={onBooked} onUnavailable={vi.fn()} />);
    await toReview(user);
    await user.click(screen.getByTestId('confirm-booking'));
    for (const ms of [500, 1500, 3000, 6000]) await act(async () => { await vi.advanceTimersByTimeAsync(ms + 50); });
    expect(await screen.findByText(/look in the calendar before booking again/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onBooked).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('closing and focus', () => {
  it('Close before confirming books nothing and does not refresh the calendar', async () => {
    const { user, onClose, onBooked } = mount();
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onBooked).not.toHaveBeenCalled();
    expect(postCalls()).toHaveLength(0);
  });

  it('the whole booking works from the keyboard and the focus trap holds', async () => {
    const { user } = mount();
    await screen.findByText('Choose a date');
    screen.getByRole('button', { name: 'Mon 11 Jan, 3 times' }).focus();
    await user.keyboard('{Enter}');
    const radios = await screen.findAllByRole('radio');
    radios[1].focus();
    await user.keyboard(' ');
    await user.tab(); // to Continue
    expect(screen.getByRole('button', { name: 'Continue to customer details' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Customer details' })).toHaveFocus());
    await user.tab();
    expect(screen.getByLabelText(/Customer name/)).toHaveFocus();
    await user.keyboard('Pat');
    for (let i = 0; i < 6; i += 1) await user.tab(); // email, phone, party size, notes, Back, then "Review booking"
    expect(screen.getByRole('button', { name: 'Review booking' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Review the booking' })).toHaveFocus());
    await user.keyboard('{Tab}{Tab}{Tab}'); // Back, Confirm, Close, then wraps inside the dialog
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('accessibility', () => {
  it('has no axe violations on the details (with errors), review, checking and booked states', async () => {
    const { user } = mount();
    await toDetails(user);
    await expectNoAxeViolations(document.body);
    await user.click(screen.getByRole('button', { name: 'Review booking' }));
    await screen.findByTestId('error-summary');
    await expectNoAxeViolations(document.body);
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Review booking' }));
    await screen.findByTestId('review-summary');
    await expectNoAxeViolations(document.body);
    await user.click(screen.getByTestId('confirm-booking'));
    await screen.findByTestId('confirmation');
    await expectNoAxeViolations(document.body);
    cleanup();

    posts = [refusal(504, 'OUTCOME_UNKNOWN')];
    lookups = [() => Response.json({ error: 'not_found' }, { status: 404 })];
    const second = mount();
    await toReview(second.user);
    await second.user.click(screen.getByTestId('confirm-booking'));
    await screen.findByRole('heading', { name: 'Checking whether your booking was saved' });
    await expectNoAxeViolations(document.body);
  });
});
