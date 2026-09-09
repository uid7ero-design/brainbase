import { describe, it, expect } from "vitest";
import { describeBatchHistoryStatus } from "../../app/data-hub/import/historyStatusCopy";

// Data Hub 5A.3D.2 — real behavioral tests for the pure batch-status ->
// history-row presentation mapping. Covers T11/T12/T14/T25/M13 (N+1-avoidant
// list-level classification of AWAITING_UPLOAD/PROCESSING/DELETION_PENDING
// as non-actionable, matching the shipped 5A.3D.1 recovery semantics without
// any per-row worksheet fetch).

describe("T16/M13-equivalent: READY and FAILED are the only actionable history statuses", () => {
  it("READY is actionable", () => {
    expect(describeBatchHistoryStatus("READY").actionable).toBe(true);
  });

  it("FAILED is actionable (opens to a safe persisted failure summary)", () => {
    expect(describeBatchHistoryStatus("FAILED").actionable).toBe(true);
  });
});

describe("T12/T14/T25: AWAITING_UPLOAD/PROCESSING/DELETION_PENDING are non-actionable with an honest caption", () => {
  it("AWAITING_UPLOAD is non-actionable and says the file must be selected again", () => {
    const p = describeBatchHistoryStatus("AWAITING_UPLOAD");
    expect(p.actionable).toBe(false);
    expect(p.caption).toMatch(/never completed|start a new import/i);
  });

  it("PROCESSING is non-actionable and never suggests retrying finalize", () => {
    const p = describeBatchHistoryStatus("PROCESSING");
    expect(p.actionable).toBe(false);
    expect(p.caption).not.toMatch(/finalize|retry/i);
  });

  it("DELETION_PENDING is non-actionable", () => {
    const p = describeBatchHistoryStatus("DELETION_PENDING");
    expect(p.actionable).toBe(false);
  });
});

describe("no raw internal detail leaks into any caption", () => {
  it("no caption mentions storage/blob/sha/provider/organisation", () => {
    const statuses = ["READY", "FAILED", "AWAITING_UPLOAD", "PROCESSING", "DELETION_PENDING"] as const;
    for (const s of statuses) {
      const p = describeBatchHistoryStatus(s);
      const text = `${p.label} ${p.caption ?? ""}`.toLowerCase();
      expect(text).not.toMatch(/blob|storage key|sha256|provider|organisation|etag/);
    }
  });
});
