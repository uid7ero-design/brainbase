import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Imported after the mock is registered so it picks up the mocked module.
const { createOAuthState, verifyOAuthState } = await import('@/lib/oauthState');

describe('lib/oauthState', () => {
  beforeEach(() => {
    store = new Map();
    setSpy.mockClear();
  });

  it('generates a random, sufficiently long state value', async () => {
    const state = await createOAuthState('test_oauth_state');
    expect(state).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex-encoded
  });

  it('generates a different state value on each call (not reused)', async () => {
    const a = await createOAuthState('test_oauth_state');
    const b = await createOAuthState('test_oauth_state');
    expect(a).not.toBe(b);
  });

  it('sets the cookie httpOnly, sameSite=lax, and short-lived', async () => {
    await createOAuthState('test_oauth_state');
    expect(setSpy).toHaveBeenCalledTimes(1);
    const [, , options] = setSpy.mock.calls[0];
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    expect(options.maxAge).toBeLessThanOrEqual(600);
    expect(options.maxAge).toBeGreaterThan(0);
  });

  it('accepts a state that matches the stored cookie', async () => {
    const state = await createOAuthState('test_oauth_state');
    const ok = await verifyOAuthState('test_oauth_state', state);
    expect(ok).toBe(true);
  });

  it('rejects a state that does not match the stored cookie', async () => {
    await createOAuthState('test_oauth_state');
    const ok = await verifyOAuthState('test_oauth_state', 'a-completely-different-value-0000000000000000000000000000000');
    expect(ok).toBe(false);
  });

  it('rejects when no state cookie was ever set', async () => {
    const ok = await verifyOAuthState('test_oauth_state', 'anything');
    expect(ok).toBe(false);
  });

  it('rejects when no state was provided by the callback', async () => {
    await createOAuthState('test_oauth_state');
    const ok = await verifyOAuthState('test_oauth_state', null);
    expect(ok).toBe(false);
  });

  it('consumes the cookie on successful verification (one-time use)', async () => {
    const state = await createOAuthState('test_oauth_state');
    expect(await verifyOAuthState('test_oauth_state', state)).toBe(true);
    // Replaying the exact same state a second time must fail — the cookie is gone.
    expect(await verifyOAuthState('test_oauth_state', state)).toBe(false);
  });

  it('consumes the cookie even on failed verification (one-time use)', async () => {
    await createOAuthState('test_oauth_state');
    expect(await verifyOAuthState('test_oauth_state', 'wrong-value')).toBe(false);
    expect(store.has('test_oauth_state')).toBe(false);
  });

  it('rejects an expired state even when the value otherwise matches, and still consumes it', async () => {
    vi.useFakeTimers();
    try {
      const state = await createOAuthState('test_oauth_state');
      // Advance past the 10-minute window — this proves expiry is enforced
      // server-side (embedded in the cookie value), not merely left to the
      // browser to honour the cookie's own maxAge.
      vi.advanceTimersByTime(601_000);

      const ok = await verifyOAuthState('test_oauth_state', state);
      expect(ok).toBe(false);
      // Consumed safely — not left behind for a later, still-invalid replay.
      expect(store.has('test_oauth_state')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a cookie value with a malformed/missing expiry segment', async () => {
    store.set('test_oauth_state', { value: 'not-a-valid-state-value-with-no-separator' });
    const ok = await verifyOAuthState('test_oauth_state', 'not-a-valid-state-value-with-no-separator');
    expect(ok).toBe(false);
  });
});
