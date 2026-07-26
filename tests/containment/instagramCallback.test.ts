import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { decrypt } from '@/lib/social/crypto';

const requireRoleMock = vi.fn();
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}));

const sqlCallLog: unknown[][] = [];
const sqlMock = vi.fn(async (...args: unknown[]) => {
  sqlCallLog.push(args);
  return [];
});
vi.mock('@/lib/db', () => ({ default: sqlMock }));

type CookieRecord = { value: string; options?: Record<string, unknown> };
let store: Map<string, CookieRecord>;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => store.get(name),
    set: (name: string, value: string, options?: Record<string, unknown>) => { store.set(name, { value, options }); },
    delete: (name: string) => { store.delete(name); },
  }),
}));

process.env.META_APP_ID = 'test-app-id';
process.env.META_APP_SECRET = 'test-app-secret';
process.env.META_REDIRECT_URI = 'http://localhost/api/auth/instagram/callback';

const { GET: callbackGet } = await import('@/app/api/auth/instagram/callback/route');
const { createOAuthState } = await import('@/lib/oauthState');

const STATE_COOKIE = 'instagram_oauth_state';

function callbackRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/auth/instagram/callback');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
}

function fetchSequenceForSuccess(rawLongToken: string): typeof fetch {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'SHORT_TOKEN' }))); // short-lived exchange
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: rawLongToken, expires_in: 5184000 }))); // long-lived exchange
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'page1', access_token: 'PAGE_TOKEN' }] }))); // pages list
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ instagram_business_account: { id: 'ig123' } }))); // ig business account
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ username: 'myigusername' }))); // username lookup
  return fetchMock as unknown as typeof fetch;
}

// Note: requireRoleMock is reset inline at the top of each test body rather
// than in a shared beforeEach — a beforeEach-based reset of a *rejected*
// mock was observed to interact badly with this route's await/try-catch
// under the current Vitest/oxc transform (see also instagramConnect.test.ts).
// sqlMock/store use plain beforeEach resets safely since they never reject.
describe('GET /api/auth/instagram/callback — OAuth state + no new plaintext token write', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    sqlMock.mockClear();
    sqlCallLog.length = 0;
    store = new Map();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('denies an anonymous caller, redirecting to /login, before any external call', async () => {
    requireRoleMock.mockReset();
    requireRoleMock.mockRejectedValue(new Error('Unauthorized'));
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await callbackGet(callbackRequest({ code: 'fake-code' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('denies an authenticated caller below manager, redirecting with a forbidden marker', async () => {
    requireRoleMock.mockReset();
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await callbackGet(callbackRequest({ code: 'fake-code' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('ig_error=Forbidden');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a missing state before any token exchange', async () => {
    requireRoleMock.mockReset();
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await callbackGet(callbackRequest({ code: 'fake-code' })); // no state param at all
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('ig_error=invalid_state');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects a mismatched state before any token exchange', async () => {
    requireRoleMock.mockReset();
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    await createOAuthState(STATE_COOKIE); // sets a real, valid state cookie
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await callbackGet(callbackRequest({ code: 'fake-code', state: 'totally-wrong-state-value' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('ig_error=invalid_state');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a malformed state cookie value', async () => {
    requireRoleMock.mockReset();
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    store.set(STATE_COOKIE, { value: 'no-separator-here' }); // missing the state.expiry format entirely
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await callbackGet(callbackRequest({ code: 'fake-code', state: 'no-separator-here' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('ig_error=invalid_state');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an expired state', async () => {
    requireRoleMock.mockReset();
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    // Fake timers must stay active through the callback call itself — the
    // expiry check runs inside callbackGet, not at state-creation time.
    vi.useFakeTimers();
    try {
      const state = await createOAuthState(STATE_COOKIE);
      vi.advanceTimersByTime(601_000); // past the 10-minute window

      const res = await callbackGet(callbackRequest({ code: 'fake-code', state }));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('ig_error=invalid_state');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('consumes the state cookie — replaying the same valid state a second time fails (one-time use)', async () => {
    requireRoleMock.mockReset();
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    const state = await createOAuthState(STATE_COOKIE);

    global.fetch = fetchSequenceForSuccess('RAW_TOKEN_FIRST_USE');
    const first = await callbackGet(callbackRequest({ code: 'fake-code', state }));
    expect(first.headers.get('location')).toContain('ig_connected=1');

    const fetchSpy2 = vi.fn();
    global.fetch = fetchSpy2 as unknown as typeof fetch;
    const second = await callbackGet(callbackRequest({ code: 'fake-code', state }));
    expect(second.headers.get('location')).toContain('ig_error=invalid_state');
    expect(fetchSpy2).not.toHaveBeenCalled();
  });

  it('valid state succeeds and encrypts the token before writing it — the raw token is never stored in plaintext', async () => {
    requireRoleMock.mockReset();
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    const state = await createOAuthState(STATE_COOKIE);

    const RAW_LONG_TOKEN = 'RAW-LONG-LIVED-META-TOKEN-abc123';
    global.fetch = fetchSequenceForSuccess(RAW_LONG_TOKEN);

    const res = await callbackGet(callbackRequest({ code: 'fake-code', state }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('ig_connected=1');

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const writtenValues = sqlCallLog[0];
    expect(writtenValues).not.toContain(RAW_LONG_TOKEN);

    const storedToken = writtenValues.find(
      (v): v is string => typeof v === 'string' && v.includes(':'),
    );
    expect(storedToken).toBeDefined();
    expect(decrypt(storedToken!)).toBe(RAW_LONG_TOKEN);
  });
});
