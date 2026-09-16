// D.4.7B-R1 — server-ordering hardening for rapid sequential edits to the
// same item+field.
//
// D.4.7B's own sequence-number guard (itemOpSeqRef) only decided which
// RESPONSE the client trusted for its own optimistic-UI bookkeeping — it
// never prevented two overlapping REQUESTS for the same key from being
// dispatched to the server back-to-back. Since the PATCH route does an
// unconditional field overwrite (not a compare-and-swap keyed to a version/
// timestamp), whichever request physically commits LAST at the server wins
// server-side truth, regardless of which response the client's own sequence
// guard chose to display. A network-delayed earlier request arriving after
// a later one could leave the server on a stale value while the client
// correctly displayed the newer one — client and server diverging, exactly
// the gap this module closes.
//
// The only way to guarantee server commit order from a client that cannot
// control network/server scheduling is to never let two requests for the
// same key be in flight at once: enqueueCoalesced guarantees at most one
// `run(value)` call per key is ever outstanding. A value submitted while
// one is already in flight REPLACES whatever was previously pending (never
// queues more than one — only the latest intent matters) and is not sent
// until the in-flight call has fully settled, repeating until nothing is
// left pending. This is deliberately NOT a generic job queue/scheduler —
// no priorities, no cancellation, no retry-on-failure — just the one
// guarantee this phase needs.
//
// Pure, dependency-free, and framework-agnostic on purpose: no React, no
// fetch, no DOM — so it can be exercised with real async/await and
// controllable promise timing in this repo's plain-Node vitest environment
// (see coalescingMutationQueue.test.ts), rather than only proven via
// static source-text containment.

export type CoalescingQueueState<T> = { inFlight: boolean; pending: T | null };
export type CoalescingQueueMap<T> = Record<string, CoalescingQueueState<T>>;

/**
 * Ensures at most one `run(value)` call is ever in flight for `key` at a
 * time. If called again for the same key while a run is already in flight,
 * `value` replaces any previously pending value for that key (never more
 * than one pending entry) and returns immediately without starting a new,
 * overlapping `run` — the in-flight call's own completion drives the next
 * `run` for that replacement value.
 *
 * `run` receives `hasNewerPending()`, a live check (valid only for the
 * duration of that specific `run` call) telling the caller whether a newer
 * value has already been queued behind it by the time it finishes its own
 * work — the caller uses this to decide whether ITS OWN outcome (success or
 * failure) is the final word for this key (safe to reconcile/report now) or
 * merely an intermediate step a newer value is about to supersede.
 */
export async function enqueueCoalesced<T>(
  map: CoalescingQueueMap<T>,
  key: string,
  value: T,
  run: (value: T, hasNewerPending: () => boolean) => Promise<void>,
): Promise<void> {
  const entry = map[key] ?? (map[key] = { inFlight: false, pending: null });

  if (entry.inFlight) {
    entry.pending = value;
    return;
  }

  entry.inFlight = true;
  let current = value;
  for (;;) {
    await run(current, () => entry.pending !== null);
    if (entry.pending === null) break;
    current = entry.pending;
    entry.pending = null;
  }
  entry.inFlight = false;
}
