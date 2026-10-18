import 'server-only';
import { createHash } from 'node:crypto';
import sql from '@/lib/db';
import { checkRateLimit } from '@/lib/rateLimit';

// Distributed (shared across serverless instances) rate limiting for the
// ticketing API, backed by the ticketing_rate_limits table.
//
// ABUSE PROTECTION ONLY. A counter here is never an authorisation decision,
// never a payment-idempotency key and never a capacity guard: every order,
// charge and reservation keeps its own database-level guards, and a limiter
// "allowed" proves nothing about the caller.
//
// Storage: key_hash = SHA-256(class + canonical dimensions). The dimensions
// (IP, user id, organisation id, event id, a username) are hashed together
// with the class, so no email, address, id, token or secret is stored in the
// clear and keys from different classes or tenants cannot collide.
//
// Windows are FIXED windows aligned to the epoch (a client can briefly burst
// up to twice the limit across a boundary — acceptable for these limits).
//
// Failure behaviour is explicit per policy:
//   'closed'   the limiter being unreachable DENIES (503) — used where a
//              missing limit is itself the risk (login, future mutations);
//   'fallback' the limiter being unreachable falls back to the original
//              per-instance in-memory limiter (never weaker than before this
//              phase) and is logged as degraded mode.

export type LimitOutage = 'closed' | 'fallback';

export type LimitPolicy = {
  cls: string;
  max: number;
  windowSeconds: number;
  outage: LimitOutage;
};

export type LimitDecision =
  | { allowed: true; degraded: boolean }
  | { allowed: false; reason: 'LIMITED' }
  | { allowed: false; reason: 'UNAVAILABLE' };

// ── Policies (one place; see docs/architecture/decisions/0012-…) ─────────

const HOUR = 3600;
export const LIMITS = {
  // Credential attempts: per client address, and per (hashed) username.
  loginIp: { cls: 'eve-login-ip', max: 30, windowSeconds: 15 * 60, outage: 'closed' },
  loginUser: { cls: 'eve-login-user', max: 10, windowSeconds: 15 * 60, outage: 'closed' },
  // Public buyer endpoints: per client address and event (same budgets as the
  // BrainBase public routes had).
  publicQuote: { cls: 'eve-public-quote', max: 120, windowSeconds: HOUR, outage: 'fallback' },
  freeRegistration: { cls: 'eve-free-registration', max: 10, windowSeconds: HOUR, outage: 'fallback' },
  paidCheckout: { cls: 'eve-paid-checkout', max: 10, windowSeconds: HOUR, outage: 'fallback' },
  ticketLookup: { cls: 'eve-ticket-lookup', max: 60, windowSeconds: HOUR, outage: 'fallback' },
  // Organiser surface: keyed by the VERIFIED user and organisation (never a
  // request value), and for the door by event as well.
  organiserRead: { cls: 'eve-organiser-read', max: 600, windowSeconds: 5 * 60, outage: 'fallback' },
  organiserMutation: { cls: 'eve-organiser-mutation', max: 60, windowSeconds: 5 * 60, outage: 'closed' }, // future-proof; no endpoint uses it yet
  checkInLookup: { cls: 'eve-checkin-lookup', max: 600, windowSeconds: 60, outage: 'fallback' },
  checkInMutation: { cls: 'eve-checkin-mutation', max: 300, windowSeconds: 60, outage: 'fallback' },
} as const satisfies Record<string, LimitPolicy>;

// ── Keys ────────────────────────────────────────────────────────────────

const SEP = '\u001f';

// Canonical, collision-safe hash of the class and its dimensions. Each
// dimension is length-prefixed so ("ab","c") and ("a","bc") differ.
export function limiterKeyHash(cls: string, dims: readonly string[]): string {
  const material = [cls, ...dims].map(d => `${d.length}:${d}`).join(SEP);
  return createHash('sha256').update(material).digest('hex');
}

// Never log identifiers: only a short prefix of the already-hashed key.
const logId = (hash: string) => hash.slice(0, 8);

function logEvent(evt: string, cls: string, extra: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify({ evt, cls, ...extra }));
}

// ── Bounded cleanup (about 1% of calls) ─────────────────────────────────

async function maybePrune(): Promise<void> {
  if (Math.random() >= 0.01) return;
  try {
    await sql`
      DELETE FROM ticketing_rate_limits
      WHERE (key_hash, window_start) IN (SELECT key_hash, window_start FROM ticketing_rate_limits WHERE expires_at < NOW() LIMIT 200)
    `;
  } catch {
    /* housekeeping only */
  }
}

// ── The limiter ─────────────────────────────────────────────────────────

// `fallbackKey` is the in-memory limiter key used ONLY when the shared store is
// unavailable under a 'fallback' policy (it is never persisted).
export async function limit(policy: LimitPolicy, dims: readonly string[], fallbackKey?: string): Promise<LimitDecision> {
  const hash = limiterKeyHash(policy.cls, dims);
  const w = policy.windowSeconds;
  try {
    const rows = (await sql`
      INSERT INTO ticketing_rate_limits (key_hash, window_start, count, expires_at)
      VALUES (
        ${hash},
        to_timestamp(floor(extract(epoch FROM NOW()) / ${w}) * ${w}),
        1,
        to_timestamp(floor(extract(epoch FROM NOW()) / ${w}) * ${w}) + make_interval(secs => ${w})
      )
      ON CONFLICT (key_hash, window_start) DO UPDATE SET count = ticketing_rate_limits.count + 1
      RETURNING count
    `) as { count: number }[];
    const count = rows?.[0]?.count;
    if (typeof count !== 'number') throw new Error('limiter returned no count');
    void maybePrune();
    if (count > policy.max) {
      logEvent('ticketing_rate_limited', policy.cls, { key: logId(hash) });
      return { allowed: false, reason: 'LIMITED' };
    }
    return { allowed: true, degraded: false };
  } catch {
    if (policy.outage === 'closed') {
      logEvent('ticketing_rate_limit_unavailable', policy.cls, { mode: 'closed' });
      return { allowed: false, reason: 'UNAVAILABLE' };
    }
    logEvent('ticketing_rate_limit_degraded', policy.cls, { mode: 'in-memory-fallback' });
    const ok = checkRateLimit(fallbackKey ?? `${policy.cls}:${hash}`, policy.max, w * 1000);
    return ok ? { allowed: true, degraded: true } : { allowed: false, reason: 'LIMITED' };
  }
}

// Clears the shared counters of one key (e.g. after a successful sign-in).
// Best-effort: a failure leaves the counter to expire on its own.
export async function resetLimit(policy: LimitPolicy, dims: readonly string[]): Promise<void> {
  try {
    await sql`DELETE FROM ticketing_rate_limits WHERE key_hash = ${limiterKeyHash(policy.cls, dims)}`;
  } catch {
    /* expires by itself */
  }
}
