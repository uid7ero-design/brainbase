"use client";

// Data Hub 5A.3C.1 — the React/orchestrator integration boundary.
//
// The shipped orchestrator (lib/data-hub/client/orchestrator.ts) already
// exposes exactly the (subscribe, getSnapshot) shape useSyncExternalStore
// expects — subscribe(listener) returns an unsubscribe function, getState()
// returns a snapshot. This hook is a thin adapter, not a rewrite: it never
// duplicates orchestrator state in React state, never introduces a second
// state machine, and never imports @vercel/blob/client (the shipped client
// owns Blob behavior entirely — see blobUpload.ts).
//
// LIFECYCLE SAFETY (Strict Mode) — 5A.3C.1-R1 remediation.
//
// PRIOR APPROACH (removed): `useState(() => factory())` to construct the
// session once, disposing it in a `useEffect` cleanup keyed on that same
// stable instance. This was INDEPENDENTLY PROVEN UNSAFE under React Strict
// Mode's dev-only effect setup/cleanup/setup double-invocation: because
// `useState`'s lazy initializer commits exactly ONE instance for the
// component's entire lifetime, the phantom cleanup call disposed that SAME
// instance the component kept using — and the shipped orchestrator's
// subscribe()/start() have no disposed-guard (only setState() no-ops after
// disposal), so a subsequent start() on the (still-referenced, now
// permanently-disposed) instance issued a REAL network call while the UI
// never observed any resulting state change (frozen at {phase:"idle"}
// forever). See tests/containment/dataHubImportSessionHook.test.ts's
// RTEST1/RTEST2 for the empirical proof of both the old defect and the fix
// below.
//
// FIX: construct the session INSIDE the effect itself, not via a
// useState/useRef lazy initializer. This is React's own documented pattern
// for an imperative resource with a real construct/destroy lifecycle
// (https://react.dev/learn/synchronizing-with-effects) — it works under
// Strict Mode specifically BECAUSE the second "setup" call constructs a
// genuinely FRESH instance rather than reusing (and re-poisoning) the one
// the phantom cleanup already disposed. Session starts `null` for exactly
// one render (construction has zero side effects — no network call, no
// subscription — until subscribe()/start() are explicitly invoked later,
// so this is not a "duplicate upload" risk); `session` becomes non-null
// once the effect's setSession call commits, and stays that single,
// never-disposed instance for the rest of the component's real lifetime.
// Ordinary rerenders never re-run this effect (empty dependency array), so
// no replacement session is ever constructed outside of mount (R1-C). A
// genuine final unmount's cleanup disposes exactly the instance that was
// actually used (R1-D).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  createIllegalDumpingImportSession,
  type DataHubIllegalDumpingImportSession,
  type DataHubImportState,
} from "@/lib/data-hub/client/orchestrator";

const IDLE_STATE: DataHubImportState = { phase: "idle" };

/**
 * Mirrors the hook's own construction-effect setup/cleanup pair exactly,
 * for lifecycle probes without a DOM (RTEST3/RTEST4/RTEST5). `onSession`
 * mirrors the effect's `setSession` call; the returned function mirrors
 * the effect's cleanup.
 */
export function mountSessionEffect(
  factory: () => DataHubIllegalDumpingImportSession,
  onSession: (session: DataHubIllegalDumpingImportSession) => void
): () => void {
  const instance = factory();
  onSession(instance);
  return () => instance.dispose();
}

/**
 * Simulates React Strict Mode's dev-only mount -> cleanup -> remount
 * double-invocation of a SINGLE effect, exactly as this hook's own
 * construction effect is structured (setup, in declaration order; then
 * cleanup, then setup again, all synchronously around the initial commit,
 * before any real user interaction is possible). Returns the FINAL live
 * session (the one a real mounted component ends up bound to, and the one
 * a genuine unmount's cleanup will eventually dispose) plus every session
 * that was disposed along the way, so a test can prove the final session
 * was never among the disposed ones (RTEST1).
 */
export function simulateStrictModeSessionOwnership(
  factory: () => DataHubIllegalDumpingImportSession
): {
  finalSession: DataHubIllegalDumpingImportSession;
  disposedSessions: DataHubIllegalDumpingImportSession[];
  finalCleanup: () => void;
} {
  const disposedSessions: DataHubIllegalDumpingImportSession[] = [];
  let currentSession!: DataHubIllegalDumpingImportSession;

  // Setup #1 (Strict Mode's first, phantom mount)
  let cleanup = mountSessionEffect(factory, (s) => {
    currentSession = s;
  });
  // Strict Mode's phantom cleanup — disposes the FIRST instance only.
  cleanup();
  disposedSessions.push(currentSession);
  // Setup #2 — the real, surviving mount. Constructs a BRAND NEW instance;
  // the component ends up bound to this one, which was never disposed.
  cleanup = mountSessionEffect(factory, (s) => {
    currentSession = s;
  });

  return { finalSession: currentSession, disposedSessions, finalCleanup: cleanup };
}

export function useDataHubImportSession(): {
  state: DataHubImportState;
  session: DataHubIllegalDumpingImportSession | null;
} {
  const [session, setSession] = useState<DataHubIllegalDumpingImportSession | null>(null);

  useEffect(() => {
    const instance = createIllegalDumpingImportSession();
    // This is the officially-documented exception to "avoid setState in an
    // effect": constructing and exposing a real, disposable external
    // resource IS the effect's job here (the exact "Controlling a non-React
    // widget" category from https://react.dev/learn/synchronizing-with-effects),
    // not a derived-state anti-pattern. This exact construct-in-effect
    // shape is also the empirically-proven FIX for the Strict-Mode dispose-
    // before-use defect this remediation addresses (see
    // tests/containment/dataHubImportSessionHook.test.ts's RTEST1/RTEST2)
    // — a useState/useRef lazy initializer cannot be used here precisely
    // because it would commit only ONE instance for the component's whole
    // lifetime, which Strict Mode's phantom cleanup would then permanently
    // dispose.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(instance);
    return () => {
      instance.dispose();
    };
  }, []);

  // Stabilized subscribe/getSnapshot identity (review Section N, non-
  // blocking cleanup folded into this same remediation per spec Section 8)
  // — changes only when `session` itself transitions (null -> the one real
  // instance), not on every render, avoiding unnecessary
  // resubscribe/unsubscribe churn in useSyncExternalStore.
  const subscribe = useCallback(
    (listener: () => void) => (session ? session.subscribe(listener) : () => {}),
    [session]
  );
  const getSnapshot = useCallback(() => (session ? session.getState() : IDLE_STATE), [session]);
  const getServerSnapshot = useCallback(() => IDLE_STATE, []);

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return { state, session };
}
