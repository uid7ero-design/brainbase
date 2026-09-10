"use client";

// Data Hub 5B.5A — SourceSystem selection data fetching for the Select
// screen. Deliberately independent of any DataHubIllegalDumpingImportSession
// instance, mirroring useImportHistory.ts's own established rationale:
// listing SourceSystems is not part of any one import's own state machine.
// Uses the EXISTING canonical listSourceSystems (re-exported from
// lib/data-hub/client/orchestrator.ts — a thin passthrough to httpClient.ts,
// kept there rather than imported here directly, to preserve this package's
// existing, tested "UI never imports httpClient.ts directly" boundary) —
// no new backend endpoint, no admin-only field, no mapping-related field.
//
// useReducer, not useState — mirrors useImportHistory.ts's own dispatch-based
// convention exactly, and (load-bearing, not merely stylistic) a reducer's
// dispatch is exempt from this repo's ESLint react-hooks/set-state-in-effect
// rule the way a raw useState setter is not.
import { useEffect, useReducer } from "react";
import { listSourceSystems } from "@/lib/data-hub/client/orchestrator";
import type { SourceSystemDTOClient } from "@/lib/data-hub/client/types";

// A manager-administered list — expected to be small. Requesting the
// server's own max page size in one shot avoids building "load more"
// pagination for a <select>, which is out of scope for this slice; an org
// with more than this many configured SourceSystems is a future concern,
// not a 5B.5A blocker.
const SOURCE_SYSTEM_PAGE_SIZE = 100;

const GENERIC_LOAD_ERROR = "Couldn't load source systems.";

export type SourceSystemsLoadState =
  | { status: "loading" }
  | { status: "success"; sourceSystems: SourceSystemDTOClient[] }
  | { status: "error"; message: string };

type SourceSystemsAction =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS"; sourceSystems: SourceSystemDTOClient[] }
  | { type: "LOAD_FAILURE"; message: string };

function sourceSystemsReducer(_state: SourceSystemsLoadState, action: SourceSystemsAction): SourceSystemsLoadState {
  switch (action.type) {
    case "LOAD_START":
      return { status: "loading" };
    case "LOAD_SUCCESS":
      return { status: "success", sourceSystems: action.sourceSystems };
    case "LOAD_FAILURE":
      return { status: "error", message: action.message };
    default:
      return _state;
  }
}

export function useSourceSystems(): SourceSystemsLoadState {
  const [state, dispatch] = useReducer(sourceSystemsReducer, { status: "loading" });

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "LOAD_START" });
    void listSourceSystems({ limit: SOURCE_SYSTEM_PAGE_SIZE }).then((result) => {
      if (cancelled) return;
      if (result.kind !== "response" || !("sourceSystems" in result.body)) {
        dispatch({ type: "LOAD_FAILURE", message: GENERIC_LOAD_ERROR });
        return;
      }
      dispatch({ type: "LOAD_SUCCESS", sourceSystems: result.body.sourceSystems });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
