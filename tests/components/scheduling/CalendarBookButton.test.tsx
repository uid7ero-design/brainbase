import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CalendarScreen from '@/app/scheduling/_components/CalendarScreen';

// Phase 2C.3c UI slice 1: the Book button on the RESOURCE calendar. The server decides `canBook` (default false); these tests prove what the screen
// does with it. With it false (switch off, capability missing or no scheduling.reserve) the button does not exist, the dialog does not render and
// NO booking-related request is made - not at load, not on any interaction. The calendar data itself is the existing read-only calendar API.

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('date=2027-01-11') }));

const resourceView = (active = true) => ({
  resource: { id: 'court-1', name: 'Court 1', kind: 'court', active },
  timezone: 'Australia/Adelaide',
  zone: { value: 'Australia/Adelaide', pinned: true, source: 'first_rule' },
  ok: true,
  fromDate: '2027-01-11',
  toDate: '2027-01-11',
  lanes: [{ kind: 'resource', id: 'court-1', name: 'Court 1', timezone: 'Australia/Adelaide', pinned: true, state: 'open', hours: [], closed: [], free: [], occupied: [] }],
  days: [{ date: '2027-01-11', dayOfWeek: 1, startsAt: '2027-01-10T13:30:00Z', endsAt: '2027-01-11T13:30:00Z', minutes: 1440, offsetMinutes: 630, ticks: [] }],
  reasons: [],
  adjustments: [],
  slot: null,
  slots: [],
});

let requests: Array<{ path: string; method: string }> = [];
function stub(opts: { active?: boolean; basis?: () => Response } = {}) {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      requests.push({ path: url.pathname + url.search, method: init?.method ?? 'GET' });
      if (url.pathname === '/api/scheduling/resources/court-1/calendar') return Response.json(resourceView(opts.active ?? true));
      if (url.pathname === '/api/scheduling/schedules') return Response.json({ schedules: [{ id: 's', presetKey: 'resource_hire', archivedAt: null }] });
      if (url.pathname === '/api/scheduling/schedules/s/offerings') return Response.json({ offerings: [{ id: 'o', name: 'Court hire', durationMinutes: 60, price: { amountCents: 5000, currency: 'AUD' }, archivedAt: null }] });
      if (url.pathname === '/api/scheduling/offerings/o/resources') return Response.json({ resources: [{ id: 'court-1', active: true }] });
      if (url.pathname === '/api/scheduling/reservations/basis') {
        if (opts.basis) return opts.basis();
        return Response.json({
          basis: { offeringVersion: '1', resourceVersion: '1', offeringToken: 'a', scheduleToken: 'b' },
          offering: { id: 'o', durationMinutes: 60, price: null },
          resource: { id: 'court-1', capacity: 4 },
          timezone: 'Australia/Adelaide',
          range: { from: '2027-01-11', to: '2027-01-24' },
          generatedAt: '2027-01-10T00:00:00Z',
          days: Array.from({ length: 14 }, (_, i) => ({ date: new Date(Date.parse('2027-01-11T12:00:00Z') + i * 86_400_000).toISOString().slice(0, 10), starts: i === 0 ? [{ time: '09:00', startsAt: '2027-01-10T22:30:00Z' }] : [] })),
        });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }),
  );
}
const bookingCalls = () => requests.filter(r => /\/reservations|\/api\/scheduling\/schedules|\/offerings\/[^/?]+\/resources/.test(r.path));

function open(props: { kind?: 'resource' | 'offering'; canBook?: boolean | undefined; recoverySecret?: string | null } = {}) {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const element =
    props.canBook === undefined
      ? <CalendarScreen kind={props.kind ?? 'resource'} id="court-1" canManage organisationTimezone="Australia/Adelaide" />
      : <CalendarScreen kind={props.kind ?? 'resource'} id="court-1" canManage canBook={props.canBook} recoverySecret={props.recoverySecret === undefined ? "rs_test_secret_0123456789012345678901234567" : props.recoverySecret} organisationTimezone="Australia/Adelaide" />;
  return render(element);
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('switch off / not allowed: canBook is false (the default)', () => {
  it.each([[false], [undefined]])('canBook=%s: no Book button, no dialog, and no booking-related request at load or on interaction', async canBook => {
    stub();
    const user = userEvent.setup();
    open({ canBook });
    await screen.findByTestId('calendar-screen');
    expect(screen.queryByTestId('book-button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^book/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/Book Court 1/)).not.toBeInTheDocument();
    // interact with what IS there; nothing may start a booking read
    await user.tab();
    await user.keyboard('{Enter}').catch(() => undefined);
    expect(bookingCalls()).toEqual([]);
    expect(requests.every(r => r.method === 'GET' && /\/api\/scheduling\/resources\/court-1\/calendar/.test(r.path))).toBe(true);
  });

  it('canBook=true on an OFFERING calendar still shows nothing (slice 1 is the resource calendar only)', async () => {
    stub();
    open({ kind: 'offering', canBook: true });
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByTestId('book-button')).not.toBeInTheDocument();
    expect(bookingCalls()).toEqual([]);
  });

  it('canBook=true but the resource is inactive: no button', async () => {
    stub({ active: false });
    open({ canBook: true });
    await screen.findByTestId('calendar-screen');
    expect(screen.queryByTestId('book-button')).not.toBeInTheDocument();
    expect(bookingCalls()).toEqual([]);
  });
});

describe('allowed: canBook is true on the resource calendar', () => {
  it('shows the Book button, and makes NO booking request until it is pressed', async () => {
    stub();
    open({ canBook: true });
    const button = await screen.findByTestId('book-button');
    expect(button).toHaveAccessibleName('Book');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bookingCalls()).toEqual([]);
  });

  it('opens the dialog, reads only (GET), and restores focus to the Book button on Close and on Escape', async () => {
    stub();
    const user = userEvent.setup();
    open({ canBook: true });
    const button = await screen.findByTestId('book-button');
    button.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Book Court 1' });
    expect(dialog).toBeInTheDocument();
    await screen.findByText('Choose a date');
    expect(bookingCalls().length).toBeGreaterThan(0);
    expect(requests.every(r => r.method === 'GET')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Close', hidden: false }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button).toHaveFocus();

    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Book Court 1' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button).toHaveFocus();
  });

  it('a gate closing under the user (404 without a code) closes the dialog and removes the button until reload', async () => {
    stub({ basis: () => Response.json({ error: 'not_found' }, { status: 404 }) });
    const user = userEvent.setup();
    open({ canBook: true });
    await user.click(await screen.findByTestId('book-button'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByTestId('book-button')).not.toBeInTheDocument();
  });

  it('never sends a request that creates, changes or cancels anything', async () => {
    stub();
    const user = userEvent.setup();
    open({ canBook: true });
    await user.click(await screen.findByTestId('book-button'));
    await screen.findByText('Choose a date');
    await user.click(await screen.findByRole('button', { name: /Mon 11 Jan, 1 time/ }));
    await user.click(await screen.findByRole('radio', { name: '09:00' }));
    await screen.findByTestId('prepared');
    expect(requests.filter(r => r.method !== 'GET')).toEqual([]);
    expect(requests.some(r => /idempotency|bk_/i.test(r.path))).toBe(false);
  });
});
