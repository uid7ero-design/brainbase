import { cookies } from 'next/headers';
import { TICKETING_SESSION_COOKIE, ticketingCookieOptions } from '@ticketing/core';

// This product's own session cookie: host-only, HttpOnly, SameSite=Strict,
// Secure everywhere except local development. It holds an opaque token the
// ticketing API issued; the browser can never read it, and the API
// re-validates the user on every request regardless of what it contains.

const isLocalDev = () => process.env.NODE_ENV !== 'production';

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(TICKETING_SESSION_COOKIE)?.value ?? null;
}

export async function writeSessionToken(token: string, expiresAtMs: number): Promise<void> {
  const jar = await cookies();
  const { maxAge, ...rest } = ticketingCookieOptions(!isLocalDev());
  const remaining = Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
  jar.set(TICKETING_SESSION_COOKIE, token, { ...rest, maxAge: Math.min(maxAge, remaining) });
}

export async function clearSessionToken(): Promise<void> {
  const jar = await cookies();
  jar.delete(TICKETING_SESSION_COOKIE);
}
