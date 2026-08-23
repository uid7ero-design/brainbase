import 'server-only';
import sql from '@/lib/db';
import { decrypt } from '@/lib/social/crypto';
import { readTokens as readGmailTokens } from '@/lib/gmail/tokens';
import { readAllTokens as readGcalTokens } from '@/lib/gcal/tokens';
import { getConnectionSummary as getMicrosoftConnectionSummary } from '@/lib/microsoft/tokens';
import { resolveBrainbaseOrgId } from '@/lib/founder/tasksBoard';

// Founder OS Phase E.1 — real system-health signals, built ONLY from
// sources verified to actually exist in Production (Phase E.0's audit
// found several repository-suggested sources — integrations, sync_jobs,
// agent_runs, users.last_seen_at — do NOT exist in Production; a
// read-only Production check additionally found users.last_login_at is
// populated for 0 of 5 users, so it is not a usable activity signal
// either. None of those are used anywhere in this file.
//
// No auth check happens in this file, matching the established
// lib/founder/tasksBoard.ts convention: the calling route
// (app/api/founder/system/route.ts) enforces the super_admin gate once,
// the same way every other founder/* route does. These are pure,
// unauthenticated-by-design data readers — callers are responsible for
// gating access.

// ── A. Application / deployment identity ───────────────────────────────────
// Vercel's own auto-injected runtime env vars — zero new credentials, zero
// new integration. Identity only, never a health/uptime claim: a known
// commit does not mean the app is working, it just means we know what's
// deployed.

export type ApplicationIdentity = {
  environment: string;      // e.g. 'production' | 'preview' | 'development', or 'Unknown'
  commitSha: string | null;
  commitShaShort: string | null;
  commitMessage: string | null;
};

export function getApplicationIdentity(): ApplicationIdentity {
  const environment = process.env.VERCEL_ENV ?? 'Unknown';
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null;
  return {
    environment,
    commitSha,
    commitShaShort: commitSha ? commitSha.slice(0, 7) : null,
    commitMessage,
  };
}

// ── B. Database — live, single-request check only ──────────────────────────
// Deliberately NOT calling the existing public GET /api/health/db from the
// frontend (would needlessly widen the surface a founder-facing UI depends
// on to an unauthenticated route) — this runs the exact same trivial
// SELECT 1, timed the same way, directly inside the already-super_admin-
// gated founder system endpoint instead. latencyMs is this one request's
// round trip only — never an average, never an SLA, never a history (none
// is stored).

export type DatabaseStatus = {
  ok: boolean;
  latencyMs: number | null;
};

export async function checkDatabase(): Promise<DatabaseStatus> {
  const start = Date.now();
  try {
    await sql`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

// ── C. BrainBase service connections ────────────────────────────────────────

export type ConnectionState = 'connected' | 'not_connected' | 'connected_issue' | 'unknown';

// Gmail/Google Calendar: PRESENCE semantics only (matching the existing
// GET /api/integrations/{gmail,gcal}/status routes exactly — readTokens()/
// readAllTokens() are the same plain, synchronous, global (non-org-scoped)
// file reads those routes already use). No live Google API call is made —
// "connected" here means "an OAuth token is stored", not "Google's API is
// currently reachable". Token storage is documented in
// lib/globalIntegrationAccess.ts as global/non-org-scoped, temporary
// containment — unchanged by this phase.
//
// Access boundary: those routes gate access via
// requireGlobalIntegrationAccess(ownerOrgEnvVar, 'viewer'), which always
// allows super_admin unconditionally. Founder OS's own gate
// (requireFounderSession(), super_admin-only) is a strict superset of
// that rule for every caller who can reach this file — so the existing
// access boundary is respected by construction, without a second
// redundant auth round trip here (consistent with how every other
// lib/founder/* helper — e.g. resolveBrainbaseOrgId() — has no auth logic
// of its own either; the calling route enforces it once).

export function getGmailState(): ConnectionState {
  try {
    return readGmailTokens() ? 'connected' : 'not_connected';
  } catch {
    return 'unknown';
  }
}

export function getGoogleCalendarState(): ConnectionState {
  try {
    return readGcalTokens().length > 0 ? 'connected' : 'not_connected';
  } catch {
    return 'unknown';
  }
}

// Microsoft 365: PRESENCE semantics only, matching Gmail/GCal exactly —
// "connected" means a stored connection row exists in Neon (see
// lib/microsoft/tokens.ts's getConnectionSummary()), never "Microsoft
// Graph is currently reachable". Unlike Gmail/GCal, this is a database
// read (async) rather than a synchronous file read, and unlike Gmail/
// GCal's plaintext file store, the underlying row's tokens are
// encrypted at rest — but the STATUS SIGNAL ITSELF carries the exact
// same truthful meaning as the other two: connection presence, not
// live health. No Graph API call is made here — E.5A never fetches
// calendar/mail/contacts/files.
export async function getMicrosoftState(): Promise<ConnectionState> {
  try {
    const connection = await getMicrosoftConnectionSummary();
    return connection ? 'connected' : 'not_connected';
  } catch {
    return 'unknown';
  }
}

// Instagram: BrainBase's own connection specifically — resolved via the
// same impersonation-proof organisation lookup lib/founder/tasksBoard.ts
// already established for Founder Tasks (resolveBrainbaseOrgId(), a fixed
// slug lookup that ignores any active super_admin org_override
// impersonation cookie). Deliberately NOT using lib/org.ts's
// requireSession()/getAuthSession() here, and NOT reusing
// GET /api/instagram/feed as-is — that route resolves organisation_id from
// the caller's own (impersonation-aware) session, which would show a
// super_admin impersonating another org THAT org's Instagram connection
// instead of BrainBase's own.
//
// Unlike Gmail/GCal, this performs the same one live Graph API media call
// GET /api/instagram/feed already makes when a usable connection exists,
// so it can distinguish 'connected' from 'connected_issue' (token stored,
// but the live check just failed) — never exposing the raw Graph API error
// text (which could, depending on the failure, echo back request details)
// to the client; only a state enum.
//
// READ-ONLY: never writes social_connections, never touches the OAuth
// flow, never mutates anything.
function decryptOrLegacyPlaintext(value: string): string {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

export async function getInstagramState(): Promise<ConnectionState> {
  try {
    const orgId = await resolveBrainbaseOrgId();
    if (!orgId) return 'unknown';

    const rows = await sql`
      SELECT access_token, instagram_account_id
      FROM social_connections
      WHERE organisation_id = ${orgId} AND platform = 'instagram'
      LIMIT 1
    `;
    const conn = rows[0] as { access_token: string; instagram_account_id: string | null } | undefined;
    if (!conn) return 'not_connected';
    if (!conn.instagram_account_id) return 'connected';

    const bearerToken = decryptOrLegacyPlaintext(conn.access_token);
    const mediaRes = await fetch(
      `https://graph.facebook.com/v21.0/${conn.instagram_account_id}/media?fields=id&limit=1&access_token=${bearerToken}`,
    );
    const mediaData = await mediaRes.json() as { error?: { message: string } };
    return mediaData.error ? 'connected_issue' : 'connected';
  } catch {
    return 'unknown';
  }
}
