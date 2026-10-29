// Ticketing-product session policy: names, lifetimes and the same-origin
// check, shared by the application that issues/validates the session and the
// standalone product that stores it in a cookie. Pure constants and pure
// functions only — no secrets, no environment, no cookie jar.

// Deliberately unlike the host application's own session cookie name so the
// two can never be confused for one another by either side.
export const TICKETING_SESSION_COOKIE = 'eve_session';

// Product/audience marker carried inside the signed token.
export const TICKETING_SESSION_AUDIENCE = 'ticketing:eve';
export const TICKETING_SESSION_ISSUER = 'ticketing-api';

export const TICKETING_SESSION_LIFETIME_SECONDS = 8 * 60 * 60;

export type TicketingCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'strict';
  path: '/';
  maxAge: number;
};

// No `domain` attribute: the cookie is host-only, scoped to the exact origin
// that set it. `strict` is correct because the product's browser only ever
// talks to its own origin.
export function ticketingCookieOptions(secure: boolean): TicketingCookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: TICKETING_SESSION_LIFETIME_SECONDS,
  };
}

// State-changing browser requests (login, logout, organisation switch) must
// carry an Origin exactly equal to the product's own origin. A missing Origin
// is refused: browsers always send it on cross-site POSTs.
export function isSameOrigin(originHeader: string | null | undefined, allowedOrigin: string): boolean {
  if (!originHeader || !allowedOrigin) return false;
  try {
    return new URL(originHeader).origin === new URL(allowedOrigin).origin;
  } catch {
    return false;
  }
}
