"use client";

// Data Hub 6.2C3 — loads the read-only automatic reporting-period detection
// for the worksheet under review. Mirrors useSourceMappings.ts's reducer +
// cancellable-effect shape. Goes through the session object only (never
// httpClient.ts directly — this package's tested module boundary).
//
// Fetches only when `enabled` (worksheet unlocked AND the batch has a
// governing source). Every failure — server error, transport uncertainty,
// or an unexpected throw — lands on the single non-blocking "failed"
// status; it never affects manual selection or Confirm.
import { useEffect, useReducer } from "react";
import type { DataHubIllegalDumpingImportSession } from "@/lib/data-hub/client/orchestrator";
import type { PeriodDetectionClient } from "@/lib/data-hub/client/types";
import type { PeriodDetectionLoadState } from "./periodDetectionCopy";

type PeriodDetectionAction =
  | { type: "RESET" }
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS"; detection: PeriodDetectionClient }
  | { type: "LOAD_FAILURE" };

function periodDetectionReducer(state: PeriodDetectionLoadState, action: PeriodDetectionAction): PeriodDetectionLoadState {
  switch (action.type) {
    case "RESET":
      return { status: "notRequested" };
    case "LOAD_START":
      return { status: "loading" };
    case "LOAD_SUCCESS":
      return { status: "loaded", detection: action.detection };
    case "LOAD_FAILURE":
      return { status: "failed" };
    default:
      return state;
  }
}

export function usePeriodDetection(
  session: DataHubIllegalDumpingImportSession,
  worksheetId: string,
  enabled: boolean
): PeriodDetectionLoadState {
  const [state, dispatch] = useReducer(periodDetectionReducer, { status: enabled ? "loading" : "notRequested" });

  useEffect(() => {
    if (!enabled) {
      dispatch({ type: "RESET" });
      return;
    }
    let cancelled = false;
    dispatch({ type: "LOAD_START" });
    session
      .loadPeriodDetection()
      .then((result) => {
        if (cancelled) return;
        if (result.status !== "loaded") {
          dispatch({ type: "LOAD_FAILURE" });
          return;
        }
        dispatch({ type: "LOAD_SUCCESS", detection: result.detection });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "LOAD_FAILURE" });
      });
    return () => {
      cancelled = true;
    };
  }, [session, worksheetId, enabled]);

  return state;
}
