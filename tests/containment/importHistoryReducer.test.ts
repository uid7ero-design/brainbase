import { describe, it, expect } from "vitest";
import {
  importHistoryReducer,
  mergeHistoryPages,
  INITIAL_HISTORY_STATE,
  type ImportHistoryState,
} from "../../app/data-hub/import/importHistoryReducer";
import type { ImportBatchSummaryDTOClient } from "../../lib/data-hub/client/types";

// Data Hub 5A.3D.2 — real behavioral tests for the pure history-list
// reducer (no React/DOM involved — this module is plain data). Covers
// T2/T3/T5-T8/T20.

function row(id: string, overrides: Partial<ImportBatchSummaryDTOClient> = {}): ImportBatchSummaryDTOClient {
  return {
    id,
    status: "READY",
    originalFilename: `${id}.csv`,
    contentType: "csv",
    sizeBytes: 100,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("T2/T3: history ordering + empty state", () => {
  it("LOAD_SUCCESS with zero rows produces an explicit, empty 'loaded' state (semantic empty-state path)", () => {
    const state = importHistoryReducer(INITIAL_HISTORY_STATE, {
      type: "LOAD_SUCCESS",
      rows: [],
      hasNextPage: false,
      nextCursor: null,
    });
    expect(state.status).toBe("loaded");
    expect(state.rows).toEqual([]);
  });

  it("LOAD_SUCCESS preserves the exact server-supplied row order (never re-sorted)", () => {
    const serverRows = [row("c"), row("a"), row("b")]; // deliberately non-alphabetical
    const state = importHistoryReducer(INITIAL_HISTORY_STATE, {
      type: "LOAD_SUCCESS",
      rows: serverRows,
      hasNextPage: false,
      nextCursor: null,
    });
    expect(state.rows.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});

describe("T6/T21: mergeHistoryPages de-duplication and ordering", () => {
  it("appends new rows after existing ones, preserving order", () => {
    const merged = mergeHistoryPages([row("1"), row("2")], [row("3"), row("4")]);
    expect(merged.map((r) => r.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("drops an incoming row whose id already exists, never duplicating or reordering it (M14-equivalent: load-more duplication)", () => {
    const merged = mergeHistoryPages([row("1"), row("2")], [row("2"), row("3")]);
    expect(merged.map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(merged.filter((r) => r.id === "2")).toHaveLength(1);
  });
});

describe("T5/T8: LOAD_MORE_SUCCESS honors fresh hasNextPage/nextCursor", () => {
  it("stores the new page's hasNextPage/nextCursor exactly (does not reuse the prior page's cursor)", () => {
    const initial: ImportHistoryState = {
      status: "loaded",
      rows: [row("1")],
      hasNextPage: true,
      nextCursor: "cursor-1",
      error: null,
    };
    const next = importHistoryReducer(initial, {
      type: "LOAD_MORE_SUCCESS",
      rows: [row("2")],
      hasNextPage: false,
      nextCursor: null,
    });
    expect(next.hasNextPage).toBe(false);
    expect(next.nextCursor).toBeNull();
  });
});

describe("T7: load-more failure preserves existing rows and cursor", () => {
  it("LOAD_MORE_FAILURE keeps rows/hasNextPage/nextCursor untouched, only flips status+error", () => {
    const initial: ImportHistoryState = {
      status: "loadingMore",
      rows: [row("1"), row("2")],
      hasNextPage: true,
      nextCursor: "cursor-2",
      error: null,
    };
    const next = importHistoryReducer(initial, { type: "LOAD_MORE_FAILURE", error: "network down" });
    expect(next.status).toBe("loadMoreFailed");
    expect(next.rows.map((r) => r.id)).toEqual(["1", "2"]);
    expect(next.hasNextPage).toBe(true);
    expect(next.nextCursor).toBe("cursor-2");
    expect(next.error).toBe("network down");
  });

  it("a subsequent LOAD_MORE_START from loadMoreFailed still preserves rows (retry remains possible)", () => {
    const failed: ImportHistoryState = {
      status: "loadMoreFailed",
      rows: [row("1")],
      hasNextPage: true,
      nextCursor: "cursor-2",
      error: "network down",
    };
    const retrying = importHistoryReducer(failed, { type: "LOAD_MORE_START" });
    expect(retrying.rows.map((r) => r.id)).toEqual(["1"]);
    expect(retrying.status).toBe("loadingMore");
  });
});

describe("T37: LOAD_START fully resets to a fresh empty state (no stale rows survive a remount)", () => {
  it("LOAD_START from an already-'loaded' state with rows discards them, never accumulating across remounts", () => {
    const loaded: ImportHistoryState = { status: "loaded", rows: [row("1"), row("2")], hasNextPage: true, nextCursor: "c", error: null };
    const restarted = importHistoryReducer(loaded, { type: "LOAD_START" });
    expect(restarted.status).toBe("loading");
    expect(restarted.rows).toEqual([]);
    expect(restarted.hasNextPage).toBe(false);
    expect(restarted.nextCursor).toBeNull();
  });
});

describe("T4: LOAD_FAILURE produces an isolated error state", () => {
  it("never carries stale rows from a prior successful load into the error state", () => {
    const loaded: ImportHistoryState = { status: "loaded", rows: [row("1")], hasNextPage: false, nextCursor: null, error: null };
    const failed = importHistoryReducer(loaded, { type: "LOAD_FAILURE", error: "boom" });
    expect(failed.status).toBe("error");
    expect(failed.rows).toEqual([]);
  });
});

describe("T20-equivalent: genuine falsy-but-valid field values survive the reducer untouched", () => {
  it("a row with sizeBytes: 0 is not mutated or dropped", () => {
    const state = importHistoryReducer(INITIAL_HISTORY_STATE, {
      type: "LOAD_SUCCESS",
      rows: [row("z", { sizeBytes: 0 })],
      hasNextPage: false,
      nextCursor: null,
    });
    expect(state.rows[0].sizeBytes).toBe(0);
  });
});
