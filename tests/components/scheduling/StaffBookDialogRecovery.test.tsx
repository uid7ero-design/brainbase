import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StaffBookDialog from '@/app/scheduling/_components/StaffBookDialog';

// Phase 2C.3c RELOAD-RECOVERY: FAILING-FIRST regression tests (design PR). Synthetic data only.
// Each test is registered with recovery(...): while the fix is not implemented it is it.fails (the suite stays green and the test is PROVEN to fail today);
// with RECOVERY_IMPLEMENTED=1 it is a plain it, i.e. the red run the implementation PR must turn green. See docs/architecture/scheduling-phase2c3c-reload-recovery-design.md.

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


const recovery: typeof it = (process.env.RECOVERY_IMPLEMENTED === '1' ? it : it.fails) as typeof it;
const Dlg = StaffBookDialog as unknown as React.ComponentType<Record<string, unknown>>;
const SECRET_A = 'rs_A_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SECRET_B = 'rs_B_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const PII = ['Pat Customer', 'pat@example.test', '0400 000 000', 'Bring a ball hopper'];
const PENDING = 'bb.sched.pending.';
const pendingKeys = () => Object.keys(sessionStorage).filter(k => k.startsWith(PENDING));

type Srv = {
  committed: Map<string, ReturnType<typeof reservation>>;
  posts: Array<{ key: string | null; body: Record<string, unknown>; snapshot: Record<string, string> }>;
  lookups: string[];
  visible: boolean;
  lostReplies: number;
  hang: boolean;
  refuse: string | null;
};
function fakeServer(): Srv {
  const s: Srv = { committed: new Map(), posts: [], lookups: [], visible: false, lostReplies: 0, hang: false, refuse: null };
  const base = globalThis.fetch as typeof fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    if (url.pathname !== '/api/scheduling/reservations') return base(input, init);
    if (method === 'POST') {
      const headers = new Headers(init?.headers);
      const key = headers.get('idempotency-key');
      const snapshot: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const k = sessionStorage.key(i)!;
        snapshot[k] = sessionStorage.getItem(k) ?? '';
      }
      s.posts.push({ key, body: JSON.parse(String(init?.body)), snapshot });
      if (s.refuse) return Response.json({ error: 'x', code: s.refuse }, { status: 409 });
      const already = s.committed.has(key!);
      if (!already) s.committed.set(key!, reservation());
      if (s.lostReplies > 0) {
        s.lostReplies -= 1;
        throw new TypeError('network down'); // the write COMMITTED; the reply is lost
      }
      if (s.hang) return new Promise<Response>(() => undefined);
      return Response.json({ reservation: s.committed.get(key!), replayed: already }, { status: already ? 200 : 201 });
    }
    const key = url.searchParams.get('idempotencyKey') ?? '';
    s.lookups.push(key);
    return s.visible && s.committed.has(key) ? Response.json({ reservation: s.committed.get(key) }) : Response.json({ error: 'not_found' }, { status: 404 });
  });
  return s;
}
const open = (secret: string | null = SECRET_A) =>
  render(<Dlg resourceId="court-1" resourceName="Court 1" today={TODAY} onClose={vi.fn()} onBooked={vi.fn()} onUnavailable={vi.fn()} {...(secret ? { recoverySecret: secret } : {})} />);
const polls = async () => {
  for (const ms of [500, 1500, 3000, 6000]) await act(async () => { await vi.advanceTimersByTimeAsync(ms + 50); });
};
const keysSent = (s: Srv) => [...new Set(s.posts.map(p => p.key))];
async function lostReplyThenUnsure(s: Srv, secret = SECRET_A) {
  s.lostReplies = 1;
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  open(secret);
  await toReview(user);
  await user.click(screen.getByTestId('confirm-booking'));
  await polls();
  await screen.findByRole('heading', { name: /could not confirm whether the booking was saved/ });
  return user;
}

