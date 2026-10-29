// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Eve's own same-origin API routes. The gateway and the cookie jar are
// mocked; no network, no database.

const jar = new Map<string, { value: string; opts: Record<string, unknown> }>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)!.value } : undefined),
    set: (n: string, value: string, opts: Record<string, unknown>) => { jar.set(n, { value, opts }); },
    delete: (n: string) => { jar.delete(n); },
  }),
}));

const gw = {
  login: vi.fn(), logout: vi.fn(), getSession: vi.fn(), listOrganisations: vi.fn(), switchOrganisation: vi.fn(),
  buyerAction: vi.fn(), getCheckoutStatus: vi.fn(), checkInSearch: vi.fn(), checkInAction: vi.fn(),
};
vi.mock('@/lib/ticketing/gateway', () => ({ getTicketingGateway: () => gw }));

const login = await import('@/app/api/auth/login/route');
const logout = await import('@/app/api/auth/logout/route');
const sessionRoute = await import('@/app/api/auth/session/route');
const orgRoute = await import('@/app/api/auth/organisation/route');
const buyer = await import('@/app/api/buyer/[organisationSlug]/[eventSlug]/[action]/route');
const checkIn = await import('@/app/api/organiser/check-in/[id]/[action]/route');
const { TICKETING_SESSION_COOKIE } = await import('@ticketing/core');

