import 'server-only';
import sql from '@/lib/db';
import { encrypt, decrypt } from '@/lib/social/crypto';

// Founder OS Phase E.5A — Microsoft 365 connection foundation.
//
// This is BrainBase's OWN, single, global Microsoft 365 business
// connection (James's own account) — not a per-client/per-organisation
// integration, matching the same global model already established for
// Gmail/Google Calendar/Spotify (see lib/globalIntegrationAccess.ts's
// own documented "temporary containment" model). There is deliberately
// no organisation_id anywhere in this file or the microsoft_connections
// table — access is gated by requireGlobalIntegrationAccess(), not by
// tenant, exactly like the other three global integrations.
//
// DELIBERATE DEPARTURE FROM THE EXISTING GOOGLE PATTERN: Gmail/GCal
// store tokens as plaintext JSON on the local filesystem
// (process.cwd()/.brainbase/*.json) — not encrypted, and not
// guaranteed to persist across invocations/deployments on Vercel's
// serverless runtime. This file stores tokens in Neon instead (durable),
// encrypted at rest via the same, already-proven, fully generic
// AES-256-GCM encrypt()/decrypt() lib/social/crypto.ts already uses for
// Instagram's access_token — reused verbatim, not reinvented. (Its
// "social"-prefixed name/env var, SOCIAL_TOKEN_SECRET, is historical
// from when it was first built for Instagram; the functions themselves
// contain no social-media-specific logic and are safe to reuse for any
// secret string.)
//
// Exactly one row is expected to exist at a time — connecting again
// replaces the existing connection (an atomic DELETE+INSERT via
// sql.transaction(), the same established pattern already used in
// lib/tennisSchedule.ts) rather than accumulating a second row, matching
// Gmail's own single-account replace-on-reconnect behaviour. This is
// enforced by application logic, not a DB constraint, keeping the schema
// itself as small as possible.

export type MicrosoftConnection = {
  accountEmail: string;
  tenantId: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms epoch
};

type StoredRow = {
  account_email: string;
  ms_tenant_id: string | null;
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  expires_at: string;
};

// Phase 1 (E.5A/E.5B) scope set — deliberately minimal. offline_access is
// required by the Microsoft identity platform to receive a refresh token
// at all (the Microsoft equivalent of Google's access_type=offline).
// Calendars.Read is requested now (even though E.5A never calls it) so
// E.5B's calendar read doesn't need a second re-consent round.
// Calendars.ReadWrite, Mail.Read, Mail.Send, Mail.ReadWrite, any
// Bookings/Files/Contacts/Directory scope are deliberately absent — not
// deferred by omission, but a considered exclusion documented here so a
// future phase can't accidentally widen this constant without noticing.
export const MS365_SCOPES = 'openid profile email offline_access Calendars.Read';

function tokenEndpoint(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

// Reads the single stored connection, decrypted. Returns null if none
// exists, or if decryption fails (a corrupted/foreign-key row should
// never crash a caller — it should look exactly like "not connected").
export async function readConnection(): Promise<MicrosoftConnection | null> {
  const rows = await sql`
    SELECT account_email, ms_tenant_id, encrypted_access_token, encrypted_refresh_token, expires_at
    FROM microsoft_connections
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const row = rows[0] as StoredRow | undefined;
  if (!row) return null;

  try {
    return {
      accountEmail: row.account_email,
      tenantId: row.ms_tenant_id,
      accessToken: decrypt(row.encrypted_access_token),
      refreshToken: decrypt(row.encrypted_refresh_token),
      expiresAt: new Date(row.expires_at).getTime(),
    };
  } catch (err) {
    console.error('[microsoft/tokens] decrypt failed:', (err as Error).message);
    return null;
  }
}

// Cheap presence/identity check for status display — deliberately does
// NOT decrypt anything (account_email is not itself encrypted), matching
// how little the existing Gmail/GCal status routes need to prove
// "connected".
export async function getConnectionSummary(): Promise<{ accountEmail: string } | null> {
  const rows = await sql`
    SELECT account_email FROM microsoft_connections ORDER BY created_at DESC LIMIT 1
  `;
  const row = rows[0] as { account_email: string } | undefined;
  return row ? { accountEmail: row.account_email } : null;
}

// Atomic replace: at most one row ever exists. Access/refresh tokens are
// encrypted before they ever reach the database.
export async function writeConnection(conn: {
  accountEmail: string;
  tenantId: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}): Promise<void> {
  const encryptedAccess = encrypt(conn.accessToken);
  const encryptedRefresh = encrypt(conn.refreshToken);
  const expiresAtIso = new Date(conn.expiresAt).toISOString();

  await sql.transaction([
    sql`DELETE FROM microsoft_connections`,
    sql`
      INSERT INTO microsoft_connections
        (account_email, ms_tenant_id, encrypted_access_token, encrypted_refresh_token, expires_at)
      VALUES (${conn.accountEmail}, ${conn.tenantId}, ${encryptedAccess}, ${encryptedRefresh}, ${expiresAtIso}::timestamptz)
    `,
  ]);
}

export async function clearConnection(): Promise<void> {
  await sql`DELETE FROM microsoft_connections`;
}

// Refreshes the stored connection's access token via Microsoft's token
// endpoint. Preserves the existing refresh token if Microsoft's response
// doesn't include a replacement — Microsoft does not guarantee a new
// refresh_token on every refresh call, and treating its absence as "the
// old one is now gone" would silently break the connection.
async function refreshAccessToken(conn: MicrosoftConnection): Promise<MicrosoftConnection | null> {
  const tenantId = conn.tenantId ?? process.env.MS365_TENANT_ID;
  const clientId = process.env.MS365_CLIENT_ID;
  const clientSecret = process.env.MS365_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) return null;

  let res: Response;
  try {
    res = await fetch(tokenEndpoint(tenantId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: conn.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        scope: MS365_SCOPES,
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token) return null;

  const updated: MicrosoftConnection = {
    accountEmail: conn.accountEmail,
    tenantId: conn.tenantId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? conn.refreshToken, // preserve if absent
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  await writeConnection(updated);
  return updated;
}

// Structurally supported for a future consumer (E.5B's calendar read) —
// not called anywhere in E.5A, which never fetches calendar/mail data.
// Mirrors lib/gmail/tokens.ts's getValidAccessToken(): a 60s expiry
// buffer, refresh-then-null-on-failure.
export async function getValidAccessToken(): Promise<string | null> {
  const conn = await readConnection();
  if (!conn) return null;
  if (Date.now() < conn.expiresAt - 60_000) return conn.accessToken;
  const refreshed = await refreshAccessToken(conn);
  return refreshed?.accessToken ?? null;
}