describe('D1 permanent regression: close and reopen after an unresolved outcome', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  recovery('steps 1-7: committed write, lost reply, uncertain, close, reopen: the ORIGINAL booking is recovered; one key; one reservation; no second POST', async () => {
    const s = fakeServer();
    const user = await lostReplyThenUnsure(s);
    const original = s.posts[0].key;
    await user.click(screen.getByRole('button', { name: 'Close' }));
    cleanup();
    s.visible = true; // the committed write is now readable
    open();
    expect(await screen.findByTestId('confirmation', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByTestId('reservation-id')).toHaveValue(RES_ID);
    expect(s.posts).toHaveLength(1);
    expect(keysSent(s)).toEqual([original]);
    expect(s.lookups.at(-1)).toBe(original);
    expect(s.committed.size).toBe(1);
  });

  recovery('reopen while the lookup still finds nothing: no booking form and no new key; only the original attempt can be resumed, and it keeps the original key', async () => {
    const s = fakeServer();
    const user = await lostReplyThenUnsure(s);
    const original = s.posts[0].key;
    await user.click(screen.getByRole('button', { name: 'Close' }));
    cleanup();
    open();
    expect(await screen.findByRole('heading', { name: /earlier booking/i })).toBeInTheDocument();
    expect(screen.queryByText('Choose a date')).not.toBeInTheDocument();
    expect(s.posts).toHaveLength(1);
    await user.click(await screen.findByRole('button', { name: /Enter the booking again/i }));
    await toReview(user);
    await user.click(screen.getByTestId('confirm-booking'));
    await screen.findByTestId('confirmation');
    expect(keysSent(s)).toEqual([original]);
    expect(s.posts).toHaveLength(2);
    expect(s.committed.size).toBe(1);
  });

  recovery('a DIFFERENT booking cannot be started while the earlier one is unresolved (no new key is minted)', async () => {
    const s = fakeServer();
    const user = await lostReplyThenUnsure(s);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    cleanup();
    open();
    await user.click(await screen.findByRole('button', { name: /Enter the booking again/i }));
    await toDetails(user, '11:00'); // a different start time
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Review booking' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not the booking being checked|earlier booking/i);
    expect(s.posts).toHaveLength(1);
    expect(s.committed.size).toBe(1);
  });
});

