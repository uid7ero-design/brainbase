import { describe, it, expect, vi } from 'vitest';

const requireRoleMock = vi.fn();
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}));

type CookieRecord = { value: string; options?: Record<string, unknown> };
let store: Map<string, CookieRecord>;
const setSpy = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => store.get(name),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      setSpy(name, value, options);
      store.set(name, { value, options });
    },
    delete: (name: string) => { store.delete(name); },
  }),
}));

process.env.META_APP_ID = 'test-app-id';
process.env.META_REDIRECT_URI = 'http://localhost/api/auth/instagram/callback';

const { GET: connectGet } = await import('@/app/api/auth/instagram/connect/route');

// Note: each test resets requireRoleMock inline at the top of its own body
// rather than in a shared beforeEach — see instagramCallback.test.ts for why.
describe('GET /api/auth/instagram/connect', () => {
  it('denies an anonymous caller', async () => {
    requireRoleMock.mockReset();
    requireRoleMock.mockRejectedValue(new Error('Unauthorized'));
    store = new Map();
    const res = await connectGet();
    expect(res.status).toBe(403);
  });

  it('denies an authenticated caller below manager', async () => {
    requireRoleMock.mockReset();
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    store = new Map();
    const res = await connectGet();
    expect(res.status).toBe(403);
  });

  it('redirects a manager to the Facebook OAuth dialog with a state param, backed by a short-lived httpOnly cookie', async () => {
    requireRoleMock.mockReset();
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'A' });
    store = new Map();
    setSpy.mockClear();

    const res = await connectGet();
    expect(res.status).toBe(307);

    const location = res.headers.get('location')!;
    expect(location).toContain('facebook.com');
    const url = new URL(location);
    const state = url.searchParams.get('state');
    expect(state).toMatch(/^[0-9a-f]{64}$/); // cryptographically random, 32 bytes hex

    expect(setSpy).toHaveBeenCalledTimes(1);
    const [cookieName, cookieValue, options] = setSpy.mock.calls[0];
    expect(cookieName).toBe('instagram_oauth_state');
    expect(cookieValue).toContain(state);
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    expect(options.maxAge).toBeLessThanOrEqual(600);
  });
});