const ORIGIN = 'https://eve.example';
function req(url: string, init: { method?: string; body?: unknown; origin?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: 'eve.example', 'x-forwarded-proto': 'https', 'content-type': 'application/json', ...init.headers };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  return new Request(`${ORIGIN}${url}`, { method: init.method ?? 'POST', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
}

beforeEach(() => {
  jar.clear();
  for (const f of Object.values(gw)) f.mockReset();
  vi.unstubAllEnvs();
});

describe('login', () => {
  const ok = { status: 'ok', data: { token: 'tok-secret', expiresAt: Date.now() + 3600_000, user: { id: 'u1', name: 'Pat', role: 'manager' }, organisationId: 'org1' } };

  it('stores the token in a host-only HttpOnly SameSite=Strict cookie and never returns it', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    gw.login.mockResolvedValue(ok);
    const res = await login.POST(req('/api/auth/login', { body: { username: 'pat', password: 'pw' } }));
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('tok-secret');
    const c = jar.get(TICKETING_SESSION_COOKIE)!;
    expect(c.value).toBe('tok-secret');
    expect(c.opts).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
    expect('domain' in c.opts).toBe(false);
    expect(TICKETING_SESSION_COOKIE).not.toBe('session');
  });

  it('is not Secure only in local development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    gw.login.mockResolvedValue(ok);
    await login.POST(req('/api/auth/login', { body: { username: 'pat', password: 'pw' } }));
    expect(jar.get(TICKETING_SESSION_COOKIE)!.opts.secure).toBe(false);
  });

  it('rejects cross-origin and origin-less posts before touching the API', async () => {
    for (const origin of ['https://evil.example', null]) {
      const res = await login.POST(req('/api/auth/login', { body: { username: 'pat', password: 'pw' }, origin }));
      expect(res.status).toBe(403);
    }
    expect(gw.login).not.toHaveBeenCalled();
    expect(jar.size).toBe(0);
  });

  it('answers any credential failure with the same generic 401 and sets no cookie', async () => {
    for (const status of ['unauthorised', 'forbidden', 'not_found']) {
      gw.login.mockResolvedValueOnce({ status });
      const res = await login.POST(req('/api/auth/login', { body: { username: 'pat', password: 'bad' } }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Invalid username or password.' });
    }
    expect(jar.size).toBe(0);
  });

  it('relays the super_admin organisation chooser, rate limiting and outages', async () => {
    gw.login.mockResolvedValueOnce({ status: 'error', httpStatus: 409, message: 'x', body: { organisations: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } });
    const res = await login.POST(req('/api/auth/login', { body: { username: 'sa', password: 'pw' } }));
    expect(res.status).toBe(409);
    expect((await res.json()).organisations).toHaveLength(2);
    gw.login.mockResolvedValueOnce({ status: 'error', httpStatus: 429, message: 'x', body: {} });
    expect((await login.POST(req('/api/auth/login', { body: { username: 'sa', password: 'pw' } }))).status).toBe(429);
    gw.login.mockResolvedValueOnce({ status: 'unavailable', reason: 'not_connected' });
    expect((await login.POST(req('/api/auth/login', { body: { username: 'sa', password: 'pw' } }))).status).toBe(503);
  });

  it('forwards the visitor address, not the server address, for rate limiting', async () => {
    gw.login.mockResolvedValue(ok);
    await login.POST(req('/api/auth/login', { body: { username: 'pat', password: 'pw' }, headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }));
    expect(gw.login.mock.calls[0][1]).toBe('203.0.113.9');
  });
});

describe('logout, session and organisation selection', () => {
  it('logout removes the cookie even if the API call fails, and refuses cross-origin', async () => {
    jar.set(TICKETING_SESSION_COOKIE, { value: 't', opts: {} });
    expect((await logout.POST(req('/api/auth/logout', { origin: 'https://evil.example' }))).status).toBe(403);
    expect(jar.has(TICKETING_SESSION_COOKIE)).toBe(true);
    gw.logout.mockRejectedValue(new Error('down'));
    expect((await logout.POST(req('/api/auth/logout'))).status).toBe(200);
    expect(jar.has(TICKETING_SESSION_COOKIE)).toBe(false);
  });

  it('logout reports whether the server-side revocation was confirmed, and still removes the cookie', async () => {
    jar.set(TICKETING_SESSION_COOKIE, { value: 't', opts: {} });
    gw.logout.mockResolvedValueOnce({ status: 'ok', data: { ok: true } });
    const ok = await logout.POST(req('/api/auth/logout'));
    expect(await ok.json()).toEqual({ ok: true, revoked: true });
    expect(gw.logout).toHaveBeenLastCalledWith('t');
    jar.set(TICKETING_SESSION_COOKIE, { value: 't', opts: {} });
    gw.logout.mockResolvedValueOnce({ status: 'error', httpStatus: 503, message: 'x', body: {} });
    const unconfirmed = await logout.POST(req('/api/auth/logout'));
    expect(await unconfirmed.json()).toEqual({ ok: true, revoked: false });
    expect(jar.has(TICKETING_SESSION_COOKIE)).toBe(false);
    // No cookie at all: nothing to revoke, no API call.
    gw.logout.mockClear();
    expect(await (await logout.POST(req('/api/auth/logout'))).json()).toEqual({ ok: true, revoked: true });
    expect(gw.logout).not.toHaveBeenCalled();
  });

  it('session is 401 without a cookie and reflects the API verdict with one', async () => {
    expect((await sessionRoute.GET()).status).toBe(401);
    jar.set(TICKETING_SESSION_COOKIE, { value: 't', opts: {} });
    gw.getSession.mockResolvedValueOnce({ status: 'unauthorised' });
    expect((await sessionRoute.GET()).status).toBe(401);
    gw.getSession.mockResolvedValueOnce({ status: 'ok', data: { user: { id: 'u', name: 'P', role: 'viewer' }, organisationId: 'o', organisation: { slug: 's', name: 'N' } } });
    expect((await sessionRoute.GET()).status).toBe(200);
    expect(gw.getSession).toHaveBeenLastCalledWith('t');
  });

  it('organisation switch rewrites the cookie from the API answer; the API alone decides eligibility', async () => {
    jar.set(TICKETING_SESSION_COOKIE, { value: 'old', opts: {} });
    gw.switchOrganisation.mockResolvedValueOnce({ status: 'forbidden' });
    expect((await orgRoute.POST(req('/api/auth/organisation', { body: { organisationId: 'bad' } }))).status).toBe(403);
    expect(jar.get(TICKETING_SESSION_COOKIE)!.value).toBe('old');
    gw.switchOrganisation.mockResolvedValueOnce({ status: 'ok', data: { token: 'new', expiresAt: Date.now() + 1000_000, organisationId: 'b' } });
    expect((await orgRoute.POST(req('/api/auth/organisation', { body: { organisationId: 'b' } }))).status).toBe(200);
    expect(jar.get(TICKETING_SESSION_COOKIE)!.value).toBe('new');
    expect((await orgRoute.POST(req('/api/auth/organisation', { body: { organisationId: 'b' }, origin: 'https://evil.example' }))).status).toBe(403);
  });
});

const P = { params: Promise.resolve({ organisationSlug: 'org', eventSlug: 'ev', action: 'checkout' }) };
const ctx = (action: string) => ({ params: Promise.resolve({ organisationSlug: 'org', eventSlug: 'ev', action }) });

describe('buyer relay', () => {
  it('refuses cross-origin posts and unknown actions', async () => {
    expect((await buyer.POST(req('/x', { body: {}, origin: 'https://evil.example' }), P)).status).toBe(403);
    expect((await buyer.POST(req('/x', { body: {} }), ctx('refund'))).status).toBe(404);
    expect(gw.buyerAction).not.toHaveBeenCalled();
  });

  it('relays the API answer and its buyer-facing error message with the same status', async () => {
    gw.buyerAction.mockResolvedValueOnce({ status: 'ok', data: { checkout_url: 'https://checkout.stripe.com/c/x' } });
    const okRes = await buyer.POST(req('/x', { body: { items: [] } }), P);
    expect(await okRes.json()).toEqual({ checkout_url: 'https://checkout.stripe.com/c/x' });
    gw.buyerAction.mockResolvedValueOnce({ status: 'error', httpStatus: 409, message: 'This ticket type is no longer available in the requested quantity.', body: {} });
    const res = await buyer.POST(req('/x', { body: { items: [] } }), P);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no longer available/);
  });

  it('reports an unreachable backend as 503 without fabricating success', async () => {
    gw.buyerAction.mockResolvedValueOnce({ status: 'unavailable', reason: 'upstream_unreachable' });
    expect((await buyer.POST(req('/x', { body: { items: [] } }), P)).status).toBe(503);
  });

  it('checkout status needs a session_id and is read-only', async () => {
    expect((await buyer.GET(req('/x', { method: 'GET', origin: null }), ctx('status'))).status).toBe(400);
    gw.getCheckoutStatus.mockResolvedValueOnce({ status: 'ok', data: { payment_status: 'PAID' } });
    expect((await buyer.GET(req('/x?session_id=cs_test_1', { method: 'GET', origin: null }), ctx('status'))).status).toBe(200);
    expect((await buyer.GET(req('/x', { method: 'GET', origin: null }), ctx('checkout'))).status).toBe(404);
  });
});

const C = (action: string) => ({ params: Promise.resolve({ id: 'ev1', action }) });

describe('organiser check-in relay', () => {
  it('requires the Eve session cookie', async () => {
    expect((await checkIn.POST(req('/x', { body: { attendee_id: 'a' } }), C('confirm'))).status).toBe(401);
    expect((await checkIn.GET(req('/x?q=a', { method: 'GET', origin: null }), C('search'))).status).toBe(401);
  });

  it('refuses cross-origin mutations and unknown actions', async () => {
    jar.set(TICKETING_SESSION_COOKIE, { value: 't', opts: {} });
    expect((await checkIn.POST(req('/x', { body: {}, origin: 'https://evil.example' }), C('confirm'))).status).toBe(403);
    expect((await checkIn.POST(req('/x', { body: {} }), C('delete'))).status).toBe(404);
    expect(gw.checkInAction).not.toHaveBeenCalled();
  });

  it('turns a pasted ticket link into a bare token and passes the cookie token through', async () => {
    jar.set(TICKETING_SESSION_COOKIE, { value: 't', opts: {} });
    gw.checkInAction.mockResolvedValue({ status: 'ok', data: { attendee: { id: 'a' } } });
    const token = 'abcdefghijklmnopqrstuvwx';
    await checkIn.POST(req('/x', { body: { ticket_token: `https://eve.example/t/${token}` } }), C('resolve'));
    expect(gw.checkInAction).toHaveBeenCalledWith('t', 'ev1', 'resolve', { ticket_token: token });
    expect((await checkIn.POST(req('/x', { body: { ticket_token: 'nonsense' } }), C('resolve'))).status).toBe(404);
  });

  it('relays a role denial from the API (viewer cannot confirm) and a duplicate scan as 409 with the attendee', async () => {
    jar.set(TICKETING_SESSION_COOKIE, { value: 't', opts: {} });
    gw.checkInAction.mockResolvedValueOnce({ status: 'forbidden' });
    expect((await checkIn.POST(req('/x', { body: { attendee_id: 'a' } }), C('confirm'))).status).toBe(403);
    gw.checkInAction.mockResolvedValueOnce({ status: 'error', httpStatus: 409, message: 'x', body: { first: false, attendee: { id: 'a', checked_in_at: 'now' } } });
    const dup = await checkIn.POST(req('/x', { body: { attendee_id: 'a' } }), C('confirm'));
    expect(dup.status).toBe(409);
    expect((await dup.json()).attendee.id).toBe('a');
  });
});
