import { SchedulingError } from './persistence';

// Bounded retry for the ONE failure that is known to be safe to repeat: a lock wait that timed
// out (SchedulingError.code === 'contention_timeout').
//
// Why that failure is safe: the database aborts the whole statement when lock_timeout fires, and
// every scheduling operation is a single statement (one implicit transaction), so nothing was
// written. A repeated create therefore cannot double-book, and the idempotency key additionally
// makes a repeat after an ambiguous outcome (a lost response) return the original reservation.
//
// Why nothing else is retried: capacity_exceeded / resource_conflict are real answers, a
// deadlock (40P01) or serialization failure (40001) is a defect this schema is built to prevent
// and must stay visible, and a connection error may have committed (outcome unknown), so it is
// the caller's decision, not an automatic one.
//
// This helper is opt-in and is not wired into any repository. A host calls it as
//   retryOnContention(() => repo.create(...), INTERACTIVE_RETRY, { sleep, random })
// with its own sleep and random (the core has no timers or randomness).

export interface RetryPolicy {
  /** Total attempts including the first. Default 2 for a user waiting on a response. */
  readonly maxAttempts: number;
  /** First backoff; doubled each retry, then jittered. */
  readonly baseDelayMs: number;
  /** Upper bound for a single backoff. */
  readonly maxDelayMs: number;
}

/** A person is waiting: one retry only, because each attempt may itself wait up to 5 seconds. */
export const INTERACTIVE_RETRY: RetryPolicy = Object.freeze({ maxAttempts: 2, baseDelayMs: 250, maxDelayMs: 1000 });
/** A background job (reminders, series top-up): up to three attempts with a longer backoff. */
export const BACKGROUND_RETRY: RetryPolicy = Object.freeze({ maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 4000 });

export interface RetryEnvironment {
  /** Supplied by the host (the core has no timers): resolves after `ms`. Tests pass a recorder. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Supplied by the host (the core has no randomness): returns [0, 1) for jitter. */
  readonly random: () => number;
  /** Called before each retry, for logging and metrics. */
  readonly onRetry?: (info: { attempt: number; delayMs: number; error: SchedulingError }) => void;
}

/** Full-jitter exponential backoff, bounded: delay in [0, min(maxDelay, base * 2^(attempt-1))). */
export function backoffDelayMs(policy: RetryPolicy, attempt: number, random: () => number): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
}

export async function retryOnContention<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy,
  env: RetryEnvironment,
): Promise<T> {
  const attempts = Math.max(1, Math.min(Math.floor(policy.maxAttempts), 5)); // never unbounded
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (err) {
      const retryable = err instanceof SchedulingError && err.retryable;
      if (!retryable || attempt >= attempts) throw err;
      const delayMs = backoffDelayMs(policy, attempt, env.random);
      env.onRetry?.({ attempt, delayMs, error: err });
      await env.sleep(delayMs);
    }
  }
}

/**
 * The customer-facing shape of a reservation: the internal resource (provider's room, table,
 * court) is not part of it. Hosts render this to public and customer actors.
 */
export function withoutInternalResource<T extends { resourceId: string | null }>(reservation: T): Omit<T, 'resourceId'> {
  const { resourceId: _internal, ...rest } = reservation;
  void _internal;
  return rest;
}
