import 'server-only';
import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import sql from '@/lib/db';
import {
  TICKETING_SESSION_AUDIENCE,
  TICKETING_SESSION_ISSUER,
  TICKETING_SESSION_LIFETIME_SECONDS,
} from '@ticketing/core/sessionPolicy';

// Ticketing (Eve) session token. Signed with EVE_SESSION_SECRET — never the
// host application's SESSION_SECRET — and bound to its own issuer/audience, so
// a token from either system fails verification in the other.
//
// Claims are identifiers only (user, organisation, and the session id `jti`).
// Role, status and entitlement are NOT carried: authorizeTicketingApiRequest()
// reloads them from the database every time.
//
// Phase 3.5 — every token is backed by a ticketing_sessions row keyed by its
// `jti`. The row is written BEFORE the token is signed (a token with no row is
// never returned), and a token is honoured only while that row is live
// (same user, same organisation, not revoked, not expired). The row adds
// revocability; it does not replace any of the per-request checks.

export type TicketingSessionClaims = {
  jti: string;
  userId: string;
  organisationId: string;
  issuedAt: number;
  expiresAt: number;
};

export type SessionRevokedReason = 'LOGOUT' | 'ORG_SWITCH' | 'PASSWORD_CHANGE' | 'ADMIN';

const MIN_SECRET_LENGTH = 32;
const MIN_JTI_LENGTH = 16;

// Returns null (fail closed) when the secret is absent, too short, or equal to
// the host session secret.
function signingKey(): Uint8Array | null {
  const secret = process.env.EVE_SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  if (secret === process.env.SESSION_SECRET) return null;
  return new TextEncoder().encode(secret);
}

// 192 bits of entropy, URL-safe.
export function newSessionId(): string {
  return randomBytes(24).toString('base64url');
}

// Issues a session: persists the row first (and, for an organisation switch,
// revokes the previous session in the SAME transaction), then signs. Returns
// null — and issues nothing — if signing is not configured or the database
// write fails.
export async function issueTicketingSession(
  userId: string,
  organisationId: string,
  opts: { replaceSessionId?: string } = {},
): Promise<{ token: string; expiresAt: number } | null> {
  const key = signingKey();
  if (!key) return null;
  const jti = newSessionId();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TICKETING_SESSION_LIFETIME_SECONDS;

  try {
    const insert = sql`
      INSERT INTO ticketing_sessions (id, user_id, organisation_id, expires_at)
      VALUES (${jti}, ${userId}, ${organisationId}, NOW() + make_interval(secs => ${TICKETING_SESSION_LIFETIME_SECONDS}))
    `;
    if (opts.replaceSessionId) {
      await sql.transaction([
        insert,
        sql`
          UPDATE ticketing_sessions SET revoked_at = NOW(), revoked_reason = 'ORG_SWITCH'
          WHERE id = ${opts.replaceSessionId} AND user_id = ${userId} AND revoked_at IS NULL
        `,
      ]);
    } else {
      await insert;
    }
  } catch (err) {
    console.error('[ticketing] session row could not be written; no token issued', err instanceof Error ? err.name : 'error');
    return null;
  }

  const token = await new SignJWT({ org: organisationId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(TICKETING_SESSION_ISSUER)
    .setAudience(TICKETING_SESSION_AUDIENCE)
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key);
  return { token, expiresAt: exp * 1000 };
}

// Signature, issuer, audience, expiry and claim shape only. Whether the
// session is still LIVE is a database question answered by the caller
// (authorizeTicketingApiRequest / requireActiveSuperAdmin) in the same read
// that loads the user.
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
    if (typeof payload.jti !== 'string' || payload.jti.length < MIN_JTI_LENGTH) return null; // pre-3.5 token
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
    return {
      jti: payload.jti,
      userId: payload.sub,
      organisationId: payload.org,
      issuedAt: payload.iat * 1000,
      expiresAt: payload.exp * 1000,
    };
  } catch {
    return null;
  }
}

// Revokes one session (idempotent: an already-revoked or unknown session is a
// no-op). Throws on a database error so the caller can say so.
export async function revokeTicketingSession(sessionId: string, userId: string, reason: SessionRevokedReason): Promise<void> {
  await sql`
    UPDATE ticketing_sessions SET revoked_at = NOW(), revoked_reason = ${reason}
    WHERE id = ${sessionId} AND user_id = ${userId} AND revoked_at IS NULL
  `;
}

// Bounded housekeeping: removes a few long-expired rows. Best-effort; never throws.
export async function pruneTicketingSessions(): Promise<void> {
  try {
    await sql`
      DELETE FROM ticketing_sessions
      WHERE id IN (SELECT id FROM ticketing_sessions WHERE expires_at < NOW() - interval '1 day' LIMIT 100)
    `;
  } catch {
    /* housekeeping only */
  }
}
