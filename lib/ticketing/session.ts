import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import {
  TICKETING_SESSION_AUDIENCE,
  TICKETING_SESSION_ISSUER,
  TICKETING_SESSION_LIFETIME_SECONDS,
} from '@ticketing/core/sessionPolicy';

// Ticketing (Eve) session token. Signed with EVE_SESSION_SECRET — never the
// host application's SESSION_SECRET — and bound to its own issuer/audience, so
// a token from either system fails verification in the other.
//
// Claims are identifiers only. Role, status and entitlement are NOT carried:
// authorizeTicketingApiRequest() reloads them from the database every time.

export type TicketingSessionClaims = {
  userId: string;
  organisationId: string;
  issuedAt: number;
  expiresAt: number;
};

const MIN_SECRET_LENGTH = 32;

// Returns null (fail closed) when the secret is absent, too short, or equal to
// the host session secret.
function signingKey(): Uint8Array | null {
  const secret = process.env.EVE_SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  if (secret === process.env.SESSION_SECRET) return null;
  return new TextEncoder().encode(secret);
}

export async function issueTicketingSession(
  userId: string,
  organisationId: string,
): Promise<{ token: string; expiresAt: number } | null> {
  const key = signingKey();
  if (!key) return null;
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TICKETING_SESSION_LIFETIME_SECONDS;
  const token = await new SignJWT({ org: organisationId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(TICKETING_SESSION_ISSUER)
    .setAudience(TICKETING_SESSION_AUDIENCE)
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key);
  return { token, expiresAt: exp * 1000 };
}

export async function verifyTicketingSession(
  token: string | null | undefined,
): Promise<TicketingSessionClaims | null> {
  if (!token) return null;
  const key = signingKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: TICKETING_SESSION_ISSUER,
      audience: TICKETING_SESSION_AUDIENCE,
    });
    if (typeof payload.sub !== 'string' || typeof payload.org !== 'string') return null;
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
    return {
      userId: payload.sub,
      organisationId: payload.org,
      issuedAt: payload.iat * 1000,
      expiresAt: payload.exp * 1000,
    };
  } catch {
    return null;
  }
}
