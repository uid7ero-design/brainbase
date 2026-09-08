"use client";

// Data Hub 5A.3D.2 — direct recovery route's session hook.
//
// Mirrors ../useDataHubImportSession.ts's own construct-in-effect pattern
// EXACTLY (same reasoning applies verbatim: a useState/useRef lazy
// initializer would commit one instance for the component's whole lifetime,
// which Strict Mode's dev-only phantom cleanup would then permanently
// dispose while the component kept using it — see that file's own header
// comment for the full empirical proof this hook does not re-derive here).
//
// The ONE addition: once construction commits, this hook calls
// `resumeFromBatchId(batchId)` — an explicit consequence of navigating to
// THIS URL (spec Section 17: "the URL itself represents explicit user/
// navigation intent"), never invoked from anywhere else, never on the
// ordinary /data-hub/import page. `resumeFromBatchId` never throws (every
// error path resolves through the orchestrator's own setState — see
// orchestrator.ts's own resumeFromBatchId header comment), so no .catch is
// needed here, matching this codebase's existing convention for other
// fire-and-forget orchestrator calls (e.g. ReviewPanel's own
// `void session.loadPreview()`).
//
// STRICT MODE SAFETY: under the dev-only phantom mount -> cleanup -> remount
// double-invoke, the FIRST (phantom) instance's resumeFromBatchId call may
// still be in flight when that instance is disposed; its own
// `resumeGeneration`/`disposed` guard (5A.3D.1) makes that call's eventual
// resolution a no-op against the already-disposed instance. The SECOND
// (real, surviving) instance's own resumeFromBatchId call is entirely
// independent (its own generation counter starts fresh) and completes
// normally. At most one extra, fully-superseded GET is issued in dev Strict
// Mode only — never in production, and never a duplicate MUTATING call
// (resumeFromBatchId only ever reads).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  createIllegalDumpingImportSession,
  type DataHubIllegalDumpingImportSession,
  type DataHubImportState,
} from "@/lib/data-hub/client/orchestrator";

const IDLE_STATE: DataHubImportState = { phase: "idle" };

/**
 * Mirrors ../useDataHubImportSession.ts's own mountSessionEffect exactly,
 * plus the one addition this route makes: an explicit resumeFromBatchId
 * call right after construction. Exported so the Strict Mode double-invoke
 * proof below (and this hook's own effect) share the IDENTICAL code path —
 * a test exercising this function is a test of the real hook, not a
 * reimplementation of its logic.
 */
export function mountRecoverySessionEffect(
  factory: () => DataHubIllegalDumpingImportSession,
  batchId: string,
  onSession: (session: DataHubIllegalDumpingImportSession) => void
): () => void {
  const instance = factory();
  onSession(instance);
  void instance.resumeFromBatchId(batchId);
  return () => instance.dispose();
}

/**
 * Mirrors ../useDataHubImportSession.ts's own simulateStrictModeSessionOwnership
 * exactly (same reasoning: setup #1 constructs a phantom instance and is
 * immediately cleaned up; setup #2 constructs the real, surviving instance)
 * — see this file's own header comment for why this is safe for a
 * resumeFromBatchId call specifically.
 */
export function simulateStrictModeRecoverySessionOwnership(
  factory: () => DataHubIllegalDumpingImportSession,
  batchId: string
): {
  finalSession: DataHubIllegalDumpingImportSession;
  disposedSessions: DataHubIllegalDumpingImportSession[];
  finalCleanup: () => void;
} {
  const disposedSessions: DataHubIllegalDumpingImportSession[] = [];
  let currentSession!: DataHubIllegalDumpingImportSession;

  let cleanup = mountRecoverySessionEffect(factory, batchId, (s) => {
    currentSession = s;
  });
  cleanup();
  disposedSessions.push(currentSession);
  cleanup = mountRecoverySessionEffect(factory, batchId, (s) => {
    currentSession = s;
  });

  return { finalSession: currentSession, disposedSessions, finalCleanup: cleanup };
}

export function useDataHubRecoverySession(batchId: string): {
  state: DataHubImportState;
  session: DataHubIllegalDumpingImportSession | null;
} {
  const [session, setSession] = useState<DataHubIllegalDumpingImportSession | null>(null);

  useEffect(() => {
    return mountRecoverySessionEffect(createIllegalDumpingImportSession, batchId, setSession);
  }, [batchId]);

  const subscribe = useCallback(
    (listener: () => void) => (session ? session.subscribe(listener) : () => {}),
    [session]
  );
  const getSnapshot = useCallback(() => (session ? session.getState() : IDLE_STATE), [session]);
  const getServerSnapshot = useCallback(() => IDLE_STATE, []);

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return { state, session };
}
