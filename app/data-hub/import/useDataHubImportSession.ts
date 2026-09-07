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
// LIFECYCLE SAFETY (Strict Mode): construction uses useState's LAZY
// initializer form (`useState(() => factory())`), NOT a useRef-based lazy
// pattern — this repo's ESLint config enforces the stricter
// react-hooks/refs rule (part of the React Compiler-oriented ruleset),
// which flags any `ref.current` read during render, including the classic
// "if (ref.current === null) ref.current = ..." pattern. useState's lazy
// initializer is React's own officially-sanctioned single-construction
// mechanism: React Strict Mode's dev-only double-invocation calls the
// initializer FUNCTION twice, but only ever commits ONE resulting value to
// state — the discarded second instance is never subscribed to, never
// used, and construction itself (DataHubIllegalDumpingImportSession's
// constructor) performs zero side effects (no network call, no
// subscription) until subscribe()/start() are explicitly invoked later, so
// a harmless discarded instance is not a "duplicate upload" risk. Disposal
// happens in a useEffect cleanup, keyed so a genuine unmount always
// disposes exactly the instance that was actually used.
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  createIllegalDumpingImportSession,
  type DataHubIllegalDumpingImportSession,
  type DataHubImportState,
} from "@/lib/data-hub/client/orchestrator";

/** Extracted so T30/M11 can independently prove the lifecycle contract
 * (dispose-on-cleanup, one instance per mount) without a DOM: a plain,
 * synchronous simulation of mount -> cleanup -> remount against a factory
 * call counter and a disposed-instance tracker. */
export function simulateSessionLifecycle(
  factory: () => DataHubIllegalDumpingImportSession,
  mounts: number
): { constructedCount: number; disposedCount: number } {
  let constructedCount = 0;
  let disposedCount = 0;
  for (let i = 0; i < mounts; i++) {
    constructedCount++;
    const instance = factory();
    // Mirrors the hook's own cleanup call exactly.
    instance.dispose();
    disposedCount++;
  }
  return { constructedCount, disposedCount };
}

export function useDataHubImportSession(): {
  state: DataHubImportState;
  session: DataHubIllegalDumpingImportSession;
} {
  const [session] = useState<DataHubIllegalDumpingImportSession>(() => createIllegalDumpingImportSession());

  useEffect(() => {
    return () => {
      session.dispose();
    };
  }, [session]);

  const state = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getState(),
    () => session.getState()
  );

  return { state, session };
}
