/**
 * Module-level sliding-window rate limiter.
 * Resets on cold starts — acceptable for a serverless MVP.
 * Upgrade to Upstash Redis for distributed rate limiting when needed.
 */

type Entry = { count: number; resetAt: number };
const store = new Map<string, Entry>();

// Prune stale entries every 100 calls to prevent unbounded growth
let callCount = 0;
function maybePrune() {
  if (++callCount % 100 !== 0) return;
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.resetAt < now) store.delete(k);
  }
}

/**
 * Returns true if the request is allowed, false if rate-limited.
 * @param key        Unique key (e.g. `login:1.2.3.4`)
 * @param max        Max attempts per window (default 10)
 * @param windowMs   Window length in ms (default 15 min)
 */
export function checkRateLimit(key: string, max = 10, windowMs = 15 * 60_000): boolean {
  maybePrune();
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

/** Reset the counter for a key (call on successful auth). */
export function resetRateLimit(key: string): void {
  store.delete(key);
}
