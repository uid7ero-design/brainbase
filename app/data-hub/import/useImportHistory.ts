"use client";

// Data Hub 5A.3D.2 — history-list data fetching. Deliberately INDEPENDENT of
// any single DataHubIllegalDumpingImportSession instance — listing history is
// not part of any one import's own state machine, and this hook never
// constructs/disposes a session. Uses the EXISTING canonical listImportBatches
// (re-exported from lib/data-hub/client/orchestrator.ts — a thin passthrough
// to httpClient.ts, kept there rather than imported here directly to
// preserve this package's own tested "UI never imports httpClient.ts
// directly" boundary) exclusively — no new backend endpoint, no per-row
// worksheet/detail fetch (N+1 hard rule, spec Section 10): this hook calls
// listImportBatches exactly once per initial load and exactly once per
// loadMore() call, never once per row.
import { useEffect, useReducer, useRef } from "react";
import { listImportBatches } from "@/lib/data-hub/client/orchestrator";
import { importHistoryReducer, INITIAL_HISTORY_STATE, type ImportHistoryState } from "./importHistoryReducer";

/** Bounded first page — a compact "recent imports" list, not the full
 * history. Load More requests the same page size via the existing
 * nextCursor contract. */
const HISTORY_PAGE_SIZE = 5;

const GENERIC_LOAD_ERROR = "Couldn't load import history.";
const GENERIC_LOAD_MORE_ERROR = "Couldn't load more import history.";

export function useImportHistory(): { state: ImportHistoryState; loadMore: () => void } {
  const [state, dispatch] = useReducer(importHistoryReducer, INITIAL_HISTORY_STATE);
  // Bounds concurrent loadMore() calls to exactly one in flight — a rapid
  // double-click issues only one request, never two overlapping ones.
  const loadMoreInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "LOAD_START" });
    void listImportBatches({ limit: HISTORY_PAGE_SIZE }).then((result) => {
      if (cancelled) return;
      if (result.kind !== "response" || !("batches" in result.body)) {
        dispatch({ type: "LOAD_FAILURE", error: GENERIC_LOAD_ERROR });
        return;
      }
      dispatch({
        type: "LOAD_SUCCESS",
        rows: result.body.batches,
        hasNextPage: result.body.hasNextPage,
        nextCursor: result.body.nextCursor,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function loadMore() {
    // T21 (list-scoped equivalent): stop when hasNextPage=false — never
    // reuse a stale/terminal cursor (spec Section 21).
    if (loadMoreInFlightRef.current) return;
    if (!state.hasNextPage || state.nextCursor === null) return;
    loadMoreInFlightRef.current = true;
    dispatch({ type: "LOAD_MORE_START" });
    void listImportBatches({ limit: HISTORY_PAGE_SIZE, cursor: state.nextCursor }).then((result) => {
      loadMoreInFlightRef.current = false;
      if (result.kind !== "response" || !("batches" in result.body)) {
        dispatch({ type: "LOAD_MORE_FAILURE", error: GENERIC_LOAD_MORE_ERROR });
        return;
      }
      dispatch({
        type: "LOAD_MORE_SUCCESS",
        rows: result.body.batches,
        hasNextPage: result.body.hasNextPage,
        nextCursor: result.body.nextCursor,
      });
    });
  }

  return { state, loadMore };
}
