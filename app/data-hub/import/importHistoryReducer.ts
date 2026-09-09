// Data Hub 5A.3D.2 — pure history-list state reducer. Kept separate from
// useImportHistory.ts (no React, no DOM) so it is independently, behaviorally
// testable under this repo's node-only Vitest environment, matching the
// established screenGroup.ts/confirmEligibility.ts pattern.
import type { ImportBatchSummaryDTOClient } from "@/lib/data-hub/client/types";

export interface ImportHistoryState {
  status: "loading" | "loaded" | "loadingMore" | "loadMoreFailed" | "error";
  rows: ImportBatchSummaryDTOClient[];
  hasNextPage: boolean;
  nextCursor: string | null;
  error: string | null;
}

export const INITIAL_HISTORY_STATE: ImportHistoryState = {
  status: "loading",
  rows: [],
  hasNextPage: false,
  nextCursor: null,
  error: null,
};

export type ImportHistoryAction =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS"; rows: ImportBatchSummaryDTOClient[]; hasNextPage: boolean; nextCursor: string | null }
  | { type: "LOAD_FAILURE"; error: string }
  | { type: "LOAD_MORE_START" }
  | { type: "LOAD_MORE_SUCCESS"; rows: ImportBatchSummaryDTOClient[]; hasNextPage: boolean; nextCursor: string | null }
  | { type: "LOAD_MORE_FAILURE"; error: string };

/**
 * Appends a fresh page's rows onto existing ones, de-duplicating by id.
 * Server ordering (newest-first keyset) is preserved exactly: existing rows
 * keep their position, and any incoming row whose id is already present is
 * dropped rather than re-inserted or reordered — a genuine, if unexpected,
 * server-side overlap between pages can never produce a duplicate rendered
 * row (spec Section 21 / T6).
 */
export function mergeHistoryPages(
  existing: ImportBatchSummaryDTOClient[],
  incoming: ImportBatchSummaryDTOClient[]
): ImportBatchSummaryDTOClient[] {
  const seen = new Set(existing.map((r) => r.id));
  const deduped = incoming.filter((r) => !seen.has(r.id));
  return [...existing, ...deduped];
}

export function importHistoryReducer(state: ImportHistoryState, action: ImportHistoryAction): ImportHistoryState {
  switch (action.type) {
    case "LOAD_START":
      return { ...INITIAL_HISTORY_STATE, status: "loading" };
    case "LOAD_SUCCESS":
      return { status: "loaded", rows: action.rows, hasNextPage: action.hasNextPage, nextCursor: action.nextCursor, error: null };
    case "LOAD_FAILURE":
      // T4: an initial-load failure never disables the new-import workflow
      // — this reducer only ever describes the history panel's own state,
      // never anything the caller (page.tsx/ImportFlow) reads to gate
      // FileSelector.
      return { status: "error", rows: [], hasNextPage: false, nextCursor: null, error: action.error };
    case "LOAD_MORE_START":
      // T7: existing rows/cursor preserved while a load-more is in flight.
      return { ...state, status: "loadingMore" };
    case "LOAD_MORE_SUCCESS":
      return {
        status: "loaded",
        rows: mergeHistoryPages(state.rows, action.rows),
        hasNextPage: action.hasNextPage,
        nextCursor: action.nextCursor,
        error: null,
      };
    case "LOAD_MORE_FAILURE":
      // T7: existing rows/cursor preserved on load-more failure — retry
      // remains possible (hasNextPage/nextCursor are untouched).
      return { ...state, status: "loadMoreFailed", error: action.error };
    default:
      return state;
  }
}