describe('browser refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  async function reload() {
    cleanup();
    vi.resetModules(); // the page's memory is gone; sessionStorage survives
    const rtl = await import('@testing-library/react');
    const mod = (await import('@/app/scheduling/_components/StaffBookDialog')) as unknown as { default: React.ComponentType<Record<string, unknown>> };
    return { rtl, Page: mod.default };
  }
  const page = (Page: React.ComponentType<Record<string, unknown>>) => (
    <Page resourceId="court-1" resourceName="Court 1" today={TODAY} onClose={vi.fn()} onBooked={vi.fn()} onUnavailable={vi.fn()} recoverySecret={SECRET_A} />
  );

  recovery('after a refresh the original key is reconciled before anything else, and a found booking is shown as Booked', async () => {
    const s = fakeServer();
    await lostReplyThenUnsure(s);
    const original = s.posts[0].key;
    const { rtl, Page } = await reload();
    s.visible = true;
    rtl.render(page(Page));
    expect(await rtl.screen.findByTestId('confirmation', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(s.posts).toHaveLength(1);
    expect(s.lookups.at(-1)).toBe(original);
    expect(pendingKeys()).toHaveLength(0); // resolved: the record is gone
  });

  recovery('after a refresh with nothing found there is NO booking form and no new key, and ten minutes passing does not turn it into a failure', async () => {
    const s = fakeServer();
    await lostReplyThenUnsure(s);
    const { rtl, Page } = await reload();
    rtl.render(page(Page));
    expect(await rtl.screen.findByRole('heading', { name: /earlier booking/i })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(rtl.screen.queryByText('Choose a date')).not.toBeInTheDocument();
    expect(rtl.screen.getByRole('heading', { name: /earlier booking/i })).toBeInTheDocument();
    expect(s.posts).toHaveLength(1);
    expect(pendingKeys()).toHaveLength(1);
  });
});

describe('write-ahead record, timeout and storage failure', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  recovery('the record is written BEFORE the first byte is sent and holds only {v, key, fp, savedAt}: no customer data, no plain hash of the payload; a timeout is uncertain', async () => {
    const s = fakeServer();
    s.hang = true; // a request that never answers: the client gives up after 20 s
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    open();
    await toReview(user);
    await user.click(screen.getByTestId('confirm-booking'));
    await waitFor(() => expect(s.posts).toHaveLength(1));
    const records = Object.entries(s.posts[0].snapshot).filter(([k]) => k.startsWith(PENDING));
    expect(records).toHaveLength(1);
    const rec = JSON.parse(records[0][1]) as Record<string, unknown>;
    expect(Object.keys(rec).sort()).toEqual(['fp', 'key', 'savedAt', 'v']);
    expect(rec.key).toBe(s.posts[0].key);
    const everything = JSON.stringify({ ...sessionStorage, ...localStorage });
    for (const p of PII) expect(everything).not.toContain(p);
    expect(everything).not.toContain(SECRET_A);
    const { createHash } = await import('node:crypto');
    const plain = createHash('sha256').update(JSON.stringify(s.posts[0].body)).digest();
    for (const enc of [plain.toString('hex'), plain.toString('base64'), plain.toString('base64url')]) expect(String(rec.fp)).not.toBe(enc);
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
    await screen.findByRole('heading', { name: 'Checking whether your booking was saved' });
    expect(pendingKeys()).toHaveLength(1);
  });

  recovery('a definitive outcome clears the record (created, and a definite refusal)', async () => {
    const s = fakeServer();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    open();
    await toReview(user);
    await user.click(screen.getByTestId('confirm-booking'));
    await screen.findByTestId('confirmation');
    expect(Object.keys(s.posts[0].snapshot).filter(k => k.startsWith(PENDING))).toHaveLength(1); // it existed while the request was in flight
    expect(pendingKeys()).toHaveLength(0);
    cleanup();
    s.committed.clear();
    s.refuse = 'RESOURCE_CONFLICT';
    open();
    await toReview(user);
    await user.click(screen.getByTestId('confirm-booking'));
    await screen.findByTestId('booking-live');
    expect(Object.keys(s.posts[1].snapshot).filter(k => k.startsWith(PENDING))).toHaveLength(1);
    expect(pendingKeys()).toHaveLength(0);
  });

  recovery('storage that cannot be written: NOTHING is sent (fail closed) and the staff member is told why', async () => {
    const s = fakeServer();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    open();
    await toReview(user);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    await user.click(screen.getByTestId('confirm-booking'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/safely/i);
    expect(s.posts).toHaveLength(0);
    spy.mockRestore();
  });

  recovery('storage that cannot be read or written at all: the dialog offers no booking and sends nothing', async () => {
    const s = fakeServer();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    open();
    expect(await screen.findByText(/safely/i)).toBeInTheDocument();
    expect(screen.queryByText('Choose a date')).not.toBeInTheDocument();
    expect(s.posts).toHaveLength(0);
    set.mockRestore();
    get.mockRestore();
  });

  recovery('no recovery secret from the server: no booking is offered (fail closed)', async () => {
    const s = fakeServer();
    open(null);
    expect(await screen.findByText(/safely/i)).toBeInTheDocument();
    expect(screen.queryByText('Choose a date')).not.toBeInTheDocument();
    expect(s.posts).toHaveLength(0);
  });
});

describe('user switching and tenant isolation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  recovery('another user or organisation (a different server-derived secret) never sees, looks up or resumes the record; the first one still can', async () => {
    const s = fakeServer();
    const user = await lostReplyThenUnsure(s, SECRET_A);
    const original = s.posts[0].key;
    await user.click(screen.getByRole('button', { name: 'Close' }));
    cleanup();
    const lookupsBefore = s.lookups.length;
    open(SECRET_B);
    expect(await screen.findByText('Choose a date')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /earlier booking/i })).not.toBeInTheDocument();
    expect(s.lookups.length).toBe(lookupsBefore); // user B's page never asked about user A's key
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(SECRET_A);
    cleanup();
    s.visible = true;
    open(SECRET_A);
    expect(await screen.findByTestId('confirmation', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(s.lookups.at(-1)).toBe(original);
  });
});
