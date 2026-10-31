import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

// Eve organiser allow-list, Eve side. The API refuses an organisation that is
// not enabled on Eve with 403 EVE_NOT_ENABLED (sign-in and every organiser
// call); here: the gateway keeps that code, sign-in shows a neutral notice,
// and the organiser pages send the visitor to it instead of the portal.

const redirectMock = vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); });
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ name: 'x', value: 'tok' }), set: () => {}, delete: () => {} }),
}));

const { getTicketingGateway } = await import('@/lib/ticketing/gateway');
const { EVE_NOT_ENABLED_MESSAGE } = await import('@/lib/organiserAuth');
const login = await import('@/app/api/auth/login/route');
const { default: SignInPage } = await import('@/app/(marketing)/signin/page');
const { default: DashboardPage } = await import('@/app/(organiser)/organiser/page');
const { default: EventsPage } = await import('@/app/(organiser)/organiser/events/page');
const { default: CheckInPage } = await import('@/app/(organiser)/organiser/check-in/page');

const fetchMock = vi.fn();
function answer(status: number, body: unknown) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}
const loginReq = () => new Request('https://eve.example/api/auth/login', {
  method: 'POST',
  headers: { host: 'eve.example', 'x-forwarded-proto': 'https', origin: 'https://eve.example', 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'pat', password: 'pw' }),
});

beforeEach(() => {
  vi.stubEnv('TICKETING_API_BASE_URL', 'https://api.example');
  vi.stubEnv('TICKETING_API_SECRET', 'test-secret-0123456789abcdef0123456789abcdef');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  redirectMock.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('gateway', () => {
  it('keeps the EVE_NOT_ENABLED code on a 403; any other 403 stays a plain forbidden', async () => {
    answer(403, { error: 'EVE_NOT_ENABLED' });
    expect(await getTicketingGateway().getSession('tok')).toEqual({ status: 'forbidden', code: 'EVE_NOT_ENABLED' });
    answer(403, { error: 'Forbidden' });
    expect(await getTicketingGateway().getSession('tok')).toEqual({ status: 'forbidden' });
  });
});

describe('sign-in', () => {
  it('a valid user of a not-enabled organisation gets the neutral notice, and no session cookie is written', async () => {
    answer(403, { error: 'EVE_NOT_ENABLED' });
    const res = await login.POST(loginReq());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: EVE_NOT_ENABLED_MESSAGE });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('wrong credentials (or any other refusal) still read as invalid credentials', async () => {
    answer(401, { error: 'Invalid username or password.' });
    expect((await login.POST(loginReq())).status).toBe(401);
    answer(403, { error: 'Forbidden' });
    const res = await login.POST(loginReq());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid username or password.' });
  });

  it('the notice names no organisation and no other product', () => {
    expect(EVE_NOT_ENABLED_MESSAGE).not.toMatch(/BrainBase|Brainbase|LD Tennis|Riverlights/);
  });

  it('the sign-in page shows the notice for reason=not-enabled only', async () => {
    render((await SignInPage({ searchParams: Promise.resolve({ reason: 'not-enabled' }) })) as ReactElement);
    expect(screen.getByRole('status')).toHaveTextContent(EVE_NOT_ENABLED_MESSAGE);
  });

  it('no notice on a plain sign-in', async () => {
    render((await SignInPage({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(screen.queryByText(EVE_NOT_ENABLED_MESSAGE)).toBeNull();
  });
});

describe('organiser portal', () => {
  it('a session whose organisation is not enabled is sent to the notice, before any organiser data is read', async () => {
    answer(403, { error: 'EVE_NOT_ENABLED' });
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/signin?reason=not-enabled');
    await expect(EventsPage()).rejects.toThrow('REDIRECT:/signin?reason=not-enabled');
    await expect(CheckInPage({ searchParams: Promise.resolve({}) } as never)).rejects.toThrow('REDIRECT:/signin?reason=not-enabled');
    // Only /auth/session was asked: no event, order or check-in call.
    for (const [url] of fetchMock.mock.calls) expect(String(url)).toMatch(/\/api\/ticketing\/auth\/session$/);
  });

  it('an enabled organisation gets the portal as before', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const body = String(url).endsWith('/auth/session')
        ? { user: { id: 'u1', name: 'Pat', role: 'manager' }, organisationId: 'org1', organisation: { slug: 'acme', name: 'Acme Events' } }
        : { organisation: { slug: 'acme', name: 'Acme Events' }, events: [], orders: [], summary: {} };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await EventsPage();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
