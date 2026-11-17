import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StaffBookDialog from '@/app/scheduling/_components/StaffBookDialog';
import { expectNoAxeViolations } from '../../a11y/axe';

// Phase 2C.3c UI slice 1: the SELECTION half of the staff booking dialog (offering, date, engine start) against a stubbed fetch. Synthetic data only.
// Until the customer step, the dialog is READ ONLY: every test also checks that no request other than a GET was made. Slice 2 (customer, review, submit,
// recovery, confirmation) is tested in StaffBookDialogBooking.test.tsx.

const TODAY = '2027-01-11'; // a Monday
const BASIS = { offeringVersion: '4', resourceVersion: '6', offeringToken: '2027-01-01T00:00:00.000000Z', scheduleToken: '2026-12-01T00:00:00.000000Z' };
const day = (date: string, times: string[]) => ({ date, starts: times.map(time => ({ time, startsAt: new Date(Date.parse(`${date}T${time}:00Z`) - 10.5 * 3_600_000).toISOString() })) }); // Adelaide is UTC+10:30 in January
const basisFor = (from: string, offering = 'off-1', duration = 60) => ({
  basis: BASIS,
  offering: { id: offering, durationMinutes: duration, price: { amountCents: 5000, currency: 'AUD' } },
  resource: { id: 'court-1', capacity: 4 },
  timezone: 'Australia/Adelaide',
  range: { from, to: addDays(from, 13) },
  generatedAt: '2027-01-10T23:00:00Z',
  days: Array.from({ length: 14 }, (_, i) => {
    const date = addDays(from, i);
    return i === 0 ? day(date, ['09:00', '10:00', '11:00']) : i === 1 ? day(date, []) : i === 2 ? day(date, ['14:00']) : day(date, []);
  }),
});
function addDays(date: string, n: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;
let calls: Array<{ url: URL; method: string }> = [];
function stub(routes: Record<string, Route>) {
  calls = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push({ url, method: init?.method ?? 'GET' });
    const handler = routes[url.pathname];
    return handler ? handler(url, init) : Response.json({ error: 'not_found' }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const ok = (body: unknown) => () => Response.json(body);
const hireSchedule = { id: 'sch-1', presetKey: 'resource_hire', archivedAt: null };
const offering = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, durationMinutes: 60, price: { amountCents: 5000, currency: 'AUD' }, archivedAt: null, ...over });
const standard = (offerings = [offering('off-1', 'Court hire')], resourceActive = true): Record<string, Route> => ({
  '/api/scheduling/schedules': ok({ schedules: [hireSchedule, { id: 'sch-2', presetKey: 'classes_coaching', archivedAt: null }] }),
  '/api/scheduling/schedules/sch-1/offerings': ok({ offerings }),
  ...Object.fromEntries(offerings.map(o => [`/api/scheduling/offerings/${o.id}/resources`, ok({ resources: [{ id: 'court-1', active: resourceActive }, { id: 'other', active: true }] })])),
  '/api/scheduling/reservations/basis': url => Response.json(basisFor(url.searchParams.get('from') ?? TODAY, url.searchParams.get('offeringId') ?? 'off-1', url.searchParams.get('offeringId') === 'off-2' ? 90 : 60)),
});

function mount(props: Partial<React.ComponentProps<typeof StaffBookDialog>> = {}) {
  const onClose = vi.fn();
  const onUnavailable = vi.fn();
  const user = userEvent.setup();
  const view = render(<StaffBookDialog resourceId="court-1" resourceName="Court 1" today={TODAY} onClose={onClose} onUnavailable={onUnavailable} {...props} />);
  return { user, onClose, onUnavailable, ...view };
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const onlyGets = () => expect(calls.filter(c => c.method !== 'GET')).toEqual([]);

describe('the read-only flow', () => {
  it('loads the facility-hire offerings of THIS resource, then the basis, with no organisation in any request', async () => {
    stub(standard());
    mount();
    expect(await screen.findByText('Choose a date')).toBeInTheDocument();
    const paths = calls.map(c => c.url.pathname);
    expect(paths).toContain('/api/scheduling/schedules');
    expect(paths).toContain('/api/scheduling/schedules/sch-1/offerings');
    expect(paths).not.toContain('/api/scheduling/schedules/sch-2/offerings'); // only facility-hire schedules are walked
    const basis = calls.find(c => c.url.pathname === '/api/scheduling/reservations/basis')!;
    expect([...basis.url.searchParams.keys()].sort()).toEqual(['from', 'offeringId', 'resourceId', 'to']);
    expect(basis.url.searchParams.get('resourceId')).toBe('court-1');
    expect(basis.url.searchParams.get('from')).toBe(TODAY);
    expect(basis.url.searchParams.get('to')).toBe(addDays(TODAY, 13));
    expect(calls.every(c => !/organi[sz]ation/i.test(c.url.search))).toBe(true);
    onlyGets();
  });

  it('shows the configured duration and the pinned timezone, and offers ONLY the engine starts (no free time, duration or step control)', async () => {
    stub(standard());
    const { user } = mount();
    await screen.findByText('Choose a date');
    expect(screen.getByTestId('duration')).toHaveTextContent('1 hour');
    expect(screen.getByTestId('zone')).toHaveTextContent('Australia/Adelaide time');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(document.querySelectorAll('input:not([type=radio]), select, textarea')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Mon 11 Jan, 3 times' }));
    const group = await screen.findByRole('group', { name: /Start times, Australia\/Adelaide time/ });
    expect(within(group).getAllByRole('radio').map(r => (r as HTMLInputElement).value)).toEqual(['09:00', '10:00', '11:00']);
    expect(screen.queryByLabelText(/customer|name|email|phone|notes/i)).not.toBeInTheDocument();
  });

  it('days without times are announced "no times" and are aria-disabled but still focusable; choosing one does nothing', async () => {
    stub(standard());
    const { user } = mount();
    await screen.findByText('Choose a date');
    const empty = screen.getByRole('button', { name: 'Tue 12 Jan, no times' });
    expect(empty).toHaveAttribute('aria-disabled', 'true');
    expect(empty).not.toBeDisabled();
    expect(within(empty).getByText('No times')).toBeInTheDocument(); // text, not colour alone
    await user.click(empty);
    expect(screen.getByText('Choose a date')).toBeInTheDocument();
  });

  it('offers the next step only after a start is chosen, shows the end from the configured duration, and sends and stores nothing yet', async () => {
    stub(standard());
    const { user } = mount();
    await screen.findByText('Choose a date');
    await user.click(screen.getByRole('button', { name: 'Mon 11 Jan, 3 times' }));
    expect(screen.queryByRole('button', { name: 'Continue to customer details' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('radio', { name: '10:00' }));
    const prepared = await screen.findByTestId('prepared');
    expect(within(prepared).getByText('Ends').nextSibling).toHaveTextContent('11:00');
    expect(within(prepared).getByRole('button', { name: 'Continue to customer details' })).toBeEnabled();
    // Back and forth keeps working; nothing is stored, rendered or sent.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('radio', { name: '11:00' }));
    expect(JSON.stringify([...Object.entries(sessionStorage), ...Object.entries(localStorage)])).toBe('[]');
    expect(document.body.innerHTML).not.toMatch(/bk_[0-9a-f]{32}/);
    expect(calls.some(c => /bk_|idempotency/i.test(c.url.href))).toBe(false);
    onlyGets();
  });

  it('preselects the only offering and names it; with several it asks (a radio group), keyboard operable', async () => {
    stub(standard([offering('off-1', 'Court hire'), offering('off-2', 'Evening hire', { durationMinutes: 90 })]));
    const { user } = mount();
    const group = await screen.findByRole('group', { name: /Offering for Court 1/ });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    radios[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(radios[1]).toBeChecked();
    expect(screen.queryByText('Choose a date')).not.toBeInTheDocument(); // an arrow key SELECTS; it never moves on by itself
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Choose a date')).toBeInTheDocument();
    expect(screen.getByTestId('duration')).toHaveTextContent('90 minutes');
    expect(calls.find(c => c.url.pathname === '/api/scheduling/reservations/basis')!.url.searchParams.get('offeringId')).toBe('off-2');
  });

  it('moves the 14-day window with Earlier/Later (never before today) and discards the chosen day', async () => {
    stub(standard());
    const { user } = mount();
    await screen.findByText('Choose a date');
    expect(screen.getByRole('button', { name: 'Earlier dates' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Later dates' }));
    await waitFor(() => expect(calls.filter(c => c.url.pathname.endsWith('/basis')).at(-1)!.url.searchParams.get('from')).toBe(addDays(TODAY, 14)));
    await screen.findByRole('button', { name: /Mon 25 Jan, 3 times/ });
    expect(screen.getByRole('button', { name: 'Earlier dates' })).toBeEnabled();
  });
});

describe('loading, empty and error states', () => {
  it('shows a polite loading status first, then the content', async () => {
    stub(standard());
    mount();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    await screen.findByText('Choose a date');
  });

  it('explains when no active facility-hire offering links the resource, and offers no booking', async () => {
    stub(standard([offering('off-1', 'Court hire')], false));
    mount();
    expect(await screen.findByText('Nothing can be booked on this resource.')).toBeInTheDocument();
    expect(calls.some(c => c.url.pathname.endsWith('/basis'))).toBe(false);
  });

  it('says so when a window offers no times at all', async () => {
    stub({ ...standard(), '/api/scheduling/reservations/basis': url => Response.json({ ...basisFor(url.searchParams.get('from') ?? TODAY), days: basisFor(TODAY).days.map(d => ({ ...d, starts: [] })) }) });
    mount();
    expect(await screen.findByRole('note')).toHaveTextContent(/No times are offered in these 14 days/);
  });

  it.each([
    [422, 'RESOURCE_NOT_ELIGIBLE', /not assigned to that offering/],
    [409, 'RESOURCE_INACTIVE', /inactive/],
    [422, 'AVAILABILITY_UNREADABLE', /hours for this resource cannot be read/],
    [503, 'BOOKING_NOT_READY', /not available right now/],
  ])('a %s %s refusal is shown with fixed wording as an alert (never server text)', async (status, code, text) => {
    stub({ ...standard(), '/api/scheduling/reservations/basis': () => Response.json({ error: 'SERVER SECRET WORDING', code }, { status }) });
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(text);
    expect(alert).not.toHaveTextContent(/SECRET/);
  });

  it('a server fault offers "Try again", which re-reads (a read: always safe)', async () => {
    let n = 0;
    stub({ ...standard(), '/api/scheduling/reservations/basis': url => (++n === 1 ? Response.json({}, { status: 500 }) : Response.json(basisFor(url.searchParams.get('from') ?? TODAY))) });
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Choose a date')).toBeInTheDocument();
    onlyGets();
  });

  it('a 404 without a code (a gate closed under the user) closes the dialog path: onUnavailable fires and no retry is offered', async () => {
    stub({ ...standard(), '/api/scheduling/reservations/basis': () => Response.json({ error: 'not_found' }, { status: 404 }) });
    const { onUnavailable } = mount();
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('a 403 and a 401 are explained and not retried', async () => {
    stub({ ...standard(), '/api/scheduling/reservations/basis': () => Response.json({ error: 'forbidden' }, { status: 403 }) });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not have permission/);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('keyboard, focus and accessibility', () => {
  it('has a labelled modal dialog, Escape closes it, and the whole path works from the keyboard', async () => {
    stub(standard());
    const { user, onClose } = mount();
    const dialog = await screen.findByRole('dialog', { name: 'Book Court 1' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await screen.findByText('Choose a date');
    const dayButton = screen.getByRole('button', { name: 'Mon 11 Jan, 3 times' });
    dayButton.focus();
    await user.keyboard('{Enter}');
    const radios = await screen.findAllByRole('radio');
    radios[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(radios[1]).toBeChecked();
    expect(await screen.findByTestId('prepared')).toBeInTheDocument();
    // the group is still there and still has focus: more arrow presses keep choosing a time without losing the place
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(radios[1]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(radios[2]).toBeChecked();
    expect(radios[2]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the new step heading when the step changes', async () => {
    stub(standard());
    const { user } = mount();
    await screen.findByText('Choose a date');
    await user.click(screen.getByRole('button', { name: 'Mon 11 Jan, 3 times' }));
    const heading = await screen.findByRole('heading', { name: /Choose a start time/ });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('has no axe violations on the date, time and ready steps and the error and empty states', async () => {
    stub(standard());
    const { user, container } = mount();
    await screen.findByText('Choose a date');
    await expectNoAxeViolations(document.body);
    await user.click(screen.getByRole('button', { name: 'Mon 11 Jan, 3 times' }));
    await screen.findByRole('radio', { name: '10:00' });
    await expectNoAxeViolations(document.body);
    await user.click(screen.getByRole('radio', { name: '10:00' }));
    await screen.findByTestId('prepared');
    await expectNoAxeViolations(document.body);
    cleanup();
    stub({ ...standard(), '/api/scheduling/reservations/basis': () => Response.json({ code: 'RESOURCE_INACTIVE' }, { status: 409 }) });
    mount();
    await screen.findByRole('alert');
    await expectNoAxeViolations(document.body);
    cleanup();
    stub(standard([offering('off-1', 'Court hire')], false));
    mount();
    await screen.findByText('Nothing can be booked on this resource.');
    await expectNoAxeViolations(document.body);
    void container;
  });
});
