import 'server-only';
import { randomBytes, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

const STATE_MAX_AGE_SECONDS = 600; // 10 minutes — short-lived, one-time use

/**
 * Generates a cryptographically random, single-use OAuth state value and
 * stores it in a short-lived httpOnly cookie. Return value is embedded in the
 * outgoing authorization URL; the callback must verify it via verifyOAuthState.
 *
 * The cookie's own `maxAge` relies on the browser to stop sending it once
 * expired — but that's a client-side courtesy, not a server-side guarantee.
 * The expiry timestamp is therefore also embedded in the cookie's value
 * itself, so verifyOAuthState enforces it independently of cookie maxAge
 * (and so expiry is deterministically testable, not dependent on browser
 * behaviour or the passage of real wall-clock time in tests).
 */
export async function createOAuthState(cookieName: string): Promise<string> {
  const state = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + STATE_MAX_AGE_SECONDS * 1000;
  const jar = await cookies();
  jar.set(cookieName, `${state}.${expiresAt}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_MAX_AGE_SECONDS,
  });
  return state;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still perform a comparison of equal length so a length mismatch
    // doesn't short-circuit into an observably faster branch.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies a callback-supplied state value against the cookie set by
 * createOAuthState, then deletes the cookie unconditionally (one-time use —
 * consumed whether verification succeeds, fails, or has expired).
 */
export async function verifyOAuthState(
  cookieName: string,
  providedState: string | null | undefined,
): Promise<boolean> {
  const jar = await cookies();
  const raw = jar.get(cookieName)?.value;
  jar.delete(cookieName);

  if (!raw || !providedState) return false;

  const separatorIndex = raw.lastIndexOf('.');
  if (separatorIndex === -1) return false;

  const savedState = raw.slice(0, separatorIndex);
  const expiresAt = Number(raw.slice(separatorIndex + 1));
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  return constantTimeEquals(providedState, savedState);
}
